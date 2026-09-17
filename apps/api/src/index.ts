import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { clearSessionCookie, createSession, getSessionUser, hashPassword, requireAuth, setSessionCookie, verifyPassword, digest } from './auth'
import { deleteMedia, uploadMedia } from './media'
import { writePublicationLog } from './audit'
import { processDuePosts } from './scheduler'
import { encryptMetaToken, MetaClient, requireMetaEncryptionSecret } from './meta'
import type { AppEnv, PostStatus } from './types'

const app = new Hono<AppEnv>()

function allowedOrigin(env: AppEnv['Bindings'], requestOrigin: string | undefined): string {
  if (env.FRONTEND_URL) return env.FRONTEND_URL.replace(/\/$/, '')
  return ''
}

app.use('/api/*', cors({ origin: (origin, c) => allowedOrigin(c.env, origin), credentials: true }))

app.get('/api/health', (c) => c.json({ ok: true, service: 'ipubbler-api', version: '0.1.0', timestamp: new Date().toISOString() }))
app.get('/api', (c) => c.json({ name: 'ipubbler', status: 'online' }))

app.post('/api/setup', async (c) => {
  const setupSecret = c.req.header('X-Setup-Secret')
  if (!c.env.SETUP_SECRET || setupSecret !== c.env.SETUP_SECRET) return c.json({ error: 'No autorizado' }, 403)
  if (await c.env.DB.prepare('SELECT id FROM users LIMIT 1').first()) return c.json({ error: 'El administrador ya fue creado' }, 409)
  const body = await c.req.json<{ email?: string; password?: string; name?: string }>()
  const email = body.email?.trim().toLowerCase(); const password = body.password ?? ''
  if (!email || !email.includes('@') || password.length < 10) return c.json({ error: 'Email válido y contraseña de al menos 10 caracteres requeridos' }, 400)
  const now = new Date().toISOString(); const user = { id: crypto.randomUUID(), email, name: body.name?.trim() || 'Administrador' }
  await c.env.DB.prepare('INSERT INTO users (id,email,password_hash,name,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(user.id, user.email, await hashPassword(password), user.name, now, now).run()
  return c.json({ ok: true, user }, 201)
})

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>(); const email = body.email?.trim().toLowerCase()
  if (!email || !body.password) return c.json({ error: 'Credenciales requeridas' }, 400)
  const user = await c.env.DB.prepare('SELECT id,email,name,password_hash FROM users WHERE email=?').bind(email).first<{ id: string; email: string; name: string; password_hash: string }>()
  if (!user || !(await verifyPassword(body.password, user.password_hash))) return c.json({ error: 'Credenciales inválidas' }, 401)
  const sessionUser = { id: user.id, email: user.email, name: user.name }; setSessionCookie(c, await createSession(c.env.DB, sessionUser)); return c.json({ user: sessionUser })
})

app.post('/api/auth/logout', async (c) => {
  const match = (c.req.header('Cookie') ?? '').match(/(?:^|;\s*)ipubbler_session=([^;]+)/)
  if (match) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(match[1])).run()
  clearSessionCookie(c); return c.json({ ok: true })
})
app.get('/api/auth/me', async (c) => c.json({ user: await getSessionUser(c) }))

app.use('/api/posts', requireAuth)
app.use('/api/posts/*', requireAuth)
app.use('/api/media/*', requireAuth)
app.use('/api/dashboard/*', requireAuth)
app.use('/api/meta/*', requireAuth)
app.use('/api/destinations/*', requireAuth)
app.use('/api/destinations', requireAuth)

export async function normalizeDestinationIds(env: AppEnv['Bindings'], userId: string, value: unknown): Promise<string[]> {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('destination_ids debe ser un arreglo')
  const ids = Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim())))
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const owned = await env.DB.prepare(`SELECT d.id FROM destinations d JOIN facebook_accounts a ON a.id=d.facebook_account_id WHERE a.user_id=? AND d.id IN (${placeholders})`).bind(userId, ...ids).all<{ id: string }>()
  if (owned.results.length !== ids.length) throw new Error('Uno o más destinos no pertenecen a tu cuenta')
  return ids
}

async function getPostDestinationIds(env: AppEnv['Bindings'], postId: string): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT destination_id FROM post_destinations WHERE post_id=? ORDER BY created_at').bind(postId).all<{ destination_id: string }>()
  return rows.results.map((row) => row.destination_id)
}

function destinationStatements(env: AppEnv['Bindings'], postId: string, destinationIds: string[], now: string) {
  const statements = [env.DB.prepare('DELETE FROM post_destinations WHERE post_id=?').bind(postId)]
  for (const destinationId of destinationIds) {
    statements.push(env.DB.prepare(`INSERT INTO post_destinations (post_id,destination_id,status,provider_post_id,error_message,published_at,created_at,updated_at) VALUES (?,?, 'pending',NULL,NULL,NULL,?,?)`).bind(postId, destinationId, now, now))
  }
  return statements
}

app.get('/api/posts', async (c) => {
  const user = c.get('user'); const status = c.req.query('status') as PostStatus | undefined; const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 100)
  const params: unknown[] = [user.id]; let sql = `SELECT p.*, (SELECT COUNT(*) FROM media m WHERE m.post_id=p.id) AS media_count, (SELECT COUNT(*) FROM post_destinations pd WHERE pd.post_id=p.id) AS destination_count FROM posts p WHERE p.user_id=?`
  if (status && ['draft','scheduled','processing','published','failed'].includes(status)) { sql += ' AND p.status=?'; params.push(status) }
  sql += ' ORDER BY COALESCE(p.scheduled_at,p.created_at) DESC LIMIT ?'; params.push(limit)
  return c.json({ posts: (await c.env.DB.prepare(sql).bind(...params).all()).results })
})

app.post('/api/posts', async (c) => {
  const user = c.get('user')
  let body: { content?: string; scheduled_at?: string | null; timezone?: string; destination_ids?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'JSON inválido' }, 400) }
  const content = body.content?.trim() ?? ''; const scheduledAt = body.scheduled_at ?? null
  if (!content) return c.json({ error: 'El contenido no puede estar vacío' }, 400)
  if (scheduledAt && Number.isNaN(Date.parse(scheduledAt))) return c.json({ error: 'scheduled_at inválido' }, 400)
  if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) return c.json({ error: 'La fecha programada debe estar en el futuro' }, 400)
  let destinationIds: string[]
  try { destinationIds = await normalizeDestinationIds(c.env, user.id, body.destination_ids) } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Destinos inválidos' }, 400) }
  if (scheduledAt && destinationIds.length === 0) return c.json({ error: 'Una publicación programada requiere al menos un destino' }, 400)
  const now = new Date().toISOString(); const post = { id: crypto.randomUUID(), user_id: user.id, content, status: scheduledAt ? 'scheduled' : 'draft' as PostStatus, scheduled_at: scheduledAt, timezone: body.timezone || 'UTC', published_at: null, attempts: 0, next_attempt_at: null, error_message: null, created_at: now, updated_at: now }
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO posts (id,user_id,content,status,scheduled_at,timezone,published_at,attempts,next_attempt_at,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(post.id,post.user_id,post.content,post.status,post.scheduled_at,post.timezone,post.published_at,post.attempts,post.next_attempt_at,post.error_message,post.created_at,post.updated_at),
      ...destinationStatements(c.env, post.id, destinationIds, now).slice(1),
    ])
  } catch { return c.json({ error: 'No fue posible guardar la publicación' }, 500) }
  await writePublicationLog(c.env, post.id, 'created', 'Publicación creada.', now)
  if (scheduledAt) await writePublicationLog(c.env, post.id, 'scheduled', `Publicación programada para ${scheduledAt}.`, now)
  return c.json({ post }, 201)
})

app.get('/api/posts/:id', async (c) => {
  const post = await c.env.DB.prepare('SELECT * FROM posts WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).first(); if (!post) return c.json({ error: 'Publicación no encontrada' }, 404); return c.json({ post })
})

app.patch('/api/posts/:id', async (c) => {
  const user = c.get('user'); const id = c.req.param('id'); const current = await c.env.DB.prepare('SELECT * FROM posts WHERE id=? AND user_id=?').bind(id,user.id).first<Record<string,unknown>>()
  if (!current) return c.json({ error: 'Publicación no encontrada' }, 404); if (current.status === 'processing') return c.json({ error: 'La publicación está siendo procesada' }, 409); if (current.status === 'published') return c.json({ error: 'La publicación ya fue publicada y no puede modificarse' }, 409)
  let body: { content?: string; scheduled_at?: string | null; timezone?: string; destination_ids?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'JSON inválido' }, 400) }
  const content = body.content !== undefined ? body.content.trim() : String(current.content); const scheduledAt = body.scheduled_at !== undefined ? body.scheduled_at : current.scheduled_at
  if (!content) return c.json({ error: 'El contenido no puede estar vacío' }, 400); if (scheduledAt && Number.isNaN(Date.parse(String(scheduledAt)))) return c.json({ error: 'scheduled_at inválido' }, 400); if (scheduledAt && Date.parse(String(scheduledAt)) <= Date.now()) return c.json({ error: 'La fecha programada debe estar en el futuro' }, 400)
  let destinationIds: string[]
  try { destinationIds = body.destination_ids !== undefined ? await normalizeDestinationIds(c.env, user.id, body.destination_ids) : await getPostDestinationIds(c.env, id) } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Destinos inválidos' }, 400) }
  if (scheduledAt && destinationIds.length === 0) return c.json({ error: 'Una publicación programada requiere al menos un destino' }, 400)
  const now = new Date().toISOString(); const status: PostStatus = scheduledAt ? 'scheduled' : 'draft'
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE posts SET content=?,status=?,scheduled_at=?,timezone=?,attempts=0,next_attempt_at=NULL,error_message=NULL,updated_at=? WHERE id=? AND user_id=?').bind(content,status,scheduledAt,body.timezone ?? current.timezone,now,id,user.id),
      ...destinationStatements(c.env, id, destinationIds, now),
    ])
  } catch { return c.json({ error: 'No fue posible actualizar la publicación' }, 500) }
  await writePublicationLog(c.env, id, 'updated', 'Publicación modificada.', now)
  if (scheduledAt) await writePublicationLog(c.env, id, 'scheduled', `Publicación programada para ${scheduledAt}.`, now)
  return c.json({ post: await c.env.DB.prepare('SELECT * FROM posts WHERE id=? AND user_id=?').bind(id,user.id).first() })
})

app.delete('/api/posts/:id', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('user').id
  const mediaRows = await c.env.DB.prepare('SELECT m.r2_key FROM media m JOIN posts p ON p.id=m.post_id WHERE m.post_id=? AND p.user_id=?').bind(id, userId).all<{ r2_key: string }>()
  const result = await c.env.DB.prepare('DELETE FROM posts WHERE id=? AND user_id=?').bind(id, userId).run()
  if (!result.meta.changes) return c.json({ error:'Publicación no encontrada' },404)
  await Promise.allSettled(mediaRows.results.map((media) => c.env.MEDIA_BUCKET.delete(media.r2_key)))
  return c.json({ ok:true })
})
app.post('/api/posts/:id/media', async (c) => uploadMedia(c, c.req.param('id')))

app.get('/api/posts/:id/media', async (c) => {
  const rows = await c.env.DB.prepare('SELECT m.id,m.post_id,m.filename,m.mime_type,m.size,m.sort_order,m.created_at FROM media m JOIN posts p ON p.id=m.post_id WHERE m.post_id=? AND p.user_id=? ORDER BY m.sort_order ASC, m.created_at ASC').bind(c.req.param('id'), c.get('user').id).all()
  return c.json({ media: rows.results })
})

app.get('/api/posts/:id/destinations', async (c) => {
  const post = await c.env.DB.prepare('SELECT id FROM posts WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).first()
  if (!post) return c.json({ error: 'Publicación no encontrada' }, 404)
  const rows = await c.env.DB.prepare(`SELECT d.id,d.type,d.provider_id,d.name,d.metadata_json,pd.status,pd.provider_post_id,pd.error_message,pd.published_at FROM destinations d JOIN post_destinations pd ON pd.destination_id=d.id JOIN facebook_accounts a ON a.id=d.facebook_account_id WHERE pd.post_id=? AND a.user_id=? ORDER BY d.name`).bind(c.req.param('id'), c.get('user').id).all()
  return c.json({ destinations: rows.results })
})

app.put('/api/posts/:id/destinations', async (c) => {
  const postId = c.req.param('id'); const userId = c.get('user').id
  const post = await c.env.DB.prepare('SELECT id,status FROM posts WHERE id=? AND user_id=?').bind(postId, userId).first<{id:string;status:PostStatus}>()
  if (!post) return c.json({ error: 'Publicación no encontrada' }, 404)
  if (post.status === 'processing' || post.status === 'published') return c.json({ error: 'No se pueden modificar los destinos de una publicación ya procesada' }, 409)
  let body: { destination_ids?: string[] }
  try { body = await c.req.json() } catch { return c.json({ error: 'JSON inválido' }, 400) }
  const ids = Array.from(new Set((body.destination_ids ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0)))
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    const owned = await c.env.DB.prepare(`SELECT d.id FROM destinations d JOIN facebook_accounts a ON a.id=d.facebook_account_id WHERE a.user_id=? AND d.id IN (${placeholders})`).bind(userId, ...ids).all<{id:string}>()
    if (owned.results.length !== ids.length) return c.json({ error: 'Uno o más destinos no pertenecen a tu cuenta' }, 403)
  }
  if (post.status === 'scheduled' && ids.length === 0) return c.json({ error: 'Una publicación programada requiere al menos un destino' }, 400)
  const now = new Date().toISOString()
  try { await c.env.DB.batch(destinationStatements(c.env, postId, ids, now)) } catch { return c.json({ error: 'No fue posible actualizar los destinos' }, 500) }
  await writePublicationLog(c.env, postId, 'updated', `Destinos de la publicación actualizados (${ids.length}).`, now)
  const rows = await c.env.DB.prepare(`SELECT d.id,d.type,d.provider_id,d.name,d.metadata_json,pd.status,pd.provider_post_id,pd.error_message,pd.published_at FROM destinations d JOIN post_destinations pd ON pd.destination_id=d.id JOIN facebook_accounts a ON a.id=d.facebook_account_id WHERE pd.post_id=? AND a.user_id=? ORDER BY d.name`).bind(postId,userId).all()
  return c.json({ destinations: rows.results })
})

app.get('/api/posts/:id/logs', async (c) => {
  const post = await c.env.DB.prepare('SELECT id FROM posts WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).first()
  if (!post) return c.json({ error: 'Publicación no encontrada' }, 404)
  const rows = await c.env.DB.prepare('SELECT id,status,message,created_at FROM publication_logs WHERE post_id=? ORDER BY created_at DESC').bind(c.req.param('id')).all()
  return c.json({ logs: rows.results })
})

app.get('/api/media/:id', async (c) => {
  const media = await c.env.DB.prepare('SELECT m.id,m.r2_key,m.filename,m.mime_type,m.size FROM media m JOIN posts p ON p.id=m.post_id WHERE m.id=? AND p.user_id=?').bind(c.req.param('id'), c.get('user').id).first<{ id:string; r2_key:string; filename:string; mime_type:string; size:number }>()
  if (!media) return c.json({ error: 'Multimedia no encontrada' }, 404)
  const object = await c.env.MEDIA_BUCKET.get(media.r2_key); if (!object) return c.json({ error: 'Archivo no encontrado' }, 404)
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('etag', object.httpEtag); headers.set('content-disposition', `inline; filename=\"${media.filename}\"`); return new Response(object.body, { headers })
})
app.delete('/api/media/:id', async (c) => deleteMedia(c, c.req.param('id')))

app.get('/api/dashboard/stats', async (c) => {
  const rows = await c.env.DB.prepare('SELECT status,COUNT(*) AS count FROM posts WHERE user_id=? GROUP BY status').bind(c.get('user').id).all<{status:string;count:number}>(); const stats = { scheduled:0,published:0,draft:0,failed:0,processing:0 }; for (const row of rows.results) if (row.status in stats) stats[row.status as keyof typeof stats]=Number(row.count); return c.json({stats})
})

app.get('/api/meta/status', async (c) => {
  const user = c.get('user'); const accounts = await c.env.DB.prepare('SELECT id,provider_user_id,name,token_expires_at,created_at,updated_at FROM facebook_accounts WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all(); const destinations = await c.env.DB.prepare('SELECT d.id,d.type,d.provider_id,d.name,d.metadata_json,d.created_at,d.updated_at FROM destinations d JOIN facebook_accounts a ON a.id=d.facebook_account_id WHERE a.user_id=? ORDER BY d.name').bind(user.id).all()
  return c.json({ configured: Boolean(c.env.META_APP_ID && c.env.META_APP_SECRET && c.env.META_TOKEN_ENCRYPTION_KEY), accounts: accounts.results, destinations: destinations.results })
})

app.post('/api/meta/connect', async (c) => {
  if (!c.env.META_APP_ID || !c.env.META_APP_SECRET) return c.json({ error: 'La integración Meta no está configurada en el Worker' }, 503)
  try { requireMetaEncryptionSecret(c.env) } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Falta la clave de cifrado de Meta' }, 503) }
  let body: { access_token?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'JSON inválido' }, 400) }
  const userAccessToken = body.access_token?.trim()
  if (!userAccessToken) return c.json({ error: 'access_token requerido' }, 400)
  try { const meta = new MetaClient(c.env); const me = await meta.getMe(userAccessToken); const pages = await meta.listPages(userAccessToken); const secret = requireMetaEncryptionSecret(c.env); const now = new Date().toISOString(); const accountId = crypto.randomUUID(); const encryptedUserToken = await encryptMetaToken(userAccessToken, secret); await c.env.DB.prepare(`INSERT INTO facebook_accounts (id,user_id,provider_user_id,name,access_token_encrypted,token_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,provider_user_id) DO UPDATE SET name=excluded.name,access_token_encrypted=excluded.access_token_encrypted,updated_at=excluded.updated_at`).bind(accountId,c.get('user').id,me.id,me.name,encryptedUserToken,null,now,now).run(); const account = await c.env.DB.prepare('SELECT id FROM facebook_accounts WHERE user_id=? AND provider_user_id=?').bind(c.get('user').id,me.id).first<{id:string}>(); if (!account) throw new Error('No se pudo guardar la cuenta Meta'); for (const page of pages.data ?? []) { const encryptedPageToken = page.access_token ? await encryptMetaToken(page.access_token, secret) : null; await c.env.DB.prepare(`INSERT INTO destinations (id,facebook_account_id,type,provider_id,name,access_token_encrypted,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(facebook_account_id,type,provider_id) DO UPDATE SET name=excluded.name,access_token_encrypted=excluded.access_token_encrypted,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`).bind(crypto.randomUUID(),account.id,'page',page.id,page.name,encryptedPageToken,JSON.stringify({ tasks: page.tasks ?? [] }),now,now).run() } return c.json({ ok: true, account: { id: account.id, provider_user_id: me.id, name: me.name }, pages: (pages.data ?? []).map((page) => ({ id: page.id, name: page.name, tasks: page.tasks ?? [] })) }) } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'No se pudo conectar Meta' }, 400) }
})

app.get('/api/destinations', async (c) => { const rows = await c.env.DB.prepare('SELECT d.id,d.type,d.provider_id,d.name,d.metadata_json,d.created_at,d.updated_at FROM destinations d JOIN facebook_accounts a ON a.id=d.facebook_account_id WHERE a.user_id=? ORDER BY d.name').bind(c.get('user').id).all(); return c.json({ destinations: rows.results }) })
app.delete('/api/destinations/:id', async (c) => { const result = await c.env.DB.prepare('DELETE FROM destinations WHERE id IN (SELECT d.id FROM destinations d JOIN facebook_accounts a ON a.id=d.facebook_account_id WHERE d.id=? AND a.user_id=?)').bind(c.req.param('id'),c.get('user').id).run(); if (!result.meta.changes) return c.json({ error: 'Destino no encontrado' },404); return c.json({ ok:true }) })

export default { fetch: app.fetch, async scheduled(_event: ScheduledEvent, env: AppEnv['Bindings'], _ctx: ExecutionContext) { await processDuePosts(env) } }
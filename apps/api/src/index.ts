import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { clearSessionCookie, createSession, getSessionUser, hashPassword, requireAuth, setSessionCookie, verifyPassword, digest } from './auth'
import { deleteMedia, uploadMedia } from './media'
import { processDuePosts } from './scheduler'
import type { AppEnv, PostStatus } from './types'

const app = new Hono<AppEnv>()
app.use('/api/*', cors({ origin: (origin) => origin || '*', credentials: true }))

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

app.get('/api/posts', async (c) => {
  const user = c.get('user'); const status = c.req.query('status') as PostStatus | undefined; const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 100)
  const params: unknown[] = [user.id]; let sql = 'SELECT * FROM posts WHERE user_id=?'
  if (status && ['draft','scheduled','processing','published','failed'].includes(status)) { sql += ' AND status=?'; params.push(status) }
  sql += ' ORDER BY COALESCE(scheduled_at,created_at) DESC LIMIT ?'; params.push(limit)
  return c.json({ posts: (await c.env.DB.prepare(sql).bind(...params).all()).results })
})

app.post('/api/posts', async (c) => {
  const user = c.get('user'); const body = await c.req.json<{ content?: string; scheduled_at?: string | null; timezone?: string }>(); const content = body.content?.trim() ?? ''; const scheduledAt = body.scheduled_at ?? null
  if (!content) return c.json({ error: 'El contenido no puede estar vacío' }, 400)
  if (scheduledAt && Number.isNaN(Date.parse(scheduledAt))) return c.json({ error: 'scheduled_at inválido' }, 400)
  if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) return c.json({ error: 'La fecha programada debe estar en el futuro' }, 400)
  const now = new Date().toISOString(); const post = { id: crypto.randomUUID(), user_id: user.id, content, status: scheduledAt ? 'scheduled' : 'draft' as PostStatus, scheduled_at: scheduledAt, timezone: body.timezone || 'UTC', published_at: null, attempts: 0, next_attempt_at: null, error_message: null, created_at: now, updated_at: now }
  await c.env.DB.prepare('INSERT INTO posts (id,user_id,content,status,scheduled_at,timezone,published_at,attempts,next_attempt_at,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(post.id,post.user_id,post.content,post.status,post.scheduled_at,post.timezone,post.published_at,post.attempts,post.next_attempt_at,post.error_message,post.created_at,post.updated_at).run()
  return c.json({ post }, 201)
})

app.get('/api/posts/:id', async (c) => {
  const post = await c.env.DB.prepare('SELECT * FROM posts WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).first(); if (!post) return c.json({ error: 'Publicación no encontrada' }, 404); return c.json({ post })
})

app.patch('/api/posts/:id', async (c) => {
  const user = c.get('user'); const id = c.req.param('id'); const current = await c.env.DB.prepare('SELECT * FROM posts WHERE id=? AND user_id=?').bind(id,user.id).first<Record<string,unknown>>()
  if (!current) return c.json({ error: 'Publicación no encontrada' }, 404); if (current.status === 'processing') return c.json({ error: 'La publicación está siendo procesada' }, 409)
  const body = await c.req.json<{ content?: string; scheduled_at?: string | null; timezone?: string }>(); const content = body.content !== undefined ? body.content.trim() : String(current.content); const scheduledAt = body.scheduled_at !== undefined ? body.scheduled_at : current.scheduled_at
  if (!content) return c.json({ error: 'El contenido no puede estar vacío' }, 400); if (scheduledAt && Number.isNaN(Date.parse(String(scheduledAt)))) return c.json({ error: 'scheduled_at inválido' }, 400); if (scheduledAt && Date.parse(String(scheduledAt)) <= Date.now()) return c.json({ error: 'La fecha programada debe estar en el futuro' }, 400)
  const now = new Date().toISOString(); const status: PostStatus = scheduledAt ? 'scheduled' : 'draft'
  await c.env.DB.prepare('UPDATE posts SET content=?,status=?,scheduled_at=?,timezone=?,attempts=0,next_attempt_at=NULL,error_message=NULL,updated_at=? WHERE id=? AND user_id=?').bind(content,status,scheduledAt,body.timezone ?? current.timezone,now,id,user.id).run()
  return c.json({ post: await c.env.DB.prepare('SELECT * FROM posts WHERE id=? AND user_id=?').bind(id,user.id).first() })
})

app.delete('/api/posts/:id', async (c) => { const result = await c.env.DB.prepare('DELETE FROM posts WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('user').id).run(); if (!result.meta.changes) return c.json({ error:'Publicación no encontrada' },404); return c.json({ ok:true }) })
app.post('/api/posts/:id/media', async (c) => uploadMedia(c, c.req.param('id')))

app.get('/api/posts/:id/media', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT m.id,m.post_id,m.filename,m.mime_type,m.size,m.sort_order,m.created_at FROM media m JOIN posts p ON p.id=m.post_id WHERE m.post_id=? AND p.user_id=? ORDER BY m.sort_order ASC, m.created_at ASC',
  ).bind(c.req.param('id'), c.get('user').id).all()
  return c.json({ media: rows.results })
})

app.get('/api/posts/:id/logs', async (c) => {
  const post = await c.env.DB.prepare('SELECT id FROM posts WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).first()
  if (!post) return c.json({ error: 'Publicación no encontrada' }, 404)
  const logs = await c.env.DB.prepare('SELECT id,post_id,status,message,created_at FROM publication_logs WHERE post_id=? ORDER BY created_at DESC').bind(c.req.param('id')).all()
  return c.json({ logs: logs.results })
})

app.get('/api/media/:id', async (c) => {
  const media = await c.env.DB.prepare(
    'SELECT m.id,m.r2_key,m.filename,m.mime_type,m.size FROM media m JOIN posts p ON p.id=m.post_id WHERE m.id=? AND p.user_id=?',
  ).bind(c.req.param('id'), c.get('user').id).first<{ id:string; r2_key:string; filename:string; mime_type:string; size:number }>()
  if (!media) return c.json({ error: 'Multimedia no encontrada' }, 404)
  const object = await c.env.MEDIA_BUCKET.get(media.r2_key)
  if (!object) return c.json({ error: 'Archivo no encontrado' }, 404)
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('content-disposition', `inline; filename="${media.filename}"`)
  return new Response(object.body, { headers })
})

app.delete('/api/media/:id', async (c) => deleteMedia(c, c.req.param('id')))

app.get('/api/dashboard/stats', async (c) => {
  const rows = await c.env.DB.prepare('SELECT status,COUNT(*) AS count FROM posts WHERE user_id=? GROUP BY status').bind(c.get('user').id).all<{status:string;count:number}>()
  const stats = { scheduled:0,published:0,draft:0,failed:0,processing:0 }; for (const row of rows.results) if (row.status in stats) stats[row.status as keyof typeof stats]=Number(row.count); return c.json({stats})
})

export default { fetch: app.fetch, async scheduled(_event: ScheduledEvent, env: AppEnv['Bindings'], _ctx: ExecutionContext) { await processDuePosts(env) } }

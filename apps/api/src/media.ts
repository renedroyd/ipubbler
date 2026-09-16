import type { Context } from 'hono'
import type { AppEnv } from './types'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export async function uploadMedia(c: Context<AppEnv>, postId: string): Promise<Response> {
  const user = c.get('user')
  const post = await c.env.DB.prepare('SELECT id FROM posts WHERE id = ? AND user_id = ?').bind(postId, user.id).first()
  if (!post) return c.json({ error: 'Publicación no encontrada' }, 404)

  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ error: 'Debe enviarse un archivo en el campo file' }, 400)
  if (!ALLOWED.has(file.type)) return c.json({ error: 'Formato no permitido. Use JPG, PNG, WebP o GIF' }, 400)
  if (file.size > MAX_IMAGE_BYTES) return c.json({ error: 'La imagen supera el límite de 10 MB' }, 400)

  const mediaId = crypto.randomUUID()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image'
  const key = `users/${user.id}/posts/${postId}/${mediaId}-${safeName}`
  const now = new Date().toISOString()
  await c.env.MEDIA_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, contentDisposition: `inline; filename="${safeName}"` },
  })
  const maxOrder = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM media WHERE post_id = ?').bind(postId).first<{ value: number }>()
  await c.env.DB.prepare(
    'INSERT INTO media (id,post_id,filename,mime_type,r2_key,size,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).bind(mediaId, postId, safeName, file.type, key, file.size, Number(maxOrder?.value ?? -1) + 1, now).run()
  return c.json({ media: { id: mediaId, post_id: postId, filename: safeName, mime_type: file.type, size: file.size, r2_key: key } }, 201)
}

export async function deleteMedia(c: Context<AppEnv>, mediaId: string): Promise<Response> {
  const user = c.get('user')
  const media = await c.env.DB.prepare(
    'SELECT m.id, m.r2_key FROM media m JOIN posts p ON p.id = m.post_id WHERE m.id = ? AND p.user_id = ?',
  ).bind(mediaId, user.id).first<{ id: string; r2_key: string }>()
  if (!media) return c.json({ error: 'Multimedia no encontrada' }, 404)
  await c.env.MEDIA_BUCKET.delete(media.r2_key)
  await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(mediaId).run()
  return c.json({ ok: true })
}

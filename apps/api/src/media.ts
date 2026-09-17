import type { Context } from 'hono'
import type { AppEnv } from './types'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_MEDIA_PER_POST = 10
const ALLOWED = new Map([
  ['image/jpeg', new Uint8Array([0xff, 0xd8, 0xff])],
  ['image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ['image/webp', new Uint8Array([0x52, 0x49, 0x46, 0x46])],
  ['image/gif', new Uint8Array([0x47, 0x49, 0x46, 0x38])],
])

function hasSignature(bytes: Uint8Array, signature: Uint8Array): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

async function validateImage(file: File): Promise<string | null> {
  if (!ALLOWED.has(file.type)) return 'Formato no permitido. Use JPG, PNG, WebP o GIF'
  if (file.size <= 0) return 'El archivo está vacío'
  if (file.size > MAX_IMAGE_BYTES) return 'La imagen supera el límite de 10 MB'

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const signature = ALLOWED.get(file.type)!
  if (!hasSignature(header, signature)) return 'El contenido del archivo no coincide con su formato declarado'
  if (file.type === 'image/webp' && !hasSignature(header.slice(8), new Uint8Array([0x57, 0x45, 0x42, 0x50]))) return 'El archivo WebP no es válido'
  return null
}

function safeFilename(name: string): string {
  const normalized = name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '')
  return normalized.slice(0, 180) || 'image'
}

export async function uploadMedia(c: Context<AppEnv>, postId: string): Promise<Response> {
  const user = c.get('user')
  const post = await c.env.DB.prepare('SELECT id,status FROM posts WHERE id = ? AND user_id = ?').bind(postId, user.id).first<{ id: string; status: string }>()
  if (!post) return c.json({ error: 'Publicación no encontrada' }, 404)
  if (post.status === 'processing') return c.json({ error: 'La publicación está siendo procesada' }, 409)
  if (post.status === 'published') return c.json({ error: 'La publicación ya fue publicada y no puede modificarse' }, 409)

  const count = await c.env.DB.prepare('SELECT COUNT(*) AS value FROM media WHERE post_id = ?').bind(postId).first<{ value: number }>()
  if (Number(count?.value ?? 0) >= MAX_MEDIA_PER_POST) return c.json({ error: `Una publicación puede tener como máximo ${MAX_MEDIA_PER_POST} imágenes` }, 400)

  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return c.json({ error: 'Debe enviarse un archivo en el campo file' }, 400)
  const validationError = await validateImage(file)
  if (validationError) return c.json({ error: validationError }, 400)

  const mediaId = crypto.randomUUID()
  const safeName = safeFilename(file.name)
  const key = `users/${user.id}/posts/${postId}/${mediaId}-${safeName}`
  const now = new Date().toISOString()

  try {
    await c.env.MEDIA_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type, contentDisposition: `inline; filename="${safeName}"` },
    })

    const maxOrder = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM media WHERE post_id = ?').bind(postId).first<{ value: number }>()
    await c.env.DB.prepare(
      'INSERT INTO media (id,post_id,filename,mime_type,r2_key,size,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).bind(mediaId, postId, safeName, file.type, key, file.size, Number(maxOrder?.value ?? -1) + 1, now).run()
  } catch {
    await c.env.MEDIA_BUCKET.delete(key).catch(() => undefined)
    return c.json({ error: 'No fue posible guardar la imagen' }, 500)
  }

  return c.json({ media: { id: mediaId, post_id: postId, filename: safeName, mime_type: file.type, size: file.size, r2_key: key, sort_order: 0, created_at: now } }, 201)
}

export async function deleteMedia(c: Context<AppEnv>, mediaId: string): Promise<Response> {
  const user = c.get('user')
  const media = await c.env.DB.prepare(
    'SELECT m.id, m.r2_key, p.status FROM media m JOIN posts p ON p.id = m.post_id WHERE m.id = ? AND p.user_id = ?',
  ).bind(mediaId, user.id).first<{ id: string; r2_key: string; status: string }>()
  if (!media) return c.json({ error: 'Multimedia no encontrada' }, 404)
  if (media.status === 'processing') return c.json({ error: 'La publicación está siendo procesada' }, 409)
  if (media.status === 'published') return c.json({ error: 'La publicación ya fue publicada y no puede modificarse' }, 409)

  try {
    await c.env.MEDIA_BUCKET.delete(media.r2_key)
  } catch {
    return c.json({ error: 'No fue posible eliminar el archivo multimedia' }, 500)
  }
  const result = await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(mediaId).run()
  if (!result.meta.changes) return c.json({ error: 'Multimedia no encontrada' }, 404)
  return c.json({ ok: true })
}

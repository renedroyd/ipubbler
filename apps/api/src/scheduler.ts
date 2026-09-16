import type { Bindings } from './types'

const MAX_ATTEMPTS = 3

export async function processDuePosts(env: Bindings): Promise<{ processed: number; published: number; failed: number }> {
  const now = new Date().toISOString()
  const due = await env.DB.prepare(
    `SELECT id, content, attempts FROM posts
     WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT 25`,
  ).bind(now).all<{ id: string; content: string; attempts: number }>()

  let published = 0
  let failed = 0
  for (const post of due.results) {
    const claim = await env.DB.prepare(`UPDATE posts SET status='processing', updated_at=? WHERE id=? AND status='scheduled'`).bind(now, post.id).run()
    if (!claim.meta.changes) continue
    try {
      await env.DB.prepare(`INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)`).bind(
        crypto.randomUUID(), post.id, 'processing', 'Dry-run: publicación reclamada por el scheduler; proveedor social pendiente de fase 2.', now,
      ).run()
      const attempts = Number(post.attempts) + 1
      const retryAt = new Date(Date.now() + Math.min(60 * 2 ** attempts, 3600) * 1000).toISOString()
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'scheduled'
      await env.DB.prepare(`UPDATE posts SET status=?, attempts=?, next_attempt_at=?, error_message=?, updated_at=? WHERE id=?`).bind(
        status, attempts, status === 'scheduled' ? retryAt : null,
        status === 'failed' ? 'Proveedor de publicación no configurado (fase 2).' : 'Pendiente de proveedor social.', now, post.id,
      ).run()
      await env.DB.prepare(`INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)`).bind(
        crypto.randomUUID(), post.id, status,
        status === 'failed' ? 'Falló por falta de proveedor social configurado.' : 'Reprogramada hasta completar la integración social.', now,
      ).run()
      if (status === 'failed') failed++
    } catch (error) {
      failed++
      await env.DB.prepare("UPDATE posts SET status='failed', error_message=?, updated_at=? WHERE id=?").bind(String(error), now, post.id).run()
    }
  }
  return { processed: due.results.length, published, failed }
}

import type { Env } from './types'

const MAX_ATTEMPTS = 3

export async function processDuePosts(env: Env): Promise<{ processed: number; published: number; failed: number }> {
  const now = new Date().toISOString()
  const due = await env.DB.prepare(
    `SELECT id, content, attempts FROM posts
     WHERE status = 'scheduled' AND scheduled_at IS NOT NULL
       AND scheduled_at <= ?
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY scheduled_at ASC LIMIT 25`,
  ).bind(now, now).all<{ id: string; content: string; attempts: number }>()

  let published = 0
  let failed = 0
  for (const post of due.results) {
    const claim = await env.DB.prepare(
      `UPDATE posts SET status='processing', updated_at=?
       WHERE id=? AND status='scheduled'`,
    ).bind(now, post.id).run()
    if (!claim.meta.changes) continue

    try {
      const attempts = Number(post.attempts) + 1
      await env.DB.prepare(
        `INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)`,
      ).bind(crypto.randomUUID(), post.id, 'processing', 'Dry-run: publicación reclamada; proveedor social pendiente de fase 2.', now).run()

      const retryAt = new Date(Date.now() + Math.min(60 * 2 ** attempts, 3600) * 1000).toISOString()
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'scheduled'
      const message = status === 'failed'
        ? 'Proveedor de publicación no configurado (fase 2).'
        : 'Pendiente de proveedor social; reintentará automáticamente.'

      await env.DB.prepare(
        `UPDATE posts SET status=?, attempts=?, next_attempt_at=?, error_message=?, updated_at=? WHERE id=?`,
      ).bind(status, attempts, status === 'scheduled' ? retryAt : null, message, now, post.id).run()
      await env.DB.prepare(
        `INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)`,
      ).bind(crypto.randomUUID(), post.id, status, message, now).run()
      if (status === 'failed') failed++
    } catch (error) {
      failed++
      await env.DB.prepare("UPDATE posts SET status='failed', error_message=?, updated_at=? WHERE id=?").bind(String(error), now, post.id).run()
    }
  }
  return { processed: due.results.length, published, failed }
}

import type { Env } from './types'

export async function processDuePosts(env: Env): Promise<{ processed: number; published: number; failed: number }> {
  // Phase 1 intentionally does not consume scheduled posts until a social
  // provider is configured. This prevents the scheduler from falsely marking
  // content as published or failed while Meta integration is still pending.
  if (!env.META_ACCESS_TOKEN) return { processed: 0, published: 0, failed: 0 }

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
      `UPDATE posts SET status='processing', updated_at=? WHERE id=? AND status='scheduled'`,
    ).bind(now, post.id).run()
    if (!claim.meta.changes) continue

    try {
      // Meta publication adapter will replace this section in phase 2.
      const attempts = Number(post.attempts) + 1
      const retryAt = new Date(Date.now() + Math.min(60 * 2 ** attempts, 3600) * 1000).toISOString()
      const message = 'Proveedor social detectado, pero el adaptador Meta aún no está implementado.'
      await env.DB.prepare('UPDATE posts SET status=?,attempts=?,next_attempt_at=?,error_message=?,updated_at=? WHERE id=?').bind('scheduled', attempts, retryAt, message, now, post.id).run()
      await env.DB.prepare('INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), post.id, 'scheduled', message, now).run()
    } catch (error) {
      failed++
      await env.DB.prepare("UPDATE posts SET status='failed',error_message=?,updated_at=? WHERE id=?").bind(String(error), now, post.id).run()
    }
  }
  return { processed: due.results.length, published, failed }
}

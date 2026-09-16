import { createMetaPublisher } from './meta/publisher'
import type { Env } from './types'

const MAX_ATTEMPTS = 5

export async function processDuePosts(env: Env): Promise<{ processed: number; published: number; failed: number }> {
  // The current publisher is Meta-based. Do not consume scheduled posts while
  // the provider is not configured; this prevents a fresh deployment from
  // turning valid scheduled posts into failures before Meta is connected.
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_TOKEN_ENCRYPTION_KEY) {
    return { processed: 0, published: 0, failed: 0 }
  }

  const now = new Date().toISOString()
  const due = await env.DB.prepare(
    `SELECT id, user_id, content, attempts FROM posts
     WHERE status = 'scheduled' AND scheduled_at IS NOT NULL
       AND scheduled_at <= ?
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY scheduled_at ASC LIMIT 25`,
  ).bind(now, now).all<{ id: string; user_id: string; content: string; attempts: number }>()

  let published = 0
  let failed = 0

  for (const post of due.results) {
    const claim = await env.DB.prepare(
      `UPDATE posts SET status='processing', updated_at=? WHERE id=? AND status='scheduled'`,
    ).bind(now, post.id).run()
    if (!claim.meta.changes) continue

    const destinations = await env.DB.prepare(`
      SELECT d.id
      FROM post_destinations pd
      JOIN destinations d ON d.id=pd.destination_id
      JOIN facebook_accounts a ON a.id=d.facebook_account_id
      WHERE pd.post_id=? AND a.user_id=?
      ORDER BY d.name
    `).bind(post.id, post.user_id).all<{ id: string }>()

    const mediaRows = await env.DB.prepare(
      'SELECT r2_key FROM media WHERE post_id=? ORDER BY sort_order ASC',
    ).bind(post.id).all<{ r2_key: string }>()
    const mediaKeys = mediaRows.results.map(item => item.r2_key)

    // A post may be created as scheduled and have its destinations associated
    // by the next API request. Keep it scheduled instead of converting it to a
    // permanent failure if the cron happens to run between those requests.
    if (!destinations.results.length) {
      await env.DB.prepare(`
        UPDATE posts
        SET status='scheduled', next_attempt_at=NULL, error_message=NULL, updated_at=?
        WHERE id=? AND status='processing'
      `).bind(now, post.id).run()
      continue
    }

    const publisher = createMetaPublisher(env, post.user_id)
    let destinationFailures = 0
    let destinationAttempts = 0

    for (const destination of destinations.results) {
      const claimDestination = await env.DB.prepare(
        `UPDATE post_destinations SET status='processing',error_message=NULL,updated_at=?
         WHERE post_id=? AND destination_id=? AND status IN ('pending','failed')`,
      ).bind(now, post.id, destination.id).run()
      if (!claimDestination.meta.changes) continue
      destinationAttempts++

      try {
        const result = await publisher.publish({ destinationId: destination.id, message: post.content, mediaKeys })
        await env.DB.prepare(
          `UPDATE post_destinations SET status='published',provider_post_id=?,published_at=?,updated_at=? WHERE post_id=? AND destination_id=?`,
        ).bind(result.providerId, now, now, post.id, destination.id).run()
        await env.DB.prepare(
          'INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)',
        ).bind(crypto.randomUUID(), post.id, 'published', `Publicado en destino ${destination.id}`, now).run()
      } catch (error) {
        destinationFailures++
        const message = error instanceof Error ? error.message : String(error)
        await env.DB.prepare(
          `UPDATE post_destinations SET status='failed',error_message=?,updated_at=? WHERE post_id=? AND destination_id=?`,
        ).bind(message, now, post.id, destination.id).run()
        await env.DB.prepare(
          'INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)',
        ).bind(crypto.randomUUID(), post.id, 'failed', message, now).run()
      }
    }

    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM post_destinations WHERE post_id=? AND status!='published'`,
    ).bind(post.id).first<{ count: number }>()

    if (!Number(remaining?.count)) {
      await env.DB.prepare(`UPDATE posts SET status='published',published_at=?,next_attempt_at=NULL,error_message=NULL,updated_at=? WHERE id=?`).bind(now, now, post.id).run()
      published++
      continue
    }

    if (!destinationAttempts) {
      await env.DB.prepare(`UPDATE posts SET status='scheduled',updated_at=? WHERE id=? AND status='processing'`).bind(now, post.id).run()
      continue
    }

    const attempts = Number(post.attempts) + 1
    if (attempts >= MAX_ATTEMPTS) {
      const message = destinationFailures
        ? 'Se alcanzó el máximo de intentos de publicación.'
        : 'La publicación no pudo completar todos sus destinos.'
      await env.DB.prepare(`UPDATE posts SET status='failed',attempts=?,next_attempt_at=NULL,error_message=?,updated_at=? WHERE id=?`).bind(attempts, message, now, post.id).run()
      failed++
    } else {
      const delaySeconds = Math.min(60 * 2 ** attempts, 3600)
      const retryAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
      await env.DB.prepare(`UPDATE posts SET status='scheduled',attempts=?,next_attempt_at=?,error_message=?,updated_at=? WHERE id=?`).bind(attempts, retryAt, 'Una o más publicaciones no pudieron completarse; se reintentará automáticamente.', now, post.id).run()
    }
  }

  return { processed: due.results.length, published, failed }
}

import { createMetaPublisher } from './meta/publisher'
import type { Env } from './types'

export const MAX_ATTEMPTS = 5
export const PROCESSING_LEASE_MS = 10 * 60 * 1000

export function leaseExpiredBefore(now: Date): string {
  return new Date(now.getTime() - PROCESSING_LEASE_MS).toISOString()
}

export function retryDelaySeconds(attempts: number): number {
  return Math.min(60 * 2 ** attempts, 3600)
}

export function nextRetryAt(now: Date, attempts: number): string {
  return new Date(now.getTime() + retryDelaySeconds(attempts) * 1000).toISOString()
}

async function recoverAbandonedProcessing(env: Env, now: Date): Promise<void> {
  const nowIso = now.toISOString()
  const staleBefore = leaseExpiredBefore(now)

  await env.DB.prepare(`
    UPDATE post_destinations
    SET status='failed',
        error_message='El procesamiento anterior expiró y será reintentado.',
        processing_at=NULL,
        updated_at=?
    WHERE status='processing'
      AND processing_at IS NOT NULL
      AND processing_at <= ?
  `).bind(nowIso, staleBefore).run()

  await env.DB.prepare(`
    UPDATE posts
    SET status='scheduled',
        next_attempt_at=?,
        error_message='El procesamiento anterior expiró y la publicación será reintentada.',
        processing_at=NULL,
        updated_at=?
    WHERE status='processing'
      AND processing_at IS NOT NULL
      AND processing_at <= ?
  `).bind(nowIso, nowIso, staleBefore).run()
}

export async function processDuePosts(env: Env): Promise<{ processed: number; published: number; failed: number }> {
  const nowDate = new Date()
  await recoverAbandonedProcessing(env, nowDate)

  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_TOKEN_ENCRYPTION_KEY) {
    return { processed: 0, published: 0, failed: 0 }
  }

  const now = nowDate.toISOString()
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
    const processingAt = new Date().toISOString()
    const claim = await env.DB.prepare(
      `UPDATE posts SET status='processing', processing_at=?, updated_at=?
       WHERE id=? AND status='scheduled'`,
    ).bind(processingAt, processingAt, post.id).run()
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

    if (!destinations.results.length) {
      await env.DB.prepare(`
        UPDATE posts
        SET status='scheduled', next_attempt_at=NULL, error_message=NULL,
            processing_at=NULL, updated_at=?
        WHERE id=? AND status='processing'
      `).bind(new Date().toISOString(), post.id).run()
      continue
    }

    const publisher = createMetaPublisher(env, post.user_id)
    let destinationFailures = 0
    let destinationAttempts = 0

    for (const destination of destinations.results) {
      const destinationProcessingAt = new Date().toISOString()
      const claimDestination = await env.DB.prepare(
        `UPDATE post_destinations
         SET status='processing', error_message=NULL, processing_at=?, updated_at=?
         WHERE post_id=? AND destination_id=? AND status IN ('pending','failed')`,
      ).bind(destinationProcessingAt, destinationProcessingAt, post.id, destination.id).run()
      if (!claimDestination.meta.changes) continue
      destinationAttempts++

      try {
        const result = await publisher.publish({ destinationId: destination.id, message: post.content, mediaKeys })
        const completedAt = new Date().toISOString()
        await env.DB.prepare(
          `UPDATE post_destinations
           SET status='published',provider_post_id=?,published_at=?,processing_at=NULL,updated_at=?
           WHERE post_id=? AND destination_id=? AND status='processing'`,
        ).bind(result.providerId, completedAt, completedAt, post.id, destination.id).run()
        await env.DB.prepare(
          'INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)',
        ).bind(crypto.randomUUID(), post.id, 'published', `Publicado en destino ${destination.id}`, completedAt).run()
      } catch (error) {
        destinationFailures++
        const completedAt = new Date().toISOString()
        const message = error instanceof Error ? error.message : String(error)
        await env.DB.prepare(
          `UPDATE post_destinations
           SET status='failed',error_message=?,processing_at=NULL,updated_at=?
           WHERE post_id=? AND destination_id=? AND status='processing'`,
        ).bind(message, completedAt, post.id, destination.id).run()
        await env.DB.prepare(
          'INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)',
        ).bind(crypto.randomUUID(), post.id, 'failed', message, completedAt).run()
      }
    }

    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM post_destinations WHERE post_id=? AND status!='published'`,
    ).bind(post.id).first<{ count: number }>()

    if (!Number(remaining?.count)) {
      const completedAt = new Date().toISOString()
      await env.DB.prepare(`
        UPDATE posts
        SET status='published',published_at=?,next_attempt_at=NULL,error_message=NULL,
            processing_at=NULL,updated_at=?
        WHERE id=? AND status='processing'
      `).bind(completedAt, completedAt, post.id).run()
      published++
      continue
    }

    if (!destinationAttempts) {
      await env.DB.prepare(`
        UPDATE posts SET status='scheduled',processing_at=NULL,updated_at=?
        WHERE id=? AND status='processing'
      `).bind(new Date().toISOString(), post.id).run()
      continue
    }

    const attempts = Number(post.attempts) + 1
    if (attempts >= MAX_ATTEMPTS) {
      const message = destinationFailures
        ? 'Se alcanzó el máximo de intentos de publicación.'
        : 'La publicación no pudo completar todos sus destinos.'
      const completedAt = new Date().toISOString()
      await env.DB.prepare(`
        UPDATE posts
        SET status='failed',attempts=?,next_attempt_at=NULL,error_message=?,processing_at=NULL,updated_at=?
        WHERE id=? AND status='processing'
      `).bind(attempts, message, completedAt, post.id).run()
      failed++
    } else {
      const retryAt = nextRetryAt(new Date(), attempts)
      const completedAt = new Date().toISOString()
      await env.DB.prepare(`
        UPDATE posts
        SET status='scheduled',attempts=?,next_attempt_at=?,error_message=?,processing_at=NULL,updated_at=?
        WHERE id=? AND status='processing'
      `).bind(attempts, retryAt, 'Una o más publicaciones no pudieron completarse; se reintentará automáticamente.', completedAt, post.id).run()
    }
  }

  return { processed: due.results.length, published, failed }
}

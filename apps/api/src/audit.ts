import type { Env } from './types'

export type PublicationLogStatus = 'created' | 'updated' | 'scheduled' | 'processing' | 'published' | 'failed' | 'retry'

export async function writePublicationLog(
  env: Env,
  postId: string,
  status: PublicationLogStatus,
  message?: string,
  createdAt = new Date().toISOString(),
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)',
  ).bind(crypto.randomUUID(), postId, status, message ?? null, createdAt).run()
}

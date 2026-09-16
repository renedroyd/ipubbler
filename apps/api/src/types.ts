export interface Env {
  DB: D1Database
  MEDIA_BUCKET: R2Bucket
  SESSION_SECRET: string
  SETUP_SECRET?: string
  META_ACCESS_TOKEN?: string
}

export interface SessionUser { id: string; email: string; name: string }
export type PostStatus = 'draft' | 'scheduled' | 'processing' | 'published' | 'failed'

export interface Post {
  id: string; user_id: string; content: string; status: PostStatus
  scheduled_at: string | null; timezone: string; published_at: string | null
  attempts: number; next_attempt_at: string | null; error_message: string | null
  created_at: string; updated_at: string
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } }

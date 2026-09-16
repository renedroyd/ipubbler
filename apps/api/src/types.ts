export interface Env {
  DB: D1Database
  MEDIA_BUCKET: R2Bucket
  SESSION_SECRET: string
  SETUP_SECRET?: string
  FRONTEND_URL?: string
  META_ACCESS_TOKEN?: string
  META_APP_ID?: string
  META_APP_SECRET?: string
  META_TOKEN_ENCRYPTION_KEY?: string
  META_GRAPH_VERSION?: string
  META_REDIRECT_URI?: string
}

export interface SessionUser { id: string; email: string; name: string }
export type PostStatus = 'draft' | 'scheduled' | 'processing' | 'published' | 'failed'

export interface Post {
  id: string; user_id: string; content: string; status: PostStatus
  scheduled_at: string | null; timezone: string; published_at: string | null
  attempts: number; next_attempt_at: string | null; error_message: string | null
  created_at: string; updated_at: string
}

export type DestinationType = 'page' | 'profile' | 'group'

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } }

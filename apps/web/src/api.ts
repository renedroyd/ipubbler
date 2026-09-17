const API_BASE = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`)
  return data as T
}

export interface User { id: string; email: string; name: string }
export interface Post { id: string; content: string; status: string; scheduled_at: string | null; timezone: string; created_at: string; updated_at: string; error_message?: string | null; media_count?: number; destination_count?: number }
export interface Media { id: string; post_id: string; filename: string; mime_type: string; size: number; sort_order: number; created_at: string }
export interface PublicationLog { id: string; post_id: string; status: string; message: string | null; created_at: string }
export interface Destination { id: string; type: 'page' | 'profile' | 'group' | string; provider_id: string; name: string; metadata_json?: string | null; status?: string; provider_post_id?: string | null; error_message?: string | null; published_at?: string | null }
export interface MetaAccount { id: string; provider_user_id: string; name: string; token_expires_at?: string | null; created_at?: string; updated_at?: string }
export interface CalendarPost extends Post { destination_count?: number }

type PendingFinalization = {
  scheduled_at: string
  timezone: string
  destination_ids: string[]
  remaining_uploads: number
}

const pendingFinalizations = new Map<string, PendingFinalization>()

function selectedUploadCount(): number {
  if (typeof document === 'undefined') return 0
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
  return input?.files?.length ?? 0
}

async function finalizePendingPost(postId: string, plan: PendingFinalization): Promise<Post> {
  const result = await request<{ post: Post }>(`/api/posts/${postId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      scheduled_at: plan.scheduled_at,
      timezone: plan.timezone,
      destination_ids: plan.destination_ids,
    }),
  })
  pendingFinalizations.delete(postId)
  return result.post
}

export const api = {
  me: () => request<{ user: User | null }>('/api/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  stats: () => request<{ stats: Record<string, number> }>('/api/dashboard/stats'),
  posts: (status?: string) => request<{ posts: Post[] }>(`/api/posts${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  createPost: async (content: string, scheduled_at: string | null, timezone: string, destination_ids: string[] = []) => {
    const uploadCount = scheduled_at ? selectedUploadCount() : 0
    const result = await request<{ post: Post }>('/api/posts', {
      method: 'POST',
      body: JSON.stringify({
        content,
        scheduled_at: uploadCount > 0 ? null : scheduled_at,
        timezone,
        destination_ids,
      }),
    })
    if (scheduled_at && uploadCount > 0) {
      pendingFinalizations.set(result.post.id, { scheduled_at, timezone, destination_ids, remaining_uploads: uploadCount })
    }
    return result
  },
  updatePost: async (id: string, payload: { content?: string; scheduled_at?: string | null; timezone?: string; destination_ids?: string[] }) => {
    const uploadCount = payload.scheduled_at ? selectedUploadCount() : 0
    const result = await request<{ post: Post }>(`/api/posts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payload, scheduled_at: uploadCount > 0 ? null : payload.scheduled_at }),
    })
    if (payload.scheduled_at && uploadCount > 0) {
      pendingFinalizations.set(id, {
        scheduled_at: payload.scheduled_at,
        timezone: payload.timezone ?? result.post.timezone,
        destination_ids: payload.destination_ids ?? [],
        remaining_uploads: uploadCount,
      })
    }
    return result
  },
  deletePost: (id: string) => request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),
  media: (postId: string) => request<{ media: Media[] }>(`/api/posts/${postId}/media`),
  uploadMedia: async (postId: string, file: File) => {
    const form = new FormData(); form.append('file', file)
    const result = await request<{ media: Media }>(`/api/posts/${postId}/media`, { method: 'POST', body: form })
    const plan = pendingFinalizations.get(postId)
    if (plan) {
      plan.remaining_uploads -= 1
      if (plan.remaining_uploads <= 0) await finalizePendingPost(postId, plan)
    }
    return result
  },
  deleteMedia: (id: string) => request<{ ok: boolean }>(`/api/media/${id}`, { method: 'DELETE' }),
  logs: (postId: string) => request<{ logs: PublicationLog[] }>(`/api/posts/${postId}/logs`),
  mediaUrl: (id: string) => `${API_BASE}/api/media/${id}`,
  metaStatus: () => request<{ configured: boolean; accounts: MetaAccount[]; destinations: Destination[] }>('/api/meta/status'),
  connectMeta: (access_token: string) => request<{ ok: boolean; account: MetaAccount; pages: Array<{ id: string; name: string; tasks: string[] }> }>('/api/meta/connect', { method: 'POST', body: JSON.stringify({ access_token }) }),
  destinations: () => request<{ destinations: Destination[] }>('/api/destinations'),
  deleteDestination: (id: string) => request<{ ok: boolean }>(`/api/destinations/${id}`, { method: 'DELETE' }),
  postDestinations: (postId: string) => request<{ destinations: Destination[] }>(`/api/posts/${postId}/destinations`),
  setPostDestinations: (postId: string, destination_ids: string[]) => request<{ destinations: Destination[] }>(`/api/posts/${postId}/destinations`, { method: 'PUT', body: JSON.stringify({ destination_ids }) }),
}

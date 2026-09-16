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

export const api = {
  me: () => request<{ user: User | null }>('/api/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  stats: () => request<{ stats: Record<string, number> }>('/api/dashboard/stats'),
  posts: (status?: string) => request<{ posts: Post[] }>(`/api/posts${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  createPost: (content: string, scheduled_at: string | null, timezone: string, destination_ids: string[] = []) => request<{ post: Post }>('/api/posts', { method: 'POST', body: JSON.stringify({ content, scheduled_at, timezone, destination_ids }) }),
  updatePost: (id: string, payload: { content?: string; scheduled_at?: string | null; timezone?: string; destination_ids?: string[] }) => request<{ post: Post }>(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deletePost: (id: string) => request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),
  media: (postId: string) => request<{ media: Media[] }>(`/api/posts/${postId}/media`),
  uploadMedia: async (postId: string, file: File) => { const form = new FormData(); form.append('file', file); return request<{ media: Media }>(`/api/posts/${postId}/media`, { method: 'POST', body: form }) },
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

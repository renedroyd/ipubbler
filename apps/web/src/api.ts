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
export interface Post { id: string; content: string; status: string; scheduled_at: string | null; timezone: string; created_at: string; updated_at: string; error_message?: string | null }
export interface Media { id: string; post_id: string; filename: string; mime_type: string; size: number; sort_order: number; created_at: string }
export interface PublicationLog { id: string; post_id: string; status: string; message: string | null; created_at: string }

export const api = {
  me: () => request<{ user: User | null }>('/api/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  stats: () => request<{ stats: Record<string, number> }>('/api/dashboard/stats'),
  posts: (status?: string) => request<{ posts: Post[] }>(`/api/posts${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  createPost: (content: string, scheduled_at: string | null, timezone: string) => request<{ post: Post }>('/api/posts', { method: 'POST', body: JSON.stringify({ content, scheduled_at, timezone }) }),
  updatePost: (id: string, payload: { content?: string; scheduled_at?: string | null; timezone?: string }) => request<{ post: Post }>(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deletePost: (id: string) => request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),
  media: (postId: string) => request<{ media: Media[] }>(`/api/posts/${postId}/media`),
  uploadMedia: async (postId: string, file: File) => { const form = new FormData(); form.append('file', file); return request<{ media: Media }>(`/api/posts/${postId}/media`, { method: 'POST', body: form }) },
  deleteMedia: (id: string) => request<{ ok: boolean }>(`/api/media/${id}`, { method: 'DELETE' }),
  logs: (postId: string) => request<{ logs: PublicationLog[] }>(`/api/posts/${postId}/logs`),
  mediaUrl: (id: string) => `${API_BASE}/api/media/${id}`,
}

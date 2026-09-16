const API_BASE = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`)
  return data as T
}

export interface User { id: string; email: string; name: string }
export interface Post { id: string; content: string; status: string; scheduled_at: string | null; timezone: string; created_at: string; updated_at: string; error_message?: string | null }

export const api = {
  me: () => request<{ user: User | null }>('/api/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  stats: () => request<{ stats: Record<string, number> }>('/api/dashboard/stats'),
  posts: (status?: string) => request<{ posts: Post[] }>(`/api/posts${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  createPost: (content: string, scheduled_at: string | null, timezone: string) => request<{ post: Post }>('/api/posts', { method: 'POST', body: JSON.stringify({ content, scheduled_at, timezone }) }),
  updatePost: (id: string, payload: { content?: string; scheduled_at?: string | null; timezone?: string }) => request<{ post: Post }>(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deletePost: (id: string) => request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),
}

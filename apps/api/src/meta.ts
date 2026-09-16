import type { Env } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptMetaToken(token: string, secret: string): Promise<string> {
  const key = await encryptionKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token)))
  const packed = new Uint8Array(iv.length + encrypted.length)
  packed.set(iv, 0)
  packed.set(encrypted, iv.length)
  return toBase64(packed)
}

export async function decryptMetaToken(value: string, secret: string): Promise<string> {
  const packed = fromBase64(value)
  if (packed.length < 13) throw new Error('Token cifrado inválido')
  const key = await encryptionKey(secret)
  const iv = packed.slice(0, 12)
  const encrypted = packed.slice(12)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)
  return decoder.decode(plain)
}

export interface MetaPage { id: string; name: string; access_token?: string; tasks?: string[] }

export class MetaClient {
  private readonly version: string
  constructor(private readonly env: Env) {
    this.version = env.META_GRAPH_VERSION || 'v26.0'
  }

  private async request<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.version}/${path.replace(/^\//, '')}`)
    url.searchParams.set('access_token', accessToken)
    const response = await fetch(url, init)
    const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } }
    if (!response.ok) throw new Error(data.error?.message || `Meta Graph API HTTP ${response.status}`)
    return data
  }

  async getMe(userAccessToken: string) {
    return this.request<{ id: string; name: string }>('me?fields=id,name', userAccessToken)
  }

  async listPages(userAccessToken: string) {
    return this.request<{ data: MetaPage[] }>('me/accounts?fields=id,name,access_token,tasks', userAccessToken)
  }
}

export function requireMetaEncryptionSecret(env: Env): string {
  const secret = env.META_TOKEN_ENCRYPTION_KEY
  if (!secret || secret.length < 32) throw new Error('META_TOKEN_ENCRYPTION_KEY no está configurada o es demasiado corta')
  return secret
}

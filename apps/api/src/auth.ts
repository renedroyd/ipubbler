import type { Context } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv, SessionUser } from './types'

const SESSION_DAYS = 7

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  return bytesToBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToBase64(new Uint8Array(hash))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 210_000, hash: 'SHA-256' },
    material,
    256,
  )
  return `pbkdf2_sha256$210000$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, iterationsText, saltText, expectedText] = encoded.split('$')
  if (scheme !== 'pbkdf2_sha256' || !iterationsText || !saltText || !expectedText) return false
  const iterations = Number(iterationsText)
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const salt = base64ToBytes(saltText)
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
    material,
    256,
  )
  const actual = new Uint8Array(bits)
  const expected = base64ToBytes(expectedText)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]
  return diff === 0
}

export async function createSession(db: D1Database, user: SessionUser): Promise<string> {
  const token = randomToken()
  const tokenHash = await digest(token)
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?) ',
  ).bind(crypto.randomUUID(), user.id, tokenHash, expires.toISOString(), now.toISOString()).run()
  return token
}

function sessionCookie(token: string, maxAge: number): string {
  return `ipubbler_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  c.header('Set-Cookie', sessionCookie(token, SESSION_DAYS * 24 * 60 * 60))
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  c.header('Set-Cookie', sessionCookie('', 0))
}

export async function getSessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const cookie = c.req.header('Cookie') ?? ''
  const match = cookie.match(/(?:^|;\s*)ipubbler_session=([^;]+)/)
  if (!match) return null
  const tokenHash = await digest(match[1])
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(tokenHash, new Date().toISOString()).first<SessionUser>()
  return row ?? null
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getSessionUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  c.set('user', user)
  await next()
}

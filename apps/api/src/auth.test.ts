import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './auth'

describe('auth password hashing', () => {
  it('hashes a password and verifies the original password', async () => {
    const encoded = await hashPassword('correct horse battery staple')

    expect(encoded).toMatch(/^pbkdf2_sha256\$210000\$/)
    await expect(verifyPassword('correct horse battery staple', encoded)).resolves.toBe(true)
    await expect(verifyPassword('wrong password', encoded)).resolves.toBe(false)
  })

  it('uses a different salt for repeated hashes', async () => {
    const first = await hashPassword('same password')
    const second = await hashPassword('same password')

    expect(first).not.toBe(second)
    await expect(verifyPassword('same password', first)).resolves.toBe(true)
    await expect(verifyPassword('same password', second)).resolves.toBe(true)
  })

  it('rejects malformed or unsafe encoded hashes', async () => {
    await expect(verifyPassword('password', 'invalid')).resolves.toBe(false)
    await expect(verifyPassword('password', 'pbkdf2_sha256$1$AAAA$AAAA')).resolves.toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES, validateImage, safeFilename } from './media'

const file = (bytes: Uint8Array, type: string, name = 'photo.jpg') =>
  new File([bytes], name, { type })

describe('media validation', () => {
  it('accepts valid JPEG, PNG, WebP and GIF signatures', async () => {
    await expect(validateImage(file(new Uint8Array([0xff, 0xd8, 0xff, 0x01]), 'image/jpeg'))).resolves.toBeNull()
    await expect(validateImage(file(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', 'photo.png'))).resolves.toBeNull()
    await expect(validateImage(file(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]), 'image/webp', 'photo.webp'))).resolves.toBeNull()
    await expect(validateImage(file(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'image/gif', 'photo.gif'))).resolves.toBeNull()
  })

  it('rejects a MIME/signature mismatch', async () => {
    await expect(validateImage(file(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/jpeg'))).resolves.toContain('no coincide')
  })

  it('rejects invalid WebP containers', async () => {
    await expect(validateImage(file(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x4a, 0x55, 0x4e, 0x4b]), 'image/webp', 'photo.webp'))).resolves.toContain('WebP')
  })

  it('rejects empty and oversized files', async () => {
    await expect(validateImage(file(new Uint8Array(), 'image/jpeg'))).resolves.toContain('vacío')
    await expect(validateImage(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' }))).resolves.toContain('10 MB')
  })

  it('sanitizes filenames and prevents path-like names', () => {
    expect(safeFilename('../foto peligrosa?.jpg')).toBe('_foto_peligrosa_.jpg')
    expect(safeFilename('')).toBe('image')
    expect(safeFilename('áéíóú.png')).toBe('_____ .png'.replace(' ', ''))
    expect(safeFilename('a'.repeat(300))).toHaveLength(180)
  })
})

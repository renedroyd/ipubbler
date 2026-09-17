import { describe, expect, it, vi } from 'vitest'
import { normalizeDestinationIds } from './index'

function mockEnv(rows: string[]) {
  const all = vi.fn().mockResolvedValue({ results: rows.map((id) => ({ id })) })
  const bind = vi.fn().mockReturnValue({ all })
  return { DB: { prepare: vi.fn().mockReturnValue({ bind }) } } as never
}

describe('destination ownership', () => {
  it('returns only normalized unique destination ids when all belong to the user', async () => {
    const env = mockEnv(['dest-1', 'dest-2'])
    await expect(normalizeDestinationIds(env, 'user-1', [' dest-1 ', 'dest-1', 'dest-2'])).resolves.toEqual(['dest-1', 'dest-2'])
  })

  it('rejects when at least one destination is not owned by the user', async () => {
    const env = mockEnv(['dest-1'])
    await expect(normalizeDestinationIds(env, 'user-1', ['dest-1', 'dest-2'])).rejects.toThrow('no pertenecen a tu cuenta')
  })

  it('ignores empty and non-string values', async () => {
    const env = mockEnv(['dest-1'])
    await expect(normalizeDestinationIds(env, 'user-1', ['dest-1', '', '   ', 123, null])).resolves.toEqual(['dest-1'])
  })

  it('rejects a malformed destination_ids value', async () => {
    const env = mockEnv([])
    await expect(normalizeDestinationIds(env, 'user-1', 'dest-1')).rejects.toThrow('debe ser un arreglo')
  })

  it('returns an empty list when no destination_ids are supplied', async () => {
    const env = mockEnv([])
    await expect(normalizeDestinationIds(env, 'user-1', undefined)).resolves.toEqual([])
  })
})

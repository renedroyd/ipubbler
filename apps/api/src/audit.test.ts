import { describe, expect, it, vi } from 'vitest'
import { writePublicationLog } from './audit'

function mockEnv() {
  const run = vi.fn().mockResolvedValue({ success: true })
  const bind = vi.fn().mockReturnValue({ run })
  const prepare = vi.fn().mockReturnValue({ bind })
  return { env: { DB: { prepare } } as never, prepare, bind, run }
}

describe('publication audit', () => {
  it('writes lifecycle events with generated ids and timestamps', async () => {
    const { env, prepare, bind, run } = mockEnv()
    const now = '2026-09-16T20:00:00.000Z'

    await writePublicationLog(env, 'post-1', 'scheduled', 'Publicación programada.', now)

    expect(prepare).toHaveBeenCalledWith(
      'INSERT INTO publication_logs (id,post_id,status,message,created_at) VALUES (?,?,?,?,?)',
    )
    expect(bind).toHaveBeenCalledTimes(1)
    const args = bind.mock.calls[0]
    expect(args[0]).toEqual(expect.any(String))
    expect(args.slice(1)).toEqual(['post-1', 'scheduled', 'Publicación programada.', now])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('allows a null message', async () => {
    const { env, bind } = mockEnv()
    await writePublicationLog(env, 'post-2', 'processing', undefined, '2026-09-16T20:01:00.000Z')
    expect(bind.mock.calls[0][2]).toBe('processing')
    expect(bind.mock.calls[0][3]).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { MAX_ATTEMPTS, PROCESSING_LEASE_MS, leaseExpiredBefore, nextRetryAt, retryDelaySeconds } from './scheduler'

describe('scheduler policy', () => {
  it('expires processing leases after ten minutes', () => {
    const now = new Date('2026-09-16T20:00:00.000Z')
    expect(PROCESSING_LEASE_MS).toBe(10 * 60 * 1000)
    expect(leaseExpiredBefore(now)).toBe('2026-09-16T19:50:00.000Z')
  })

  it('uses exponential retry delays capped at one hour', () => {
    expect(retryDelaySeconds(1)).toBe(120)
    expect(retryDelaySeconds(2)).toBe(240)
    expect(retryDelaySeconds(5)).toBe(1920)
    expect(retryDelaySeconds(10)).toBe(3600)
    expect(retryDelaySeconds(20)).toBe(3600)
  })

  it('calculates the next retry from the supplied clock', () => {
    const now = new Date('2026-09-16T20:00:00.000Z')
    expect(nextRetryAt(now, 1)).toBe('2026-09-16T20:02:00.000Z')
  })

  it('keeps the terminal attempt threshold explicit', () => {
    expect(MAX_ATTEMPTS).toBe(5)
  })
})

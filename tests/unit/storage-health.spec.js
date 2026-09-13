import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  estimateStorage,
  isQuotaError,
  quotaWarningLevel,
  requestPersistentStorage,
  shouldWarnQuotaNow,
} from '@/db/storage-health'

// Pose un faux navigator.storage le temps d'un test.
function stubStorage(obj) {
  Object.defineProperty(globalThis.navigator, 'storage', { value: obj, configurable: true })
}
afterEach(() => {
  // retire le stub pour ne pas fuiter entre tests
  Object.defineProperty(globalThis.navigator, 'storage', { value: undefined, configurable: true })
})

describe('isQuotaError', () => {
  it('reconnaît QuotaExceededError par nom', () => {
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true)
  })
  it('reconnaît le code DOMException 22', () => {
    expect(isQuotaError({ code: 22 })).toBe(true)
  })
  it('reconnaît un quota emballé par Dexie (inner)', () => {
    expect(isQuotaError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(true)
  })
  it('ignore les autres erreurs et null', () => {
    expect(isQuotaError({ name: 'AbortError' })).toBe(false)
    expect(isQuotaError(null)).toBe(false)
  })
})

describe('requestPersistentStorage', () => {
  it('renvoie persisted quand supporté', async () => {
    stubStorage({ persist: vi.fn().mockResolvedValue(true) })
    expect(await requestPersistentStorage()).toEqual({ supported: true, persisted: true })
  })
  it('dégrade proprement quand non supporté', async () => {
    stubStorage({})
    expect(await requestPersistentStorage()).toEqual({ supported: false, persisted: false })
  })
})

describe('estimateStorage', () => {
  it('calcule le ratio', async () => {
    stubStorage({ estimate: vi.fn().mockResolvedValue({ usage: 50, quota: 100 }) })
    expect(await estimateStorage()).toEqual({ supported: true, usage: 50, quota: 100, ratio: 0.5 })
  })
  it('ratio null si quota inconnu', async () => {
    stubStorage({ estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 0 }) })
    expect((await estimateStorage()).ratio).toBe(null)
  })
  it('reste supported si estimate() rejette (API présente mais en échec)', async () => {
    stubStorage({ estimate: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await estimateStorage()).toEqual({ supported: true, usage: 0, quota: 0, ratio: null })
  })
})

describe('quotaWarningLevel', () => {
  it('near à partir de 90 %', () => {
    expect(quotaWarningLevel(0.9)).toBe('near')
    expect(quotaWarningLevel(0.95)).toBe('near')
  })
  it('none en dessous et sur inconnu', () => {
    expect(quotaWarningLevel(0.5)).toBe('none')
    expect(quotaWarningLevel(null)).toBe('none')
  })
})

describe('shouldWarnQuotaNow', () => {
  const now = Date.parse('2026-07-02T12:00:00.000Z')

  it('alerte si jamais alertée (falsy)', () => {
    expect(shouldWarnQuotaNow(null, now)).toBe(true)
    expect(shouldWarnQuotaNow(undefined, now)).toBe(true)
    expect(shouldWarnQuotaNow('', now)).toBe(true)
  })
  it("n'alerte pas si la dernière alerte date de moins de 24h", () => {
    const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString()
    expect(shouldWarnQuotaNow(oneHourAgo, now)).toBe(false)
  })
  it('alerte de nouveau si la dernière alerte date de plus de 24h', () => {
    const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString()
    expect(shouldWarnQuotaNow(twentyFiveHoursAgo, now)).toBe(true)
  })
})

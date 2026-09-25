// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { maybeWarnQuota } from '@/db/storage-health'

describe('maybeWarnQuota', () => {
  it('appelle warn quand le stockage est presque plein', () => {
    const warn = vi.fn()
    maybeWarnQuota({ ratio: 0.92 }, warn)
    expect(warn).toHaveBeenCalledTimes(1)
  })
  it("n'alerte pas quand il reste de la place", () => {
    const warn = vi.fn()
    maybeWarnQuota({ ratio: 0.4 }, warn)
    expect(warn).not.toHaveBeenCalled()
  })
  it("n'alerte pas quand le ratio est inconnu", () => {
    const warn = vi.fn()
    maybeWarnQuota({ ratio: null }, warn)
    expect(warn).not.toHaveBeenCalled()
  })
})

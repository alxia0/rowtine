import { describe, it, expect } from 'vitest'
import { matchesUsageState } from '@/utils/yarn-filter'

describe('matchesUsageState', () => {
  it('filtre vide (\'\') : tout matche, quel que soit l’état', () => {
    expect(matchesUsageState('free', '')).toBe(true)
    expect(matchesUsageState('reserved', '')).toBe(true)
    expect(matchesUsageState('used', '')).toBe(true)
    expect(matchesUsageState('usedPartial', '')).toBe(true)
  })

  it('filtre posé : ne matche que l’état exact', () => {
    expect(matchesUsageState('free', 'free')).toBe(true)
    expect(matchesUsageState('reserved', 'free')).toBe(false)
    expect(matchesUsageState('reserved', 'reserved')).toBe(true)
    expect(matchesUsageState('usedPartial', 'used')).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { emptyPattern } from '@/stores/patterns'

describe('emptyPattern', () => {
  it('expose pdf (string vide) et gallery (tableau vide)', () => {
    const p = emptyPattern()
    expect(p.pdf).toBe('')
    expect(p.gallery).toEqual([])
  })

  it('emptyPattern porte les trois champs de prix, vides', () => {
    const p = emptyPattern()
    expect(p.price).toBe('')
    expect(p.priceCurrency).toBe('')
    expect(p.purchasedAt).toBe('')
  })
})

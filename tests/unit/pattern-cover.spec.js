import { describe, it, expect } from 'vitest'
import { patternCoverOf, patternCoverIndexOf } from '@/utils/pattern-cover'

describe('patternCoverOf', () => {
  it('renvoie pattern.photos[0] quand il existe (couverture PDF importée)', () => {
    expect(patternCoverOf({ photos: ['a', 'b'], gallery: [{ src: 'g1' }] })).toBe('a')
  })

  it('repli sur pattern.gallery[0].src si photos est vide (patron créé manuellement)', () => {
    expect(patternCoverOf({ photos: [], gallery: [{ src: 'g1', page: 0, w: 0, h: 0 }] })).toBe('g1')
  })

  it('aucune image nulle part : chaîne vide, jamais d’exception', () => {
    expect(patternCoverOf({ photos: [], gallery: [] })).toBe('')
    expect(patternCoverOf({})).toBe('')
    expect(patternCoverOf(null)).toBe('')
    expect(patternCoverOf(undefined)).toBe('')
  })

  it('photos gagne toujours sur gallery quand les deux sont peuplés', () => {
    expect(patternCoverOf({ photos: ['cover.jpg'], gallery: [{ src: 'g1' }] })).toBe('cover.jpg')
  })

  it('utilise gallery[coverIndex] quand il est défini et dans les bornes', () => {
    expect(
      patternCoverOf({ photos: [], gallery: [{ src: 'g0' }, { src: 'g1' }, { src: 'g2' }], coverIndex: 1 })
    ).toBe('g1')
  })
  it('repli sur gallery[0] si coverIndex est hors bornes', () => {
    expect(
      patternCoverOf({ photos: [], gallery: [{ src: 'g0' }, { src: 'g1' }], coverIndex: 5 })
    ).toBe('g0')
  })
  it('photos[0] gagne toujours même si coverIndex pointe sur une autre image de gallery', () => {
    expect(
      patternCoverOf({ photos: ['cover.jpg'], gallery: [{ src: 'g0' }, { src: 'g1' }], coverIndex: 1 })
    ).toBe('cover.jpg')
  })
})

describe('patternCoverIndexOf', () => {
  it('renvoie coverIndex tel quel quand il est dans les bornes', () => {
    expect(patternCoverIndexOf({ gallery: [{ src: 'g0' }, { src: 'g1' }, { src: 'g2' }], coverIndex: 2 })).toBe(2)
  })

  it('repli sur 0 si coverIndex est absent, NaN ou hors bornes', () => {
    expect(patternCoverIndexOf({ gallery: [{ src: 'g0' }, { src: 'g1' }] })).toBe(0)
    expect(patternCoverIndexOf({ gallery: [{ src: 'g0' }, { src: 'g1' }], coverIndex: NaN })).toBe(0)
    expect(patternCoverIndexOf({ gallery: [{ src: 'g0' }, { src: 'g1' }], coverIndex: 5 })).toBe(0)
    expect(patternCoverIndexOf({ gallery: [{ src: 'g0' }, { src: 'g1' }], coverIndex: -1 })).toBe(0)
  })

  it('gallery vide : toujours 0', () => {
    expect(patternCoverIndexOf({ gallery: [], coverIndex: 3 })).toBe(0)
    expect(patternCoverIndexOf({})).toBe(0)
    expect(patternCoverIndexOf(null)).toBe(0)
  })
})

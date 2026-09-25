import { describe, it, expect } from 'vitest'
import { resolveCover } from '@/utils/project-cover'

describe('resolveCover — couverture d\'un projet', () => {
  it('coverIndex pointe la bonne photo du projet', () => {
    const project = { photos: ['a', 'b', 'c'], coverIndex: 2 }
    expect(resolveCover(project, null)).toBe('c')
  })

  it('coverIndex hors bornes → repli sur photos[0]', () => {
    const project = { photos: ['a', 'b'], coverIndex: 5 }
    expect(resolveCover(project, null)).toBe('a')
  })

  it('coverIndex absent → défaut 0 (1re photo)', () => {
    const project = { photos: ['a', 'b'] }
    expect(resolveCover(project, null)).toBe('a')
  })

  it('pas de photos projet → 1re photo du patron', () => {
    const project = { photos: [], coverIndex: 0 }
    const pattern = { photos: ['p1', 'p2'] }
    expect(resolveCover(project, pattern)).toBe('p1')
  })

  it('ni photos projet ni photos patron → chaîne vide', () => {
    expect(resolveCover({ photos: [] }, { photos: [] })).toBe('')
    expect(resolveCover({ photos: [] }, null)).toBe('')
  })

  it('tolère un projet null', () => {
    expect(resolveCover(null, { photos: ['p1'] })).toBe('p1')
    expect(resolveCover(null, null)).toBe('')
  })

  it('tolère un patron null/undefined', () => {
    const project = { photos: ['a'], coverIndex: 0 }
    expect(resolveCover(project, null)).toBe('a')
    expect(resolveCover(project, undefined)).toBe('a')
  })

  it('tolère un projet sans tableau photos', () => {
    expect(resolveCover({}, { photos: ['p1'] })).toBe('p1')
  })

  it('repli sur la 1re image de la galerie du patron quand ni le projet ni le patron n\'ont de photo (patron créé manuellement)', () => {
    expect(resolveCover({ photos: [] }, { photos: [], gallery: [{ src: 'g1', page: 0, w: 0, h: 0 }] })).toBe('g1')
  })
})

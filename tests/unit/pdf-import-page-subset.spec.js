import { describe, it, expect } from 'vitest'
import { normalizePageSelection, togglePage, toSubsetPages, toRealPages } from '../../src/utils/pdf-import/page-subset'

describe('page-subset', () => {
  // Protège : une sélection désordonnée ou sale arrive au moteur triée et sans doublon.
  it('normalizePageSelection trie, dédoublonne et écarte ce qui n\'est pas une page', () => {
    expect(normalizePageSelection([7, 2, 2, 0, -1, 3.5, '4', 5])).toEqual([2, 5, 7])
    expect(normalizePageSelection(undefined)).toEqual([])
    expect(normalizePageSelection(null)).toEqual([])
  })

  // Protège : l'ordre des clics n'est jamais l'ordre d'import.
  it('togglePage ajoute en gardant le tri, puis retire', () => {
    const a = togglePage([], 7)
    const b = togglePage(a, 2)
    expect(b).toEqual([2, 7])
    expect(togglePage(b, 7)).toEqual([2])
    expect(a).toEqual([7]) // pas de mutation
  })

  // Protège : le cœur pur voit des pages 1..k, et rien d'une page non choisie.
  it('toSubsetPages convertit en positions et écarte les pages non choisies', () => {
    const items = [{ page: 7, src: 'a' }, { page: 3, src: 'b' }, { page: 2, src: 'c' }]
    expect(toSubsetPages(items, [2, 7])).toEqual([{ page: 2, src: 'a' }, { page: 1, src: 'c' }])
    expect(toSubsetPages(items, [])).toBe(items)
  })

  // Protège : la galerie reprend les numéros réels du PDF complet enregistré.
  it('toRealPages remet les numéros réels et laisse la page 0', () => {
    const items = [{ page: 2, src: 'a' }, { page: 0, src: 'b' }, { page: 1, src: 'c' }]
    expect(toRealPages(items, [4, 9])).toEqual([{ page: 9, src: 'a' }, { page: 0, src: 'b' }, { page: 4, src: 'c' }])
    expect(toRealPages(items, [])).toBe(items)
  })
})

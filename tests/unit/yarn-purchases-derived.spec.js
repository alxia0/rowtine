// tests/unit/yarn-purchases-derived.spec.js
// Unitaire — dérivés du registre d'achats consommés par la fiche détail, le tri du
// stock et l'export CSV (les travaux sur le budget) : `bain` et `purchasedAt` ont quitté le
// formulaire de saisie auparavant, ces trois endroits lisaient jusqu'ici
// deux champs de la fiche de laine, ils lisent désormais les lignes d'achat. Règle du
// projet : jamais perdre d'info — les nombres et dates du jeu d'essai sont TOUS
// distincts, pour qu'une assertion fausse ait une chance de rougir.
import { describe, it, expect } from 'vitest'
import { emptyPurchase, latestPurchaseDate, bainsOf } from '@/utils/purchases'

const line = (over = {}) => ({ ...emptyPurchase(), ...over })

describe('latestPurchaseDate()', () => {
  it('renvoie la date la plus récente parmi des lignes non triées, une ligne sans date parmi elles', () => {
    const lines = [line({ date: '2026-01-10' }), line({ date: '' }), line({ date: '2026-05-04' })]
    expect(latestPurchaseDate(lines)).toBe('2026-05-04')
  })

  it('chaîne vide quand aucune ligne n’a de date', () => {
    const lines = [line({ date: '' }), line({ date: '' })]
    expect(latestPurchaseDate(lines)).toBe('')
  })

  it('chaîne vide sur un tableau vide, jamais undefined', () => {
    expect(latestPurchaseDate([])).toBe('')
    expect(latestPurchaseDate(undefined)).toBe('')
  })
})

describe('bainsOf()', () => {
  it('dédoublonne et joint les bains non vides, dans l’ordre d’apparition', () => {
    const lines = [line({ bain: 'A12' }), line({ bain: '' }), line({ bain: 'A12' }), line({ bain: 'B03' })]
    expect(bainsOf(lines)).toBe('A12 · B03')
  })

  it('chaîne vide quand aucune ligne n’a de bain', () => {
    expect(bainsOf([line({ bain: '' }), line({ bain: '' })])).toBe('')
  })

  it('chaîne vide sur un tableau vide, jamais undefined', () => {
    expect(bainsOf([])).toBe('')
    expect(bainsOf(undefined)).toBe('')
  })
})

// @vitest-environment jsdom
// Répartition en pourcentage par matière, sibling de `composition` (string[], inchangé).
// AUCUNE source réelle ne l'alimente pour l'instant (l'export stash Ravelry n'a pas de
// colonne fibre/composition) : champ réservé à une saisie manuelle future.
import { describe, it, expect } from 'vitest'
import { normalizeCompositionPercents } from '@/constants/compositions'
import { emptyYarn } from '@/stores/yarns'

describe('normalizeCompositionPercents', () => {
  it('null/undefined/valeur non objet → objet vide', () => {
    expect(normalizeCompositionPercents(null)).toEqual({})
    expect(normalizeCompositionPercents(undefined)).toEqual({})
    expect(normalizeCompositionPercents('laine')).toEqual({})
  })

  it('garde les entrées valides, écarte clé vide et valeur non numérique', () => {
    expect(normalizeCompositionPercents({ laine: 80, nylon: '20', '': 5, mohair: 'abc' })).toEqual({
      laine: 80,
      nylon: 20,
    })
  })

  it('emptyYarn() a une répartition de composition vide par défaut', () => {
    expect(emptyYarn().compositionPercents).toEqual({})
  })
})

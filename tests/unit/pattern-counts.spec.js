import { describe, it, expect } from 'vitest'
import { countByCategory } from '@/utils/pattern-counts'
import { PATTERN_CATEGORIES } from '@/constants/catalog'

describe('countByCategory', () => {
  it('renvoie toutes les catégories à 0 pour une liste vide', () => {
    const { total, byCategory } = countByCategory([])
    expect(total).toBe(0)
    // Aucune clé ne doit manquer : une pastille sans entrée afficherait « (undefined) ».
    for (const c of PATTERN_CATEGORIES) expect(byCategory[c]).toBe(0)
  })

  it('tolère une entrée absente ou invalide', () => {
    expect(countByCategory(undefined).total).toBe(0)
    expect(countByCategory(null).total).toBe(0)
  })

  it('compte les patrons par catégorie', () => {
    const { total, byCategory } = countByCategory([
      { category: 'clothing' },
      { category: 'clothing' },
      { category: 'socks' },
    ])
    expect(total).toBe(3)
    expect(byCategory.clothing).toBe(2)
    expect(byCategory.socks).toBe(1)
    expect(byCategory.home).toBe(0)
  })

  it('compte « other » quel que soit le libellé libre saisi', () => {
    const { byCategory } = countByCategory([
      { category: 'other', categoryCustom: 'Chouchous' },
      { category: 'other' },
    ])
    expect(byCategory.other).toBe(2)
  })

  it('compte dans le total un patron sans catégorie, mais dans aucune pastille', () => {
    // Comportement VOULU, pas un défaut : un patron importé sans catégorie renseignée
    // reste visible sous « Tous ». La somme des pastilles est alors < total.
    const { total, byCategory } = countByCategory([
      { category: 'clothing' },
      { category: '' },
      {},
      { category: 'categorie-inconnue' },
    ])
    expect(total).toBe(4)
    const sum = PATTERN_CATEGORIES.reduce((a, c) => a + byCategory[c], 0)
    expect(sum).toBe(1)
    expect(sum).toBeLessThan(total)
  })

  it('n’ajoute aucune clé parasite pour une catégorie hors catalogue', () => {
    // CORRIGÉ pendant l'exécution (25/07) : la première rédaction de ce test n'assertait
    // que « les 9 catégories restent à 0 », ce qui reste vrai même sans le garde
    // d'appartenance — la mutation 2 y survivait, donc le test ne testait rien.
    // On vérifie maintenant la liste EXACTE des clés : sans le garde, `constructor`,
    // `toString` et `inconnue` apparaîtraient comme pastilles fantômes.
    const { byCategory } = countByCategory([
      { category: 'constructor' },
      { category: 'toString' },
      { category: 'inconnue' },
    ])
    expect(Object.keys(byCategory)).toEqual([...PATTERN_CATEGORIES])
    for (const c of PATTERN_CATEGORIES) expect(byCategory[c]).toBe(0)
    // Second garde-fou : sans le contrôle d'appartenance, `byCategory.inconnue` vaudrait
    // NaN (une clé parasite acceptée), pas `undefined`. La boucle ci-dessus sur les 9
    // catégories du catalogue resterait verte même dans ce cas — c'est CETTE assertion
    // qui tombe si le garde est retiré.
    expect(byCategory.inconnue).toBeUndefined()
  })
})

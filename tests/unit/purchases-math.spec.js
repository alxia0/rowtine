// tests/unit/purchases-math.spec.js
// Unitaire — arithmétique du budget. Les montants attendus sont ÉCRITS À LA MAIN
// (jamais recalculés par la formule du code) : c'est la seule façon qu'un test de
// calcul échoue quand le calcul est faux.
import { describe, it, expect } from 'vitest'
import {
  emptyPurchase, lineAmount, totalsByCurrency, totalSkeins,
  acquiredFromStock, acquiredFromLines, stockGap, isPriceUnknown,
  latestPurchaseDate, bainsOf,
} from '@/utils/purchases'

const buy = (over = {}) => ({ ...emptyPurchase(), kind: 'buy', currency: 'EUR', ...over })

describe('emptyPurchase()', () => {
  // Pinne la forme complète, champ par champ : yarnId/yarnLabel/date/bain/reconstructed
  // ne sont lus par AUCUN autre test de ce fichier (seuls kind/currency/quantity/unitPrice
  // le sont, via buy()) — sans ce test, un champ consommé verbatim par le store, la reprise
  // ou le formulaire (tâches suivantes) pourrait disparaître sans faire rougir la suite.
  it('valeurs par défaut de chaque champ', () => {
    expect(emptyPurchase()).toEqual({
      yarnId: null,
      yarnLabel: '',
      kind: 'buy',
      quantity: 1,
      unitPrice: '',
      currency: '',
      date: '',
      bain: '',
      purchasedFrom: '',
      reconstructed: false,
      category: 'yarn',
    })
  })
})

describe('montant d’une ligne', () => {
  it('achat : quantité × prix, virgule française acceptée', () => {
    expect(lineAmount(buy({ quantity: 4, unitPrice: '5,50' }))).toBe(22)
  })
  it('quantité saisie à la virgule : comptée, pas zéro', () => {
    expect(lineAmount(buy({ quantity: '1,5', unitPrice: '8,00' }))).toBe(12)
    expect(totalSkeins([buy({ quantity: '1,5' }), buy({ quantity: 2 })])).toBe(3.5)
  })
  it('cadeau : zéro même si un prix traîne dans la donnée', () => {
    expect(lineAmount(buy({ kind: 'gift', quantity: 3, unitPrice: '9,90' }))).toBe(0)
  })
  it('achat sans prix : zéro, et signalé comme prix inconnu (pas comme cadeau)', () => {
    const l = buy({ quantity: 2, unitPrice: '' })
    expect(lineAmount(l)).toBe(0)
    expect(isPriceUnknown(l)).toBe(true)
    expect(isPriceUnknown(buy({ kind: 'gift', quantity: 2, unitPrice: '' }))).toBe(false)
  })
  it('achat avec prix renseigné : jamais signalé comme prix inconnu', () => {
    expect(isPriceUnknown(buy({ quantity: 2, unitPrice: '5,50' }))).toBe(false)
  })
})

describe('totaux', () => {
  // 4 × 5,50 = 22,00 · 2 × 12,00 = 24,00 · cadeau = 0 · prix inconnu = 0  ⇒ 46,00 €
  // Pelotes : 4 + 2 + 3 + 2 = 11
  const lines = [
    buy({ quantity: 4, unitPrice: '5,50' }),
    buy({ quantity: 2, unitPrice: '12' }),
    buy({ kind: 'gift', quantity: 3 }),
    buy({ quantity: 2, unitPrice: '' }),
  ]
  it('un total par devise', () => {
    expect(totalsByCurrency(lines)).toEqual({ EUR: 46 })
  })
  it('les pelotes comptent, cadeaux compris', () => {
    expect(totalSkeins(lines)).toBe(11)
  })
  it('deux devises ne s’additionnent jamais', () => {
    const mixed = [...lines, buy({ quantity: 1, unitPrice: '30', currency: 'CHF' })]
    expect(totalsByCurrency(mixed)).toEqual({ EUR: 46, CHF: 30 })
  })
  it('aucune ligne : objet vide, pas zéro inventé', () => {
    expect(totalsByCurrency([])).toEqual({})
  })
})

describe('écart stock / historique', () => {
  // 3 pelotes restantes + 2 déjà tricotées = 5 acquises d’après le stock
  const yarn = { quantity: 3, consumed: { 7: 2 } }
  it('ce que le stock sous-entend avoir été acquis', () => {
    expect(acquiredFromStock(yarn)).toBe(5)
  })
  it('ce que l’historique enregistre, cadeaux compris', () => {
    expect(acquiredFromLines([buy({ quantity: 2 }), buy({ kind: 'gift', quantity: 1 })])).toBe(3)
  })
  it('écart positif quand le stock dépasse l’historique', () => {
    expect(stockGap(yarn, [buy({ quantity: 2 })])).toBe(3)
  })
  it('un cadeau comble l’écart', () => {
    expect(stockGap(yarn, [buy({ quantity: 2 }), buy({ kind: 'gift', quantity: 3 })])).toBe(0)
  })
  it('écart négatif quand l’historique dépasse le stock', () => {
    expect(stockGap(yarn, [buy({ quantity: 9 })])).toBe(-4)
  })
  it('laine sans trace de consommation', () => {
    expect(acquiredFromStock({ quantity: 6 })).toBe(6)
  })
})

// ─── Catégories de dépense (lot « prix du patron », 07/08) ──────────────────
import { categoryOf, filterByCategory, totalsByCategory, groupByPeriod } from '@/utils/purchases'

describe('categoryOf — l’absence VAUT « laine »', () => {
  it('C1. une ligne d’achat écrite avant ce lot n’a pas de `category` ⇒ « yarn »', () => {
    expect(categoryOf({ yarnId: 3, quantity: 2 })).toBe('yarn')
  })

  it('C2. une catégorie explicite est respectée', () => {
    expect(categoryOf({ category: 'pattern' })).toBe('pattern')
    expect(categoryOf({ category: 'yarn' })).toBe('yarn')
  })

  it('C3. null / undefined ⇒ « yarn », jamais une exception', () => {
    expect(categoryOf(null)).toBe('yarn')
    expect(categoryOf(undefined)).toBe('yarn')
  })
})

describe('filterByCategory', () => {
  const lines = [
    { id: 1, quantity: 3, unitPrice: '7', currency: 'EUR', kind: 'buy' }, // 21 — sans category
    { id: 2, category: 'yarn', quantity: 2, unitPrice: '6', currency: 'EUR', kind: 'buy' }, // 12
    { id: 'pat:9', category: 'pattern', quantity: 1, unitPrice: '18', currency: 'EUR', kind: 'buy' }, // 18
  ]

  it('C4. « all » (ou une valeur absente) ne filtre rien', () => {
    expect(filterByCategory(lines, 'all')).toHaveLength(3)
    expect(filterByCategory(lines, '')).toHaveLength(3)
    expect(filterByCategory(lines, undefined)).toHaveLength(3)
  })

  it('C5. « yarn » garde AUSSI les lignes sans catégorie', () => {
    expect(filterByCategory(lines, 'yarn').map((l) => l.id)).toEqual([1, 2])
  })

  it('C6. « pattern » ne garde que les patrons', () => {
    expect(filterByCategory(lines, 'pattern').map((l) => l.id)).toEqual(['pat:9'])
  })

  it('C7. liste absente ⇒ tableau vide', () => {
    expect(filterByCategory(null, 'yarn')).toEqual([])
  })
})

describe('totalsByCategory', () => {
  it('C8. ventile par catégorie PUIS par devise, sans jamais additionner deux devises', () => {
    const totals = totalsByCategory([
      { quantity: 3, unitPrice: '7', currency: 'EUR', kind: 'buy' }, // 21 laine (sans category)
      { category: 'yarn', quantity: 2, unitPrice: '6', currency: 'GBP', kind: 'buy' }, // 12 laine £
      { category: 'pattern', quantity: 1, unitPrice: '18', currency: 'EUR', kind: 'buy' }, // 18 patron
    ])
    expect(totals).toEqual({ yarn: { EUR: 21, GBP: 12 }, pattern: { EUR: 18 } })
  })

  it('C9. les deux clés existent TOUJOURS, même vides — l’appelant n’a pas à se garder', () => {
    expect(totalsByCategory([])).toEqual({ yarn: {}, pattern: {} })
  })

  it('C10. un patron GRATUIT (montant 0) ne crée aucune devise fantôme', () => {
    const totals = totalsByCategory([
      { category: 'pattern', quantity: 1, unitPrice: '0', currency: 'EUR', kind: 'buy' },
    ])
    expect(totals).toEqual({ yarn: {}, pattern: {} })
  })
})

describe('groupByPeriod — identifiants mixtes (nombres et chaînes)', () => {
  it('C11. deux lignes de MÊME date, l’une numérotée l’autre « pat:* » ⇒ ordre déterministe, aucun NaN', () => {
    const lines = [
      { id: 'pat:9', category: 'pattern', quantity: 1, unitPrice: '18', currency: 'EUR', kind: 'buy', date: '2026-03-12' },
      { id: 4, quantity: 3, unitPrice: '7', currency: 'EUR', kind: 'buy', date: '2026-03-12' }, // 21
      { id: 2, quantity: 2, unitPrice: '6', currency: 'EUR', kind: 'buy', date: '2026-03-12' }, // 12
    ]
    const [group] = groupByPeriod(lines)
    // Les deux lignes numérotées se départagent par id DÉCROISSANT (4 puis 2, convention
    // historique) ; la ligne de patron, de rang 0, passe en dernier. Lancer DEUX fois pour
    // prouver que l'ordre ne bouge pas (le tri de JavaScript est stable depuis ES2019).
    expect(group.months[0].lines.map((l) => l.id)).toEqual([4, 2, 'pat:9'])
    expect(groupByPeriod(lines)[0].months[0].lines.map((l) => l.id)).toEqual([4, 2, 'pat:9'])
    expect(group.total).toEqual({ EUR: 51 })
  })
})

// Dérivés du registre d'achats lus par la fiche détail, le tri du stock et l'export CSV :
// `bain` et `purchasedAt` ont quitté la fiche de laine pour les lignes d'achat. Les nombres
// et dates du jeu d'essai sont TOUS distincts, pour qu'une assertion fausse ait une chance
// de rougir.
describe('dérivés du registre d’achats', () => {
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
})

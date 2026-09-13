// tests/unit/pattern-price.spec.js
// Module PUR des dépenses de patron (lot « prix du patron », 07/08). Aucune base, aucun
// magasin : ces fonctions ne connaissent que des objets simples.
//
// Trois natures de patron cohabitent dans la table `patterns` et UNE SEULE porte un prix :
//  - patron de bibliothèque (`!builtin && ownerProjectId == null`) -> porte le prix
//  - « Patron libre » (`builtin`)      -> gabarit UNIQUE PARTAGÉ par tous les projets sans
//                                          patron : un prix dessus serait recompté autant de
//                                          fois qu'il y a de tels projets
//  - copie de travail (`ownerProjectId`) -> duplicata d'un patron déjà compté
//
// Valeurs volontairement TOUTES DISTINCTES (ids 11/12/13, prix 8,50 / 19 / 0) : un jeu d'essai
// où deux nombres coïncident laisse passer une assertion pour la mauvaise raison.
import { describe, it, expect } from 'vitest'
import { priceOwnerId, isPricedPattern, patternExpenseLine, patternExpenseLines } from '@/utils/pattern-price'

const biblio = (over = {}) => ({ id: 11, name: 'Sabai', price: '8,50', priceCurrency: 'EUR', purchasedAt: '2026-03-12', ...over })

describe('priceOwnerId — qui PORTE le prix', () => {
  it('1. un patron de bibliothèque le porte lui-même', () => {
    expect(priceOwnerId(biblio())).toBe(11)
  })

  it('2. une copie de travail renvoie vers son patron d’origine', () => {
    expect(priceOwnerId({ id: 12, ownerProjectId: 5, sourcePatternId: 11 })).toBe(11)
  })

  it('3. une copie de copie remonte à la bibliothèque, pas à la copie intermédiaire', () => {
    expect(priceOwnerId({ id: 13, ownerProjectId: 6, sourcePatternId: 11 })).toBe(11)
  })

  it('5. le « Patron libre » builtin n’a pas de porteur : il est partagé', () => {
    expect(priceOwnerId({ id: 1, builtin: true })).toBeNull()
  })

  it('6. null / undefined ne lèvent pas', () => {
    expect(priceOwnerId(null)).toBeNull()
    expect(priceOwnerId(undefined)).toBeNull()
  })
})

describe('isPricedPattern — y a-t-il une dépense à afficher ?', () => {
  it('7. prix renseigné sur un patron de bibliothèque ⇒ oui', () => {
    expect(isPricedPattern(biblio())).toBe(true)
  })

  it('8. prix VIDE ⇒ non (rien n’a été noté)', () => {
    expect(isPricedPattern(biblio({ price: '' }))).toBe(false)
    expect(isPricedPattern(biblio({ price: '   ' }))).toBe(false)
    expect(isPricedPattern(biblio({ price: undefined }))).toBe(false)
  })

  it('9. prix « 0 » ⇒ OUI : une dépense à zéro est une dépense DÉCLARÉE, pas une absence', () => {
    expect(isPricedPattern(biblio({ price: '0' }))).toBe(true)
  })

  it('10. un builtin, même avec un prix, ne compte jamais', () => {
    expect(isPricedPattern(biblio({ builtin: true }))).toBe(false)
  })

  it('11. une copie de travail, même avec un prix, ne compte jamais (déjà compté sur l’original)', () => {
    expect(isPricedPattern(biblio({ ownerProjectId: 5, sourcePatternId: 11 }))).toBe(false)
  })
})

describe('patternExpenseLine — la forme de la ligne', () => {
  it('12. identifiant préfixé, catégorie, quantité 1, libellé = nom du patron', () => {
    expect(patternExpenseLine(biblio())).toEqual({
      id: 'pat:11',
      category: 'pattern',
      patternId: 11,
      label: 'Sabai',
      kind: 'buy',
      quantity: 1,
      unitPrice: '8,50',
      currency: 'EUR',
      date: '2026-03-12',
    })
  })

  it('13. la ligne ne porte NI yarnId NI yarnLabel — ces deux noms disent « laine »', () => {
    const line = patternExpenseLine(biblio())
    expect('yarnId' in line).toBe(false)
    expect('yarnLabel' in line).toBe(false)
  })

  it('14. devise et date absentes ⇒ chaînes vides, jamais undefined (directement affichables)', () => {
    const line = patternExpenseLine({ id: 12, name: 'Twist', price: '19' })
    expect(line.currency).toBe('')
    expect(line.date).toBe('')
  })
})

describe('patternExpenseLines — le balayage d’une bibliothèque', () => {
  it('15. ne garde que les patrons payants, dans l’ordre d’entrée', () => {
    const lines = patternExpenseLines([
      biblio({ id: 11, name: 'Sabai', price: '8,50' }),
      biblio({ id: 12, name: 'Sans prix', price: '' }),
      { id: 1, name: 'Patron libre', builtin: true, price: '19' },
      { id: 13, name: 'Copie', ownerProjectId: 5, sourcePatternId: 11, price: '19' },
      biblio({ id: 14, name: 'Twist', price: '0' }),
    ])
    expect(lines.map((l) => l.id)).toEqual(['pat:11', 'pat:14'])
  })

  it('16. liste vide / absente ⇒ tableau vide, jamais une exception', () => {
    expect(patternExpenseLines([])).toEqual([])
    expect(patternExpenseLines(null)).toEqual([])
    expect(patternExpenseLines(undefined)).toEqual([])
  })
})

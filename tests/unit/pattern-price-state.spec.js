// L'état du prix d'un patron — trois cas et rien d'autre : un montant, un « gratuit »
// DÉCLARÉ, ou rien de noté. Extrait du computed de la fiche projet (lot 08/08) pour que la
// fiche patron dise exactement la même chose : deux copies auraient divergé au premier
// changement de règle.
import { describe, it, expect } from 'vitest'
import { patternPriceState } from '@/utils/pattern-price'

describe('patternPriceState', () => {
  it('1. un montant ⇒ kind « amount », avec la devise DU PATRON', () => {
    expect(patternPriceState({ price: '18,90', priceCurrency: 'CHF' })).toEqual({
      kind: 'amount', amount: 18.9, currency: 'CHF',
    })
  })

  it('2. « 0 » ⇒ kind « free » : un prix DÉCLARÉ, pas un prix manquant', () => {
    // Mutation qui doit faire rougir ce test : traiter '0' comme une chaîne vide (par
    // exemple `if (!parseDecimal(raw)) return { kind: 'none' }`). C'est l'arbitrage du lot
    // du 07/08 : « j'ai vérifié, c'était gratuit » n'est pas « je n'ai rien noté ».
    expect(patternPriceState({ price: '0', priceCurrency: 'EUR' })).toEqual({ kind: 'free' })
  })

  it('3. rien de noté ⇒ kind « none » (vide, espaces, champ absent, patron absent)', () => {
    for (const p of [{ price: '' }, { price: '   ' }, {}, null, undefined]) {
      expect(patternPriceState(p)).toEqual({ kind: 'none' })
    }
  })

  it('4. devise absente ⇒ chaîne vide, jamais undefined', () => {
    expect(patternPriceState({ price: '5' })).toEqual({ kind: 'amount', amount: 5, currency: '' })
  })

  it('5. une saisie illisible ⇒ kind « unknown », jamais « gratuit »', () => {
    // Ce test figeait l'inverse jusqu'au 15/11 (« environ 5 » ⇒ gratuit, comportement hérité).
    // L'écran Dépenses dit « Prix inconnu » pour la même donnée depuis la phase 2 des outils :
    // la fiche patron et la fiche projet suivent, avec la même règle (`isReadableDecimal`).
    for (const price of ['environ 5', '18,90 €', 'abc']) {
      expect(patternPriceState({ price, priceCurrency: 'EUR' })).toEqual({ kind: 'unknown' })
    }
  })
})

import { describe, it, expect } from 'vitest'
import { formatLength, formatWeight, formatSkeins } from '@/utils/units'

// En français, Intl sépare les milliers par U+202F (espace insécable étroite), PAS par une
// espace ordinaire. On extrait le vrai séparateur du formateur plutôt que de le taper : une
// espace tapée au clavier ferait échouer le test pour une mauvaise raison.
const FR_GROUP = new Intl.NumberFormat('fr').format(1000).replace(/\d/g, '')

describe('formatLength', () => {
  // Protège : le cumul d'une carte de laine reste en mètres, jamais en km (décision du 29/09).
  it('profil lot : jamais de bascule en km, séparateur de milliers', () => {
    expect(formatLength(3500, { locale: 'fr', profile: 'lot' })).toEqual({ text: `3${FR_GROUP}500`, unitKey: 'yarn.unit.m' })
    expect(formatLength(999.5, { locale: 'fr', profile: 'lot' })).toEqual({ text: `1${FR_GROUP}000`, unitKey: 'yarn.unit.m' })
    expect(formatLength(850, { locale: 'fr', profile: 'lot' })).toEqual({ text: '850', unitKey: 'yarn.unit.m' })
  })
  it('profil lot en impérial : yards entiers, jamais de mile ni de décimale', () => {
    expect(formatLength(1000, { locale: 'en', system: 'imperial', profile: 'lot' })).toEqual({ text: '1,094', unitKey: 'yarn.unit.yd' })
  })

  it('reste en mètres sous le seuil', () => {
    expect(formatLength(850, { locale: 'fr' })).toEqual({ text: '850', unitKey: 'yarn.unit.m' })
  })

  it('reste en mètres à 999 — borne basse', () => {
    expect(formatLength(999, { locale: 'fr' })).toEqual({ text: '999', unitKey: 'yarn.unit.m' })
  })

  it('bascule en km à 1000 pile — borne haute', () => {
    expect(formatLength(1000, { locale: 'fr' })).toEqual({ text: '1', unitKey: 'yarn.unit.km' })
  })

  it('bascule en km dès que la valeur ARRONDIE atteint 1000, pas la valeur brute', () => {
    // 999,5 est encore sous le seuil brut mais s'arrondirait à « 1 000 » en mètres :
    // le seuil doit se comparer à la valeur arrondie, pas au nombre décimal.
    expect(formatLength(999.5, { locale: 'fr' }).unitKey).toBe('yarn.unit.km')
  })

  it('supprime les zéros de fin inutiles', () => {
    expect(formatLength(2000, { locale: 'fr' }).text).toBe('2')
    expect(formatLength(2500, { locale: 'fr' }).text).toBe('2,5')
  })

  it('conserve 3 décimales — précision au mètre près', () => {
    expect(formatLength(12437, { locale: 'fr' }).text).toBe('12,437')
  })

  it('n’affiche jamais plus de 3 décimales', () => {
    // 1234,5678 km : la 4e décimale est arrondie, pas empilée.
    expect(formatLength(1234567.8, { locale: 'fr' }).text).toBe(`1${FR_GROUP}234,568`)
  })

  it('sépare les milliers au-delà de 1000 km', () => {
    expect(formatLength(1234567, { locale: 'fr' }).text).toBe(`1${FR_GROUP}234,567`)
  })

  it('suit la locale anglaise pour le séparateur décimal', () => {
    expect(formatLength(12437, { locale: 'en' }).text).toBe('12.437')
  })

  it('affiche 0 et non NaN pour une valeur absente', () => {
    for (const bad of [0, null, undefined, NaN, '']) {
      expect(formatLength(bad, { locale: 'fr' })).toEqual({ text: '0', unitKey: 'yarn.unit.m' })
    }
  })

  it('tolère une valeur canonique à virgule décimale (fiche d’avant ce lot, ex. « 87,5 ») — revue finale 26/07', () => {
    // Avant correctif : Number('87,5') rend NaN -> affichait « 0 m », un chiffre FAUX (pas
    // seulement masqué) pour une fiche ancienne jamais retouchée depuis.
    expect(formatLength('87,5', { locale: 'fr', profile: 'detail' })).toEqual({ text: '88', unitKey: 'yarn.unit.m' })
  })
})

describe('formatWeight', () => {
  it('reste en grammes sous le seuil', () => {
    expect(formatWeight(900, { locale: 'fr' })).toEqual({ text: '900', unitKey: 'yarn.unit.g' })
  })

  it('bascule en kg à 1000 pile', () => {
    expect(formatWeight(1000, { locale: 'fr' })).toEqual({ text: '1', unitKey: 'yarn.unit.kg' })
  })

  it('conserve 3 décimales — précision au gramme près', () => {
    expect(formatWeight(2450, { locale: 'fr' })).toEqual({ text: '2,45', unitKey: 'yarn.unit.kg' })
    expect(formatWeight(11837, { locale: 'fr' }).text).toBe('11,837')
  })

  it('affiche 0 et non NaN pour une valeur absente', () => {
    expect(formatWeight(null, { locale: 'fr' })).toEqual({ text: '0', unitKey: 'yarn.unit.g' })
  })

  it('tolère une valeur canonique à virgule décimale (fiche d’avant ce lot, ex. « 4,5 ») — revue finale 26/07', () => {
    // Même correctif que formatLength ci-dessus : Number('4,5') rendait NaN -> « 0 g ».
    // Le grammage métrique arrondit à l'entier (pas de décimale sous le seuil, même en
    // profil detail) : « 4,5 » devient « 5 », pas « 0 ».
    expect(formatWeight('4,5', { locale: 'fr', profile: 'detail' })).toEqual({ text: '5', unitKey: 'yarn.unit.g' })
  })
})

// formatMoney a été réécrite (devises) avec une nouvelle signature
// (`formatMoney(amount, { locale, currency, profile })`) : ses tests vivent désormais dans
// tests/unit/money.spec.js, qui couvre le même comportement (arrondi, séparateur de milliers,
// pas de bascule d'unité, 0 pour une valeur absente) et davantage (devise, symbole).

describe('formatSkeins', () => {
  it('affiche la virgule décimale en français', () => {
    expect(formatSkeins(2.5, { locale: 'fr' })).toBe('2,5')
  })

  it('affiche le point décimal en anglais', () => {
    expect(formatSkeins(2.5, { locale: 'en' })).toBe('2.5')
  })

  it('n’affiche aucune décimale pour un entier', () => {
    expect(formatSkeins(3, { locale: 'fr' })).toBe('3')
  })

  it('tolère une saisie à virgule (fiche ancienne)', () => {
    expect(formatSkeins('2,5', { locale: 'fr' })).toBe('2,5')
  })

  it('groupe les milliers par défaut, comme les autres formateurs du fichier', () => {
    expect(formatSkeins(1000, { locale: 'fr' })).toBe(`1${FR_GROUP}000`)
  })

  // Protège : un champ modifiable ne doit jamais recevoir de séparateur de milliers (parseDecimal ne le lit pas).
  it('n’ajoute aucun séparateur de milliers quand grouping: false, quelle que soit la locale', () => {
    expect(formatSkeins(1000, { locale: 'fr', grouping: false })).toBe('1000')
    expect(formatSkeins(1000, { locale: 'de', grouping: false })).toBe('1000')
    expect(formatSkeins(1000, { locale: 'en', grouping: false })).toBe('1000')
  })
})

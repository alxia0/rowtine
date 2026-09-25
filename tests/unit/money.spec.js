import { describe, it, expect } from 'vitest'
import { formatMoney, formatAmount, currencySymbol } from '@/utils/units'
import { CURRENCIES } from '@/constants/currencies'

describe('formatMoney — aucune conversion', () => {
  it('porte le MÊME nombre quelle que soit la devise', () => {
    // Le cœur de la règle : une devise est une étiquette, pas un taux de change.
    const eur = formatMoney(1250, { locale: 'fr', currency: 'EUR', profile: 'total' })
    const usd = formatMoney(1250, { locale: 'fr', currency: 'USD', profile: 'total' })
    expect(eur.text).toBe(usd.text)
    // Assertion sur la valeur exacte : sans elle, une mise à l'échelle UNIFORME (appliquée
    // pareil aux deux devises) satisferait encore l'égalité ci-dessus sans être détectée.
    const groupSep = new Intl.NumberFormat('fr').format(1000).replace(/\d/g, '')
    expect(eur.text).toBe(`1${groupSep}250`)
  })

  it('sépare les milliers et arrondit à l’entier sur un total', () => {
    const groupSep = new Intl.NumberFormat('fr').format(1000).replace(/\d/g, '')
    expect(formatMoney(1250.4, { locale: 'fr', currency: 'EUR', profile: 'total' }).text)
      .toBe(`1${groupSep}250`)
  })

  it('ne bascule jamais vers une unité supérieure', () => {
    // « 1,2 k€ » ne se dit pas.
    const r = formatMoney(12500, { locale: 'fr', currency: 'EUR', profile: 'total' })
    expect(r.unitKey).toBe('yarn.spent')
    // `unitKey` seul est un littéral dans formatMoney : cette assertion ne peut échouer pour
    // aucune implémentation. C'est la valeur exacte, avec ses DEUX séparateurs de milliers sur
    // un nombre à 5 chiffres, qui prouve qu'aucune bascule d'unité n'a eu lieu.
    const groupSep = new Intl.NumberFormat('fr').format(1000).replace(/\d/g, '')
    expect(r.text).toBe(`12${groupSep}500`)
  })

  it('renvoie le symbole attendu sur un total, pour plusieurs devises', () => {
    // Non testé ailleurs : ce champ sera consommé par une tâche à venir pour interpoler le
    // symbole dans le libellé (« € dépensés »). Le supprimer du retour ne doit pas passer.
    expect(formatMoney(1250, { locale: 'fr', currency: 'EUR', profile: 'total' }).symbol)
      .toBe('€')
    expect(formatMoney(1250, { locale: 'fr', currency: 'USD', profile: 'total' }).symbol)
      .toBe('$')
  })

  it('affiche 0 pour une valeur absente', () => {
    for (const bad of [0, null, undefined, NaN, '']) {
      expect(formatMoney(bad, { locale: 'fr', currency: 'EUR', profile: 'total' }).text).toBe('0')
    }
  })
})

describe('formatMoney — profil détail', () => {
  it('place le symbole après le nombre en français', () => {
    const r = formatMoney(12.5, { locale: 'fr', currency: 'EUR', profile: 'detail' })
    expect(r.text).toMatch(/12,50\s*€/)
    expect(r.unitKey).toBeNull()
  })

  it('place le symbole avant le nombre en anglais', () => {
    const r = formatMoney(12.5, { locale: 'en', currency: 'USD', profile: 'detail' })
    expect(r.text).toMatch(/^\$12\.50/)
  })

  // Décision produit (revue, 26/07) : un montant ROND s'écrit sans centimes, PARTOUT où
  // le profil 'detail' est utilisé — pas une exception réservée à l'accueil, pas de 3ᵉ profil.
  it('un montant entier ne montre AUCUNE décimale', () => {
    const r = formatMoney(1475, { locale: 'fr', currency: 'EUR', profile: 'detail' })
    // \s (pas une espace littérale) : Intl sépare les milliers avec une espace fine
    // insécable (U+202F) et met une espace insécable (U+00A0) avant le symbole — toutes
    // deux invisibles à l'œil mais qui casseraient un `toBe` écrit avec une espace normale.
    expect(r.text).toMatch(/^1\s475\s€$/)
  })

  it('un montant à centimes garde ses DEUX décimales (jamais « 12,5 € », qui perdrait le zéro de fin)', () => {
    const r = formatMoney(12.5, { locale: 'fr', currency: 'EUR', profile: 'detail' })
    expect(r.text).toMatch(/^12,50\s€$/)
  })

  it('la position du symbole reste dictée par la langue, montant entier ET à centimes', () => {
    // Français : symbole après le nombre, dans les deux cas.
    expect(formatMoney(1475, { locale: 'fr', currency: 'EUR', profile: 'detail' }).text)
      .toMatch(/^1\s475\s€$/)
    expect(formatMoney(12.5, { locale: 'fr', currency: 'EUR', profile: 'detail' }).text)
      .toMatch(/^12,50\s€$/)
    // Anglais : symbole avant le nombre, dans les deux cas — seul le nombre de décimales
    // change (0 vs 2), jamais la position du symbole.
    expect(formatMoney(1475, { locale: 'en', currency: 'USD', profile: 'detail' }).text)
      .toBe('$1,475')
    expect(formatMoney(12.5, { locale: 'en', currency: 'USD', profile: 'detail' }).text)
      .toBe('$12.50')
  })
})

describe('currencySymbol', () => {
  it('rend le symbole court, pas le code long', () => {
    expect(currencySymbol('USD', 'fr')).toBe('$') // et non « $US »
    expect(currencySymbol('EUR', 'fr')).toBe('€')
    expect(currencySymbol('GBP', 'fr')).toBe('£')
    // Les 2 devises restantes de CURRENCIES n'avaient jusqu'ici qu'une assertion générique
    // de non-vacuité (cf. test suivant) — revue finale (26/07) : le franc suisse n'a
    // pas de symbole court distinct (Intl rend le code lui-même), le dollar canadien partage
    // le symbole du dollar US (aucun code de devise ne distingue les deux à l'affichage).
    expect(currencySymbol('CHF', 'fr')).toBe('CHF')
    expect(currencySymbol('CAD', 'fr')).toBe('$')
  })

  it('rend un symbole non vide pour chacune des devises proposées', () => {
    for (const c of CURRENCIES) {
      expect(currencySymbol(c, 'fr')).toBeTruthy()
      expect(currencySymbol(c, 'en')).toBeTruthy()
    }
  })

  it('ne jette jamais sur une devise inconnue', () => {
    // Un réglage corrompu ne doit pas faire écran blanc.
    expect(() => currencySymbol('ZZZ', 'fr')).not.toThrow()
    // 'ZZZ' est un code de 3 lettres bien formé : Intl l'accepte sans lever d'exception et
    // rend le code brut tel quel — cette assertion ne prouve donc PAS que le try/catch sert.
    // Un code MALFORMÉ (longueur invalide, vide) lève un RangeError et exerce réellement le
    // repli : c'est lui qui garantit qu'on ne jette jamais, quelle que soit la corruption.
    expect(() => currencySymbol('EURO', 'fr')).not.toThrow()
    expect(currencySymbol('EURO', 'fr')).toBe('EURO')
    expect(() => currencySymbol('', 'fr')).not.toThrow()
  })
})

describe('formatAmount', () => {
  // Montant nu (le symbole vit dans le libellé) : même règle de centimes que le profil detail.
  it('garde deux décimales à un montant à centimes, dans le format de la langue', () => {
    expect(formatAmount(3.2, { locale: 'fr' })).toBe('3,20')
    expect(formatAmount(3.2, { locale: 'en' })).toBe('3.20')
    expect(formatAmount(3.2, { locale: 'de' })).toBe('3,20')
    expect(formatAmount('3,5', { locale: 'en' })).toBe('3.50')
  })

  it('écrit un montant rond sans centimes', () => {
    expect(formatAmount(25, { locale: 'fr' })).toBe('25')
  })
})

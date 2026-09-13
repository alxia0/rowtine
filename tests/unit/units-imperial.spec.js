import { describe, it, expect } from 'vitest'
import { formatLength, formatWeight, toInput, fromInput, M_PER_YD, G_PER_OZ } from '@/utils/units'

const IMP = (profile) => ({ locale: 'fr', system: 'imperial', profile })
const MET = (profile) => ({ locale: 'fr', system: 'metric', profile })

describe('longueur impériale', () => {
  it('convertit les mètres en yards', () => {
    // 100 m = 109,3613... yd
    expect(formatLength(100, IMP('detail'))).toEqual({ text: '109,36', unitKey: 'yarn.unit.yd' })
  })

  it('arrondit à l’entier sur un total', () => {
    expect(formatLength(100, IMP('total'))).toEqual({ text: '109', unitKey: 'yarn.unit.yd' })
  })

  it('ne bascule JAMAIS vers le mile, même sur une valeur absurde', () => {
    // 10 000 km de fil : toujours des yards, avec séparateur de milliers.
    const r = formatLength(10_000_000, IMP('total'))
    expect(r.unitKey).toBe('yarn.unit.yd')
    expect(r.text).not.toMatch(/mile/i)
  })

  it('sépare les milliers', () => {
    const groupSep = new Intl.NumberFormat('fr').format(1000).replace(/\d/g, '')
    expect(formatLength(12_000, IMP('total')).text).toBe(`13${groupSep}123`)
  })

  it('ne groupe jamais les milliers en profil détail', () => {
    // 1000 m = 1093,61 yd : au-delà de 1000 yards, mais le profil détail n'affiche
    // jamais de séparateur de milliers (c'est le métrage d'une seule pelote, pas un
    // cumul) — sans garde explicite ce test tomberait sur '1 093,61'.
    const groupSep = new Intl.NumberFormat('fr').format(1000).replace(/\d/g, '')
    const r = formatLength(1000, IMP('detail'))
    expect(r.text).toBe('1093,61')
    expect(r.text).not.toContain(groupSep)
  })
})

describe('poids impérial', () => {
  it('convertit les grammes en onces sous le seuil', () => {
    // 50 g = 1,7637 oz
    expect(formatWeight(50, IMP('detail'))).toEqual({ text: '1,76', unitKey: 'yarn.unit.oz' })
  })

  it('affiche 1 décimale exacte sous 16 onces en profil total', () => {
    // 50 g = 1,7637 oz → 1 décimale sur le profil total, pas 0 ni 2 : ce nombre de
    // décimales n'était vérifié par aucun test avant ce cas.
    expect(formatWeight(50, IMP('total'))).toEqual({ text: '1,8', unitKey: 'yarn.unit.oz' })
  })

  it('bascule en livres à 16 onces pile — borne haute', () => {
    const seize = 16 * G_PER_OZ // 453,592... g
    expect(formatWeight(seize, IMP('total')).unitKey).toBe('yarn.unit.lb')
    expect(formatWeight(seize - 1, IMP('total')).unitKey).toBe('yarn.unit.oz')
  })

  it('exprime un gros total en livres', () => {
    // 5 kg = 11,0231 lb
    expect(formatWeight(5000, IMP('total'))).toEqual({ text: '11,023', unitKey: 'yarn.unit.lb' })
  })

  it('ne bascule pas en livres sur le profil détail', () => {
    // Une pelote reste en onces, même lourde : « 0,5 lb » pour une pelote n'a pas de sens.
    expect(formatWeight(5000, IMP('detail')).unitKey).toBe('yarn.unit.oz')
  })
})

describe('profil detail — pas de bascule en métrique non plus', () => {
  it('un écheveau de 1 200 m reste en mètres', () => {
    expect(formatLength(1200, MET('detail'))).toEqual({ text: '1200', unitKey: 'yarn.unit.m' })
  })

  it('mais le même chiffre bascule sur un total', () => {
    expect(formatLength(1200, MET('total')).unitKey).toBe('yarn.unit.km')
  })

  it('une pelote de 1 200 g reste en grammes, jamais en kg', () => {
    // Symétrique du cas longueur ci-dessus : sans garde `profile === 'detail'` dans
    // formatWeight, ce cas basculerait à tort vers 'yarn.unit.kg'.
    expect(formatWeight(1200, MET('detail'))).toEqual({ text: '1200', unitKey: 'yarn.unit.g' })
  })

  it('mais le même poids bascule sur un total', () => {
    expect(formatWeight(1200, MET('total')).unitKey).toBe('yarn.unit.kg')
  })
})

describe('valeurs absentes', () => {
  it('rend 0 et l’unité de base, jamais NaN', () => {
    for (const bad of [0, null, undefined, NaN, '']) {
      expect(formatLength(bad, IMP('total'))).toEqual({ text: '0', unitKey: 'yarn.unit.yd' })
      expect(formatWeight(bad, IMP('total'))).toEqual({ text: '0', unitKey: 'yarn.unit.oz' })
    }
  })
})

describe('aller-retour saisie — aucune perte', () => {
  it('rend exactement la valeur canonique de départ', () => {
    for (const meters of [1, 100, 220, 1234, 0.5]) {
      const shown = toInput(meters, { system: 'imperial', kind: 'length' })
      expect(fromInput(shown, { system: 'imperial', kind: 'length' })).toBeCloseTo(meters, 1)
    }
    for (const grams of [50, 100, 450, 5000]) {
      const shown = toInput(grams, { system: 'imperial', kind: 'weight' })
      expect(fromInput(shown, { system: 'imperial', kind: 'weight' })).toBeCloseTo(grams, 1)
    }
  })

  it('ne touche à rien en métrique', () => {
    expect(toInput(100, { system: 'metric', kind: 'length' })).toBe('100')
    expect(fromInput('100', { system: 'metric', kind: 'length' })).toBe(100)
  })

  it('accepte la virgule décimale saisie au clavier français', () => {
    expect(fromInput('109,36', { system: 'imperial', kind: 'length' })).toBeCloseTo(100, 1)
    expect(fromInput('109.36', { system: 'imperial', kind: 'length' })).toBeCloseTo(100, 1)
  })

  it('rend une chaîne vide pour une valeur absente, pas « 0 »', () => {
    // Un champ vide doit le rester : afficher « 0 » ferait croire à une valeur saisie.
    for (const bad of ['', null, undefined]) {
      expect(toInput(bad, { system: 'imperial', kind: 'length' })).toBe('')
      expect(toInput(bad, { system: 'metric', kind: 'length' })).toBe('')
    }
  })
})

describe('toInput — robustesse sur les données héritées (revue, premier correctif)', () => {
  it('tolère une valeur canonique stockée en chaîne à virgule (fiches d’avant ce lot)', () => {
    // Le code d'avant ce chantier stockait parfois la saisie brute telle quelle (ex. un
    // `grams: '4,5'` dans les fixtures du dépôt) : virgule décimale FR comprise. `fromInput`
    // tolérait déjà cette virgule ; `toInput` ne le faisait pas, et affichait un champ VIDE
    // pour une fiche existante — perte d'information silencieuse au moment même où cette
    // valeur devait rester visible et corrigeable en édition.
    expect(toInput('4,5', { system: 'metric', kind: 'weight' })).toBe('4,5')
    expect(toInput('4,5', { system: 'imperial', kind: 'weight' })).toBe('0,159')
    expect(toInput('4,5', { system: 'imperial', kind: 'weight' })).not.toBe('')
  })

  it('rend la décimale française en métrique, jamais le point', () => {
    // Avant correctif, toInput(100.5, métrique) rendait '100.5' (point), alors que le même
    // formulaire affiche '109,361' (virgule) en impérial — incohérence avec la règle du
    // projet (virgule partout dans les textes visibles).
    expect(toInput(100.5, { system: 'metric', kind: 'length' })).toBe('100,5')
    // Un entier ne doit jamais gagner de décimale artificielle : '100', pas '100,0'.
    expect(toInput(100, { system: 'metric', kind: 'length' })).toBe('100')
  })
})

describe('constantes de conversion', () => {
  it('sont les valeurs exactes, pas des approximations', () => {
    expect(M_PER_YD).toBe(0.9144)
    expect(G_PER_OZ).toBe(28.349523125)
  })
})

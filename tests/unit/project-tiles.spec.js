// Unitaire : textes des tuiles de la fiche projet (onglet Détails), en pur JS.
import { describe, it, expect } from 'vitest'
import { needleTexts, gaugeText } from '@/utils/project-tiles'
// L'i18n de l'app (4 langues) : `createTestI18n()` ne charge que le français et replierait en/de/es sur fr.
import i18n from '@/i18n'

const tIn = (locale) => (key, named) => i18n.global.t(key, named, { locale })

describe('needleTexts', () => {
  // Protège : le diamètre suit la langue de l'app (« 4,5 mm » en fr, « 4.5 mm » en en).
  it('formate chaque diamètre selon la langue, taille US inchangée', () => {
    const p = { needles: [{ mm: '4', us: '' }, { mm: '4.5', us: 'US 7' }] }
    expect(needleTexts(p, 'fr')).toEqual(['4 mm', '4,5 mm · US 7'])
    expect(needleTexts({ needles: [{ mm: '4,5', us: '' }] }, 'en')).toEqual(['4.5 mm'])
  })
  it('replie sur les scalaires hérités et écarte les entrées vides', () => {
    expect(needleTexts({ needleMm: '3.5', needleUs: '' }, 'de')).toEqual(['3,5 mm'])
    expect(needleTexts({ needles: [{ mm: '', us: '' }] }, 'fr')).toEqual([])
    expect(needleTexts(null, 'fr')).toEqual([])
  })
})

describe('gaugeText', () => {
  // Protège : les unités de l'échantillon viennent des traductions, jamais « m »/« rg » en dur.
  it('compose mailles × rangs avec les unités de la langue', () => {
    for (const locale of ['fr', 'en', 'de', 'es']) {
      const t = tIn(locale)
      expect(gaugeText({ gaugeStitches: '20', gaugeRows: '26' }, t, locale)).toBe(
        `${t('project.gaugeStitchesValue', { n: '20' })} × ${t('project.gaugeRowsValue', { n: '26' })}`,
      )
    }
    const fr = tIn('fr')('project.gaugeStitchesValue', { n: '20' })
    for (const locale of ['en', 'de', 'es']) expect(tIn(locale)('project.gaugeStitchesValue', { n: '20' })).not.toBe(fr)
  })
  it('un seul des deux champs : pas de « × » orphelin', () => {
    const t = tIn('en')
    expect(gaugeText({ gaugeStitches: '20', gaugeRows: '' }, t, 'en')).toBe(t('project.gaugeStitchesValue', { n: '20' }))
    expect(gaugeText({ gaugeStitches: '', gaugeRows: '26' }, t, 'en')).toBe(t('project.gaugeRowsValue', { n: '26' }))
    expect(gaugeText({}, t, 'en')).toBe('')
  })
  it('un nombre décimal suit le séparateur de la langue', () => {
    const t = tIn('fr')
    expect(gaugeText({ gaugeStitches: '22.5' }, t, 'fr')).toBe(t('project.gaugeStitchesValue', { n: '22,5' }))
  })
})

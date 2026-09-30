// @vitest-environment jsdom
// Unitaire : la carte suit le système d'unités ; métrage (profil lot) et poids (profil total) sont des CUMULS du lot.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import YarnCard from '@/components/YarnCard.vue'
import { formatLength } from '@/utils/units'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()
// Le séparateur de milliers fr est une espace fine insécable : on compare au formateur.
const total = (m, system) => {
  const r = formatLength(m, { locale: 'fr', system, profile: 'lot' })
  return `${r.text} ${i18n.global.t(r.unitKey)}`
}
const USAGE = { state: 'free', used: 0, total: 0 }
const YARN = { id: 1, brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu', quantity: 10, lengthM: 100, grams: 50 }

function mountCard(yarn, { unitSystem } = {}) {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: { settings: { unitSystem: unitSystem || 'metric' } },
  })
  return mount(YarnCard, {
    props: { yarn, usage: USAGE },
    global: { plugins: [pinia, i18n], stubs: { ThumbImage: true } },
  })
}

describe('YarnCard — unités', () => {
  it('métrique : affichage identique à aujourd\'hui (non-régression)', () => {
    const w = mountCard(YARN, { unitSystem: 'metric' })
    const meta = w.find('.ycard__meta').text()
    expect(meta).toContain(total(1000, 'metric'))
    expect(meta).not.toContain('km')
    expect(meta).toContain('500 g') // cumul 10 × 50 g, pas 50 g
  })

  it('impérial : métrage TOTAL du lot en yards, jamais en miles', () => {
    const w = mountCard(YARN, { unitSystem: 'imperial' })
    const meta = w.find('.ycard__meta').text()
    expect(meta).toContain(total(1000, 'imperial'))
    expect(meta).not.toContain('109,36')
  })

  it('impérial : poids = CUMUL du lot, pas une valeur par pelote', () => {
    const w = mountCard(YARN, { unitSystem: 'imperial' })
    const meta = w.find('.ycard__meta').text()
    // 10 × 50 g = 500 g = 17,637 oz, qui dépasse le seuil de bascule (16 oz) :
    // le cumul s'affiche donc en livres, « 1,102 livres ». Une pelote seule (50 g =
    // 1,764 oz) resterait sous ce seuil et s'afficherait « 1,8 onces » : la présence
    // de l'unité livres (et non onces) prouve que le cumul est bien utilisé.
    expect(meta).toContain('1,102 livres')
    expect(meta).not.toContain('1,8 onces')
  })

  it('fiche ancienne à virgule décimale (« 87,5 »/« 4,5 ») : la carte affiche un chiffre réel, pas 0 (revue finale 26/07)', () => {
    // Fiche stockée AVANT ces travaux, saisie brute (clavier Android) : lengthM/grams en chaîne
    // à virgule. Avant correctif, Number('4,5') dans le calcul du cumul de poids rendait
    // NaN -> « 0 g » affiché, alors même que formatLength/formatWeight tolèrent la virgule.
    const w = mountCard({ ...YARN, quantity: 2, lengthM: '87,5', grams: '4,5' }, { unitSystem: 'metric' })
    const meta = w.find('.ycard__meta').text()
    expect(meta).toContain('175 m') // cumul 2 × 87,5 m
    expect(meta).toContain('9 g') // cumul 2 × 4,5 g = 9 g
    expect(meta).not.toContain('0 m')
    expect(meta).not.toContain('0 g')
  })

  it('quantité décimale (pelote entamée) : total juste', () => {
    const w = mountCard({ ...YARN, quantity: 2.5, lengthM: 100 }, { unitSystem: 'metric' })
    expect(w.find('.ycard__meta').text()).toContain('250 m')
  })

  it('quantité saisie à virgule (« 2,5 ») : le poids cumulé apparaît, comme le métrage', () => {
    const w = mountCard({ ...YARN, quantity: '2,5', grams: 50 }, { unitSystem: 'metric' })
    expect(w.find('.ycard__meta').text()).toContain('125 g')
  })

  it('sans métrage ou sans pelote : aucun métrage, jamais « 0 m »', () => {
    for (const y of [{ ...YARN, lengthM: '' }, { ...YARN, quantity: 0 }]) {
      const meta = mountCard(y, { unitSystem: 'metric' }).find('.ycard__meta').text()
      expect(meta).not.toMatch(/\d m\b/)
    }
  })
})

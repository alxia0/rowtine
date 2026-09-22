// Unitaire — YarnCard : la carte suit le système d'unités choisi.
// Piège central : deux profils différents sur la même ligne — le métrage est celui
// d'UNE pelote (profil detail, jamais de bascule km), le poids est le CUMUL du lot
// (profil total, bascule autorisée vers kg/lb). Se tromper de profil donnerait un
// poids par pelote ou un métrage en kilomètres absurde pour un écheveau.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import YarnCard from '@/components/YarnCard.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
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
    expect(meta).toContain('100 m')
    expect(meta).toContain('500 g') // cumul 10 × 50 g, pas 50 g
  })

  it('impérial : métrage d\'UNE pelote en yards (profil detail, jamais de km/miles)', () => {
    const w = mountCard(YARN, { unitSystem: 'imperial' })
    const meta = w.find('.ycard__meta').text()
    expect(meta).toContain('109,36 yards')
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
    expect(meta).toContain('88 m') // profil detail, 1 pelote, arrondi
    expect(meta).toContain('9 g') // cumul 2 × 4,5 g = 9 g
    expect(meta).not.toContain('0 m')
    expect(meta).not.toContain('0 g')
  })
})

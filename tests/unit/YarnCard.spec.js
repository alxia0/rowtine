// @vitest-environment jsdom
// Unitaire — YarnCard : ouverture de la fiche (tap sur la ligne) + affichage badges/labels.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import fr from '@/i18n/fr.json'
import YarnCard from '@/components/YarnCard.vue'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()
const YARN = { id: 42, brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu', quantity: 2 }
const USAGE = { state: 'free', used: 0, total: 0 }

// YarnCard lit settings.unitSystem (lot 2) : Pinia doit être installé, comme
// partout ailleurs dans le projet — sinon useSettingsStore() lève à l'instanciation.
function mountCard() {
  return mount(YarnCard, { props: { yarn: YARN, usage: USAGE }, global: { plugins: [i18n, createPinia()], stubs: { ThumbImage: true } } })
}

describe('YarnCard', () => {
  it('le clic sur le corps émet "view" avec la laine complète', async () => {
    const w = mountCard()
    await w.find('.ycard__view').trigger('click')
    expect(w.emitted('view')[0]).toEqual([YARN])
  })

  it('badge de type de coloris affiché pour une pelote non-Uni (ex. Moucheté)', () => {
    const w = mount(YarnCard, {
      props: { yarn: { ...YARN, colorType: 'mouchete' }, usage: USAGE },
      global: { plugins: [i18n, createPinia()], stubs: { ThumbImage: true } },
    })
    const tags = w.findAll('.tag').map((t) => t.text())
    expect(tags).toContain(fr.yarn.colorTypes.mouchete)
  })

  it('aucun badge de type de coloris pour une pelote Uni ou sans le champ (rétro-compat)', () => {
    const wUni = mount(YarnCard, {
      props: { yarn: { ...YARN, colorType: 'uni' }, usage: USAGE },
      global: { plugins: [i18n, createPinia()], stubs: { ThumbImage: true } },
    })
    expect(wUni.findAll('.tag')).toHaveLength(1) // seulement le tag d'usage

    const wSansChamp = mountCard() // YARN, sans colorType du tout
    expect(wSansChamp.findAll('.tag')).toHaveLength(1)
  })

  it('affiche une icône par engagement, et AUCUNE pour les certifications', () => {
    const w = mount(YarnCard, {
      props: { yarn: { ...YARN, labels: ['vegan', 'ethique', 'gots', 'rws'] }, usage: USAGE },
      global: { plugins: [i18n, createPinia()], stubs: { ThumbImage: true } },
    })
    expect(w.findAll('.ycard__labels .app-icon')).toHaveLength(2) // vegan + ethique
  })

  it('écarte une clé inconnue et normalise la casse d’une clé valide', () => {
    // `ENGAGEMENTS.filter` ne peut de toute façon rendre que des clés connues : une valeur
    // inconnue seule (ex. 'nimportequoi') ne discrimine rien, avec ou sans normalizeLabels.
    // 'VEGAN' (casse haute) si : sans normalizeLabels, `l.includes('vegan')` échoue (la
    // liste brute contient 'VEGAN', pas 'vegan') → 0 icône ; normalisé → 1 icône (vegan).
    const w = mount(YarnCard, {
      props: { yarn: { ...YARN, labels: ['nimportequoi', 'VEGAN'] }, usage: USAGE },
      global: { plugins: [i18n, createPinia()], stubs: { ThumbImage: true } },
    })
    expect(w.findAll('.ycard__labels .app-icon')).toHaveLength(1)
  })

  it('n’affiche aucune ligne d’icônes sans engagement (plus de grille à préserver)', () => {
    const w = mount(YarnCard, {
      props: { yarn: { ...YARN, labels: [] }, usage: USAGE },
      global: { plugins: [i18n, createPinia()], stubs: { ThumbImage: true } },
    })
    expect(w.find('.ycard__labels').exists()).toBe(false)
  })
})

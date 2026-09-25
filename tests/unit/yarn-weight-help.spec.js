// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import fr from '@/i18n/fr.json'
import YarnWeightHelp from '@/components/YarnWeightHelp.vue'
import { YARN_WEIGHTS } from '@/constants/catalog'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()
const stubs = { AppIcon: true }

function mountHelp(open) {
  return mount(YarnWeightHelp, { props: { open }, global: { plugins: [i18n], stubs } })
}

describe('YarnWeightHelp', () => {
  it('fermé : rien n’est rendu', () => {
    const w = mountHelp(false)
    expect(w.find('.wg').exists()).toBe(false)
  })
  it('ouvert : une ligne par épaisseur + titre', () => {
    const w = mountHelp(true)
    expect(w.text()).toContain(fr.yarn.weightGuideTitle)
    expect(w.findAll('.wg__row')).toHaveLength(YARN_WEIGHTS.length)
    expect(w.text()).toContain(fr.yarn.weights.dk)
  })
  it('émet close au clic sur le scrim', async () => {
    const w = mountHelp(true)
    await w.find('.wg__scrim').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
  it('émet close au clic sur le bouton fermer', async () => {
    const w = mountHelp(true)
    await w.find('.wg__close').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
  it('émet close sur Échap quand monté déjà ouvert', () => {
    const w = mountHelp(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
  it('ouvert : chaque grosseur affiche les fourchettes de métrage 50 g et 100 g', () => {
    const w = mountHelp(true)
    expect(w.findAll('.wg__len')).toHaveLength(YARN_WEIGHTS.length)
    // valeur témoin : le DK doit porter ses deux fourchettes
    expect(w.text()).toContain(fr.yarn.weightGuide.dk.m50)
    expect(w.text()).toContain(fr.yarn.weightGuide.dk.m100)
  })
})

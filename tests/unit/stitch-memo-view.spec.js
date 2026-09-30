// @vitest-environment jsdom
// Câblage de StitchMemoView : titre, onglet par défaut, bascule de technique, dépli d'une fiche, recherche.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createTestI18n } from './helpers/i18n-router'

vi.mock('vue-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }), useRoute: () => ({ query: {} }) }))

import StitchMemoView from '@/views/StitchMemoView.vue'
import { resolveStitch } from '@/content/stitch-memo'

const i18n = createTestI18n()
const t = (k) => i18n.global.t(k)
const mountView = () => mount(StitchMemoView, { global: { plugins: [i18n, createPinia()], stubs: { AppHeader: { props: ['title'], template: '<h1>{{ title }}</h1>' } } } })
const tab = (w, craft) => w.findAll('[role="tab"]').find((b) => b.text() === t('stitchMemo.craft.' + craft))

describe('StitchMemoView', () => {
  it('affiche le titre et ouvre l’onglet Tricot', () => {
    const w = mountView()
    expect(w.get('h1').text()).toBe(t('stitchMemo.title'))
    expect(tab(w, 'knitting').attributes('aria-selected')).toBe('true')
    expect(w.text()).toContain(resolveStitch('kn-knit', 'fr').name)
    expect(w.text()).not.toContain(resolveStitch('cr-sc', 'fr').name)
  })

  it('basculer sur Crochet montre les fiches de crochet', async () => {
    const w = mountView()
    await tab(w, 'crochet').trigger('click')
    expect(w.text()).toContain(resolveStitch('cr-sc', 'fr').name)
  })

  it('une fiche se déplie au clic et montre ses étapes en liste ordonnée', async () => {
    const w = mountView()
    const btn = w.get('[data-stitch="kn-knit"] button')
    expect(btn.attributes('aria-expanded')).toBe('false')
    expect(w.find('[data-stitch="kn-knit"] ol').exists()).toBe(false)
    expect(btn.attributes('aria-description')).toBe(t('stitchMemo.expand'))
    await btn.trigger('click')
    expect(btn.attributes('aria-expanded')).toBe('true')
    expect(btn.attributes('aria-description')).toBeUndefined()
    expect(w.findAll('[data-stitch="kn-knit"] ol li').length).toBe(resolveStitch('kn-knit', 'fr').steps.length)
  })

  it('la recherche filtre comme le sélecteur et signale l’absence de résultat', async () => {
    const w = mountView()
    await w.get('input[type="search"]').setValue('zzzzzz')
    expect(w.text()).toContain(t('stitchMemo.noResult'))
    await w.get('input[type="search"]').setValue(resolveStitch('kn-knit', 'fr').abbr[0])
    expect(w.find('[data-stitch="kn-knit"]').exists()).toBe(true)
  })
})

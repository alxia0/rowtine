// @vitest-environment jsdom
// Câblage de StitchPicker : onglet initial, cases (ordre du catalogue), suggestions, recherche.
import { afterEach, describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestI18n } from './helpers/i18n-router'
import StitchPicker from '@/components/StitchPicker.vue'
import { resolveStitch } from '@/content/stitch-memo'

const i18n = createTestI18n()
const t = (k) => i18n.global.t(k)
const mounted = []
const mountPicker = (props = {}) => {
  const w = mount(StitchPicker, { props: { open: true, pins: [], craft: 'crochet', abbrKeys: [], ...props }, global: { plugins: [i18n] }, attachTo: document.body })
  mounted.push(w)
  return w
}
afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
})
const box = (w, id) => w.get(`[data-stitch="${id}"] input`)

describe('StitchPicker', () => {
  it('ouvre l’onglet de la technique du patron', () => {
    const w = mountPicker({ craft: 'crochet' })
    const on = w.get('[role="tab"][aria-selected="true"]')
    expect(on.text()).toBe(t('stitchMemo.craft.crochet'))
    expect(w.find('[data-stitch="cr-sc"]').exists()).toBe(true)
    expect(w.find('[data-stitch="kn-knit"]').exists()).toBe(false)
  })

  it('cocher émet la nouvelle liste dans l’ordre du catalogue, décocher retire', async () => {
    const w = mountPicker({ pins: ['kn-k2tog'] })
    await box(w, 'cr-sc').setValue(true)
    expect(w.emitted('update:pins')).toEqual([[['cr-sc', 'kn-k2tog']]])
    const w2 = mountPicker({ pins: ['cr-sc', 'kn-k2tog'] })
    await box(w2, 'cr-sc').setValue(false)
    expect(w2.emitted('update:pins')).toEqual([[['kn-k2tog']]])
  })

  it('affiche les suggestions selon les abréviations du patron', () => {
    const withAbbr = mountPicker({ craft: 'knitting', abbrKeys: ['k2tog'] })
    expect(withAbbr.text()).toContain(t('stitchMemo.suggested'))
    expect(withAbbr.findAll('[data-stitch="kn-k2tog"]').length).toBe(2)
    const without = mountPicker({ craft: 'knitting', abbrKeys: [] })
    expect(without.text()).not.toContain(t('stitchMemo.suggested'))
  })

  it('la recherche filtre par nom sans tenir compte des accents ni de la casse', async () => {
    const w = mountPicker({ craft: 'knitting' })
    const name = resolveStitch('kn-k2tog', 'fr').name
    await w.get('input[type="search"]').setValue(name.slice(0, 6).toUpperCase())
    expect(w.find('[data-stitch="kn-k2tog"]').exists()).toBe(true)
    expect(w.find('[data-stitch="kn-knit"]').exists()).toBe(false)
    await w.get('input[type="search"]').setValue('zzzzqq')
    expect(w.text()).toContain(t('stitchMemo.noResult'))
  })

  it('Terminé ferme le sélecteur', async () => {
    const w = mountPicker()
    await w.get('.sp__done').trigger('click')
    expect(w.emitted('update:open')).toEqual([[false]])
  })

  it('Échap ferme le sélecteur', async () => {
    const w = mountPicker()
    await w.get('.sp').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('update:open')).toEqual([[false]])
  })

  it('à l’ouverture, le focus va au champ de recherche', async () => {
    const w = mountPicker({ open: false })
    await w.setProps({ open: true })
    await flushPromises()
    expect(document.activeElement).toBe(w.get('input[type="search"]').element)
    w.unmount()
  })
})

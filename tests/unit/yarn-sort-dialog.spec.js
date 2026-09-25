// @vitest-environment jsdom
// Unitaire — YarnSortDialog : coche sur l'option courante, update:modelValue + close
// au tap, fermetures (bouton, scrim, Échap).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import YarnSortDialog from '@/components/YarnSortDialog.vue'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()

const OPTIONS = [
  { value: 'brand', label: 'Marque' },
  { value: 'weight', label: 'Épaisseur' },
  { value: 'purchasedAt', label: 'Date d’achat' },
]

function mountDialog(modelValue = 'brand') {
  return mount(YarnSortDialog, {
    props: { open: true, title: 'Trier par', modelValue, options: OPTIONS },
    global: { plugins: [i18n] },
  })
}

describe('YarnSortDialog', () => {
  it('fermé : rien n’est rendu', () => {
    const w = mount(YarnSortDialog, {
      props: { open: false, title: 'Trier par', modelValue: 'brand', options: OPTIONS },
      global: { plugins: [i18n] },
    })
    expect(w.find('[data-test="yarn-sort-dialog"]').exists()).toBe(false)
  })

  it('ouvert : titre et une ligne par option', () => {
    const w = mountDialog()
    expect(w.text()).toContain('Trier par')
    const rows = w.findAll('[data-test^="sort-option-"]')
    expect(rows).toHaveLength(OPTIONS.length)
    expect(rows.map((r) => r.text())).toEqual(['Marque', 'Épaisseur', 'Date d’achat'])
  })

  it('la coche marque l’option courante, pas les autres', () => {
    const w = mountDialog('weight')
    const rows = w.findAll('[data-test^="sort-option-"]')
    expect(rows[0].find('.ysd__check').exists()).toBe(false)
    expect(rows[1].find('.ysd__check').exists()).toBe(true)
    expect(rows[2].find('.ysd__check').exists()).toBe(false)
  })

  it('tap sur une option émet update:modelValue(value) PUIS close', async () => {
    const w = mountDialog('brand')
    await w.find('[data-test="sort-option-weight"]').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([['weight']])
    expect(w.emitted('close')).toBeTruthy()
    // l'ordre du contrat : la valeur part avant la fermeture (deux appels, dans cet ordre)
    expect(w.emitted('update:modelValue').length).toBe(1)
    expect(w.emitted('close').length).toBe(1)
  })

  it('close : par le bouton Fermer, par le scrim', async () => {
    const w = mountDialog()
    await w.find('[data-test="sort-close"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    await w.find('.ysd__scrim').trigger('click')
    expect(w.emitted('close')).toHaveLength(2)
  })

  it('close : sur Échap quand monté déjà ouvert', () => {
    const w = mountDialog()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
})

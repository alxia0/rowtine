// @vitest-environment jsdom
// Champ « Acheté chez » (purchasedFrom) sur une ligne d'achat, Task 3 du plan import
// Ravelry. Harnais store mocké, motif tests/unit/stash-purchases-form.spec.js (montage
// direct du composant, pas de l'écran).
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import YarnPurchases from '@/components/YarnPurchases.vue'
import { usePurchasesStore } from '@/stores/purchases'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()
const stubs = { AppIcon: true }

function mountComp(lines = []) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const store = usePurchasesStore(pinia)
  store.forYarn = () => lines
  store.loaded = true
  const w = mount(YarnPurchases, {
    props: { yarnId: 1, yarn: { quantity: 3 }, yarnLabel: 'Drops · Baby Merino · Bleu' },
    global: { plugins: [pinia, i18n], stubs },
  })
  return { w, store }
}

describe('YarnPurchases, Acheté chez', () => {
  it('« Modifier » sur une ligne pré-remplit Acheté chez, et l’envoie modifié à submitForm', async () => {
    const lines = [{ id: 9, quantity: 2, unitPrice: 5, currency: 'EUR', date: '2026-05-01', bain: '', purchasedFrom: 'Boutique X' }]
    const { w, store } = mountComp(lines)
    await flushPromises()

    await w.find('[aria-label="Modifier"]').trigger('click')
    await flushPromises()
    expect(w.find('#ypur-purchased-from').exists()).toBe(true)
    expect(w.find('#ypur-purchased-from').element.value).toBe('Boutique X')

    await w.find('#ypur-purchased-from').setValue('Autre boutique')
    await w.find('[data-test="purchases-form-save"]').trigger('click')
    await flushPromises()

    expect(store.update).toHaveBeenCalledWith(9, expect.objectContaining({ purchasedFrom: 'Autre boutique' }))
  })

  it('la ligne affichée montre le lieu d’achat quand il est renseigné', async () => {
    const lines = [{ id: 9, quantity: 2, unitPrice: 5, currency: 'EUR', date: '2026-05-01', bain: '', purchasedFrom: 'Boutique X' }]
    const { w } = mountComp(lines)
    await flushPromises()
    expect(w.text()).toContain('Boutique X')
  })
})

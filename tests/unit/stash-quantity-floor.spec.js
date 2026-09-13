// Unitaire — StashView : la quantité d'une laine ne peut pas être enregistrée
// sous le total déjà réservé entre projets.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'
import { useSnackbarStore } from '@/stores/snackbar'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const stubs = { AppHeader: true, AppIcon: true, ThumbImage: true, YarnWeightHelp: true, ColorPickerDialog: true, YarnDetailDialog: true }

function mountView() {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const yarns = useYarnsStore(pinia)
  yarns.yarns = [{ id: 1, brand: 'Drops', colorName: 'Bleu', composition: [], quantity: 5, reservations: { 2: 3, 3: 2 } }]
  yarns.loaded = true
  const w = mount(StashView, { global: { plugins: [pinia, i18n], stubs } })
  return { w, pinia }
}

function findButtonByText(w, text) {
  return w.findAll('button').find((b) => b.text().includes(text))
}

describe('StashView — plancher de quantité sous le total réservé', () => {
  it('refuse de sauvegarder une quantité sous le total déjà réservé (5 = 3+2)', async () => {
    const { w, pinia } = mountView()
    await w.find('.ycard__kebab').trigger('click')
    await w.findAll('.menu__item').find((b) => b.text() === fr.common.edit).trigger('click')
    await flushPromises()
    await w.find('#yarn-quantity').setValue('2')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(useYarnsStore(pinia).update).not.toHaveBeenCalled()
    expect(useSnackbarStore(pinia).show).toHaveBeenCalledWith(fr.yarn.quantityBelowReserved.replace('{n}', '5'))
  })

  it('autorise la sauvegarde à exactement le total réservé (borne inclusive)', async () => {
    const { w, pinia } = mountView()
    await w.find('.ycard__kebab').trigger('click')
    await w.findAll('.menu__item').find((b) => b.text() === fr.common.edit).trigger('click')
    await flushPromises()
    await w.find('#yarn-quantity').setValue('5')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(useYarnsStore(pinia).update).toHaveBeenCalledTimes(1)
  })

  it('n’applique aucun plancher à la création d’une nouvelle laine', async () => {
    const { w, pinia } = mountView()
    await findButtonByText(w, fr.yarn.add).trigger('click')
    await flushPromises()
    await w.find('#yarn-color-name').setValue('Verte')
    await w.find('#yarn-quantity').setValue('1')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(useYarnsStore(pinia).add).toHaveBeenCalledTimes(1)
    expect(useSnackbarStore(pinia).show).not.toHaveBeenCalled()
  })
})

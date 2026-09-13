// Unitaire — StashView : un tarif de pelote saisi avec une virgule décimale (clavier FR)
// doit compter dans le total dépensé au même titre qu'un tarif saisi avec un point.
// Retour terrain 21/07 : seul le point fonctionnait, la virgule cassait silencieusement le total.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const stubs = { AppHeader: true, AppIcon: true, ThumbImage: true, YarnWeightHelp: true, ColorPickerDialog: true, YarnDetailDialog: true }

function mountView(yarns) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const store = useYarnsStore(pinia)
  store.yarns = yarns
  store.loaded = true
  return mount(StashView, { global: { plugins: [pinia, i18n], stubs } })
}

describe('StashView — total dépensé avec un prix saisi en virgule décimale', () => {
  it('additionne un prix « 3,50 » (virgule) et un prix « 4 » sans casser le total', () => {
    const w = mountView([
      { id: 1, brand: 'Drops', quantity: 2, price: '3,50', composition: [] },
      { id: 2, brand: 'Rico', quantity: 1, price: '4', composition: [] },
    ])
    // 2 × 3,50 + 1 × 4 = 11 — le bloc ne s'affiche même pas si le total tombe à NaN (v-if="totalSpent > 0").
    const stats = w.findAll('.recap__stat')
    expect(stats).toHaveLength(4)
    expect(stats[3].find('.recap__num').text()).toBe('11')
  })
})

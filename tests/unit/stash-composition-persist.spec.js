// Unitaire — StashView : une composition personnalisée saisie via « Autre » doit
// persister comme choix pour les fiches futures, au même titre que les marques.
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const stubs = { AppHeader: true, AppIcon: true, ThumbImage: true, YarnWeightHelp: true, ColorPickerDialog: true, YarnDetailDialog: true }

function mountView(yarns) {
  setActivePinia(createPinia())
  const w = mount(StashView, { global: { plugins: [i18n], stubs } })
  const store = useYarnsStore()
  store.yarns = yarns
  store.loaded = true
  return w
}

async function openAddForm(w) {
  await w.findAll('button').find((b) => b.text().includes(fr.yarn.add)).trigger('click')
  await flushPromises()
}

describe('StashView — composition « Autre » persistante', () => {
  it('un matériau personnalisé déjà présent dans le stock apparaît en chip togglable dès l\'ouverture du formulaire', async () => {
    const w = mountView([{ id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 1, composition: ['coton', 'kapok'] }])
    await openAddForm(w)

    const chip = w.findAll('.chip').find((b) => b.text().includes('kapok'))
    expect(chip).toBeTruthy()
    expect(chip.classes()).not.toContain('chip--on') // pas encore sélectionné pour CETTE nouvelle fiche
    await chip.trigger('click')
    expect(chip.classes()).toContain('chip--on')
  })

  it('un matériau tout juste tapé via « Autre » (jamais enregistré ailleurs) reste retirable au clic', async () => {
    const w = mountView([{ id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 1, composition: [] }])
    await openAddForm(w)
    await w.findAll('.chip').find((b) => b.text().includes(fr.yarn.compositionOther)).trigger('click')
    await w.find(`input[placeholder="${fr.yarn.compositionOtherPlaceholder}"]`).setValue('kapok')
    await w.findAll('button').find((b) => b.text() === fr.common.add).trigger('click')
    await flushPromises()

    let chip = w.findAll('.chip').find((b) => b.text().includes('kapok'))
    expect(chip.classes()).toContain('chip--on')
    await chip.trigger('click') // retire le matériau
    chip = w.findAll('.chip').find((b) => b.text().includes('kapok'))
    expect(chip).toBeUndefined() // pas encore enregistré ailleurs → disparaît complètement au retrait
  })
})

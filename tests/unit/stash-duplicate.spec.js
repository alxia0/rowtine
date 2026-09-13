// Unitaire — StashView : dupliquer une fiche laine ouvre le formulaire d'ajout pré-rempli
// (tout sauf couleur/photo/prix/date/bain), sans jamais modifier la fiche source.
// ⚠️ `bain` a rejoint la liste des champs remis à vide aux travaux sur le budget laine (01/08,
// arbitrage en revue) : un bain appartient désormais à un LOT ACHETÉ (il
// descend dans la ligne d'achat, cf. src/stores/purchases.js), pas à une laine — dupliquer
// une fiche crée une laine neuve, sans historique d'achat, donc sans bain à hériter.
// Avant ces travaux, `bain` était au contraire volontairement RECOPIÉ (seul champ « achat » à
// l'être) : ce test exigeait alors `bain: 'A123'`, l'exact inverse de l'assertion ci-dessous.
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

const SOURCE = {
  id: 1, brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu', color: 'hsl(210, 60%, 55%)',
  weight: 'dk', lengthM: '100', grams: '50', quantity: 5, price: '12,50', bain: 'A123',
  purchasedAt: '2026-01-01', composition: ['laine', 'coton'], photo: 'data:image/png;base64,xxx',
}

function mountView() {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const store = useYarnsStore(pinia)
  store.yarns = [{ ...SOURCE }]
  store.loaded = true
  const w = mount(StashView, { global: { plugins: [pinia, i18n], stubs } })
  return { w, pinia }
}

async function openDuplicateForm(w) {
  await w.find('.ycard__kebab').trigger('click')
  await w.findAll('.menu__item').find((b) => b.text() === fr.common.duplicate).trigger('click')
  await flushPromises()
}

describe('StashView — duplication de fiche laine', () => {
  it('reprend marque/modèle/épaisseur/mètrage/grammes/composition, remet couleur/photo/prix/date/bain à vide et quantité à 1', async () => {
    const { w, pinia } = mountView()
    await openDuplicateForm(w)
    await w.find('#yarn-color-name').setValue('Verte')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const store = useYarnsStore(pinia)
    expect(store.update).not.toHaveBeenCalled()
    expect(store.add).toHaveBeenCalledTimes(1)
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({
      brand: 'Drops', model: 'Baby Merino', weight: 'dk', lengthM: '100', grams: '50',
      composition: ['laine', 'coton'], quantity: 1,
      // `bain` (source : 'A123') n'est PAS repris — c'est le point exact que ce test
      // prouve depuis les travaux sur le budget laine : un bain appartient à un lot acheté, pas à la
      // laine dupliquée (cf. commentaire d'en-tête du fichier).
      colorName: 'Verte', color: '', photo: '', price: '', purchasedAt: '', bain: '',
    }))
  })

  it('sans changer la couleur (restée vide après duplication), l’enregistrement est bloqué', async () => {
    const { w, pinia } = mountView()
    await openDuplicateForm(w)
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const store = useYarnsStore(pinia)
    expect(store.add).not.toHaveBeenCalled()
    expect(useSnackbarStore(pinia).show).toHaveBeenCalledWith(fr.yarn.colorRequired)
  })

  it('la fiche source n’est pas altérée par une duplication non enregistrée', async () => {
    const { w, pinia } = mountView()
    await openDuplicateForm(w)
    await w.find('#yarn-color-name').setValue('Verte')
    await w.findAll('.addform__actions button').find((b) => b.text() === fr.common.cancel).trigger('click')
    await flushPromises()

    const store = useYarnsStore(pinia)
    expect(store.yarns[0]).toEqual(SOURCE)
    expect(store.add).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
  })
})

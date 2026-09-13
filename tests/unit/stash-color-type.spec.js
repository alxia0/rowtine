// Unitaire — StashView : type de coloris (uni/dégradé/auto-rayant/moucheté/teint main) +
// couleurs en mots pour les pelotes multicolores.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const stubs = { AppHeader: true, AppIcon: true, ThumbImage: true, YarnWeightHelp: true, ColorPickerDialog: true, YarnDetailDialog: true }

function mountView(yarns = []) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const store = useYarnsStore(pinia)
  store.yarns = yarns
  store.loaded = true
  const w = mount(StashView, { global: { plugins: [pinia, i18n], stubs } })
  return { w, pinia }
}

function findButtonByText(w, text) {
  return w.findAll('button').find((b) => b.text().includes(text))
}

async function openAddForm(w) {
  await findButtonByText(w, fr.yarn.add).trigger('click')
}

async function openEditForm(w) {
  await w.find('.ycard__kebab').trigger('click')
  await w.findAll('.menu__item').find((b) => b.text() === fr.common.edit).trigger('click')
  await flushPromises()
}

async function openDuplicateForm(w) {
  await w.find('.ycard__kebab').trigger('click')
  await w.findAll('.menu__item').find((b) => b.text() === fr.common.duplicate).trigger('click')
  await flushPromises()
}

describe('StashView — type de coloris et couleurs en mots', () => {
  it('formulaire d’ajout : type "Uni" par défaut, champ "Couleurs" absent', async () => {
    const { w } = mountView()
    await openAddForm(w)
    const select = w.find('#yarn-color-type')
    expect(select.exists()).toBe(true)
    expect(select.element.value).toBe('uni')
    expect(select.findAll('option')).toHaveLength(5)
    expect(w.find('#yarn-color-notes').exists()).toBe(false)
  })

  it('choisir un type non-Uni révèle le champ "Couleurs" ; repasser à Uni le masque', async () => {
    const { w } = mountView()
    await openAddForm(w)
    await w.find('#yarn-color-type').setValue('mouchete')
    expect(w.find('#yarn-color-notes').exists()).toBe(true)
    await w.find('#yarn-color-type').setValue('uni')
    expect(w.find('#yarn-color-notes').exists()).toBe(false)
  })

  it('save() transmet le type de coloris et les notes saisies', async () => {
    const { w, pinia } = mountView()
    await openAddForm(w)
    await w.find('#yarn-color-name').setValue('Mix océan')
    await w.find('#yarn-color-type').setValue('degrade')
    await w.find('#yarn-color-notes').setValue('bleu vers blanc')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const store = useYarnsStore(pinia)
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({
      colorType: 'degrade', colorNotes: 'bleu vers blanc',
    }))
  })

  it('éditer une pelote existante SANS la clé colorType (stock d’avant ce lot) : le type affiché est "uni"', async () => {
    const LEGACY = { id: 5, brand: 'Katia', colorName: 'Écru', quantity: 1 } // pas de colorType du tout
    const { w } = mountView([LEGACY])
    await openEditForm(w)
    expect(w.find('#yarn-color-type').element.value).toBe('uni')
  })

  it('dupliquer une pelote moucheté/teinte remet le type à "uni" ET vide les notes (pas de fuite du coloris source)', async () => {
    const SOURCE = { id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 1, colorType: 'mouchete', colorNotes: 'bleu, vert, jaune' }
    const { w } = mountView([SOURCE])
    await openDuplicateForm(w)
    expect(w.find('#yarn-color-type').element.value).toBe('uni')
    expect(w.find('#yarn-color-notes').exists()).toBe(false) // masqué : type revenu à Uni

    // Repasse en Moucheté sans toucher aux notes : si colorNotes n'avait pas été vidé par
    // openDuplicate, l'ancienne valeur de la pelote source réapparaîtrait ici.
    await w.find('#yarn-color-type').setValue('mouchete')
    expect(w.find('#yarn-color-notes').element.value).toBe('')
  })

  it('éditer (pas dupliquer) une pelote moucheté/teinte et repasser à "uni" vide colorNotes à la sauvegarde (pas de fuite de texte invisible dans la recherche)', async () => {
    const SOURCE = { id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 1, colorType: 'mouchete', colorNotes: 'bleu, vert' }
    const { w, pinia } = mountView([SOURCE])
    await openEditForm(w)
    await w.find('#yarn-color-type').setValue('uni') // le champ colorNotes se masque, sans être vidé par l'utilisateur
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const store = useYarnsStore(pinia)
    expect(store.update).toHaveBeenCalledWith(1, expect.objectContaining({ colorType: 'uni', colorNotes: '' }))
  })

  it('la recherche texte trouve une pelote par son type de coloris (ex. « moucheté »)', async () => {
    const { w } = mountView([
      { id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 1, colorType: 'mouchete' },
      { id: 2, brand: 'Katia', colorName: 'Vert', quantity: 1 },
    ])
    await w.find(`input[placeholder="${fr.yarn.search}"]`).setValue('moucheté')
    await flushPromises()
    const cards = w.findAll('.ycard')
    expect(cards.some(card => card.text().includes('Drops'))).toBe(true)
    expect(cards.some(card => card.text().includes('Katia'))).toBe(false)
  })
})

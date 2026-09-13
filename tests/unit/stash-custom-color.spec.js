// Fix A (revue finale, cluster couleur de pelote) — la couleur personnalisée
// n'avait AUCUN champ pour saisir le nom du coloris : sans pastille cliquée,
// form.colorName reste '' → save() bloque sur yarn.colorRequired sans qu'aucun
// champ ne permette de le corriger (impasse). Ce test prouve l'impasse (RED)
// puis la sortie d'impasse une fois le champ nom ajouté (GREEN).
// FIX-2b : l'ancien <input type=color> natif est remplacé par le pop-up
// ColorPickerDialog (glissé au doigt + champ hexa) ; on pilote maintenant le
// vrai composant (non stubé) via son champ hexa + son bouton Valider, ce qui
// reproduit fidèlement le geste original (choisir une couleur perso hors palette).
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'
import { useSnackbarStore } from '@/stores/snackbar'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const stubs = { AppHeader: true, AppIcon: true, ThumbImage: true, YarnWeightHelp: true }

function mountView() {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const w = mount(StashView, { global: { plugins: [pinia, i18n], stubs } })
  return { w, pinia }
}

function findButtonByText(w, text) {
  return w.findAll('button').find((b) => b.text().includes(text))
}

async function openForm(w) {
  await findButtonByText(w, fr.yarn.add).trigger('click')
}

// Ouvre le pop-up de couleur perso, saisit un hexa dans son champ, valide — équivalent
// du geste original (choisir une couleur hors palette) mais via le vrai pop-up au doigt.
async function pickCustomColor(w, hex) {
  await w.find('.palette__cust').trigger('click')
  await flushPromises()
  const hexInput = w.find('.cpick__hex')
  hexInput.element.value = hex
  await hexInput.trigger('input')
  await w.find('.cpick__ok').trigger('click')
  await flushPromises()
}

describe('StashView — couleur personnalisée de pelote (nom du coloris)', () => {
  it('couleur perso sans nom saisi : save() bloque (colorRequired), yarnsStore.add jamais appelé', async () => {
    const { w, pinia } = mountView()
    await openForm(w)
    await pickCustomColor(w, '#3355ff')
    const saveBtn = w.find('.addform__actions .btn--primary')
    await saveBtn.trigger('click')
    await flushPromises()
    expect(useYarnsStore(pinia).add).not.toHaveBeenCalled()
    expect(useSnackbarStore(pinia).show).toHaveBeenCalledWith(fr.yarn.colorRequired)
  })

  it('un champ « nom du coloris » existe et permet de sortir de l’impasse : couleur perso + nom tapé s’enregistrent', async () => {
    const { w, pinia } = mountView()
    await openForm(w)
    await pickCustomColor(w, '#3355ff')
    const nameInput = w.find('#yarn-color-name')
    expect(nameInput.exists()).toBe(true) // <- échoue tant que le champ n'existe pas (RED)
    await nameInput.setValue('Bleu canard')
    const saveBtn = w.find('.addform__actions .btn--primary')
    await saveBtn.trigger('click')
    await flushPromises()
    expect(useYarnsStore(pinia).add).toHaveBeenCalledTimes(1)
    const payload = useYarnsStore(pinia).add.mock.calls[0][0]
    expect(payload.color).toMatch(/^hsl\(/) // couleur perso (hors palette), pas un nom de pastille
    expect(payload.colorName).toBe('Bleu canard')
  })

  it('pastille PUIS couleur perso : le nom auto-rempli par la pastille est effacé (pas de mismatch nom/couleur)', async () => {
    const { w } = mountView()
    await openForm(w)
    const swatch = w.findAll('button.palette__sw')[0]
    await swatch.trigger('click')
    const nameInput = w.find('#yarn-color-name')
    expect(nameInput.exists()).toBe(true) // <- échoue tant que le champ n'existe pas (RED)
    expect(nameInput.element.value).not.toBe('') // nom auto-rempli par la pastille
    await pickCustomColor(w, '#112233')
    expect(w.find('#yarn-color-name').element.value).toBe('') // nom auto effacé, pas de mismatch
  })
})

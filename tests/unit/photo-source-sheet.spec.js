// @vitest-environment jsdom
// Unitaire — LA FEUILLE DE CHOIX DE SOURCE PHOTO (PhotoSourceSheet.vue), décision produit
// du 04/09/2026 option (a) : elle remplace le prompt natif CameraSource.Prompt du plugin
// @capacitor/camera (dont LegacyCameraFlow ré-encode tout en JPEG opaque fond noir côté
// natif — voir photo.spec.js pour la cause racine). Montée UNE FOIS dans App.vue, pilotée
// par le store photo-source (promesse), au motif de PhotoCropper.vue.
// AUCUNE clé i18n nouvelle : photo.add (titre), photo.cameraChoose, photo.cameraTake,
// common.cancel existent déjà dans les 4 locales — c'est un invariant du test ci-dessous.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import PhotoSourceSheet from '@/components/PhotoSourceSheet.vue'
import { usePhotoSourceStore } from '@/stores/photo-source'
import { makeTk } from './helpers/i18n-router'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr, en } })

const tk = makeTk(i18n)

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  // Le verrou de défilement (motif PhotoCropper) doit être relâché à la fermeture :
  // on restaure le corps pour ne pas fuiter `overflow: hidden` vers les tests suivants.
  document.body.style.overflow = ''
  i18n.global.locale.value = 'fr'
})

function mountSheet() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(PhotoSourceSheet, { global: { plugins: [i18n, pinia] } })
}

describe('PhotoSourceSheet — rendu', () => {
  it('ne rend rien tant que la feuille n’est pas ouverte', () => {
    const wrapper = mountSheet()
    expect(wrapper.find('[data-test="photo-source-gallery"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="photo-source-cancel"]').exists()).toBe(false)
  })

  it('askSource() rend les trois boutons DANS CET ORDRE avec les libellés fr existants', async () => {
    const wrapper = mountSheet()
    const store = usePhotoSourceStore()
    const p = store.askSource()
    await flushPromises()

    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual([
      'Choisir dans la galerie',
      'Prendre une photo',
      'Annuler',
    ])
    expect(wrapper.find('[data-test="photo-source-gallery"]').attributes('class')).toContain(
      'btn--primary',
    )
    // Dialogue modal annoncé : role + aria-modal + aria-labelledby vers le titre
    // (photo.add, clé existante — aucun ajout i18n).
    const overlay = wrapper.find('[data-test="photo-source-sheet"]')
    expect(overlay.attributes('role')).toBe('dialog')
    expect(overlay.attributes('aria-modal')).toBe('true')
    const labelledby = overlay.attributes('aria-labelledby')
    expect(labelledby).toBeTruthy()
    expect(wrapper.find('#' + labelledby).text()).toBe(tk('photo.add'))
    expect(p).toBeInstanceOf(Promise) // toujours en attente : rien n'a été cliqué
    store.settle(null) // nettoyage : referme la feuille ouverte par le test
    await flushPromises()
  })

  it('les libellés suivent la locale (en) — jamais figés', async () => {
    i18n.global.locale.value = 'en'
    const wrapper = mountSheet()
    const store = usePhotoSourceStore()
    store.askSource()
    await flushPromises()
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual([
      'Choose from gallery',
      'Take a photo',
      'Cancel',
    ])
    store.settle(null)
    await flushPromises()
  })
})

describe('PhotoSourceSheet — clics et fermeture', () => {
  it('« Choisir dans la galerie » résout à gallery et ferme la feuille', async () => {
    const wrapper = mountSheet()
    const store = usePhotoSourceStore()
    const p = store.askSource()
    await flushPromises()
    expect(document.body.style.overflow).toBe('hidden') // verrou, motif PhotoCropper

    await wrapper.find('[data-test="photo-source-gallery"]').trigger('click')
    await expect(p).resolves.toBe('gallery')
    expect(store.open).toBe(false)
    expect(wrapper.find('[data-test="photo-source-gallery"]').exists()).toBe(false)
    expect(document.body.style.overflow).toBe('') // verrou relâché
  })

  it('« Prendre une photo » résout à camera et ferme la feuille', async () => {
    const wrapper = mountSheet()
    const store = usePhotoSourceStore()
    const p = store.askSource()
    await flushPromises()

    await wrapper.find('[data-test="photo-source-camera"]').trigger('click')
    await expect(p).resolves.toBe('camera')
    expect(store.open).toBe(false)
  })

  it('« Annuler » résout à null et ferme la feuille', async () => {
    const wrapper = mountSheet()
    const store = usePhotoSourceStore()
    const p = store.askSource()
    await flushPromises()

    await wrapper.find('[data-test="photo-source-cancel"]').trigger('click')
    await expect(p).resolves.toBeNull()
    expect(store.open).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  // Fermeture STRICTE (même règle que la porte du dossier) : un tap accidentel sur le
  // fond ne doit pas annuler un choix en cours — seul le bouton Annuler tranche.
  it('un tap sur le fond (overlay) ne ferme PAS la feuille', async () => {
    const wrapper = mountSheet()
    const store = usePhotoSourceStore()
    let settled = false
    const p = store.askSource().then((v) => {
      settled = true
      return v
    })
    await flushPromises()

    await wrapper.find('[data-test="photo-source-sheet"]').trigger('click')
    await flushPromises()
    expect(store.open).toBe(true)
    expect(settled).toBe(false) // personne n'a tranché : la promesse est encore pendante
    expect(wrapper.find('[data-test="photo-source-gallery"]').exists()).toBe(true)

    store.settle(null) // nettoyage
    await expect(p).resolves.toBeNull()
  })
})

describe('PhotoSourceSheet - 4e bouton optionnel (extra)', () => {
  it('askSource(label) affiche un 4e bouton entre "Prendre une photo" et "Annuler"', async () => {
    const wrapper = mountSheet()
    const store = usePhotoSourceStore()
    store.askSource('Depuis le PDF du patron')
    await flushPromises()

    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual([
      'Choisir dans la galerie',
      'Prendre une photo',
      'Depuis le PDF du patron',
      'Annuler',
    ])
    expect(wrapper.find('[data-test="photo-source-extra"]').attributes('class')).not.toContain(
      'btn--primary',
    )
    store.settle(null)
    await flushPromises()
  })

  it('askSource() sans argument n\'affiche pas de 4e bouton (comportement existant inchangé)', async () => {
    const wrapper = mountSheet()
    const store = usePhotoSourceStore()
    store.askSource()
    await flushPromises()
    expect(wrapper.find('[data-test="photo-source-extra"]').exists()).toBe(false)
    store.settle(null)
    await flushPromises()
  })

  it('cliquer le 4e bouton résout à "extra" et ferme la feuille', async () => {
    const wrapper = mountSheet()
    const store = usePhotoSourceStore()
    const p = store.askSource('Depuis le PDF du patron')
    await flushPromises()

    await wrapper.find('[data-test="photo-source-extra"]').trigger('click')
    await expect(p).resolves.toBe('extra')
    expect(store.open).toBe(false)
    expect(wrapper.find('[data-test="photo-source-extra"]').exists()).toBe(false)
  })
})

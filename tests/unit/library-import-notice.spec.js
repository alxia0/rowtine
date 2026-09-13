// Le rappel de prévention d'import (fichiers multi-patrons / livres / >2 colonnes non
// reconnus) a d'abord vécu en petit sous le bouton « Importer un patron PDF » de la
// feuille d'ajout. Il a été retiré le 17/08 : le cas réel est
// maintenant couvert au bon moment par le bloc « Import risqué » de l'écran d'import
// (LocalPdfImportView.vue), qui dit la même chose quand ça arrive vraiment, pas en
// permanence sous un bouton. Ce fichier vérifie que le rappel a bien disparu.
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import fr from '@/i18n/fr.json'
import LibraryView from '@/views/LibraryView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'library', component: { template: '<div/>' } },
    { path: '/p/:id', name: 'pattern', component: { template: '<div/>' } },
    { path: '/i', name: 'import-local', component: { template: '<div/>' } },
  ],
})

describe("LibraryView — la feuille d’ajout n’affiche plus le rappel de prévention", () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("la feuille d’ajout n’affiche plus le rappel sous « Importer un patron PDF »", async () => {
    const w = mount(LibraryView, {
      global: {
        plugins: [createPinia(), i18n, router],
        stubs: { AppHeader: true, ThumbImage: true, PatternForm: true, ConfirmDialog: true, AppIcon: true },
      },
    })
    await flushPromises()
    // Ouvre la feuille « Ajouter un patron ».
    await w.find('.btn--primary').trigger('click')
    await flushPromises()
    // Le rappel de prévention a été retiré : il est maintenant couvert par
    // le bloc « Import risqué » de l'écran d'import (LocalPdfImportView.vue).
    const hint = w.find('.pas__hint')
    expect(hint.exists()).toBe(false)
    // Une classe seule est un angle mort : un élément portant une autre classe mais le
    // même texte y échapperait. On vérifie aussi que le texte lui-même a disparu.
    expect(w.text()).not.toContain('plus de 2 colonnes')
  })
})

import { beforeEach, describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import LibraryView from '@/views/LibraryView.vue'
import AppIcon from '@/components/AppIcon.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

async function mountLib() {
  await db.patterns.clear()
  await db.patterns.add({ name: 'Écharpe gabarit', category: '', reader: { sizeLabels: [], sections: [] } })
  await db.patterns.add({ name: 'Instance projet', ownerProjectId: 3, reader: { sizeLabels: [], sections: [] } })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'library', component: LibraryView },
    { path: '/pattern/:id', name: 'pattern', component: { template: '<div/>' } },
    { path: '/project/new', name: 'project-new', component: { template: '<div/>' } },
  ] })
  router.push('/'); await router.isReady()
  const w = mount(LibraryView, { global: { plugins: [router, i18n, createPinia()] } })
  await flushPromises()
  // `onMounted` attend désormais `settings.load()` (12 lectures Dexie séquentielles, lot du
  // 19/08/2026 — avertissement d'import) AVANT de lancer `patternsStore.load()` : un tour
  // d'horloge réel est nécessaire, `flushPromises()` seul (microtâches) ne suffit plus (même
  // besoin documenté dans tests/unit/home-view.spec.js pour HomeView).
  await new Promise((r) => setTimeout(r, 50))
  await flushPromises()
  return w
}

describe('LibraryView — exclut les instances de projet', () => {
  beforeEach(async () => {
    await db.open()
  })

  it('affiche le gabarit mais pas l\'instance', async () => {
    const w = await mountLib()
    expect(w.text()).toContain('Écharpe gabarit')
    expect(w.text()).not.toContain('Instance projet')
  })

  it('le bouton « Importer un patron PDF » porte l\'icône import (dans la feuille d’ajout)', async () => {
    // Le bouton d'import est un <label> enrobant l'input fichier masqué (tap → sélecteur
    // natif → relais → écran de progression, cf. useImportHandoff) : plus un <button>.
    // (P2) : ce label vit désormais DANS la feuille « Ajouter un patron », plus
    // directement sur l'écran — il faut d'abord ouvrir la feuille pour l'atteindre.
    const w = await mountLib()
    const trigger = w.findAll('button').find((b) => b.text().includes('Ajouter un patron'))
    expect(trigger).toBeTruthy()
    await trigger.trigger('click')
    await flushPromises()
    const btn = w.findAll('label').find((b) => b.text().includes('Importer un patron PDF'))
    expect(btn).toBeTruthy()
    const icon = btn.findComponent(AppIcon)
    expect(icon.exists()).toBe(true)
    expect(icon.props('name')).toBe('import')
  })

  it('un seul bouton d’ajout visible ; le tap ouvre une feuille à 2 choix', async () => {
    const w = await mountLib()

    // Un seul bouton d'ajout au chargement : les anciens boutons ne sont pas
    // directement présents (charte — audit UX du 17/07, décision produit).
    expect(w.findAll('label').some((l) => l.text().includes('Importer un patron PDF'))).toBe(false)
    expect(w.text()).not.toContain('Import IA')
    expect(w.text()).not.toContain('Créer manuellement')
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    const trigger = w.findAll('button').find((b) => b.text().includes('Ajouter un patron'))
    expect(trigger).toBeTruthy()
    await trigger.trigger('click')
    await flushPromises()

    // La feuille est ouverte et porte les 2 choix (Task B3 : le choix IA est retiré ;
    // porte de service du 08/08 : le choix .zip a disparu, fondu dans l'import PDF).
    const dialog = w.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(w.text()).toContain('Importer un patron PDF')
    expect(w.text()).toContain('Créer manuellement')
    expect(w.text()).not.toContain('Import IA')

    // Porte de service (08/08) : la fonction .zip existe toujours, fondue dans l'import PDF,
    // mais RIEN ne doit la nommer dans la feuille. Garde de discrétion.
    expect(w.text()).not.toContain('zip')
    expect(w.text()).not.toContain('.zip')

    // Un seul input fichier désormais (l'import PDF, qui accepte aussi le zip en sous-main),
    // toujours focalisable (pas display:none, pas disabled).
    const inputs = w.findAll('input[type="file"]')
    expect(inputs.length).toBe(1)
    for (const input of inputs) expect(input.attributes('disabled')).toBeUndefined()

    // Revue finale (08/08) : c'est CET input, celui de la feuille « Ajouter un patron »,
    // que l'utilisatrice touche vraiment (le seul autre test d'`accept` du lot porte sur
    // l'input de l'écran /import-local, atteignable seulement en tapant l'URL ou après un
    // abandon). `accept` est une indication au SÉLECTEUR NATIF, sans effet sur une
    // affectation programmatique de fichiers : aucun autre test ne peut compenser si on le
    // casse. Le restreindre au PDF griserait le .zip sur le téléphone de l'utilisatrice et
    // fermerait la porte de service, sans faire échouer aucun test qui pose ses fichiers
    // via `setInputFiles`/`Object.defineProperty` (ils ne lisent jamais `accept`).
    const accept = inputs[0].attributes('accept')
    expect(accept).toContain('pdf')
    expect(accept).toContain('zip')
  })
})

// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { db } from '@/db/db'
import LibraryView from '@/views/LibraryView.vue'
import AppIcon from '@/components/AppIcon.vue'
import { createTestI18n, createTestRouter, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)

let router

async function mountLib() {
  await db.patterns.clear()
  await db.patterns.add({ name: 'Écharpe gabarit', category: '', reader: { sizeLabels: [], sections: [] } })
  await db.patterns.add({ name: 'Instance projet', ownerProjectId: 3, reader: { sizeLabels: [], sections: [] } })
  router = createTestRouter([
    { path: '/', name: 'library', component: LibraryView },
    { path: '/pattern/:id', name: 'pattern', component: { template: '<div/>' } },
    { path: '/project/new', name: 'project-new', component: { template: '<div/>' } },
    { path: '/import-local', name: 'import-local', component: { template: '<div/>' } },
  ])
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

async function openSheet(w) {
  const trigger = w.findAll('button').find((b) => b.text().includes(tk('pattern.add')))
  await trigger.trigger('click')
  await flushPromises()
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
    const trigger = w.findAll('button').find((b) => b.text().includes(tk('pattern.add')))
    expect(trigger).toBeTruthy()
    await trigger.trigger('click')
    await flushPromises()
    const btn = w.findAll('label').find((b) => b.text().includes(tk('pattern.importPdf')))
    expect(btn).toBeTruthy()
    const icon = btn.findComponent(AppIcon)
    expect(icon.exists()).toBe(true)
    expect(icon.props('name')).toBe('import')
  })

  it('un seul bouton d’ajout visible ; le tap ouvre une feuille à 3 choix', async () => {
    const w = await mountLib()

    // Un seul bouton d'ajout au chargement : les anciens boutons ne sont pas
    // directement présents (charte, audit UX du 17/07, décision produit).
    expect(w.findAll('label').some((l) => l.text().includes(tk('pattern.importPdf')))).toBe(false)
    expect(w.text()).not.toContain('Import IA')
    expect(w.text()).not.toContain(tk('pattern.addManual'))
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    await openSheet(w)

    // La feuille est ouverte et porte les 3 choix : PDF, format Rowtine (visible depuis le
    // 23/09), ajout manuel.
    const dialog = w.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-modal')).toBe('true')
    const opts = dialog.findAll('.pas__opt')
    expect(opts.map((o) => o.text())).toEqual([
      tk('pattern.importPdf'),
      tk('pattern.importRowtine'),
      tk('pattern.addManual'),
    ])
    expect(w.text()).not.toContain('Import IA')

    // Deux inputs fichier, toujours focalisables (pas display:none, pas disabled).
    const inputs = w.findAll('input[type="file"]')
    expect(inputs.length).toBe(2)
    for (const input of inputs) expect(input.attributes('disabled')).toBeUndefined()

    // `accept` est une indication au SÉLECTEUR NATIF, sans effet sur une affectation
    // programmatique de fichiers : ces deux assertions sont le seul garde des filtres que
    // l'utilisatrice voit sur son téléphone.
    const pdfInput = dialog.find('.lib-import__input--pdf')
    expect(pdfInput.attributes('accept')).toBe('application/pdf,.pdf')
    const rowtineAccept = dialog.find('.lib-import__input--rowtine').attributes('accept').split(',')
    for (const a of ['.rowtine', '.zip', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream']) {
      expect(rowtineAccept).toContain(a)
    }

    // L'option Rowtine a sa propre icône, distincte de celle de l'import PDF.
    const rowtineIcon = opts[1].findComponent(AppIcon).props('name')
    expect(rowtineIcon).toBeTruthy()
    expect(rowtineIcon).not.toBe(opts[0].findComponent(AppIcon).props('name'))
  })

  it('chaque porte mène à l’écran d’import dans son mode', async () => {
    const pick = async (w, sel, file) => {
      const input = w.find(sel)
      Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
      await input.trigger('change')
      await flushPromises()
    }
    let w = await mountLib()
    await openSheet(w)
    await pick(w, '.lib-import__input--rowtine', new File(['PK'], 'p.rowtine'))
    expect(router.currentRoute.value.name).toBe('import-local')
    expect(router.currentRoute.value.query).toEqual({ format: 'rowtine' })

    w = await mountLib()
    await openSheet(w)
    await pick(w, '.lib-import__input--pdf', new File(['%PDF'], 'p.pdf'))
    expect(router.currentRoute.value.name).toBe('import-local')
    expect(router.currentRoute.value.query).toEqual({})
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import fr from '@/i18n/fr.json'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

// Stub du moteur : renvoie un résultat bloqué (colonnes).
vi.mock('@/utils/pdf-import', () => ({
  parsePdfLocally: vi.fn(async () => ({
    pattern: { name: 'P', reader: { sizeLabels: ['Taille unique'] } },
    reader: { sizeLabels: ['Taille unique'] },
    warnings: [], confidence: { global: 80, level: 'high' }, stats: {},
    scanned: false, blocking: { blocked: true, reasons: ['columns'] }, rejected: null,
  })),
}))

import LocalPdfImportView from '@/views/LocalPdfImportView.vue'
import { useImportHandoff } from '@/stores/import-handoff'
import { usePatternsStore } from '@/stores/patterns'
import { parsePdfLocally } from '@/utils/pdf-import'

const i18n = createTestI18n()
const router = createTestRouter([{ path: '/', name: 'library', component: { template: '<div/>' } }, { path: '/p/:id', name: 'pattern', component: { template: '<div/>' } }])

describe('LocalPdfImportView — blocage réversible', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('affiche l’encart de blocage et ne navigue pas automatiquement', async () => {
    const pinia = createPinia(); setActivePinia(pinia)
    const handoff = useImportHandoff(); handoff.set(new File(['x'], 'a.pdf', { type: 'application/pdf' }))
    // patternsStore.add mocké (résolution microtask pure) : sans ça, l'écriture
    // réelle Dexie/fake-indexeddb franchit plusieurs macrotasks et un seul
    // flushPromises() ne suffit pas à la drainer — le test passerait qu'on ait
    // enlevé la garde ou pas (preuve par mutation invalidée, cf. rapport de tâche).
    vi.spyOn(usePatternsStore(), 'add').mockResolvedValue(1)
    const replace = vi.spyOn(router, 'replace')
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n, router], stubs: { AppHeader: true, AppIcon: true, ImportProgress: true } } })
    await flushPromises()
    expect(w.text()).toContain('Import risqué')
    expect(w.find('.block-anyway').exists()).toBe(true)
    expect(replace).not.toHaveBeenCalled()
  })

  it('« Importer quand même » enregistre, reste sur l’écran, et « Voir le patron » navigue (réversibilité)', async () => {
    // Couvre l'autre moitié de la contrainte « jamais rendre l'import
    // impossible » : le blocage suspend l'AUTOMATISME, pas l'import lui-même.
    const pinia = createPinia(); setActivePinia(pinia)
    const handoff = useImportHandoff(); handoff.set(new File(['x'], 'a.pdf', { type: 'application/pdf' }))
    vi.spyOn(usePatternsStore(), 'add').mockResolvedValue(1)
    const replace = vi.spyOn(router, 'replace')
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n, router], stubs: { AppHeader: true, AppIcon: true, ImportProgress: true } } })
    await flushPromises()
    await w.find('.block-anyway').trigger('click')
    await flushPromises()
    // « Importer quand même » enregistre, mais ne navigue pas tout seul.
    expect(replace).not.toHaveBeenCalled()
    expect(w.text()).toContain(fr.importLocal.summaryTitle)
    // Le bloc « Import risqué » et son bouton doivent avoir disparu : sans ça, il resterait
    // affiché à côté du bloc de réussite, un mensonge d'interface (trouvé à la relecture,
    // 18/08 — cf. le correctif qui ajoute `&& savedId == null` à sa condition).
    expect(w.text()).not.toContain('Import risqué')
    expect(w.find('.block-anyway').exists()).toBe(false)
    const viewBtn = w.findAll('button').find((b) => b.text().includes(fr.importLocal.viewPattern))
    await viewBtn.trigger('click')
    expect(replace).toHaveBeenCalledWith({ name: 'pattern', params: { id: 1 } })
  })

  // Preuve par mutation (tâche T1, isSingleSize) : variante en minuscules (patron.md
  // modifié à la main). Avec l'ancien `reader.sizeLabels[0] === 'Taille unique'` strict,
  // currentPattern().sizes resterait ['taille unique'] au lieu de [] — cette assertion
  // échouerait au rouge si LocalPdfImportView.vue n'était pas branché sur isSingleSize.
  it('« Importer quand même » avec une variante « taille unique » (minuscules) → sizes vide aussi', async () => {
    parsePdfLocally.mockResolvedValueOnce({
      pattern: { name: 'P', reader: { sizeLabels: ['taille unique'] } },
      reader: { sizeLabels: ['taille unique'] },
      warnings: [], confidence: { global: 80, level: 'high' }, stats: {},
      scanned: false, blocking: { blocked: true, reasons: ['columns'] }, rejected: null,
    })
    const pinia = createPinia(); setActivePinia(pinia)
    const handoff = useImportHandoff(); handoff.set(new File(['x'], 'a.pdf', { type: 'application/pdf' }))
    const add = vi.spyOn(usePatternsStore(), 'add').mockResolvedValue(1)
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n, router], stubs: { AppHeader: true, AppIcon: true, ImportProgress: true } } })
    await flushPromises()
    await w.find('.block-anyway').trigger('click')
    await flushPromises()
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ sizes: [] }))
  })

  it('variante A : plusieurs patrons → refus net, message réécrit, rien d’enregistré, pas de forçage', async () => {
    parsePdfLocally.mockResolvedValueOnce({
      pattern: null, reader: null, warnings: [], confidence: null, stats: null, blocking: null,
      scanned: false, notPattern: false, notPatternReason: null, rejected: { reason: 'multiPattern', detail: null },
    })
    const pinia = createPinia(); setActivePinia(pinia)
    const handoff = useImportHandoff(); handoff.set(new File(['x'], 'a.pdf', { type: 'application/pdf' }))
    const add = vi.spyOn(usePatternsStore(), 'add').mockResolvedValue(1)
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n, router], stubs: { AppHeader: true, AppIcon: true, ImportProgress: true } } })
    await flushPromises()
    expect(w.text()).toContain(fr.importLocal.blockMultiPattern)
    expect(w.text()).not.toContain(fr.importLocal.blockTitle)
    expect(w.find('.block-anyway').exists()).toBe(false)
    expect(add).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom
// Preuve avec un VRAI routeur (pas un espion) que le bouton « Prévisualiser le
// patron » laisse le bon historique de navigation : le bouton retour du lecteur doit
// ramener sur la fiche du patron (où l'on crée le projet), jamais sur l'écran d'import.
//
// POURQUOI UN VRAI ROUTEUR ICI, comme dans local-pdf-import-retour-guide.spec.js (même
// remarque) : local-pdf-import-view.spec.js et local-pdf-import-bilan.spec.js mockent
// vue-router, donc `router.replace`/`push` n'y sont que des espions — un `await` manquant
// devant `router.replace` (previewPattern, LocalPdfImportView.vue) y serait invisible,
// puisque le mock ne modélise aucune sérialisation de navigations concurrentes. Ce fichier
// mord précisément ce défaut-là (vérifié par mutation, cf. le commentaire de previewPattern).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import fr from '@/i18n/fr.json'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

vi.mock('@/utils/pdf-import', () => ({ parsePdfLocally: vi.fn() }))

import { parsePdfLocally } from '@/utils/pdf-import'
import LocalPdfImportView from '@/views/LocalPdfImportView.vue'
import { usePatternsStore } from '@/stores/patterns'

const i18n = createTestI18n()
const stubs = { AppHeader: true, AppIcon: true }

const okResultAvecSection = () => ({
  scanned: false,
  pattern: { name: 'Pull torsadé', photos: [] },
  reader: {
    sizeLabels: [],
    sections: [{ id: 'corps', kind: 'body', title: 'Corps', steps: [{ text: 'Monter 80 mailles.' }] }],
    reference: {},
  },
  warnings: [],
  confidence: { global: 90, level: 'high', bySection: {} },
  stats: {},
})

const App = { template: '<RouterView />' }

function creerRouteur() {
  return createTestRouter([
    { path: '/', name: 'library', component: { template: '<div class="library-stub" />' } },
    { path: '/import', name: 'import-local', component: LocalPdfImportView },
    { path: '/p/:id', name: 'pattern', component: { template: '<div class="pattern-stub" />' } },
    { path: '/p/:id/read', name: 'pattern-read', component: { template: '<div class="reader-stub" />' } },
  ])
}

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
}

function boutonParTexte(w, texte) {
  return w.findAll('button').find((b) => b.text().includes(texte))
}

beforeEach(() => {
  setActivePinia(createPinia())
  parsePdfLocally.mockReset().mockResolvedValue(okResultAvecSection())
})

describe('« Prévisualiser le patron » — historique de navigation (vrai routeur)', () => {
  it('le retour du lecteur ramène sur la fiche, puis la bibliothèque — jamais sur l’écran d’import', async () => {
    vi.spyOn(usePatternsStore(), 'add').mockResolvedValue(9)

    const router = creerRouteur()
    router.push('/')
    await router.isReady()
    router.push('/import')
    await settle()
    const w = mount(App, { global: { plugins: [i18n, router], stubs } })
    await settle()

    const input = w.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'pull.pdf')], configurable: true })
    await input.trigger('change')
    await settle()

    const previewBtn = boutonParTexte(w, fr.pattern.preview)
    expect(previewBtn).toBeTruthy() // précondition : le patron a une section, le bouton principal a changé
    await previewBtn.trigger('click')
    await settle()

    // LE CŒUR : previewPattern fait `await router.replace(...)` PUIS `router.push(...)` —
    // on atterrit bien sur le lecteur, avec l'écran d'import RETIRÉ de l'historique par le
    // replace (pas empilé par-dessus).
    expect(router.currentRoute.value.name).toBe('pattern-read')
    expect(router.currentRoute.value.params.id).toBe('9')

    router.back()
    await settle()
    // La fiche, pas l'écran d'import : c'est elle que le replace a mise à sa place.
    expect(router.currentRoute.value.name).toBe('pattern')
    expect(router.currentRoute.value.params.id).toBe('9')

    router.back()
    await settle()
    // Encore un cran : la bibliothèque, d'où tout est parti — l'écran d'import n'est plus
    // du tout dans l'historique.
    expect(router.currentRoute.value.name).toBe('library')
  })
})

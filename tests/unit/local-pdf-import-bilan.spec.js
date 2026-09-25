// @vitest-environment jsdom
// Refonte du bloc de succès (lot du 23/09/2026) — le bilan du patron enregistré (carte
// verte : sections/étapes/tailles/diagrammes) et le repli du bouton d'action principal.
// Le calcul lui-même (summarizeImportedPattern) est couvert isolément par
// tests/unit/import-summary.spec.js ; ici, on vérifie le CÂBLAGE avec l'écran — d'où un
// fichier à part (un fichier par comportement, cf. les contraintes globales), plutôt qu'un
// describe de plus dans local-pdf-import-view.spec.js.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import fr from '@/i18n/fr.json'
import { createTestI18n } from './helpers/i18n-router'

vi.mock('@/utils/pdf-import', () => ({ parsePdfLocally: vi.fn() }))
// Même montage que local-pdf-import-view.spec.js : router mocké (espion), pas de vrai
// routeur — la preuve de l'ORDRE replace/push (back() ramène sur la fiche, pas sur l'écran
// d'import) vit à part, dans local-pdf-import-preview-nav.spec.js, avec un vrai routeur.
const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => router }))
import { parsePdfLocally } from '@/utils/pdf-import'
import LocalPdfImportView from '@/views/LocalPdfImportView.vue'
import { usePatternsStore } from '@/stores/patterns'

const i18n = createTestI18n()
const stubs = { AppHeader: true, AppIcon: true }

const okResult = (overrides = {}) => ({
  scanned: false,
  pattern: { name: 'Pull', photos: [] },
  reader: { sizeLabels: [], sections: [], reference: {} },
  warnings: [],
  confidence: { global: 90, level: 'high', bySection: {} },
  stats: {},
  ...overrides,
})

function mountViewWithSavedId(id) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
  usePatternsStore(pinia).add.mockResolvedValue(id)
  return { w, pinia }
}

function findButtonByText(w, text) {
  return w.findAll('button').find((b) => b.text().includes(text))
}

async function pick(wrapper, file = new File(['x'], 'pull.pdf')) {
  const input = wrapper.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

// Section « normale » à N rangs cochables — même forme que tests/unit/import-summary.spec.js.
function rowSection(id, title, n) {
  return { id, kind: 'body', title, steps: Array.from({ length: n }, () => ({ text: 'x' })) }
}
function chartSection(id, title) {
  return {
    id,
    kind: 'diagramme',
    title,
    steps: [{ chart: true }],
    chart: { rows: 0, cols: 0, img: 'data:image/png;base64,X', repeat: '', readDir: '', builtinLegend: false },
  }
}
function tileTexts(w) {
  const vals = w.findAll('.done__tile-val').map((e) => e.text())
  const labels = w.findAll('.done__tile-label').map((e) => e.text())
  return vals.map((v, i) => `${v} ${labels[i]}`)
}

describe('bloc de réussite : bilan du patron', () => {
  it('affiche les compteurs calculés depuis le reader (sections, étapes, tailles)', async () => {
    parsePdfLocally.mockResolvedValue(
      okResult({
        reader: {
          sizeLabels: ['S', 'M'],
          sections: [rowSection('corps', 'Corps', 3), rowSection('manches', 'Manches', 2)],
          reference: {},
        },
      }),
    )
    const { w } = mountViewWithSavedId(20)
    await pick(w)
    const texts = tileTexts(w)
    expect(texts.some((t) => /^2 /.test(t) && t.includes('section'))).toBe(true) // 2 sections
    expect(texts.some((t) => /^5 /.test(t) && t.includes('étape'))).toBe(true) // 3 + 2 étapes
    expect(texts.some((t) => /^2 /.test(t) && t.includes('taille'))).toBe(true) // 2 tailles
  })

  it('la tuile diagrammes n’apparaît que si le patron en a au moins un', async () => {
    parsePdfLocally.mockResolvedValue(
      okResult({ reader: { sizeLabels: ['M'], sections: [rowSection('corps', 'Corps', 1)], reference: {} } }),
    )
    const { w: sansDiagramme } = mountViewWithSavedId(21)
    await pick(sansDiagramme)
    expect(sansDiagramme.text()).not.toContain(fr.importLocal.summary.charts.split(' | ')[0])

    parsePdfLocally.mockResolvedValue(
      okResult({
        reader: {
          sizeLabels: ['M'],
          sections: [rowSection('corps', 'Corps', 1), chartSection('diagramme-1', 'Diagramme 1')],
          reference: {},
        },
      }),
    )
    const { w: avecDiagramme } = mountViewWithSavedId(22)
    await pick(avecDiagramme)
    const texts = tileTexts(avecDiagramme)
    expect(texts.some((t) => /^1 /.test(t) && t.includes('diagramme'))).toBe(true)
  })

  it('taille unique : la tuile affiche « 1 » et le libellé dédié, pas le pluriel générique', async () => {
    parsePdfLocally.mockResolvedValue(
      okResult({ reader: { sizeLabels: ['Taille unique'], sections: [rowSection('corps', 'Corps', 1)], reference: {} } }),
    )
    const { w } = mountViewWithSavedId(23)
    await pick(w)
    const texts = tileTexts(w)
    expect(texts.some((t) => t === '1 taille unique')).toBe(true)
  })

  // Repli sans aucune taille (ni tailles réelles, ni sentinelle « Taille unique ») : cas
  // limite non couvert ailleurs — la tuile affiche « 0 taille » (pluriel générique, forme
  // 0), elle n'est jamais masquée (contrairement aux diagrammes).
  it('aucune taille (ni sentinelle) : la tuile affiche « 0 taille »', async () => {
    parsePdfLocally.mockResolvedValue(
      okResult({ reader: { sizeLabels: [], sections: [rowSection('corps', 'Corps', 1)], reference: {} } }),
    )
    const { w } = mountViewWithSavedId(26)
    await pick(w)
    const texts = tileTexts(w)
    expect(texts.some((t) => t === '0 taille')).toBe(true)
  })

  it('un patron avec sections : le bouton principal « Prévisualiser le patron » navigue en replace PUIS push', async () => {
    parsePdfLocally.mockResolvedValue(
      okResult({ reader: { sizeLabels: [], sections: [rowSection('corps', 'Corps', 1)], reference: {} } }),
    )
    router.replace.mockClear()
    router.push.mockClear()
    const { w } = mountViewWithSavedId(24)
    await pick(w)
    const previewBtn = findButtonByText(w, fr.pattern.preview)
    expect(previewBtn).toBeTruthy() // précondition : le bouton principal a bien changé de libellé
    expect(findButtonByText(w, fr.importLocal.viewPattern)).toBeUndefined() // pas les deux à la fois
    await previewBtn.trigger('click')
    await flushPromises()
    expect(router.replace).toHaveBeenCalledWith({ name: 'pattern', params: { id: 24 } })
    expect(router.push).toHaveBeenCalledWith({ name: 'pattern-read', params: { id: 24 } })
  })

  it('un patron SANS section ni galerie retombe sur « Voir le patron » (repli)', async () => {
    // okResult() par défaut : reader.sections vide, pattern.photos vide, pas de gallery —
    // rien à prévisualiser.
    parsePdfLocally.mockResolvedValue(okResult())
    const { w } = mountViewWithSavedId(25)
    await pick(w)
    expect(findButtonByText(w, fr.importLocal.viewPattern)).toBeTruthy()
    expect(findButtonByText(w, fr.pattern.preview)).toBeUndefined()
  })
})

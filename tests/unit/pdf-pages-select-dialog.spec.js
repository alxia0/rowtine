// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import fr from '@/i18n/fr.json'
import { createTestI18n } from './helpers/i18n-router'

vi.mock('@/utils/pdf', () => ({ renderPdfThumbnails: vi.fn() }))
import { renderPdfThumbnails } from '@/utils/pdf'
import PdfPagesSelectDialog from '@/components/PdfPagesSelectDialog.vue'

const i18n = createTestI18n()
const FILE = new Blob(['x'], { type: 'application/pdf' })

function mountDialog(props = {}) {
  return mount(PdfPagesSelectDialog, {
    props: { open: true, file: FILE, ...props },
    global: { plugins: [i18n], stubs: { AppIcon: true } },
  })
}
const pageButtons = (w) => w.findAll('button[aria-pressed]')
const confirmButton = (w) => w.findAll('button').find((b) => b.text().includes(fr.pagesSelect.confirm))

beforeEach(() => {
  renderPdfThumbnails.mockReset()
  renderPdfThumbnails.mockImplementation(async (file, { onCount, onThumb }) => {
    onCount(3)
    for (let n = 1; n <= 3; n++) onThumb(n, `data:image/jpeg;base64,P${n}`)
  })
})

describe('PdfPagesSelectDialog', () => {
  // Protège : fermé, rien n'est monté ni rendu.
  it('open:false → aucun dialogue, aucun rendu', () => {
    const w = mountDialog({ open: false })
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(renderPdfThumbnails).not.toHaveBeenCalled()
  })

  // Protège : une case par page, nommée « Page N », non cochée au départ, import désactivé.
  it('affiche une case par page, rien de coché, bouton d’import désactivé', async () => {
    const w = mountDialog()
    await flushPromises()
    const btns = pageButtons(w)
    expect(btns).toHaveLength(3)
    expect(btns[1].attributes('aria-label')).toBe('Page 2')
    expect(btns.every((b) => b.attributes('aria-pressed') === 'false')).toBe(true)
    expect(confirmButton(w).attributes('disabled')).toBeDefined()
  })

  // Protège : l'ordre des clics ne fait pas l'ordre d'import, et le compteur suit.
  it('bascule, compte, et rend les pages triées à la validation', async () => {
    const w = mountDialog()
    await flushPromises()
    await pageButtons(w)[2].trigger('click')
    await pageButtons(w)[0].trigger('click')
    expect(pageButtons(w)[2].attributes('aria-pressed')).toBe('true')
    expect(w.text()).toContain('2 pages choisies')
    await confirmButton(w).trigger('click')
    expect(w.emitted('confirm')).toEqual([[[1, 3]]])
    expect(w.emitted('update:open')).toEqual([[false]])
  })

  // Protège : décocher retire la page.
  it('un second tap décoche', async () => {
    const w = mountDialog()
    await flushPromises()
    await pageButtons(w)[1].trigger('click')
    await pageButtons(w)[1].trigger('click')
    expect(pageButtons(w)[1].attributes('aria-pressed')).toBe('false')
    expect(confirmButton(w).attributes('disabled')).toBeDefined()
  })

  // Protège : fermer n'émet aucune sélection et arrête le rendu en cours.
  it('fermer émet update:open false sans confirm, et annule le rendu', async () => {
    let cancelled
    renderPdfThumbnails.mockImplementation(async (file, { onCount, isCancelled }) => {
      onCount(3)
      cancelled = isCancelled
    })
    const w = mountDialog()
    await flushPromises()
    await w.find('button[aria-label="' + fr.common.close + '"]').trigger('click')
    expect(w.emitted('confirm')).toBeUndefined()
    expect(w.emitted('update:open')).toEqual([[false]])
    await w.setProps({ open: false })
    expect(cancelled()).toBe(true)
  })

  // Protège : rouvrir repart d'une sélection vide.
  it('rouvrir remet la sélection à zéro', async () => {
    const w = mountDialog()
    await flushPromises()
    await pageButtons(w)[0].trigger('click')
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    await flushPromises()
    expect(pageButtons(w).every((b) => b.attributes('aria-pressed') === 'false')).toBe(true)
  })

  // Protège : une sélection initiale est reprise cochée, et validable sans autre geste.
  it('ouvert avec initial [3, 1] → pages 1 et 3 cochées, compteur 2, confirm rend [1, 3]', async () => {
    const w = mountDialog({ initial: [3, 1] })
    await flushPromises()
    expect(pageButtons(w).map((b) => b.attributes('aria-pressed'))).toEqual(['true', 'false', 'true'])
    expect(w.text()).toContain('2 pages choisies')
    await confirmButton(w).trigger('click')
    expect(w.emitted('confirm')).toEqual([[[1, 3]]])
  })

  // Protège : un PDF illisible le dit au lieu d'afficher une grille vide.
  it('rendu en échec → message d’erreur', async () => {
    renderPdfThumbnails.mockRejectedValue(new Error('x'))
    const w = mountDialog()
    await flushPromises()
    expect(w.text()).toContain(fr.pagesSelect.error)
  })
})

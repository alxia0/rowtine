// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// On mocke directement les fonctions utils/pdf consommées par l'orchestrateur local,
// pour piloter pages texte + images positionnées sans pdfjs réel.
vi.mock('@/utils/pdf', () => ({
  extractPages: vi.fn(),
  renderPdfPageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,PHOTO'),
  extractImagesWithPos: vi.fn(),
  readFileAsDataUrl: vi.fn().mockResolvedValue('data:application/pdf;base64,PDF'),
}))
import { extractPages, extractImagesWithPos } from '@/utils/pdf'
import { parsePdfLocally } from '@/utils/pdf-import'

const FILE = { name: 'patron.pdf', arrayBuffer: async () => new ArrayBuffer(8) }

beforeEach(() => {
  // Deux pages « riches » (assez de caractères pour ne pas être vues comme scannées)
  // avec une ligne d'instruction distinctive et une position y connue.
  const line = { text: 'Rabattre toutes les mailles souplement pour finir le bord.', y: 400, size: 10, bold: false }
  const filler = Array.from({ length: 12 }, (_, i) => ({ text: `Instruction de remplissage numero ${i} avec du texte.`, y: 700 - i * 10, size: 10, bold: false }))
  vi.mocked(extractPages).mockResolvedValue([[...filler, line], [...filler]])
  vi.mocked(extractImagesWithPos).mockResolvedValue([
    { src: 'data:image/png;base64,LINKED', page: 1, x: 40, y: 370, w: 300, h: 200 },
  ])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('parsePdfLocally — association image ↔ ligne (#5)', () => {
  it('relie l’image à la ligne d’instruction et la retire de la galerie', async () => {
    const { pattern, reader } = await parsePdfLocally(FILE)
    const withImg = reader.sections.flatMap((s) => s.steps).filter((st) => st.imgs && st.imgs.length)
    expect(withImg.length).toBeGreaterThanOrEqual(1)
    expect(withImg[0].imgs).toContain('data:image/png;base64,LINKED')
    // reliée ⇒ absente de la galerie
    expect(pattern.gallery.some((g) => g.src === 'data:image/png;base64,LINKED')).toBe(false)
  })

  it('best-effort : extractImagesWithPos en échec → galerie vide, import intact', async () => {
    vi.mocked(extractImagesWithPos).mockRejectedValueOnce(new Error('worker KO'))
    const { pattern, reader } = await parsePdfLocally(FILE)
    expect(pattern.gallery).toEqual([])
    expect(reader.sections.length).toBeGreaterThanOrEqual(1)
  })
})

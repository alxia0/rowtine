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
import { extractPages, extractImagesWithPos, renderPdfPageToDataUrl } from '@/utils/pdf'
import { parsePdfLocally } from '@/utils/pdf-import'

const FILE = { name: 'patron.pdf', arrayBuffer: async () => new ArrayBuffer(8) }

beforeEach(() => {
  // Deux pages « riches » (assez de caractères pour ne pas être vues comme scannées)
  // avec une ligne d'instruction distinctive et une position y connue, en page 2 (la
  // couverture rendue avec succès exclut déjà la page 1 du fil, cf. tests dédiés plus bas).
  const line = { text: 'Rabattre toutes les mailles souplement pour finir le bord.', y: 400, size: 10, bold: false }
  const filler = Array.from({ length: 12 }, (_, i) => ({ text: `Instruction de remplissage numero ${i} avec du texte.`, y: 700 - i * 10, size: 10, bold: false }))
  vi.mocked(extractPages).mockResolvedValue([[...filler], [...filler, line]])
  vi.mocked(extractImagesWithPos).mockResolvedValue([
    { src: 'data:image/png;base64,LINKED', page: 2, x: 40, y: 370, w: 300, h: 200 },
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

  // Couverture rendue (page 1) : ses images ne vont plus dans le fil, elles restent en galerie.
  it('couverture rendue : une image de la page 1 reste en galerie (déjà dans la couverture)', async () => {
    const line = { text: 'Rabattre toutes les mailles souplement pour finir le bord.', y: 400, size: 10, bold: false }
    const filler = Array.from({ length: 12 }, (_, i) => ({ text: `Instruction de remplissage numero ${i} avec du texte.`, y: 700 - i * 10, size: 10, bold: false }))
    vi.mocked(extractPages).mockResolvedValueOnce([[...filler, line], [...filler]])
    vi.mocked(extractImagesWithPos).mockResolvedValueOnce([{ src: 'data:image/png;base64,COVERPIC', page: 1, x: 40, y: 370, w: 300, h: 200 }])
    const { pattern, reader } = await parsePdfLocally(FILE)
    expect(reader.sections.flatMap((s) => s.steps).some((st) => (st.imgs || []).includes('data:image/png;base64,COVERPIC'))).toBe(false)
    expect(pattern.gallery.some((g) => g.src === 'data:image/png;base64,COVERPIC')).toBe(true)
  })

  // PDF d'une seule page : c'est le patron, pas une couverture à part ; ses images restent dans le fil.
  it('PDF d’une seule page, couverture rendue : l’image de la page 1 reste rattachée à sa ligne', async () => {
    const line = { text: 'Rabattre toutes les mailles souplement pour finir le bord.', y: 400, size: 10, bold: false }
    const filler = Array.from({ length: 12 }, (_, i) => ({ text: `Instruction de remplissage numero ${i} avec du texte.`, y: 700 - i * 10, size: 10, bold: false }))
    vi.mocked(extractPages).mockResolvedValueOnce([[...filler, line]])
    vi.mocked(extractImagesWithPos).mockResolvedValueOnce([{ src: 'data:image/png;base64,ONEPAGE', page: 1, x: 40, y: 370, w: 300, h: 200 }])
    const { pattern, reader } = await parsePdfLocally(FILE)
    expect(reader.sections.flatMap((s) => s.steps).some((st) => (st.imgs || []).includes('data:image/png;base64,ONEPAGE'))).toBe(true)
    expect(pattern.gallery.some((g) => g.src === 'data:image/png;base64,ONEPAGE')).toBe(false)
  })

  // Couverture rognée (photo et titre seuls) : une image de page 1 hors du cadre n'y est plus visible, elle suit le fil.
  it('couverture rognée : la photo du cadre reste en galerie, une image hors cadre suit le fil', async () => {
    const line = { text: 'Rabattre toutes les mailles souplement pour finir le bord.', y: 400, size: 10, bold: false }
    const filler = Array.from({ length: 12 }, (_, i) => ({ text: `Instruction de remplissage numero ${i} avec du texte.`, y: 700 - i * 10, size: 10, bold: false }))
    vi.mocked(extractPages).mockResolvedValueOnce([[...filler, line], [...filler]])
    vi.mocked(extractImagesWithPos).mockResolvedValueOnce([
      { src: 'data:image/png;base64,HERO', page: 1, x: 0, y: 595, w: 257, h: 437 },
      { src: 'data:image/png;base64,EXTRA', page: 1, x: 200, y: 370, w: 150, h: 100 },
    ])
    vi.mocked(renderPdfPageToDataUrl).mockImplementationOnce(async (f, n, w, opts) => {
      expect(opts.crop(391, 595)).not.toBeNull()
      return 'data:image/jpeg;base64,CROPPED'
    })
    const { pattern, reader } = await parsePdfLocally(FILE)
    const steps = reader.sections.flatMap((s) => s.steps)
    expect(pattern.photos).toEqual(['data:image/jpeg;base64,CROPPED'])
    expect(steps.some((st) => (st.imgs || []).includes('data:image/png;base64,EXTRA'))).toBe(true)
    expect(pattern.gallery.some((g) => g.src === 'data:image/png;base64,HERO')).toBe(true)
  })

  // Ordre de lecture (haut de page d'abord) : imgs empile dans cet ordre, pas dans l'ordre d'extraction.
  it('deux images sous la même ligne, fournies à l’envers : imgs respecte l’ordre de lecture', async () => {
    vi.mocked(extractImagesWithPos).mockResolvedValueOnce([
      { src: 'data:image/png;base64,LOW', page: 2, x: 40, y: 280, w: 300, h: 200 },
      { src: 'data:image/png;base64,HIGH', page: 2, x: 200, y: 390, w: 300, h: 200 },
    ])
    const { reader } = await parsePdfLocally(FILE)
    const withImg = reader.sections.flatMap((s) => s.steps).find((st) => st.imgs && st.imgs.length)
    expect(withImg.imgs).toEqual(['data:image/png;base64,HIGH', 'data:image/png;base64,LOW'])
  })

  // Repli : rendu de couverture en échec → page 1 traitée comme avant, image rattachée normalement.
  it('rendu de couverture en échec : une image de la page 1 reste rattachée à sa ligne', async () => {
    const line = { text: 'Rabattre toutes les mailles souplement pour finir le bord.', y: 400, size: 10, bold: false }
    const filler = Array.from({ length: 12 }, (_, i) => ({ text: `Instruction de remplissage numero ${i} avec du texte.`, y: 700 - i * 10, size: 10, bold: false }))
    vi.mocked(extractPages).mockResolvedValueOnce([[...filler, line], [...filler]])
    vi.mocked(extractImagesWithPos).mockResolvedValueOnce([{ src: 'data:image/png;base64,COVERPIC', page: 1, x: 40, y: 370, w: 300, h: 200 }])
    vi.mocked(renderPdfPageToDataUrl).mockRejectedValueOnce(new Error('rendu KO'))
    const { reader } = await parsePdfLocally(FILE)
    expect(reader.sections.flatMap((s) => s.steps).some((st) => (st.imgs || []).includes('data:image/png;base64,COVERPIC'))).toBe(true)
  })
})

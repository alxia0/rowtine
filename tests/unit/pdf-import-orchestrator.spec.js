// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/utils/pdf', () => ({
  extractPages: vi.fn(),
  extractDocMetaTitle: vi.fn().mockResolvedValue(''),
  renderPdfPageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,xxx'),
  extractImagesWithPos: vi.fn(),
  extractVectorRegions: vi.fn().mockResolvedValue([]),
  readFileAsDataUrl: vi.fn(),
}))
import { extractPages, extractDocMetaTitle, renderPdfPageToDataUrl, extractImagesWithPos, readFileAsDataUrl } from '@/utils/pdf'
import { parsePdfLocally } from '@/utils/pdf-import'

const L = (text, o = {}) => ({ text, size: 10, bold: false, y: 0, ...o })
const FILE = { name: 'pull.pdf' }

beforeEach(() => vi.clearAllMocks())

// Page nominale : assez de texte pour passer le seuil « scanné » (≥ 50 car./page).
const NOMINAL = [[
  L('Pull Exemple', { size: 22 }),
  L('Corps', { bold: true }),
  L('Rang 1 : tricoter toutes les mailles à l’endroit.'),
  L('Rang 2 : tricoter toutes les mailles à l’envers.'),
]]

describe('parsePdfLocally', () => {
  it('parcours nominal : reader + photo de couverture', async () => {
    extractPages.mockResolvedValue(NOMINAL)
    const out = await parsePdfLocally(FILE)
    expect(out.scanned).toBe(false)
    expect(out.pattern.photos).toEqual(['data:image/jpeg;base64,xxx'])
    expect(renderPdfPageToDataUrl).toHaveBeenCalledWith(FILE, 1, 800)
  })

  // Câblage CÔTÉ APP (spaced-title) : la fiche d'identité du PDF, extraite via
  // extractDocMetaTitle (src/utils/pdf.js), doit atteindre buildReaderFromPages pour
  // recoller un titre de couverture écrit lettre par lettre. Sans ce témoin, un banc vert
  // ne prouve rien du chemin APP (cf. node.mjs, câblé et testé séparément côté banc) : une
  // app cassée (getMetadata indisponible, wiring défait) resterait invisible ici, puisque
  // le double garde-fou best-effort (extractDocMetaTitle + le try/catch de l'orchestrateur)
  // absorbe silencieusement toute erreur.
  it('passe la fiche d’identite du PDF au coeur : titre interlettre recolle (cablage APP)', async () => {
    extractPages.mockResolvedValue([[
      L('M I A C A R D I G A N', { size: 28.1, y: 753.8 }),
      L('Share your version of the Mia Cardigan on social media with hashtags', { y: 200 }),
    ], [
      L('Sizes:', { y: 780 }),
      L('Rang 1 : tricoter toutes les mailles à l’endroit.', { y: 766 }),
    ]])
    extractDocMetaTitle.mockResolvedValue('Microsoft Word - Mia Cardigan (English) v1.1.docx')
    const out = await parsePdfLocally(FILE)
    expect(out.pattern.name).toBe('Mia Cardigan')
  })

  it('émet les phases de progression (extract → parse → images → assemble)', async () => {
    extractPages.mockResolvedValue(NOMINAL)
    extractImagesWithPos.mockResolvedValue([])
    const phases = []
    await parsePdfLocally(FILE, { onProgress: (e) => phases.push(e.phase) })
    expect(phases).toContain('extract')
    expect(phases).toContain('parse')
    expect(phases).toContain('images')
    expect(phases).toContain('assemble')
    // extract vient avant images
    expect(phases.indexOf('extract')).toBeLessThan(phases.indexOf('images'))
  })
  it('PDF scanné (texte quasi nul) → rejected scanned, scanned:true, pas de pattern', async () => {
    extractPages.mockResolvedValue([[L('x')], []])
    const out = await parsePdfLocally(FILE)
    expect(out.rejected).toEqual({ reason: 'scanned', detail: null })
    expect(out.scanned).toBe(true)
    expect(out.pattern).toBeNull()
  })
  it('pas un patron (notice de couture) → refus AVANT l’assemblage : ni images, ni lecture du PDF', async () => {
    extractPages.mockResolvedValue([[
      L('Robe Capucine', { size: 22 }),
      L('Valeurs de couture de 1 cm comprises.'),
      L('Placer les pièces sur le droit-fil du tissu.'),
      L('Coudre endroit contre endroit, puis surfiler les bords.'),
      L('Entoilage thermocollant : 50 cm.'),
    ]])
    const out = await parsePdfLocally(FILE)
    expect(out.rejected).toEqual({ reason: 'notPattern', detail: 'otherCraft' })
    expect(out.notPattern).toBe(true)
    expect(out.notPatternReason).toBe('otherCraft')
    expect(out.scanned).toBe(false)
    expect(out.pattern).toBeNull()
    expect(out.blocking).toBeNull()
    expect(extractImagesWithPos).not.toHaveBeenCalled()
    expect(readFileAsDataUrl).not.toHaveBeenCalled()
  })
  it('parcours nominal : rejected null, notPattern false, multiPattern jamais dans blocking en variante A', async () => {
    extractPages.mockResolvedValue(NOMINAL)
    const out = await parsePdfLocally(FILE)
    expect(out.rejected).toBeNull()
    expect(out.notPattern).toBe(false)
    expect(out.notPatternReason).toBeNull()
    expect(out.blocking.reasons).not.toContain('multiPattern')
  })
  it('repli extraction impossible : rejected null (ce n’est pas un refus)', async () => {
    extractPages.mockRejectedValue(new Error('worker indisponible'))
    const out = await parsePdfLocally(FILE)
    expect(out.rejected).toBeNull()
  })
  it('échec du rendu de couverture toléré (best-effort)', async () => {
    extractPages.mockResolvedValue(NOMINAL)
    renderPdfPageToDataUrl.mockRejectedValue(new Error('canvas'))
    const out = await parsePdfLocally(FILE)
    expect(out.pattern.photos).toEqual([])
  })
  it('échec total d’extraction → repli : patron au nom du fichier (spec §8)', async () => {
    extractPages.mockRejectedValue(new Error('worker indisponible'))
    const out = await parsePdfLocally(FILE)
    expect(out.scanned).toBe(false)
    expect(out.pattern.name).toBe('pull')
    expect(out.pattern.source).toContain('texte non extrait')
    expect(out.confidence.level).toBe('low')
  })
  it('échec d’extraction mais lecture fichier OK → le repli retient quand même le PDF', async () => {
    extractPages.mockRejectedValue(new Error('worker indisponible'))
    readFileAsDataUrl.mockResolvedValue('data:application/pdf;base64,PDF')
    const out = await parsePdfLocally(FILE)
    expect(out.pattern.pdf).toBe('data:application/pdf;base64,PDF')
    expect(out.pattern.gallery).toEqual([])
  })
  it('alimente pattern.pdf et pattern.gallery (best-effort)', async () => {
    extractPages.mockResolvedValue(NOMINAL)
    readFileAsDataUrl.mockResolvedValue('data:application/pdf;base64,PDF')
    // Image très haut de page (y=5000) : aucune ligne d'ancrage au-dessus → reste en galerie
    // (x,y retirés par associateImages).
    extractImagesWithPos.mockResolvedValue([{ src: 'data:image/png;base64,IMG', page: 1, x: 0, y: 5000, w: 400, h: 300 }])
    const out = await parsePdfLocally(FILE)
    expect(out.pattern.pdf).toBe('data:application/pdf;base64,PDF')
    expect(out.pattern.gallery).toEqual([{ src: 'data:image/png;base64,IMG', page: 1, w: 400, h: 300 }])
  })
  it('reste best-effort si pdf/images échouent', async () => {
    extractPages.mockResolvedValue(NOMINAL)
    readFileAsDataUrl.mockRejectedValue(new Error('x'))
    extractImagesWithPos.mockRejectedValue(new Error('y'))
    const out = await parsePdfLocally(FILE)
    expect(out.pattern.pdf).toBe('')
    expect(out.pattern.gallery).toEqual([])
  })

  // (E — Cella) : extractImagesWithPos classe désormais certaines images raster kind:'grid'.
  // Elles doivent suivre le même sort que les grilles vectorielles : promotion en
  // section diagramme INTERACTIVE, pas simple image de galerie/ancrage.
  it('image raster kind:grid → promue en diagramme interactif ; image simple → galerie ; pas de doublon (E)', async () => {
    extractPages.mockResolvedValue(NOMINAL)
    extractImagesWithPos.mockResolvedValue([
      { src: 'data:image/png;base64,GRIDIMG', page: 1, x: 100, y: 500, w: 200, h: 200, kind: 'grid' },
      // Image simple très haut de page (y=5000) : aucune ligne d'ancrage au-dessus → galerie.
      { src: 'data:image/png;base64,PLAIN', page: 1, x: 0, y: 5000, w: 400, h: 300 },
    ])
    const out = await parsePdfLocally(FILE)
    const diag = out.reader.sections.find((s) => s.kind === 'diagramme')
    expect(diag).toBeTruthy()
    expect(diag.chart.img).toBe('data:image/png;base64,GRIDIMG')
    // Dédup : l'image-grille n'apparaît NI en galerie NI en step.imgs (elle n'est plus une simple image).
    expect(out.pattern.gallery.some((g) => g.src === 'data:image/png;base64,GRIDIMG')).toBe(false)
    expect(
      out.reader.sections.some((s) => s.steps.some((st) => (st.imgs || []).includes('data:image/png;base64,GRIDIMG'))),
    ).toBe(false)
    // L'image simple, elle, suit l'ancrage habituel (ici : galerie, faute de ligne d'ancrage).
    expect(out.pattern.gallery.some((g) => g.src === 'data:image/png;base64,PLAIN')).toBe(true)
  })

  it('image-grille promue → pas de repli page-entière redondant, même si une page évoque un diagramme (E)', async () => {
    const withChartHint = [NOMINAL[0], [L('Diagramme point mousse')]]
    extractPages.mockResolvedValue(withChartHint)
    extractImagesWithPos.mockResolvedValue([
      { src: 'data:image/png;base64,GRIDIMG', page: 1, x: 100, y: 500, w: 200, h: 200, kind: 'grid' },
    ])
    const out = await parsePdfLocally(FILE)
    expect(out.reader.sections.some((s) => s.kind === 'diagramme')).toBe(true)
    // Sans la mise à jour de la condition de repli, detectChartPage aurait aussi déclenché
    // reader.chart page-entière (page 2 matche CHART_HINT_RE) — désormais évité.
    expect(out.reader.chart == null || out.reader.chart.img == null).toBe(true)
  })
})

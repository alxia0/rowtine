import { describe, it, expect, vi } from 'vitest'

vi.mock('@/utils/pdf', () => ({
  extractPages: vi.fn(async () => [
    [
      { text: 'Rang 1 : tricoter toutes les mailles à l’endroit du début à la fin du rang.', y: 700 },
      { text: 'Rang 2 : tricoter toutes les mailles à l’envers du début à la fin du rang.', y: 690 },
    ],
    [{ text: 'Diagramme dos', y: 500 }],
  ]),
  renderPdfPageToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  readFileAsDataUrl: vi.fn(async () => 'data:application/pdf;base64,AAAA'),
  extractImagesWithPos: vi.fn(async () => []),
  extractVectorRegions: vi.fn(async () => [
    { src: 'data:image/jpeg;base64,GRID', page: 2, x: 100, y: 520, w: 200, h: 200 },
  ]),
}))

import { extractVectorRegions } from '@/utils/pdf'
import { parsePdfLocally } from '@/utils/pdf-import'

const FILE = { name: 'x.pdf', arrayBuffer: async () => new ArrayBuffer(8) }

describe('parsePdfLocally — option B (régions vs page-entière)', () => {
  it('n’émet pas reader.chart page-entière quand des régions existent', async () => {
    const out = await parsePdfLocally(FILE)
    expect(out.reader.chart == null || out.reader.chart.img == null).toBe(true)
    const hasGrid = out.pattern.gallery.some((g) => g.src === 'data:image/jpeg;base64,GRID') ||
      out.reader.sections.some((s) => s.steps.some((st) => (st.imgs || []).includes('data:image/jpeg;base64,GRID')))
    expect(hasGrid).toBe(true)
  })

  it('région kind:grid → promue en section diagramme suivable (pas en galerie/step.imgs)', async () => {
    // Réel : extractVectorRegions étiquette chaque région ('grid' vs 'reference'). Une grille
    // devient une section diagramme interactive (lot #2-B), PAS une simple image.
    vi.mocked(extractVectorRegions).mockResolvedValueOnce([
      { src: 'data:image/jpeg;base64,GRID', page: 2, x: 100, y: 520, w: 200, h: 200, kind: 'grid' },
    ])
    const out = await parsePdfLocally(FILE)
    const diag = out.reader.sections.find((s) => s.kind === 'diagramme')
    expect(diag).toBeTruthy()
    expect(diag.chart.img).toBe('data:image/jpeg;base64,GRID')
    expect(diag.id).toBeTruthy()
    // NI en galerie NI en step.imgs (elle n'est plus une simple image).
    expect(out.pattern.gallery.some((g) => g.src === 'data:image/jpeg;base64,GRID')).toBe(false)
    expect(
      out.reader.sections.some((s) => s.steps.some((st) => (st.imgs || []).includes('data:image/jpeg;base64,GRID'))),
    ).toBe(false)
  })

  it('région kind:reference → reste une image (galerie/step.imgs), pas promue', async () => {
    vi.mocked(extractVectorRegions).mockResolvedValueOnce([
      { src: 'data:image/jpeg;base64,REF', page: 2, x: 100, y: 520, w: 200, h: 200, kind: 'reference' },
    ])
    const out = await parsePdfLocally(FILE)
    expect(out.reader.sections.some((s) => s.kind === 'diagramme')).toBe(false)
    const asImage =
      out.pattern.gallery.some((g) => g.src === 'data:image/jpeg;base64,REF') ||
      out.reader.sections.some((s) => s.steps.some((st) => (st.imgs || []).includes('data:image/jpeg;base64,REF')))
    expect(asImage).toBe(true)
  })

  it('extractVectorRegions → [] ⇒ repli reader.chart page-entière présent', async () => {
    vi.mocked(extractVectorRegions).mockResolvedValueOnce([])
    const out = await parsePdfLocally(FILE)
    expect(out.reader.chart).toBeTruthy()
    expect(out.reader.chart.img).toBe('data:image/jpeg;base64,AAAA')
    expect(out.pattern.gallery.some((g) => g.src === 'data:image/jpeg;base64,GRID')).toBe(false)
  })
})

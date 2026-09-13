import { describe, it, expect, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { unzipToPattern, resolvePatternImagesFromZip, bytesToBase64 } from '@/utils/zip-import'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'

vi.mock('@/utils/image-resize', () => ({ resizeDataUrl: async (dataUrl) => dataUrl }))

// 1x1 PNG transparent (base64) → octets, pour une image réelle référencée par le MD.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
function pngBytes() {
  const bin = atob(PNG_1x1)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

const MD = `---
rowtine: 1
title: Mini Patron
author: Alexia
sizes: Taille unique
---

## Corps {body}

- Monter 20 mailles.

  ![Diagramme](img/chart.png)
`

function buildZip(extra = {}) {
  return zipSync({
    'patron.md': strToU8(MD),
    'img/chart.png': pngBytes(),
    ...extra,
  })
}

describe('unzipToPattern', () => {
  it('convertit MD + image en pattern avec dataURL résolue', async () => {
    const { pattern, warnings } = await unzipToPattern(buildZip())
    expect(pattern.name).toBe('Mini Patron')
    const img = pattern.reader.sections.flatMap((s) => s.steps).flatMap((st) => st.imgs || [])[0]
    expect(img).toMatch(/^data:image\/png;base64,/)
    expect(warnings).toEqual([]) // aucune ref manquante
  })

  it('promeut cover.jpg en photos[0]', async () => {
    const { pattern } = await unzipToPattern(buildZip({ 'cover.png': pngBytes() }))
    expect(pattern.photos[0]).toMatch(/^data:image\/png;base64,/)
  })

  it('sans cover → photos vide', async () => {
    const { pattern } = await unzipToPattern(buildZip())
    expect(pattern.photos).toEqual([])
  })

  it('taille unique → sizes vide (pas affichée comme une taille)', async () => {
    const { pattern } = await unzipToPattern(buildZip()) // MD : sizes: Taille unique
    expect(pattern.sizes).toEqual([])
  })

  // Preuve par mutation (T1, isSingleSize) : variante en minuscules dans le MD,
  // reconnue grâce au prédicat assoupli. Avec l'ancien `sl[0] === 'Taille unique'` strict,
  // `pattern.sizes` resterait `['taille unique']` au lieu de `[]` — ce test échouerait au
  // rouge si le site n'était pas branché sur isSingleSize.
  it('taille unique en minuscules (variante MD modifié à la main) → sizes vide aussi', async () => {
    const mdLower = MD.replace('sizes: Taille unique', 'sizes: taille unique')
    const { pattern } = await unzipToPattern(zipSync({ 'patron.md': strToU8(mdLower), 'img/chart.png': pngBytes() }))
    expect(pattern.sizes).toEqual([])
  })

  it('plusieurs tailles → conservées', async () => {
    const mdMulti = MD.replace('sizes: Taille unique', 'sizes: S · M · L')
    const { pattern } = await unzipToPattern(zipSync({ 'patron.md': strToU8(mdMulti), 'img/chart.png': pngBytes() }))
    expect(pattern.sizes).toEqual(['S', 'M', 'L'])
  })

  it('ref image manquante → warning + ref retirée (texte conservé)', async () => {
    const mdMissing = MD.replace('img/chart.png', 'img/absente.png')
    const zip = zipSync({ 'patron.md': strToU8(mdMissing) }) // pas d'image dans le zip
    const { pattern, warnings } = await unzipToPattern(zip)
    const step = pattern.reader.sections.flatMap((s) => s.steps).find((st) => (st.t || '').includes('Monter 20 mailles'))
    expect(step).toBeTruthy()
    expect(step.imgs || []).toEqual([]) // ref manquante retirée
    expect(step.t).toContain('Monter 20 mailles') // texte de l'étape conservé
    expect(warnings.some((w) => w.params.ref.includes('absente.png'))).toBe(true)
  })

  it("l'image manquante produit un avertissement structuré, pas une phrase française", async () => {
    const mdMissing = MD.replace('img/chart.png', 'photo-absente.png')
    const zip = zipSync({ 'patron.md': strToU8(mdMissing) }) // pas d'image dans le zip
    const { warnings } = await unzipToPattern(zip)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      code: WARNING_CODES.ZIP_MISSING_IMAGE,
      params: { ref: 'photo-absente.png' },
    })
  })

  it('aucun .md → Error code no-md', async () => {
    const zip = zipSync({ 'img/chart.png': pngBytes() })
    await expect(unzipToPattern(zip)).rejects.toThrowError(/no-md/)
  })

  it('octets illisibles → Error code bad-zip', async () => {
    await expect(unzipToPattern(new Uint8Array([1, 2, 3, 4]))).rejects.toThrowError(/bad-zip/)
  })

  it('plafonne réellement une image de kit trop grande (preuve par mutation du branchement)', async () => {
    const calls = []
    vi.doMock('@/utils/image-resize', () => ({
      resizeDataUrl: async (dataUrl) => {
        calls.push(dataUrl)
        return dataUrl
      },
    }))
    vi.resetModules()
    const { unzipToPattern: freshUnzip } = await import('@/utils/zip-import')
    await freshUnzip(buildZip({ 'cover.png': pngBytes() }))
    // La couverture ET l'image de section doivent toutes deux avoir été SOUMISES au plafond —
    // si le branchement disparaît, `calls` reste vide et ce test rougit.
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('resolvePatternImagesFromZip', () => {
  it('résout steps/chart-section/chart-legacy/gallery, par chemin puis basename', async () => {
    const byPath = new Map([['img/a.png', 'data:image/png;base64,AAA']])
    const byBase = new Map([['a.png', 'data:image/png;base64,AAA'], ['b.png', 'data:image/png;base64,BBB']])
    const pattern = {
      gallery: [{ src: 'img/a.png' }, { src: 'gal/b.png' }],
      reader: {
        chart: { img: 'img/a.png' },
        sections: [
          { steps: [{ imgs: ['img/a.png', 'b.png'] }], chart: { img: 'b.png' } },
        ],
      },
    }
    const w = await resolvePatternImagesFromZip(pattern, byPath, byBase)
    expect(pattern.gallery[0].src).toBe('data:image/png;base64,AAA') // match chemin
    expect(pattern.gallery[1].src).toBe('data:image/png;base64,BBB') // match basename
    expect(pattern.reader.chart.img).toBe('data:image/png;base64,AAA')
    expect(pattern.reader.sections[0].steps[0].imgs).toEqual(['data:image/png;base64,AAA', 'data:image/png;base64,BBB'])
    expect(pattern.reader.sections[0].chart.img).toBe('data:image/png;base64,BBB')
    expect(w).toEqual([])
  })

  it('ref non résolue → warning + ref retirée du tableau imgs', async () => {
    const pattern = { gallery: [], reader: { sections: [{ steps: [{ imgs: ['img/x.png'] }] }] } }
    const w = await resolvePatternImagesFromZip(pattern, new Map(), new Map())
    expect(pattern.reader.sections[0].steps[0].imgs).toEqual([])
    expect(w[0].code).toBe(WARNING_CODES.ZIP_MISSING_IMAGE)
    expect(w.some((s) => s.params.ref.includes('x.png'))).toBe(true)
  })

  // Revue du 15/08/2026 : une image écrite DIRECTEMENT dans le texte du patron.md
  // (au lieu d'être un fichier du kit) échappait entièrement au plafond. Le mock de
  // tête de fichier rend `resizeDataUrl` transparent, donc on ne peut pas vérifier
  // le REDIMENSIONNEMENT ici — on vérifie ce qui compte et ce qui manquait : que la
  // valeur inline est bien SOUMISE au plafond. Si le branchement disparaît, `vues`
  // reste vide et ce test rougit.
  it('une image inline du patron.md est soumise au plafond, pas laissée telle quelle', async () => {
    const vues = []
    vi.doMock('@/utils/image-resize', () => ({
      resizeDataUrl: async (dataUrl) => {
        vues.push(dataUrl)
        return 'data:image/jpeg;base64,PLAFONNEE'
      },
    }))
    vi.resetModules()
    const { resolvePatternImagesFromZip: frais } = await import('@/utils/zip-import')

    const inline = 'data:image/png;base64,INLINE'
    const pattern = { gallery: [{ src: inline }], reader: { sections: [{ steps: [{ imgs: [inline] }] }] } }
    const w = await frais(pattern, new Map(), new Map())

    expect(vues).toContain(inline)
    expect(pattern.reader.sections[0].steps[0].imgs).toEqual(['data:image/jpeg;base64,PLAFONNEE'])
    expect(pattern.gallery[0].src).toBe('data:image/jpeg;base64,PLAFONNEE')
    expect(w).toEqual([]) // une image inline n'est pas une ref manquante
  })
})

describe('bytesToBase64', () => {
  it('round-trip avec atob', () => {
    const b64 = bytesToBase64(pngBytes())
    expect(typeof b64).toBe('string')
    expect(b64).toBe(PNG_1x1)
  })
})

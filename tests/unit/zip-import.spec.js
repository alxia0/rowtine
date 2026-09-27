// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { unzipToPattern, resolvePatternImagesFromZip, bytesToBase64 } from '@/utils/zip-import'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sniffImportKind, SNIFF_BYTES } from '@/utils/import-kind'
import { mdToPattern, patternToMd } from '@/utils/pattern-md'

vi.mock('@/utils/image-resize', () => ({ resizeDataUrl: async (dataUrl) => dataUrl }))

// Compte les appels au filtre de `unzipSync` : mesure combien d'entrées fflate a parcourues.
const filterCalls = vi.hoisted(() => ({ n: 0 }))
vi.mock('fflate', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    unzipSync: (data, opts) =>
      real.unzipSync(data, opts?.filter ? { ...opts, filter: (f) => (filterCalls.n++, opts.filter(f)) } : opts),
  }
})

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

  it('kit compressé avec son dossier : la couverture à côté du patron est promue', async () => {
    const zip = zipSync({ 'kit/patron.md': strToU8(MD), 'kit/img/chart.png': pngBytes(), 'kit/cover.png': pngBytes() })
    const { pattern } = await unzipToPattern(zip)
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

// Protège le modèle public .github/rowtine-md/example : l'archive faite comme le dit son README s'importe sans perte ni avertissement.
describe('modèle Rowtine-MD publié (.github/rowtine-md/example)', () => {
  const EXAMPLE_DIR = resolve(process.cwd(), '.github/rowtine-md/example')

  // `cd example && zip -r -X ~/x.rowtine .` : chaque dossier et chaque fichier, à son chemin relatif.
  function exampleEntries(dir = EXAMPLE_DIR, prefix = '') {
    const out = {}
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + e.name
      if (e.isDirectory()) Object.assign(out, { [`${rel}/`]: new Uint8Array(0) }, exampleEntries(join(dir, e.name), `${rel}/`))
      else out[rel] = new Uint8Array(readFileSync(join(dir, e.name)))
    }
    return out
  }

  const isDataUrl = (s) => typeof s === 'string' && s.startsWith('data:image/png;base64,')

  it("s'importe comme une archive Rowtine, sans aucun avertissement", async () => {
    const bytes = zipSync(exampleEntries())
    expect(sniffImportKind(bytes.slice(0, SNIFF_BYTES))).toBe('zip')
    const { pattern, warnings } = await unzipToPattern(bytes)
    expect(warnings).toEqual([])

    expect(pattern.name).toBe('Meadowlark Round Cushion')
    expect(pattern.authorUrl).toBe('https://example.com/meadowlark-cushion')
    expect(pattern.sizes).toEqual(['S', 'M', 'L'])
    expect(pattern.reader.sizeSub).toEqual(['35', '40', '45'])
    expect(pattern.reader.sizeSubLabel).toBe('insert diameter, cm')
    expect(pattern.reader.easeHint).toBeTruthy()
    expect(isDataUrl(pattern.photos[0])).toBe(true)
    expect(pattern.gallery).toHaveLength(2)
    expect(pattern.gallery.every((g) => isDataUrl(g.src))).toBe(true)

    const ref = pattern.reader.reference
    expect(ref.tabs.map((tab) => tab.id)).toEqual(['materiel', 'tailles', 'tech', 'abbr', 'tips'])
    expect(ref.tabs[0].blocks.map((b) => b.h3Key)).toEqual([
      'reader.reference.h3.gauge',
      'reader.reference.h3.needles',
      'reader.reference.h3.yarn',
      'reader.reference.h3.materials',
    ])
    expect(ref.abbr.C6B).toBeTruthy()

    const sections = pattern.reader.sections
    expect(sections.map((s) => [s.title, s.kind])).toEqual([
      ['presentation', 'autre'],
      ['Gauge swatch', 'echantillon'],
      ['Front medallion', 'dentelle'],
      ['Leaf edging', 'bordure'],
      ['Side band', 'motif'],
      ['Back', 'pelote'],
      ['Finishing', 'finitions'],
      ['About this example', 'infos'],
    ])
    const sec = (title) => sections.find((s) => s.title === title)
    const step = (title, text) => sec(title).steps.find((st) => (st.t || '').includes(text))

    expect(sec('Front medallion').chart).toMatchObject({ cols: 11, rows: 20, shape: 'radial-circle', readDir: 'rtl' })
    expect(sec('Leaf edging').chart).toMatchObject({ cols: 12, rows: 4, readDir: 'rtl', sizes: ['M', 'L'] })
    expect(sec('Side band').chart).toMatchObject({ cols: 12, rows: 8, readDir: 'rtl', reps: 3 })
    for (const title of ['Front medallion', 'Leaf edging', 'Side band']) expect(isDataUrl(sec(title).chart.img)).toBe(true)

    expect(isDataUrl(sections[0].steps.at(-1).imgs?.[0])).toBe(true)
    expect(isDataUrl(step('Front medallion', 'invisible circular cast-on').imgs?.[0])).toBe(true)
    expect(step('Front medallion', 'Continue in stocking stitch')).toMatchObject({ repeat: true, total: [9, 12, 15] })
    expect(step('Side band', 'Work rounds 1 to 8')).toMatchObject({ repeat: true, total: [3, 3, 3] })
    expect(step('Back', 'Increase round')).toMatchObject({ repeat: true, every: 2, total: [17, 17, 17] })
    expect(step('Back', 'Repeat the last 2 rounds')).toMatchObject({ repeat: true, total: [2, 5, 8] })
    expect(step('Finishing', 'three-needle bind-off').c).toEqual([[240, 276, 312]])
  })

  it("est écrit sous la forme exacte que l'app réécrit", () => {
    const md = readFileSync(join(EXAMPLE_DIR, 'patron.md'), 'utf8')
    expect(patternToMd(mdToPattern(md).pattern).md).toBe(md)
  })
})

describe('unzipToPattern : trop d’entrées', () => {
  // Protège : un zip au-delà du plafond d'entrées est refusé dès le plafond, sans parcourir le reste (compte EOCD falsifiable).
  it('lève zip-too-big et arrête l’itération au plafond', async () => {
    const many = {}
    for (let i = 0; i < 5000; i++) many[`f${i}.txt`] = new Uint8Array(0)
    const zip = buildZip(many)
    filterCalls.n = 0
    await expect(unzipToPattern(zip)).rejects.toMatchObject({ code: 'zip-too-big' })
    expect(filterCalls.n).toBeLessThanOrEqual(4097)
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

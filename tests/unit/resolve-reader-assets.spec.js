// Unitaire — resolveReaderAssets. Résolution pure des chemins
// d'images nus (issus du parse MD) contre les fichiers du dossier (filesByName)
// → data URLs. Couvre : step, chart, galerie, chemin manquant (→ missing, valeur
// conservée), data URL déjà inline (→ intacte, pas dans missing), reader/gallery
// absents (→ pas de crash).
import { describe, it, expect } from 'vitest'
import { resolveReaderAssets } from '@/backup/resolve-reader-assets'

function makeEntity(overrides = {}) {
  return {
    name: 'Bonnet',
    reader: {
      sizeLabels: ['T'],
      sections: [
        { id: 'corps', title: 'Corps', kind: 'texte', steps: [{ t: 'monter', imgs: ['photo-aaa.jpg'] }] },
      ],
    },
    gallery: [],
    ...overrides,
  }
}

describe('resolveReaderAssets', () => {
  it("résout l'image d'une étape en data URL à partir de filesByName", () => {
    const entity = makeEntity()
    const filesByName = { 'photo-aaa.jpg': 'BASE64AAA' }
    const { entity: out, missing } = resolveReaderAssets(entity, filesByName)
    const img = out.reader.sections[0].steps[0].imgs[0]
    expect(img.startsWith('data:')).toBe(true)
    expect(img).toContain('BASE64AAA')
    expect(img).toBe('data:image/jpeg;base64,BASE64AAA')
    expect(missing).toEqual([])
  })

  it('résout src de galerie en data URL', () => {
    const entity = makeEntity({ gallery: [{ src: 'gallery-bbb.png', page: 1, w: 10, h: 20 }] })
    const filesByName = { 'gallery-bbb.png': 'BASE64BBB', 'photo-aaa.jpg': 'BASE64AAA' }
    const { entity: out, missing } = resolveReaderAssets(entity, filesByName)
    expect(out.gallery[0].src.startsWith('data:')).toBe(true)
    expect(out.gallery[0].src).toContain('BASE64BBB')
    expect(out.gallery[0].src).toBe('data:image/png;base64,BASE64BBB')
    // les autres champs de l'item galerie sont préservés
    expect(out.gallery[0].page).toBe(1)
    expect(out.gallery[0].w).toBe(10)
    expect(missing).toEqual([])
  })

  it('résout reader.chart.img en data URL', () => {
    const entity = makeEntity({
      reader: {
        sizeLabels: ['T'],
        sections: [],
        chart: { rows: 2, cols: 3, img: 'photo-chart.jpg', repeat: '', readDir: '' },
      },
    })
    const filesByName = { 'photo-chart.jpg': 'BASE64CHART' }
    const { entity: out, missing } = resolveReaderAssets(entity, filesByName)
    expect(out.reader.chart.img.startsWith('data:')).toBe(true)
    expect(out.reader.chart.img).toContain('BASE64CHART')
    expect(out.reader.chart.rows).toBe(2) // champs voisins préservés
    expect(missing).toEqual([])
  })

  it('chemin sans fichier correspondant : laissé tel quel et listé dans missing', () => {
    const entity = makeEntity()
    const filesByName = {} // 'photo-aaa.jpg' absent
    const { entity: out, missing } = resolveReaderAssets(entity, filesByName)
    expect(out.reader.sections[0].steps[0].imgs[0]).toBe('photo-aaa.jpg')
    expect(missing).toEqual(['photo-aaa.jpg'])
  })

  it('une data URL déjà inline est laissée intacte et absente de missing', () => {
    const inline = 'data:image/jpeg;base64,DEJAINLINE'
    const entity = makeEntity({
      reader: {
        sizeLabels: ['T'],
        sections: [{ id: 'corps', title: 'Corps', kind: 'texte', steps: [{ t: 'monter', imgs: [inline] }] }],
      },
    })
    const { entity: out, missing } = resolveReaderAssets(entity, {})
    expect(out.reader.sections[0].steps[0].imgs[0]).toBe(inline)
    expect(missing).toEqual([])
  })

  it("résout section.chart.img en data URL (grille multi-diagrammes)", () => {
    const entity = makeEntity({
      reader: {
        sizeLabels: ['T'],
        sections: [
          {
            id: 'grille2',
            title: 'Grille 2',
            kind: 'texte',
            chart: { img: 'grille-abc.png', rows: 20, cols: 10 },
            steps: [{ t: 'tricoter', imgs: [] }],
          },
        ],
      },
    })
    const filesByName = { 'grille-abc.png': 'BASE64GRILLE' }
    const { entity: out, missing } = resolveReaderAssets(entity, filesByName)
    const chart = out.reader.sections[0].chart
    expect(chart.img.startsWith('data:')).toBe(true)
    expect(chart.img).toContain('BASE64GRILLE')
    expect(chart.rows).toBe(20) // champs voisins préservés
    expect(missing).toEqual([])
  })

  it('section.chart.img sans fichier correspondant : laissé tel quel et listé dans missing', () => {
    const entity = makeEntity({
      reader: {
        sizeLabels: ['T'],
        sections: [
          {
            id: 'grille2',
            title: 'Grille 2',
            kind: 'texte',
            chart: { img: 'grille-manquante.png', rows: 5, cols: 5 },
          },
        ],
      },
    })
    const { entity: out, missing } = resolveReaderAssets(entity, {})
    expect(out.reader.sections[0].chart.img).toBe('grille-manquante.png')
    expect(missing).toEqual(['grille-manquante.png'])
  })

  it('section.chart.img déjà en data URL : laissé intact', () => {
    const inline = 'data:image/png;base64,DEJAINLINEGRILLE'
    const entity = makeEntity({
      reader: {
        sizeLabels: ['T'],
        sections: [
          { id: 'grille2', title: 'Grille 2', kind: 'texte', chart: { img: inline, rows: 5, cols: 5 } },
        ],
      },
    })
    const { entity: out, missing } = resolveReaderAssets(entity, {})
    expect(out.reader.sections[0].chart.img).toBe(inline)
    expect(missing).toEqual([])
  })

  it('reader absent : pas de crash, entity renvoyée sans reader', () => {
    const entity = { name: 'Sans reader', gallery: [{ src: 'gallery-x.jpg' }] }
    const { entity: out, missing } = resolveReaderAssets(entity, {})
    expect(out.reader).toBeUndefined()
    expect(out.gallery[0].src).toBe('gallery-x.jpg')
    expect(missing).toEqual(['gallery-x.jpg'])
  })

  it('gallery absente : pas de crash', () => {
    const entity = makeEntity({ gallery: undefined })
    const { entity: out, missing } = resolveReaderAssets(entity, { 'photo-aaa.jpg': 'BASE64AAA' })
    expect(out.gallery).toBeUndefined()
    expect(out.reader.sections[0].steps[0].imgs[0]).toBe('data:image/jpeg;base64,BASE64AAA')
    expect(missing).toEqual([])
  })

  it('entity absente (null/undefined) : renvoyée telle quelle, missing vide, ne lève pas', () => {
    expect(resolveReaderAssets(null, {})).toEqual({ entity: null, missing: [] })
    expect(resolveReaderAssets(undefined, {})).toEqual({ entity: undefined, missing: [] })
  })

  it('ne mute pas les objets en entrée (pur)', () => {
    const entity = makeEntity()
    const filesByName = { 'photo-aaa.jpg': 'BASE64AAA' }
    const before = JSON.stringify(entity)
    resolveReaderAssets(entity, filesByName)
    expect(JSON.stringify(entity)).toBe(before)
  })
})

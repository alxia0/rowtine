// Verrou de comportement AVANT déplacement de resolveReaderImages (Task A2,
// moteur unique) : tools/mdedit/resolve-images.js → src/utils/pattern-md/.
// Le banc n'avait AUCUNE spec pour ce module (blast radius "no covering
// tests") — cette spec est donc nouvelle, pas un verrou repris.
// Importe depuis le NOUVEAU chemin @/utils/pattern-md/resolve-images.
import { describe, it, expect } from 'vitest'
import { resolveReaderImages, buildImageMap, assetImagePath } from '@/utils/pattern-md/resolve-images'
import { photoFileName } from '@/backup/naming.js'
import { resolveReaderByBasename } from '../../tools/mdedit/md-images.js'

describe('assetImagePath', () => {
  it('même formule que buildImageMap (img/photo-<hash>.<ext>), réutilisable par un appelant externe', () => {
    const dataUrl = 'data:image/png;base64,FFFFFFFF'
    expect(assetImagePath(dataUrl)).toBe(`img/${photoFileName(dataUrl, 0)}`)
  })
})

const DATA_URL_STEP = 'data:image/png;base64,AAAAAAAA'
const DATA_URL_CHART = 'data:image/png;base64,BBBBBBBB'
const STEP_PATH = `img/${photoFileName(DATA_URL_STEP, 0)}`
const CHART_PATH = `img/${photoFileName(DATA_URL_CHART, 0)}`

function makeSrcReader() {
  return {
    sections: [
      { steps: [{ imgs: [DATA_URL_STEP] }] },
    ],
    chart: { img: DATA_URL_CHART },
  }
}

// Multi-grilles (Lot A) : la grille vit SUR LA SECTION (section.chart.img), sans
// legacy reader.chart NI steps[].imgs -- c'est le cas RÉEL/majoritaire des patrons
// modernes. Fixture À PART pour ne pas mélanger avec le cas legacy ci-dessus.
const DATA_URL_SECTION_CHART = 'data:image/png;base64,CCCCCCCC'
const SECTION_CHART_PATH = `img/${photoFileName(DATA_URL_SECTION_CHART, 0)}`

function makeSrcReaderSectionChart() {
  return {
    sections: [{ chart: { img: DATA_URL_SECTION_CHART } }],
  }
}

describe('resolveReaderImages', () => {
  it("ré-attache la data-URL d'un step.imgs par chemin d'asset (content-hash)", () => {
    const dst = { sections: [{ steps: [{ imgs: [STEP_PATH] }] }] }
    const result = resolveReaderImages(dst, makeSrcReader())
    expect(result.sections[0].steps[0].imgs[0]).toBe(DATA_URL_STEP)
  })

  it("ré-attache la data-URL de chart.img par chemin d'asset (content-hash)", () => {
    const dst = { chart: { img: CHART_PATH } }
    const result = resolveReaderImages(dst, makeSrcReader())
    expect(result.chart.img).toBe(DATA_URL_CHART)
  })

  it('mute dstReader en place (retour === même référence)', () => {
    const dst = { sections: [{ steps: [{ imgs: [STEP_PATH] }] }] }
    const result = resolveReaderImages(dst, makeSrcReader())
    expect(result).toBe(dst)
  })

  it("laisse inchangé un chemin absent de srcReader (jamais de throw)", () => {
    const dst = { sections: [{ steps: [{ imgs: ['img/inconnu-00000000.png'] }] }] }
    expect(() => resolveReaderImages(dst, makeSrcReader())).not.toThrow()
    expect(dst.sections[0].steps[0].imgs[0]).toBe('img/inconnu-00000000.png')
  })

  it('ne jette pas sur un srcReader vide/absent', () => {
    const dst = { sections: [{ steps: [{ imgs: [STEP_PATH] }] }] }
    expect(() => resolveReaderImages(dst, {})).not.toThrow()
    expect(() => resolveReaderImages(dst, null)).not.toThrow()
    expect(dst.sections[0].steps[0].imgs[0]).toBe(STEP_PATH)
  })
})

// Diagramme par SECTION (multi-grilles, cf. reader-editable.js Task B2) : la
// vignette de l'éditeur de correction (bande "Diagrammes de ce patron") se sert
// de buildImageMap via readerToEditable -- sans ce cas, TOUT patron moderne
// (section.chart.img, pas de legacy reader.chart) affiche un aperçu cassé.
describe('buildImageMap — diagramme par section (multi-grilles)', () => {
  it("inclut l'image chart.img d'une section, même sans legacy reader.chart ni steps[].imgs", () => {
    const map = buildImageMap(makeSrcReaderSectionChart())
    expect(map.get(SECTION_CHART_PATH)).toBe(DATA_URL_SECTION_CHART)
  })
})

describe('resolveReaderImages — diagramme par section (multi-grilles)', () => {
  it("ré-attache la data-URL d'un chart.img PAR SECTION par chemin d'asset (content-hash)", () => {
    const dst = { sections: [{ chart: { img: SECTION_CHART_PATH } }] }
    const result = resolveReaderImages(dst, makeSrcReaderSectionChart())
    expect(result.sections[0].chart.img).toBe(DATA_URL_SECTION_CHART)
  })

  it("laisse inchangé un chart.img de section absent de srcReader (jamais de throw)", () => {
    const dst = { sections: [{ chart: { img: 'img/inconnu-00000000.png' } }] }
    expect(() => resolveReaderImages(dst, makeSrcReaderSectionChart())).not.toThrow()
    expect(dst.sections[0].chart.img).toBe('img/inconnu-00000000.png')
  })
})

// `extraImages` (3e paramètre) : une image de GALERIE insérée dans le texte n'est ancrée
// dans AUCUNE section de srcReader -- buildImageMap(srcReader) seul ne peut donc jamais la
// retrouver. `extraImages` est une map de REPLI (chemin -> data-URL) fournie par l'appelant
// pour ce cas précis (cf. CorrectionView.vue, insertion depuis la galerie).
describe('resolveReaderImages — extraImages (repli galerie)', () => {
  const DATA_URL_GALLERY = 'data:image/png;base64,DDDDDDDD'
  const GALLERY_PATH = `img/${photoFileName(DATA_URL_GALLERY, 0)}`

  it("ré-attache une data-URL absente de srcReader via extraImages (Map)", () => {
    const dst = { sections: [{ steps: [{ imgs: [GALLERY_PATH] }] }] }
    const extraImages = new Map([[GALLERY_PATH, DATA_URL_GALLERY]])
    const result = resolveReaderImages(dst, makeSrcReader(), extraImages)
    expect(result.sections[0].steps[0].imgs[0]).toBe(DATA_URL_GALLERY)
  })

  it("srcReader reste prioritaire sur extraImages en cas de même chemin", () => {
    const dst = { sections: [{ steps: [{ imgs: [STEP_PATH] }] }] }
    const extraImages = new Map([[STEP_PATH, DATA_URL_GALLERY]])
    const result = resolveReaderImages(dst, makeSrcReader(), extraImages)
    expect(result.sections[0].steps[0].imgs[0]).toBe(DATA_URL_STEP)
  })

  it("ignore extraImages absent (repli 2 arguments inchangé)", () => {
    const dst = { sections: [{ steps: [{ imgs: [STEP_PATH] }] }] }
    expect(() => resolveReaderImages(dst, makeSrcReader())).not.toThrow()
    expect(dst.sections[0].steps[0].imgs[0]).toBe(DATA_URL_STEP)
  })
})

// Banc mdedit (flux .md + images) : la 2e grille d'un patron multi-diagrammes est résolue aussi.
describe('resolveReaderByBasename — diagramme par section (multi-grilles)', () => {
  it('résout sec.chart.img de chaque section, pas seulement reader.chart', () => {
    const chartA = { img: 'p02-1.png' }
    const chartB = { img: 'p03-1.png' }
    const reader = { chart: chartA, sections: [{ chart: chartA, steps: [] }, { chart: chartB, steps: [] }] }
    const map = new Map([['p02-1.png', 'data:image/png;base64,AAAA'], ['p03-1.png', 'data:image/png;base64,BBBB']])
    resolveReaderByBasename(reader, map)
    expect(reader.sections[1].chart.img).toBe('data:image/png;base64,BBBB')
    expect(reader.chart.img).toBe('data:image/png;base64,AAAA')
  })
})

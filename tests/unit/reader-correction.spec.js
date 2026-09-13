import { describe, it, expect } from 'vitest'
import {
  setSectionKind,
  sectionIsChart,
  sectionImageSrc,
  sectionCanPromote,
  sectionCanDemote,
  demoteChartToImage,
  demoteChartToGallery,
  promoteImageToChart,
  appendGalleryImageAsChart,
} from '@/utils/reader-correction'

// Fixture aux formes RÉELLES du moteur : une image est toujours poussée sur un
// step qui porte déjà du texte (cf. associate.js `if (!st.t) continue` +
// `st.imgs.push`), et un step peut porter plusieurs images.
function fixtureReader() {
  return {
    sizeLabels: [],
    sections: [
      // (a) section-diagramme
      {
        id: 'diagramme-1',
        kind: 'diagramme',
        title: 'Diagramme 1',
        steps: [{ chart: true }],
        chart: { rows: 0, cols: 0, img: 'X', repeat: '', readDir: '', builtinLegend: false },
      },
      // (b) section avec un step d'ancrage texte+image, puis un step texte
      {
        id: 'encolure',
        kind: 'encolure',
        title: 'Encolure',
        steps: [
          { t: 'Rang 1 : monter 20 m', imgs: ['a'] },
          { t: 'Rang 2 : tricoter' },
        ],
      },
      // (c) section texte simple
      {
        id: 'corps',
        kind: 'corps',
        title: 'Corps',
        steps: [{ t: 'Tricoter au point mousse' }],
      },
      // (d) step d'ancrage portant DEUX images (sœurs)
      {
        id: 'manche',
        kind: 'manche',
        title: 'Manche',
        steps: [{ t: 'Motif A sur 8 rangs', imgs: ['a', 'b'] }],
      },
    ],
  }
}

describe('reader-correction — transforms purs', () => {
  describe('setSectionKind', () => {
    it('change le kind d’une section connue', () => {
      const reader = fixtureReader()
      const out = setSectionKind(reader, 'corps', 'finitions')
      expect(out.sections.find((s) => s.id === 'corps').kind).toBe('finitions')
    })
    it('rejette un kind inconnu (reader inchangé)', () => {
      const reader = fixtureReader()
      const out = setSectionKind(reader, 'corps', 'pas-un-kind')
      expect(out.sections.find((s) => s.id === 'corps').kind).toBe('corps')
      expect(out).toEqual(reader)
    })
    it('ne mute pas le reader d’entrée', () => {
      const reader = fixtureReader()
      const before = JSON.parse(JSON.stringify(reader))
      setSectionKind(reader, 'corps', 'finitions')
      expect(reader).toEqual(before)
    })
  })

  describe('sectionIsChart', () => {
    it('vrai pour une section-diagramme', () => {
      const reader = fixtureReader()
      expect(sectionIsChart(reader.sections[0])).toBe(true)
    })
    it('faux pour une section image ou texte', () => {
      const reader = fixtureReader()
      expect(sectionIsChart(reader.sections[1])).toBe(false)
      expect(sectionIsChart(reader.sections[2])).toBe(false)
    })
  })

  describe('sectionImageSrc', () => {
    it('renvoie chart.img pour une section-diagramme', () => {
      const reader = fixtureReader()
      expect(sectionImageSrc(reader.sections[0])).toBe('X')
    })
    it('renvoie la 1re image de step pour une section image', () => {
      const reader = fixtureReader()
      expect(sectionImageSrc(reader.sections[1])).toBe('a')
    })
    it('renvoie null pour une section texte simple', () => {
      const reader = fixtureReader()
      expect(sectionImageSrc(reader.sections[2])).toBeNull()
    })
  })

  describe('sectionCanPromote / sectionCanDemote', () => {
    it('une section-diagramme peut être rétrogradée, pas promue', () => {
      const reader = fixtureReader()
      expect(sectionCanDemote(reader.sections[0])).toBe(true)
      expect(sectionCanPromote(reader.sections[0])).toBe(false)
    })
    it('une section image peut être promue, pas rétrogradée', () => {
      const reader = fixtureReader()
      expect(sectionCanPromote(reader.sections[1])).toBe(true)
      expect(sectionCanDemote(reader.sections[1])).toBe(false)
    })
    it('une section texte simple ne peut ni l’un ni l’autre', () => {
      const reader = fixtureReader()
      expect(sectionCanPromote(reader.sections[2])).toBe(false)
      expect(sectionCanDemote(reader.sections[2])).toBe(false)
    })
  })

  describe('demoteChartToImage', () => {
    it('remplace le step chart par un step image, supprime chart, kind≠diagramme, image conservée', () => {
      const reader = fixtureReader()
      const out = demoteChartToImage(reader, 'diagramme-1')
      const sec = out.sections.find((s) => s.id === 'diagramme-1')
      expect(sec.chart).toBeUndefined()
      expect(sec.kind).not.toBe('diagramme')
      expect(sec.steps).toEqual([{ imgs: ['X'] }])
      expect(sectionImageSrc(sec)).toBe('X') // image jamais perdue
    })
    it('garde-fou : chart.img absent → pas de {imgs:[undefined]}', () => {
      const reader = fixtureReader()
      // diagramme sans image (cas dégénéré) : ne pas fabriquer {imgs:[undefined]}
      reader.sections[0].chart = { rows: 0, cols: 0, repeat: '', readDir: '', builtinLegend: false }
      const out = demoteChartToImage(reader, 'diagramme-1')
      const sec = out.sections.find((s) => s.id === 'diagramme-1')
      expect(sec.chart).toBeUndefined()
      // aucun step ne doit contenir un imgs avec une valeur falsy
      for (const st of sec.steps) {
        if (st.imgs) expect(st.imgs.every(Boolean)).toBe(true)
      }
    })
    it('no-op si la section n’est pas un diagramme', () => {
      const reader = fixtureReader()
      const out = demoteChartToImage(reader, 'encolure')
      expect(out).toEqual(reader)
    })
    it('no-op si l’id est inconnu', () => {
      const reader = fixtureReader()
      const out = demoteChartToImage(reader, 'inexistant')
      expect(out).toEqual(reader)
    })
    it('ne mute pas le reader d’entrée', () => {
      const reader = fixtureReader()
      const before = JSON.parse(JSON.stringify(reader))
      demoteChartToImage(reader, 'diagramme-1')
      expect(reader).toEqual(before)
    })
  })

  describe('demoteChartToGallery', () => {
    it('section SANS ancrage texte (steps:[{chart:true}] seul, cf. appendGalleryImageAsChart) : la section entière disparaît, movedImg = l’image', () => {
      const reader = fixtureReader()
      const { reader: out, movedImg } = demoteChartToGallery(reader, 'diagramme-1')
      expect(out.sections.find((s) => s.id === 'diagramme-1')).toBeUndefined()
      expect(movedImg).toBe('X')
      expect(out.sections).toHaveLength(fixtureReader().sections.length - 1)
    })

    it('section AVEC ancrage texte (diagramme promu depuis le texte) : le texte survit, seul le step chart disparaît', () => {
      const reader = {
        sizeLabels: [],
        sections: [
          {
            id: 'encolure',
            kind: 'diagramme',
            title: 'Encolure',
            steps: [{ t: 'Rang 1 : monter 20 m' }, { chart: true }],
            chart: { rows: 0, cols: 0, img: 'Y', repeat: '', readDir: '', builtinLegend: false },
          },
        ],
      }
      const { reader: out, movedImg } = demoteChartToGallery(reader, 'encolure')
      const sec = out.sections.find((s) => s.id === 'encolure')
      expect(sec).toBeDefined()
      expect(sec.chart).toBeUndefined()
      expect(sec.kind).not.toBe('diagramme')
      expect(sec.steps).toEqual([{ t: 'Rang 1 : monter 20 m' }])
      expect(movedImg).toBe('Y')
    })

    it('no-op si la section n’est pas un diagramme : reader inchangé, movedImg null', () => {
      const reader = fixtureReader()
      const { reader: out, movedImg } = demoteChartToGallery(reader, 'encolure')
      expect(out).toEqual(reader)
      expect(movedImg).toBeNull()
    })

    it('no-op si l’id est inconnu', () => {
      const reader = fixtureReader()
      const { reader: out, movedImg } = demoteChartToGallery(reader, 'inexistant')
      expect(out).toEqual(reader)
      expect(movedImg).toBeNull()
    })

    it('ne mute pas le reader d’entrée', () => {
      const reader = fixtureReader()
      const before = JSON.parse(JSON.stringify(reader))
      demoteChartToGallery(reader, 'diagramme-1')
      expect(reader).toEqual(before)
    })
  })

  describe('promoteImageToChart', () => {
    it('pose chart avec la 1re image, rows/cols à 0, kind diagramme', () => {
      const reader = fixtureReader()
      const out = promoteImageToChart(reader, 'encolure')
      const sec = out.sections.find((s) => s.id === 'encolure')
      expect(sec.chart).toEqual({ rows: 0, cols: 0, img: 'a', repeat: '', readDir: '', builtinLegend: false })
      expect(sec.kind).toBe('diagramme')
      expect(sec.steps.some((s) => s.chart === true)).toBe(true)
    })
    it('CONSERVE le texte du step d’ancrage (jamais perdre l’info)', () => {
      const reader = fixtureReader()
      const out = promoteImageToChart(reader, 'encolure')
      const sec = out.sections.find((s) => s.id === 'encolure')
      expect(sec.steps.some((s) => s.t === 'Rang 1 : monter 20 m')).toBe(true)
      expect(sec.steps.some((s) => s.t === 'Rang 2 : tricoter')).toBe(true)
    })
    it('insère le step {chart:true} juste APRÈS le step d’ancrage, sans écraser', () => {
      const reader = fixtureReader()
      const out = promoteImageToChart(reader, 'encolure')
      const sec = out.sections.find((s) => s.id === 'encolure')
      expect(sec.steps).toEqual([
        { t: 'Rang 1 : monter 20 m' }, // image promue retirée, texte gardé
        { chart: true },
        { t: 'Rang 2 : tricoter' },
      ])
    })
    it('CONSERVE les images sœurs du step d’ancrage', () => {
      const reader = fixtureReader()
      const out = promoteImageToChart(reader, 'manche')
      const sec = out.sections.find((s) => s.id === 'manche')
      expect(sec.chart.img).toBe('a') // 1re image promue
      // le step d'ancrage garde son texte ET l'image sœur 'b'
      expect(sec.steps).toEqual([
        { t: 'Motif A sur 8 rangs', imgs: ['b'] },
        { chart: true },
      ])
    })
    it('no-op si aucune image sur la section', () => {
      const reader = fixtureReader()
      const out = promoteImageToChart(reader, 'corps')
      expect(out).toEqual(reader)
    })
    it('no-op si déjà un diagramme', () => {
      const reader = fixtureReader()
      const out = promoteImageToChart(reader, 'diagramme-1')
      expect(out).toEqual(reader)
    })
    it('no-op si l’id est inconnu', () => {
      const reader = fixtureReader()
      const out = promoteImageToChart(reader, 'inexistant')
      expect(out).toEqual(reader)
    })
    it('ne mute pas le reader d’entrée', () => {
      const reader = fixtureReader()
      const before = JSON.parse(JSON.stringify(reader))
      promoteImageToChart(reader, 'encolure')
      expect(reader).toEqual(before)
    })

    it('avec un shape fourni, écrit sec.chart.shape', () => {
      const reader = fixtureReader()
      const out = promoteImageToChart(reader, 'encolure', 'radial-square')
      expect(out.sections.find((s) => s.id === 'encolure').chart.shape).toBe('radial-square')
    })

    it('sans shape (undefined), sec.chart ne porte AUCUNE clé shape', () => {
      const reader = fixtureReader()
      const out = promoteImageToChart(reader, 'encolure', undefined)
      expect('shape' in out.sections.find((s) => s.id === 'encolure').chart).toBe(false)
    })
  })

  describe('round-trip promote → demote', () => {
    it('conserve l’image promue, le texte d’ancrage ET l’image sœur', () => {
      const reader = fixtureReader()
      const promoted = promoteImageToChart(reader, 'manche')
      const demoted = demoteChartToImage(promoted, 'manche')
      const sec = demoted.sections.find((s) => s.id === 'manche')
      expect(sec.chart).toBeUndefined()
      expect(sec.kind).not.toBe('diagramme')
      // texte d'ancrage préservé
      expect(sec.steps.some((s) => s.t === 'Motif A sur 8 rangs')).toBe(true)
      // les deux images ('a' promue puis rétrogradée, 'b' sœur) survivent
      const allImgs = sec.steps.flatMap((s) => s.imgs || [])
      expect(allImgs).toContain('a')
      expect(allImgs).toContain('b')
    })
  })
})

describe('appendGalleryImageAsChart', () => {
  function readerWithSections(sections) {
    return { sizeLabels: ['S'], sections }
  }

  it('reader sans section-diagramme : ajoute "Diagramme 1" en fin de reader.sections, sans shape', () => {
    const reader = readerWithSections([{ id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter 80 mailles' }] }])
    const out = appendGalleryImageAsChart(reader, 'data:image/png;base64,GALLERY', undefined)
    expect(out.sections).toHaveLength(2)
    const added = out.sections[1]
    expect(added.title).toBe('Diagramme 1')
    expect(added.id).toBe('diagramme-1')
    expect(added.kind).toBe('diagramme')
    expect(added.steps).toEqual([{ chart: true }])
    expect(added.chart).toEqual({ rows: 0, cols: 0, img: 'data:image/png;base64,GALLERY', repeat: '', readDir: '', builtinLegend: false })
    expect('shape' in added.chart).toBe(false)
    expect(reader.sections).toHaveLength(1) // reader d'entrée jamais muté
  })

  it('avec un shape fourni, la section ajoutée porte chart.shape', () => {
    const reader = readerWithSections([])
    const out = appendGalleryImageAsChart(reader, 'data:image/png;base64,G', 'radial-square')
    expect(out.sections[0].chart.shape).toBe('radial-square')
  })

  it('un "Diagramme 1" existe déjà (import ou promotion précédente) : la nouvelle section devient "Diagramme 2"', () => {
    const reader = readerWithSections([
      { id: 'diagramme-1', kind: 'diagramme', title: 'Diagramme 1', steps: [{ chart: true }], chart: { rows: 0, cols: 0, img: 'x', repeat: '', readDir: '', builtinLegend: false } },
    ])
    const out = appendGalleryImageAsChart(reader, 'data:image/png;base64,G', undefined)
    expect(out.sections[1].title).toBe('Diagramme 2')
    expect(out.sections[1].id).toBe('diagramme-2')
  })

  it('numérotation basée sur le MAX des titres "Diagramme N" existants, pas sur leur nombre (un trou dans la séquence ne recycle pas un numéro)', () => {
    const reader = readerWithSections([
      { id: 'diagramme-3', kind: 'diagramme', title: 'Diagramme 3', steps: [{ chart: true }], chart: { rows: 0, cols: 0, img: 'x', repeat: '', readDir: '', builtinLegend: false } },
    ])
    const out = appendGalleryImageAsChart(reader, 'data:image/png;base64,G', undefined)
    expect(out.sections[1].title).toBe('Diagramme 4')
  })

  it('id déjà pris par une AUTRE section (titre "Diagramme N" jamais utilisé comme id manuel) : dédoublonné par suffixe', () => {
    const reader = readerWithSections([
      { id: 'diagramme-1', kind: 'corps', title: 'Une section quelconque', steps: [{ t: 'x' }] },
    ])
    const out = appendGalleryImageAsChart(reader, 'data:image/png;base64,G', undefined)
    expect(out.sections[1].title).toBe('Diagramme 1') // 1er titre "Diagramme N", aucun autre n'existe
    expect(out.sections[1].id).toBe('diagramme-1-2') // mais l'id "diagramme-1" est déjà pris
  })
})

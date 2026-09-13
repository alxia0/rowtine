import { describe, it, expect } from 'vitest'
import { patternToMd } from '@/utils/pattern-md/serialize'
import { buildReference } from '@/utils/reader-reference'

const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const PATTERN = {
  name: 'Mini',
  author: 'A',
  authorUrl: '',
  gallery: [{ src: DATA_PNG, page: 3, w: 10, h: 10 }],
  reader: {
    sizeLabels: ['S', 'M'],
    sizeSub: [], sizeSubLabel: '', easeHint: '',
    chart: { rows: 52, cols: 18, img: '/patterns/twist-chart.png', repeat: '18 m × 52 rangs', readDir: 'droite à gauche' },
    reference: buildReference({ abbr: [{ key: 'm.', def: 'maille' }], gauge: '20 m = 10 cm' }),
    sections: [
      { id: 'presentation', kind: 'autre', title: 'Présentation', steps: [
        { t: 'Un joli top d’été.', note: true },
        { t: 'Se tricote de haut en bas.', note: true },
      ] },
      { id: 'corps', kind: 'corps', title: 'Corps', steps: [
        { t: 'Monter {{0}} m.', c: [[80, 90]] },
        { t: 'Penser à compter les rangs.', note: true },
        { t: 'Rép. ce tour {{0}} fois.', c: [[4, 6]], total: [4, 6], repeat: true },
        { t: 'Suivre le diagramme :' },
        { chart: true },
        { t: 'Coudre les épaules.', imgs: [DATA_PNG] },
      ], chart: { rows: 52, cols: 18, img: '/patterns/twist-chart.png', repeat: '18 m × 52 rangs', readDir: 'droite à gauche' } },
      { id: 'finitions', kind: 'pelote', title: 'Finitions', steps: [{ t: 'Rentrer les fils.' }] },
    ],
  },
}

describe('patternToMd', () => {
  const { md, files } = patternToMd(PATTERN)
  it('assemble dans l’ordre spec : front-matter, intro, référence, sections, galerie', () => {
    const iIntro = md.indexOf('Un joli top d’été.')
    const iRef = md.indexOf('## Échantillon {gauge}')
    const iCorps = md.indexOf('## Corps {body}')
    const iFin = md.indexOf('## Finitions')
    const iGal = md.indexOf('## Galerie {gallery}')
    expect(iIntro).toBeGreaterThan(md.indexOf('---\n', 4))
    expect(iRef).toBeGreaterThan(iIntro)
    expect(iCorps).toBeGreaterThan(iRef)
    expect(iFin).toBeGreaterThan(iCorps)
    expect(iGal).toBeGreaterThan(iFin)
  })
  it('kind par défaut sans attribut, kind non-défaut avec {kind} anglicisé (dialecte)', () => {
    expect(md).toContain('## Corps {body}')
    expect(md).toContain('## Finitions\n')
    expect(md).not.toContain('{pelote}')
    expect(md).not.toContain('{corps}')
  })
  it('rangs, notes, répétitions, multi-tailles', () => {
    expect(md).toContain('- Monter 80 (90) m.')
    expect(md).toContain('> Penser à compter les rangs.')
    expect(md).toContain('- × Rép. ce tour 4 (6) fois.')
  })
  it('diagramme : image seule + attributs', () => {
    expect(md).toContain('![Diagramme](/patterns/twist-chart.png)')
    expect(md).toContain('18 m × 52 rangs · lecture droite à gauche')
  })
  it('image d’étape indentée + data URL matérialisée', () => {
    const f = files.find((x) => x.path.startsWith('img/photo-'))
    expect(f).toBeTruthy()
    expect(md).toContain(`  ![](${f.path})`)
    expect(f.encoding).toBe('base64')
  })
  it('galerie avec page + préfixe galerie-', () => {
    const g = files.find((x) => x.path.startsWith('img/galerie-'))
    expect(md).toContain(`![page 3](${g.path})`)
  })
  it('titre réservé Galerie CONSERVÉ en FR, balise EN {gallery} ajoutée (dialecte)', () => {
    expect(md).toContain('## Galerie {gallery}')
  })
  it('déduplique les assets identiques', () => {
    expect(files.length).toBe(2) // même data URL en étape et galerie → 2 noms préfixés distincts
  })
  it('galerie sans page : alt vide, pas de « page 0 » inventée', () => {
    const p = { ...PATTERN, gallery: [{ src: DATA_PNG }] }
    const { md: m } = patternToMd(p)
    expect(m).toContain('![]')
    expect(m).not.toContain('page 0')
  })
  it('étape chart sans section.chart ni reader.chart : aucune image cassée émise', () => {
    const sections = PATTERN.reader.sections.map((s) => (s.id === 'corps' ? { ...s, chart: undefined } : s))
    const p = { ...PATTERN, reader: { ...PATTERN.reader, chart: undefined, sections } }
    const { md: m } = patternToMd(p)
    expect(m).not.toContain('![Diagramme]()')
  })
  it('rétrocompat : section.chart absent, reader.chart (global, patron pré-multi-grilles) → grille quand même émise', () => {
    const sections = PATTERN.reader.sections.map((s) => (s.id === 'corps' ? { ...s, chart: undefined } : s))
    const p = { ...PATTERN, reader: { ...PATTERN.reader, sections } } // reader.chart conservé
    const { md: m } = patternToMd(p)
    expect(m).toContain('![Diagramme](/patterns/twist-chart.png)')
    expect(m).toContain('18 m × 52 rangs · lecture droite à gauche')
  })

  it('émet la grille de chaque section {chart} avec · tailles', () => {
    // img déjà qualifié (img/a.png) : asset() ne préfixe que les data: URL matérialisées
    // (cf. test 'diagramme : image seule + attributs' plus haut, chemin non-data: inchangé).
    const pattern = { name: 'T', author: '', sizes: ['S', 'M'], gallery: [], reader: {
      sizeLabels: ['S', 'M'], sections: [
        { id: 'g1', kind: 'diagramme', title: 'Grille dos', steps: [{ chart: true }], chart: { rows: 20, cols: 10, img: 'img/a.png', repeat: '10 m × 20 rangs', readDir: 'bas→haut', sizes: ['S'] } },
        { id: 'g2', kind: 'diagramme', title: 'Grille manche', steps: [{ chart: true }], chart: { rows: 30, cols: 12, img: 'img/b.png', repeat: '12 m × 30 rangs', readDir: '', sizes: ['M'] } },
      ],
    } }
    const { md } = patternToMd(pattern, { assetDir: 'img' })
    expect(md).toContain('![Diagramme](img/a.png)')
    expect(md).toContain('10 m × 20 rangs · lecture bas→haut · tailles S')
    expect(md).toContain('![Diagramme](img/b.png)')
    expect(md).toContain('12 m × 30 rangs · tailles M')
  })
  // Option de nommage aligné sauvegarde : assetDir='' (à plat) + galleryPrefix='gallery-'
  it("assetDir='' produit des chemins d'assets sans slash en tête", () => {
    const pattern = {
      reader: { sizeLabels: [], sections: [
        { title: 'Corps', steps: [{ t: 'monter', imgs: ['data:image/jpeg;base64,QUJD'] }] },
      ] },
    }
    const { md, files } = patternToMd(pattern, { assetDir: '' })
    const photo = files.find((f) => f.path.startsWith('photo-'))
    expect(photo).toBeTruthy()
    expect(photo.path).not.toMatch(/^\//) // pas de "/photo-…"
    expect(md).toContain(`(${photo.path})`) // la ref du md pointe le même chemin
  })
  it("galleryPrefix='gallery-' aligne le préfixe galerie sur la sauvegarde", () => {
    const pattern = { reader: { sizeLabels: [], sections: [] }, gallery: [{ src: 'data:image/jpeg;base64,REVG', page: 3 }] }
    const { md, files } = patternToMd(pattern, { assetDir: '', galleryPrefix: 'gallery-' })
    const g = files.find((f) => f.path.startsWith('gallery-'))
    expect(g).toBeTruthy()
    expect(md).toContain(`(${g.path})`)
  })
  it('défaut inchangé : assetDir=img + préfixe galerie-', () => {
    const pattern = { reader: { sizeLabels: [], sections: [] }, gallery: [{ src: 'data:image/jpeg;base64,REVG', page: 3 }] }
    const { files } = patternToMd(pattern)
    expect(files.find((f) => f.path.startsWith('img/galerie-'))).toBeTruthy()
  })
})

describe('isIntro (serialize.js) : id stable préféré au titre affiché', () => {
  it('section réellement générée par parseIntro (id: presentation) : reste headerless au round-trip', () => {
    const reader = {
      sizeLabels: ['T'],
      sections: [
        { id: 'presentation', kind: 'autre', title: 'Présentation', steps: [{ t: 'Un mot avant de commencer.', note: true }] },
        { id: 's1', kind: 'pelote', title: 'Corps', steps: [{ t: 'monter' }] },
      ],
    }
    const { md } = patternToMd({ reader })
    expect(md).not.toMatch(/## Présentation/)
    expect(md).toMatch(/Un mot avant de commencer\./)
  })

  it('section de TRAVAIL coïncidemment titrée « Présentation » mais avec un id non vide et distinct : reste une section normale, PAS absorbée en intro', () => {
    const reader = {
      sizeLabels: ['T'],
      sections: [
        { id: 'sec-abc123', kind: 'pelote', title: 'Présentation', steps: [{ t: 'Note libre.', note: true }] },
      ],
    }
    const { md } = patternToMd({ reader })
    // Avec l'ancien comportement (titre seul), cette section aurait perdu son ## et serait
    // devenue indiscernable d'une vraie intro. Avec id stable, elle garde son en-tête.
    expect(md).toMatch(/## Présentation/)
  })

  it('compat anciens patrons : id absent (chaîne vide), titre « Présentation », steps tous notes → reste reconnue comme intro', () => {
    const reader = {
      sizeLabels: ['T'],
      sections: [
        { id: '', kind: 'autre', title: 'Présentation', steps: [{ t: 'Texte historique.', note: true }] },
        { id: 's1', kind: 'pelote', title: 'Corps', steps: [{ t: 'monter' }] },
      ],
    }
    const { md } = patternToMd({ reader })
    expect(md).not.toMatch(/## Présentation/)
    expect(md).toMatch(/Texte historique\./)
  })
})

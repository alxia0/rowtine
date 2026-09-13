import { describe, it, expect } from 'vitest'
import { mdToPattern } from '@/utils/pattern-md/parse'
import { patternToMd } from '@/utils/pattern-md/serialize'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'
import { reservedKey } from '@/utils/pattern-md/refblocks'

const MD = `---
rowtine: 1
title: Mini
author: A
sizes: S · M
---

Un joli top d’été.

Se tricote de haut en bas.

## Échantillon

20 m = 10 cm

## Abréviations

| abr. | définition |
|------|------------|
| m. | maille |

## Corps {corps}

- Monter 80 (90) m.

> Penser à compter les rangs.

- × Rép. ce tour 4 (6) fois.
- Suivre le diagramme :

![Diagramme](img/chart.png)
18 m × 52 rangs · lecture droite à gauche

- Coudre les épaules.
  ![](img/photo-abc.jpg)

## Finitions

- Rentrer les fils.

## Galerie

![page 3](img/galerie-def.jpg)
`

describe('mdToPattern', () => {
  const { pattern, warnings } = mdToPattern(MD)
  const reader = pattern.reader

  it('métadonnées et tailles', () => {
    expect(warnings).toEqual([])
    expect(pattern.name).toBe('Mini')
    expect(reader.sizeLabels).toEqual(['S', 'M'])
    expect(pattern.sizes).toEqual(['S', 'M'])
  })
  it('intro → section Présentation (autre), une note par paragraphe', () => {
    const intro = reader.sections[0]
    expect(intro.title).toBe('presentation')
    expect(intro.kind).toBe('autre')
    expect(intro.steps.map((s) => !!s.note)).toEqual([true, true])
    expect(intro.steps[0].t).toBe('Un joli top d’été.')
  })
  it('référence : échantillon + abréviations', () => {
    expect(reader.reference.abbr['m.']).toBe('maille')
    const mat = reader.reference.tabs.find((t) => t.id === 'materiel')
    expect(mat.blocks[0].p[0]).toBe('20 m = 10 cm')
  })
  it('section de travail : ROW/NOTE/REP typés, kind, comptes', () => {
    const corps = reader.sections.find((s) => s.title === 'Corps')
    expect(corps.kind).toBe('corps')
    const [row, note, rep] = corps.steps
    expect(row).toMatchObject({ t: 'Monter {{0}} m.' })
    expect(row.c).toEqual([[80, 90]])
    expect(note.note).toBe(true)
    expect(rep.repeat).toBe(true)
    expect(rep.total).toEqual([4, 6])
  })
  it('diagramme : étape CHART + reader.chart', () => {
    const corps = reader.sections.find((s) => s.title === 'Corps')
    expect(corps.steps.some((s) => s.chart)).toBe(true)
    // Revue finale (31/07) : le moteur ne fabrique plus AUCUN texte pour `repeat` (ex-français
    // en dur, écrasait tout libellé traduit) — cols/rows suffisent, chartMotifLabel (reader.js)
    // reconstruit le libellé à l'AFFICHAGE dans la langue courante. Voir aussi
    // tests/unit/ReaderChart.spec.js pour la preuve côté affichage.
    expect(reader.chart).toEqual({ rows: 52, cols: 18, img: 'img/chart.png', repeat: '', readDir: 'droite à gauche', builtinLegend: false })
  })
  it('image d’étape rattachée à la bonne ligne', () => {
    const corps = reader.sections.find((s) => s.title === 'Corps')
    const coudre = corps.steps.find((s) => /Coudre/.test(s.t || ''))
    expect(coudre.imgs).toEqual(['img/photo-abc.jpg'])
  })
  it('galerie', () => {
    expect(pattern.gallery).toEqual([{ src: 'img/galerie-def.jpg', page: 3, w: 0, h: 0 }])
  })
})

describe('parsing tolérant', () => {
  it('- × sans nombre → ROW + avertissement CODÉ (pas une phrase française)', () => {
    const { pattern, warnings } = mdToPattern('---\nrowtine: 1\nsizes: S · M\n---\n## Corps\n- × Répéter encore.\n')
    const st = pattern.reader.sections[0].steps[0]
    expect(st.repeat).toBeUndefined()
    const w = warnings.find((w) => w.code === WARNING_CODES.SECTION_REPEAT_NO_COUNT)
    expect(w).toBeTruthy()
    expect(w.params.section).toBe('Corps')
    expect(warnings.every((w) => typeof w !== 'string')).toBe(true)
  })
  it('kind inconnu → avertissement CODÉ (section + kind en paramètres), section conservée', () => {
    const { pattern, warnings } = mdToPattern('---\nrowtine: 1\n---\n## Corps {zorglub}\n- Tricoter.\n')
    expect(pattern.reader.sections[0].steps.length).toBe(1)
    const w = warnings.find((w) => w.code === WARNING_CODES.SECTION_UNKNOWN_KIND)
    expect(w).toBeTruthy()
    expect(w.params.section).toBe('Corps')
    expect(w.params.kind).toBe('zorglub')
    expect(warnings.every((w) => typeof w !== 'string')).toBe(true)
  })
  it('texte nu sans étape précédente → note + avertissement CODÉ', () => {
    const { pattern, warnings } = mdToPattern('---\nrowtine: 1\n---\n## Corps\nTexte perdu.\n- Tricoter.\n')
    expect(pattern.reader.sections[0].steps[0].note).toBe(true)
    expect(warnings.length).toBe(1)
    expect(warnings[0].code).toBe(WARNING_CODES.SECTION_LOOSE_TEXT)
    expect(warnings[0].params.section).toBe('Corps')
  })
  it('image indentée sans étape porteuse (1re ligne de la section) → avertissement CODÉ, ignorée', () => {
    const { pattern, warnings } = mdToPattern('---\nrowtine: 1\n---\n## Photos\n  ![orpheline](x.png)\n- Coudre.\n')
    const w = warnings.find((w) => w.code === WARNING_CODES.SECTION_ORPHAN_IMAGE)
    expect(w).toBeTruthy()
    expect(w.params.section).toBe('Photos')
    // Ignorée : ne se retrouve nulle part dans les étapes de la section.
    const imgs = pattern.reader.sections[0].steps.flatMap((s) => s.imgs || [])
    expect(imgs).toEqual([])
    expect(warnings.every((w) => typeof w !== 'string')).toBe(true)
  })
  it('deuxième grille dans LA MÊME section {chart} → avertissement CODÉ, diagramme supplémentaire ignoré', () => {
    const md = '---\nrowtine: 1\n---\n## Motif {chart}\n\n![Diagramme](a.png)\n10 m × 20 rangs\n\n![Diagramme](b.png)\n'
    const { pattern, warnings } = mdToPattern(md)
    const w = warnings.find((w) => w.code === WARNING_CODES.SECTION_EXTRA_CHART)
    expect(w).toBeTruthy()
    expect(w.params.section).toBe('Motif')
    // La 1re grille est conservée, la 2e est bien ignorée (pas de 2e chart.img).
    expect(pattern.reader.chart.img).toBe('a.png')
    expect(warnings.every((w) => typeof w !== 'string')).toBe(true)
  })
  it('deux sections {chart} → une grille par section, sans avertissement', () => {
    const md = [
      '---', 'rowtine: 1', 'title: T', 'sizes: S · M', '---', '',
      '## Grille dos {chart}', '', '![Diagramme](a.png)', '10 m × 20 rangs · lecture bas→haut · tailles S', '',
      '## Grille manche {chart}', '', '![Diagramme](b.png)', '12 m × 30 rangs · tailles M', '',
    ].join('\n')
    const { pattern, warnings } = mdToPattern(md)
    const secs = pattern.reader.sections.filter((s) => s.chart)
    expect(secs.map((s) => s.chart.img)).toEqual(['a.png', 'b.png'])
    expect(secs[0].chart).toMatchObject({ rows: 20, cols: 10, readDir: 'bas→haut', sizes: ['S'], builtinLegend: false })
    expect(secs[1].chart).toMatchObject({ rows: 30, cols: 12, sizes: ['M'], builtinLegend: false })
    expect(warnings.filter((w) => w.code === WARNING_CODES.SECTION_EXTRA_CHART)).toEqual([])
    // rétrocompat : reader.chart = première grille
    expect(pattern.reader.chart.img).toBe('a.png')
  })

  it('grille sans · tailles → pas de sizes (valable toutes tailles)', () => {
    const md = [
      '---', 'rowtine: 1', 'title: T', 'sizes: S · M', '---', '',
      '## Grille {chart}', '', '![Diagramme](a.png)', '10 m × 20 rangs', '',
    ].join('\n')
    const { pattern } = mdToPattern(md)
    expect(pattern.reader.sections.find((s) => s.chart).chart.sizes).toBeUndefined()
  })

  it('· tailles avec libellé inconnu → avertissement CODÉ + libellé filtré', () => {
    const md = [
      '---', 'rowtine: 1', 'title: T', 'sizes: S · M', '---', '',
      '## Grille {chart}', '', '![Diagramme](a.png)', '10 m × 20 rangs · tailles S, XXL', '',
    ].join('\n')
    const { pattern, warnings } = mdToPattern(md)
    expect(pattern.reader.sections.find((s) => s.chart).chart.sizes).toEqual(['S'])
    const w = warnings.find((w) => w.code === WARNING_CODES.SECTION_UNKNOWN_SIZES)
    expect(w).toBeTruthy()
    expect(w.params.section).toBe('Grille')
    expect(w.params.sizes).toBe('XXL')
    expect(warnings.every((w) => typeof w !== 'string')).toBe(true)
  })
  it('jamais d’exception sur une chaîne quelconque', () => {
    expect(() => mdToPattern('')).not.toThrow()
    expect(() => mdToPattern('| | |\n> \n- ×\n## \n')).not.toThrow()
  })
  it('marqueur × collé ou avec espaces multiples reconnu comme répétition', () => {
    const { pattern } = mdToPattern('---\nrowtine: 1\nsizes: S · M\n---\n## Corps\n- ×Rép. ce tour 4 (6) fois.\n-  ×  Rép. encore 2 (3) fois.\n')
    const [a, b] = pattern.reader.sections[0].steps
    expect(a.repeat).toBe(true)
    expect(a.total).toEqual([4, 6])
    expect(b.repeat).toBe(true)
    expect(b.total).toEqual([2, 3])
  })
  it('note multi-lignes : les comptes des lignes suivantes sont vectorisés', () => {
    const md = '---\nrowtine: 1\nsizes: S · M\n---\n## Corps\n> Recommencer 4 (6) fois.\n> Attention aux 2 (3) dernières mailles.\n'
    const st = mdToPattern(md).pattern.reader.sections[0].steps[0]
    expect(st.note).toBe(true)
    expect(st.t).toBe('Recommencer {{0}} fois. Attention aux {{1}} dernières mailles.')
    expect(st.c).toEqual([[4, 6], [2, 3]])
  })
  it('titre réservé avec {kind} explicite = section de travail, pas un bloc référence', () => {
    const { pattern, warnings } = mdToPattern('---\nrowtine: 1\nsizes: S · M\n---\n## Tailles {corps}\n- Monter 80 (90) m.\n')
    expect(warnings).toEqual([])
    const sec = pattern.reader.sections[0]
    expect(sec.title).toBe('Tailles')
    expect(sec.steps.length).toBe(1)
  })
  it('bloc réservé à table sans table exploitable → avertissement CODÉ, rien de perdu en silence', () => {
    // Collatéral (pré-existant) : ce test datait d'avant la migration de refblocks.js
    // (déjà codé, BLOCK_NOT_A_TABLE) et cassait avec un TypeError (`w.includes is not a
    // function`) — corrigé ici en même temps que les 9 phrases de cette tâche.
    const { warnings } = mdToPattern('---\nrowtine: 1\nsizes: S · M\n---\n## Tailles\n- Monter 80 (90) m.\n')
    const w = warnings.find((w) => w.code === WARNING_CODES.BLOCK_NOT_A_TABLE)
    expect(w).toBeTruthy()
    expect(w.params.blockKey).toBe('sizeTable')
  })
})

// Désambiguïsation par tag EN + compat FR héritée (le crux).
describe('désambiguïsation bloc référence / section de travail (dialecte EN)', () => {
  it('tag de référence EN {materials} → bloc référence (flat.materials), pas une section', () => {
    const md = '---\nrowtine: 1\n---\n## Matériel {materials}\n\n- 4 anneaux marqueurs\n'
    const { pattern, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    expect(pattern.reader.sections.some((s) => s.title === 'Matériel')).toBe(false)
    expect(pattern.reader.reference.tabs.find((t) => t.id === 'materiel').blocks[0].p).toEqual(['4 anneaux marqueurs'])
  })
  it('tag de kind de travail EN {body} → section de travail kind interne corps', () => {
    const md = '---\nrowtine: 1\n---\n## Dos {body}\n- Monter 10 m.\n'
    const { pattern, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    const sec = pattern.reader.sections.find((s) => s.title === 'Dos')
    expect(sec.kind).toBe('corps')
  })
  it("ANTI-RÉGRESSION : section de travail titrée d'un mot réservé {sleeve} n'est PAS absorbée en bloc référence", () => {
    const md = '---\nrowtine: 1\n---\n## Aiguilles {sleeve}\n- Monter 10 m.\n'
    const { pattern, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    expect(pattern.reader.reference).toBeUndefined()
    const sec = pattern.reader.sections.find((s) => s.title === 'Aiguilles')
    expect(sec).toBeTruthy()
    expect(sec.kind).toBe('manche')
  })
  it('compat FR héritée : « Matériel » non balisé → bloc référence', () => {
    const md = '---\nrowtine: 1\n---\n## Matériel\n\n- 4 anneaux marqueurs\n'
    const { pattern, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    expect(pattern.reader.sections.some((s) => s.title === 'Matériel')).toBe(false)
    expect(pattern.reader.reference.tabs.find((t) => t.id === 'materiel').blocks[0].p).toEqual(['4 anneaux marqueurs'])
  })
  it('compat FR héritée : tag déjà FR {corps} repasse corps (section de travail)', () => {
    const md = '---\nrowtine: 1\n---\n## Dos {corps}\n- Monter 10 m.\n'
    const { pattern, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    const sec = pattern.reader.sections.find((s) => s.title === 'Dos')
    expect(sec.kind).toBe('corps')
  })
  it('collision {measurements} → sizeTable (pas mesures)', () => {
    const md = '---\nrowtine: 1\nsizes: S · M\n---\n## Tailles {measurements}\n\n| mesure | S | M |\n|---|---|---|\n| Tour | 74 | 82 |\n'
    const { pattern, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    expect(pattern.reader.sections.some((s) => s.title === 'Tailles')).toBe(false)
    const tab = pattern.reader.reference.tabs.find((t) => t.id === 'tailles')
    expect(tab).toBeTruthy()
  })
})

// Revue finale : C1 (perte silencieuse d'une section de travail
// kind echantillon, collision de balise avec le bloc référence) + M1 (perte
// silencieuse d'un bloc {intro}).
describe('correctif C1 : section de travail kind echantillon (balise EN distincte du bloc référence)', () => {
  it("REPRO (avant correctif) puis FIX : round-trip serialize→parse d'une section de travail kind echantillon la préserve", () => {
    const pattern = {
      name: 'Mini', author: '', authorUrl: '', gallery: [],
      reader: {
        sizeLabels: [], sizeSub: [], sizeSubLabel: '', easeHint: '',
        sections: [
          { id: 'echantillon', kind: 'echantillon', title: "Carré d'échantillon", steps: [
            { t: 'Monter 20 m.' },
            { t: 'Tricoter 20 rangs en jersey.' },
          ] },
        ],
      },
    }
    const { md } = patternToMd(pattern)
    // Le kind de travail doit porter une balise EN distincte du bloc référence
    // {gauge} (sinon collision C1 : la section est aplatie en bloc référence).
    expect(md).toContain('{swatch}')
    expect(md).not.toContain("Carré d'échantillon {gauge}")

    const { pattern: p2, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    // Pas absorbée en bloc référence : reader.reference doit rester vide.
    expect(p2.reader.reference).toBeUndefined()
    const sec = p2.reader.sections.find((s) => s.title === "Carré d'échantillon")
    expect(sec).toBeTruthy()
    expect(sec.kind).toBe('echantillon')
    expect(sec.steps.length).toBe(2)
  })

  it('non-régression : le bloc référence « Échantillon {gauge} » route toujours en référence', () => {
    const md = '---\nrowtine: 1\n---\n## Échantillon {gauge}\n\n20 m = 10 cm\n'
    const { pattern, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    expect(pattern.reader.sections.some((s) => /chantillon/i.test(s.title))).toBe(false)
    expect(pattern.reader.reference.tabs.find((t) => t.id === 'materiel').blocks[0].p).toEqual(['20 m = 10 cm'])
  })

  it('aucune collision résiduelle : intersection des balises de kind de travail et des balises de référence est vide', async () => {
    const { KIND_TO_EN, REF_TO_EN } = await import('@/utils/pattern-md/dialect')
    const kindTags = new Set(Object.values(KIND_TO_EN))
    const refTags = new Set(Object.values(REF_TO_EN))
    const intersection = [...kindTags].filter((t) => refTags.has(t))
    expect(intersection).toEqual([])
  })
})

describe('correctif M1 : bloc {intro} externe ne doit plus perdre son contenu en silence', () => {
  it('## Présentation {intro} (MD externe, jamais émis par l’app) : le contenu est préservé', () => {
    const md = '---\nrowtine: 1\n---\n## Présentation {intro}\n\nDu texte de présentation important.\n'
    const { pattern } = mdToPattern(md)
    const allSteps = pattern.reader.sections.flatMap((s) => s.steps.map((st) => st.t))
    expect(allSteps).toContain('Du texte de présentation important.')
  })
})

describe('diagramme — compteur de répétition (· répéter N fois)', () => {
  it('parse « · répéter 5 fois » sur la ligne d’attributs → chart.reps = 5', () => {
    const md = '---\nrowtine: 1\n---\n## Motif {chart}\n![Diagramme](img/c.png)\n18 m × 52 rangs · lecture droite à gauche · répéter 5 fois\n'
    const { pattern } = mdToPattern(md)
    expect(pattern.reader.chart.rows).toBe(52)
    expect(pattern.reader.chart.readDir).toBe('droite à gauche')
    expect(pattern.reader.chart.reps).toBe(5)
  })
  it('clause « répéter » seule (sans « lecture ») parse aussi', () => {
    const md = '---\nrowtine: 1\n---\n## Motif {chart}\n![Diagramme](img/c.png)\n18 m × 52 rangs · répéter 3 fois\n'
    expect(mdToPattern(md).pattern.reader.chart.reps).toBe(3)
  })
  it('non-régression : ligne d’attributs sans « répéter » → reps non défini', () => {
    const md = '---\nrowtine: 1\n---\n## Motif {chart}\n![Diagramme](img/c.png)\n18 m × 52 rangs · lecture droite à gauche\n'
    const ch = mdToPattern(md).pattern.reader.chart
    expect(ch.rows).toBe(52)
    expect(ch.reps).toBeUndefined()
  })
  it('sérialise « · répéter N fois » quand chart.reps est défini', () => {
    // Chaque section {chart} réémet SA grille (Lot A multi-grilles) : chart aussi porté par la section.
    const chart = { img: 'img/c.png', cols: 18, rows: 52, readDir: 'droite à gauche', reps: 5 }
    const reader = { title: 'P', sizes: [], chart, sections: [ { title: 'Motif', kind: 'diagramme', steps: [ { chart: true } ], chart } ] }
    const { md } = patternToMd({ name: 'P', reader })
    expect(md).toMatch(/18 m × 52 rangs · lecture droite à gauche · répéter 5 fois/)
  })
  it('n’émet PAS « répéter » quand reps est absent', () => {
    const chart = { img: 'img/c.png', cols: 18, rows: 52, readDir: 'droite à gauche' }
    const reader = { title: 'P', sizes: [], chart, sections: [ { title: 'Motif', kind: 'diagramme', steps: [ { chart: true } ], chart } ] }
    expect(patternToMd({ name: 'P', reader }).md).not.toMatch(/répéter/)
  })
})

describe("demotedSection : titre = clé interne + suffixe '-notes' (anti-collision RESERVED)", () => {
  it("bloc {gallery} avec du contenu non exploitable : la section de repli est titrée 'galerie-notes', pas 'galerie' ni 'Fil (texte conservé)'", () => {
    const md = "---\nrowtine: 1\n---\n## Fil {yarn}\n\nDe la vraie laine.\n\n- une puce qui n'est pas du texte libre de rubrique\n"
    // Un bloc {yarn} est du texte libre : toute ligne finit dans `yarn`, rien ne devrait
    // normalement être démoté. On force le cas via une ligne de type table dans un bloc
    // qui n'en attend pas — cf. le test existant `refblocks-non-destructif.spec.js` pour
    // le mécanisme de leftover ; ce test-ci vérifie uniquement le TITRE produit, pas la
    // logique de démotion elle-même (déjà couverte ailleurs).
    const galleryMd = "---\nrowtine: 1\n---\n## Galerie {gallery}\n\nune légende orpheline entre deux images\n\n![](img/a.png)\n"
    const { pattern } = mdToPattern(galleryMd)
    const demoted = pattern.reader.sections.find((s) => s.kind === "autre")
    expect(demoted).toBeTruthy()
    expect(demoted.title).toBe("galerie-notes")
    expect(demoted.title).not.toMatch(/texte conservé/i)
    expect(demoted.title).not.toBe("Aide-mémoire (texte conservé)")
  })

  it("le suffixe '-notes' évite la collision avec RESERVED (refblocks.js) pour les 9 clés possibles", () => {
    // Régression mesurée par la revue finale : 'galerie' et 'techniques' sont AUSSI des
    // clés du dictionnaire RESERVED (refblocks.js) qui reconnaît des titres FR non balisés
    // comme blocs de référence. Un `demotedSection` titré `title: key` NU (sans suffixe)
    // redeviendrait donc réabsorbable à tort si son tag `{other}` est un jour retiré (ex.
    // retaguage vers le kind par défaut) : `reservedKey('galerie')` matche `RESERVED.galerie`.
    // Preuve directe et suffisante, sans round-trip serialize/retag/reparse : aucune des 9
    // clés possibles, une fois suffixée `-notes`, ne matche plus RESERVED.
    const keys = ['yarn', 'needles', 'gauge', 'materials', 'techniques', 'tips', 'abbr', 'sizeTable', 'galerie']
    for (const key of keys) {
      expect(reservedKey(`${key}-notes`)).toBeNull()
    }
  })
})

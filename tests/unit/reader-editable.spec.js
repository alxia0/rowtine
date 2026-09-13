// tests/unit/reader-editable.spec.js — Task B1 : reader <-> Rowtine-MD éditable.
// Round-trip fidèle SANS édition (Step 1) + édition d'une ligne préserve le reste
// (Step 2). Inclut EXPRESSÉMENT les deux cas connus lossy (f/g) : on ne
// suppose jamais qu'un champ survit, on le prouve (ou on prouve la perte brique
// puis le rattrapage par `editableToReader`).
import { describe, it, expect } from 'vitest'
import { readerToEditable, editableToReader } from '@/utils/pattern-md/reader-editable'
import { readerToMdFragment, mdFragmentToReader } from '@/utils/pattern-md/fragment'
import { buildReference } from '@/utils/reader-reference'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'
import { photoFileName } from '@/backup/naming'

// Sous-ensemble sémantique d'une section, indépendant de l'`id` recalculé au
// reparse (slug du titre — B2's concern, pas celui-ci). Même convention que
// tests/unit/pattern-md-fragment.spec.js.
const sectionShape = (sec) => ({ kind: sec.kind, title: sec.title, steps: sec.steps })
const shape = (reader) => (reader.sections || []).map(sectionShape)

const DATA_URL = 'data:image/png;base64,AAAAAAAA'

// Fixture principale : couvre (a) texte simple rangs+note, (b) images data-URL,
// (c) aide-mémoire (reader.reference), (d) compteur cohérent (total === c[0]),
// (e) multi-tailles (step.c longueur >=2). (f) et (g) sont des fixtures À PART
// (tailles différentes / cas volontairement incohérent), cf. plus bas.
function makeReader() {
  return {
    sizeLabels: ['S', 'M'],
    reference: buildReference({
      abbr: [{ key: 'm.', def: 'maille' }, { key: 'rg.', def: 'rang' }],
    }),
    sections: [
      {
        id: 'corps',
        kind: 'corps',
        title: 'Corps',
        steps: [
          // (a) texte simple : rang + note
          { t: 'Monter des mailles au poignet.' },
          { t: 'Continuer en jersey endroit sur tout le rang.', note: true },
          // (b) image data-URL portée par un step
          { t: 'Coudre les épaules.', imgs: [DATA_URL] },
          // (d) compteur cohérent : total === c[0]
          { t: 'Rép. ce rang {{0}} fois.', c: [[4, 6]], total: [4, 6], repeat: true },
          // (e) multi-tailles : step.c longueur >= 2 (n=2 tailles ici)
          { t: 'Monter {{0}} m.', c: [[104, 112]] },
        ],
      },
    ],
  }
}

// (g) répétition : `total` ([99, 99]) ≠ `c[0]` ([4, 6]) — le nombre de
// répétitions est volontairement différent du décompte de mailles. Le
// sérialiseur émet désormais un marqueur explicite `- {×N} …` qui encode
// `total` INDÉPENDAMMENT de `c` (ici `{×99}`), et ce marqueur est relu au
// reparse : la valeur d'origine (99) SURVIT donc à un aller-retour
// brique-à-brique — ce qui se perdait avant (régénéré à c[0]) est désormais
// préservé. Sondé empiriquement avant d'écrire ce test.
function makeReaderG() {
  return {
    sizeLabels: ['S', 'M'],
    sections: [
      {
        id: 'corps',
        kind: 'corps',
        title: 'Corps',
        steps: [
          { t: 'Rép. ce rang {{0}} fois.', c: [[4, 6]], total: [99, 99], repeat: true },
        ],
      },
    ],
  }
}

// (f) CAS PERDANT — taille unique : `sizeLabels` longueur < 2 avec un `step.c`
// présent. `mdTextToStep` (line.js) renonce à toute vectorisation dès que n<2
// (`if (!n || n < 2) return { t: src }`) : le nombre reste bien dans le texte
// papier mais `c` ne peut jamais être reconstruit à la relecture — perte
// garantie, indépendante de toute édition. Sondé empiriquement.
function makeReaderF() {
  return {
    sizeLabels: ['Taille unique'],
    sections: [
      {
        id: 'corps',
        kind: 'corps',
        title: 'Corps',
        steps: [
          { t: 'Monter {{0}} m.', c: [[104]] },
        ],
      },
    ],
  }
}

// (f)+(g) CUMUL — un même step porte À LA FOIS le cas (f) (taille unique,
// `sizeLabels.length` = 1, `c` présent) ET le cas (g) (répétition avec
// `total` ([99]) ≠ `c[0]` ([104])). Task D2 : une ligne éditée qui casse les
// deux rattrapages à la fois doit produire DEUX avertissements distincts, pas
// un seul (remainingCarveLoss ne doit plus s'arrêter au premier match).
function makeReaderFG() {
  return {
    sizeLabels: ['Taille unique'],
    sections: [
      {
        id: 'corps',
        kind: 'corps',
        title: 'Corps',
        steps: [
          { t: 'Rép. ce rang {{0}} fois.', c: [[104]], total: [99], repeat: true },
        ],
      },
    ],
  }
}

describe('readerToEditable / editableToReader — round-trip sans édition (Step 1)', () => {
  const reader = makeReader()
  const { md, images } = readerToEditable(reader)
  const { reader: out, warnings } = editableToReader(md, reader)

  it('ne jette pas d’avertissement', () => {
    expect(warnings).toEqual([])
  })

  it('(a)(b)(c)(d)(e) : structure des sections préservée (kind/title/steps, hors id)', () => {
    expect(shape(out)).toEqual(shape(reader))
  })

  it('(c) aide-mémoire (reader.reference) préservé', () => {
    expect(out.reference).toEqual(reader.reference)
  })

  it('(b) image data-URL du step SURVIT (pas de chemin nu résiduel)', () => {
    expect(out.sections[0].steps[2].imgs[0]).toBe(DATA_URL)
    expect(out.sections[0].steps[2].imgs[0].startsWith('data:')).toBe(true)
  })

  it('(d) compteur cohérent préservé (c et total intacts)', () => {
    expect(out.sections[0].steps[3].c).toEqual(reader.sections[0].steps[3].c)
    expect(out.sections[0].steps[3].total).toEqual(reader.sections[0].steps[3].total)
  })

  it('(e) multi-tailles préservé (step.c longueur >= 2)', () => {
    expect(out.sections[0].steps[4].c).toEqual(reader.sections[0].steps[4].c)
  })

  it('images : la map dérivée du reader contient bien la data-URL du step (buildImageMap réutilisé)', () => {
    expect(images).toBeInstanceOf(Map)
    expect([...images.values()]).toContain(DATA_URL)
  })
})

describe('(f) CAS PERDANT taille unique — brique nue perd `c`, editableToReader le rattrape', () => {
  const readerF = makeReaderF()

  it('PREUVE DE LA PERTE au niveau brique (readerToMdFragment + mdFragmentToReader, sans carving)', () => {
    const fragment = readerToMdFragment(readerF)
    const { reader: rawOut } = mdFragmentToReader(fragment, readerF)
    // Documente le choix : n<2 => aucune vectorisation possible (line.js), `c`
    // disparaît purement et simplement au reparse brique-à-brique.
    expect(rawOut.sections[0].steps[0].c).toBeUndefined()
    expect(rawOut.sections[0].steps[0].t).toBe('Monter 104 m.')
  })

  it('RATTRAPAGE : editableToReader carve le step non édité, `c` survit intact', () => {
    const { md } = readerToEditable(readerF)
    const { reader: out, warnings } = editableToReader(md, readerF)
    expect(warnings).toEqual([])
    expect(out.sections[0].steps[0].c).toEqual([[104]])
    expect(shape(out)).toEqual(shape(readerF))
  })
})

describe('(g) répétition total ≠ c[0] — le marqueur {×N} préserve `total` au round-trip', () => {
  const readerG = makeReaderG()

  it('le marqueur {×N} préserve `total` au round-trip brique, même quand total ≠ c[0]', () => {
    const fragment = readerToMdFragment(readerG)
    // Le pas se sérialise avec un marqueur explicite `{×99}` qui encode `total`
    // (99) INDÉPENDAMMENT de `c` (4/6) : le nombre est écrit noir sur blanc dans
    // le MD, il ne dépend plus du décompte de mailles.
    expect(fragment).toContain('{×99}')
    const { reader: rawOut } = mdFragmentToReader(fragment, readerG)
    const step = rawOut.sections[0].steps[0]
    // Relu au reparse, `total` (99) SURVIT — il n'est plus régénéré à c[0].
    // C'est le progrès : une valeur qui se perdait est maintenant préservée.
    expect(step.total).toEqual([99, 99])
    // `c` et `repeat` restent cohérents autour du marqueur.
    expect(step.c).toEqual([[4, 6]])
    expect(step.repeat).toBe(true)
  })

  it('RATTRAPAGE : editableToReader carve le step non édité, `total` (99) d’origine survit', () => {
    const { md } = readerToEditable(readerG)
    const { reader: out, warnings } = editableToReader(md, readerG)
    expect(warnings).toEqual([])
    expect(out.sections[0].steps[0].total).toEqual([99, 99])
    expect(shape(out)).toEqual(shape(readerG))
  })
})

describe('(g) édition PROSE SEULE (verbe) sur une ligne de répétition — comptes inchangés', () => {
  it('changer uniquement le verbe (Rép. -> Répéter), comptes intacts : `total` d’origine PRÉSERVÉ, aucun avertissement', () => {
    // Revue Majeure : éditer EXCLUSIVEMENT la prose de la ligne carvée (g) sans
    // toucher aux comptes (4/6 restent 4/6) changeait la signature "papier"
    // complète -> carving désactivé -> total régénéré à c[0] ([4,6]), la
    // valeur d'origine (99,99) perdue SANS AVERTISSEMENT. `total` est orthogonal
    // à la prose (jamais rendu par stepTextToMd) : un edit qui laisse les
    // comptes intacts doit préserver `total`, pas le redériver.
    const readerG = makeReaderG()
    const { md } = readerToEditable(readerG)
    expect(md).toContain('Rép.')
    const editedMd = md.replace('Rép.', 'Répéter')

    const { reader: out, warnings } = editableToReader(editedMd, readerG)

    expect(warnings).toEqual([])
    expect(out.sections[0].steps[0].t).toBe('Répéter ce rang {{0}} fois.')
    expect(out.sections[0].steps[0].c).toEqual([[4, 6]]) // comptes inchangés
    expect(out.sections[0].steps[0].total).toEqual([99, 99]) // total d'ORIGINE préservé, pas régénéré
  })
})

describe('(f) édition du NOMBRE sur une ligne taille unique — perte réelle, avertissement VISIBLE', () => {
  it('changer 104 -> 105 casse le rattrapage automatique (le nombre édité EST le texte) : `c` perdu MAIS signalé dans warnings', () => {
    // Revue Majeure : contrairement à (g), il n'existe pas de "signature de
    // comptes" indépendante du texte pour une ligne taille unique (n<2) --
    // mdTextToStep ne vectorise jamais dans ce cas, le nombre édité EST la
    // seule trace du compte. Le rattrapage ciblé ne peut donc PAS s'appliquer :
    // `c` disparaît réellement. Ce n'est plus une perte SILENCIEUSE : un
    // avertissement actionnable doit apparaître dans `warnings`.
    const readerF = makeReaderF()
    const { md } = readerToEditable(readerF)
    expect(md).toContain('104')
    const editedMd = md.replace('104', '105')

    const { reader: out, warnings } = editableToReader(editedMd, readerF)

    expect(out.sections[0].steps[0].t).toBe('Monter 105 m.')
    expect(out.sections[0].steps[0].c).toBeUndefined() // perte réelle, aucune magie possible
    expect(warnings.length).toBeGreaterThan(0)
    // Avertissement STRUCTURÉ (code + params), plus une phrase française en dur : la traduction
    // se fait à l'affichage (warning-i18n.js), jamais dans le moteur.
    expect(warnings.some((w) => w.code === WARNING_CODES.LINE_LOSS_SIZE_COUNTS)).toBe(true)
  })
})

describe('(f)+(g) CUMUL — une ligne éditée perd À LA FOIS `total` et le décompte par taille', () => {
  it('changer le marqueur {×99}->{×3} ET le nombre 104->105 casse les deux rattrapages : DEUX avertissements distincts', () => {
    // Task D2 : avant le correctif, remainingCarveLoss `return`ait dès le 1er
    // match (cas g, total) — le cas f (décompte par taille), pourtant perdu
    // lui aussi sur la MÊME ligne, ne produisait aucun second avertissement.
    const readerFG = makeReaderFG()
    const { md } = readerToEditable(readerFG)
    expect(md).toContain('{×99}')
    expect(md).toContain('104')
    const editedMd = md.replace('{×99}', '{×3}').replace('104', '105')

    const { reader: out, warnings } = editableToReader(editedMd, readerFG)

    expect(out.sections[0].steps[0].t).toBe('Rép. ce rang 105 fois.')
    expect(out.sections[0].steps[0].c).toBeUndefined() // (f) perdu : taille unique, jamais vectorisé
    expect(out.sections[0].steps[0].total).toEqual([3]) // (g) non rattrapé : marqueur édité pris tel quel
    // Avertissements STRUCTURÉS : la ligne concernée voyage dans `params.line`, pas dans une
    // phrase française toute faite.
    const lineWarnings = warnings.filter((w) => w.params?.line?.includes('Rép. ce rang'))
    expect(lineWarnings).toHaveLength(2)
    expect(lineWarnings.some((w) => w.code === WARNING_CODES.LINE_LOSS_TOTAL)).toBe(true)
    expect(lineWarnings.some((w) => w.code === WARNING_CODES.LINE_LOSS_SIZE_COUNTS)).toBe(true)
  })
})

// Task B2 — diagrammes opaques par EMPREINTE IMAGE (robuste au renommage ET au
// réordre des sections). `chart.img` (data-URL) → empreinte photoFileName ; on
// ré-attache l'objet `chart` d'ORIGINE entier (jamais re-sérialisé), retrouvé
// par cette empreinte sur la section correspondante après reparse, quels que
// soient son nouveau titre ou sa nouvelle position.
const CHART_DATA_URL = 'data:image/png;base64,AAAA'

// (rows/cols 0 = cas lossy connu : serialize.js n'émet la ligne d'attributs
// -- laquelle porte seule `readDir` -- QUE si rows||cols ; à 0/0 elle n'est
// JAMAIS écrite dans le md, donc `readDir` ('droite-gauche') ne survivrait pas
// à un aller-retour brique-à-brique sans le rattachement par empreinte.)
function makeChartSection() {
  return {
    id: 'diag-1',
    kind: 'diagramme',
    title: 'Grille A',
    steps: [{ chart: true }],
    chart: {
      rows: 0,
      cols: 0,
      img: CHART_DATA_URL,
      readDir: 'droite-gauche',
      reps: '',
      sizes: [],
      builtinLegend: false,
    },
  }
}

describe('diagramme opaque par empreinte image — robuste au renommage (Task B2, Step 1)', () => {
  it('renommer le titre de la section-diagramme préserve chart.readDir et chart.img malgré rows/cols=0', () => {
    const reader = { sizeLabels: ['S', 'M'], sections: [makeChartSection()] }
    const { md } = readerToEditable(reader)
    expect(md).toContain('## Grille A {chart}')
    const editedMd = md.replace('## Grille A {chart}', '## Grille torsade {chart}')

    const { reader: out, warnings } = editableToReader(editedMd, reader)

    expect(warnings).toEqual([])
    const diag = out.sections.find((s) => s.title === 'Grille torsade')
    expect(diag).toBeTruthy()
    expect(diag.chart.readDir).toBe('droite-gauche')
    expect(diag.chart.img).toBe(CHART_DATA_URL)
    // L'objet `chart` d'origine ENTIER survit (rows/cols/reps/sizes/builtinLegend
    // compris), pas seulement les deux champs sondés ci-dessus.
    expect(diag.chart).toEqual(makeChartSection().chart)
  })
})

describe('diagramme opaque par empreinte image — robuste au réordre (Task B2, Step 2)', () => {
  it('déplacer la section-diagramme avant le corps préserve le diagramme à sa nouvelle position', () => {
    const reader = {
      sizeLabels: ['S', 'M'],
      sections: [
        { id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter des mailles.' }] },
        makeChartSection(),
      ],
    }
    const { md } = readerToEditable(reader)
    const idxCorps = md.indexOf('## Corps')
    const idxChart = md.indexOf('## Grille A {chart}')
    expect(idxCorps).toBeGreaterThanOrEqual(0)
    expect(idxChart).toBeGreaterThan(idxCorps)
    const before = md.slice(0, idxCorps)
    const blockCorps = md.slice(idxCorps, idxChart)
    const blockChart = md.slice(idxChart)
    const reorderedMd = before + blockChart + blockCorps

    const { reader: out, warnings } = editableToReader(reorderedMd, reader)

    expect(warnings).toEqual([])
    expect(out.sections[0].title).toBe('Grille A')
    expect(out.sections[0].chart.readDir).toBe('droite-gauche')
    expect(out.sections[0].chart.img).toBe(CHART_DATA_URL)
    expect(out.sections[1].title).toBe('Corps')
  })
})

// Task D6 — anti-aliasing chart legacy. `chart` top-level ORPHELIN (repli
// rétrocompat, cf. serialize.js `ch = sec.chart || reader.chart`) : présent sur
// baseReader mais AUCUN step `{chart:true}` nulle part -- serialize.js n'émet
// donc JAMAIS la moindre trace de ce diagramme dans le fragment (garde
// `if (st.chart)` jamais déclenchée), et le reparse ne retrouve donc RIEN
// (`parsedReader.chart` reste `null`). C'est PRÉCISÉMENT le repli legacy de
// mdFragmentToReader (`chart: parsedReader.chart ?? baseReader.chart`) qui
// prend alors le relais -- sondé empiriquement (probe ad hoc) : c'est le SEUL
// fixture qui atteint ce repli (un chart de section, lui, round-trip toujours
// via reattachCharts/cloneStep, déjà défensif).
const ORPHAN_CHART_DATA_URL = 'data:image/png;base64,CCCCCCCC'

function makeOrphanChartReader() {
  return {
    sizeLabels: ['S', 'M'],
    chart: {
      rows: 5, cols: 5, img: ORPHAN_CHART_DATA_URL,
      readDir: 'droite-gauche', reps: '', sizes: [], builtinLegend: false,
    },
    sections: [
      {
        id: 'corps',
        kind: 'corps',
        title: 'Corps',
        steps: [
          { t: 'Monter des mailles.' },
          { t: 'Coudre les épaules.', imgs: [DATA_URL] },
        ],
      },
    ],
  }
}

describe('editableToReader ne mute jamais baseReader (anti-aliasing chart legacy, Task D6)', () => {
  it('chart top-level orphelin (aucun step {chart:true}) : le repli legacy ne doit pas aliaser baseReader.chart', () => {
    const baseReader = makeOrphanChartReader()
    const snapshot = JSON.parse(JSON.stringify(baseReader))
    const { md } = readerToEditable(baseReader)
    const { reader: out, warnings } = editableToReader(md, baseReader)

    expect(warnings).toEqual([])
    // Le chart orphelin survit EN VALEUR (repli legacy voulu, cf. commentaire ci-dessus)...
    expect(out.chart).toEqual(baseReader.chart)
    // ...mais JAMAIS par référence : un objet aliasé permettrait à toute mutation
    // en aval de `out.chart` de corrompre en silence le snapshot durable `baseReader`.
    expect(out.chart).not.toBe(baseReader.chart)

    // Preuve par la douleur : muter l'objet retourné (usage légitime en aval, ex.
    // un futur écran qui éditerait le chart) ne doit JAMAIS atteindre baseReader.
    if (out.chart) out.chart.img = 'data:image/png;base64,MUTATED'
    expect(baseReader).toEqual(snapshot)
  })
})

// Task D6b — les deux replis LATENTS symétriques du chart, confirmés par la
// revue comme RÉELS. Même dialecte de test que D6 : assertion d'IDENTITÉ
// (`not.toBe`) + preuve par la douleur (muter la sortie, revérifier le snapshot
// de baseReader). Un `toEqual` nu ne mord PAS ici (leçon D6 : le repli préserve
// la VALEUR, seule l'identité d'objet trahit l'aliasing).

describe('editableToReader ne mute jamais baseReader — repli reference (Task D6b)', () => {
  it('fragment sans bloc référence : le repli reference ne doit pas aliaser baseReader.reference', () => {
    // Le baseReader porte une aide-mémoire ; le fragment édité, lui, n'en émet
    // AUCUNE (une section de travail seule) -> `parsedReader.reference` reste
    // absent -> le repli `?? baseReader.reference` prend le relais. Sans clone,
    // `out.reference` EST l'objet de baseReader (aliasé).
    const baseReader = {
      sizeLabels: ['S', 'M'],
      reference: buildReference({ abbr: [{ key: 'm.', def: 'maille' }], yarn: 'Laine douce' }),
      sections: [{ id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter des mailles.' }] }],
    }
    const snapshot = JSON.parse(JSON.stringify(baseReader))
    // md dérivé d'un reader SANS reference : le fragment n'a pas de bloc référence.
    const { md } = readerToEditable({ sizeLabels: ['S', 'M'], sections: baseReader.sections })
    const { reader: out, warnings } = editableToReader(md, baseReader)

    expect(warnings).toEqual([])
    expect(out.reference).toEqual(baseReader.reference) // survit EN VALEUR (repli)
    expect(out.reference).not.toBe(baseReader.reference) // mais JAMAIS par référence

    // Preuve par la douleur : muter la sortie ne doit pas atteindre baseReader.
    if (out.reference) out.reference.__muté = true
    expect(baseReader).toEqual(snapshot)
  })
})

describe('editableToReader ne mute jamais baseReader — retour zéro-section (Task D6b, cas le plus sévère)', () => {
  it('fragment vide (aucune section) : le retour anticipé ne doit pas aliaser le reader ENTIER', () => {
    // Fragment vide -> mdFragmentToReader détecte zéro section exploitable et
    // renvoie le reader inchangé. Sans clone, il renvoie baseReader LUI-MÊME :
    // carveUneditedSteps/reattachCharts/resolveReaderImages muteraient ensuite
    // baseReader EN PLACE, et toute mutation en aval de `out` corrompt le
    // snapshot durable. C'est la forme la plus sévère de l'aliasing D6.
    const baseReader = {
      sizeLabels: ['S', 'M'],
      chart: {
        rows: 5, cols: 5, img: 'data:image/png;base64,DDDDDDDD',
        readDir: 'droite-gauche', reps: '', sizes: [], builtinLegend: false,
      },
      reference: buildReference({ abbr: [{ key: 'm.', def: 'maille' }] }),
      sections: [],
    }
    const snapshot = JSON.parse(JSON.stringify(baseReader))
    const { reader: out, warnings } = editableToReader('', baseReader)

    expect(warnings).toEqual([])
    expect(out).toEqual(baseReader) // même reader EN VALEUR (rien n'a été édité)
    expect(out).not.toBe(baseReader) // mais JAMAIS le même objet

    // Preuve par la douleur : muter n'importe quelle branche de la sortie ne doit
    // JAMAIS atteindre baseReader (ni chart, ni sections, ni reference).
    if (out.chart) out.chart.img = 'data:image/png;base64,MUTATED'
    out.sections.push({ id: 'x', title: 'X', steps: [] })
    if (out.reference) out.reference.__muté = true
    expect(baseReader).toEqual(snapshot)
  })
})

describe('édition d’une ligne texte préserve le reste (Step 2)', () => {
  it('changer un mot d’une ligne : cette ligne change, images/aide-mémoire/compteurs des autres lignes intacts', () => {
    const reader = makeReader()
    const { md } = readerToEditable(reader)

    // Édition minimale : corriger un mot dans la ligne texte simple (a), les
    // autres lignes (image, compteur, multi-tailles) restent inchangées dans le md.
    expect(md).toContain('- Monter des mailles au poignet.')
    const editedMd = md.replace(
      '- Monter des mailles au poignet.',
      '- Monter des mailles au poignet droit.'
    )

    const { reader: out, warnings } = editableToReader(editedMd, reader)
    expect(warnings).toEqual([])

    // La ligne éditée a changé.
    expect(out.sections[0].steps[0].t).toBe('Monter des mailles au poignet droit.')

    // Les autres lignes sont BYTE-identiques à l'origine (carving par appariement).
    expect(out.sections[0].steps[1]).toEqual(reader.sections[0].steps[1]) // note
    expect(out.sections[0].steps[2]).toEqual(reader.sections[0].steps[2]) // image
    expect(out.sections[0].steps[2].imgs[0]).toBe(DATA_URL)
    expect(out.sections[0].steps[3]).toEqual(reader.sections[0].steps[3]) // compteur
    expect(out.sections[0].steps[4]).toEqual(reader.sections[0].steps[4]) // multi-tailles

    // L'aide-mémoire (aucun rapport avec la ligne éditée) reste intact.
    expect(out.reference).toEqual(reader.reference)
  })
})

// opts.extraImages (retour terrain 27/08/2026, insertion d'une image de galerie dans le
// texte, CorrectionView.vue) : une image de galerie n'est ancrée dans AUCUNE section de
// baseReader — resolveReaderImages(carved, baseReader) seul ne peut donc jamais retrouver
// sa data-URL après reparse. `opts.extraImages`, transmis à resolveReaderImages en repli,
// couvre exactement ce cas.
describe('editableToReader — opts.extraImages (repli image de galerie insérée)', () => {
  it("résout la data-URL d'une image ajoutée au texte via opts.extraImages, absente de baseReader", () => {
    const reader = {
      sizeLabels: ['S'],
      sections: [{ id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter des mailles.' }] }],
    }
    const { md } = readerToEditable(reader)
    const GALLERY_DATA_URL = 'data:image/png;base64,EEEEEEEE'
    const mdPath = `img/${photoFileName(GALLERY_DATA_URL, 0)}`
    // Indentée et collée sous le rang (cf. imageAnchorLine, step-line.js) : c'est la SEULE
    // forme qui s'ancre comme image simple -- non indentée, elle deviendrait un diagramme.
    const edited = `${md.replace(/\n+$/, '')}\n  ![](${mdPath})\n`

    const { reader: out, warnings } = editableToReader(edited, reader, {
      extraImages: new Map([[mdPath, GALLERY_DATA_URL]]),
    })

    expect(warnings).toEqual([])
    const step = out.sections[0].steps.find((s) => Array.isArray(s.imgs) && s.imgs.length)
    expect(step.imgs[0]).toBe(GALLERY_DATA_URL)
  })
})

describe('chart.repeat perdu par editableToReader : avertissement CHART_REPEAT_LABEL_LOST', () => {
  const chart = (repeat) => ({ rows: 24, cols: 8, img: 'data:image/png;base64,AAAA', readDir: 'rtl', ...(repeat ? { repeat } : {}) })

  it('reader.chart.repeat non vide, chart re-parsé (pas de repli anti-wipe) - avertissement poussé', () => {
    const baseReader = {
      sizeLabels: ['T'],
      sections: [{ id: 's1', kind: 'pelote', title: 'Corps', steps: [{ t: 'monter' }, { chart: true }, { t: 'rang endroit' }] }],
      chart: chart('8 M x 24 Reihen'),
    }
    // Le fragment MD rémis par baseReader porte bien un bloc {chart} (parse le reparsera,
    // repeat étant hors-dialecte il ressortira vide) : editableToReader sans aucune édition
    // humaine du texte doit quand même signaler la perte.
    const { md } = readerToEditable(baseReader)
    const { warnings } = editableToReader(md, baseReader, {})
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: WARNING_CODES.CHART_REPEAT_LABEL_LOST })]))
  })

  it('reader.chart.repeat déjà vide - aucun avertissement (rien à perdre)', () => {
    const baseReader = {
      sizeLabels: ['T'],
      sections: [{ id: 's1', kind: 'pelote', title: 'Corps', steps: [{ t: 'monter' }, { chart: true }, { t: 'rang endroit' }] }],
      chart: chart(''),
    }
    const { md } = readerToEditable(baseReader)
    const { warnings } = editableToReader(md, baseReader, {})
    expect(warnings.filter((w) => w.code === WARNING_CODES.CHART_REPEAT_LABEL_LOST)).toEqual([])
  })

  it('fragment vide (aucune section exploitable) : repli intégral sur baseReader, rien n\'est perdu - aucun avertissement', () => {
    const baseReader = {
      sizeLabels: ['T'],
      sections: [{ id: 's1', kind: 'pelote', title: 'Corps', steps: [{ t: 'monter' }, { chart: true }, { t: 'rang endroit' }] }],
      chart: chart('8 M x 24 Reihen'),
    }
    const { warnings } = editableToReader('', baseReader, {})
    expect(warnings.filter((w) => w.code === WARNING_CODES.CHART_REPEAT_LABEL_LOST)).toEqual([])
  })
})

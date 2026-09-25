import { describe, it, expect, vi } from 'vitest'
// Espion QUI APPELLE l'implémentation réelle par défaut (tous les tests existants du
// fichier restent inchangés) — sauf pour le test de preuve par mutation d'assemble.js:349
// ci-dessous, qui substitue PONCTUELLEMENT un retour (mockReturnValueOnce)
// pour injecter une variante de libellé qu'aucune page PDF réelle ne peut produire (cf.
// commentaire sur ce test : la grammaire de detectSizeLabels ne renvoie jamais un texte hors
// vocabulaire de taille comme seul élément).
vi.mock('@/utils/pdf-import/sizes', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, detectSizeLabels: vi.fn(actual.detectSizeLabels) }
})
import { buildReaderFromPages, parseAuthorLine } from '@/utils/pdf-import/assemble'
import { segmentSections } from '@/utils/pdf-import/segment'
import { computeConfidence } from '@/utils/pdf-import/confidence'
import { validateReader } from '@/utils/reader'
import { detectSizeLabels } from '@/utils/pdf-import/sizes'

const L = (text, o = {}) => ({ text, size: 10, bold: false, y: 0, ...o })

const PAGES = [[
  L('Pull Exemple', { size: 24 }),
  L('Tailles : S (M) L'),
  L('ABRÉVIATIONS', { bold: true }),
  L('m. = maille(s)'),
  L('Corps', { bold: true, size: 14 }),
  L('Rang 1 : monter 104 (108) 112 m.'),
  L('Répéter ce rang 8 (9) 10 fois.'),
  L('Continuer en jersey jusqu’à 20 cm.'),
]]

describe('buildReaderFromPages', () => {
  it('produit un reader valide, sections travail seulement, référence remplie', () => {
    const { pattern, reader, warnings, confidence } = buildReaderFromPages(PAGES, { fileName: 'pull-exemple.pdf' })
    expect(validateReader(reader)).toEqual([])
    expect(warnings).toEqual([])
    expect(reader.sizeLabels).toEqual(['S', 'M', 'L'])
    // v2 : ABRÉVIATIONS est consommée par la référence ; la section titre « Pull
    // Exemple » ne portait que la ligne « Tailles : … », désormais consommée dans
    // le front-matter (sizeLabels) → section vide écartée. Titre conservé via
    // pattern.name, tailles via sizeLabels : aucune perte, sortie « travail seul ».
    expect(reader.sections.map((s) => s.title)).toEqual(['Corps'])
    expect(reader.reference.abbr['m.']).toBe('maille(s)')
    const corps = reader.sections[0]
    expect(corps.steps[0]).toMatchObject({ t: 'Rang 1 : monter {{0}} m.' })
    expect(corps.steps[1]).toMatchObject({ repeat: true, total: [8, 9, 10] })
    expect(pattern.name).toBe('Pull Exemple')
    expect(pattern.reader).toBe(reader)
    expect(confidence.level).toBe('high')
  })
  it('PDF quasi vide → repli mono-section fidèle, confiance basse', () => {
    const { reader, confidence } = buildReaderFromPages([[L('Trois mots seulement.')]], { fileName: 'x.pdf' })
    expect(validateReader(reader)).toEqual([])
    expect(reader.sizeLabels).toEqual(['Taille unique'])
    expect(confidence.level).toBe('low')
  })
  // Preuve par mutation qu'assemble.js:349 (`sizes:
  // isSingleSize(sizeLabels) ? [] : sizeLabels`) est bien branché sur le prédicat unifié,
  // pas resté sur l'ancien `sizeLabels[0] === 'Taille unique'` strict. Contrairement aux
  // trois autres sites unifiés (zip-import.js, LocalPdfImportView.vue, testables via une
  // entrée MD modifiée à la main), AUCUNE page PDF réelle ne peut faire remonter la variante
  // ici : `sizeLabels` (assemble.js:270) ne vaut jamais autre chose que le repli exact
  // `'Taille unique'` ou un vecteur détecté par `detectSizeLabels` (sizes.js), dont la
  // grammaire ne renvoie jamais un texte hors vocabulaire de taille comme unique libellé. On
  // substitue donc UNE fois le retour de `detectSizeLabels` (espion qui appelle
  // l'implémentation réelle partout ailleurs, cf. vi.mock en tête de fichier) pour injecter
  // la variante exactement là où assemble.js la reçoit, puis on vérifie l'effet sur la
  // sortie publique (`pattern.sizes`) — sans réécrire sizes.js pour produire un cas qu'il ne
  // peut structurellement pas produire lui-même.
  it('mutation : sizeLabels détecté en variante « taille unique » (minuscules) → pattern.sizes vide aussi (avec l’ancien === strict, resterait [\'taille unique\'])', () => {
    detectSizeLabels.mockReturnValueOnce({ labels: ['taille unique'], from: 'line' })
    const { pattern } = buildReaderFromPages(PAGES, { fileName: 'pull-exemple.pdf' })
    expect(pattern.sizes).toEqual([])
  })
  it('témoin : sans variante injectée, une vraie détection multi-tailles reste inchangée (l’espion rend la main à l’implémentation réelle)', () => {
    const { pattern } = buildReaderFromPages(PAGES, { fileName: 'pull-exemple.pdf' })
    expect(pattern.sizes).toEqual(['S', 'M', 'L'])
  })
  it('blocking : blocked=true + stats.multiColPages=1 quand une page porte une ligne multiCol (page ≥3 colonnes taguée par lines.js) ; blocked=false + multiColPages=0 sinon', () => {
    // même forme de page que le test « produit un reader valide » ci-dessus, avec une
    // ligne marquée multiCol: true (simule le tag posé par lines.js sur une page ≥3 colonnes)
    const pagesMultiCol = [[
      L('Pull Exemple', { size: 24, multiCol: true }),
      L('Tailles : S (M) L'),
      L('ABRÉVIATIONS', { bold: true }),
      L('m. = maille(s)'),
      L('Corps', { bold: true, size: 14 }),
      L('Rang 1 : monter 104 (108) 112 m.'),
      L('Répéter ce rang 8 (9) 10 fois.'),
      L('Continuer en jersey jusqu’à 20 cm.'),
    ]]
    const outBlocked = buildReaderFromPages(pagesMultiCol, { fileName: 'pull-exemple.pdf' })
    expect(outBlocked.blocking.blocked).toBe(true)
    expect(outBlocked.blocking.reasons).toContain('columns')
    expect(outBlocked.stats.multiColPages).toBe(1)

    // même page, sans multiCol : ne bloque pas → prouve que le test discrimine.
    const pagesNoMultiCol = [[
      L('Pull Exemple', { size: 24 }),
      L('Tailles : S (M) L'),
      L('ABRÉVIATIONS', { bold: true }),
      L('m. = maille(s)'),
      L('Corps', { bold: true, size: 14 }),
      L('Rang 1 : monter 104 (108) 112 m.'),
      L('Répéter ce rang 8 (9) 10 fois.'),
      L('Continuer en jersey jusqu’à 20 cm.'),
    ]]
    const outClean = buildReaderFromPages(pagesNoMultiCol, { fileName: 'pull-exemple.pdf' })
    expect(outClean.blocking.blocked).toBe(false)
    expect(outClean.stats.multiColPages).toBe(0)
  })
})

// Bug patron espagnol « Cotton Candy Dot » : un titre-instruction (« MANGA (HAZ
// DOS) » = « MANCHE, FAIRE 2 ») immédiatement suivi d'un autre titre capture 0
// ligne → l'ancien filtre final (`presteps?.length || lines.length`) le jetait
// SILENCIEUSEMENT, titre compris, alors que c'est une vraie perte d'info (le
// patron demande de faire 2 manches). Le contenu réel de la manche est ailleurs,
// correctement attribué à une autre section — seul CE titre disparaissait.
describe('buildReaderFromPages — titre-instruction sans contenu (bug MANGA (HAZ DOS))', () => {
  const PAGES_TITRE_VIDE = [[
    L('Patron Ejemplo', { size: 24 }),
    L('CUERPO', { bold: true, size: 14 }),
    L('Vuelta 1: montar 100 m.'),
    L('MANGA (HAZ DOS)', { bold: true, size: 14 }),
    L('ELÁSTICO', { bold: true, size: 14 }),
    L('Vuelta 1: montar 40 m.'),
  ]]

  it('segmentSections : « MANGA (HAZ DOS) » capture bien 0 ligne (titre immédiatement suivi d’un autre titre)', () => {
    const secs = segmentSections(PAGES_TITRE_VIDE)
    const manga = secs.find((s) => s.title === 'MANGA (HAZ DOS)')
    expect(manga).toBeTruthy()
    expect(manga.lines.length).toBe(0)
  })

  it('le titre-instruction survit dans le reader : pas de section « MANGA (HAZ DOS) » à part (elle capturait 0 ligne), mais son texte survit en remarque dans la section suivante', () => {
    const { reader } = buildReaderFromPages(PAGES_TITRE_VIDE, { fileName: 'ejemplo.pdf' })
    expect(reader.sections.some((s) => s.title === 'MANGA (HAZ DOS)')).toBe(false)
    const elastico = reader.sections.find((s) => s.title === 'ELÁSTICO')
    expect(elastico).toBeTruthy()
    expect(elastico.steps[0]).toMatchObject({ t: '**MANGA (HAZ DOS)**', note: true })
    // Le rang réel de la section suivante n'est pas perdu pour autant.
    expect(JSON.stringify(elastico.steps)).toMatch(/montar 40 m/)
  })

  it('dernière section vide sans suivante : fusionnée en fin de la section PRÉCÉDENTE', () => {
    const pages = [[
      L('Patron Ejemplo', { size: 24 }),
      L('CUERPO', { bold: true, size: 14 }),
      L('Vuelta 1: montar 100 m.'),
      L('MANGA (HAZ DOS)', { bold: true, size: 14 }),
    ]]
    const { reader } = buildReaderFromPages(pages, { fileName: 'ejemplo.pdf' })
    expect(reader.sections.some((s) => s.title === 'MANGA (HAZ DOS)')).toBe(false)
    const cuerpo = reader.sections.find((s) => s.title === 'CUERPO')
    expect(cuerpo).toBeTruthy()
    expect(cuerpo.steps.at(-1)).toMatchObject({ t: '**MANGA (HAZ DOS)**', note: true })
  })
})

// Non-régression (gate 25 réfs, patron margalida-dress-fr) : un titre vide qui n'a
// PAS la forme « mot-clé de travail + parenthèse » (isRescuableTitle) reste écarté en
// silence, comme avant ce correctif — c'est du bruit de page (bandeau, code de
// taille, libellé générique), pas une instruction perdue. Sans ce garde, le premier
// jet du correctif fusionnait CES titres aussi et faisait régresser le gate corpus
// (moyenne 0.6052 → 0.5988, aucun des titres fusionnés en trop n'étant réel).
describe('buildReaderFromPages — sections vides NON rescapables : toujours écartées en silence', () => {
  it('« S (M) L » (parenthèse mais aucun mot-clé de section connu) et « CORPS » (mot-clé connu mais SANS parenthèse) restent écartées, aucune note parasite', () => {
    const pages = [[
      L('Patron Ejemplo', { size: 24 }),
      L('S (M) L', { bold: true, size: 14 }),
      L('CORPS', { bold: true, size: 14 }),
      L('DOS', { bold: true, size: 14 }),
      L('Vuelta 1: montar 100 m.'),
    ]]
    const { reader } = buildReaderFromPages(pages, { fileName: 'ejemplo.pdf' })
    expect(reader.sections.some((s) => s.title === 'S (M) L')).toBe(false)
    expect(reader.sections.some((s) => s.title === 'CORPS')).toBe(false)
    const dos = reader.sections.find((s) => s.title === 'DOS')
    expect(dos).toBeTruthy()
    expect(dos.steps).toHaveLength(1) // pas de note parasite en tête
    expect(dos.steps[0].t).not.toMatch(/\*\*/)
  })
})

// Un arbitrage (tranché le 03/09, option 1 « élargir le sauvetage ») :
// isRescuableTitle (parenthèse + kind reconnu) laisse perdre du contenu réel sur 3
// patrons mesurés du corpus réel — bird-nest-es (la page GUÍA quasi entière : « GUÍA »,
// « Foto 1 Foto 2 », « Foto 5 Foto 6 », « Foto 7 Foto 8 » jetés alors que le corps
// renvoie aux « mira la foto N »), frostwork-shawl-fr (items « 7. T10AV » / « 8. T10AR »
// de la légende du diagramme), hooked-on-you-scarf-es (« Lado anverso », légende jumelle
// de « Lado reverso »). Ces titres sont des LÉGENDES — items numérotés, légendes de
// photos, en-tête de page photo-tuto, jumeau d'une légende gardée — et le rescapture
// élargi reste conditionné à ces formes (isLegendTitleRescuable, assemble.js), mesurées
// contre l'inventaire complet des sections vides des 26 témoins du banc pour ne rouvrir
// AUCUNE porte au bruit que le mécanisme ferme (cf. contre-tests ci-dessous).
describe('buildReaderFromPages — titres de légende des sections vidées rescapés', () => {
  // bird-nest-es-cc24df92 : page photo-tuto en fin de document. « GUÍA » ouvre la page,
  // les légendes « Foto N Foto N+1 » s'enchaînent ; la seule section gardée de la page est
  // « Foto 4 » (sa ligne de contenu est « Foto 3 », désordre réel du PDF). Les titres vidés
  // rescapés deviennent des remarques : celles d'avant la section gardée en TÊTE de ses
  // steps, celles de la fin de document (plus de suivante) en QUEUE.
  const PAGES_BIRD = [
    [L('Bird Nest', { size: 24 })],
    [
      L('CUERPO DEL PAJARITO', { bold: true, size: 14 }),
      L('Vuelta 1: tejer 6 pb en el anillo mágico.'),
    ],
    [
      // Ordonnées réalistes (page photo : grands blancs entre rangées de légendes,
      // interligne modal 13 pour la ligne de corps) — des y tous à 0 rendent le gap
      // « ≥ 1,7×modalGap » trivialement vrai (0 ≥ 0) et promeuvent « Foto 3 » à tort
      // (piège documenté dans pdf-import-segment-titles.spec.js).
      L('GUÍA', { bold: true, size: 14, y: 740 }),
      L('Foto 1 Foto 2', { bold: true, size: 14, y: 700 }),
      L('Foto 4', { bold: true, size: 14, y: 660 }),
      L('Foto 3', { y: 647 }),
      L('Foto 5 Foto 6', { bold: true, size: 14, y: 607 }),
    ],
  ]

  it('bird-nest : « GUÍA », « Foto 1 Foto 2 » et « Foto 5 Foto 6 » survivent en remarques autour de la section gardée « Foto 4 »', () => {
    const { reader } = buildReaderFromPages(PAGES_BIRD, { fileName: 'bird-nest.pdf' })
    const foto4 = reader.sections.find((s) => s.title === 'Foto 4')
    expect(foto4).toBeTruthy()
    const ts = foto4.steps.map((s) => s.t)
    expect(ts).toContain('**GUÍA**')
    expect(ts).toContain('**Foto 1 Foto 2**')
    expect(ts).toContain('**Foto 5 Foto 6**')
    // Ordre : les pendantes de tête AVANT la ligne propre de la section, celles de
    // queue (dernière section vide sans suivante) APRÈS.
    expect(ts.indexOf('**GUÍA**')).toBeLessThan(ts.indexOf('Foto 3'))
    expect(ts.indexOf('**Foto 1 Foto 2**')).toBeLessThan(ts.indexOf('Foto 3'))
    expect(ts.indexOf('**Foto 5 Foto 6**')).toBeGreaterThan(ts.indexOf('Foto 3'))
    // Toujours des remarques, jamais des sections à part (même trajectoire que MANGA).
    for (const t of ['GUÍA', 'Foto 1 Foto 2', 'Foto 5 Foto 6']) {
      expect(reader.sections.some((s) => s.title === t)).toBe(false)
    }
  })

  it('bird-nest : le MD final porte les titres rescapés (critère de l’arbitrage)', async () => {
    const { patternToMd } = await import('@/utils/pattern-md/serialize')
    const { pattern, reader } = buildReaderFromPages(PAGES_BIRD, { fileName: 'bird-nest.pdf' })
    const { md } = patternToMd({ ...pattern, reader })
    expect(md).toContain('> **GUÍA**')
    expect(md).toContain('> **Foto 1 Foto 2**')
    expect(md).toContain('> **Foto 5 Foto 6**')
  })

  // frostwork-shawl-fr-c2955fea : légende du diagramme. Les items « 5. BT » (gardé, sa
  // ligne « 6. répéter »), « 7. T10AV » et « 8. T10AR » (vides : l'item suivant est
  // lui-même un titre, puis fin de document) — le corps tricote « T10AV »/« T10AR ».
  const PAGES_FROST = [
    [L('Frostwork', { size: 24 })],
    [
      L('CORPS', { bold: true, size: 14 }),
      L('Rang 1: monter 100 m.'),
    ],
    [
      L('LÉGENDE -', { bold: true, size: 14 }),
      L('1. gl1end'),
      L('5. BT', { bold: true, size: 14 }),
      L('6. répéter'),
      L('7. T10AV', { bold: true, size: 14 }),
      L('8. T10AR', { bold: true, size: 14 }),
    ],
  ]

  it('frostwork : les items « 7. T10AV » et « 8. T10AR » de la légende survivent en remarques de queue de la dernière section gardée', () => {
    const { reader } = buildReaderFromPages(PAGES_FROST, { fileName: 'frostwork.pdf' })
    const bt = reader.sections.find((s) => s.title === '5. BT')
    expect(bt).toBeTruthy()
    const ts = bt.steps.map((s) => s.t)
    // La ligne propre de « 5. BT » n'est pas perdue, et les deux items rescapés la suivent.
    expect(ts).toContain('6. répéter')
    expect(ts.indexOf('**7. T10AV**')).toBeGreaterThan(ts.indexOf('6. répéter'))
    expect(ts.indexOf('**8. T10AR**')).toBeGreaterThan(ts.indexOf('6. répéter'))
    expect(reader.sections.some((s) => s.title === '7. T10AV')).toBe(false)
    expect(reader.sections.some((s) => s.title === '8. T10AR')).toBe(false)
  })

  // hooked-on-you-scarf-es-2e13a0c8 : « Lado anverso » est la légende jumelle de
  // « Lado reverso » (gardée) ; les légendes « Foto N Foto N+1 » précèdent, vides.
  const PAGES_HOOKED = [
    [L('Hooked on You', { size: 24 })],
    [
      L('PATRÓN', { bold: true, size: 14 }),
      L('Vuelta 1: 30 pb.'),
    ],
    [
      L('Foto 1 Foto 2', { bold: true, size: 14 }),
      L('Foto 3 Foto 4', { bold: true, size: 14 }),
      L('Lado anverso', { bold: true, size: 14 }),
      L('Lado reverso', { bold: true, size: 14 }),
      L('La cara del lado reverso queda mirando hacia ti.'),
    ],
  ]

  it('hooked-on-you : « Lado anverso » (jumeau vide de « Lado reverso » gardé) survit en remarque, avec les légendes Foto', () => {
    const { reader } = buildReaderFromPages(PAGES_HOOKED, { fileName: 'hooked-on-you.pdf' })
    const reverso = reader.sections.find((s) => s.title === 'Lado reverso')
    expect(reverso).toBeTruthy()
    const ts = reverso.steps.map((s) => s.t)
    expect(ts).toContain('**Lado anverso**')
    expect(ts).toContain('**Foto 1 Foto 2**')
    expect(ts).toContain('**Foto 3 Foto 4**')
    // La ligne propre de « Lado reverso » est conservée, APRÈS les remarques de tête.
    expect(ts.indexOf('**Lado anverso**')).toBeLessThan(ts.indexOf('La cara del lado reverso queda mirando hacia ti.'))
    expect(reader.sections.some((s) => s.title === 'Lado anverso')).toBe(false)
  })

  // Contre-tests : le bruit que le mécanisme ferme reste jeté (inventaire complet des
  // sections vides des 26 témoins du banc, re-vérifié jeté avec le rescapture élargi).
  it('contre-test bandeau : « HASHTAGS PARA LAS REDES » + « SOCIALES » vidés restent écartés (12 occurrences dans le banc)', () => {
    const pages = [
      [L('Pull Ejemplo', { size: 24 })],
      [
        L('HASHTAGS PARA LAS REDES', { bold: true, size: 14 }),
        L('SOCIALES', { bold: true, size: 14 }),
      ],
      [
        L('CUERPO', { bold: true, size: 14 }),
        L('Vuelta 1: montar 100 m.'),
      ],
    ]
    const { reader } = buildReaderFromPages(pages, { fileName: 'ejemplo.pdf' })
    const allText = JSON.stringify(reader.sections)
    expect(allText).not.toMatch(/HASHTAGS/)
    expect(allText).not.toMatch(/SOCIALES/)
  })

  it('contre-test jumeau : la comparaison est STRICTE sur la casse — « Pattern » vide n’est pas le jumeau de « PATTERN » gardé (mia-cardigan)', () => {
    const pages = [
      [L('Cardigan Ejemplo', { size: 24 })],
      [
        L('PATTERN', { bold: true, size: 14 }),
        L('Row 1: knit all sts.'),
        L('Pattern', { bold: true, size: 14 }),
        L('BODY', { bold: true, size: 14 }),
        L('Row 2: purl all sts.'),
      ],
    ]
    const { reader } = buildReaderFromPages(pages, { fileName: 'cardigan.pdf' })
    const body = reader.sections.find((s) => s.title === 'BODY')
    expect(body).toBeTruthy()
    expect(body.steps.some((s) => /^\*\*Pattern\*\*$/.test(s.t))).toBe(false)
    expect(JSON.stringify(reader.sections)).not.toContain('**Pattern**')
  })

  it('contre-test légende isolée : « Photo 1 Photo 2 Photo 3 » vide SANS voisine de légende reste écarté (soft-twist : la référence du banc ne l’a pas)', () => {
    const pages = [
      [L('Ensemble Exemple', { size: 24 })],
      [
        L('INFO ET CONSEILS', { bold: true, size: 14 }),
        L('Un ensemble rapide et amusant.'),
        L('Photo 1 Photo 2 Photo 3', { bold: true, size: 14 }),
        L('POIGNET', { bold: true, size: 14 }),
        L('Tour 1: 10 mc.'),
      ],
    ]
    const { reader } = buildReaderFromPages(pages, { fileName: 'ensemble.pdf' })
    expect(JSON.stringify(reader.sections)).not.toContain('**Photo 1 Photo 2 Photo 3**')
    const poignet = reader.sections.find((s) => s.title === 'POIGNET')
    expect(poignet.steps[0].t).not.toMatch(/\*\*/)
  })
})

// Bug section fantôme (vérifié sur deux PDF réels : Martha -
// Blouse with lace pattern (de) et Spring Flora - Neck Warmer (en)) : la ligne auteur
// (« X | Hobbii Design ») est déjà correctement capturée dans pattern.author, mais
// reflowLines COPIE chaque objet ligne (`{ ...l }`) — le flag `consumed` posé sur la
// ligne ORIGINALE de cleanPages par la détection d'auteur devient invisible au filtre
// final, qui s'applique aux COPIES issues du reflow. La ligne auteur survit donc,
// dupliquée, dans le corps (ici : en note de la section Présentation).
describe('buildReaderFromPages — ligne auteur retirée du corps (pas de doublon, bug section fantôme)', () => {
  const PAGES_AUTEUR = [[
    L('Cardigan Exemple', { size: 24 }),
    L('INFORMATIONS', { bold: true, size: 14 }),
    L('Sys Fredens | Hobbii Design'),
    L('Un joli cardigan pour l’automne.'),
    L('CORPS', { bold: true, size: 14 }),
    L('Rang 1 : monter 100 m.'),
  ]]

  it('capture l’auteur dans pattern.author ET le retire du corps (aucun doublon dans Présentation)', () => {
    const { pattern, reader } = buildReaderFromPages(PAGES_AUTEUR, { fileName: 'cardigan-exemple.pdf' })
    expect(pattern.author).toBe('Sys Fredens | Hobbii Design')
    const presentation = reader.sections.find((s) => s.title === 'Présentation')
    expect(presentation).toBeTruthy()
    const allText = JSON.stringify(presentation.steps)
    expect(allText).not.toMatch(/Sys Fredens/)
    expect(allText).toMatch(/joli cardigan/)
  })
})

// Divergence constatée (tidepool-tee-es et 3 autres témoins) : consolidateIntro
// construisait le bloc « Présentation » en copiant le texte brut des lignes, SANS jamais
// appeler applySizeVectors — contrairement à linesToSteps (steps.js), qui l'applique à
// TOUTES les autres sections. Une ligne du préambule portant un vecteur multi-tailles
// cohérent (nombre de valeurs === n) ressortait donc sans `{{i}}` ni `c` : le lecteur ne
// produit aucun jeton de comptage sur cette ligne (toutes les tailles mélangées), et
// parseIntro (pattern-md/parse.js) — qui APPLIQUE la grammaire des vecteurs au re-parse —
// resérialise le MD en notation alternée : le document n'est pas stable au premier
// aller-retour. Vérifié en instrumentant buildReaderFromPages sur le PDF témoin
// tidepool-tee-es-25fecf39 avant ce correctif : le step de Présentation
// portait `"136 (144, 160, ...) pts"` verbatim, sans champ `c`.
describe('buildReaderFromPages — vecteur multi-tailles dans le préambule (bloc Présentation)', () => {
  const PAGES_INTRO_VECTOR = [[
    L('Pull Exemple', { size: 24 }),
    L('Tailles : S (M) L'),
    L('INFORMATIONS', { bold: true, size: 14 }),
    L('Monte 104 (108) 112 m. avec la couleur A.'),
    L('CORPS', { bold: true, size: 14 }),
    L('Rang 1 : monter 104 (108) 112 m.'),
  ]]

  it('applique la grammaire des vecteurs à une ligne du préambule (même mécanisme que linesToSteps)', () => {
    const { reader } = buildReaderFromPages(PAGES_INTRO_VECTOR, { fileName: 'pull-exemple.pdf' })
    expect(reader.sizeLabels).toEqual(['S', 'M', 'L'])
    const presentation = reader.sections.find((s) => s.title === 'Présentation')
    expect(presentation).toBeTruthy()
    const step = presentation.steps.find((s) => /Monte/.test(s.t))
    expect(step).toMatchObject({ t: 'Monte {{0}} m. avec la couleur A.', note: true })
    expect(step.c).toEqual([[104, 108, 112]])
  })

  // Règle de non-invention (§4.2, appliquée par applySizeVectors lui-même) : un vecteur dont
  // le nombre de valeurs ne correspond PAS au nombre de tailles détectées (ici n=3) ne doit
  // jamais être transformé — la ligne reste verbatim, sans `c`.
  it('ne transforme PAS un vecteur dont le nombre de valeurs ne correspond pas à n (non-invention)', () => {
    const PAGES_MISMATCH = [[
      L('Pull Exemple', { size: 24 }),
      L('Tailles : S (M) L'),
      L('INFORMATIONS', { bold: true, size: 14 }),
      L('Monte 104 (108, 112, 120) m. avec la couleur A.'),
      L('CORPS', { bold: true, size: 14 }),
      L('Rang 1 : monter 104 (108) 112 m.'),
    ]]
    const { reader } = buildReaderFromPages(PAGES_MISMATCH, { fileName: 'pull-exemple.pdf' })
    const presentation = reader.sections.find((s) => s.title === 'Présentation')
    const step = presentation.steps.find((s) => /Monte/.test(s.t))
    expect(step).toMatchObject({ t: 'Monte 104 (108, 112, 120) m. avec la couleur A.', note: true })
    expect(step.c ?? []).toEqual([])
  })

  // Même lacune dans la boucle `extraNotes` de buildReaderFromPages (lignes non-glossaire
  // rejetées d'une section abbr sur-étendue, cf. formRejectedAbbrLine/reference.js) : elles
  // rejoignent aussi le bloc Présentation, par le même chemin `consolidateIntro`.
  it('applique aussi la grammaire des vecteurs aux notes récupérées (extraNotes, ligne rejetée d’une section abbr)', () => {
    const PAGES_EXTRA_NOTE = [[
      L('Pull Exemple', { size: 24 }),
      L('Tailles : S (M) L'),
      L('ABRÉVIATIONS', { bold: true }),
      L('m. = maille(s)'),
      L('Taille S/M: Répéter le rang 8 (9) 10 fois. Continuer ensuite avec la couleur B.'),
      L('CORPS', { bold: true, size: 14 }),
      L('Rang 1 : monter 104 (108) 112 m.'),
    ]]
    const { reader } = buildReaderFromPages(PAGES_EXTRA_NOTE, { fileName: 'pull-exemple.pdf' })
    const presentation = reader.sections.find((s) => s.title === 'Présentation')
    expect(presentation).toBeTruthy()
    const step = presentation.steps.find((s) => /Répéter/.test(s.t))
    expect(step).toBeTruthy()
    expect(step.t).toBe('Taille S/M: Répéter le rang {{0}} fois. Continuer ensuite avec la couleur B.')
    expect(step.c).toEqual([[8, 9, 10]])
  })
})

// Bug PDF réel « Metorit - Asymmetrical Shawl » (es, hobbii) : le pied de page
// « Metorit - Hobbii Design, Sys Fredens - Copyright © 2020   Página N » est répété
// sur chaque page (mention copyright → NOISE_RES le retire ; en plus répété en bande
// basse de page → le mécanisme de ligne structurelle répétée le retirerait aussi,
// indépendamment). stripBoilerplate() élimine donc cette ligne AVANT que la détection
// d'auteur (qui lisait jusqu'ici cleanPages) ne puisse jamais la voir : pattern.author
// restait vide, aucune ligne « author: » dans le front-matter produit. Le nom de la
// designer doit être capté malgré la suppression légitime de la ligne (pur pied de
// page, pas du contenu de patron — elle ne doit PAS survivre dans le corps).
describe('buildReaderFromPages — auteur capté depuis un pied de page copyright (bug Metorit, ligne éliminée par stripBoilerplate)', () => {
  const FOOTER = 'Metorit - Hobbii Design, Sys Fredens - Copyright © 2020   Página '
  const PAGES_METORIT = [
    [
      L('Metorit', { size: 24, y: 800 }),
      L('INFORMACIÓN', { bold: true, size: 14, y: 700 }),
      L('Un precioso chal asimétrico.', { y: 650 }),
      L('CUERPO', { bold: true, size: 14, y: 600 }),
      L('Vuelta 1: montar 100 m.', { y: 550 }),
      L(FOOTER + '1', { y: 10 }),
    ],
    [
      L('Vuelta 2: tejer del derecho.', { y: 550 }),
      L(FOOTER + '2', { y: 10 }),
    ],
  ]

  it('pattern.author capte « Sys Fredens | Hobbii Design » malgré le pied de page filtré comme bruit', () => {
    const { pattern, reader } = buildReaderFromPages(PAGES_METORIT, { fileName: 'metorit.pdf' })
    expect(pattern.author).toBe('Sys Fredens | Hobbii Design')
    // Le pied de page reste un pur artefact d'édition : il ne doit PAS survivre dans le corps.
    const allText = JSON.stringify(reader.sections)
    expect(allText).not.toMatch(/Copyright/)
    expect(allText).not.toMatch(/Sys Fredens/)
  })

  // Un auteur trouvé sur les pages brutes n'est pas écrasé par une consigne « Conception : … », qui reste au corps.
  it('une consigne « Conception : … » ne remplace pas l’auteur du pied de page et reste dans le corps', () => {
    const pages = PAGES_METORIT.map((p) => p.map((l) => ({ ...l })))
    pages[1].splice(1, 0, L('Conception : tricoter le dos et le devant séparément.', { y: 500 }))
    const { pattern, reader } = buildReaderFromPages(pages, { fileName: 'metorit.pdf' })
    expect(pattern.author).toBe('Sys Fredens | Hobbii Design')
    expect(JSON.stringify(reader.sections)).toContain('tricoter le dos et le devant séparément')
  })
})

// Bug PDF réel « Knitted Crown Headband » (es, hobbii, palier 8/8) : 3e variante
// du même bug (cf. HOBBII_COMMA_RE/GENERIC_COMMA_COPYRIGHT_RE dans assemble.js). Pied de
// page « Hobbii Friends - My Favourite Stitches, Katharina Müller - Copyright © 2021
// Página N » (texte VERBATIM du PDF, vérifié pdftotext) — le nom de collection avant la
// virgule N'EST PAS « Hobbii Design » (contrairement au cas Metorit ci-dessus), donc
// HOBBII_COMMA_RE seule ne le capte jamais, quel que soit son plafond/ancrage. Bout-en-bout
// (contrairement aux tests unitaires parseAuthorLine de mdlab-engine.spec.js) : prouve que
// (a) le pied de page répété est bien éliminé par stripBoilerplate AVANT que la détection
// d'auteur sur cleanPages ne puisse le voir, (b) la détection en lecture seule sur les pages
// BRUTES capte quand même le nom, (c) aucun suffixe « | Hobbii Design » n'est fabriqué
// (marque réelle différente) — conforme à l'oracle de référence -ideal.md du corpus.
describe('buildReaderFromPages — auteur capté depuis un pied de page copyright, collection arbitraire (3e variante du bug auteur, bug knitted-crown-headband-es-a5a5513c)', () => {
  const FOOTER = 'Hobbii Friends - My Favourite Stitches, Katharina Müller - Copyright © 2021   Página '
  const PAGES_KNITTED_CROWN = [
    [
      L('Knitted Crown - Diadema', { size: 24, y: 800 }),
      L('MATERIALES', { bold: true, size: 14, y: 700 }),
      L('1 ovillo de Mohair Delight, color 21.', { y: 650 }),
      L('DIADEMA', { bold: true, size: 14, y: 600 }),
      L('Vuelta 1: monta 78 puntos.', { y: 550 }),
      L(FOOTER + '1', { y: 10 }),
    ],
    [
      L('Vuelta 2: teje del derecho.', { y: 550 }),
      L(FOOTER + '2', { y: 10 }),
    ],
  ]

  it('pattern.author capte « Katharina Müller » (sans suffixe fabriqué) malgré le pied de page filtré comme bruit', () => {
    const { pattern, reader } = buildReaderFromPages(PAGES_KNITTED_CROWN, { fileName: 'knitted-crown.pdf' })
    expect(pattern.author).toBe('Katharina Müller')
    // Le pied de page reste un pur artefact d'édition : il ne doit PAS survivre dans le corps.
    const allText = JSON.stringify(reader.sections)
    expect(allText).not.toMatch(/Copyright/)
    expect(allText).not.toMatch(/Katharina Müller/)
  })
})

// reader.easeHint : câblé bout en bout (meta.js/parse.js/ReaderView.vue) mais jamais
// peuplé par le moteur PDF (codé en dur à '' dans assemble.js) — bug SYSTÉMIQUE découvert
// sur le corpus réel de 40 patrons (palier 8/8,
// « Picnic - Children's Top »). Texte du fixture ci-dessous VERBATIM du PDF réel
// (picnic-children-s-top-de-2e607227.pdf, page 1, section « MAẞE ») ; cf. ease.js pour
// les autres langues du vocabulaire fermé (unit tests dédiés, pdf-import-ease.spec.js).
describe('buildReaderFromPages — easeHint (aisance)', () => {
  const PAGES_PICNIC = [[
    L('Picnic - Kinder-Top', { size: 24 }),
    L('MATERIAL', { bold: true, size: 14 }),
    L('Häkelnadel 4 mm'),
    L('GRÖSSE', { bold: true, size: 14 }),
    L('2 Jahre (4 Jahre) (6 Jahre)'),
    L('MAẞE', { bold: true, size: 14 }),
    L('Weite: 55 (60) (64,5) cm'),
    L('Länge: 31,5 (34) (36) cm'),
    L('Das Stück ist mit einem Bewegungsspielraum von 2-7 cm konzipiert.'),
    L('INFORMATION ZUR ANLEITUNG', { bold: true, size: 14 }),
    L('Das Picnic-Kindertop besteht aus zwei in der Runde gehäkelten Quadraten.'),
    L('RUMPF', { bold: true, size: 14 }),
    L('Runde 1: 5 Lm, 4 Stb in den Ring.'),
  ]]

  it('capte la phrase d’aisance du bloc mesures (perte P0 vérifiée sur « Picnic - Kinder-Top »)', () => {
    const { reader } = buildReaderFromPages(PAGES_PICNIC, { fileName: 'picnic.pdf' })
    expect(reader.easeHint).toBe('Das Stück ist mit einem Bewegungsspielraum von 2-7 cm konzipiert.')
    // Warnings inchangés (n'introduit pas d'invalidité de reader) et pas de perte du reste.
    expect(validateReader(reader)).toEqual([])
  })

  it('non-régression : aucune mention d’aisance dans le PDF → easeHint reste vide (comportement historique)', () => {
    const { reader } = buildReaderFromPages(PAGES, { fileName: 'pull-exemple.pdf' })
    expect(reader.easeHint).toBe('')
  })
})

// Bug réel Mia Cardigan (English) v1.1 (premier correctif) : la phrase d'aisance atterrit dans la section « Gauge »
// (ref='echantillon'), pas dans « Sizes » (ref='mesures'). detectEaseHint balaie
// désormais aussi ce bloc — mais contrairement à 'mesures' (toujours écarté de `work`,
// sans autre destination), 'echantillon' EST rendu ailleurs : extractReference()
// (reference.js:1261) déverse verbatim toute ligne non consommée d'une section
// ref==='echantillon' dans reference.gauge → onglet « Matériel & échantillon »
// (reader-reference.js). Sans consommer explicitement la ligne promue, elle ressurgit
// donc DUPLIQUÉE (une fois dans easeHint, une fois dans reference.tabs) — vu sur
// un appareil de test (la même phrase lue 2 fois). Texte VERBATIM du PDF réel.
describe('buildReaderFromPages — la phrase promue en easeHint ne se duplique plus dans le bloc Echantillon', () => {
  const EASE_SENTENCE = 'Mia Cardigan is designed to have approximately 21-22.5 cm of positive ease, meaning it is designed to be approximately 21-22.5 cm larger in circumference than your bust measurement.'
  const PAGES_MIA_GAUGE = [[
    L('Mia Cardigan', { size: 24 }),
    L('GAUGE', { bold: true, size: 14 }),
    L('21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm after blocking'),
    L('Size guide'),
    L(EASE_SENTENCE),
    L('BODY', { bold: true, size: 14 }),
    L('Row 1: cast on 100 sts.'),
    L('Row 2: knit every row.'),
  ]]

  it('la phrase reste verbatim et complète dans easeHint, et disparaît du bloc Echantillon (pas de doublon)', () => {
    const { reader } = buildReaderFromPages(PAGES_MIA_GAUGE, { fileName: 'mia-gauge.pdf' })
    expect(reader.easeHint).toBe(EASE_SENTENCE)
    const allReference = JSON.stringify(reader.reference)
    expect(allReference).not.toMatch(/positive ease/)
    // Pas une perte de contenu : le reste du bloc Echantillon (jauge, « Size guide »)
    // survit — seule la phrase déjà promue en easeHint a été retirée.
    expect(allReference).toMatch(/stockinette stitch/)
    expect(allReference).toMatch(/Size guide/)
  })
})

describe('computeConfidence', () => {
  it('pondère sections connues, lignes structurées, vecteurs et warnings', () => {
    const c = computeConfidence({
      stats: { sectionsTotal: 4, sectionsKnown: 4, totalLines: 20, structuredLines: 18, vectorsSeen: 6, vectorsOk: 6, bySection: {} },
      warnings: [],
    })
    expect(c.global).toBeGreaterThanOrEqual(85)
    expect(c.level).toBe('high')
  })
  it('warnings et sections inconnues font chuter le score', () => {
    const c = computeConfidence({
      stats: { sectionsTotal: 3, sectionsKnown: 0, totalLines: 20, structuredLines: 2, vectorsSeen: 4, vectorsOk: 1, bySection: {} },
      warnings: ['a', 'b', 'c', 'd', 'e'],
    })
    expect(c.level).toBe('low')
  })
})

describe('buildReaderFromPages — glossaire en colonnes', () => {
  it('remplit le bloc Abréviations depuis un glossaire à deux colonnes sans séparateur', () => {
    // Page 1 : titre de rubrique + 4 entrées alignées (positions du PDF crossbody réel).
    const page = [
      { text: 'Abréviations et définitions', size: 12, bold: false, y: 537, parts: [{ x: 48, text: 'Abréviations et définitions' }] },
      { text: 'm Maille(s)', size: 9, bold: false, y: 520, parts: [{ x: 48, text: 'm' }, { x: null, text: ' ' }, { x: 102, text: 'Maille(s)' }] },
      { text: 'bc Boucle centre', size: 9, bold: false, y: 509, parts: [{ x: 48, text: 'bc' }, { x: null, text: ' ' }, { x: 102, text: 'Boucle centre' }] },
      { text: 'mc Maille coulée', size: 9, bold: false, y: 498, parts: [{ x: 48, text: 'mc' }, { x: null, text: ' ' }, { x: 102, text: 'Maille coulée' }] },
      { text: 'ms Maille serrée', size: 9, bold: false, y: 487, parts: [{ x: 48, text: 'ms' }, { x: null, text: ' ' }, { x: 102, text: 'Maille serrée' }] },
    ]
    const { reader } = buildReaderFromPages([page], { fileName: 'x.pdf' })
    // Forme vérifiée du champ : `abbr` est un OBJET clé → définition, `abbrFull` la liste
    // ordonnée de paires. Ne pas changer cette structure.
    expect(reader.reference.abbr).toEqual({
      m: 'Maille(s)', bc: 'Boucle centre', mc: 'Maille coulée', ms: 'Maille serrée',
    })
    expect(reader.reference.abbrFull.map((p) => p[0])).toEqual(['m', 'bc', 'mc', 'ms'])
  })

  // Régression réelle trouvée en câblant ce travail (Mia_Cardigan__English__v1.1, patron
  // de référence) : ce glossaire a un vrai séparateur « = » sur CHAQUE ligne, mais les
  // abscisses du signe « = » s'alignent PAR HASARD à ±1pt sur 3 lignes de longueur de clé
  // voisine (st(s)/wyif/M1L, x≈57.99/57.06/58.93) — assez pour que readColumnGlossary
  // (conçu pour un glossaire SANS aucun séparateur) détecte à tort une fausse colonne et
  // ne rende que 4 entrées, les 11 autres fuyant en notes agglutinées et un pavé de prose
  // parasite dans l'intro. Fixture = géométrie VERBATIM extraite du vrai PDF (x/y réels,
  // dump via pdf-import/node.mjs). Le garde-fou d'assemble.js (comparaison sepLines vs
  // g.entries.length) doit laisser ce patron au mécanisme séparateur existant, intact.
  it('un vrai glossaire « clé = déf » (Mia_Cardigan, séparateur sur chaque ligne) n’est PAS confondu avec un glossaire en colonnes malgré un faux vote d’alignement', () => {
    const MIA_ABBR_LINES = [
      { text: 'Abbreviations', size: 14, bold: true, y: 645, parts: [{ x: 36.95, text: 'Abbreviations' }] },
      { text: 'BOR = beginning of round', size: 10.08, bold: false, y: 632.1392000000001, parts: [{ x: 36.950552, text: 'BOR' }, { x: 58.670936, text: ' ' }, { x: 61.1156, text: '= beginning of round' }] },
      { text: 'RS = right side', size: 10.08, bold: false, y: 619.1792, parts: [{ x: 36.950552, text: 'RS' }, { x: 49.06872800000001, text: ' ' }, { x: 51.530648, text: '= right side' }] },
      { text: 'WS = wrong side', size: 10.08, bold: false, y: 606.4592, parts: [{ x: 36.950552, text: 'WS' }, { x: 51.051464, text: ' ' }, { x: 53.513072, text: '= wrong side' }] },
      { text: 'k = knit', size: 10.08, bold: false, y: 593.4992000000001, parts: [{ x: 36.950552, text: 'k' }, { x: 42.303031999999995, text: ' ' }, { x: 44.763056, text: '= knit' }] },
      { text: 'p = purl', size: 10.08, bold: false, y: 580.5392, parts: [{ x: 36.950552, text: 'p' }, { x: 42.514711999999996, text: ' ' }, { x: 44.973031999999996, text: '= purl' }] },
      { text: 'sl = slip stitch purlwise', size: 10.08, bold: false, y: 567.5792, parts: [{ x: 36.950552, text: 'sl' }, { x: 43.736408, text: ' ' }, { x: 46.218128, text: '= slip stitch purlwise' }] },
      { text: 'st(s) = stitch(es)', size: 10.08, bold: false, y: 554.6192000000001, parts: [{ x: 36.950552, text: 'st(s)' }, { x: 55.51589599999999, text: ' ' }, { x: 57.985712, text: '= stitch(es)' }] },
      { text: 'sk = slip 1 stitch knitwise, return stitch back to the left needle', size: 10.08, bold: false, y: 541.6592, parts: [{ x: 36.950552, text: 'sk' }, { x: 46.468087999999995, text: ' ' }, { x: 48.928088, text: '= slip 1 stitch knitwise, return stitch back to the left needle' }] },
      { text: 'wyif = with yarn in front', size: 10.08, bold: false, y: 528.6992, parts: [{ x: 36.950552, text: 'wyif' }, { x: 54.579679999999996, text: ' ' }, { x: 57.057992, text: '= with yarn in front' }] },
      { text: 'k2tog = knit two stitches together', size: 10.08, bold: false, y: 515.7392, parts: [{ x: 36.950552, text: 'k2tog' }, { x: 60.749432, text: ' ' }, { x: 63.200551999999995, text: '= knit two stitches together' }] },
      { text: 'tbl = through the back loop', size: 10.08, bold: false, y: 502.77920000000006, parts: [{ x: 36.950552, text: 'tbl' }, { x: 48.219992, text: ' ' }, { x: 50.70056, text: '= through the back loop' }] },
      { text: 'M1L = Make 1 Left; work an increase by inserting the left', size: 10.08, bold: false, y: 489.8192, parts: [{ x: 36.950552, text: 'M1L' }, { x: 56.479544000000004, text: ' ' }, { x: 58.928096, text: '= Make 1 Left; work an increase by inserting the left' }] },
      { text: 'needle under the strand between the stitches from front to', size: 10.08, bold: false, y: 476.85920000000004, parts: [{ x: 36.950552, text: 'needle under the strand between the stitches from front to' }] },
      { text: 'back and knitting it through the back loop.', size: 10.08, bold: false, y: 464.1392000000001, parts: [{ x: 36.950552, text: 'back and knitting it through the back loop.' }] },
      { text: 'M1Lp = Make 1 Left purl; work an increase by inserting the', size: 10.08, bold: false, y: 451.17920000000004, parts: [{ x: 36.950552, text: 'M1Lp' }, { x: 61.99532, text: ' ' }, { x: 64.450568, text: '= Make 1 Left purl; work an increase by inserting the' }] },
      { text: 'left needle under the strand between the stitches from front to', size: 10.08, bold: false, y: 438.21920000000006, parts: [{ x: 36.950552, text: 'left needle under the strand between the stitches from front to' }] },
      { text: 'back and purling it through the back loop.', size: 10.08, bold: false, y: 425.2592000000001, parts: [{ x: 36.950552, text: 'back and purling it through the back loop.' }] },
      { text: 'M1R = Make 1 Right; work an increase by inserting the left', size: 10.08, bold: false, y: 412.29920000000004, parts: [{ x: 36.950552, text: 'M1R' }, { x: 57.114584, text: ' ' }, { x: 59.553104, text: '= Make 1 Right; work an increase by inserting the left' }] },
      { text: 'needle under the strand between the stitches from back to', size: 10.08, bold: false, y: 399.33920000000006, parts: [{ x: 36.950552, text: 'needle under the strand between the stitches from back to' }] },
      { text: 'front and knitting it through the front loop.', size: 10.08, bold: false, y: 386.3792000000001, parts: [{ x: 36.950552, text: 'front and knitting it through the front loop.' }] },
      { text: 'M1Rp = Make 1 Right purl; work an increase by inserting the', size: 10.08, bold: false, y: 373.41920000000005, parts: [{ x: 36.950552, text: 'M1Rp' }, { x: 62.62028, text: ' ' }, { x: 65.07555199999999, text: '= Make 1 Right purl; work an increase by inserting the' }] },
      { text: 'left needle under the strand between the stitches from back to', size: 10.08, bold: false, y: 360.45920000000007, parts: [{ x: 36.950552, text: 'left needle under the strand between the stitches from back to' }] },
      { text: 'front and purling it through the front loop.', size: 10.08, bold: false, y: 347.49920000000003, parts: [{ x: 36.950552, text: 'front and purling it through the front loop.' }] },
    ]
    const { reader } = buildReaderFromPages([MIA_ABBR_LINES], { fileName: 'mia.pdf' })
    expect(reader.reference.abbr).toEqual({
      BOR: 'beginning of round',
      RS: 'right side',
      WS: 'wrong side',
      k: 'knit',
      p: 'purl',
      sl: 'slip stitch purlwise',
      'st(s)': 'stitch(es)',
      sk: 'slip 1 stitch knitwise, return stitch back to the left needle',
      wyif: 'with yarn in front',
      k2tog: 'knit two stitches together',
      tbl: 'through the back loop',
      M1L: 'Make 1 Left; work an increase by inserting the left needle under the strand between the stitches from front to back and knitting it through the back loop.',
      M1Lp: 'Make 1 Left purl; work an increase by inserting the left needle under the strand between the stitches from front to back and purling it through the back loop.',
      M1R: 'Make 1 Right; work an increase by inserting the left needle under the strand between the stitches from back to front and knitting it through the front loop.',
      M1Rp: 'Make 1 Right purl; work an increase by inserting the left needle under the strand between the stitches from back to front and purling it through the front loop.',
    })
  })

  // Revue de code (post-livraison) : la 1ʳᵉ version de la garde utilisait une regex locale
  // (`[=:]` seulement) qui ratait le dialecte tiret ASCII espacé (« clé - déf »), pourtant
  // déjà supporté et documenté ailleurs dans reference.js (ABBR_DASH_ASCII_RE, cycle 10,
  // unicorn-pillow/dino-pram-chain/decorative-pumpkins). Même géométrie que le test « = »
  // ci-dessus (mêmes abscisses réelles de Mia, PAR CONSTRUCTION — seul le séparateur
  // textuel change), pour isoler strictement la variable testée : un glossaire à vrai
  // tiret ASCII ne doit pas plus être confondu avec un glossaire en colonnes qu'un
  // glossaire à « = ». Meurt avec l'ancienne regex locale (`sepLines` sous-compte à 0,
  // le garde-fou ne se déclenche pas) ; passe avec `execAbbrLine` (reference.js), qui
  // reconnaît nativement ce dialecte via `ABBR_DASH_ASCII_RE`.
  it('un vrai glossaire « clé - déf » à tiret ASCII (même géométrie que Mia) n’est pas non plus confondu avec un glossaire en colonnes', () => {
    const MIA_ABBR_LINES_DASH = [
      { text: 'Abbreviations', size: 14, bold: true, y: 645, parts: [{ x: 36.95, text: 'Abbreviations' }] },
      { text: 'BOR - beginning of round', size: 10.08, bold: false, y: 632.1392000000001, parts: [{ x: 36.950552, text: 'BOR' }, { x: 58.670936, text: ' ' }, { x: 61.1156, text: '- beginning of round' }] },
      { text: 'RS - right side', size: 10.08, bold: false, y: 619.1792, parts: [{ x: 36.950552, text: 'RS' }, { x: 49.06872800000001, text: ' ' }, { x: 51.530648, text: '- right side' }] },
      { text: 'WS - wrong side', size: 10.08, bold: false, y: 606.4592, parts: [{ x: 36.950552, text: 'WS' }, { x: 51.051464, text: ' ' }, { x: 53.513072, text: '- wrong side' }] },
      { text: 'k - knit', size: 10.08, bold: false, y: 593.4992000000001, parts: [{ x: 36.950552, text: 'k' }, { x: 42.303031999999995, text: ' ' }, { x: 44.763056, text: '- knit' }] },
      { text: 'p - purl', size: 10.08, bold: false, y: 580.5392, parts: [{ x: 36.950552, text: 'p' }, { x: 42.514711999999996, text: ' ' }, { x: 44.973031999999996, text: '- purl' }] },
      { text: 'sl - slip stitch purlwise', size: 10.08, bold: false, y: 567.5792, parts: [{ x: 36.950552, text: 'sl' }, { x: 43.736408, text: ' ' }, { x: 46.218128, text: '- slip stitch purlwise' }] },
      { text: 'st(s) - stitch(es)', size: 10.08, bold: false, y: 554.6192000000001, parts: [{ x: 36.950552, text: 'st(s)' }, { x: 55.51589599999999, text: ' ' }, { x: 57.985712, text: '- stitch(es)' }] },
      { text: 'sk - slip 1 stitch knitwise, return stitch back to the left needle', size: 10.08, bold: false, y: 541.6592, parts: [{ x: 36.950552, text: 'sk' }, { x: 46.468087999999995, text: ' ' }, { x: 48.928088, text: '- slip 1 stitch knitwise, return stitch back to the left needle' }] },
      { text: 'wyif - with yarn in front', size: 10.08, bold: false, y: 528.6992, parts: [{ x: 36.950552, text: 'wyif' }, { x: 54.579679999999996, text: ' ' }, { x: 57.057992, text: '- with yarn in front' }] },
      { text: 'k2tog - knit two stitches together', size: 10.08, bold: false, y: 515.7392, parts: [{ x: 36.950552, text: 'k2tog' }, { x: 60.749432, text: ' ' }, { x: 63.200551999999995, text: '- knit two stitches together' }] },
      { text: 'tbl - through the back loop', size: 10.08, bold: false, y: 502.77920000000006, parts: [{ x: 36.950552, text: 'tbl' }, { x: 48.219992, text: ' ' }, { x: 50.70056, text: '- through the back loop' }] },
      { text: 'M1L - Make 1 Left; work an increase by inserting the left', size: 10.08, bold: false, y: 489.8192, parts: [{ x: 36.950552, text: 'M1L' }, { x: 56.479544000000004, text: ' ' }, { x: 58.928096, text: '- Make 1 Left; work an increase by inserting the left' }] },
      { text: 'needle under the strand between the stitches from front to', size: 10.08, bold: false, y: 476.85920000000004, parts: [{ x: 36.950552, text: 'needle under the strand between the stitches from front to' }] },
      { text: 'back and knitting it through the back loop.', size: 10.08, bold: false, y: 464.1392000000001, parts: [{ x: 36.950552, text: 'back and knitting it through the back loop.' }] },
      { text: 'M1Lp - Make 1 Left purl; work an increase by inserting the', size: 10.08, bold: false, y: 451.17920000000004, parts: [{ x: 36.950552, text: 'M1Lp' }, { x: 61.99532, text: ' ' }, { x: 64.450568, text: '- Make 1 Left purl; work an increase by inserting the' }] },
      { text: 'left needle under the strand between the stitches from front to', size: 10.08, bold: false, y: 438.21920000000006, parts: [{ x: 36.950552, text: 'left needle under the strand between the stitches from front to' }] },
      { text: 'back and purling it through the back loop.', size: 10.08, bold: false, y: 425.2592000000001, parts: [{ x: 36.950552, text: 'back and purling it through the back loop.' }] },
      { text: 'M1R - Make 1 Right; work an increase by inserting the left', size: 10.08, bold: false, y: 412.29920000000004, parts: [{ x: 36.950552, text: 'M1R' }, { x: 57.114584, text: ' ' }, { x: 59.553104, text: '- Make 1 Right; work an increase by inserting the left' }] },
      { text: 'needle under the strand between the stitches from back to', size: 10.08, bold: false, y: 399.33920000000006, parts: [{ x: 36.950552, text: 'needle under the strand between the stitches from back to' }] },
      { text: 'front and knitting it through the front loop.', size: 10.08, bold: false, y: 386.3792000000001, parts: [{ x: 36.950552, text: 'front and knitting it through the front loop.' }] },
      { text: 'M1Rp - Make 1 Right purl; work an increase by inserting the', size: 10.08, bold: false, y: 373.41920000000005, parts: [{ x: 36.950552, text: 'M1Rp' }, { x: 62.62028, text: ' ' }, { x: 65.07555199999999, text: '- Make 1 Right purl; work an increase by inserting the' }] },
      { text: 'left needle under the strand between the stitches from back to', size: 10.08, bold: false, y: 360.45920000000007, parts: [{ x: 36.950552, text: 'left needle under the strand between the stitches from back to' }] },
      { text: 'front and purling it through the front loop.', size: 10.08, bold: false, y: 347.49920000000003, parts: [{ x: 36.950552, text: 'front and purling it through the front loop.' }] },
    ]
    const { reader } = buildReaderFromPages([MIA_ABBR_LINES_DASH], { fileName: 'mia-dash.pdf' })
    expect(reader.reference.abbr).toEqual({
      BOR: 'beginning of round',
      RS: 'right side',
      WS: 'wrong side',
      k: 'knit',
      p: 'purl',
      sl: 'slip stitch purlwise',
      'st(s)': 'stitch(es)',
      sk: 'slip 1 stitch knitwise, return stitch back to the left needle',
      wyif: 'with yarn in front',
      k2tog: 'knit two stitches together',
      tbl: 'through the back loop',
      M1L: 'Make 1 Left; work an increase by inserting the left needle under the strand between the stitches from front to back and knitting it through the back loop.',
      M1Lp: 'Make 1 Left purl; work an increase by inserting the left needle under the strand between the stitches from front to back and purling it through the back loop.',
      M1R: 'Make 1 Right; work an increase by inserting the left needle under the strand between the stitches from back to front and knitting it through the front loop.',
      M1Rp: 'Make 1 Right purl; work an increase by inserting the left needle under the strand between the stitches from back to front and purling it through the front loop.',
    })
  })

  // Preuve par mutation (étape 5) : élargir la portée de la lecture en colonnes
  // à TOUTES les sections (pas seulement ref==='abbr') ne fait échouer AUCUN test existant
  // (readColumnGlossary a ses propres garde-fous internes — MIN_ENTRIES/MIN_COLUMN_VOTES —
  // et aucune autre section des fixtures existantes n'a une géométrie à 2 colonnes assez
  // nette pour les satisfaire). Ce test comble le trou : une section de TRAVAIL banale
  // (« Corps », ref indéfini) dont les rangs sont fortuitement alignés en 2 colonnes
  // (numéro de rang à x=48, valeur à x=102 — même géométrie que le glossaire crossbody)
  // ne doit PAS être avalée comme un glossaire si la portée redevient globale : sans la
  // garde `sec.ref !== 'abbr'`, les 4 rangs disparaissent du corps (section entière vidée)
  // et réapparaissent à tort comme abréviations R1..R4 — vérifié empiriquement en mutant
  // temporairement assemble.js.
  it('une section de travail à 2 colonnes fortuites (rangs alignés, pas un glossaire) n’est PAS transformée en glossaire', () => {
    const page = [
      { text: 'Pull Exemple', size: 24, bold: false, y: 800 },
      { text: 'Corps', size: 14, bold: true, y: 500 },
      { text: 'R1 12 m', size: 10, bold: false, y: 480, parts: [{ x: 48, text: 'R1' }, { x: null, text: ' ' }, { x: 102, text: '12 m' }] },
      { text: 'R2 14 m', size: 10, bold: false, y: 470, parts: [{ x: 48, text: 'R2' }, { x: null, text: ' ' }, { x: 102, text: '14 m' }] },
      { text: 'R3 16 m', size: 10, bold: false, y: 460, parts: [{ x: 48, text: 'R3' }, { x: null, text: ' ' }, { x: 102, text: '16 m' }] },
      { text: 'R4 18 m', size: 10, bold: false, y: 450, parts: [{ x: 48, text: 'R4' }, { x: null, text: ' ' }, { x: 102, text: '18 m' }] },
    ]
    const { reader } = buildReaderFromPages([page], { fileName: 'x.pdf' })
    expect(reader.reference.abbr).toEqual({})
    const corps = reader.sections.find((s) => s.title === 'Corps')
    expect(corps).toBeTruthy()
    expect(corps.steps.map((s) => s.t)).toEqual(['R1 12 m', 'R2 14 m', 'R3 16 m', 'R4 18 m'])
  })
})

describe('buildReaderFromPages — branche allemande de bout en bout', () => {
  it('recolle une phrase allemande coupée par la colonne (nom commun capitalisé en continuation)', () => {
    const pagesDe = [[
      L('Pullover Beispiel', { size: 24 }),
      L('Rückenteil', { bold: true, size: 14 }),
      L('Schlage 80 Maschen an und stricke im Bündchenmuster.'),
      L('Wiederhole diese Reihe für die gesamte'),
      L('Länge des Rückenteils.'),
    ]]
    const { reader } = buildReaderFromPages(pagesDe, { fileName: 'pullover-beispiel.pdf' })
    const corps = reader.sections.find((s) => s.title === 'Rückenteil')
    expect(corps).toBeTruthy()
    expect(corps.steps.map((s) => s.t)).toContain(
      'Wiederhole diese Reihe für die gesamte Länge des Rückenteils.'
    )
  })
})

// Un arbitrage tranché le 03/09
// : deux sections ou plus portant le MÊME titre PDF (« Halsausschnitt » ×2, « Bordure » ×3,
// « BODY » ×2…) sont indiscernables dans le lecteur et le sommaire — le PDF porte lui-même
// ces répétitions, le défaut est l'absence de disambiguïsation côté moteur. DÉCISION :
// numérotation d'occurrence — si un titre apparaît N ≥ 2 fois, TOUTES ses occurrences
// reçoivent « (1) » … « (N) », dans l'ordre d'apparition. Le suffixe ne touche QUE le titre
// affiché : kind et id (slug du titre BRUT, posé avant par normalizeReaderForSave) restent
// intacts — « un libellé affiché ne sert jamais de clé de données ».
describe('buildReaderFromPages — titres de sections homonymes numérotés', () => {
  const PAGES_DOUBLES = [[
    L('Gilet Exemple', { size: 24 }),
    L('Tailles : S (M) L'),
    L('Halsausschnitt', { bold: true, size: 14, y: 700 }),
    L('Rang 1 : monter 104 m.', { y: 680 }),
    L('Halsausschnitt', { bold: true, size: 14, y: 660 }),
    L('Rang 2 : tricoter jusqu’à 20 cm.', { y: 640 }),
  ]]
  const PAGES_TRIPLES = [[
    L('Écharpe Exemple', { size: 24 }),
    L('Bordure', { bold: true, size: 14, y: 700 }),
    L('Rang 1 : monter 200 m.', { y: 680 }),
    L('Bordure', { bold: true, size: 14, y: 660 }),
    L('Rang 2 : tricoter 4 rangs.', { y: 640 }),
    L('Bordure', { bold: true, size: 14, y: 620 }),
    L('Rang 3 : rabattre.', { y: 600 }),
  ]]

  it('deux sections « Halsausschnitt » → « Halsausschnitt (1) » / « Halsausschnitt (2) » (ordre d’apparition, TOUTES numérotées)', () => {
    const { reader } = buildReaderFromPages(PAGES_DOUBLES, { fileName: 'gilet.pdf' })
    expect(reader.sections.map((s) => s.title)).toEqual(['Halsausschnitt (1)', 'Halsausschnitt (2)'])
  })

  it('trois « Bordure » → (1)/(2)/(3)', () => {
    const { reader } = buildReaderFromPages(PAGES_TRIPLES, { fileName: 'echarpe.pdf' })
    expect(reader.sections.map((s) => s.title)).toEqual(['Bordure (1)', 'Bordure (2)', 'Bordure (3)'])
  })

  it('libellé ≠ clé : id reste le slug du titre BRUT et kind est inchangé (encolure des deux côtés, posés AVANT la numérotation)', () => {
    const { reader } = buildReaderFromPages(PAGES_DOUBLES, { fileName: 'gilet.pdf' })
    // ids tels que normalizeReaderForSave les pose sur les titres BRUTS (collision → « -1 »),
    // PAS les slugs des titres suffixés (qui seraient halsausschnitt-1 / halsausschnitt-2).
    expect(reader.sections.map((s) => s.id)).toEqual(['halsausschnitt', 'halsausschnitt-1'])
    // kind identique à celui d'une occurrence unique du même titre : le suffixe ne
    // détourne aucun kindForTitle.
    expect(reader.sections.map((s) => s.kind)).toEqual(['encolure', 'encolure'])
    // Le contenu non plus ne bouge pas (seul le titre affiché change).
    expect(reader.sections[0].steps.map((s) => s.t)).toEqual(['Rang 1 : monter 104 m.'])
    expect(reader.sections[1].steps.map((s) => s.t)).toEqual(['Rang 2 : tricoter jusqu’à 20 cm.'])
  })

  it('le MD sérialisé porte les titres numérotés ; le marqueur {kind} reste celui du kind (jamais dérivé du titre)', async () => {
    const { patternToMd } = await import('@/utils/pattern-md/serialize')
    const { pattern, reader } = buildReaderFromPages(PAGES_DOUBLES, { fileName: 'gilet.pdf' })
    const { md } = patternToMd({ ...pattern, reader })
    expect(md).toContain('## Halsausschnitt (1) {neckline}')
    expect(md).toContain('## Halsausschnitt (2) {neckline}')
    expect(md).not.toContain('## Halsausschnitt\n')
    expect(md).not.toContain('## Halsausschnitt {')
  })

  it('contre-tests : deux titres DIFFÉRENTS et un titre unique ne sont PAS numérotés', () => {
    const pages = [[
      L('Gilet Exemple', { size: 24 }),
      L('Vordererteil', { bold: true, size: 14, y: 700 }),
      L('Rang 1 : monter 104 m.', { y: 680 }),
      L('Rückenteil', { bold: true, size: 14, y: 660 }),
      L('Rang 2 : tricoter jusqu’à 20 cm.', { y: 640 }),
      L('Ärmel', { bold: true, size: 14, y: 620 }),
      L('Rang 3 : rabattre.', { y: 600 }),
    ]]
    const { reader } = buildReaderFromPages(pages, { fileName: 'gilet2.pdf' })
    expect(reader.sections.map((s) => s.title)).toEqual(['Vordererteil', 'Rückenteil', 'Ärmel'])
  })

  it('contre-test casse : « Corps » vs « CORPS » restent DISTINCTS (comparaison stricte, pas de case-fold)', () => {
    const pages = [[
      L('Pull Exemple', { size: 24 }),
      L('Corps', { bold: true, size: 14, y: 700 }),
      L('Rang 1 : monter 104 m.', { y: 680 }),
      L('CORPS', { bold: true, size: 14, y: 660 }),
      L('Rang 2 : tricoter jusqu’à 20 cm.', { y: 640 }),
    ]]
    const { reader } = buildReaderFromPages(pages, { fileName: 'pull.pdf' })
    expect(reader.sections.map((s) => s.title)).toEqual(['Corps', 'CORPS'])
  })

  it('la section « Présentation » (intro) n’est jamais numérotée, même si une section de travail porte le même titre (le sérialiseur la reconnaît au titre exact)', () => {
    const pages = [[
      L('Pull Exemple', { size: 24 }),
      L('Un joli pull pour l’hiver.', { y: 690 }),
      L('Présentation', { bold: true, size: 14, y: 660 }),
      L('Rang 1 : monter 104 m.', { y: 640 }),
    ]]
    const { reader } = buildReaderFromPages(pages, { fileName: 'pull.pdf' })
    const titles = reader.sections.map((s) => s.title)
    expect(titles[0]).toBe('Présentation') // intro : intouchable (isIntro/serialize)
    expect(titles).not.toContain('Présentation (1)')
  })
})

describe('parseAuthorLine — forme « © Marque annee »', () => {
  // Ligne REELLE : Mia Cardigan (English) v1.1, page 1.
  it('capte la marque d’une ligne de copyright', () => {
    expect(parseAuthorLine('© Coco Amour Knitwear 2025 – all rights reserved.'))
      .toBe('Coco Amour Knitwear')
  })

  it('ne capte rien sans nom entre le symbole et l’annee', () => {
    expect(parseAuthorLine('© 2025')).toBeNull()
    expect(parseAuthorLine('© 2025 – all rights reserved.')).toBeNull()
  })

  it('ne capte rien sans annee', () => {
    expect(parseAuthorLine('© Coco Amour Knitwear')).toBeNull()
  })

  it('n’avale pas la suite de la ligne', () => {
    expect(parseAuthorLine('© Coco Amour Knitwear 2025 – all rights reserved. Version 1.1'))
      .toBe('Coco Amour Knitwear')
  })

  // Anti-faux-positif trouve en balayant le corpus reel (3234 PDF, pas seulement
  // l'echantillon de 120) : PDF « Ivy Sweater Schematics », ligne reelle « Mette Wendelboe
  // Okkels ©COPYRIGHT 2025 » — le mot « COPYRIGHT » lui-meme suit les trois ancrages de
  // COPYRIGHT_BRAND_RE (majuscule, colle au ©, annee derriere) et se faisait passer pour
  // la marque. Le vrai nom est avant le ©, hors de portee de cette forme : on reste null
  // plutot que de fabriquer un faux auteur.
  it('ne capte pas le mot « copyright » lui-meme comme marque (bug Ivy Sweater Schematics)', () => {
    expect(parseAuthorLine('Mette Wendelboe Okkels ©COPYRIGHT 2025')).toBeNull()
    expect(parseAuthorLine('© Copyright 2020')).toBeNull()
    expect(parseAuthorLine('© COPYRIGHT 2025 – all rights reserved.')).toBeNull()
  })

  // ELARGISSEMENT (première passe de revue) : le meme mecanisme que « COPYRIGHT » guette
  // avec des formules legales voisines de plusieurs mots — chacune suit les trois ancrages
  // de COPYRIGHT_BRAND_RE sans etre un nom. Liste fermee, 4 langues (fr/en/es/de).
  it('ne capte pas une formule legale generique de plusieurs mots (fr/en/es/de)', () => {
    expect(parseAuthorLine('© All Rights Reserved 2020')).toBeNull()
    expect(parseAuthorLine('© No Commercial Use 2023')).toBeNull()
    expect(parseAuthorLine('© Tous droits réservés 2024')).toBeNull()
    expect(parseAuthorLine('© Todos los derechos reservados 2022')).toBeNull()
    expect(parseAuthorLine('© Alle Rechte vorbehalten 2021')).toBeNull()
  })

  // Anti-faux-negatif : un seul mot generique dans la capture ne doit PAS ecarter une
  // marque reelle qui le contient — seule la totalite des mots comptant.
  it('capte une marque reelle meme si un de ses mots figure aussi dans la liste generique', () => {
    expect(parseAuthorLine('© Design Studio 2021')).toBe('Design Studio')
    expect(parseAuthorLine('© Rights & Stitches 2022')).toBe('Rights & Stitches')
  })
})

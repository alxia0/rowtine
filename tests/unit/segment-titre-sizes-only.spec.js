// Un titre « Sizes N only: » ouvre un bloc d'INSTRUCTIONS par taille, pas le
// tableau de référence des tailles. Classé ref='mesures' sur le mot « Sizes »,
// il était écarté du travail EN BLOC par assemble.js (filtre `!s.ref`) : sur
// Mia Cardigan, 14 sections « Size(s) … only » (~189 lignes de rangs) étaient
// détruites en silence, WARNINGS=0. Perte silencieuse = bug.
import { describe, it, expect } from 'vitest'
import { segmentSections, kindForTitle } from '@/utils/pdf-import/segment'
import { buildReaderFromPages } from '@/utils/pdf-import/assemble'

const L = (text, y = 0, size = 11) => ({ text, y, size, bold: false })
const B = (text, y, size = 11) => ({ text, y, size, bold: true })
const refOf = (secs, titre) => secs.find((s) => s.title === titre)?.ref

// Forme réelle de Mia Cardigan : les deux titres coexistent dans le document —
// « Sizes: » (le vrai bloc de référence) et « Sizes 1 and 4 only: » (du travail).
// Deux exigences de la fixture, apprises à la dure :
//  - contexte de page (section de travail + corps) : sur une page de 2 lignes,
//    aucun titre n'est promu et le test passerait au vert sans rien prouver ;
//  - page de couverture en tête : ces blocs sont pages 2 à 8 dans le vrai PDF.
//    Sur la page 0, la rétrogradation « étiquette de boîte » les replierait dans
//    la section précédente — artefact de fixture, pas le comportement testé.
const pagesMia = () => [
  [B('MIA CARDIGAN', 800, 24)],
  [
  B('Yoke', 800),
  L('Cast on 99 (99, 101) 103 sts with 3mm needles.', 780),
  L('Row 1: knit all stitches to the end of the row.', 760),
  B('Sizes 1 and 4 only:', 740),
  L('Row 1 (WS): P1 (right front), slip M8, k1, p3, k1 (raglan).', 720),
  L('Row 2 (RS) raglan increase row: K1, M1R, slip M1. (8 sts increased)', 700),
  B('Sizes:', 680),
  L('1 (2, 3, 4, 5) (6, 7, 8, 9) 10, 11', 660),
  ],
]

describe('titre « Size(s) … only » ≠ bloc de référence Tailles', () => {
  it('ne route PAS un bloc d’instructions par taille vers les mesures', () => {
    const secs = segmentSections(pagesMia())
    // Garde anti-test-vide : le titre DOIT être détecté, sinon l'assertion
    // suivante serait vraie par `undefined` et ne prouverait rien.
    expect(secs.some((s) => s.title === 'Sizes 1 and 4 only')).toBe(true)
    expect(refOf(secs, 'Sizes 1 and 4 only')).not.toBe('mesures')
  })

  it('route TOUJOURS le vrai bloc de référence vers les mesures', () => {
    expect(refOf(segmentSections(pagesMia()), 'Sizes')).toBe('mesures')
  })

  // Le garde est ancré « ^ » : il ne désarme les mesures QUE si le titre commence
  // par un mot de taille. Un titre de mesures légitime qui contient « only » plus
  // loin ne doit pas fuiter dans le travail (garde trop large = mesures perdues).
  it('ne désarme PAS un titre de mesures légitime contenant « only »', () => {
    expect(kindForTitle('Measurements (finished garment only)')).toBe('mesures')
  })

  it('bout en bout : les rangs du bloc par taille survivent dans le patron', () => {
    const { reader } = buildReaderFromPages(pagesMia())
    const sec = reader.sections.find((s) => s.title === 'Sizes 1 and 4 only')
    expect(sec).toBeTruthy()
    expect(JSON.stringify(sec.steps)).toMatch(/right front/)
    expect(JSON.stringify(sec.steps)).toMatch(/raglan increase row/)
  })
})

// Le garde ne valait au départ qu'en en/fr/de : il était accolé au SEUL groupe ancré
// (tailles?|sizes?|größen?), alors que les autres mots de taille (tallas, taglie,
// maten, storlek, størrelser, rozmiary, koot, tamaños) sont des alternatives non
// ancrées — elles matchaient AVANT que le lookahead soit consulté. Les jetons
// « solo », « alleen », « endast » étaient donc morts : ils affichaient une couverture
// es/it/nl/sv inexistante pendant que ces patrons perdaient leurs rangs en silence.
// Un cas par langue du corpus, pour qu'aucun mot ne puisse être retiré sans rougir.
describe('titre « tailles … seulement » ≠ mesures, dans les 11 langues', () => {
  const casParLangue = [
    ['en', 'Sizes 1 and 4 only'],
    ['fr', 'Tailles 1 et 4 seulement'],
    ['fr', 'Tailles 1 et 4 uniquement'],
    ['de', 'Größen 1 und 4 nur'],
    ['es', 'Tallas 1 y 4 solo'],
    ['es', 'Tamaños 1 y 4 solamente'],
    ['it', 'Taglie 1 e 4 solo'],
    ['it', 'Taglie 1 e 4 soltanto'],
    ['nl', 'Maten 1 en 4 alleen'],
    ['sv', 'Storlekar 1 och 4 endast'],
    ['sv', 'Storlekar 1 och 4 bara'],
    ['da', 'Størrelser 1 og 4 kun'],
    ['no', 'Størrelser 1 og 4 bare'],
    ['pl', 'Rozmiary 1 i 4 tylko'],
    ['fi', 'Koot 1 ja 4 vain'],
    ['fi', 'Koot 1 ja 4 ainoastaan'],
  ]
  it.each(casParLangue)('%s : « %s » n’est pas le tableau de référence', (_langue, titre) => {
    expect(kindForTitle(titre)).not.toBe('mesures')
  })

  // Contrepartie : le garde ne doit pas emporter le VRAI tableau de tailles. Sans ces
  // cas, coller « ^ » à tous les mots de taille (ou trop élargir) passerait inaperçu.
  const tableauxLegitimes = [
    'Tailles', 'Tailles (cm)', 'Sizes:', 'Größen', 'Tallas', 'Tamaños', 'Taglie',
    'Maten', 'Storlekar', 'Størrelser', 'Rozmiary', 'Koot',
    'Tabla de tallas', // mot de taille NON ancré : reste un tableau
  ]
  it.each(tableauxLegitimes)('« %s » reste le tableau de référence', (titre) => {
    expect(kindForTitle(titre)).toBe('mesures')
  })
})

// Bout en bout non-anglais : la démonstration que le garde en/fr/de ne suffisait pas.
// Avant le correctif, « Tallas 1 y 4 solo » partait en ref='mesures' et assemble.js
// jetait ses rangs EN BLOC, sans warning. Perte silencieuse = bug.
describe('bloc par taille en espagnol', () => {
  const pagesEs = () => [
    [B('CHAQUETA MIA', 800, 24)],
    [
      B('Canesú', 800),
      L('Montar 99 (99, 101) 103 puntos con agujas de 3mm.', 780),
      L('Vuelta 1: tejer todos los puntos del derecho.', 760),
      B('Tallas 1 y 4 solo:', 740),
      L('Vuelta 1 (RS): 1p (delantero derecho), deslizar M8, 1d, 3p (raglán).', 720),
      L('Vuelta 2 (LD) vuelta de aumentos: 1d, AD, deslizar M1. (8 puntos aumentados)', 700),
      B('Tallas:', 680),
      L('1 (2, 3, 4, 5) (6, 7, 8, 9) 10, 11', 660),
    ],
  ]

  it('ne route PAS le bloc d’instructions par taille vers les mesures', () => {
    const secs = segmentSections(pagesEs())
    expect(secs.some((s) => s.title === 'Tallas 1 y 4 solo')).toBe(true)
    expect(refOf(secs, 'Tallas 1 y 4 solo')).not.toBe('mesures')
  })

  it('route TOUJOURS le vrai tableau « Tallas: » vers les mesures', () => {
    expect(refOf(segmentSections(pagesEs()), 'Tallas')).toBe('mesures')
  })

  it('bout en bout : les rangs du bloc par taille survivent dans le patron', () => {
    const { reader } = buildReaderFromPages(pagesEs())
    const sec = reader.sections.find((s) => s.title === 'Tallas 1 y 4 solo')
    expect(sec).toBeTruthy()
    expect(JSON.stringify(sec.steps)).toMatch(/delantero derecho/)
    expect(JSON.stringify(sec.steps)).toMatch(/vuelta de aumentos/)
  })
})

// Bug #2 : un bloc « Sizes N only » TRÈS COURT (≤ 3 lignes) placé JUSTE APRÈS une
// section de RÉFÉRENCE (fil/matériel/aiguilles/échantillon/mesures) est aujourd'hui
// rétrogradé — traité comme une étiquette de boîte (« Borduurnaald ») et ré-absorbé
// dans la section référence précédente (garde G4a, l.309-353). Ses rangs finissent
// alors dans une section ref='fil' : reference.js/assemble.js les route en
// aide-mémoire, pas en travail → destruction SILENCIEUSE (WARNINGS=0), même défaut
// que le bug « Sizes only » déjà couvert plus haut, mais côté rétrogradation plutôt
// que côté kindForTitle. Page de couverture en tête (comme pagesMia) pour isoler le
// déclencheur « prev est une section référence » de celui « page 0 ».
const pagesFilPuisSizes = (ligneRang) => [
  [B('PATRON TEST', 800, 24)],
  [
    B('Fil', 800),
    L('100% laine, 50g/125m.', 780),
    B('Sizes 3 and 5 only:', 760),
    L(ligneRang, 740),
  ],
]

describe('bloc court « Sizes N only » après une section référence (fil) : pas rétrogradé', () => {
  it('rang « Row N: » — reste une section distincte, rang conservé (RED sur le code actuel)', () => {
    const secs = segmentSections(pagesFilPuisSizes('Row 1: k all sts'))
    // Garde anti-test-vide : le titre DOIT être détecté comme section à part.
    const sizesSec = secs.find((s) => s.title === 'Sizes 3 and 5 only')
    expect(sizesSec).toBeTruthy()
    expect(sizesSec.lines.map((l) => l.text)).toContain('Row 1: k all sts')
    // Négatif : la section « Fil » ne doit PAS avoir avalé le rang (pas d'absorption).
    const filSec = secs.find((s) => s.title === 'Fil')
    expect(filSec.lines.map((l) => l.text)).not.toContain('Row 1: k all sts')
  })

  // Caveat du correctif : hasRowLine (l.330) ne testait à l'origine QUE ROW_START_RE.
  // Un bloc « Sizes N only » dont le rang est un item numéroté NU (« 1. Knit… »,
  // capté par BARE_ITEM_RE, pas par ROW_START_RE) passe encore à travers la garde
  // si on n'étend pas hasRowLine à BARE_ITEM_RE — d'où ce cas dédié.
  it('rang en item numéroté nu (« 1. … », BARE_ITEM_RE) — reste aussi une section distincte', () => {
    const secs = segmentSections(pagesFilPuisSizes('1. Knit all stitches to end.'))
    const sizesSec = secs.find((s) => s.title === 'Sizes 3 and 5 only')
    expect(sizesSec).toBeTruthy()
    expect(sizesSec.lines.map((l) => l.text)).toContain('1. Knit all stitches to end.')
    const filSec = secs.find((s) => s.title === 'Fil')
    expect(filSec.lines.map((l) => l.text)).not.toContain('1. Knit all stitches to end.')
  })

  it('bout en bout : le rang du bloc court survit dans le patron (pas absorbé dans ## Fil)', () => {
    const { reader } = buildReaderFromPages(pagesFilPuisSizes('Row 1: k all sts'))
    const sec = reader.sections.find((s) => s.title === 'Sizes 3 and 5 only')
    expect(sec).toBeTruthy()
    expect(JSON.stringify(sec.steps)).toMatch(/k all sts/)
  })
})

import { describe, it, expect } from 'vitest'
import { readColumnGlossary } from '@/utils/pdf-import/glossary-columns'

// Fabrique une ligne à deux colonnes : clé à x0, définition à x1.
const two = (key, def, x0 = 48, x1 = 102) => ({
  text: `${key} ${def}`,
  parts: [{ x: x0, text: key }, { x: null, text: ' ' }, { x: x1, text: def }],
})
// Ligne pleine largeur (prose), démarrant à la marge de gauche.
const full = (text, x0 = 48) => ({ text, parts: [{ x: x0, text }] })
// Ligne démarrant DANS la colonne des définitions.
const cont = (text, x1 = 102) => ({ text, parts: [{ x: x1, text }] })

describe('readColumnGlossary', () => {
  it('lit un glossaire sans séparateur aligné en deux colonnes (crossbody)', () => {
    const lines = [
      two('m', 'Maille(s)'),
      two('bc', 'Boucle centre'),
      two('chaîn', 'Chaînette / maille en l’air'),
      two('demi-br', 'Demi-bride où le crochet est passé dans les 3 boucles visibles (Voir dessin).'),
    ]
    const r = readColumnGlossary(lines)
    expect(r.entries).toEqual([
      { key: 'm', def: 'Maille(s)' },
      { key: 'bc', def: 'Boucle centre' },
      { key: 'chaîn', def: 'Chaînette / maille en l’air' },
      { key: 'demi-br', def: 'Demi-bride où le crochet est passé dans les 3 boucles visibles (Voir dessin).' },
    ])
    expect(r.notes).toEqual([])
    expect(r.consumed).toHaveLength(4)
  })

  it('découpe même quand la clé et la définition sont dans la même cellule', () => {
    const lines = [
      two('m', 'Maille(s)'),
      two('bc', 'Boucle centre'),
      // Écart réel 4,5 pt : un seul morceau pour la clé, mais la définition reste à x=102.
      { text: '2 demi-br aug Augmentation (2 demi-br en une m)',
        parts: [{ x: 48, text: '2 demi-br aug' }, { x: 97, text: ' ' }, { x: 102, text: 'Augmentation (2 demi-br en une m)' }] },
    ]
    expect(readColumnGlossary(lines).entries[2]).toEqual({
      key: '2 demi-br aug', def: 'Augmentation (2 demi-br en une m)',
    })
  })

  it('recolle une définition qui déborde sur la ligne suivante', () => {
    const lines = [
      two('m', 'Maille(s)'),
      two('bc', 'Boucle centre'),
      two('M1L', 'Make 1 Left; work an increase by inserting the left'),
      cont('needle under the strand between the stitches'),
    ]
    const r = readColumnGlossary(lines)
    expect(r.entries[2].def).toBe(
      'Make 1 Left; work an increase by inserting the left needle under the strand between the stitches',
    )
    expect(r.notes).toEqual([])
  })

  it('route la prose pleine largeur en note, jamais en entrée', () => {
    const lines = [
      two('m', 'Maille(s)'),
      two('bc', 'Boucle centre'),
      two('br', 'Bride'),
      full('NOTE : Les boucles sont aussi appelées mailles dans certains patrons'),
      full('– boucles et mailles sont le même concept.'),
      full('La partie en rond sera un peu déformée, ondulant.'),
    ]
    const r = readColumnGlossary(lines)
    expect(r.entries).toHaveLength(3)
    expect(r.notes).toEqual([
      'NOTE : Les boucles sont aussi appelées mailles dans certains patrons – boucles et mailles sont le même concept.',
      'La partie en rond sera un peu déformée, ondulant.',
    ])
    expect(r.consumed).toHaveLength(6)
  })

  it('ne recolle pas une remarque à une définition déjà terminée', () => {
    const lines = [
      two('m', 'Maille(s)'),
      two('bc', 'Boucle centre'),
      two('2 demi-br ens', 'Diminution (2 demi-br crochetées ensemble)'),
      cont('Toutes les augmentations et diminutions de demi-br sont travaillées en passant'),
    ]
    const r = readColumnGlossary(lines)
    expect(r.entries[2].def).toBe('Diminution (2 demi-br crochetées ensemble)')
    expect(r.notes).toEqual([
      'Toutes les augmentations et diminutions de demi-br sont travaillées en passant',
    ])
  })

  it('fonctionne sur une autre colonne (star-stitch, x=227/255)', () => {
    const lines = [
      two('m', 'Maille(s)', 227, 255),
      two('chaîn', 'Chaînette, maille en l’air', 227, 255),
      two('jt', 'Jeté', 227, 255),
    ]
    expect(readColumnGlossary(lines).entries).toHaveLength(3)
  })

  it('lit les DEUX colonnes de clés d’une grille 2×2 alternée 50/50 (loupy p4, ancres 36/298) — la couverture se juge PAR ANCRE, pas au total', () => {
    // V2a-T2 (spec §2.4) : les grilles 2×2 appariées de readPairedGrid (T1) produisent
    // UN flux unique où chaque rangée Y donne « clé1 def1 » puis « clé2 def2 » — deux
    // colonnes de CLÉS (loupy p4 : ancres 36 et 298, définitions ~107 et ~369, mesuré
    // clusters 0.06/0.18/0.50/0.62 × 595 pt). Avec 6 rangées + 1 wrap, chaque ancre ne
    // voit que 6 lignes sur 13 : un dénominateur GLOBAL de couverture tuerait la 2ᵉ
    // colonne (6/13 < 0,5) — LE piège mesuré de la vague. PAR ANCRE : 6/6 = 100 %.
    // Rouge d'abord : avant top-2, computeLeftX ne renvoie que 36 et toute la colonne
    // droite (REP, Sl, SM…) part en emitNote.
    const cell = (key, def, x0, x1) => ({
      text: `${key} ${def}`,
      parts: [{ x: x0, text: key }, { x: null, text: ' ' }, { x: x1, text: def }],
    })
    const rows = [
      ['BLCO', 'backwards loop cast on', 'REP', 'repeat'],
      ['CO', 'cast on', 'Sl', 'slip'],
      ['K', 'knit', 'SM', 'stitch marker'],
      ['K2tog', 'knit two together', 'SSK', 'slip slip knit'],
      ['LLI', 'left lifted increase', 'Sts', 'stitches'],
      ['P2tog', 'purl two together', 'St st', 'stockinette stitch'],
    ]
    const lines = []
    for (const [k1, d1, k2, d2] of rows) {
      lines.push(cell(k1, d1, 36, 107))
      lines.push(cell(k2, d2, 298, 369))
    }
    // Wrap de la définition P2tog (colonne 1) : ligne ancrée à la COLONNE de définitions
    // 107, intercalée avant la rangée suivante — doit se recoller à l'entrée au-dessus
    // (grammaire de continuation inchangée avec deux ancres). Elle creuse aussi le
    // dénominateur global à 13 lignes : 6/13 < 0,5, le test ne peut PAS passer avec un
    // dénominateur total.
    lines.splice(11, 0, { text: 'through the back loop', parts: [{ x: 107, text: 'through the back loop' }] })
    const r = readColumnGlossary(lines)
    expect(r.entries).toEqual([
      { key: 'BLCO', def: 'backwards loop cast on' },
      { key: 'REP', def: 'repeat' },
      { key: 'CO', def: 'cast on' },
      { key: 'Sl', def: 'slip' },
      { key: 'K', def: 'knit' },
      { key: 'SM', def: 'stitch marker' },
      { key: 'K2tog', def: 'knit two together' },
      { key: 'SSK', def: 'slip slip knit' },
      { key: 'LLI', def: 'left lifted increase' },
      { key: 'Sts', def: 'stitches' },
      { key: 'P2tog', def: 'purl two together through the back loop' },
      { key: 'St st', def: 'stockinette stitch' },
    ])
    expect(r.notes).toEqual([])
    expect(r.consumed).toHaveLength(13)
  })

  it('garde un glossaire à UNE colonne de clés strictement identique quand le 2ᵉ x le plus fréquent est à ≥ 40 pt (continuations à 102) — non-régression top-2', () => {
    // Le 2ᵉ bucket (102, les continuations de définitions) est à 54 pt du premier : il
    // devient ancre CANDIDATE, mais ses lignes ne votent jamais 3 fois pour une même
    // abscisse au-delà → sa colonne est rejetée, on retombe EXACTEMENT sur le
    // comportement monocolonne d'avant (entrées + recollage + note identiques au test
    // « recolle une définition qui déborde », ici verrouillé ensemble).
    const lines = [
      two('m', 'Maille(s)'),
      two('bc', 'Boucle centre'),
      two('M1L', 'Make 1 Left; work an increase by inserting the left'),
      cont('needle under the strand between the stitches'),
      full('NOTE : Les boucles sont aussi appelées mailles dans certains patrons'),
    ]
    const r = readColumnGlossary(lines)
    expect(r.entries).toEqual([
      { key: 'm', def: 'Maille(s)' },
      { key: 'bc', def: 'Boucle centre' },
      { key: 'M1L', def: 'Make 1 Left; work an increase by inserting the left needle under the strand between the stitches' },
    ])
    expect(r.notes).toEqual(['NOTE : Les boucles sont aussi appelées mailles dans certains patrons'])
  })

  it('ne retient qu’UNE seule ancre pour deux colonnes de clés trop proches (< 40 pt) — la 2ᵉ colonne part en notes, comme avant', () => {
    // Grille 2×2 serrée : clés 2 à 30 pt des clés 1 (66 vs 36), sous le seuil de
    // séparation MIN_ANCHOR_GAP (loupy réel : 262 pt ; mini-kawaii : 260 pt — les vraies
    // grilles sont larges). Une seule ancre : la colonne 2 retombe en notes, jamais en
    // entrées — bornage du top-2, pas un élargissement.
    const cell = (key, def, x0, x1) => ({
      text: `${key} ${def}`,
      parts: [{ x: x0, text: key }, { x: null, text: ' ' }, { x: x1, text: def }],
    })
    const rows = [
      ['BLCO', 'backwards loop cast on', 'REP', 'repeat'],
      ['CO', 'cast on', 'Sl', 'slip'],
      ['K', 'knit', 'SM', 'stitch marker'],
      ['K2tog', 'knit two together', 'SSK', 'slip slip knit'],
      ['LLI', 'left lifted increase', 'Sts', 'stitches'],
      ['P2tog', 'purl two together', 'St st', 'stockinette stitch'],
    ]
    const lines = []
    for (const [k1, d1, k2, d2] of rows) {
      lines.push(cell(k1, d1, 36, 130))
      lines.push(cell(k2, d2, 66, 160))
    }
    const r = readColumnGlossary(lines)
    expect(r.entries).toEqual(rows.map(([k1, d1]) => ({ key: k1, def: d1 })))
    expect(r.notes).toEqual(rows.map(([, , k2, d2]) => `${k2} ${d2}`))
  })

  it('rend null quand le x le plus fréquent est la colonne des DÉFINITIONS (clés alignées à droite, meris p16) — la 2ᵉ ancre ne rattrape pas un top-1 sans colonne', () => {
    // Contre-échantillon V1 (contrôle « diff meris vide » de V2a-T2) : sur meris p16,
    // les clés sont alignées à DROITE (x variables 83-117, seule la sous-liste « m5oo1-
    // B2-S2… » est calée à gauche à 64) et TOUTES les définitions démarrent à 132, wraps
    // compris — le bucket le plus fréquent est donc 132 (7 wraps), PAS une marge de
    // clés. Le top-1 d'avant rendait null (glossaire non lu, perte assumée de V1) ; une
    // version qui TRIERAIT les ancres gauche→droite inverserait les deux (64 en tête),
    // lirait un demi-glossaire + 13 notes et ferait diverger le contre-échantillon.
    // Verrou : anchors[0] = le plus fréquent, SANS colonne valide pour lui → null.
    const cell = (key) => ({
      text: `${key} work an increase`,
      parts: [{ x: 64, text: key }, { x: null, text: ' ' }, { x: 132, text: 'work an increase' }],
    })
    const lines = [
      cell('m5oo1-B2-S2'), cell('m5oo1-B3-S1'), cell('m5oo1-B5-S1'),
      cell('m7oo1-B2-S2'), cell('m7oo1-B3-S1'), cell('m7oo1-B5-S1'),
      // 7 wraps démarrant À la colonne de définitions (132) : bucket majoritaire.
      ...Array.from({ length: 7 }, (_, i) => ({
        text: `added to the body and ${i} sts to the sleeve`,
        parts: [{ x: 132, text: `added to the body and ${i} sts to the sleeve` }],
      })),
    ]
    expect(readColumnGlossary(lines)).toBeNull()
  })

  it('rend null quand il n’y a pas d’alignement (moins de 3 entrées alignées)', () => {
    const lines = [two('m', 'Maille(s)'), two('bc', 'Boucle centre', 48, 140), full('Du texte ordinaire.')]
    expect(readColumnGlossary(lines)).toBeNull()
  })

  it('rend null sur de la prose ordinaire sans colonne', () => {
    const lines = [
      full('Le point étoile peut être crocheté de façon à'),
      full('ce que les étoiles s’alignent dans les rangs'),
      full('La pente est créée en travaillant en spirales'),
      full('comme décrit dans le patron.'),
    ]
    expect(readColumnGlossary(lines)).toBeNull()
  })

  it('rend null quand les lignes n’ont pas de parts (déjà reflowées)', () => {
    expect(readColumnGlossary([{ text: 'm Maille(s) bc Boucle centre chaîn Chaînette' }])).toBeNull()
  })

  it('ne fabrique pas de colonne à partir d’une puce de liste invisible (brain-waves-beanie-no, corpus réel) — c’est une liste à UNE seule colonne, jamais un tableau à 2 colonnes', () => {
    // Géométrie réelle mesurée sur brain-waves-beanie-no-a0fde5da.pdf (correctif B).
    // La puce de liste PDF est extraite comme le caractère U+F0B7 SEUL (police
    // Symbol/Wingdings mal mappée) : non blanc, donc non retiré par `.trim()`, et
    // absent du jeu de puces visibles que lines.js sait retirer (qui exige en plus
    // un `\s+` immédiatement après la puce dans le MÊME morceau — absent ici, la
    // puce et l'espace qui suit sont deux morceaux distincts). Chaque ligne est
    // « ‸KEY: définition », clé de longueur VARIABLE : ce n'est structurellement
    // PAS un tableau à 2 colonnes (contrairement à crossbody/star-stitch, où la
    // définition démarre TOUJOURS à la même abscisse). Sans le filtre décoratif,
    // la puce devient la fausse marge gauche et une entrée illisible
    // (`|  | R1: Row/Round 1 - … |`) ; AVEC le filtre mais sans la garde de
    // couverture, l'espace qui suit une clé de longueur voisine (« R1: »/« SK: »,
    // même largeur) vote par hasard pour la même colonne sur 2-4 lignes parmi 16 —
    // suffisant pour passer MIN_COLUMN_VOTES(3) mais pas une vraie table.
    const bullet = ''
    const lines = [
      { text: `${bullet} R1: Row/Round 1 - A shorthand way to indicate a specific row/round.`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'R1:' }, { x: 66.0335, text: ' ' }, { x: 68.904, text: 'Row/Round 1 - A shorthand way to indicate a specific row/round.' }] },
      { text: `${bullet} YO: Yarn Over - Wrap or lay yarn over hook.`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'YO:' }, { x: 69.2506, text: ' ' }, { x: 72.024, text: 'Yarn Over - Wrap or lay yarn over hook.' }] },
      { text: `${bullet} BEG: Beginning - The first st (or other indicated space) of the row/round.`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'BEG:' }, { x: 74.0513, text: ' ' }, { x: 76.824, text: 'Beginning - The first st (or other indicated space) of the row/round.' }] },
      { text: `${bullet} REP: Repeat - Repeat the instructions starting at the asterisk ( * ).`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'REP:' }, { x: 71.2924, text: ' ' }, { x: 74.184, text: 'Repeat - Repeat the instructions starting at the asterisk ( * ).' }] },
      { text: `${bullet} SK: Skip - Leave the indicated st unworked.`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'SK:' }, { x: 66.0335, text: ' ' }, { x: 68.904, text: 'Skip - Leave the indicated st unworked.' }] },
      { text: `${bullet} SAME: Same St - The same st as the join, at the base of your beginning ch 1.`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'SAME:' }, { x: 81.4914, text: ' ' }, { x: 84.264, text: 'Same St - The same st as the join, at the base of your beginning ch 1.' }] },
      { text: `${bullet} PREV: Previous - The st or round you just worked.`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'PREV:' }, { x: 78.2644, text: ' ' }, { x: 81.024, text: 'Previous - The st or round you just worked.' }] },
      { text: `${bullet} JOIN: Shorthand for ending each round - Slip stitch in the 1st st of the round.`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'JOIN:' }, { x: 78.0154, text: ' ' }, { x: 80.904, text: 'Shorthand for ending each round - Slip stitch in the 1st st of the round.' }] },
      { text: `${bullet} FO: Fasten Off - Cut yarn tail. Pull up the loop on the hook and pass your yarn`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'FO:' }, { x: 67.9358, text: ' ' }, { x: 70.704, text: 'Fasten Off - Cut yarn tail. Pull up the loop on the hook and pass your yarn' }] },
      { text: 'tail through. Pull tight to close. Weave in ends.', parts: [{ x: 51.96, text: 'tail through. Pull tight to close. Weave in ends.' }] },
      { text: `${bullet} IF: Invisible Finish - Use when fastening off for a cleaner look. See my photo`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'IF:' }, { x: 62.3184, text: ' ' }, { x: 65.064, text: 'Invisible Finish - Use when fastening off for a cleaner look. See my photo' }] },
      { text: 'tutorial for a full explanation. playinhookydesigns.blogspot.com/p/invisible-', parts: [{ x: 51.96, text: 'tutorial for a full explanation.' }, { x: 189.6462, text: ' ' }, { x: 192.53, text: 'playinhookydesigns.blogspot.com/p/invisible-' }] },
      { text: 'finish.html', parts: [{ x: 51.96, text: 'finish.html' }] },
      { text: `${bullet} Magic Ring - See my photo tutorial. playinhookydesigns.blogspot.com/p/`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'Magic Ring - See my photo tutorial.' }, { x: 222.1629, text: ' ' }, { x: 224.93, text: 'playinhookydesigns.blogspot.com/p/' }] },
      { text: 'magic-ring.html', parts: [{ x: 51.96, text: 'magic-ring.html' }] },
      { text: `${bullet} To Change Colors: Finish last st of round to last two loops on hook, YO with`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'To Change Colors: Finish last st of round to last two loops on hook, YO with' }] },
      { text: 'new color and pull through. JOIN with new color.', parts: [{ x: 51.96, text: 'new color and pull through. JOIN with new color.' }] },
      { text: `${bullet} Ch 2 counts as a st; Ch 1 does not count as a st.`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'Ch 2 counts as a st; Ch 1 does not count as a st.' }] },
      { text: `${bullet} PAY ATTENTION to where you start your stitches in each round so your waves`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'PAY ATTENTION to where you start your stitches in each round so your waves' }] },
      { text: 'line up properly. See my YouTube video tutorial for more help: http://', parts: [{ x: 51.96, text: 'line up properly. See my YouTube video tutorial for more help:' }, { x: 349.6843, text: ' ' }, { x: 355.39, text: 'http://' }] },
      { text: 'youtu.be/7SoJuB_lCEI', parts: [{ x: 51.96, text: 'youtu.be/7SoJuB_lCEI' }] },
      { text: `${bullet} You do not need to cut the yarn after each round. Carry each color up the`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'You do not need to cut the yarn after each round. Carry each color up the' }] },
      { text: 'seam and pick it up when you need it again. Be sure not to pull too tightly or', parts: [{ x: 51.96, text: 'seam and pick it up when you need it again. Be sure not to pull too tightly or' }] },
      { text: 'leave the yarn too loose. The yarn strands won’t be felt or seen when worn.', parts: [{ x: 51.96, text: 'leave the yarn too loose. The yarn strands won’t be felt or seen when worn.' }] },
      { text: 'This will give you fewer ends to weave in and make a ravel-resistant beanie.', parts: [{ x: 51.96, text: 'This will give you fewer ends to weave in and make a ravel-resistant beanie.' }] },
      { text: `${bullet} When only one st count is given, it applies to all sizes.`, parts: [{ x: 33.96, text: bullet }, { x: 38.5416, text: ' ' }, { x: 51.96, text: 'When only one st count is given, it applies to all sizes.' }] },
    ]
    expect(readColumnGlossary(lines)).toBeNull()
  })

  it('ne fabrique pas de colonne quand la puce visible « • » partage l’abscisse du morceau vide qui précède la vraie clé (5-Cozy-Crochet-…-eBook, corpus réel)', () => {
    // Géométrie réelle mesurée sur 5-Cozy-Crochet-Patterns-eBook-2024.pdf : la puce
    // « • » est un morceau à part entière, suivi d'un morceau VIDE à la MÊME
    // abscisse que le début de la vraie clé fusionnée « ch: chain ». Sans le
    // filtre décoratif, le morceau vide devient le point de coupe : la clé émise
    // est la puce seule (`| • | ch: chain |`), le reste de la ligne (y compris la
    // vraie clé) fuit dans la définition.
    const two = (rest) => ({
      text: `•${rest}`,
      parts: [{ x: 358.9, text: '•' }, { x: 372.46, text: '' }, { x: 372.46, text: rest }],
    })
    const lines = [
      two('ch: chain'), two('sl st: slip stitch'), two('st(s): stitch(es)'), two('sc: single crochet'),
      two('ext sc: extended single crochet'), two('Mext sc: modified extended single crochet'),
      two('fpdc: front post double crochet'), two('fptr: front post treble crochet'),
      two('sc2tog: single crochet 2 together'), two('RS: Right Side'), two('yo: yarn over'),
      two('Rep: repeat'), two('Rnd: round'), two('BLO: back loop only'),
    ]
    expect(readColumnGlossary(lines)).toBeNull()
  })

  it('rejette une colonne qui n’explique qu’une minorité des lignes ancrées à gauche (garde de couverture, sans rapport avec une puce) — Juice-style, clés de longueur variable sans séparateur détecté ici', () => {
    // Aucune puce ici : reproduit le mécanisme générique, pas les 2 patrons nommés
    // (couverts par les 2 tests ci-dessus). Sur une liste « clé : définition » à
    // clés de longueur variable, la définition ne démarre PAS à une abscisse fixe
    // — 3 lignes sur 8 (K/P/M, clés d'une lettre) tombent par hasard à la même
    // abscisse (avant : la 1re lettre d'une clé, même largeur de police), ce qui
    // suffit à passer MIN_COLUMN_VOTES (≥ 3) sans qu'il y ait de vraie table à 2
    // colonnes (5 des 8 lignes ne matchent aucune colonne commune). Sans la garde
    // de couverture, ce quart de signal fortuit serait accepté comme une vraie
    // colonne et casserait les 5 autres entrées.
    const line = (key, x1) => ({ text: `${key}: def`, parts: [{ x: 50, text: `${key}:` }, { x: x1, text: 'def' }] })
    const lines = [
      line('K', 54), line('P', 54), line('M', 54),
      line('BOR', 60), line('DPN', 64), line('Rnd', 68), line('Sl1', 72), line('SM', 76),
    ]
    expect(readColumnGlossary(lines)).toBeNull()
  })

  it('rejette une colonne dont la clé dépasse 40 caractères', () => {
    const long = 'une phrase entière qui ne peut pas être une clé de glossaire'
    const lines = [
      { text: `${long} suite`, parts: [{ x: 48, text: long }, { x: null, text: ' ' }, { x: 102, text: 'suite' }] },
      { text: `${long} bis`, parts: [{ x: 48, text: long }, { x: null, text: ' ' }, { x: 102, text: 'bis' }] },
      { text: `${long} ter`, parts: [{ x: 48, text: long }, { x: null, text: ' ' }, { x: 102, text: 'ter' }] },
    ]
    expect(readColumnGlossary(lines)).toBeNull()
  })

  it('ne recolle pas une continuation à une entrée si une note s’est intercalée', () => {
    // Revue : la règle de continuation regarde la DERNIÈRE CHOSE ÉMISE, tous
    // types confondus — pas seulement « la dernière entrée jamais créée ».
    // Sans ce suivi, la note intercalée serait ignorée et le texte suivant
    // recollé à tort à la définition inachevée de M1L.
    const lines = [
      two('m', 'Maille(s)'),
      two('bc', 'Boucle centre'),
      two('M1L', 'Make 1 Left; work an increase by inserting the left'),
      full('Note isolée sans rapport.'),
      cont('needle under the strand between the stitches'),
    ]
    const r = readColumnGlossary(lines)
    expect(r.entries[2].def).toBe('Make 1 Left; work an increase by inserting the left')
    expect(r.notes).toEqual([
      'Note isolée sans rapport.',
      'needle under the strand between the stitches',
    ])
  })

  it('ne perd le texte d’aucune ligne reçue (entrées, continuation, notes)', () => {
    const lines = [
      two('m', 'Maille(s)'),
      two('bc', 'Boucle centre'),
      two('M1L', 'Make 1 Left; work an increase by inserting the left'),
      cont('needle under the strand between the stitches'),
      full('Une remarque libre sur le patron.'),
    ]
    const r = readColumnGlossary(lines)
    const haystack = [...r.entries.map((e) => `${e.key} ${e.def}`), ...r.notes].join(' | ')
    for (const line of lines) {
      const normalized = line.text.replace(/\s{2,}/g, ' ').trim()
      expect(haystack).toContain(normalized)
    }
    expect(r.consumed).toHaveLength(lines.length)
  })
})

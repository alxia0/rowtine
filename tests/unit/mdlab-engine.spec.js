// Tests du moteur offline v2 : ciblent src/utils/pdf-import (source unique,
// l'ancien fork moteur a été retiré) — reflow, boilerplate, colonnes.
import { describe, it, expect } from 'vitest'
import { reflowLines } from '@/utils/pdf-import/reflow'
import { stripBoilerplate } from '@/utils/pdf-import/boilerplate'
import { itemsToLines } from '@/utils/pdf-import/lines'
import { detectSizeLabels, findSizeVectors, applySizeVectors } from '@/utils/pdf-import/sizes'
import { kindForTitle, looksLikeTableRow, isTitleLine, segmentSections, detectTitle } from '@/utils/pdf-import/segment'
import { extractReference, referenceFieldForHeading } from '@/utils/pdf-import/reference'
import { parseAuthorLine, buildReaderFromPages } from '@/utils/pdf-import/assemble'
import { linesToSteps } from '@/utils/pdf-import/steps'
import { computeConfidence } from '@/utils/pdf-import/confidence'

const L = (text, y = 0, size = 11) => ({ text, y, size, bold: false })

describe('mdlab reflow', () => {
  it('recolle une ligne coupée qui reprend en minuscule', () => {
    const out = reflowLines([L('Stricke bis 6 (7) Maschen vor dem'), L('Anfang der Runde stricken.')])
    expect(out.map((l) => l.text)).toEqual(['Stricke bis 6 (7) Maschen vor dem Anfang der Runde stricken.'])
  })
  it('recolle après un mot pendant même si la suite commence par un chiffre', () => {
    const out = reflowLines([L('Crocheter 1 b dans les'), L('63 prochaines m.')])
    expect(out).toHaveLength(1)
  })
  it('ne fusionne ni deux phrases ni deux abréviations', () => {
    const out = reflowLines([L('Première phrase.'), L('Deuxième phrase.'), L('ml = maille en l’air'), L('mc = maille coulée')])
    expect(out).toHaveLength(4)
  })
  it('mode para : regroupe par interligne, coupe aux grands blancs', () => {
    const out = reflowLines(
      [L('Un début de paragraphe.', 100), L('Sa suite immédiate.', 88), L('Nouveau paragraphe.', 50)],
      { para: true },
    )
    expect(out.map((l) => l.text)).toEqual(['Un début de paragraphe. Sa suite immédiate.', 'Nouveau paragraphe.'])
  })
  it('recolle un mot de rang employé en simple mot de phrase (« with the next row »)', () => {
    const out = reflowLines([
      L('Continue this pattern back and forth for 8 cm, with the next'),
      L('row from the right side.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toContain('with the next row from the right side.')
  })
  it('ne fusionne pas devant un vrai rang numéroté (« rnd 4 »)', () => {
    const out = reflowLines([L('work as established and then'), L('rnd 4 knit all stitches')])
    expect(out).toHaveLength(2)
  })
  it('ne fusionne pas devant une puce', () => {
    const out = reflowLines([L('Ingrédients de la recette'), L('- 200g de farine')])
    expect(out).toHaveLength(2)
  })
})

describe('mdlab reflow — G2a KV clé à espace (« m env », « m end »)', () => {
  it('ne fusionne pas deux abréviations dont la clé contient un espace', () => {
    // Abros-A2 : « m env = maille envers » / « m end = maille endroit » sont des
    // lignes KV et ne doivent JAMAIS se recoller entre elles.
    const out = reflowLines([L('m env = maille envers'), L('m end = maille endroit')])
    expect(out).toHaveLength(2)
  })
  it('reconnaît une clé KV à deux tokens courts avec « : »', () => {
    const out = reflowLines([L('travail en cours'), L('ch sp = chain space')])
    expect(out).toHaveLength(2)
  })
  it('NON-RÉGRESSION : une phrase « Étape 2 : … » n’est PAS une ligne KV (fusionne en mode para)', () => {
    // Discriminant contre le correctif naïf .{1,12}? qui prendrait « Étape 2 » pour une clé.
    const out = reflowLines(
      [L('Introduction du patron', 100), L('Étape 2 : tricoter en rond', 88)],
      { para: true },
    )
    expect(out).toHaveLength(1)
    expect(out[0].text).toContain('Étape 2 : tricoter en rond')
  })
  it('NON-RÉGRESSION : une clé mono-token classique reste KV (« 1 = knit »)', () => {
    const out = reflowLines([L('legende du diagramme'), L('1 = knit')])
    expect(out).toHaveLength(2)
  })
})

describe('mdlab reflow — G2b chiffre nu n’ouvre pas d’item (« 4 mm »)', () => {
  it('recolle « 4 mm » à la ligne d’échantillon (mode para)', () => {
    // Abros-A3 : « 4 mm » ne doit plus être traité comme un nouvel item de liste.
    const out = reflowLines(
      [L('Échantillon sur les aiguilles', 100), L('4 mm', 88)],
      { para: true },
    )
    expect(out).toHaveLength(1)
    expect(out[0].text).toContain('4 mm')
  })
  it('NON-RÉGRESSION : une vraie liste numérotée « 1. » ouvre un item', () => {
    const out = reflowLines(
      [L('Instructions', 100), L('1. Monter des mailles', 88)],
      { para: true },
    )
    expect(out).toHaveLength(2)
  })
  it('NON-RÉGRESSION : « 2) » et « 3) » ouvrent aussi un item', () => {
    const out2 = reflowLines([L('Instructions', 100), L('2) Tricoter en rond', 88)], { para: true })
    expect(out2).toHaveLength(2)
    const out3 = reflowLines([L('Instructions', 100), L('3) Rabattre', 88)], { para: true })
    expect(out3).toHaveLength(2)
  })
  it('bonus : un nombre décimal « 2.5 mm » n’ouvre pas d’item (lookahead)', () => {
    const out = reflowLines([L('Aiguilles recommandées', 100), L('2.5 mm', 88)], { para: true })
    expect(out).toHaveLength(1)
  })
})

describe('mdlab boilerplate', () => {
  it('retire SKU, TCPDF, copyright, liens boutique et pieds de page répétés', () => {
    const noise = ['hobbii-pattern-sku:pattern-1', 'Powered by TCPDF (www.tcpdf.org)', 'Hobbii.de - Copyright © 2018', 'http://shop.hobbii.de/x']
    const pages = [1, 2, 3].map((n) => [
      L('En-tête répété', 800),
      L(`Contenu utile ${n}`, 500),
      L(`Rang ${n} : tricoter à l'endroit`, 400),
      L('Mon pied de page répété', 20),
      ...noise.map((t) => L(t, 10)),
    ])
    const clean = stripBoilerplate(pages)
    expect(clean.flat().map((l) => l.text)).toEqual([
      'Contenu utile 1', "Rang 1 : tricoter à l'endroit",
      'Contenu utile 2', "Rang 2 : tricoter à l'endroit",
      'Contenu utile 3', "Rang 3 : tricoter à l'endroit",
    ])
  })
  it('retire une bannière de tirets « ------ » (séparateur DROPS entre filets) mais garde un vrai tiret court', () => {
    const pages = [[
      L('BÖRJA ARBETET HÄR', 800),
      L('-------------------------------------------------------', 780),
      L('Virka 142 luftmaskor', 760),
      L('8-10 varv', 740), // plage numérique courte : NON une bannière
    ]]
    const clean = stripBoilerplate(pages)
    const texts = clean.flat().map((l) => l.text)
    expect(texts).not.toContain('-------------------------------------------------------')
    expect(texts).toContain('Virka 142 luftmaskor')
    expect(texts).toContain('8-10 varv')
  })
  it('ne touche pas un rang répété au MILIEU des pages malgré la normalisation des chiffres', () => {
    const pages = [1, 2].map((n) => [L('Titre', 800), L(`Rang ${n} : 3 m end`, 400), L('Pied', 20)])
    const clean = stripBoilerplate(pages)
    expect(clean.flat().some((l) => /Rang 1/.test(l.text))).toBe(true)
    expect(clean.flat().some((l) => /Rang 2/.test(l.text))).toBe(true)
  })
  it('écarte une légende photo courte récurrente de colonne droite, mais garde une instruction courte répétée hors colonne (bug poncho #8)', () => {
    // « Comme ceci » = légende de colonne droite (rightCol) répétée → bruit.
    // « Finir avec 1 mc. » = instruction courte répétée MAIS hors colonne droite → gardée.
    // La garde (colonne + brièveté) distingue les deux là où la simple répétition échouerait.
    const cap = (text, rightCol = false, y = 600) => ({ text, y, size: 10, bold: false, rightCol })
    const pages = [1, 2, 3].map((n) => [
      cap('EXPLICATIONS', false, 800),
      cap(`${n}. Faire 3 ml puis crocheter des brides`, false, 600),
      cap(`${n + 1}. Comme ceci.`, true, 600),
      cap('Finir avec 1 mc.', false, 400),
      cap('Pied de page repete', false, 20),
    ])
    const texts = stripBoilerplate(pages).flat().map((l) => l.text)
    expect(texts.some((t) => /Comme ceci/.test(t))).toBe(false)
    expect(texts.filter((t) => /Finir avec 1 mc/.test(t))).toHaveLength(3)
    expect(texts.some((t) => /Faire 3 ml/.test(t))).toBe(true)
  })
})

describe('mdlab boilerplate — pied/CTA de clôture DROPS (multilingue)', () => {
  // Lignes réelles fuyant en « > » sur lemon-heart-it (§ Correctif 1).
  const footerIt = [
    'Avete terminato questo modello?',
    'Allora taggate le vostre foto con #dropspattern #lemonheartshawl o inviatele alla #dropsfan gallery.',
    'Avete bisogno di aiuto con questo modello?',
    'Troverete 14 video tutorial, una sezione per i commenti/domande e molto altro guardando il modello su www.garnstudio.com',
    'Avete acquistato i filati DROPS per realizzare questo modello? Avete quindi diritto a ricevere un aiuto dal negozio che vi ha',
    'venduto il filato.',
    'dalle leggi sul copyright. Potete leggere quello che potete fare con i nostri modelli alla fine di ogni modello sul nostro sito.',
  ]
  it('filtre TOUTES les lignes du pied DROPS italien', () => {
    const pages = [[L('Titre', 800), ...footerIt.map((t, i) => L(t, 200 - i * 5))]]
    const kept = stripBoilerplate(pages).flat().map((l) => l.text)
    for (const line of footerIt) expect(kept).not.toContain(line)
    expect(kept).toContain('Titre')
  })
  it('filtre les formes réelles FR/DE/NL/DA/ES (lignes extraites des lemon-heart-<lang>)', () => {
    const lines = [
      'Vous avez terminé ce modèle?',                                   // fr (a)
      '¿Terminaste este patrón?',                                       // es (a) — sans pronom
      'Vous avez besoin d’aide pour ce modèle ?',                       // fr (b)
      'Heeft u hulp nodig voor dit patroon?',                           // nl (b)
      'Sie finden 14 Videotutorials und vieles mehr auf garnstudio.com',// de (c) — sans « www. »
      'Allora taggate le vostre foto con #dropspattern #dropsfan',      // it (d)
      'Vous avez acheté le fil DROPS pour réaliser ce modèle? Vous pouvez alors contacter le magasin qui vous a vendu le fil pour toute', // fr (e)+(f)
      'Haben Sie ein DROPS Garn verwendet, um diese Anleitung nachzuarbeiten? Dann haben Sie Anspruch auf Hilfe von dem Laden,', // de (e)+(f)
      'd’auteur (copyright). Apprenez-en davantage sur ce que vous pouvez faire avec nos modèles', // fr (g)
      'copyright. Læs mere om hvad du kan gøre med vore opskrifter, nedert i alle vore opskrifter på hjemmesiden.', // da (g)
    ]
    const kept = stripBoilerplate([lines.map((t, i) => L(t, 200 - i * 5))]).flat().map((l) => l.text)
    for (const line of lines) expect(kept).not.toContain(line)
  })
  it('NE casse PAS de vrai contenu proche (yarn spec, instructions mentionnant DROPS/Garnstudio/terminer)', () => {
    const real = [
      'DROPS BABYALPACA SILK di Garnstudio (appartiene al gruppo filati A)', // fabricant « Garnstudio » sans « .com »
      'DROPS BABYALPACA SILK von Garnstudio (gehört zur Garngruppe A)',
      'Scialle lavorato ai ferri in DROPS BabyAlpaca Silk.',
      'FERRI DROPS CIRCOLARI n° 3 mm, lunghezza 80 cm.',
      'Con i filati DROPS Air, montare 100 maglie a diritto.', // « filati DROPS » sans verbe d'achat
      'jusqu’à ce qu’il reste 2 mailles et terminer par A.6 au-dessus des 8 mailles', // « terminer » mais pas « ce modèle ? »
      'Avete lavorato 4 ferri in questo motivo prima di continuare.',
    ]
    const kept = stripBoilerplate([real.map((t, i) => L(t, 500 - i * 5))]).flat().map((l) => l.text)
    for (const line of real) expect(kept).toContain(line)
  })
})

describe('mdlab colonnes (itemsToLines)', () => {
  const item = (str, x, y, w = 40) => ({ str, width: w, transform: [1, 0, 0, 1, x, y] })
  it('remet une page à deux colonnes en ordre de lecture', () => {
    const items = [
      item('G1', 50, 700), item('D1', 350, 700),
      item('G2', 50, 680), item('D2', 350, 680),
      item('G3', 50, 660), item('D3', 350, 660),
      item('G4', 50, 640), item('D4', 350, 640),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual(['G1', 'G2', 'G3', 'G4', 'D1', 'D2', 'D3', 'D4'])
  })
  it('page simple : les cellules d’une même ligne restent réunies', () => {
    const items = [item('ml', 50, 700, 15), item('maille en l’air', 120, 700, 80)]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual(['ml maille en l’air'])
  })
  it('page de CORPS à colonnes inégales : sépare les légendes photo éparses des instructions (bug poncho #8)', () => {
    // Colonne gauche = instructions larges (x36→~286) ; colonne droite = légendes
    // photo courtes intercalées (« Comme ceci » à x302). L'ordre de lecture pdfjs les
    // entrelacerait par Y (« … Crocheter 1 b, 2 Comme ceci. ») ; la gouttière doit les
    // séparer et TAGUER la colonne droite (rightCol) sans corrompre les instructions.
    const items = [
      item('EXPLICATIONS', 36, 800, 120),
      item('1. Faire 3 ml puis crocheter 1 b, 2 ml et 2 b', 36, 700, 240),
      item('2. Comme ceci.', 330, 700, 78),
      item('dans la meme maille sur tout le rang', 36, 680, 230),
      item('3. Crocheter 1 b dans les prochaines m', 36, 600, 230),
      item('4. Comme ceci.', 330, 600, 78),
      item('5. Crocheter 1 b puis finir avec 1 mc', 36, 520, 230),
      item('6. Comme ceci.', 330, 520, 78),
      item('Hobbii.fr - Copyright 2018', 45, 20, 280),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    // Aucune instruction gauche n'a avalé une légende de droite.
    const instr = lines.find((l) => /Faire 3 ml/.test(l.text))
    expect(instr.text).not.toMatch(/Comme ceci/)
    // Les trois légendes sortent réunies dans le flux droit, taguées rightCol.
    const caps = lines.filter((l) => /Comme ceci/.test(l.text))
    expect(caps).toHaveLength(3)
    expect(caps.every((l) => l.rightCol === true)).toBe(true)
    // La colonne gauche (instructions) n'est jamais taguée rightCol.
    expect(lines.filter((l) => /Faire 3 ml|Crocheter/.test(l.text)).every((l) => !l.rightCol)).toBe(true)
  })
  it('gouttière SEULE : colonne droite trop éparse pour la bimodalité globale (garde-fou du détecteur)', () => {
    // 8 instructions gauches, SEULEMENT 2 légendes droites partageant 2 rangées.
    // La bimodalité héritée exige rightCells ≥ max(3, 0.2·filled) : ici 2 < 3 → elle
    // NE détecte PAS deux colonnes. Seule la gouttière géométrique (couloir vide +
    // entrelacement) sépare les flux. Retirer detectColumnGutter fait ROUGIR ce test
    // (« 1. Monter … » avalerait « 2. Comme ceci. »).
    const items = [
      item('EXPLICATIONS', 36, 800, 120),
      item('1. Monter 128 mailles en rond', 36, 700, 230),
      item('2. Comme ceci.', 330, 700, 78),
      item('Instruction ligne deux du rang', 36, 630, 220),
      item('Instruction ligne trois du rang', 36, 560, 220),
      item('Instruction ligne quatre du rang', 36, 490, 220),
      item('3. Crocheter une bride partout', 36, 420, 230),
      item('4. Comme ceci.', 330, 420, 78),
      item('Instruction ligne six du rang', 36, 350, 220),
      item('Instruction ligne sept du rang', 36, 280, 220),
      item('Instruction ligne huit du rang', 36, 210, 220),
      item('Hobbii.fr - Copyright 2018', 45, 20, 280),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.find((l) => /Monter 128/.test(l.text)).text).not.toMatch(/Comme ceci/)
    const caps = lines.filter((l) => /Comme ceci/.test(l.text))
    expect(caps).toHaveLength(2)
    expect(caps.every((l) => l.rightCol === true)).toBe(true)
  })
  it('retire la puce typographique de tête (glyphe de liste PDF ●/•) — artefact de mise en page', () => {
    // La puce est une cellule distincte, indentée à gauche de l'instruction (grand
    // saut X) : itemsToLines recolle « ● » + « Slå… » avec une espace, puis retire
    // le glyphe de tête.
    const items = [
      item('●', 40, 700, 8), item('Slå 104 masker op', 70, 700, 120),
      item('•', 40, 680, 8), item('Strik rib indtil 3 cm', 70, 680, 130),
      item('Twister Solid, fv 126', 40, 660, 130),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'Slå 104 masker op',
      'Strik rib indtil 3 cm',
      'Twister Solid, fv 126',
    ])
  })
})

describe('mdlab tailles', () => {
  it('lit une ligne Tailles multilingue avec de vrais tokens', () => {
    const { labels } = detectSizeLabels([[L('Größen: S/M (M/L)')]])
    expect(labels).toEqual(['S/M', 'M/L'])
  })
  it('ignore une phrase qui commence par « Taille »', () => {
    const { labels, from } = detectSizeLabels([[L('Taille : la jupe enfant a été mesurée pour s’assurer du tombé')]])
    expect(from).not.toBe('line')
    expect(labels).toEqual([])
  })
  it('recolle la continuation wrappée et conserve les unités d’âge (bug Abros, G1b)', () => {
    // « TAILLE » seul, puis 8 tailles-âge sur DEUX lignes physiques (2e = continuation wrappée).
    const { labels, from } = detectSizeLabels([
      [
        L('TAILLE'),
        L('9-12 mois (1-2 ans) 2-3 ans (3-4 ans) 4-5 ans'),
        L('(5-6 ans) 6-8 ans (8-10 ans)'),
      ],
    ])
    expect(from).toBe('line')
    expect(labels).toEqual([
      '9-12 mois', '1-2 ans', '2-3 ans', '3-4 ans', '4-5 ans', '5-6 ans', '6-8 ans', '8-10 ans',
    ])
  })
  it('ne recolle PAS une ligne suivante qui n’est plus une liste de tailles-âge', () => {
    const { labels } = detectSizeLabels([
      [
        L('TAILLE'),
        L('9-12 mois (1-2 ans) 2-3 ans'),
        L('Monter 146 mailles avec les aiguilles 4 mm.'),
      ],
    ])
    expect(labels).toEqual(['9-12 mois', '1-2 ans', '2-3 ans'])
  })
  it('détecte des tailles en préfixe de ligne répété « S/M: … » / « L/XL: … » (retour Alexia poncho)', () => {
    const { labels, from } = detectSizeLabels([
      [
        L('S/M: env. 250g'),
        L('L/XL: env. 320 g'),
        L('S/M: Longueur totale 90 cm'),
        L('L/XL: Longueur totale 100 cm'),
      ],
    ])
    expect(from).toBe('prefix')
    expect(labels).toEqual(['S/M', 'L/XL'])
  })
  it('ne détecte PAS une abréviation isolée « M: maille » comme taille', () => {
    const { labels } = detectSizeLabels([[L('M: maille')]])
    expect(labels).toEqual([])
  })
})

describe('mdlab tailles — notation à crochets B&P (G1a)', () => {
  it('aplati « a, (b,c,d), e, [f,g,h] » en un vecteur unique de 8 valeurs (bug Jumper49)', () => {
    const vecs = findSizeVectors('Monter 146, (152, 158, 164), 174, [180, 188, 196] m.')
    const v = vecs.find((v) => v.values.length === 8)
    expect(v).toBeTruthy()
    expect(v.values).toEqual(['146', '152', '158', '164', '174', '180', '188', '196'])
  })
  it('applySizeVectors compacte la notation à crochets en {{i}}', () => {
    const { t, c } = applySizeVectors('Monter 146, (152, 158, 164), 174, [180, 188, 196] m.', 8)
    expect(t).toBe('Monter {{0}} m.')
    expect(c[0]).toEqual(['146', '152', '158', '164', '174', '180', '188', '196'])
  })
  it('non-régression : les virgules DANS les parenthèses (groupes espacés) restent gérées par VEC_RE', () => {
    // Discriminateur clé : commas internes vs commas séparatrices de haut niveau.
    const vecs = findSizeVectors('102 (112, 122) (142)')
    expect(vecs.map((v) => v.values)).toEqual([['102', '112', '122', '142']])
  })
  it('non-régression : une liste de nombres en virgules SANS aucun groupe crocheté n’est pas un vecteur', () => {
    const vecs = findSizeVectors('Voir pages 12, 34, 56 pour les schémas')
    expect(vecs).toEqual([])
  })
})

describe('mdlab tailles — décimale à virgule en position LIBRE (jauge FR demi-mm)', () => {
  it('conserve « 4,5 (5) 5,5 » entier : vecteur [\'4,5\',\'5\',\'5,5\'] (aiguilles FR)', () => {
    // Demi-millimètres d'aiguilles = ubiquitaires en patrons FR. La décimale à virgule
    // est autorisée AVANT/APRÈS un groupe (positions libres, sans séparateur `[,;]` adjacent).
    const vecs = findSizeVectors('aiguilles 4,5 (5) 5,5 mm')
    expect(vecs).toHaveLength(1)
    expect(vecs[0].values).toEqual(['4,5', '5', '5,5'])
  })
  it('non-régression : la virgule reste un SÉPARATEUR à l’intérieur d’un groupe (« (112, 122) »)', () => {
    const vecs = findSizeVectors('102 (112, 122) (142)')
    expect(vecs.map((v) => v.values)).toEqual([['102', '112', '122', '142']])
  })
})

describe('mdlab tailles — VEC_RE linéaire sur entrée pathologique (anti-ReDoS)', () => {
  const timed = (s) => {
    const t0 = process.hrtime.bigint()
    const out = findSizeVectors(s)
    const t1 = process.hrtime.bigint()
    return { ms: Number(t1 - t0) / 1e6, out }
  }
  it('groupe (…) ouvert jamais fermé + longue liste de virgules → < 50 ms sur 100k caractères', () => {
    // '(' + '1' + ',1'.repeat(50000) : ~100k chars, parenthèse ouvrante sans fermante.
    // Ancien VEC_RE : backtracking catastrophique (2^k partitions virgule/décimale).
    const s = '(' + '1' + ',1'.repeat(50000)
    const { ms, out } = timed(s)
    expect(ms).toBeLessThan(50)
    expect(out).toEqual([]) // aucun groupe fermé → aucun vecteur
  })
  it('même explosion avec point-virgule comme séparateur → < 50 ms', () => {
    const s = '(' + '1' + ';1'.repeat(50000)
    const { ms } = timed(s)
    expect(ms).toBeLessThan(50)
  })
  it('longue liste de virgules SANS parenthèse → < 50 ms', () => {
    const s = '1' + ',1'.repeat(50000)
    const { ms } = timed(s)
    expect(ms).toBeLessThan(50)
  })
  it('longue liste d’ENTIERS espacés SANS groupe → linéaire (ReDoS latent corrigé par la borne)', () => {
    // Run de nombres nus séparés par des espaces, aucun groupe : le `*` nu sur le run libre
    // était quadratique (~5,5 s / 20k tokens) car l'espace inter-nombre est attribuable au
    // `\s*` de la plage à tiret ET au `\s*` externe. La borne {0,24} le rend linéaire.
    const s = '4 '.repeat(50000)
    const { ms } = timed(s)
    expect(ms).toBeLessThan(3000) // linéaire ~35 ms ici ; l'ancien `*` nu ≈ 34 000 ms
  })
  it('longue liste de DÉCIMALES à virgule espacées SANS groupe → linéaire', () => {
    // Garde du fix « demi-mm FR » : la virgule-décimale admise hors groupe ne rouvre pas la
    // catastrophe (avec `*` nu : ~126 000 ms ; avec la borne : linéaire ~115 ms).
    const s = '4,5 '.repeat(50000)
    const { ms } = timed(s)
    expect(ms).toBeLessThan(3000)
  })
})

describe('mdlab segment — detectTitle sous-titre de couverture (bug Audrey/Boble Joy/Oblong)', () => {
  const T = (text, y, size) => ({ text, y, size, bold: false })
  it('combine un sous-titre display (~20 pt) sous un grand titre (~50 pt)', () => {
    // Reproduit la géométrie réelle : « Audrey » 50 pt y=176, « Blusa » 20 pt y=140.
    const pages = [[
      T('MODELLO PER MAGLIA', 233, 14),
      T('Audrey', 176, 50),
      T('Blusa', 140, 20),
      T('Design: Au Bout du Pré | Hobbii Design', 80, 12),
    ]]
    expect(detectTitle(pages)).toBe('Audrey Blusa')
  })
  it('combine « Decorative Pumpkins » + « Oblong » (sous-titre 20 pt, titre 41 pt)', () => {
    const pages = [[T('CROCHET PATTERN', 233, 14), T('Decorative Pumpkins', 185, 41), T('Oblong', 152, 20)]]
    expect(detectTitle(pages)).toBe('Decorative Pumpkins Oblong')
  })
  it('NE combine PAS une ligne « Design: … » ni une tagline plus petite', () => {
    const pages = [[T('CROCHET PATTERN', 233, 14), T('Solo', 185, 50), T('Design: X | Hobbii Design', 150, 12)]]
    expect(detectTitle(pages)).toBe('Solo')
  })
})

describe('mdlab assemble — parseAuthorLine (préfixe « Design: » nettoyé, bug Hygge/Aurora)', () => {
  it('retire le préfixe « Design: » d’une ligne « … | Hobbii Design »', () => {
    expect(parseAuthorLine('Design: Libère tes mailles | Hobbii Design')).toBe('Libère tes mailles | Hobbii Design')
    expect(parseAuthorLine('Design: Crafty Maz Designs | Hobbii Design')).toBe('Crafty Maz Designs | Hobbii Design')
  })
  it('garde une ligne « X | Hobbii Design » sans préfixe intacte', () => {
    expect(parseAuthorLine('Miss Beetle | Hobbii Design')).toBe('Miss Beetle | Hobbii Design')
  })
  it('capture « Design: X » seul (sans pipe) sans le préfixe', () => {
    expect(parseAuthorLine('Designer: Tine Sommer Hansen')).toBe('Tine Sommer Hansen')
  })
  it('ignore une ligne non-auteur', () => {
    expect(parseAuthorLine('Tour 1: 6 ms dans le cercle')).toBeNull()
  })
})

describe('mdlab segment — titre de section référence porteur de données (bug Hygge « Crochet 6 mm »)', () => {
  const B = (text, y, size = 11) => ({ text, y, size, bold: true })
  it('conserve « Crochet 6 mm » (titre aiguilles porteur de donnée) comme ligne, sinon la taille du crochet est perdue', () => {
    // Page corps (index 1) : liste matériel où « Crochet 6 mm » est en gras → promu titre.
    const pages = [
      [B('Couverture', 800, 20)],
      [B('MATÉRIEL', 700), L('Mega Ball Aran', 690), B('Crochet 6 mm', 660), L('Ciseaux', 650), L('Marqueurs', 640)],
    ]
    const secs = segmentSections(pages)
    const aig = secs.find((s) => s.ref === 'aiguilles')
    expect(aig).toBeTruthy()
    expect(aig.lines.some((l) => l.text === 'Crochet 6 mm')).toBe(true)
    const ref = extractReference(secs, { n: 1 }).reference
    expect(JSON.stringify(ref)).toMatch(/Crochet 6 mm/)
  })
  it('non-régression : un titre référence SANS donnée (« MATÉRIEL » nu) ne s’auto-ajoute pas en ligne', () => {
    const pages = [[B('MATÉRIEL', 700), L('Ciseaux', 690)]]
    const secs = segmentSections(pages)
    const mat = secs.find((s) => s.title === 'MATÉRIEL')
    expect(mat.lines.some((l) => l.text === 'MATÉRIEL')).toBe(false)
  })
  it('PL « Materiały: … » en ligne (page de garde) → ## Matériel (label materials polonais)', () => {
    const secs = [
      { title: 'Présentation', kind: 'pelote', ref: null, intro: true, lines: [
        { text: 'Materiały: Resztka czarnej włóczki na oczy, wata do wypełnienia' },
      ] },
    ]
    const ref = extractReference(secs, { n: 1 }).reference
    expect(JSON.stringify(ref)).toMatch(/Resztka czarnej/)
  })
  it('PL « Wymiar: Ok. 22 cm » en ligne (SINGULIER) → rangée du tableau des tailles', () => {
    const secs = [
      { title: 'Présentation', kind: 'pelote', ref: null, intro: true, lines: [
        { text: 'Wymiar: Ok. 22 cm' },
      ] },
    ]
    const ref = extractReference(secs, { n: 1 }).reference
    const s = JSON.stringify(ref)
    expect(s).toMatch(/Wymiar/)
    expect(s).toMatch(/Ok\. 22 cm/)
  })
})

describe('mdlab tailles — vecteurs à tirets (notation DROPS)', () => {
  it('détecte un vecteur à tirets dans une ligne de mesures (bug DROPS)', () => {
    const vecs = findSizeVectors(
      'Chest measurements: 80-88-96-100-110-122-134 cm = 31½"-34⅝"-37¾"-39⅜"-43⅜"-48"-52¾"',
    )
    const v = vecs.find((v) => v.values.length === 7)
    expect(v).toBeTruthy()
    expect(v.values).toEqual(['80', '88', '96', '100', '110', '122', '134'])
  })
  it('détecte un vecteur à tirets dans une ligne de montage de mailles', () => {
    const vecs = findSizeVectors('Cast on 14-17-17-18-19-20-21 stitches')
    const v = vecs.find((v) => v.values.length === 7)
    expect(v).toBeTruthy()
    expect(v.values).toEqual(['14', '17', '17', '18', '19', '20', '21'])
  })
  it('non-régression : la notation parenthèses reste détectée', () => {
    const vecs = findSizeVectors('104 (108) 108 (112) 116 (120)')
    const v = vecs.find((v) => v.values.length === 6)
    expect(v).toBeTruthy()
  })
  it('une simple plage de 2 nombres ne devient pas un vecteur', () => {
    const vecs = findSizeVectors('work 80-88 cm')
    expect(vecs).toEqual([])
  })
  it('applySizeVectors compacte un vecteur à tirets en {{i}}', () => {
    const { t, c } = applySizeVectors('14-17-17-18-19-20-21 stitches', 7)
    expect(t).toBe('{{0}} stitches')
    expect(c[0]).toEqual(['14', '17', '17', '18', '19', '20', '21'])
  })
})

describe('mdlab reference (extractReference) — filets globaux ne volent pas les sections de travail', () => {
  it('bug : une ligne de montage dans une vraie section de travail ne doit pas être volée par le filet global aiguilles (section aiguilles dédiée déjà présente)', () => {
    const workLine = {
      text: 'Cast on 14-17-17-18-19-20-21 stitches with circular needle size 3 MM = US 2.5 and DROPS Safran. Work 2 edge stitches with I-cord',
      consumed: false,
    }
    const sections = [
      { ref: 'aiguilles', kind: 'pelote', lines: [{ text: 'DROPS CIRCULAR NEEDLE SIZE 3 MM = US 2.5: Length 80 cm = 32".', consumed: false }] },
      { ref: null, kind: 'corps', title: 'LEFT FRONT PIECE', intro: false, lines: [workLine] },
    ]
    extractReference(sections, { n: 7 })
    expect(workLine.consumed).toBe(false)
  })

  it('non-régression : sans section aiguilles dédiée, une ligne d’aiguille nue sur une section de garde/pelote reste captée par le filet', () => {
    const coverLine = { text: 'Circular needle 4 mm, 80 cm', consumed: false }
    const sections2 = [{ ref: null, kind: 'pelote', intro: true, lines: [coverLine] }]
    extractReference(sections2, { n: 1 })
    expect(coverLine.consumed).toBe(true)
  })

  it('non-régression : une section échantillon dédiée protège déjà les lignes « gauge » d’une section de travail', () => {
    const workLine2 = { text: '18 sts and 24 rows = 10 cm in stockinette stitch, gauge may vary slightly.', consumed: false }
    const sections3 = [
      { ref: 'echantillon', kind: 'pelote', lines: [{ text: '18 sts and 24 rows = 10 cm in stockinette stitch.', consumed: false }] },
      { ref: null, kind: 'corps', title: 'BACK', intro: false, lines: [workLine2] },
    ]
    extractReference(sections3, { n: 1 })
    expect(workLine2.consumed).toBe(false)
  })

  it('garde B (défense en profondeur) : sans AUCUNE section aiguilles dédiée, une ligne d’aiguille dans une vraie section de travail titrée reste protégée', () => {
    const workLine3 = { text: 'Cast on 90 stitches with needle 4 mm and work in the round.', consumed: false }
    const sections4 = [{ ref: null, kind: 'corps', title: 'BODY', intro: false, lines: [workLine3] }]
    extractReference(sections4, { n: 1 })
    expect(workLine3.consumed).toBe(false)
  })

  it('garde A : une section aiguilles dédiée neutralise le filet global même sur une page de garde', () => {
    const coverLine = { text: 'Circular needle 4 mm, 80 cm', consumed: false }
    const sections5 = [
      { ref: 'aiguilles', kind: 'pelote', lines: [{ text: 'DROPS NEEDLE SIZE 3 MM = US 2.5', consumed: false }] },
      { ref: null, kind: 'pelote', intro: true, lines: [coverLine] },
    ]
    extractReference(sections5, { n: 1 })
    expect(coverLine.consumed).toBe(false)
  })
})

describe('mdlab reference — G3a filet aiguilles élargi (nombre nu, unité optionnelle)', () => {
  // NEEDLE_RE/NEEDLE_BARE_RE non exportés : testés via extractReference sur une section
  // de garde/pelote (le filet global consomme la ligne s'il la reconnaît comme aiguilles).
  const cover = (text) => [{ ref: null, kind: 'pelote', intro: true, lines: [{ text, consumed: false }] }]
  const consumedFor = (text) => {
    const s = cover(text)
    extractReference(s, { n: 1 })
    return s[0].lines[0].consumed
  }
  it('« Aiguilles 2,5 et 3 » (mm implicite) est captée comme aiguilles', () => {
    expect(consumedFor('Aiguilles 2,5 et 3')).toBe(true)
  })
  it('non-régression : « Aiguilles circulaires 3 mm » (unité présente) reste captée', () => {
    expect(consumedFor('Aiguilles circulaires 3 mm')).toBe(true)
  })
  it('garde anti-URL : « … à trois aiguilles : https://youtu.be/… » n’est PAS captée', () => {
    expect(consumedFor('rabat des épaules à trois aiguilles : https://youtu.be/gOe9faasQ7w')).toBe(false)
  })
  it('un lien https seul n’alimente jamais les aiguilles', () => {
    const s = cover('https://youtu.be/gOe9faasQ7w')
    const { reference } = extractReference(s, { n: 1 })
    expect(s[0].lines[0].consumed).toBe(false)
    expect(JSON.stringify(reference)).not.toContain('youtu.be')
  })
})

describe('mdlab reference — G3b filet fil élargi (métrage parenthésé / coloris)', () => {
  // Routage déterministe : une section « materiel » envoie les lignes-fil au champ Fil.
  const materiel = (text) => [{ ref: 'materiel', kind: 'pelote', lines: [{ text, consumed: false }] }]
  const filBlock = (reference) => {
    const tab = reference.tabs.find((t) => t.id === 'materiel')
    const b = tab && tab.blocks.find((x) => x.h3 === 'Fil')
    return (b && b.p ? b.p : []).join('\n')
  }
  const matBlock = (reference) => {
    const tab = reference.tabs.find((t) => t.id === 'materiel')
    const b = tab && tab.blocks.find((x) => x.h3 === 'Matériel')
    return (b && b.p ? b.p : []).join('\n')
  }
  it('« Belle by ArtFil, coloris cabernet (100g/354m) » est signée comme fil', () => {
    const { reference } = extractReference(materiel('Couleur 1 : Belle by ArtFil, coloris cabernet (100g/354m)'), { n: 1 })
    expect(filBlock(reference)).toContain('ArtFil')
    expect(matBlock(reference)).not.toContain('ArtFil')
  })
  it('anti-faux-positif : « boutons 15 mm » n’est PAS un fil', () => {
    const { reference } = extractReference(materiel('boutons 15 mm'), { n: 1 })
    expect(filBlock(reference)).not.toContain('boutons')
    expect(matBlock(reference)).toContain('boutons')
  })
  it('anti-faux-positif : « 100 g de rembourrage » (pas de métrage, pas de coloris) n’est PAS un fil', () => {
    const { reference } = extractReference(materiel('100 g de rembourrage'), { n: 1 })
    expect(filBlock(reference)).not.toContain('rembourrage')
    expect(matBlock(reference)).toContain('rembourrage')
  })
  it('non-régression : un fil déjà signé par YARN_RE (« Laine mérinos 50 g ») reste fil', () => {
    const { reference } = extractReference(materiel('Laine mérinos 50 g'), { n: 1 })
    expect(filBlock(reference)).toContain('mérinos')
  })
})

describe('mdlab segment (kindForTitle) — faux positifs "membre"', () => {
  it('« PATTERN » ne doit pas être classé comme membre (patte est une sous-chaîne)', () => {
    expect(kindForTitle('PATTERN')).not.toBe('membre')
  })
  it('« EXPLANATIONS FOR THE PATTERN » ne doit pas être classé comme membre', () => {
    expect(kindForTitle('EXPLANATIONS FOR THE PATTERN')).not.toBe('membre')
  })
  it('non-régression : un vrai titre de membre reste détecté (\\bpattes?\\b matche encore le mot isolé)', () => {
    expect(kindForTitle('Pattes')).toBe('membre')
    expect(kindForTitle('Bras')).toBe('membre')
  })
})

// Défaut latent (« zéro occurrence dans le corpus ») : deux entrées de
// KIND_KEYWORDS (segment.js, `tete`/`membre`) portaient des alternatives non ancrées —
// « cabeza » matchait l'intérieur d'« enCABEZAdo » (ES « encabezado » = en-tête), et
// « arm(?:e|ar|er)? » matchait « ALARM »/« ALARME » en sous-chaîne. Correctif : frontières
// \b partout + alternative islandaise « ar » (pluriel de « bras ») retirée — l'islandais
// n'existe pas dans le corpus Hobbii 11 langues (da,de,en,es,fr,it,nl,no,pl,sv,fi).
describe('mdlab segment (kindForTitle) — défaut latent vague 6 : ancrage des entrées tete/cabeza et membre/arm(er)', () => {
  it('« ENCABEZADO » (ES, en-tête) n’est plus une section tête (cabeza en sous-chaîne)', () => {
    expect(kindForTitle('ENCABEZADO')).toBeNull()
    expect(kindForTitle('Encabezado')).toBeNull()
  })
  it('« ALARM »/« ALARME » ne sont pas des membres (arm/arme en sous-chaîne)', () => {
    expect(kindForTitle('ALARM')).toBeNull()
    expect(kindForTitle('ALARME')).toBeNull()
  })
  // « ARMAR » : mort pour `membre` (alternative « ar » retirée) ET pour `manche` (le « a » nu
  // de `[äa]rmar` ne servait que le verbe espagnol « armar » — restreint à `ärmar`, qui
  // couvre le suédois sans le verbe ES ; foldEszett ne touche pas aux trémas).
  it('« ARMAR »/« ALARMAR » (ES, assembler) ne sont ni membre ni manche', () => {
    expect(kindForTitle('ARMAR')).toBeNull()
    expect(kindForTitle('ALARMAR')).toBeNull()
  })
  it('non-régression : manches suédoises intactes (ärmar et formes fléchies)', () => {
    expect(kindForTitle('ÄRMAR')).toBe('manche')
    expect(kindForTitle('Ärmar')).toBe('manche')
    expect(kindForTitle('ÄRMARNA')).toBe('manche')
  })
  it('non-régression : titres tête intacts (les frontières \\b n’avalent pas les vrais mots)', () => {
    expect(kindForTitle('Tête')).toBe('tete')
    expect(kindForTitle('TETES')).toBe('tete')
    expect(kindForTitle('Cabeza')).toBe('tete')
    // Pluriel ES que l'ancienne forme non ancrée couvrait en sous-chaîne : conservé via
    // « cabezas? » (convention brazos?/piernas? du tableau).
    expect(kindForTitle('CABEZAS')).toBe('tete')
    expect(kindForTitle('Hovedet')).toBe('tete')
  })
  it('non-régression : titres membre intacts dans les langues de la table', () => {
    expect(kindForTitle('BRAZOS')).toBe('membre')
    expect(kindForTitle('Brazos')).toBe('membre')
    expect(kindForTitle('Beine')).toBe('membre')
    expect(kindForTitle('Arme')).toBe('membre')
    expect(kindForTitle('Armer')).toBe('membre')
    expect(kindForTitle('Bras')).toBe('membre')
    expect(kindForTitle('Pattes')).toBe('membre')
    expect(kindForTitle('Armen')).toBe('membre') // da/no/sv « le bras »
  })
  // « Ł » n'est pas un caractère de mot pour \b : un ancrage `\b[łl]apki\b` ne matcherait
  // plus JAMAIS « Łapki » en tête de chaîne (même angle mort Unicode que « øre », cf. le
  // long commentaire de l'entrée `oreille` dans segment.js) — l'alternative est donc ancrée
  // par lookaround Unicode (?<![\p{L}]), comme « tails » de `queue` et « hem » de `bordure`.
  it('non-régression : « Łapki » (PL, pattes) reste membre malgré l’ancrage (\\b est aveugle devant « Ł »)', () => {
    expect(kindForTitle('Łapki')).toBe('membre')
    expect(kindForTitle('łapki')).toBe('membre')
    expect(kindForTitle('xłapki')).toBeNull()
  })
})

describe('mdlab segment (kindForTitle) — finitions scandinave « afslutning »', () => {
  it('« AFSLUTNING » (da) → finitions', () => {
    expect(kindForTitle('AFSLUTNING')).toBe('finitions')
    expect(kindForTitle('Afslutning')).toBe('finitions')
  })
  it('« Avslutning » (no) → finitions', () => {
    expect(kindForTitle('Avslutning')).toBe('finitions')
  })
  it('non-régression : « montering » (da/no assemblage) reste finitions', () => {
    expect(kindForTitle('MONTERING')).toBe('finitions')
  })
})

describe('mdlab segment (kindForTitle) — « qualité DES fils » pluriel (§ Correctif 2)', () => {
  it('mappe « QUALITE DES FILS » (pluriel FR) → fil', () => {
    expect(kindForTitle('QUALITE DES FILS')).toBe('fil')
    expect(kindForTitle('Qualité des fils')).toBe('fil')
  })
  it('non-régression : « QUALITÉ DU FIL » (singulier) reste fil', () => {
    expect(kindForTitle('QUALITÉ DU FIL')).toBe('fil')
    expect(kindForTitle('Qualité du fil')).toBe('fil')
  })
  it('pluriels IT/ES équivalents → fil', () => {
    expect(kindForTitle('Qualità dei filati')).toBe('fil')
    expect(kindForTitle('Qualità del filato')).toBe('fil')
    expect(kindForTitle('Calidad de los hilos')).toBe('fil')
    expect(kindForTitle('Calidad del hilo')).toBe('fil')
  })
})

describe('mdlab segment (looksLikeTableRow) — G4a garde-titre', () => {
  it('reconnaît une rangée « label + ≥3 nombres à espaces » comme table row', () => {
    expect(looksLikeTableRow('Tour de poitrine 80 84 88 92 96 100 104 110')).toBe(true)
    expect(looksLikeTableRow('Carrure devant 29 30 31 32 32 33 34 35')).toBe(true)
    expect(looksLikeTableRow('Taille (cm) 34 36 38 40 42 44 46 48')).toBe(true)
  })
  it('admet la décimale à virgule (« 74,5 ») et la plage à tiret (« 23-25 »)', () => {
    expect(looksLikeTableRow('A 58 63 65 68 72 74,5 78 81')).toBe(true)
    expect(looksLikeTableRow('Tour de bras 23-25 26 28 30 32 32 33 34')).toBe(true)
  })
  it('un titre sans nombre reste NON table row', () => {
    expect(looksLikeTableRow('AUGMENTATIONS')).toBe(false)
    expect(looksLikeTableRow('Corps du gilet')).toBe(false)
  })
  it('« Rang 3 » (un seul nombre) n’est PAS une table row', () => {
    expect(looksLikeTableRow('Rang 3')).toBe(false)
  })
  it('« Aiguilles 2,5 et 3 » (2 nombres, non consécutifs) n’est PAS une table row', () => {
    expect(looksLikeTableRow('Aiguilles 2,5 et 3')).toBe(false)
  })
  it('isTitleLine ne promeut JAMAIS une table row, même en gras', () => {
    // Sans la garde G4a, `bold` suffirait à en faire un titre → tableau déchiqueté.
    const row = { text: 'Tour de poitrine 80 84 88 92 96 100 104 110', bold: true, size: 11 }
    expect(isTitleLine(row, 11)).toBe(false)
    const rowCaps = { text: 'CARRURE DEVANT 29 30 31 32 32 33 34 35', bold: false, size: 11 }
    expect(isTitleLine(rowCaps, 11)).toBe(false)
  })
  it('non-régression : un vrai titre reste un titre', () => {
    expect(isTitleLine({ text: 'AUGMENTATIONS', bold: true, size: 11 }, 11)).toBe(true)
    expect(isTitleLine({ text: 'Corps du gilet', bold: true, size: 11 }, 11)).toBe(true)
  })
  // Cas réel snowman-coaster-de-623a0c1d : un total de mailles nu, replié
  // par la colonne PDF sur SA PROPRE ligne, parenthèses ET unité collée (« (12 M) »). Le
  // critère « upper » d'isTitleLine (`t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t)`) le
  // classait à tort en titre FORT même sans gras ni grande police : chiffres/parenthèses/
  // espaces ne changent jamais de casse, et l'unité allemande « M » (Masche) est TOUJOURS en
  // majuscule — la ligne entière est donc « déjà en majuscules » au sens de ce test alors
  // qu'aucun mot n'y est pour quoi que ce soit. Deux occurrences réelles (« (12 M) »,
  // « (24 M) ») scindaient en trois un unique corps de rangs.
  it('un total de mailles nu entre parenthèses avec unité collée majuscule n’est JAMAIS un titre', () => {
    expect(isTitleLine({ text: '(12 M)', bold: false, size: 10 }, 10)).toBe(false)
    expect(isTitleLine({ text: '(24 M)', bold: false, size: 10 }, 10)).toBe(false)
  })
  it('non-régression : un titre entre parenthèses SANS chiffre (pas un total) reste un titre (garde discriminante)', () => {
    // La garde ci-dessus est restreinte à la forme « ( chiffres unité ) » EXACTE, chiffres
    // obligatoires — un titre court tout en majuscules entre parenthèses mais SANS chiffre
    // (donc jamais un total de mailles) continue d'être promu.
    expect(isTitleLine({ text: '(HUT)', bold: false, size: 10 }, 10)).toBe(true)
  })
})

describe('mdlab reference (extractReference) — G4b fallback mesures à espaces', () => {
  const mesuresSection = (text) => [
    { ref: 'mesures', kind: 'pelote', lines: [{ text, consumed: false }] },
  ]
  it('extrait « label + exactement n nombres à espaces » en rangée de tailles', () => {
    // findSizeVectors ne capte pas les nombres nus à espaces → sans G4b, ligne jetée.
    const { sizeSub } = extractReference(
      mesuresSection('Tour de poitrine 80 84 88 92 96 100 104 110'),
      { n: 8 },
    )
    expect(sizeSub).toBeTruthy()
    expect(sizeSub.label).toBe('tour de poitrine')
    expect(sizeSub.values).toEqual(['80', '84', '88', '92', '96', '100', '104', '110'])
  })
  it('retire un « cm » traînant et garde « 74,5 » tel quel', () => {
    const { sizeSub } = extractReference(
      mesuresSection('Tour de poitrine 80 84 88 92 96 100 74,5 110 cm'),
      { n: 8 },
    )
    expect(sizeSub.values).toEqual(['80', '84', '88', '92', '96', '100', '74,5', '110'])
  })
  it('nombre de valeurs ≠ n → PAS ajoutée (conditions strictes)', () => {
    const { sizeSub } = extractReference(
      mesuresSection('Tour de poitrine 80 84 88'),
      { n: 8 },
    )
    expect(sizeSub).toBe(null)
  })
  it('une instruction chiffrée (trailing non-numérique) n’est PAS aspirée', () => {
    const { sizeSub } = extractReference(
      mesuresSection('Monter 90 100 110 mailles'),
      { n: 3 },
    )
    expect(sizeSub).toBe(null)
  })
})

describe('mdlab reference (extractReference) — mesures « prose par taille » transposées (retour Alexia, poncho Timeless Twister)', () => {
  // Lignes SOURCES réelles (dump moteur, corpus-web hobbii/crochet/fr) : une ligne PAR
  // TAILLE, préfixée du token détecté par detectSizeLabels (from:'prefix'), portant
  // PLUSIEURS sous-mesures en prose (« Label … valeur unité. Label2 … valeur2 unité. »).
  // Les 3 branches existantes (vecteur multi-valeurs, kv n===1, G4b n nombres en fin de
  // ligne) échouent toutes sur ce format → sizeTable restait vide, la section disparaissait.
  const mesuresSection = (lines) => [
    { ref: 'mesures', kind: 'pelote', lines: lines.map((text) => ({ text, consumed: false })) },
  ]
  const PONCHO_LINES = [
    'S/M: Longueur de la nuque à la pointe env. 56 cm. Largeur de la nuque à l’épaule env. 33 cm.',
    'L/XL: Longueur de la nuque à la pointe env. 63 cm. Largeur de la nuque à l’épaule env. 40.5 cm.',
  ]
  const rowsOf = (reference) => {
    const sizeTab = reference.tabs.find((t) => t.id === 'tailles')
    return sizeTab ? sizeTab.blocks[0].sizeTable.rows : null
  }
  it('fusionne par sous-mesure à travers les lignes transposées par taille → 2 rangées, une valeur par taille', () => {
    const { reference } = extractReference(
      mesuresSection(PONCHO_LINES),
      { n: 2, sizeLabels: ['S/M', 'L/XL'] },
    )
    const rows = rowsOf(reference)
    expect(rows).toHaveLength(2)
    const longueur = rows.find((r) => /Longueur/.test(r.label))
    const largeur = rows.find((r) => /Largeur/.test(r.label))
    expect(longueur).toBeTruthy()
    expect(longueur.values).toEqual(['env. 56 cm', 'env. 63 cm'])
    expect(largeur).toBeTruthy()
    expect(largeur.values).toEqual(['env. 33 cm', 'env. 40.5 cm'])
  })
  it('le tableau des tailles émis porte bien l’en-tête | mesure | S/M | L/XL | (via reader.sizeLabels côté serializer)', () => {
    const { reference } = extractReference(
      mesuresSection(PONCHO_LINES),
      { n: 2, sizeLabels: ['S/M', 'L/XL'] },
    )
    const rows = rowsOf(reference)
    expect(rows).toHaveLength(2)
  })
  it('mesure UNIQUE en prose (n=1) : G4d capte « Longueur … env. 56 cm » (env. rattaché à la valeur)', () => {
    const { reference } = extractReference(
      mesuresSection(['Longueur de la nuque à la pointe env. 56 cm.']),
      { n: 1 },
    )
    // G4d (cycle 13) : une mesure unique en prose sous ref='mesures' est captée ; le
    // libellé passe par SUBMEASURE_VALUE_RE, qui rattache « env. » à la VALEUR.
    expect(rowsOf(reference)).toEqual([{ label: 'Longueur de la nuque à la pointe', values: ['env. 56 cm'] }])
  })
})

describe('mdlab reference (extractReference) — Step 4 : continuation Échantillon sous section ref=mesures (retour Alexia, poncho)', () => {
  const mesuresSection = (lines) => [
    { ref: 'mesures', kind: 'pelote', lines: lines.map((text) => ({ text, consumed: false })) },
  ]
  it('« Echantillon: » (étiquette nue) suivie de sa valeur sur la ligne d’après remonte en ## Échantillon même sous ref=mesures', () => {
    const { reference } = extractReference(
      mesuresSection([
        'S/M: Longueur de la nuque à la pointe env. 56 cm.',
        'L/XL: Longueur de la nuque à la pointe env. 63 cm.',
        'Echantillon:',
        '10 x 10 cm = 21 m x 13 rangs',
      ]),
      { n: 2, sizeLabels: ['S/M', 'L/XL'] },
    )
    const matTab = reference.tabs.find((t) => t.id === 'materiel')
    expect(matTab).toBeTruthy()
    const gaugeBlock = matTab.blocks.find((b) => b.h3 === 'Échantillon')
    expect(gaugeBlock).toBeTruthy()
    expect(gaugeBlock.p.join('\n')).toMatch(/10 x 10 cm = 21 m x 13 rangs/)
  })
})

describe('mdlab reference (extractReference) — Step 4 bis : ordre inversé Échantillon avant tailles (retour revue #2b)', () => {
  // Régression trouvée en revue : la garde de continuation gauge sous ref='mesures'
  // (Step 4 ci-dessus) était POSITIONNELLE — elle avalait TOUTE ligne suivant
  // « Echantillon: » tant que block==='gauge', sans regarder son contenu. Aujourd'hui
  // les lignes de taille transposées (« S/M: … ») viennent TOUJOURS avant « Echantillon: »
  // dans le corpus, donc ça passait. Mais si un patron place « Echantillon: » AVANT les
  // lignes de taille, la ligne « S/M: … » serait avalée comme continuation gauge au lieu
  // d'atteindre la branche G4c → sizeTable vide. La garde doit être basée sur le CONTENU
  // (GAUGE_RE : ressemble à une valeur d'échantillon) et exclure explicitement toute ligne
  // préfixée d'un token de taille connu (sizePrefixRe), pas sur la position dans le flux.
  const mesuresSection = (lines) => [
    { ref: 'mesures', kind: 'pelote', lines: lines.map((text) => ({ text, consumed: false })) },
  ]
  it('« Echantillon: » + sa valeur AVANT les lignes de taille transposées → ## Échantillon ET sizeTable complet', () => {
    const { reference } = extractReference(
      mesuresSection([
        'Echantillon:',
        '10 x 10 cm = 21 m x 13 rangs',
        'S/M: Longueur de la nuque à la pointe env. 56 cm. Largeur de la nuque à l’épaule env. 33 cm.',
        'L/XL: Longueur de la nuque à la pointe env. 63 cm. Largeur de la nuque à l’épaule env. 40.5 cm.',
      ]),
      { n: 2, sizeLabels: ['S/M', 'L/XL'] },
    )
    const matTab = reference.tabs.find((t) => t.id === 'materiel')
    expect(matTab).toBeTruthy()
    const gaugeBlock = matTab.blocks.find((b) => b.h3 === 'Échantillon')
    expect(gaugeBlock).toBeTruthy()
    expect(gaugeBlock.p.join('\n')).toMatch(/10 x 10 cm = 21 m x 13 rangs/)

    const sizeTab = reference.tabs.find((t) => t.id === 'tailles')
    expect(sizeTab).toBeTruthy()
    const rows = sizeTab.blocks[0].sizeTable.rows
    expect(rows).toHaveLength(2)
    const longueur = rows.find((r) => /Longueur/.test(r.label))
    const largeur = rows.find((r) => /Largeur/.test(r.label))
    expect(longueur).toBeTruthy()
    expect(longueur.values).toEqual(['env. 56 cm', 'env. 63 cm'])
    expect(largeur).toBeTruthy()
    expect(largeur.values).toEqual(['env. 33 cm', 'env. 40.5 cm'])
  })
})

describe('mdlab segment — corps « Row N » collé aux abréviations (bug P0 crochet indie)', () => {
  const B = (text, y, size = 11) => ({ text, y, size, bold: true })
  it('scinde la section abbr dès le premier « Row N » : les abréviations restent des abréviations, les rangs deviennent une section de travail', () => {
    const pages = [
      [
        B('ABBRÉVIATIONS', 700),
        L('ch = chain', 690),
        L('sc = single crochet', 680),
        L('dc = double', 670),
        L('Row 1: 6 sc into ring', 660),
        L('Row 2: sc in each', 650),
      ],
    ]
    const secs = segmentSections(pages)
    const abbr = secs.find((s) => s.ref === 'abbr')
    expect(abbr).toBeTruthy()
    // Les 3 abréviations sont bien dans la section abbr…
    expect(abbr.lines.map((l) => l.text)).toEqual(['ch = chain', 'sc = single crochet', 'dc = double'])
    // …et AUCUN « Row » n'y figure.
    expect(abbr.lines.some((l) => l.text.startsWith('Row'))).toBe(false)
    // Une section de travail (ref null, titre non vide « Instructions ») reçoit les
    // rangs, dans l'ordre. Le titre non vide est requis : un « ## » nu n'est pas relu
    // par mdToPattern (section perdue au round-trip).
    const work = secs.find((s) => s.ref === null && s.lines.some((l) => l.text.startsWith('Row')))
    expect(work).toBeTruthy()
    expect(work.title).toBe('Instructions')
    expect(work.lines.map((l) => l.text)).toEqual(['Row 1: 6 sc into ring', 'Row 2: sc in each'])
  })
  it('non-régression : une section abbr SANS aucune ligne « Row N » n’est PAS scindée', () => {
    const pages = [
      [
        B('ABBRÉVIATIONS', 700),
        L('ch = chain', 690),
        L('sc = single crochet', 680),
        L('dc = double', 670),
      ],
    ]
    const secs = segmentSections(pages)
    const abbrs = secs.filter((s) => s.ref === 'abbr')
    expect(abbrs.length).toBe(1)
    expect(abbrs[0].lines.map((l) => l.text)).toEqual(['ch = chain', 'sc = single crochet', 'dc = double'])
    // Aucune section de travail parasite créée.
    expect(secs.filter((s) => s.ref === null).length).toBe(0)
  })
})

describe('mdlab assemble — titre de couverture = titre du document (bug Jumper49 : intro enfouie)', () => {
  const T = (text, y, size = 10, bold = false) => ({ text, x: 0, y, size, bold })
  const pages = [
    [ // page 0 (couverture)
      T('Jumper49', 800, 22, true),
      T('Jumper49 est un patron de top qui allie coupe vintage et rayures.', 770),
      T('Il est inspiré d’un modèle gratuit de 1949.', 755),
    ],
    [ // page 1
      T('ÉCHANTILLON', 800),
      T('24 m. x 36 rgs pour un échantillon de 10x10 cm.', 780),
      T('MONTAGE', 750),
      T('Monter 100 m. avec vos aiguilles.', 735),
      T('Tricoter en jersey pendant 10 cm.', 720),
    ],
  ]

  it('sanity du fixture : detectTitle reconnaît « Jumper49 » comme titre du document', () => {
    expect(detectTitle(pages)).toBe('Jumper49')
  })

  it('l’intro n’est plus enfouie dans une section « Jumper49 » : elle ressort en tête, en Présentation', () => {
    const { reader } = buildReaderFromPages(pages)
    // Plus de section titrée « Jumper49 » (titre redondant avec le doc, absorbé).
    expect(reader.sections.some((s) => s.title === 'Jumper49')).toBe(false)
    // La 1re section est la Présentation, et porte bien la description captée.
    expect(reader.sections[0].title).toBe('Présentation')
    expect(reader.sections[0].steps.some((st) => st.t.includes('Jumper49 est un patron'))).toBe(true)
  })

  it('non-régression : un titre de section qui n’est PAS un doublon du titre du doc reste une section de travail normale', () => {
    const pagesNorm = [
      [
        T('MonPatron', 800, 30, true),
        T('Un pull classique en jersey.', 770),
        T('MONTAGE', 750),
        T('Monter 80 m. avec vos aiguilles.', 735),
        T('Tricoter en jersey pendant 10 cm.', 720),
      ],
    ]
    const { reader } = buildReaderFromPages(pagesNorm)
    const montage = reader.sections.find((s) => s.title === 'MONTAGE')
    expect(montage).toBeTruthy()
    expect(montage.kind).toBe('autre')
    expect(montage.steps.length).toBeGreaterThan(0)
  })
})


describe('mdlab reference — SM2 abréviations à séparateur tiret demi-cadratin/cadratin', () => {
  // Séparateurs testés en escapes explicites pour lever toute ambiguïté de glyphe :
  // – = en dash « – », — = em dash « — ».
  const abbrOf = (texts) => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: texts.map((text) => ({ text, consumed: false })) }]
    const { reference } = extractReference(sections, { n: 1 })
    return reference.abbr
  }
  it('« ch – chain stitch » (en dash) est reconnue comme abréviation {ch: chain stitch}', () => {
    expect(abbrOf(['ch – chain stitch']).ch).toBe('chain stitch')
  })
  it('« dc — double crochet » (em dash) est reconnue comme abréviation', () => {
    expect(abbrOf(['dc — double crochet']).dc).toBe('double crochet')
  })
  it('« 80–88 » (plage numérique, sans espaces) n’est PAS une abréviation', () => {
    expect(Object.keys(abbrOf(['80–88'])).length).toBe(0)
  })
  it('« 80 – 88 » (plage avec espaces) n’est PAS une abréviation (clé numérique / déf non-lettre)', () => {
    expect(Object.keys(abbrOf(['80 – 88'])).length).toBe(0)
  })
  it('« 12 – mois » (clé purement numérique, déf lettre) est rejetée par la garde clé-numérique', () => {
    expect(Object.keys(abbrOf(['12 – mois'])).length).toBe(0)
  })
  it('non-régression : « ml = maille en l’air » (séparateur = historique) reste reconnue', () => {
    expect(abbrOf(['ml = maille en l’air']).ml).toBe('maille en l’air')
  })
  it('non-régression : « m : maille » (séparateur : historique) reste reconnue', () => {
    expect(abbrOf(['m : maille']).m).toBe('maille')
  })
})

describe('mdlab reference — SM2 tiret : le scan global d’abréviations reste sûr', () => {
  it('trois « Row N — … » consécutives (section de travail) : NI consommées NI prises pour des abréviations', () => {
    const lines = [
      { text: 'Row 1 — knit all stitches', consumed: false },
      { text: 'Row 2 — purl all stitches', consumed: false },
      { text: 'Row 3 — knit all stitches', consumed: false },
    ]
    const sections = [{ ref: null, kind: 'corps', title: 'BODY', intro: false, lines }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(lines.every((l) => l.consumed === false)).toBe(true)
    expect(Object.keys(reference.abbr).length).toBe(0)
  })
  it('prose « Mot — phrase » (Note/Tip/Warning) : le scan global de bloc ne la vole PAS (tiret réservé à la section abbr dédiée)', () => {
    // Faux positif que le scan de bloc CONSOMMERAIT s’il acceptait le tiret : 3 lignes de
    // prose à clé courte + phrase. Le tiret n’étant ajouté qu’au chemin par-ligne (section
    // abbr dédiée), ces lignes restent dans leur section de travail.
    const lines = [
      { text: 'Note — read the chart carefully', consumed: false },
      { text: 'Tip — use stitch markers', consumed: false },
      { text: 'Warning — check your gauge', consumed: false },
    ]
    const sections = [{ ref: null, kind: 'corps', title: 'BODY', intro: false, lines }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(lines.every((l) => l.consumed === false)).toBe(true)
    expect(Object.keys(reference.abbr).length).toBe(0)
  })
  it('les abréviations à tiret ne sont reconnues QUE dans une section abbr dédiée, pas dans une section quelconque', () => {
    const dashLines = [
      { text: 'ch – chain stitch', consumed: false },
      { text: 'sc – single crochet', consumed: false },
      { text: 'dc – double crochet', consumed: false },
    ]
    // section non dédiée : pas de capture globale (prudence, chemin CONSUMER)
    const nonDedie = extractReference([{ ref: null, kind: 'pelote', intro: false, lines: dashLines.map((l) => ({ ...l })) }], { n: 1 })
    expect(Object.keys(nonDedie.reference.abbr).length).toBe(0)
    // section abbr dédiée : capturées
    const dedie = extractReference([{ ref: 'abbr', kind: 'pelote', lines: dashLines.map((l) => ({ ...l })) }], { n: 1 })
    expect(dedie.reference.abbr.ch).toBe('chain stitch')
    expect(dedie.reference.abbr.dc).toBe('double crochet')
  })
})

describe('mdlab reference — SM1b marqueur de rang COMPACT « Tn: » n’est pas une abréviation (bug baby-unicorn)', () => {
  it('trois « Tn: … » consécutives (corps amigurumi) : NI consommées NI prises pour des abréviations (préservation du corps)', () => {
    const lines = [
      { text: 'T1: 6 ms dans le cercle (6)', consumed: false },
      { text: 'T2: [1 aug] x6 (12)', consumed: false },
      { text: 'T3: [1 ms, 1 aug] x6 (18)', consumed: false },
    ]
    const sections = [{ ref: null, kind: 'tete', title: 'TÊTE', intro: false, lines }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(lines.every((l) => l.consumed === false)).toBe(true)
    expect(Object.keys(reference.abbr).length).toBe(0)
  })
  it('marqueurs de rang compacts à plage « T7-12: … » : ni consommés ni abréviations', () => {
    const lines = [
      { text: 'T4-16: 1 ms dans chaque m (12 tours, 18)', consumed: false },
      { text: 'R1: knit', consumed: false },
      { text: 'Rnd 3: sc around', consumed: false },
    ]
    const sections = [{ ref: null, kind: 'corps', title: 'BODY', intro: false, lines }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(lines.every((l) => l.consumed === false)).toBe(true)
    expect(Object.keys(reference.abbr).length).toBe(0)
  })
  it('non-régression : « ml – maille en l’air » RESTE une abréviation dans une section abbr dédiée', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [{ text: 'ml – maille en l’air', consumed: false }] }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(reference.abbr.ml).toBe('maille en l’air')
  })
  it('non-régression : un marqueur de rang compact dans une section abbr dédiée n’est PAS ajouté aux abréviations', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml – maille en l’air', consumed: false },
      { text: 'T1: 6 ms dans le cercle (6)', consumed: false },
    ] }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(reference.abbr.ml).toBe('maille en l’air')
    expect(reference.abbr.T1).toBeUndefined()
  })
  it('fix 3 : un total multi-tailles « dos = - (-) - (477) 513 (545) 589 m au total » n’est PAS une abréviation', () => {
    const lines = [
      { text: 'dos = - (-) - (-) - (477) 513 (545) 589 m au total.', consumed: false },
      { text: 'devant = - (-) - (-) - (477) 513 (545) 589 m au total.', consumed: false },
      { text: 'manche = 60 (66) 72 (78) 84 (90) 96 m au total.', consumed: false },
    ]
    const sections = [{ ref: null, kind: 'corps', title: 'MONTAGE', intro: false, lines }]
    const { reference } = extractReference(sections, { n: 7 })
    expect(lines.every((l) => l.consumed === false)).toBe(true)
    expect(Object.keys(reference.abbr).length).toBe(0)
  })
  it('fix 3 non-régression : « inc – increase 2 sts » (déf avec un chiffre mais pas un vecteur) RESTE une abréviation', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [{ text: 'inc – increase 2 sts', consumed: false }] }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(reference.abbr.inc).toBe('increase 2 sts')
  })
})

describe('mdlab reference — garde de forme (déf trop longue / finit par « : ») : « Tutoriel… » et « Taille S/M: … » ne deviennent pas des abréviations et survivent en note (retour Alexia, poncho Timeless Twister)', () => {
  const TUTO = 'Tutoriel – Le pas à pas en photo se trouve à la fin du tutoriel écrit:'
  const TAILLE = 'Taille S/M: Répéter en utilisant la méthode indiquée des tours 4 à 10 au total 5 fois. Crocheter les tours 4 à 8 une fois de plus.'

  it('(a) « Tutoriel – … écrit: » dans une section abbr NE produit PAS d’entrée d’abréviation « Tutoriel »', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [{ text: TUTO, consumed: false }] }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(reference.abbr.Tutoriel).toBeUndefined()
  })

  it('(b) « Taille S/M: <consigne longue> » dans une section abbr NE produit PAS d’entrée d’abréviation « Taille S/M »', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [{ text: TAILLE, consumed: false }] }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(reference.abbr['Taille S/M']).toBeUndefined()
  })

  it('(c) non-régression : « ml – maille en l’air » (vraie abréviation, tiret cadratin) reste reconnue', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [{ text: 'ml – maille en l’air', consumed: false }] }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(reference.abbr.ml).toBe('maille en l’air')
  })

  it('(c bis) non-régression : « Br Rar – Bride relief arrière » (définition 3 mots, corpus réel) reste reconnue', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [{ text: 'Br Rar – Bride relief arrière', consumed: false }] }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(reference.abbr['Br Rar']).toBe('Bride relief arrière')
  })

  it('(d) la phrase « Tutoriel… » SURVIT en note visible dans le reader — pas seulement absente des abréviations (retour Alexia : elle disparaissait totalement)', () => {
    const T = (text, y, size = 10, bold = false) => ({ text, x: 0, y, size, bold })
    const pages = [[
      T('Poncho Timeless – Twister', 800, 22, true),
      T('Abréviations', 760, 14, true),
      T('ml – maille en l’air', 740),
      T('m – maille', 725),
      T(TUTO, 710),
      T(TAILLE, 695),
      T('MONTAGE', 660, 14, true),
      T('Monter 60 mailles.', 640),
    ]]
    const { reader } = buildReaderFromPages(pages)
    const allText = JSON.stringify(reader)
    // survit quelque part en texte visible du reader…
    expect(allText).toContain('Le pas à pas en photo se trouve à la fin du tutoriel')
    // …mais pas comme entrée d’abréviation.
    expect(reader.reference.abbr.Tutoriel).toBeUndefined()
    expect(reader.reference.abbr['Taille S/M']).toBeUndefined()
  })

  it('(e) deux phrases de prose de mise en route SANS clé/déf ni tiret (« Commencer en prenant… », « Pour la taille L/XL… ») survivent en note, sans devenir des abréviations, sans casser la vraie abréviation « ml » (retour Alexia, poncho — les phrases disparaissaient silencieusement, non routées par execAbbrLine ni formRejectedAbbrLine)', () => {
    const PROSE1 = 'Commencer en prenant le fil au centre de la pelote, pour aller de l’intérieur vers l’extérieur.'
    const PROSE2 = 'Pour la taille L/XL continuer avec la seconde pelote depuis l’extérieur vers l’intérieur.'
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml: maille en l’air', consumed: false },
      { text: PROSE1, consumed: false },
      { text: PROSE2, consumed: false },
    ] }]
    const { reference, notes } = extractReference(sections, { n: 1 })
    expect(reference.abbr.ml).toBe('maille en l’air')
    expect(notes.join('\n')).toContain('Commencer en prenant le fil')
    expect(notes.join('\n')).toContain('seconde pelote depuis l’extérieur')
    // et le reader bout-en-bout (comme (d)) : les deux phrases survivent en texte visible.
    const T = (text, y, size = 10, bold = false) => ({ text, x: 0, y, size, bold })
    const pages = [[
      T('Poncho Timeless – Twister', 800, 22, true),
      T('Abréviations', 760, 14, true),
      T('ml: maille en l’air', 740),
      T(PROSE1, 725),
      T(PROSE2, 710),
      T('MONTAGE', 660, 14, true),
      T('Monter 60 mailles.', 640),
    ]]
    const { reader } = buildReaderFromPages(pages)
    const allText = JSON.stringify(reader)
    expect(allText).toContain('Commencer en prenant le fil')
    expect(allText).toContain('seconde pelote depuis l’extérieur')
    expect(reader.reference.abbr.ml).toBe('maille en l’air')
  })

  it('(e bis) non-régression : un fragment court nu (« env. 33 cm ») n’est PAS routé en note par ce nouveau chemin', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml: maille en l’air', consumed: false },
      { text: 'env. 33 cm', consumed: false },
    ] }]
    const { notes } = extractReference(sections, { n: 1 })
    expect(notes.join('\n')).not.toContain('env. 33 cm')
  })

  it('(e ter) non-régression : un rang numéroté nu (« 12. Tricoter 6 mailles endroit » sans mot de rang) n’est PAS routé en note par ce nouveau chemin', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml: maille en l’air', consumed: false },
      { text: '12. Tricoter 6 mailles endroit', consumed: false },
    ] }]
    const { notes } = extractReference(sections, { n: 1 })
    expect(notes.join('\n')).not.toContain('Tricoter 6 mailles endroit')
  })

  it('(e quater) non-régression corpus (dino-pram-chain, decorative-pumpkins) : une abréviation « clé - déf » à tiret ASCII simple (≥4 mots, angle mort préexistant du glossaire, hors périmètre ici) n’est PAS routée en note', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml: maille en l’air', consumed: false },
      { text: 'Sl st - slip stitch', consumed: false },
      { text: 'Hdc - Half double crochet', consumed: false },
    ] }]
    const { notes } = extractReference(sections, { n: 1 })
    expect(notes.join('\n')).not.toContain('slip stitch')
    expect(notes.join('\n')).not.toContain('Half double crochet')
  })

  it('(e quinquies) non-régression corpus (penny-the-panda) : la queue orpheline d’une définition repliée par reflow, SANS ponctuation finale (« Maschen am Ende der Runde »), n’est PAS routée en note', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml: maille en l’air', consumed: false },
      { text: '(xx) = Klammern nach der Runde = Anzahl', consumed: false },
      { text: 'Maschen am Ende der Runde', consumed: false },
    ] }]
    const { notes } = extractReference(sections, { n: 1 })
    expect(notes.join('\n')).not.toContain('Maschen am Ende der Runde')
  })

  it('(f) Finding 1 (revue) : une phrase de prose à tiret ASCII en tête, à définition MULTI-PHRASES (glossaire-like faux via isNonGlossaryDef, comme le cousin ABBR_DASH_LINE_RE/formRejectedAbbrLine), survit en note plutôt que de disparaître', () => {
    const PROSE = 'Astuce - Bien serrer le premier rang. Cela donne un joli bord fini.'
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml: maille en l’air', consumed: false },
      { text: PROSE, consumed: false },
    ] }]
    const { reference, notes } = extractReference(sections, { n: 1 })
    expect(reference.abbr.ml).toBe('maille en l’air')
    expect(reference.abbr.Astuce).toBeUndefined()
    expect(notes.join('\n')).toContain('Bien serrer le premier rang')
  })

  it('(f bis) « Sl st - slip stitch » (tiret ASCII espacé) EST captée comme abréviation — angle mort COMBLÉ (cycle 10, unicorn-pillow)', () => {
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml: maille en l’air', consumed: false },
      { text: 'Sl st - slip stitch', consumed: false },
    ] }]
    const { reference } = extractReference(sections, { n: 1 })
    expect(reference.abbr.ml).toBe('maille en l’air')
    expect(reference.abbr['Sl st']).toBe('slip stitch')
  })

  it('(f ter) limite assumée (fixe le comportement ACTUEL, non corrigée ici) : une phrase de prose à tiret ASCII à définition À UNE SEULE PHRASE (« Astuce - bien serrer le premier rang pour un joli bord fini. ») reste glossaire-like au sens d’isNonGlossaryDef (pas de « : » final, pas de 2e phrase) et N’EST PAS récupérée en note — même angle mort que Finding 2 (isNonGlossaryDef discrimine la STRUCTURE, pas la longueur ; cf. commentaire « Ggt = … » l.56-63)', () => {
    const PROSE_UNE_PHRASE = 'Astuce - bien serrer le premier rang pour un joli bord fini.'
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml: maille en l’air', consumed: false },
      { text: PROSE_UNE_PHRASE, consumed: false },
    ] }]
    const { reference, notes } = extractReference(sections, { n: 1 })
    expect(reference.abbr.ml).toBe('maille en l’air')
    expect(notes.join('\n')).not.toContain('bien serrer le premier rang')
  })

  it('(g) Finding 2 (revue) — limite assumée (Lot 2) : une phrase de mise en route SANS ponctuation finale n’est PAS récupérée (SENTENCE_END_RE reste un garde-fou porteur, cf. penny-the-panda ; comportement ACTUEL figé, PAS relâché ici)', () => {
    const PROSE_SANS_PONCTUATION = 'Commencer en prenant le fil au centre de la pelote pour aller vers l’extérieur'
    const sections = [{ ref: 'abbr', kind: 'pelote', lines: [
      { text: 'ml: maille en l’air', consumed: false },
      { text: PROSE_SANS_PONCTUATION, consumed: false },
    ] }]
    const { reference, notes } = extractReference(sections, { n: 1 })
    expect(reference.abbr.ml).toBe('maille en l’air')
    expect(notes.join('\n')).not.toContain('Commencer en prenant le fil')
  })
})

describe('mdlab tailles — garde multiplicateur crochet « xN (compte) » (bug baby-unicorn tailles inventées)', () => {
  it('« [1 aug] x6 (12) » (répétition ×6 + compte de mailles) ne produit PAS de vecteur 2-tailles', () => {
    const vecs = findSizeVectors('T2: [1 aug] x6 (12)')
    expect(vecs.filter((v) => v.values.length === 2).length).toBe(0)
  })
  it('« x 3 (9) » (multiplicateur avec espace) ne produit pas de vecteur', () => {
    const vecs = findSizeVectors('T2: [1 ms, 1 aug] x 3 (9)')
    expect(vecs.filter((v) => v.values.length === 2).length).toBe(0)
  })
  it('amigurumi taille unique (tours « Tn: … xN (n) ») : aucune taille inventée', () => {
    const L = (text) => ({ text, size: 10, bold: false, x: 0, y: 0 })
    const pages = [[
      L('T1: 6 ms dans le cercle (6)'),
      L('T2: [1 aug] x6 (12)'),
      L('T3: [1 ms, 1 aug] x6 (18)'),
      L('T4: [2 ms, 1 aug] x6 (24)'),
      L('T5: [3 ms, 1 aug] x6 (30)'),
    ]]
    const { labels, from } = detectSizeLabels(pages)
    expect(labels).toEqual([])
    expect(from).toBe('none')
  })
  it('non-régression : un vrai vecteur numérique « 104 (108) » reste détecté', () => {
    const vecs = findSizeVectors('Monter 104 (108) mailles')
    expect(vecs.some((v) => v.values.length === 2 && v.values[0] === '104' && v.values[1] === '108')).toBe(true)
  })
})

describe('mdlab reference — Au2 plafond des fils saturé par les coloris', () => {
  const filBlock = (reference) => {
    const tab = reference.tabs.find((t) => t.id === 'materiel')
    const b = tab && tab.blocks.find((x) => x.h3 === 'Fil')
    return (b && b.p ? b.p : []).join('\n')
  }
  it('7 lignes-coloris n’écrasent plus la marque, la fibre ni le métrage du fil', () => {
    const lines = []
    for (let i = 1; i <= 7; i++) lines.push({ text: `1 (2) 3 pelote(s) de coul. 0${i}`, consumed: false })
    lines.push({ text: 'Laine Merino Extra Fine, DROPS', consumed: false })
    lines.push({ text: '100% coton', consumed: false })
    lines.push({ text: '50 g = 160 m', consumed: false })
    const sections = [{ ref: 'fil', kind: 'pelote', lines }]
    const { reference } = extractReference(sections, { n: 1 })
    const fil = filBlock(reference)
    expect(fil).toContain('Laine Merino Extra Fine')
    expect(fil).toContain('100% coton')
    expect(fil).toContain('50 g = 160 m')
    // et les coloris restent présents (borne 16, pas jetés)
    expect(fil).toContain('de coul. 07')
  })
  it('les 7 lignes-coloris ne comptent pas dans le sous-plafond de 8 fils de qualité', () => {
    const lines = []
    for (let i = 1; i <= 7; i++) lines.push({ text: `1 (2) 3 pelote(s) de coul. 0${i}`, consumed: false })
    // 8 lignes de qualité doivent toutes tenir malgré les 7 coloris devant
    for (let i = 1; i <= 8; i++) lines.push({ text: `Qualité fil numero ${i} en pure laine`, consumed: false })
    const sections = [{ ref: 'fil', kind: 'pelote', lines }]
    const { reference } = extractReference(sections, { n: 1 })
    const fil = filBlock(reference)
    expect(fil).toContain('Qualité fil numero 8 en pure laine')
  })
  it('non-régression : un « ## Fil » normal (peu de lignes) reste intact', () => {
    const lines = [
      { text: 'Laine mérinos, 50 g', consumed: false },
      { text: '100% laine', consumed: false },
    ]
    const sections = [{ ref: 'fil', kind: 'pelote', lines }]
    const { reference } = extractReference(sections, { n: 1 })
    const fil = filBlock(reference)
    expect(fil).toContain('Laine mérinos, 50 g')
    expect(fil).toContain('100% laine')
  })
})

describe('mdlab assemble — parseAuthorLine (marque en tête « <Marque> Design » #7 + collection parasite Fo2)', () => {
  it('capte « DROPS Design: Modell w-767 » → jette le n° de modèle', () => {
    expect(parseAuthorLine('DROPS Design: Modell w-767')).toBe('DROPS Design')
  })
  it('capte « DROPS Design » seul', () => {
    expect(parseAuthorLine('DROPS Design')).toBe('DROPS Design')
  })
  it('capte « Garnstudio Design » et « Hobbii Design » seuls', () => {
    expect(parseAuthorLine('Garnstudio Design')).toBe('Garnstudio Design')
    expect(parseAuthorLine('Hobbii Design')).toBe('Hobbii Design')
  })
  it('retire la collection/saison parasite après « Design: X | … » (année)', () => {
    expect(parseAuthorLine('Design: 2WorldsTog | Garland, Autumn 2024')).toBe('2WorldsTog')
  })
  it('ne capte PAS une phrase quelconque contenant « design »', () => {
    expect(parseAuthorLine('This design is really nice to knit')).toBeNull()
    expect(parseAuthorLine('Le design de ce châle est original')).toBeNull()
  })
  // NON-RÉGRESSION des cas existants (doivent rester verts après ajout des branches)
  it('non-régression : cas « | Hobbii Design », « Design: X », non-auteur', () => {
    expect(parseAuthorLine('Design: Libère tes mailles | Hobbii Design')).toBe('Libère tes mailles | Hobbii Design')
    expect(parseAuthorLine('Miss Beetle | Hobbii Design')).toBe('Miss Beetle | Hobbii Design')
    expect(parseAuthorLine('Designer: Tine Sommer Hansen')).toBe('Tine Sommer Hansen')
    expect(parseAuthorLine('Tour 1: 6 ms dans le cercle')).toBeNull()
  })
  it('non-régression : un vrai co-auteur « X | Y » sans année/saison n’est pas amputé', () => {
    expect(parseAuthorLine('Design: Anna | Marie Dupont')).toBe('Anna | Marie Dupont')
  })
})

describe('mdlab assemble — parseAuthorLine (préfixes de conception multilingues + « Hobbii Design, <Nom> »)', () => {
  it('capte le préfixe fr « Conception : X »', () => {
    expect(parseAuthorLine('Conception : Marianne Nørbo')).toBe('Marianne Nørbo')
  })
  it('capte le préfixe es « Diseño: X »', () => {
    expect(parseAuthorLine('Diseño: Ana')).toBe('Ana')
  })
  it('capte les autres formes « préfixe : X » (it/nl)', () => {
    expect(parseAuthorLine('Progetto: Luca Rossi')).toBe('Luca Rossi')
    expect(parseAuthorLine('Ontwerp: Sanne de Vries')).toBe('Sanne de Vries')
  })
  it('capte les formes « <verbe> <connecteur> X » (fr/es/it/nl/de/da-no)', () => {
    expect(parseAuthorLine('Conçu par Camille Roy')).toBe('Camille Roy')
    expect(parseAuthorLine('Diseñado por Ana')).toBe('Ana')
    expect(parseAuthorLine('Progettato da Luca Rossi')).toBe('Luca Rossi')
    expect(parseAuthorLine('Ontworpen door Sanne')).toBe('Sanne')
    expect(parseAuthorLine('Entworfen von Klara Meyer')).toBe('Klara Meyer')
    expect(parseAuthorLine('Designet af Stina Frigaard')).toBe('Stina Frigaard')
    expect(parseAuthorLine('Designet av Nora Berg')).toBe('Nora Berg')
  })
  it('capte la designer nommée après « … Hobbii Design, <Nom> » (pied de page)', () => {
    const a = parseAuthorLine('Tajo - Hobbii Design, Stina Frigaard')
    expect(a).toContain('Stina Frigaard')
    expect(a).toBe('Stina Frigaard | Hobbii Design')
  })
  // PDF réel « Metorit - Asymmetrical Shawl » (es, hobbii) : le pied de page complet
  // est « Metorit - Hobbii Design, Sys Fredens - Copyright © 2020   Página 1 » — le
  // nom de la designer n'est PAS en fin de ligne (suivi de « - Copyright © … »), donc
  // l'ancien HOBBII_COMMA_RE (ancré `$` juste après le nom) ne matchait pas du tout.
  it('capte la designer même suivie de « - Copyright © … » (pied de page Metorit, nom PAS en fin de ligne)', () => {
    const a = parseAuthorLine('Metorit - Hobbii Design, Sys Fredens - Copyright © 2020   Página 1')
    expect(a).toBe('Sys Fredens | Hobbii Design')
  })
  it('ne capte PAS une phrase de prose contenant « conception »', () => {
    expect(parseAuthorLine('La conception de ce châle a demandé plusieurs semaines')).toBeNull()
    expect(parseAuthorLine('Nous avons soigné la conception du modèle')).toBeNull()
  })
  it('non-régression : les cas anglais/marque restent inchangés', () => {
    expect(parseAuthorLine('Design: Libère tes mailles | Hobbii Design')).toBe('Libère tes mailles | Hobbii Design')
    expect(parseAuthorLine('Designer: Tine Sommer Hansen')).toBe('Tine Sommer Hansen')
    expect(parseAuthorLine('DROPS Design: Modell w-767')).toBe('DROPS Design')
    expect(parseAuthorLine('Design: 2WorldsTog | Garland, Autumn 2024')).toBe('2WorldsTog')
    expect(parseAuthorLine('Tour 1: 6 ms dans le cercle')).toBeNull()
  })
})

describe('mdlab assemble — parseAuthorLine (plafond de capture 40→70, bug holiday-ornament-es-c3ac4214)', () => {
  // PDF réel « holiday-ornament-es-c3ac4214 » (es, hobbii) : couverture « Design: Maggie
  // Trunkhill - Daisy Girl Crochet | Hobbii Design » — préfixe de 45 caractères avant
  // « | Hobbii Design », au-delà de l'ancien plafond {2,40} des regex `pipe`/DESIGN_CAPTURE_RE
  // → aucune des 4 branches de parseAuthorLine ne matchait, author absent du front-matter (P0).
  it('capte un préfixe « Design: X | Hobbii Design » de 45 caractères (> ancien plafond 40)', () => {
    expect(parseAuthorLine('Design: Maggie Trunkhill - Daisy Girl Crochet | Hobbii Design')).toBe(
      'Maggie Trunkhill - Daisy Girl Crochet | Hobbii Design',
    )
  })
  // Point de vigilance : plafond élargi à 70 → une prose plus longue ne doit PAS devenir
  // captable simplement parce qu'elle passe sous la nouvelle limite de longueur ; les ancres
  // (préfixe « Design(er)/Conception/… : » ou suffixe « | Hobbii Design ») doivent rester
  // le vrai garde-fou, pas la longueur.
  it('ne capte PAS une phrase de prose de ~60 caractères sans ancre requise', () => {
    expect(parseAuthorLine('Cette rangée demande beaucoup de concentration et de patience')).toBeNull()
  })
})

// 3e VARIANTE du bug auteur perdu (paliers 4 et 6 déjà patchés ponctuellement pour ce
// même symptôme — cf. palier 8/8, Knitted Crown - Diadema #7).
// PDF réel « Knitted Crown Headband » (es, hobbii) : pied de page « Hobbii Friends - My
// Favourite Stitches, Katharina Müller - Copyright © 2021   Página 1 » (texte VERBATIM,
// vérifié via pdftotext sur le PDF). Le nom de collection avant la virgule (« Hobbii
// Friends - My Favourite Stitches ») N'EST PAS « Hobbii Design » littéral, contrairement
// aux 2 formats déjà couverts (Metorit palier 4, Holiday Ornament palier 6) — les 2
// patches précédents élargissaient un ancrage/plafond MAIS gardaient tous deux l'exigence
// littérale « Hobbii Design, » en dur, donc aucun des deux n'aurait pu matcher ce 3e cas.
// Généralisation réelle : n'importe quel texte de collection avant la virgule est accepté,
// SEUL le motif fixe « - Copyright » sert d'ancrage anti-faux-positif (au lieu du nom de
// marque littéral) — cf. reference `-ideal.md` du corpus : `author: Katharina Müller`
// (le nom de collection est écarté, comme pour le format « Hobbii Design, » existant, mais
// SANS fabriquer de suffixe « | Hobbii Design » puisque la marque réelle est différente).
describe('mdlab assemble — parseAuthorLine (collection arbitraire avant la virgule, 3e variante du bug auteur, bug knitted-crown-headband-es-a5a5513c)', () => {
  it('capte le nom même quand la collection avant la virgule N’EST PAS « Hobbii Design » littéral (PDF réel, texte verbatim)', () => {
    expect(
      parseAuthorLine('Hobbii Friends - My Favourite Stitches, Katharina Müller - Copyright © 2021   Página 1'),
    ).toBe('Katharina Müller')
  })
  // Non-régression #1 (bug palier 4, Metorit) : la forme « Hobbii Design, <Nom> - Copyright »
  // doit continuer à produire EXACTEMENT le même résultat qu'avant (suffixe « | Hobbii
  // Design » inclus) — la nouvelle branche générique ne doit jamais prendre le dessus.
  it('non-régression (palier 4, Metorit) : « Hobbii Design, <Nom> - Copyright » garde son suffixe « | Hobbii Design »', () => {
    expect(
      parseAuthorLine('Metorit - Hobbii Design, Sys Fredens - Copyright © 2020   Página 1'),
    ).toBe('Sys Fredens | Hobbii Design')
  })
  // Non-régression #2 (bug palier 6, Holiday Ornament) : le plafond de capture élargi
  // 40→70 sur pipe/DESIGN_CAPTURE_RE (regex SŒURS, pas HOBBII_COMMA_RE) doit rester intact.
  it('non-régression (palier 6, Holiday Ornament) : plafond de capture élargi 40→70 toujours actif', () => {
    expect(parseAuthorLine('Design: Maggie Trunkhill - Daisy Girl Crochet | Hobbii Design')).toBe(
      'Maggie Trunkhill - Daisy Girl Crochet | Hobbii Design',
    )
  })
  // Anti-faux-positif #1 : un pied de page copyright générique SANS nom de designer (très
  // majoritaire dans le corpus réel — motif dominant mesuré : sur 87 lignes « Copyright »
  // échantillonnées, la plupart n'ont NI virgule NI nom propre) ne doit PAS fabriquer un
  // faux auteur à partir du domaine/de la marque.
  it('anti-faux-positif : un pied de page copyright générique sans virgule/nom reste null (PDF réel, motif dominant du corpus)', () => {
    expect(parseAuthorLine('Hobbii.fr - Copyright © 2019 - Tous droits réservés')).toBeNull()
    expect(parseAuthorLine('Hobbii.com - Copyright © 2018 - All rights reserved.')).toBeNull()
  })
  // Anti-faux-positif #2 : une phrase qui a la même forme structurelle (virgule + texte +
  // « - Copyright ») mais dont le texte après la virgule NE COMMENCE PAS par une majuscule
  // (donc n'a pas la forme d'un nom propre) ne doit pas être mal classée comme auteur.
  it('anti-faux-positif : texte après la virgule sans majuscule initiale (pas la forme d’un nom) reste null', () => {
    expect(
      parseAuthorLine('Modèle réalisé par nos soins, tous droits réservés - Copyright © 2022'),
    ).toBeNull()
  })
  // Anti-faux-positif #3 : une ligne d'instruction ordinaire (virgule + mot capitalisé)
  // sans « Copyright » ne doit évidemment jamais être captée (aucun ancrage présent).
  it('anti-faux-positif : virgule + mot capitalisé SANS « Copyright » reste null (ligne de travail ordinaire)', () => {
    expect(parseAuthorLine('Rang 12 : rabattre toutes les mailles, Continuer avec la manche droite')).toBeNull()
  })
})

describe('mdlab segment — Au2 sous-étiquette de fil/matériel rétrogradée hors page 0 (2ᵉ fil perdu)', () => {
  const B = (text, y, size = 11) => ({ text, y, size, bold: true })
  it('rétrograde « Glitter Deluxe, 30 g » (2ᵉ fil, gras) dans MATÉRIEL sur la page de référence (page 1) — pas de section bare, contenu routé', () => {
    const pages = [
      [B('Couverture', 800, 20)],
      [B('MATÉRIEL', 700), L('laine', 690), B('Glitter Deluxe, 30 g', 660), L('1 pelote Gold', 650)],
    ]
    const secs = segmentSections(pages)
    // Aucune section « bare » (kind pelote, ref null) ne doit naître de l’étiquette.
    expect(secs.some((s) => s.ref === null && /Glitter/.test(s.title))).toBe(false)
    const mat = secs.find((s) => s.ref === 'materiel')
    expect(mat).toBeTruthy()
    expect(mat.lines.some((l) => l.text === 'Glitter Deluxe, 30 g')).toBe(true)
    expect(mat.lines.some((l) => l.text === '1 pelote Gold')).toBe(true)
    // End-to-end : le 2ᵉ fil/matériel est bien routé dans le champ de référence.
    const ref = extractReference(secs, { n: 1 }).reference
    expect(JSON.stringify(ref)).toMatch(/Glitter Deluxe/)
  })
  it('NE rétrograde PAS « ABRÉVIATIONS » (tout-caps, titre légitime) suivant une section fil', () => {
    const pages = [
      [B('Couverture', 800, 20)],
      [B('QUALITÉ DU FIL', 700), L('Friends Cotton, Hobbii', 690), B('ABRÉVIATIONS', 660), L('m = maille', 650)],
    ]
    const secs = segmentSections(pages)
    expect(secs.some((s) => s.title === 'ABRÉVIATIONS')).toBe(true)
  })
  it('NE rétrograde PAS une section de travail titrée normale (> 3 lignes) suivant une section référence', () => {
    const pages = [
      [B('Couverture', 800, 20)],
      [
        B('ÉCHANTILLON', 700), L('20 m = 10 cm', 690),
        B('Commencer', 660), L('Monter 80 m', 650), L('Tricoter en rond', 640),
        L('Rang 1 : tout à l’endroit', 630), L('Rang 2 : tout à l’envers', 620),
      ],
    ]
    const secs = segmentSections(pages)
    const travail = secs.find((s) => s.title === 'Commencer')
    expect(travail).toBeTruthy()
    expect(travail.ref).toBe(null)
    expect(travail.lines.length).toBeGreaterThan(3)
  })
  it('exclut abbr du contexte d’étiquette : une mini-section lowercase suivant les abréviations reste une section à part', () => {
    const pages = [
      [B('Couverture', 800, 20)],
      [B('ABRÉVIATIONS', 700), L('m = maille', 690), B('Notes du modèle', 660), L('Bloquer à plat', 650)],
    ]
    const secs = segmentSections(pages)
    expect(secs.some((s) => s.title === 'Notes du modèle')).toBe(true)
  })
  // Bug réel granny-shawl-jacket-de-5f09f875 (crochet allemand) : une page
  // de mise en avant montre un aperçu du 1er rang sous un titre « Granny Seelenwärmer » (grande
  // police, donc `titleLine` réel), juste après un bloc GARNVERBRAUCH (ref='materiel') — court
  // (3 lignes), sans mot-clé de rubrique reconnu, donc `isMiniLabel` vrai comme une authentique
  // étiquette de boîte (« Glitter Deluxe, 30 g » ci-dessus). Mais CE titre réapparaît, verbatim,
  // plus loin dans le document comme titre de la VRAIE section de travail (« Anfangen mit
  // Cosy. », les rangs 1-12) — une étiquette de boîte authentique ne réapparaît jamais comme
  // titre ailleurs. Avant correctif : rétrogradé dans Matériel, la description du 1er rang
  // disparaissait dans une section référence sans rapport avec le travail.
  it('NE rétrograde PAS un titre qui réapparaît plus loin comme titre d’une VRAIE section de travail (aperçu de rang dupliqué sous le même titre)', () => {
    const pages = [
      [B('Couverture', 800, 20)],
      [
        B('GARNVERBRAUCH', 700), L('600 g Cosy', 690),
        B('Granny Seelenwärmer', 660, 14), L('Der erste Runde besteht aus ein MR mit 4 StbGr.', 600),
      ],
      [
        B('Granny Seelenwärmer', 700, 14),
        L('Anfangen mit Cosy.', 690), L('1.) MR, *3 Stb, 2 LM* in der Ring x 4', 680),
        L('2.) *3 Stb, 2 LM, 3 Stb, 2 LM um die 2LM von vohergehende Runde*', 670),
      ],
    ]
    const secs = segmentSections(pages)
    // Aucune section « Granny Seelenwärmer » n'a été absorbée dans GARNVERBRAUCH.
    const mat = secs.find((s) => s.title === 'GARNVERBRAUCH')
    expect(mat.lines.some((l) => /Granny Seelenwärmer/.test(l.text))).toBe(false)
    // L'aperçu du 1er rang forme sa propre section, avec son contenu intact.
    const preview = secs.filter((s) => s.title === 'Granny Seelenwärmer')
    expect(preview.length).toBe(2)
    expect(preview[0].lines.some((l) => /erste Runde/.test(l.text))).toBe(true)
    expect(preview[1].lines.some((l) => l.text === 'Anfangen mit Cosy.')).toBe(true)
  })
  // Anti-faux-positif : la garde ci-dessus n'admet PAS n'importe quel titre répété — une
  // section-titre VIDE (légende de schéma répétée deux fois, ex. « Lange Seite » du même PDF
  // réel) n'a aucun contenu propre à préserver et doit rester rétrogradable normalement.
  it('anti-faux-positif : une mini-section VIDE dont le titre réapparaît plus loin reste rétrogradable (aucun contenu à préserver)', () => {
    const pages = [
      [B('Couverture', 800, 20)],
      [B('MATÉRIEL', 700), L('600 g Cosy', 690), B('Lange Seite', 660)],
      [B('Lange Seite', 700), L('11 StbGr zusammen', 690)],
    ]
    const secs = segmentSections(pages)
    const mat = secs.find((s) => s.title === 'MATÉRIEL')
    expect(mat.lines.some((l) => l.text === 'Lange Seite')).toBe(true)
  })
})

describe('mdlab boilerplate — BB4 run terminal de tirets collé à du contenu (reflow)', () => {
  it('nettoie ≥6 tirets en fin de ligne de contenu sans supprimer la ligne (« Garngrupp C eller A + A ------ »)', () => {
    const pages = [[
      L('BÖRJA ARBETET HÄR', 800),
      L('Garngrupp C eller A + A ------------------------', 780),
      L('8-10 varv', 760),
      L('mc – maille coulée', 740),
    ]]
    const clean = stripBoilerplate(pages)
    const texts = clean.flat().map((l) => l.text)
    expect(texts).toContain('Garngrupp C eller A + A')
    expect(texts).not.toContain('Garngrupp C eller A + A ------------------------')
    // plage numérique courte et tiret cadratin isolé : inchangés
    expect(texts).toContain('8-10 varv')
    expect(texts).toContain('mc – maille coulée')
  })
})

describe('mdlab segment — bandeaux de COUVERTURE/BOUTIQUE Hobbii absorbés (sections fantômes)', () => {
  const B = (text, y, size = 11) => ({ text, y, size, bold: true })

  // Défaut 1 — bandeau craft de couverture (« TUTORIEL CROCHET », « KNITTING PATTERN »,
  // « HAAK PATROON »…) redondant avec titre:/auteur: → bruit, UNIQUEMENT sur la page 0.
  it('classe le bandeau craft de couverture (page 0) en bruit', () => {
    const pages = [
      [B('TUTORIEL CROCHET', 800, 12), L('Une présentation de couverture quelconque.', 780, 11)],
      [B('BORDURE COQUILLES', 700, 12), L('Tour 1: 8 ms', 690, 11)],
    ]
    const secs = segmentSections(pages)
    const banner = secs.find((s) => /TUTORIEL CROCHET/.test(s.title))
    expect(banner).toBeTruthy()
    expect(banner.noise).toBe(true)
    expect(banner.ref).toBe(null)
    // une vraie section de travail du corps reste intacte
    const bordure = secs.find((s) => /BORDURE COQUILLES/.test(s.title))
    expect(bordure.noise).toBeFalsy()
  })

  it('classe « KNITTING PATTERN » (page 0) en bruit et l’exclut du travail', () => {
    const pages = [
      [B('KNITTING PATTERN', 800, 12), L('La Spiga, un snood en deux couches.', 780, 11)],
      [B('OUTER LAYER', 700, 12), L('CO 126 sts.', 690, 11)],
    ]
    const { reader } = buildReaderFromPages(pages, { fileName: 'x.pdf' })
    expect(reader.sections.some((s) => /KNITTING PATTERN/i.test(s.title))).toBe(false)
    expect(reader.sections.some((s) => /OUTER LAYER/i.test(s.title))).toBe(true)
  })

  // Garde : une vraie section « MÖNSTER » (motif suédois) DANS LE CORPS (page ≥ 1)
  // ne doit JAMAIS être prise pour le bandeau craft.
  it('ne classe PAS une vraie section « MÖNSTER » (motif, page 1) en bruit', () => {
    const pages = [
      [B('KNITTING PATTERN', 800, 12), L('Description.', 780, 11)],
      [B('MÖNSTER', 700, 12), L('Lägg upp 65 maskor och sticka räta.', 690, 11), L('Sticka vidare.', 680, 11)],
    ]
    const secs = segmentSections(pages)
    const monster = secs.find((s) => s.title === 'MÖNSTER')
    expect(monster).toBeTruthy()
    expect(monster.noise).toBeFalsy()
    expect(monster.kind).toBe('motif')
  })

  // Défaut 3 (spring-headband-de-cfeb6f9e, corpus réel, IMPACT RÉEL
  // CONFIRMÉ) : « STRICKMUSTER » (allemand, bandeau « type d'ouvrage » de couverture — même
  // rôle que « KNITTING PATTERN »/« HÄKELANLEITUNG ») n'était couvert par AUCUNE alternative
  // de CRAFT_BANNER_RE (seul « (häkel|strick)anleitung » existait) : kindForTitle le
  // classait `motif` via le mot-clé nu `muster\b` de KIND_KEYWORDS, absorbant le titre du
  // patron et son sous-titre (« Spring »/« Haarreifen ») en fausse section « ##
  // STRICKMUSTER {motif} ». Ajout d'une alternative dédiée « (häkel|strick)muster » à
  // CRAFT_BANNER_RE (page 0 uniquement) : le bandeau disparaît, titre et sous-titre ne
  // fuient plus dans le corps. Régénéré end-to-end sur le PDF réel : la section fantôme ne
  // réapparaît nulle part ailleurs (67 PDF témoins des vagues 1/3/4/5, aucune autre section
  // affectée).
  it('classe « STRICKMUSTER » (page 0, bandeau craft allemand) en bruit', () => {
    const pages = [
      [B('STRICKMUSTER', 800, 12), L('Spring', 780, 11), L('Haarreifen', 760, 11)],
      [B('SCHLAUCH', 700, 12), L('R 1 – glatt re', 690, 11)],
    ]
    const secs = segmentSections(pages)
    const banner = secs.find((s) => s.title === 'STRICKMUSTER')
    expect(banner).toBeTruthy()
    expect(banner.noise).toBe(true)
    expect(banner.kind).not.toBe('motif')
    const schlauch = secs.find((s) => s.title === 'SCHLAUCH')
    expect(schlauch.noise).toBeFalsy()
  })

  it('« STRICKMUSTER » (page 0) est exclu du patron final — titre/sous-titre ne fuient plus dans le corps', () => {
    // Même scénario, au niveau buildReaderFromPages (comme le test « KNITTING PATTERN »
    // ci-dessus) : les sections `noise` sont filtrées avant reader.sections, alors que
    // segmentSections seul les conserve encore (avec leurs lignes) marquées noise:true —
    // d'où ce test séparé plutôt qu'une assertion sur `secs` directement.
    const pages = [
      [B('STRICKMUSTER', 800, 12), L('Spring', 780, 11), L('Haarreifen', 760, 11)],
      [B('SCHLAUCH', 700, 12), L('R 1 – glatt re', 690, 11)],
    ]
    const { reader } = buildReaderFromPages(pages, { fileName: 'x.pdf' })
    expect(reader.sections.some((s) => /STRICKMUSTER/i.test(s.title))).toBe(false)
    expect(reader.sections.some((s) => s.steps.some((st) => /Spring|Haarreifen/.test(st.t || '')))).toBe(false)
    expect(reader.sections.some((s) => /SCHLAUCH/i.test(s.title))).toBe(true)
  })

  // Garde symétrique au « MÖNSTER » ci-dessus : de VRAIES sections composées allemandes
  // « Ajourmuster »/« Blattmuster » (motif corps, page ≥ 1) ne doivent JAMAIS être prises
  // pour le bandeau craft, même si elles portent le même suffixe nu « muster ».
  it('ne classe PAS « Ajourmuster »/« Blattmuster » (motif composé, page 1) en bruit', () => {
    const pages = [
      [B('STRICKMUSTER', 800, 12), L('Nom du patron', 780, 11)],
      [B('Ajourmuster', 700, 12), L('R 1: 2 M re, 1 Umschlag.', 690, 11), L('R 2: alle M li.', 680, 11)],
      [B('Blattmuster', 600, 12), L('R 1: 3 M re, 1 M li.', 590, 11), L('R 2: alle M li.', 580, 11)],
    ]
    const secs = segmentSections(pages)
    const ajour = secs.find((s) => s.title === 'Ajourmuster')
    const blatt = secs.find((s) => s.title === 'Blattmuster')
    expect(ajour).toBeTruthy()
    expect(ajour.noise).toBeFalsy()
    expect(ajour.kind).toBe('motif')
    expect(blatt).toBeTruthy()
    expect(blatt.noise).toBeFalsy()
    expect(blatt.kind).toBe('motif')
  })

  // Défaut 2 — bandeau boutique « ACHETEZ VOTRE FIL ICI » : classé fil, fait fuir son
  // ancre (« Tutoriel ») dans ## Fil. Routé en bruit SI une vraie section fil sœur existe.
  it('route « ACHETEZ VOTRE FIL ICI » en bruit quand une vraie section fil existe (ancre non fuitée)', () => {
    const pages = [[
      B('QUALITÉ DU FIL', 800, 12), L('Friends Cotton 8/8, Hobbii', 790, 11), L('100% Coton', 780, 11),
      B('ACHETEZ VOTRE FIL ICI', 740, 12), L('Tutoriel', 730, 11),
    ]]
    const secs = segmentSections(pages)
    const buy = secs.find((s) => /ACHETEZ VOTRE FIL/.test(s.title))
    expect(buy.noise).toBe(true)
    expect(buy.ref).toBe(null)
    const real = secs.find((s) => /QUALITÉ DU FIL/.test(s.title))
    expect(real.ref).toBe('fil')
    const ref = extractReference(secs, { n: 1 }).reference
    expect(JSON.stringify(ref)).toMatch(/Friends Cotton/)
    expect(JSON.stringify(ref)).not.toMatch(/Tutoriel/)
  })

  it('« BUY THE YARN HERE » sœur de « YARN QUALITY » → bruit, ancre « Pattern » non fuitée', () => {
    const pages = [[
      B('YARN QUALITY', 800, 12), L('Highland Wool, Hobbii', 790, 11),
      B('BUY THE YARN HERE', 750, 12), L('Pattern', 740, 11),
    ]]
    const secs = segmentSections(pages)
    expect(secs.find((s) => /BUY THE YARN/.test(s.title)).noise).toBe(true)
    expect(secs.find((s) => /YARN QUALITY/.test(s.title)).ref).toBe('fil')
    const ref = extractReference(secs, { n: 1 }).reference
    expect(JSON.stringify(ref)).toMatch(/Highland Wool/)
    expect(JSON.stringify(ref)).not.toMatch(/Pattern/)
  })

  // Garde : quand le bandeau boutique est la SEULE section fil (il porte lui-même la
  // conso, cf. curly-nl « Verbruik: … »), on le CONSERVE — sinon perte de données.
  it('conserve « KOOP HET GAREN HIER » quand c’est la seule section fil (conso portée)', () => {
    const pages = [[
      B('KOOP HET GAREN HIER', 800, 12), L('Verbruik:', 790, 11), L('Ca. 35g Curly', 780, 11),
    ]]
    const secs = segmentSections(pages)
    const buy = secs.find((s) => /KOOP HET GAREN/.test(s.title))
    expect(buy.ref).toBe('fil')
    expect(buy.noise).toBeFalsy()
    const ref = extractReference(secs, { n: 1 }).reference
    expect(JSON.stringify(ref)).toMatch(/Curly/)
  })

  // Garde : une vraie section fil « YARN QUALITY » seule n’est jamais confondue avec
  // un bandeau boutique (pas de verbe d’achat en tête).
  it('ne confond pas « YARN QUALITY » (vraie section fil) avec un bandeau boutique', () => {
    const pages = [[B('YARN QUALITY', 800, 12), L('Highland Wool, Hobbii', 790, 11)]]
    const secs = segmentSections(pages)
    const s = secs.find((x) => /YARN QUALITY/.test(x.title))
    expect(s.ref).toBe('fil')
    expect(s.noise).toBeFalsy()
  })

  // Défaut 3 — accroche de vente croisée promue en section fantôme.
  it('classe l’accroche de vente croisée (« Vous aimez son style… ») en bruit', () => {
    const pages = [[
      B('BORDURE', 800, 12), L('Tour 1: ms', 790, 11),
      B('Vous aimez son style, mais préférez une', 750, 11),
      L('forme différente ? Découvrez la version rectangulaire.', 740, 11),
    ]]
    const secs = segmentSections(pages)
    const xsell = secs.find((s) => /Vous aimez son style/.test(s.title))
    expect(xsell).toBeTruthy()
    expect(xsell.noise).toBe(true)
    // la vraie section BORDURE reste du travail
    expect(secs.find((s) => s.title === 'BORDURE').noise).toBeFalsy()
  })
})

describe('mdlab segment — guides en images « VEJLEDNING » (da) écartés (bruit)', () => {
  const B = (text, y, size = 11) => ({ text, y, size, bold: true })

  // Un « VEJLEDNING - <élément> » (pas-à-pas PHOTO) redouble une vraie section
  // déjà décrite ; ses légendes sont déversées en vrac (numéros dans le désordre,
  // « Sådan. » répété) → bruit pur écarté par l'oracle (cf. babyfryd-sensory-cube).
  it('classe « VEJLEDNING - FIRKANTER » (redouble « FIRKANTER - … ») en bruit', () => {
    const pages = [[
      B('FIRKANTER - LAV 6 STK', 800, 12), L('1. Med fv. A. Lav en mr.', 790, 11), L('2. Hækl fm.', 780, 11),
      B('VEJLEDNING - FIRKANTER', 740, 12), L('1. Med fv. A. 2. Sådan.', 730, 11), L('3. Hækl 3 fm. 4. Sådan.', 720, 11),
    ]]
    const secs = segmentSections(pages)
    expect(secs.find((s) => s.title === 'VEJLEDNING - FIRKANTER').noise).toBe(true)
    expect(secs.find((s) => s.title === 'FIRKANTER - LAV 6 STK').noise).toBeFalsy()
  })

  // Le sujet peut être un préfixe (« BAMSE » ⊂ « BAMSE - HOVED ») ou un sur-mot
  // (« SPRUTTEARME » ⊃ « SPRUTTE ») d'une section antérieure : les deux redoublent.
  it('classe « VEJLEDNING - BAMSE » (préfixe de « BAMSE - HOVED ») en bruit', () => {
    const pages = [[
      B('BAMSE - HOVED', 800, 12), L('1. Lav 1 mr.', 790, 11), L('2. Hækl 2 fm.', 780, 11),
      B('VEJLEDNING - BAMSE', 740, 12), L('1. Sy. 2. Sådan.', 730, 11), L('3. Sådan.', 720, 11),
    ]]
    const secs = segmentSections(pages)
    expect(secs.find((s) => s.title === 'VEJLEDNING - BAMSE').noise).toBe(true)
  })

  it('classe « Billedvejledning » nu (explicitement « en images ») en bruit', () => {
    const pages = [[B('Billedvejledning', 800, 12), L('1. Sådan.', 790, 11), L('2. Sådan.', 780, 11)]]
    const secs = segmentSections(pages)
    expect(secs.find((s) => /Billedvejledning/.test(s.title)).noise).toBe(true)
  })

  // Garde : une section « Vejledning » AUTOPORTANTE (instructions générales, sans
  // redoublement) reste du travail — jamais écartée.
  it('NE classe PAS une section « Vejledning » autoportante en bruit', () => {
    const pages = [[B('Vejledning', 800, 12), L('Strik saaledes hele vejen rundt.', 790, 11), L('Fortsaet.', 780, 11)]]
    const secs = segmentSections(pages)
    expect(secs.find((s) => s.title === 'Vejledning').noise).toBeFalsy()
  })

  // Garde : un « VEJLEDNING - <élément> » qui ne redouble AUCUNE section antérieure
  // est conservé (on n'écarte que le pas-à-pas photo prouvé redondant).
  it('NE classe PAS « VEJLEDNING - NOUVEAU » (aucun redoublement) en bruit', () => {
    const pages = [[
      B('BORDURE', 800, 12), L('Tour 1 : ms', 790, 11),
      B('VEJLEDNING - HANK', 740, 12), L('Lav 15 lm.', 730, 11), L('Hækl fm.', 720, 11),
    ]]
    const secs = segmentSections(pages)
    expect(secs.find((s) => s.title === 'VEJLEDNING - HANK').noise).toBeFalsy()
  })
})

describe('mdlab segment (kindForTitle) — « TAILLE ET <élément> » (corps) n\'est pas une section de tailles', () => {
  // « TAILLE ET JUPE » (waist + skirt) est une section de TRAVAIL, pas le tableau
  // des tailles : l'ancre FR « ^taille » l'avalait, ses rangs (avec vecteurs de
  // tailles) fuyaient dans le tableau ## Tailles (cf. boble-joy-children-s-skirt).
  it('classe « TAILLE ET JUPE » en corps (pièce = vêtement) et non en mesures', () => {
    expect(kindForTitle('TAILLE ET JUPE')).toBe('corps')
  })
  it('classe toujours « Tailles » / « Taille » / « Tailles (cm) » en mesures', () => {
    expect(kindForTitle('Tailles')).toBe('mesures')
    expect(kindForTitle('Taille')).toBe('mesures')
    expect(kindForTitle('Tailles (cm)')).toBe('mesures')
  })
  // Un nom de VÊTEMENT entier = pièce principale = corps (section de travail).
  it('classe un nom de vêtement (jupe/skirt/nederdel/robe) en corps', () => {
    expect(kindForTitle('Jupe')).toBe('corps')
    expect(kindForTitle('SKIRT')).toBe('corps')
    expect(kindForTitle('Nederdel')).toBe('corps')
    expect(kindForTitle('Robe')).toBe('corps')
  })
})

describe('mdlab steps — Levier 1 : marqueur de rang « Tr/Trs » (amigurumi Hobbii FR)', () => {
  it('« Tr 1 : … » est un rang COCHABLE même en section pelote (ROW_RE)', () => {
    const [step] = linesToSteps([{ text: 'Tr 1 : 6 ms dans un cm [6]' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBeUndefined()
    expect(step.t).toContain('Tr 1')
  })
  it('« Trs 11-24 : … » (plage) est aussi cochable en section pelote', () => {
    const [step] = linesToSteps([{ text: 'Trs 11-24 : 1 ms dans chacune des m [60]' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBeUndefined()
  })
  it('PRUDENCE : « Tricoter 3 mailles » n’est PAS un rang (note en section pelote)', () => {
    const [step] = linesToSteps([{ text: 'Tricoter 3 mailles' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBe(true)
  })
  it('PRUDENCE : « très serré 2 fois » n’est PAS un rang (le \\d final protège « très »)', () => {
    // Ligne longue > 220 non-terminée par « : » resterait note ; on force le cas où seul
    // ROW_RE pourrait la rendre cochable : préfixe « très » sans chiffre collé.
    const [step] = linesToSteps([{ text: 'très serré, garder la tension régulière tout du long' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBe(true)
  })
})

describe('mdlab segment — Levier 2 : mots-clés de kind manquants (multilingue)', () => {
  it('FR « LA PIÈCE DE DERRIÈRE » (accentué) → corps', () => {
    expect(kindForTitle('LA PIÈCE DE DERRIÈRE')).toBe('corps')
  })
  it('FR « LA PIECE DE DERRIERE » (capitales sans accent, cas PDF réel) → corps', () => {
    expect(kindForTitle('LA PIECE DE DERRIERE')).toBe('corps')
  })
  it('IT « SCIALLE » (châle) → accessoires', () => {
    expect(kindForTitle('SCIALLE')).toBe('accessoires')
  })
  it('IT « Sciarpa » (écharpe) → accessoires ; « Maglione » (pull) → corps', () => {
    expect(kindForTitle('Sciarpa')).toBe('accessoires')
    expect(kindForTitle('Maglione')).toBe('corps')
  })
  it('NL « Rugpand » (dos) → corps ; « Armsgat » (emmanchure) → corps', () => {
    expect(kindForTitle('Rugpand')).toBe('corps')
    expect(kindForTitle('Armsgat')).toBe('corps')
  })
  it('NL « Lijf » (torse) → corpsrond (seule occurrence de réf = amigurumi curly ; corps régressait le banc)', () => {
    // « Lijf » est ambigu : corps sur un vêtement, corpsrond en amigurumi. La seule
    // occurrence MESURÉE (réf de référence curly-baby-duckling) est {corpsrond}, et le mapper
    // à corps faisait CHUTER le banc (0.731→0.723) ; corpsrond le REMET à 0.731 (neutre).
    // Reste un kind de TRAVAIL (hors NON_WORK_KINDS) donc les rangs de « Lijf »
    // deviennent cochables dans les deux cas — c'est le gain net sur vivi (non mesuré).
    expect(kindForTitle('Lijf')).toBe('corpsrond')
  })
  it('NL « Halsopening » (encolure) → encolure', () => {
    expect(kindForTitle('Halsopening')).toBe('encolure')
  })
  it('PRÉCÉDENCE : « Montering en boorden » (assemblage NL) → finitions, pas bordure', () => {
    expect(kindForTitle('Montering en boorden')).toBe('finitions')
  })
  it('NON-RÉGRESSION : « Lijf » ne fait pas matcher « Blijf » (ancrage \\b)', () => {
    expect(['corps', 'corpsrond']).not.toContain(kindForTitle('Blijf rustig'))
  })
  it('NON-RÉGRESSION : une vraie « Bordure » (sans mot d’assemblage) reste bordure', () => {
    expect(kindForTitle('Bordure')).toBe('bordure')
    expect(kindForTitle('Boorden')).toBe('bordure')
  })
})

// Bug réel norma-jeane-halter-top-es-99b86539 (crochet espagnol) :
// « CUERPO » (corps du VÊTEMENT — top, pull, robe…) était classé corpsrond (amigurumi)
// car « cuerpo » ne vivait que dans cette famille. Sondage sur le corpus ES :
// 6 occurrences en vêtement contre 1 seule en amigurumi
// (spring-birds-es-d4d4c462, oiseau en crochet à rembourrer, sections sœurs CABEZA/COLA).
// `kindForTitle('Cuerpo')` seul (sans contexte document) résout désormais vers `corps`
// (la famille la plus fréquente) ; le cas amigurumi minoritaire est repêché par
// segmentSections via une reclassification post-hoc fondée sur les sections SŒURS du
// même document (cf. le commentaire en fin de segmentSections, segment.js).
describe('mdlab segment — « Cuerpo » (ES) ambigu vêtement/amigurumi (bug norma-jeane-halter-top-es)', () => {
  const B = (text, y, size = 11) => ({ text, y, size, bold: true })
  it('kindForTitle(\'Cuerpo\') seul (sans contexte) → corps (majorité mesurée)', () => {
    expect(kindForTitle('CUERPO')).toBe('corps')
    expect(kindForTitle('Cuerpo')).toBe('corps')
  })
  it('segmentSections : « CUERPO » d’un patron VÊTEMENT (aucune section anatomique amigurumi sœur) reste corps', () => {
    const pages = [[
      B('CUERPO', 700),
      L('Vuelta 1: 20 cad, gira', 690),
      L('Vuelta 2: pb en cada punto', 680),
      B('MANGA (HAZ DOS)', 660),
      L('Vuelta 1: 10 cad', 650),
    ]]
    const secs = segmentSections(pages)
    const cuerpo = secs.find((s) => s.title === 'CUERPO')
    expect(cuerpo).toBeTruthy()
    expect(cuerpo.kind).toBe('corps')
  })
  it('segmentSections : « CUERPO » d’un AMIGURUMI (sœurs CABEZA/COLA) est reclassé corpsrond', () => {
    const pages = [[
      B('CUERPO', 700),
      L('Rda 1: 6 pb en el cm [6]', 690),
      L('Rda 2: (aum) x6 [12]', 680),
      B('CABEZA', 660),
      L('Rda 1: 6 pb en el cm [6]', 650),
      B('COLA', 630),
      L('Rda 1: 6 pb en el cm [6]', 620),
    ]]
    const secs = segmentSections(pages)
    const cuerpo = secs.find((s) => s.title === 'CUERPO')
    expect(cuerpo).toBeTruthy()
    expect(cuerpo.kind).toBe('corpsrond')
    // Les sœurs elles-mêmes gardent leur propre kind, inchangé par ce correctif.
    expect(secs.find((s) => s.title === 'CABEZA').kind).toBe('tete')
    expect(secs.find((s) => s.title === 'COLA').kind).toBe('queue')
  })
  it('NON-RÉGRESSION : « Cuerpo de la prenda » (sous-chaîne, pas le titre nu) reste corps même avec des sœurs amigurumi', () => {
    const pages = [[
      B('Cuerpo de la prenda', 700),
      L('Vuelta 1: 20 cad, gira', 690),
      B('CABEZA', 660),
      L('Rda 1: 6 pb en el cm [6]', 650),
    ]]
    const secs = segmentSections(pages)
    const cuerpo = secs.find((s) => s.title === 'Cuerpo de la prenda')
    expect(cuerpo).toBeTruthy()
    expect(cuerpo.kind).toBe('corps')
  })
  it('LIMITE CONNUE, compromis assumé (revue coordinateur) : un amigurumi SIMPLE (« CUERPO » puis « MONTAJE », sans tête/museau/queue/oreille/membre en section à part) reste classé corps, pas corpsrond', () => {
    // Documente le comportement ACTUEL, accepté en connaissance de cause plutôt que
    // laissé non couvert : le repêchage post-hoc (cf. commentaire en fin de
    // segmentSections, segment.js) ne se déclenche QUE si une VRAIE section sœur
    // anatomique d'amigurumi existe dans le document — un amigurumi à une seule pièce
    // ronde (fermée puis assemblée/finie sans détailler tête/oreilles/queue à part) n'en
    // porte aucune, donc `hasAmigurumiSibling` reste faux et « CUERPO » reste `corps`.
    // Aucune occurrence de ce cas dans le corpus mesuré (vagues 1-6) : pas une régression
    // nette, un trou connu du discriminant choisi (sœur anatomique), à instruire par un
    // signalement réel plutôt que par anticipation sur un mot de contenu (« amigurumi »/
    // « relleno »/« montaje ») — élargir sur ce type de signal rouvrirait la collision
    // titre-seul que ce correctif referme.
    const pages = [[
      B('CUERPO', 700),
      L('Rda 1: 6 pb en el cm [6]', 690),
      L('Rda 2: (aum) x6 [12]', 680),
      B('MONTAJE', 660),
      L('Cose el cuerpo cerrando el hueco.', 650),
    ]]
    const secs = segmentSections(pages)
    const cuerpo = secs.find((s) => s.title === 'CUERPO')
    expect(cuerpo).toBeTruthy()
    expect(cuerpo.kind).toBe('corps')
  })
})

describe('mdlab segment — kinds amigurumi POLONAIS (oracle boris-the-bee-pl)', () => {
  it('PL « Tułów » (corps rond) → corpsrond', () => {
    expect(kindForTitle('Tułów')).toBe('corpsrond')
  })
  it('PL « Skrzydła » (ailes) → membre', () => {
    expect(kindForTitle('Skrzydła')).toBe('membre')
  })
  it('PL « Łapki » (pattes) → membre', () => {
    expect(kindForTitle('Łapki')).toBe('membre')
  })
  it('PL « Żądło » (dard) → queue', () => {
    expect(kindForTitle('Żądło')).toBe('queue')
  })
  it('PL « Czułki » (antennes) et « Czapka » (bonnet) → autre (kind de l’oracle)', () => {
    expect(kindForTitle('Czułki')).toBe('autre')
    expect(kindForTitle('Czapka')).toBe('autre')
  })
  it('déjà couverts : « Głowa » → tete, « Nos » → museau, « Wykończenie » → finitions', () => {
    expect(kindForTitle('Głowa')).toBe('tete')
    expect(kindForTitle('Nos')).toBe('museau')
    expect(kindForTitle('Wykończenie')).toBe('finitions')
  })
  it('PL « Wskazówka » (conseil, SINGULIER) → info (routé en Présentation, comme la réf)', () => {
    expect(kindForTitle('Wskazówka')).toBe('info')
    expect(kindForTitle('Wskazówki')).toBe('info')
  })
})

describe('mdlab steps — rangs POLONAIS « Okr. » (okrążenie) cochables partout', () => {
  it('« Okr. 1: … » est un rang cochable même en section autre (NON_WORK) via ROW_RE', () => {
    const [step] = linesToSteps([{ text: 'Okr. 1: 6 psł w mr' }], { kind: 'autre', n: 1 })
    expect(step.note).toBeUndefined()
  })
  it('« Okr. 11-21: … » (plage) est cochable en section pelote', () => {
    const [step] = linesToSteps([{ text: 'Okr. 11-21: 1 psł w każdym o (60)' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBeUndefined()
  })
})

describe('mdlab — correctif 1 : marqueurs de rang manquants (Rg FR, Rząd PL)', () => {
  it('« Rg 1 » est un rang cochable dans une section pelote (non-travail)', () => {
    const steps = linesToSteps([{ text: 'Rg 1: 1ml, msdim x30, 1ml, tourner (30)' }], { kind: 'pelote' })
    expect(steps[0].note).toBeFalsy()
  })
  it('« Rg 2 – 6 » (plage) est un rang cochable en section pelote', () => {
    const steps = linesToSteps([{ text: 'Rg 2 – 6: 1ms dans chaque m (30)' }], { kind: 'pelote' })
    expect(steps[0].note).toBeFalsy()
  })
  it('« RGB 3 » n’est PAS pris pour un rang (garde \\s*\\d, faux positif)', () => {
    const steps = linesToSteps([{ text: 'RGB 3 couleurs disponibles pour ce modèle décoratif' }], { kind: 'pelote' })
    expect(steps[0].note).toBe(true)
  })
  it('polonais « Rząd 2 » (gras) n’est PAS promu en titre (ą-ogonek)', () => {
    expect(isTitleLine({ text: 'Rząd 2', bold: true }, 11)).toBe(false)
  })
  it('polonais « Rząd 24 » est un rang cochable en section pelote', () => {
    const steps = linesToSteps([{ text: 'Rząd 24: powtarzaj według opisu' }], { kind: 'pelote' })
    expect(steps[0].note).toBeFalsy()
  })
})

describe('mdlab — correctif 2 : le filet global aiguilles ne vole pas une intro de section de travail', () => {
  const cover = (text) => [{ ref: null, kind: 'pelote', intro: true, lines: [{ text, consumed: false }] }]
  const consumedFor = (text) => {
    const s = cover(text)
    extractReference(s, { n: 1 })
    return s[0].lines[0].consumed
  }
  it('bug zoe : « Avec le crochet 3mm. En utilisant… » (intro de SALOPETTE) n’est PAS volée', () => {
    expect(consumedFor('Avec le crochet 3mm. En utilisant Friends Cotton 8/4, coul. (79) et Diablo, coul. (55) pris ensemble.')).toBe(false)
  })
  it('bug zoe : « Avec Friends Cotton 8/4 coul. (53) et le crochet 2,5 mm » (intro BANDEAU) n’est PAS volée', () => {
    expect(consumedFor('Avec Friends Cotton 8/4 coul. (53) et le crochet 2,5 mm')).toBe(false)
  })
  it('bug zoe : « Avec la coul. (53) et le crochet 2,5 mm » (intro Nœud) n’est PAS volée', () => {
    expect(consumedFor('Avec la coul. (53) et le crochet 2,5 mm')).toBe(false)
  })
  it('positif : un vrai renvoi matériel court menant par l’outil « Crochet 3 mm » reste capté', () => {
    expect(consumedFor('Crochet 3 mm')).toBe(true)
  })
})

describe('mdlab steps — rang anglais « R N: » et incise « repeat N times » (oracle donkey)', () => {
  it('« R 2: » (R nu + chiffre, notation ronde Hobbii EN) est un rang cochable en section pelote', () => {
    const [step] = linesToSteps([{ text: 'R 2: (inc) repeat 6 times (12)' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBeUndefined()
    expect(step.repeat).toBeUndefined()
  })
  it('« R. 41: » (R nu + point) est aussi un rang cochable', () => {
    const [step] = linesToSteps([{ text: 'R. 41: (2 sc, dec) repeat 6 times (18)' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBeUndefined()
    expect(step.repeat).toBeUndefined()
  })
  it('« R 12-21: » (plage) est un rang cochable', () => {
    const [step] = linesToSteps([{ text: 'R 12-21: 1 sc in each sc (66) for a total of 10 rounds' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBeUndefined()
    expect(step.repeat).toBeUndefined()
  })
  it('DISCRIMINANT : un rang chiffré avec « repeat N times » en incise n’est PAS marqué répétition (pas de « × »)', () => {
    // L'oracle de référence rend « R 2: (inc) repeat 6 times » comme un rang « - R 2: … », sans « × » :
    // le « repeat 6 times » est une instruction de maille interne, pas une directive de rang.
    const [step] = linesToSteps([{ text: 'R 2: (inc) repeat 6 times (12)' }], { kind: 'corps', n: 1 })
    expect(step.repeat).toBeUndefined()
  })
  it('DISCRIMINANT : une VRAIE directive « Repeat rows… N times » (verbe en tête) garde bien la répétition « × »', () => {
    // Ne commence pas par un marqueur de rang → REP_RE s’applique → step.repeat (rendu « - × … »).
    const [step] = linesToSteps([{ text: 'Repeat rows 2 and 3, 11 times.' }], { kind: 'corps', n: 1 })
    expect(step.repeat).toBe(true)
  })
  it('NON-RÉGRESSION : « Répéter les tours 10 à 12, 11 fois » (FR) reste une répétition « × »', () => {
    const [step] = linesToSteps([{ text: 'Répéter les explications des tours 10 à 12, 11 fois de plus.' }], { kind: 'corps', n: 1 })
    expect(step.repeat).toBe(true)
  })
  it('NON-RÉGRESSION : « Rose 3 skeins » (mot commençant par R) n’est PAS pris pour un rang « R nu »', () => {
    const [step] = linesToSteps([{ text: 'Rose 3 skeins' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBe(true)
  })
})

describe('mdlab steps/segment — rangs ITALIENS « Riga/Righe » (tricot à plat, oracle audrey)', () => {
  it('« Riga 1 – riga a dir » est un rang cochable en section pelote (NON_WORK) via ROW_RE', () => {
    const [step] = linesToSteps([{ text: 'Riga 1 – riga a dir' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBeUndefined()
  })
  it('« Riga 21 – … » (et pluriel « Righe 3-6 ») est cochable', () => {
    const [a] = linesToSteps([{ text: 'Riga 21 – (2 m dir, 2 dir ins) x 10 (30 m)' }], { kind: 'pelote', n: 1 })
    const [b] = linesToSteps([{ text: 'Righe 3-6 – riga a rov' }], { kind: 'pelote', n: 1 })
    expect(a.note).toBeUndefined()
    expect(b.note).toBeUndefined()
  })
  it('« Riga 1 – riga a dir » (gras) n’est PAS promu en titre de section', () => {
    expect(isTitleLine({ text: 'Riga 1 – riga a dir', bold: true }, 11)).toBe(false)
  })
  it('NON-RÉGRESSION : « Rigido » (mot commençant par rig, sans a/he) n’est PAS pris pour un rang', () => {
    const [step] = linesToSteps([{ text: 'Rigido 3 palline disponibili per questo modello' }], { kind: 'pelote', n: 1 })
    expect(step.note).toBe(true)
  })
})

describe('mdlab reference — marqueur de rang italien compact « Gn » (Giro) n’est pas une abréviation', () => {
  const workSec = (texts) => [{ ref: null, kind: 'tete', intro: false, lines: texts.map((text) => ({ text, consumed: false })) }]
  it('un bloc « G1: … / G2: … / G3: … » (rangs Giro) reste dans le travail, pas avalé en abréviations', () => {
    const s = workSec(['G1: 6 mb nell’anello magico (6)', 'G2: [1 aum] x6 (12)', 'G3: [1 mb, 1 aum] x6 (18)'])
    const { stats } = extractReference(s, { n: 1 })
    expect(stats.abbrCount).toBe(0)
    expect(s[0].lines.every((l) => !l.consumed)).toBe(true)
  })
  it('« G 1: » (espace) et plage « G7-10: » aussi rejetés du balayage abréviations', () => {
    const s = workSec(['G 1: 6 mb (6)', 'G 2: [1 aum] x6 (12)', 'G7-10: 36 mb (4 giri, 36)'])
    const { stats } = extractReference(s, { n: 1 })
    expect(stats.abbrCount).toBe(0)
  })
  it('NON-RÉGRESSION : de VRAIES abréviations « dir/rov/gett » restent captées (g non suivi d’un chiffre)', () => {
    const s = workSec(['dir: diritto', 'rov: rovescio', 'gett: gettato'])
    const { stats } = extractReference(s, { n: 1 })
    expect(stats.abbrCount).toBe(3)
  })
})

describe('reference — referenceFieldForHeading (ancré)', () => {
  it('un titre/étiquette de référence matche ; une occurrence en pleine phrase ne matche pas', () => {
    expect(referenceFieldForHeading('Échantillon')).toBeTruthy()
    expect(referenceFieldForHeading('Échantillon : 20 m x 28 rangs')).toBeTruthy()
    expect(referenceFieldForHeading("mesuré sur l'échantillon principal")).toBeNull()
  })
  it('« Fibra: … » (espagnol, étiquette fil en ligne) route vers yarn', () => {
    // Patron ES crochet réel (Hilda the Horse) : « Fibra: Rainbow Cotton 8/4 » en
    // milieu d'intro ne matchait ni fils?/yarn/garn/… → restait en prose libre au
    // lieu de router vers ## Fil {yarn}.
    expect(referenceFieldForHeading('Fibra: Rainbow Cotton 8/4')).toBe('yarn')
  })
  it('« Materiales: … » (espagnol, étiquette matériel en ligne) route vers materials', () => {
    // Même patron : « Materiales: Ojos de seguridad 6 mm, relleno, alfileres… » ne
    // matchait pas la famille LABELS materials (distincte du titrage de section,
    // déjà couvert par KIND_KEYWORDS dans segment.js).
    expect(referenceFieldForHeading('Materiales: Ojos de seguridad 6 mm, relleno')).toBe('materials')
  })
  // hazy-whisper-sweater-de-3f672f59 (corpus réel, tricot, palier 6) : ẞ CAPITAL moderne
  // (U+1E9E, orthographe allemande correcte depuis 2017), pas « SS ». /i des regex LABELS
  // ne case-fold pas U+1E9E → U+00DF (ß) comme .toLowerCase() : « GRÖẞE »/« MAẞE » n'étaient
  // jamais reconnus.
  it('« GRÖẞE »/« MAẞE » (ẞ capital moderne) routent vers sizes/measures', () => {
    expect(referenceFieldForHeading('GRÖẞE')).toBe('sizes')
    expect(referenceFieldForHeading('MAẞE')).toBe('measures')
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

describe('steps — gras **…** sur ligne en gras', () => {
  it('une ligne bold devient un texte de step enrobé de **', () => {
    const steps = linesToSteps([{ text: 'Rang 1 : tricoter', bold: true }], { kind: 'corps', n: 1 })
    expect(steps[0].t).toBe('**Rang 1 : tricoter**')
  })
  it('une ligne non-bold reste nue', () => {
    const steps = linesToSteps([{ text: 'Rang 2 : tourner', bold: false }], { kind: 'corps', n: 1 })
    expect(steps[0].t).toBe('Rang 2 : tourner')
  })
})

describe('mdlab segment — un corps de patron numéroté « nu » sous les abréviations n’est pas avalé par abbr (retour Alexia, poncho Timeless Twister)', () => {
  // Reproduit la structure du poncho : page de garde avec un titre « Abréviations »,
  // ses paires clé:définition, PUIS le patron écrit numéroté « 1. … », « 2. … » collé
  // dessous sans mot de rang (« Tour »/« Rang »). Sans le fix, ces rangs restent dans la
  // section abbr et sont jetés à la sérialisation (glossaire = paires clé:déf seulement).
  const pages = [
    [
      L('Abréviations', 800, 13),
      L('ml: maille en l’air', 780),
      L('br: bride', 770),
      L('Br Rar: Bride relief arrière', 760),
      L('1. Monter 126 ml. Former un rond avec 1 mc dans la 1ère ml. (126)', 730),
      L('2. Faire 3 ml (comptent comme 1 br). Faire 1 br dans les 62 m suivantes.', 710),
      L('10. Br Rar dans les 94 m suivantes. Finir avec 1 mc.', 690),
    ],
  ]

  it('ferme abbr dès le 1er rang numéroté nu → une section Instructions distincte porte les rangs', () => {
    const secs = segmentSections(pages)
    const abbr = secs.find((s) => s.ref === 'abbr')
    const instr = secs.find((s) => s.ref == null && s.title === 'Instructions')
    // Les vraies abréviations restent dans le glossaire…
    expect(abbr.lines.some((l) => l.text.startsWith('ml:'))).toBe(true)
    // …mais AUCUN rang numéroté n’y reste.
    expect(abbr.lines.some((l) => l.text.startsWith('1. Monter 126 ml'))).toBe(false)
    // Les rangs 1, 2 et 10 atterrissent dans Instructions.
    expect(instr).toBeTruthy()
    expect(instr.lines.some((l) => l.text.startsWith('1. Monter 126 ml'))).toBe(true)
    expect(instr.lines.some((l) => l.text.startsWith('2. Faire 3 ml'))).toBe(true)
    expect(instr.lines.some((l) => l.text.startsWith('10. Br Rar'))).toBe(true)
  })

  it('non-régression : une vraie abréviation « clé : définition » ne déclenche PAS le split', () => {
    const secs = segmentSections([[
      L('Abréviations', 800, 13),
      L('ml: maille en l’air', 780),
      L('mc: maille coulée', 770),
    ]])
    // Aucune section Instructions parasite ne doit apparaître.
    expect(secs.find((s) => s.title === 'Instructions')).toBeFalsy()
    const abbr = secs.find((s) => s.ref === 'abbr')
    expect(abbr.lines.length).toBe(2)
  })

  it('non-régression : une rangée numérique du tableau des tailles sous abbr ne déclenche PAS le split', () => {
    const secs = segmentSections([[
      L('Abréviations', 800, 13),
      L('ml: maille en l’air', 780),
      L('Tour de poitrine 80 88 96 100 cm', 760),
    ]])
    expect(secs.find((s) => s.title === 'Instructions')).toBeFalsy()
  })

  it('non-régression : la garde ROW_START existante (« Tour 1 … ») ferme toujours abbr', () => {
    const secs = segmentSections([[
      L('Abréviations', 800, 13),
      L('ml: maille en l’air', 780),
      L('Tour 1: Monter 126 ml.', 760),
    ]])
    const instr = secs.find((s) => s.title === 'Instructions')
    expect(instr).toBeTruthy()
    expect(instr.lines.some((l) => l.text.startsWith('Tour 1'))).toBe(true)
  })
})

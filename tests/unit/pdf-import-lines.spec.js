import { describe, it, expect } from 'vitest'
import { itemsToLines, regionTwoColumns } from '@/utils/pdf-import/lines'

const it_ = (str, y, h = 10, fontName = 'f1') => ({ str, transform: [h, 0, 0, h, 40, y], height: h, fontName })

describe('itemsToLines', () => {
  it('regroupe les fragments par position verticale (tolérance 2.5)', () => {
    const lines = itemsToLines([it_('EXPLICA', 700), it_('TIONS', 701), it_('Monter 104 m.', 680)])
    expect(lines.map((l) => l.text)).toEqual(['EXPLICATIONS', 'Monter 104 m.'])
  })
  it('capte la taille de police et le gras via styles', () => {
    const styles = { fb: { fontFamily: 'Helvetica-Bold' }, f1: { fontFamily: 'Helvetica' } }
    const lines = itemsToLines([it_('Corps', 700, 16, 'fb'), it_('Rang 1 : tricoter.', 680, 10)], styles)
    expect(lines[0]).toMatchObject({ text: 'Corps', bold: true, size: 16 })
    expect(lines[1]).toMatchObject({ bold: false, size: 10 })
  })
  it('ignore les fragments vides et trim les lignes', () => {
    const lines = itemsToLines([it_('  ', 700), it_(' Rang 2 ', 680)])
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Rang 2')
  })
  it('déduplique les items strictement superposés (double frappe des titres décoratifs)', () => {
    // pdfjs émet deux items identiques quasi superposés pour les titres à contour
    // (« Patron », « Baby » des pages de garde Go handmade) → sans dédup : « PatronPatron ».
    const lines = itemsToLines([it_('Patron', 522, 30), it_('Patron', 522, 30), it_('Baby', 488, 24), it_('Baby', 488, 24)])
    expect(lines.map((l) => l.text)).toEqual(['Patron', 'Baby'])
  })
  it('ne déduplique PAS deux occurrences identiques éloignées en X (colonnes de tailles)', () => {
    const at = (str, x, y) => ({ str, transform: [10, 0, 0, 10, x, y], height: 10, fontName: 'f1' })
    const lines = itemsToLines([at('6 mois', 140, 157), at('6 mois', 176, 157)])
    expect(lines[0].text).toBe('6 mois 6 mois')
  })
  it('recolle un suffixe ordinal en exposant (« ème ») à la ligne de base au lieu d’ouvrir une rangée à part', () => {
    // Cas réel compass-rose-north-granny-square-fr-7515f217 : Hobbii compose « 3ème » avec le
    // chiffre en corps normal (h=10) et le suffixe « ème » en EXPOSANT, rehaussé de 4.49 pt
    // (y=693.61 contre y=689.12) et dans un corps plus petit (h=6). Le décalage dépasse Y_TOL
    // (2.5) : sans le garde-fou SUPERSCRIPT_SIZE_RATIO, « ème » ouvre sa propre rangée — promue
    // ensuite en puce autonome au milieu des rangs (ou happée en plein milieu d'une phrase par
    // reflow.js), et le chiffre perd son suffixe (« 3 » au lieu de « 3ème »).
    const lines = itemsToLines([
      it_('R1: 3 ml (chd), 15br, joindre avec mc dans 3', 689.12, 10),
      it_('ème', 693.61, 6),
      it_(' ml de chd.', 689.12, 10),
    ])
    expect(lines.map((l) => l.text)).toEqual(['R1: 3 ml (chd), 15br, joindre avec mc dans 3ème ml de chd.'])
  })
  it('n’absorbe PAS un fragment dont le ratio de corps dépasse SUPERSCRIPT_SIZE_RATIO (0.8 > 0.7)', () => {
    // Garde discriminant symétrique au cas positif ci-dessus : un fragment à peine plus
    // grand qu'un exposant (ratio 0.8, corps 8 sur une rangée de corps 10 — le seuil est
    // 0.7, le cas réel mesuré est 0.6) doit rester sur sa PROPRE rangée, même avec un
    // décalage vertical par ailleurs dans les clous (4 pt ≤ 0.6×10). Un seul fragment
    // suffit à isoler la question : pas de 3e item « retour à la ligne de base », dont la
    // fusion ultérieure (deux rangées de MÊME y se recollent toujours dans toLines,
    // indépendamment de ce garde-fou) brouillerait ce que ce test vérifie précisément.
    const lines = itemsToLines([
      it_('R1: 3 ml (chd), 15br, joindre avec mc dans 3', 689.12, 10),
      it_('ème', 693.12, 8),
    ])
    expect(lines.map((l) => l.text)).toEqual([
      'ème',
      'R1: 3 ml (chd), 15br, joindre avec mc dans 3',
    ])
  })
  it('n’absorbe PAS un fragment dont le décalage vertical dépasse SUPERSCRIPT_Y_OFFSET_RATIO (0.7×corps > 0.6×corps)', () => {
    // Garde discriminant symétrique : un fragment bien assez petit (ratio 0.6, comme le cas
    // réel) mais rehaussé au-delà du seuil (décalage 7 pt sur une rangée de corps 10 — le
    // seuil est 0.6×10=6, le cas réel mesuré est 0.45×10=4.49) doit lui aussi rester sur sa
    // propre rangée : passé ce seuil, ce n'est plus un exposant collé à la ligne mais un
    // vrai saut de ligne (ou une étiquette flottante).
    const lines = itemsToLines([
      it_('R1: 3 ml (chd), 15br, joindre avec mc dans 3', 689.12, 10),
      it_('ème', 696.12, 6),
    ])
    expect(lines.map((l) => l.text)).toEqual([
      'ème',
      'R1: 3 ml (chd), 15br, joindre avec mc dans 3',
    ])
  })
})

describe('itemsToLines — dé-colonnage N colonnes (PT1)', () => {
  const at = (str, x, y, h = 10) => ({ str, transform: [h, 0, 0, h, x, y], height: h, fontName: 'f1' })
  it('démêle 3 colonnes entrelacées par Y (ordre de lecture G→D, chaque colonne Y↓)', () => {
    // 3 colonnes à x≈20/200/380, 3 rangées entrelacées → 9 cellules
    const items = [
      at('C1 haut', 20, 300), at('C2 haut', 200, 300), at('C3 haut', 380, 300),
      at('C1 mid', 20, 280),  at('C2 mid', 200, 280),  at('C3 mid', 380, 280),
      at('C1 bas', 20, 260),  at('C2 bas', 200, 260),  at('C3 bas', 380, 260),
    ]
    const txt = itemsToLines(items, {}, { pageWidth: 561 }).map((l) => l.text)
    // colonne 1 entière (haut→bas), puis colonne 2, puis colonne 3
    expect(txt).toEqual(['C1 haut', 'C1 mid', 'C1 bas', 'C2 haut', 'C2 mid', 'C2 bas', 'C3 haut', 'C3 mid', 'C3 bas'])
  })
  it('une page mono-colonne est inchangée (pas de faux découpage)', () => {
    const items = [at('Rang 1', 40, 300), at('Rang 2', 40, 280), at('Rang 3', 40, 260)]
    expect(itemsToLines(items, {}, { pageWidth: 561 }).map((l) => l.text)).toEqual(['Rang 1', 'Rang 2', 'Rang 3'])
  })

  it('tag multiCol sur une page ≥3 colonnes, pas sur une mono-colonne', () => {
    // même construction d'items 3 colonnes que le test « démêle 3 colonnes »
    const items3 = [
      at('C1 haut', 20, 300), at('C2 haut', 200, 300), at('C3 haut', 380, 300),
      at('C1 mid', 20, 280),  at('C2 mid', 200, 280),  at('C3 mid', 380, 280),
      at('C1 bas', 20, 260),  at('C2 bas', 200, 260),  at('C3 bas', 380, 260),
    ]
    const lines = itemsToLines(items3, {}, { pageWidth: 561 })
    expect(lines.length > 0 && lines.every((l) => l.multiCol === true)).toBe(true)
    // même items que le test « page mono-colonne » ci-dessus
    const mono = [at('Rang 1', 40, 300), at('Rang 2', 40, 280), at('Rang 3', 40, 260)]
    expect(itemsToLines(mono, {}, { pageWidth: 561 }).some((l) => l.multiCol)).toBe(false)
  })

  it('exclut les cotes isolées (isChartLabel) du calcul des modes de colonnes', () => {
    // 3 colonnes réelles x≈20/200/380 + nombres isolés parasites à x=110 (entre col1 et
    // col2), sur les mêmes rangées Y. Sans isChartLabel, ces nombres formeraient un 4e
    // cluster de plein droit (≥ MIN_COL_CELLS, entrelacé par Y avec les vraies colonnes
    // via ces mêmes rangées) → detectColumns donnerait 4 colonnes au lieu de 3, et les
    // parasites sortiraient comme un bloc-colonne séparé entre col1 et col2 au lieu
    // d'être rattachés à la colonne 1 (comportement attendu : rattachés, jamais perdus).
    const items = [
      at('C1 haut', 20, 300), at('53', 110, 300), at('C2 haut', 200, 300), at('C3 haut', 380, 300),
      at('C1 mid', 20, 280), at('54', 110, 280), at('C2 mid', 200, 280), at('C3 mid', 380, 280),
      at('C1 bas', 20, 260), at('27-28', 110, 260), at('C2 bas', 200, 260), at('C3 bas', 380, 260),
    ]
    const txt = itemsToLines(items, {}, { pageWidth: 561 }).map((l) => l.text)
    expect(txt).toEqual([
      'C1 haut 53', 'C1 mid 54', 'C1 bas 27-28',
      'C2 haut', 'C2 mid', 'C2 bas',
      'C3 haut', 'C3 mid', 'C3 bas',
    ])
  })

  it('exclut les glyphes corrompus (isGlyphOnly) du calcul des modes de colonnes', () => {
    // Même construction que le test isChartLabel ci-dessus (3 colonnes réelles x≈20/200/380
    // + parasites isolés à x=110, mêmes rangées Y), mais avec de VRAIS caractères de
    // contrôle Unicode (codes 31/30/29 — Unit/Record/Group Separator) — extraits tels
    // quels du PDF réel ranveig-fr-53fafc7c (grille crochet en police de symboles sans
    // table ToUnicode). String.fromCharCode plutôt qu'un littéral \u dans le code source :
    // ces caractères sont invisibles/non imprimables, fromCharCode évite tout risque de
    // corruption au copier-coller ou à la transmission du fichier. Sans isGlyphOnly, ces
    // fragments formeraient un 4e cluster de plein droit → detectColumns donnerait 4
    // colonnes au lieu de 3, exactement le bug qui éclate le glossaire Abréviations du PDF
    // réel (9 entrées perdues sur 9).
    const ctrl31 = String.fromCharCode(31)
    const ctrl30 = String.fromCharCode(30)
    const ctrl29 = String.fromCharCode(29)
    const items = [
      at('C1 haut', 20, 300), at(ctrl31, 110, 300), at('C2 haut', 200, 300), at('C3 haut', 380, 300),
      at('C1 mid', 20, 280), at(ctrl30, 110, 280), at('C2 mid', 200, 280), at('C3 mid', 380, 280),
      at('C1 bas', 20, 260), at(ctrl29, 110, 260), at('C2 bas', 200, 260), at('C3 bas', 380, 260),
    ]
    const txt = itemsToLines(items, {}, { pageWidth: 561 }).map((l) => l.text)
    expect(txt).toEqual([
      `C1 haut ${ctrl31}`, `C1 mid ${ctrl30}`, `C1 bas ${ctrl29}`,
      'C2 haut', 'C2 mid', 'C2 bas',
      'C3 haut', 'C3 mid', 'C3 bas',
    ])
  })

  it('bascule en tableau (isGridToken) une page de jetons de grille numérique, pas de prose', () => {
    // 4 colonnes réelles x=20/110/200/380, 12 cellules : x=20 = étiquettes (texte réel),
    // x=110/200/380 = jetons de grille numérique (fractions "56/14"/"9/10/9", suffixes
    // "0x"/"1x"/"2x") — ni isChartLabel ni isGlyphOnly ne les filtrent (slash et "x" hors
    // de leur alphabet), donc detectColumns les verrait comme 4 vraies colonnes de prose
    // sans ce garde-fou de contenu, et lirait colonne entière par colonne entière
    // (charabia, reproduit sur le PDF réel socks-with-diamond-pattern-r0398-fr, cf. spec
    // cas A).
    const items = [
      at('Montage', 20, 300), at('56/14', 110, 300), at('9/10/9', 200, 300), at('0x', 380, 300),
      at('Mailles', 20, 280), at('60/15', 110, 280), at('10/10/10', 200, 280), at('1x', 380, 280),
      at('Longueur', 20, 260), at('64/16', 110, 260), at('10/12/10', 200, 260), at('2x', 380, 260),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 561 })
    expect(lines.map((l) => l.text)).toEqual([
      'Montage 56/14 9/10/9', 'Mailles 60/15 10/10/10', 'Longueur 64/16 10/12/10',
      '0x', '1x', '2x',
    ])
    expect(lines.every((l) => !l.multiCol)).toBe(true)
  })

  it('exclut les comptages de mailles entre parenthèses (isChartLabel étendu) du calcul des modes de colonnes', () => {
    // Même construction que le test isChartLabel bare-numbers, avec des jetons "(N)" —
    // comptages de mailles réels tels qu'extraits du PDF bathing-bunnies-en-1bdcf271 (page
    // d'instructions 2-colonnes NORMALE, comptages en fin de rang, ex. "(6)", "(12)",
    // "(13)"). Sans l'extension, ces jetons forment un 4e cluster de plein droit →
    // detectColumns sur-détecte, fragmentant l'ordre de lecture sur presque tout le corps
    // du patron (LEGS/BODY/HEAD/EARS/ARMS dans le PDF réel).
    const items = [
      at('C1 haut', 20, 300), at('(6)', 110, 300), at('C2 haut', 200, 300), at('C3 haut', 380, 300),
      at('C1 mid', 20, 280), at('(12)', 110, 280), at('C2 mid', 200, 280), at('C3 mid', 380, 280),
      at('C1 bas', 20, 260), at('(13)', 110, 260), at('C2 bas', 200, 260), at('C3 bas', 380, 260),
    ]
    const txt = itemsToLines(items, {}, { pageWidth: 561 }).map((l) => l.text)
    expect(txt).toEqual([
      'C1 haut (6)', 'C1 mid (12)', 'C1 bas (13)',
      'C2 haut', 'C2 mid', 'C2 bas',
      'C3 haut', 'C3 mid', 'C3 bas',
    ])
  })
  it('n’exclut PAS une répétition entre parenthèses contenant du texte réel', () => {
    // Garde anti faux-positif : "(K1, P1) rep" contient des lettres, ne doit JAMAIS matcher
    // isChartLabel (bare ou étendu) — sinon une vraie instruction entre parenthèses
    // disparaîtrait à tort du calcul des colonnes.
    //
    // Signature tracée à la main sur l'algorithme réel : si "(K1, P1) rep" N'EST PAS exclu
    // (comportement correct attendu), il forme son PROPRE 4e cluster réel (x=110, à >60pt
    // de tout voisin → pas fusionné ; partage ses 3 rangées Y avec les 3 autres colonnes →
    // pas élagué comme solitaire) → 4 colonnes au lieu de 3, et "(K1, P1) rep" ressort
    // comme sa PROPRE colonne dans la sortie (jamais fusionné avec C1), pas comme du texte
    // accolé à "C1 haut" (ce qui serait le signe qu'il a été exclu à tort, comme pour
    // "53"/"(6)" dans les tests voisins).
    const items = [
      at('C1 haut', 20, 300), at('(K1, P1) rep', 110, 300), at('C2 haut', 200, 300), at('C3 haut', 380, 300),
      at('C1 mid', 20, 280), at('(K1, P1) rep', 110, 280), at('C2 mid', 200, 280), at('C3 mid', 380, 280),
      at('C1 bas', 20, 260), at('(K1, P1) rep', 110, 260), at('C2 bas', 200, 260), at('C3 bas', 380, 260),
    ]
    const txt = itemsToLines(items, {}, { pageWidth: 561 }).map((l) => l.text)
    expect(txt).toEqual([
      'C1 haut', 'C1 mid', 'C1 bas',
      '(K1, P1) rep', '(K1, P1) rep', '(K1, P1) rep',
      'C2 haut', 'C2 mid', 'C2 bas',
      'C3 haut', 'C3 mid', 'C3 bas',
    ])
  })

  it('fusionne une légende courte collée à une colonne voisine (< MIN_COL_WIDTH) plutôt que de faire échouer la détection', () => {
    // Légende à x=70, à 50pt de la colonne A (x=20, < MIN_COL_WIDTH=60) mais isolée en
    // cluster brut (écart 50 > CLUSTER_GAP=40) : sans la fusion, on aurait 4 clusters
    // [20,70,250,430] dont l'écart 70-20=50 < MIN_COL_WIDTH violerait la garde finale
    // → detectColumns renverrait null → page NON dé-colonnée (zip par rangée, texte
    // mélangé). Avec la fusion, la légende est absorbée dans la colonne A : 3 colonnes,
    // rien perdu.
    const items = [
      at('A haut', 20, 300), at('Lgd1', 70, 300), at('B haut', 250, 300), at('C haut', 430, 300),
      at('A mid', 20, 280), at('Lgd2', 70, 280), at('B mid', 250, 280), at('C mid', 430, 280),
      at('A bas', 20, 260), at('Lgd3', 70, 260), at('B bas', 250, 260), at('C bas', 430, 260),
    ]
    const txt = itemsToLines(items, {}, { pageWidth: 700 }).map((l) => l.text)
    expect(txt).toEqual([
      'A haut Lgd1', 'A mid Lgd2', 'A bas Lgd3',
      'B haut', 'B mid', 'B bas',
      'C haut', 'C mid', 'C bas',
    ])
  })

  it('élague une colonne candidate solitaire (aucune rangée Y partagée) sans casser les 3 vraies colonnes', () => {
    // 3 vraies colonnes entrelacées (x=20/200/380, rangées y=300/280/260) + un 4e
    // cluster « solitaire » à x=290 sur des rangées Y (295/275/255) qu'aucune autre
    // colonne ne partage. Sans l'élagage MIN_SHARED_ROWS, ce cluster survivrait comme
    // 4e colonne À PART (bloc contigu inséré après le bloc colonne 2, jamais entrelacé
    // avec son contenu) ; avec l'élagage, il est retiré de detectColumns puis rattaché
    // (colOf) à la colonne 2 voisine — ses lignes se retrouvent ENTRELACÉES avec celles
    // de la colonne 2 (tri par Y) : signature observable qui distingue les deux cas.
    // Rangées de bourrage (y=500/50, 3 colonnes) : élargit l'étendue Y pour que la bande
    // 6%-94% de detectColumns n'ampute pas les rangées utiles (sinon, avec seulement 3
    // rangées 255-300, elle exclurait justement les rangées extrêmes et fausserait le test).
    const items = [
      at('C1 pad+', 20, 500), at('C2 pad+', 200, 500), at('C3 pad+', 380, 500),
      at('C1 haut', 20, 300), at('C2 haut', 200, 300), at('Solo1', 290, 295), at('C3 haut', 380, 300),
      at('C1 mid', 20, 280), at('C2 mid', 200, 280), at('Solo2', 290, 275), at('C3 mid', 380, 280),
      at('C1 bas', 20, 260), at('C2 bas', 200, 260), at('Solo3', 290, 255), at('C3 bas', 380, 260),
      at('C1 pad-', 20, 50), at('C2 pad-', 200, 50), at('C3 pad-', 380, 50),
    ]
    const txt = itemsToLines(items, {}, { pageWidth: 561 }).map((l) => l.text)
    expect(txt).toEqual([
      'C1 pad+', 'C1 haut', 'C1 mid', 'C1 bas', 'C1 pad-',
      'C2 pad+', 'C2 haut', 'Solo1', 'C2 mid', 'Solo2', 'C2 bas', 'Solo3', 'C2 pad-',
      'C3 pad+', 'C3 haut', 'C3 mid', 'C3 bas', 'C3 pad-',
    ])
  })
})

describe('itemsToLines — cas D : ancres de tour + continuité numérique (2 colonnes)', () => {
  const at = (str, x, y, h = 10) => ({ str, transform: [h, 0, 0, h, x, y], height: h, fontName: 'f1' })

  it('entrelace une séquence numérotée continue SANS AUCUNE ancre de tour sur la page (the-sheep-lambert-and-lana-es)', () => {
    // Réplique la page « Hendiduras » du PDF brebis : 6 items numérotés continus 1-6,
    // répartis 1/3/5 à gauche et 2/4/6 à droite, aucun titre « Nème tour ». C'est le cas
    // qui exerce le bug d'amorçage trouvé en prototypant : sans ancre sur la page, la
    // boucle de fusion par région ne doit PAS rester inerte (elle doit couvrir toute la
    // page par défaut) — sinon tout retombe silencieusement en bloc gauche-puis-droite.
    const items = [
      at('1. Primero paso.', 40, 700), at('2. Segundo paso.', 320, 700),
      at('3. Tercero paso.', 40, 670), at('4. Cuarto paso.', 320, 670),
      at('5. Quinto paso.', 40, 640), at('6. Sexto paso.', 320, 640),
      at('Continuar rematando.', 40, 610), at('Nota final.', 320, 610),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      '1. Primero paso.', '2. Segundo paso.',
      '3. Tercero paso.', '4. Cuarto paso.',
      '5. Quinto paso.', 'Continuar rematando.',
      '6. Sexto paso.', 'Nota final.',
    ])
  })

  it('garde la lecture en bloc quand une ancre de tour est présente DANS CHAQUE colonne (tours côte à côte, non entrelacés)', () => {
    // Rangées de bourrage (y=900/500, même principe que le test « élague une colonne
    // candidate solitaire » du describe « dé-colonnage N colonnes (PT1) » plus haut dans ce
    // fichier) : élargit l'étendue Y pour que la bande 6%-94% de detectColumnGutter n'ampute
    // pas les 3 rangées utiles (700/680/660) — avec seulement ces 3 rangées (6 cellules),
    // la bande exclurait les 2 rangées extrêmes ET on resterait sous le seuil
    // narrow.length>=6 de detectColumnGutter (bimodalité aussi sous son seuil
    // filled.length>=8) : twoCols resterait à false, aucune détection 2-colonnes ne
    // s'engagerait, et les items de gauche/droite se retrouveraient fusionnés sur une même
    // ligne au lieu d'être testés par le mécanisme cas D. Avec les 2 rangées de bourrage,
    // narrow.length atteint exactement 6 (3 rangées utiles × 2 colonnes) : suffisant.
    // 2 titres de tour à la même hauteur (un par colonne), chacun avec son propre item
    // « 1. » — même numéro des deux côtés, donc PAS de continuité 1,2,3… : ces 2 tours
    // sont des blocs indépendants, à lire colonne gauche entière puis colonne droite
    // entière, jamais entrelacés ligne à ligne.
    const items = [
      at('G pad+', 40, 900), at('D pad+', 320, 900),
      at('4ème tour', 40, 700), at('5ème tour', 320, 700),
      at('1. Faire des mc jusqu’à l’espace.', 40, 680), at('1. Faire des mc jusqu’à l’espace bis.', 320, 680),
      at('Finir avec 1 mc.', 40, 660), at('Finir avec 1 mc bis.', 320, 660),
      at('G pad-', 40, 500), at('D pad-', 320, 500),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'G pad+', 'D pad+',
      '4ème tour', '1. Faire des mc jusqu’à l’espace.', 'Finir avec 1 mc.', 'G pad-',
      '5ème tour', '1. Faire des mc jusqu’à l’espace bis.', 'Finir avec 1 mc bis.', 'D pad-',
    ])
  })

  it('décide indépendamment par région d’une même page : un tour reste bloc, le suivant s’entrelace (classical-attitude-poncho-adult-size-fr)', () => {
    // Réplique la structure réelle du poncho : le « 6ème tour » n’a qu’UN item par colonne
    // (pas de continuité, reste bloc) ; le « 7ème tour » qui suit a 4 items continus
    // entrelacés entre les 2 colonnes. Une seule ancre par région ici (jamais dans les 2
    // colonnes à la fois) — vérifie que la boucle à PLUSIEURS régions (2 ancres) découpe
    // bien la page et prend une décision indépendante dans chacune.
    const items = [
      at('6ème tour', 40, 900),
      at('1. Faire des mc jusqu’à l’espace.', 40, 880), at('Finir avec 1 mc.', 320, 880),
      at('7ème tour', 40, 700),
      at('1. Faire des mc.', 40, 680), at('2. Faire 3 ml.', 320, 680),
      at('3. Crocheter 1 b.', 40, 660), at('4. Finir avec 1 mc.', 320, 660),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      '6ème tour', '1. Faire des mc jusqu’à l’espace.', 'Finir avec 1 mc.',
      '7ème tour', '1. Faire des mc.', '2. Faire 3 ml.', '3. Crocheter 1 b.', '4. Finir avec 1 mc.',
    ])
  })

})

describe('itemsToLines — bimodalité 2 colonnes : bruit de bande extrême (pied de page)', () => {
  const at = (str, x, y, w, h = 12) => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h, fontName: 'f1' })

  it('un pied de page pleine largeur ne doit pas faire échouer la détection de 2 colonnes (crochet-cotton-makeup-pads-de-921e621a)', () => {
    // Transcription littérale des items pdf.js de la page 1 (mesurés via pdf.js sur le PDF
    // réel) : bloc « Material » (colonne gauche, x≈73-110) et bloc « Abkürzungen » (colonne
    // droite, x≈324) posés côte à côte, un titre centré pleine largeur (bandeau légitime,
    // PAS en bande Y extrême) et un pied de page Hobbii pleine largeur (bande Y extrême).
    // Avant correctif : le pied de page comptait comme cellule « spanning » en plus du
    // titre (2 > 0.1×18 = 1.8), twoCols basculait à false, et toute la page retombait en
    // lecture mono-flux — « − Häkelnadel Nr. 4 » (taille d'aiguille, gauche, y=251.93) et
    // « Lftm: Luftmasche(n) » (glossaire, droite, y=249.65) tombaient à 2.28pt d'écart en Y
    // (sous Y_TOL=2.5, coïncidence de mise en page) et se recollaient sur une seule ligne :
    // la taille d'aiguille disparaissait, le glossaire fuyait en puce illisible.
    const items = [
      at('Hobbii.de - Copyright © 2018 - Alle Rechte vorbehalten', 40.68, 26.64, 296.41),
      at(' ', 337.09, 26.64, 127.41, 0),
      at('seite', 464.50, 26.40, 25.38),
      at(' ', 489.88, 26.40, 2.70, 0),
      at('1', 492.58, 26.40, 6.65),
      at('', 137.42, 336.05, 0, 0),
      at('Gehäkelte Kosmetikpads', 137.42, 336.05, 320.31, 27.96),
      at('', 73.70, 274.85, 0, 0),
      at('Material:', 73.70, 274.85, 50.28),
      at('', 91.70, 251.93, 0, 0),
      at('−', 91.70, 251.93, 6.59),
      at(' ', 98.29, 251.93, 11.41, 0),
      at('Häkelnadel Nr. 4', 109.70, 251.93, 85.36),
      at('', 91.70, 235.10, 0, 0),
      at('−', 91.70, 235.10, 6.59),
      at(' ', 98.29, 235.10, 11.41, 0),
      at('Rainbow 8/4 Cotton', 109.70, 235.10, 104.26),
      at('', 73.70, 212.90, 0, 0),
      at('Hier erhältst Du Garn und Zubehör:', 73.70, 212.90, 190.60),
      at('', 73.70, 190.82, 0, 0),
      at('http://shop.hobbii.de/Gehakelte-', 73.70, 190.82, 172.25),
      at('Kosmetikpads', 73.70, 174.62, 72.94),
      at('', 73.70, 142.22, 0, 0),
      at('Maße:', 73.70, 142.22, 34.56),
      at(' ', 108.26, 142.22, 2.64, 0),
      at('Durchmesser von ca. 6,5 cm', 110.90, 142.22, 142.68),
      at('', 73.70, 120.02, 0, 0),
      at('Verbrauch:', 73.70, 120.02, 61.92),
      at(' ', 135.62, 120.02, 2.64, 0),
      at('Ca. 6g prp Kosmetikpad', 138.26, 120.02, 121.68),
      at('', 324.77, 271.85, 0, 0),
      at('Abkürzungen:', 324.77, 271.85, 78.02),
      at('', 324.77, 249.65, 0, 0),
      at('Lftm:', 324.77, 249.65, 29.06),
      at(' ', 353.83, 249.65, 2.64, 0),
      at('Luftmasche(n)', 356.47, 249.65, 75.36),
      at('', 324.77, 227.42, 0, 0),
      at('M:', 324.77, 227.42, 13.58),
      at(' ', 338.35, 227.42, 2.64, 0),
      at('Masche(n)', 340.99, 227.42, 54.48),
      at('', 324.77, 205.34, 0, 0),
      at('Km:', 324.77, 205.34, 22.22),
      at(' ', 346.99, 205.34, 2.64, 0),
      at('Kettmasche(n)', 349.63, 205.34, 76.18),
      at('', 324.77, 183.14, 0, 0),
      at('fM:', 324.77, 183.14, 17.54),
      at(' ', 342.31, 183.14, 2.64, 0),
      at('feste Masche(n)', 344.95, 183.14, 81.59),
      at('', 324.77, 160.94, 0, 0),
      at('Stb:', 324.77, 160.94, 21.02),
      at(' ', 345.79, 160.94, 2.64, 0),
      at('Stäbchen', 348.43, 160.94, 46.96),
      at('hobbii-pattern-sku:pattern-1000833', 2.85, 840.99, 20.40, 1),
      at('', 2.85, 1.22, 0, 0),
      at('Powered by TCPDF (www.tcpdf.org)', 2.85, 1.22, 16.17, 1),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 595.32 }).map((l) => l.text)
    expect(lines).toContain('− Häkelnadel Nr. 4')
    expect(lines).toContain('Lftm: Luftmasche(n)')
    expect(lines).not.toContain('− Häkelnadel Nr. 4 Lftm: Luftmasche(n)')
  })

  it('n’exclut PAS un vrai paragraphe pleine largeur en plein corps de page (pas en bande Y extrême)', () => {
    // Garde discriminante : la bande 6%-94% ne doit retirer que le pied de page et
    // l'en-tête (bords Y du RANGE observé), jamais un paragraphe qui enjambe réellement
    // les deux colonnes AU MILIEU de la page. Sans cette garde, le correctif deviendrait
    // trop permissif et casserait la protection anti-faux-positif existante (une page à
    // vraiment une seule colonne de prose ne doit jamais être découpée en 2 flux).
    // Rangées de bourrage (y=900/400, même principe que le describe « cas D » plus haut)
    // pour étendre l'étendue Y sans que la bande 6%-94% ampute les rangées utiles (620-700).
    const items = [
      at('Gpad', 40, 900, 30), at('Dpad', 320, 900, 30),
      at('L1', 40, 700, 10), at('R1', 320, 700, 10),
      at('Ceci est une phrase assez longue pour traverser toute la largeur de la page.', 40, 660, 400),
      at('Deuxième ligne de la même phrase, tout aussi large que la précédente ici.', 40, 640, 400),
      at('Troisième ligne, toujours aussi large, qui ponte les deux colonnes visées.', 40, 620, 400),
      at('Gpad2', 40, 400, 30), at('Dpad2', 320, 400, 30),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 }).map((l) => l.text)
    // twoCols reste false : L1/R1, à la MÊME ordonnée, se recollent sur une seule ligne
    // (lecture mono-flux), au lieu de rester deux lignes séparées comme le ferait une
    // vraie détection 2-colonnes.
    expect(lines).toContain('L1 R1')
    expect(lines).not.toContain('L1')
    expect(lines).not.toContain('R1')
  })

  it('n’exclut PAS un vrai paragraphe de plusieurs rangées tombé par coïncidence en bande Y extrême (angle mort de revue)', () => {
    // Trouvé en revue de code sur excludeExtremeBands (première version de ce correctif,
    // appliquée telle quelle à `spanning`) : la bande 6%-94% est calculée sur le RANGE Y
    // observé sur la page, pas sur une position physique absolue — un vrai paragraphe de
    // plusieurs lignes peut donc y tomber par pure coïncidence de mise en page (peu de
    // contenu au-dessus/en-dessous de lui). Sans discriminant supplémentaire, retirer
    // TOUTE cellule de la bande (comme le ferait excludeExtremeBands seule) aurait effacé
    // ce paragraphe du calcul de `spanning`, perdant la preuve qui bloque à raison une
    // scission en 2 colonnes — exactement le même effet que le bug corrigé, mais sur du
    // contenu légitime cette fois. Répro : detectColumnGutter échoue ici (le « Blocker »
    // pleine largeur en milieu de page bloque le corridor, même mécanisme que le titre
    // Hobbii du bug réel) et un paragraphe légitime de 3 rangées se trouve entièrement
    // dans la bande basse (0-6% du range Y, definie par les 2 rangées de bourrage
    // TopAnchor/BotAnchor). Discriminant retenu (spanningCandidates, lines.js) : une bande
    // n'est écartée du veto QUE si elle ne contient qu'UNE SEULE rangée candidate — un
    // pied de page réel (cf. test crochet-cotton-makeup-pads-de-921e621a ci-dessus) tient
    // sur une seule rangée, jamais un vrai paragraphe de plusieurs lignes consécutives.
    const items = [
      at('TopAnchor', 40, 1000, 10), at('BotAnchor', 40, 0, 10),
      at('L1', 40, 700, 10), at('R1', 320, 700, 10),
      at('L2', 40, 680, 10), at('R2', 320, 680, 10),
      at('L3', 40, 660, 10), at('R3', 320, 660, 10),
      at('L4', 40, 640, 10), at('R4', 320, 640, 10),
      at('Blocker qui bloque le corridor de la gouttiere text', 140, 620, 320),
      at('Paragraphe legitime ligne un pleine largeur ici la', 40, 50, 400),
      at('Paragraphe legitime ligne deux pleine largeur ici la', 40, 40, 400),
      at('Paragraphe legitime ligne trois pleine largeur ici la', 40, 30, 400),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 600 }).map((l) => l.text)
    // twoCols reste false malgré l'échec de detectColumnGutter : L1/R1 (même ordonnée) se
    // recollent sur une seule ligne (lecture mono-flux), preuve que le paragraphe légitime
    // a bien compté dans le veto `spanning`. (Vérifié au chantier colonnage par région :
    // le repli régional garde aussi cette page inchangée — sa bande L/R n'a que 2 rangées
    // hors bandes extrêmes régionales, trop peu pour la gouttière, et la voie bimodale
    // régionale n'existe pas.)
    expect(lines).toContain('L1 R1')
    expect(lines).not.toContain('L1')
    expect(lines).not.toContain('R1')
  })

  it('un SEUL candidat spanning en bande extrême doit quand même être exclu (garde-fou de bord, revue round 2)', () => {
    // Trouvé en revue de code (deuxième passe) sur spanningCandidates : `if (all.length < 2)
    // return all` court-circuitait la discrimination bande/rangée dès qu'il n'y avait
    // qu'UN SEUL candidat spanning — exactement la signature d'un pied de page isolé que
    // cette fonction doit exclure (cf. commentaire de spanningCandidates). Avec `< 2`, ce
    // candidat unique était renvoyé SANS jamais vérifier s'il tombait en bande extrême,
    // le gardant à tort dans `spanning` et empêchant twoCols de basculer à raison en
    // 2-colonnes. Transcription littérale des items pdf.js réels de la page de garde
    // ladies-pullover-s9404-fr-3d63efde (pageWidth=671.811) : une seule ligne pleine
    // largeur qualifie comme candidat spanning (« MEZ GmbH, 2019… », x=230.40,
    // endX=483.08, y=28.45, bande basse) — les 2 blocs indépendants (« Pull femme » /
    // « S9404 » à droite, « schachenmayr.com » / « Follow us » à gauche) fusionnaient à
    // tort en un seul flux avant ce correctif.
    const items = [
      at('MEZ GmbH, 2019. Nos modèles sont protégés par les droits d‘auteur', 230.40, 28.45, 252.68),
      at('', 407.06, 146.07, 0, 0),
      at('Pull femme', 407.06, 146.07, 230.02),
      at('', 590.31, 197.55, 0, 0),
      at('S9404', 590.31, 197.55, 46.76),
      at('', 33.86, 59.87, 0, 0),
      at('schachenmayr.com', 33.86, 59.87, 173.93),
      at('', 33.70, 34.18, 0, 0),
      at('Follow us', 33.70, 34.18, 48.29),
      at(' ', 82.00, 34.18, 45.52, 0),
      at('3', 591.86, 36.22, 7.08),
      at('hobbii-pattern-sku:pattern-S9404', 3.20, 957.14, 21.70),
      at('', 3.20, 8.20, 0, 0),
      at('Powered by TCPDF (www.tcpdf.org)', 3.20, 8.20, 18.27),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 671.811 }).map((l) => l.text)
    expect(lines).toContain('schachenmayr.com')
    expect(lines).toContain('Follow us')
    expect(lines).not.toContain('Follow us 3')
    expect(lines).not.toContain('MEZ GmbH, 2019. Nos modèles sont protégés par les droits d‘auteur Pull femme')
  })

  it('aucun candidat spanning du tout ne doit jamais faire planter spanningCandidates', () => {
    // Non-régression du garde-fou ci-dessus dans l’autre sens : `all.length === 0` doit
    // rester le SEUL cas court-circuité (Math.min/max sur un tableau vide renverrait
    // Infinity/-Infinity sinon) — une page sans aucune cellule qui enjambe les 2 colonnes
    // ne doit ni planter, ni changer de comportement.
    const items = [
      at('L1', 40, 700, 10), at('R1', 320, 700, 10),
      at('L2', 40, 680, 10), at('R2', 320, 680, 10),
      at('L3', 40, 660, 10), at('R3', 320, 660, 10),
      at('L4', 40, 640, 10), at('R4', 320, 640, 10),
    ]
    expect(() => itemsToLines(items, {}, { pageWidth: 600 })).not.toThrow()
  })
})

// Helper local : item pdf.js à abscisse choisie (le `it_` existant fixe x=40).
const at = (str, y, x, w = 10, h = 9, fontName = 'f1') => ({
  str, transform: [h, 0, 0, h, x, y], width: w, height: h, fontName,
})

describe('itemsToLines — positions des morceaux (parts)', () => {
  it('porte l’abscisse de chaque morceau', () => {
    // Cas réel crossbody-belt-bag-velvet-fr p.3 : « m » x=48, espace x=54, « Maille(s) » x=102
    const [l] = itemsToLines([at('m', 520, 48, 6), at(' ', 520, 54, 3), at('Maille(s)', 520, 102, 40)])
    expect(l.text).toBe('m Maille(s)')
    expect(l.parts.map((p) => p.x)).toEqual([48, 54, null, 102])
    expect(l.parts.map((p) => p.text).join('').replace(/\s{2,}/g, ' ').trim()).toBe(l.text)
  })

  it('garde les positions quand la clé et la définition sont dans la MÊME cellule', () => {
    // Cas réel crossbody : écart 4,5 pt < X_GAP (18) → une seule cellule, mais la définition
    // commence bien à x=102 comme les autres entrées.
    const [l] = itemsToLines([at('2 demi-br aug', 432, 48, 49), at(' ', 432, 97, 3), at('Augmentation', 432, 102, 50)])
    expect(l.text).toBe('2 demi-br aug Augmentation')
    expect(l.parts.map((p) => p.x)).toEqual([48, 97, 102])
  })

  it('insère un séparateur x=null entre deux cellules sœurs recollées', () => {
    const [l] = itemsToLines([at('m', 520, 48, 6), at('Maille(s)', 520, 102, 40)])
    expect(l.parts).toEqual([
      { x: 48, text: 'm' },
      { x: null, text: ' ' },
      { x: 102, text: 'Maille(s)' },
    ])
  })

  it('retire la puce du premier morceau sans supprimer le morceau (invariant préservé)', () => {
    // Ajouté en revue (hors liste initiale) : la puce et les premiers mots partagent le
    // même item PDF dans le cas réel motivant ce module (« • Crocheter une chaînette ») —
    // sans cette garde parts[0] garderait le glyphe alors que text l'a déjà retiré.
    const [l] = itemsToLines([at('• Crocheter une chaînette', 500, 48, 90)])
    expect(l.text).toBe('Crocheter une chaînette')
    expect(l.parts).toEqual([{ x: 48, text: 'Crocheter une chaînette' }])
    expect(l.parts.map((p) => p.text).join('').replace(/\s{2,}/g, ' ').trim()).toBe(l.text)
  })

  it('retire la puce même précédée d’un espacement de tête dans le même morceau (revue)', () => {
    // Ajouté suite relecture : la regex verbatim d'origine (`^[●•◦▪‣⁃∙]\s+`) échoue si
    // parts[0] porte un espace AVANT la puce (« '  • Crocheter…' ») — text est déjà .trim()é
    // ailleurs donc la puce y est bien en position 0, mais parts[0] brut ne l'est pas :
    // sans le retrait préalable de l'espacement de tête, ce test échouerait (le glyphe
    // fuirait dans parts alors que text l'a déjà retiré).
    const [l] = itemsToLines([at('  • Crocheter une chaînette', 500, 48, 90)])
    expect(l.text).toBe('Crocheter une chaînette')
    expect(l.parts).toEqual([{ x: 48, text: 'Crocheter une chaînette' }])
  })
})

// No-loss : chaque texte d'item non vide doit se retrouver dans la sortie exactement une
// fois PAR OCCURRENCE (les textes des fixtures sont uniques ou comptés, jamais l'un
// sous-chaîne d'un autre) — les régions partitionnent `filled`, aucune cellule ne se perd.
// Hoisté au niveau module : partagé par les describes V1 (colonnage par région) et V2a
// (grilles appariées) de ce fichier.
const expectNoLoss = (lines, items) => {
  const counts = new Map()
  for (const it of items) {
    const t = it.str.trim()
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  for (const [t, n] of counts) {
    const got = lines.filter((l) => l.text.includes(t)).length
    if (got !== n) throw new Error(`no-loss « ${t} » : ${got} ligne(s) en sortie, ${n} attendu(s)`)
  }
}

// Fixture meris-tee p7 (W=596, géométrie mesurée) + sortie V1 attendue — hoistées pour
// être réutilisées telles quelles par le contre-échantillon V2a (la table Step‖MEANING ne
// doit JAMAIS signer grille appariée : les « Step N: » sont des préfixes de phrases
// longues, pas des colonnes clés étroites — la sortie doit rester identique à la V1).
// Même signature que le `at` local du describe V1 ci-dessous (hoist = hors de sa portée).
const mk = (str, x, y, w, h = 10) => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h, fontName: 'f1' })
const merisP7Items = [
  // intro : 2 rangées séparatrices (cellule unique depuis la marge gauche)
  mk('To achieve that, the example increase round would be worked like this:', 60, 781, 370),
  mk('(Remember, the INC to work in this example was m5oo1-B4-S2)', 60, 766, 345),
  // table Step ‖ MEANING : rangées splittables (gap [299,318]=19pt DANS la zone médiane)
  mk('INSTRUCTIONS', 120, 742, 82), mk('MEANING', 318, 742, 53),
  mk('Step 1: k across half back stitches to INC', 66, 727, 233), mk('k across half back until the next 7 st', 318, 727, 208),
  mk('of previous rnd,', 120, 711, 60), mk('7 sts on your LH needle will be', 318, 711, 205),
  mk('ones from the m7oo1 of the previous', 318, 695, 193), // wrap : cellule droite seule
  mk('increase round,', 318, 679, 80),                      // wrap : cellule droite seule
  mk('Step 2: work INC,', 66, 648, 102), mk('k4, m5oo1, k2, distributing 4 sts', 318, 648, 205),
  mk('and 2 to sleeve)', 318, 632, 76),                     // wrap : cellule droite seule
  mk('Step 3: k across sleeve sts to next INC of', 66, 601, 233), mk('k across sleeve sts until the next 7', 318, 601, 179),
  mk('prev rnd,', 120, 585, 46), mk('stitches on your LH needle will be', 318, 585, 195),
  mk('ones from the m7oo1 of the previous', 318, 569, 193),
  mk('increase round,', 318, 553, 80),
  mk('Step 9: k across half back sts to BOR', 66, 222, 232), mk('k across half back sts until BOR', 318, 222, 178),
  // conclusion : 4 rangées séparatrices (la dernière, étroite, referme le couloir page)
  mk('Now that you know how this raglan works, you can also follow the shortened version.', 60, 199, 473),
  mk('While the instructions contain all the information you need, some prefer', 60, 152, 473),
  mk('a less detailed breakdown. The table on the next page is', 60, 136, 473),
  mk('summarizing which increases to work when', 60, 121, 322),
  // pied de page : 3 rangées séparatrices
  mk('Copyright Hanna Lubben. This pattern is for personal use only.', 125, 54, 380),
  mk('No wording may be reproduced or distributed in any form', 125, 45, 380),
  mk('any questions please contact help at example dot com', 125, 37, 380),
]

const merisP7Expected = [
  'To achieve that, the example increase round would be worked like this:',
  '(Remember, the INC to work in this example was m5oo1-B4-S2)',
  // bloc GAUCHE de la table : toutes les cellules x < bound régional (~308), le titre
  // « INSTRUCTIONS » seul sur sa ligne, les « Step » sans fragment droit recollé
  'INSTRUCTIONS',
  'Step 1: k across half back stitches to INC',
  'of previous rnd,',
  'Step 2: work INC,',
  'Step 3: k across sleeve sts to next INC of',
  'prev rnd,',
  'Step 9: k across half back sts to BOR',
  // bloc DROIT (rightCol) : MEANING puis les fragments droits, wraps inclus
  'MEANING',
  'k across half back until the next 7 st',
  '7 sts on your LH needle will be',
  'ones from the m7oo1 of the previous',
  'increase round,',
  'k4, m5oo1, k2, distributing 4 sts',
  'and 2 to sleeve)',
  'k across sleeve sts until the next 7',
  'stitches on your LH needle will be',
  'ones from the m7oo1 of the previous',
  'increase round,',
  'k across half back sts until BOR',
  // conclusion et pied : régions mono, verbatim
  'Now that you know how this raglan works, you can also follow the shortened version.',
  'While the instructions contain all the information you need, some prefer',
  'a less detailed breakdown. The table on the next page is',
  'summarizing which increases to work when',
  'Copyright Hanna Lubben. This pattern is for personal use only.',
  'No wording may be reproduced or distributed in any form',
  'any questions please contact help at example dot com',
]

// Colonnage par région (V1, repli strict) : la segmentation ne s'active QUE sur les pages
// qui échouent AUJOURD'HUI au gauntlet page (twoCols=false ET detectColumns < 3) — ces
// fixtures portent la géométrie MESURÉE des vraies pages défectueuses (meris-tee p7,
// mini-kawaii p1 ; PDF hors git, remplacés par du texte court fictif de même structure).
describe('itemsToLines — colonnage par région (repli mono)', () => {
  const at = (str, x, y, w, h = 10) => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h, fontName: 'f1' })

  it('meris p7 : intro / table Step‖MEANING / conclusion / pied — la table sort en 2 flux séparés, le titre ne fusionne plus', () => {
    // Géométrie mesurée de meris-tee-en-075ee07f page 7 (W=596) : la page échoue au gauntlet
    // (gouttière null — la dernière rangée de conclusion, ÉTROITE [60,382] w=322 < 0.55W,
    // referme le couloir page exactement comme la vraie rangée y=121 [59.5,382.5] ; veto
    // spanning : 9 candidats > 2.8). Aujourd'hui lue mono : « INSTRUCTIONS MEANING »
    // fusionné et chaque « Step 1: k across… » recollé avec son fragment droit.
    // Les rangées « wrap » de la colonne droite ([318,511] par paires consécutives
    // y=695/679…) ne sont PAS séparatrices : elles pénètrent la zone médiane par la
    // DROITE — les compter ferait exploser la table en 5 bandes et re-fusionnerait tout.
    // (Items + sortie attendue hoistés en merisP7Items/merisP7Expected, réutilisés par le
    // contre-échantillon V2a « grilles appariées » plus bas dans ce fichier.)
    const items = merisP7Items
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual(merisP7Expected)
    // le bloc droit est marqué rightCol (12 lignes), ni plus ni moins, jamais multiCol
    expect(lines.filter((l) => l.rightCol).map((l) => l.text)).toEqual([
      'MEANING', 'k across half back until the next 7 st', '7 sts on your LH needle will be',
      'ones from the m7oo1 of the previous', 'increase round,', 'k4, m5oo1, k2, distributing 4 sts',
      'and 2 to sleeve)', 'k across sleeve sts until the next 7', 'stitches on your LH needle will be',
      'ones from the m7oo1 of the previous', 'increase round,', 'k across half back sts until BOR',
    ])
    expect(lines.every((l) => !l.multiCol)).toBe(true)
    // la ligne Step 1 ne contient AUCUN fragment droit (le bug d'origine)
    expect(lines.some((l) => l.text.startsWith('Step 1:') && l.text.includes('until the next'))).toBe(false)
    expectNoLoss(lines, items)
  })

  it('séparatrice isolée : une rangée splittable isolée dans de la prose mono-échec ne crée aucune région 2-col admissible → page inchangée', () => {
    // Page mono-échec (gouttière null : prose large = wide, jamais narrow ; bimodal : 1
    // seule cellule droite < garde 3). La rangée splittable (gap [240,316] dans la zone
    // médiane) est ISOLÉE au milieu de la prose : les rangées de prose forment 2 runs
    // séparateurs, la bande candidate n'a que 2 cellules (< garde 8) → aucune région ne
    // passe le gauntlet → repli admission : toLines(filled) exact, la rangée splittable
    // reste fusionnée « L1 … R1 … » sur sa ligne comme avant.
    const items = [
      at('Prose pleine largeur ligne une', 60, 740, 410),
      at('Prose pleine largeur ligne deux', 60, 720, 410),
      at('Prose pleine largeur ligne trois', 60, 700, 410),
      at('Prose pleine largeur ligne quatre', 60, 680, 410),
      at('Prose pleine largeur ligne cinq', 60, 660, 410),
      at('Prose pleine largeur ligne six', 60, 640, 410),
      at('L1 texte gauche', 60, 620, 180), at('R1 texte droite', 316, 620, 184),
      at('Prose pleine largeur ligne sept', 60, 600, 410),
      at('Prose pleine largeur ligne huit', 60, 580, 410),
      at('Prose pleine largeur ligne neuf', 60, 560, 410),
      at('Prose pleine largeur ligne dix', 60, 540, 410),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'Prose pleine largeur ligne une', 'Prose pleine largeur ligne deux', 'Prose pleine largeur ligne trois',
      'Prose pleine largeur ligne quatre', 'Prose pleine largeur ligne cinq', 'Prose pleine largeur ligne six',
      'L1 texte gauche R1 texte droite',
      'Prose pleine largeur ligne sept', 'Prose pleine largeur ligne huit', 'Prose pleine largeur ligne neuf',
      'Prose pleine largeur ligne dix',
    ])
    expect(lines.every((l) => !l.rightCol && !l.multiCol)).toBe(true)
    expectNoLoss(lines, items)
  })

  it('toLines ne mute jamais cell.parts — repli non-admis : deux passes sur les mêmes cellules, invariant parts↔text préservé', () => {
    // Bug parts-dup (trouvé au sweep différentiel, 13 PDF « corriger ») : toLines
    // fait `prev = { ..., parts: c.parts }` (ALIASING du tableau de la cellule) puis
    // `prev.parts.push({x:null,text:' '}, ...c.parts)` — mutation EN PLACE de cell.parts.
    // Sur une page régionalisée NON-ADMISE, readByRegions appelle toLines par région (les
    // régions séparatrices y recollent leurs cellules sœurs) PUIS retombe sur toLines(filled)
    // → les parts des cellules séparatrices recollées sont fusionnées DEUX fois. `text`,
    // recalculé depuis c.text à chaque passe, reste correct — mais parts contient le contenu
    // de la sœur en double : glossary-columns.js, qui recompose ses clés depuis parts,
    // duplique les définitions.
    // Fixture : mono-échec au gauntlet page (gouttière null — le seul couloir du corps,
    // [170,190], n'a qu'UNE rangée interlacée inter=1 < 2 ; bimodal : 0 cellule droite ;
    // detectColumns : 7 narrow < 8). La rangée sœur (2 cellules, gap 20pt > X_GAP mais
    // ENTIEREMENT à gauche de ⅓W → pas un couloir disqualifiant) est dans le run
    // séparateur ; la bande courte (5 cellules < garde 8) rate le gauntlet régional →
    // repli toLines(filled) = DEUXIÈME passe sur les cellules du run.
    // NB : deux appels SUCCESSIFS d'itemsToLines sur les mêmes items rendent des sorties
    // identiques même AVEC le bug (les cellules sont reconstruites à chaque appel, la
    // pollution est interne à UN appel) — le véritable détecteur est l'invariant
    // parts↔text vérifié sur UN seul appel ; l'égalité du second appel est gardée comme
    // garde anti-état-global résiduel.
    const items = [
      at('Prose pleine largeur ligne une', 60, 740, 410),   // séparatrice (cellule unique)
      at('Titre gauche', 60, 720, 110), at('suite droite longue', 190, 720, 210), // séparatrice, 2 cellules SŒURS
      at('Prose pleine largeur ligne deux', 60, 700, 410),  // séparatrice (cellule unique)
      at('Bande courte une', 60, 660, 120),                 // n'atteint pas ⅓W → bande mono
      at('Bande courte deux', 60, 640, 120),
      at('Bande courte trois', 60, 620, 120),
      at('Bande courte quatre', 60, 600, 120),
      at('Bande courte cinq', 60, 580, 120),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'Prose pleine largeur ligne une',
      'Titre gauche suite droite longue',
      'Prose pleine largeur ligne deux',
      'Bande courte une', 'Bande courte deux', 'Bande courte trois', 'Bande courte quatre', 'Bande courte cinq',
    ])
    // La ligne recollée porte exactement une fois chaque morceau : le séparateur x=null et
    // les parts des deux sœurs, SANS doublon (le bug dupliquait « suite droite longue »).
    const sister = lines.find((l) => l.text === 'Titre gauche suite droite longue')
    expect(sister.parts).toEqual([
      { x: 60, text: 'Titre gauche' },
      { x: null, text: ' ' },
      { x: 190, text: 'suite droite longue' },
    ])
    // Invariant parts↔text sur TOUTE la sortie (c'est lui que le bug cassait).
    for (const l of lines) {
      expect(l.parts.map((p) => p.text).join('').replace(/\s{2,}/g, ' ').trim()).toBe(l.text)
    }
    // Garde résiduelle : un second appel sur les mêmes items = sortie profondément identique.
    expect(itemsToLines(items, {}, { pageWidth: 596 })).toEqual(lines)
    expectNoLoss(lines, items)
  })

  it('titre traversant isolé sur une page 2-col qui RÉUSSIT le gauntlet page (voie bimodale) → chemin 2-col page inchangé, code régional inatteignable', () => {
    // 9 rangées de paires + UN titre traversant isolé (y=649, [60,330] : étroit donc la
    // gouttière page échoue, mais endX 330 < 0.6W donc il ne compte pas dans le veto
    // spanning → twoCols=true par bimodalité). Le repli régional ne doit JAMAIS s'activer
    // sur une page réussie : le titre reste dans le flux GAUCHE (lu par son x de départ,
    // comportement calibré d'avant ce correctif), un seul flux 2-col page.
    const items = [
      at('L9', 60, 720, 180), at('R9', 316, 720, 184),
      at('L8', 60, 700, 180), at('R8', 316, 700, 184),
      at('L7', 60, 680, 180), at('R7', 316, 680, 184),
      at('L6', 60, 660, 180), at('R6', 316, 660, 184),
      at('Titre traversant isolement', 60, 649, 270),
      at('L5', 60, 640, 180), at('R5', 316, 640, 184),
      at('L4', 60, 620, 180), at('R4', 316, 620, 184),
      at('L3', 60, 600, 180), at('R3', 316, 600, 184),
      at('L2', 60, 580, 180), at('R2', 316, 580, 184),
      at('L1', 60, 560, 180), at('R1', 316, 560, 184),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'L9', 'L8', 'L7', 'L6', 'Titre traversant isolement', 'L5', 'L4', 'L3', 'L2', 'L1',
      'R9', 'R8', 'R7', 'R6', 'R5', 'R4', 'R3', 'R2', 'R1',
    ])
    expect(lines.filter((l) => l.rightCol).map((l) => l.text)).toEqual(['R9', 'R8', 'R7', 'R6', 'R5', 'R4', 'R3', 'R2', 'R1'])
    expectNoLoss(lines, items)
  })

  it('mini-kawaii p1 : bandeau titre / grille glossaire — lignes « clé définition » appariées par bloc, plus de titre fantôme', () => {
    // Géométrie mesurée de mini-kawaii-coffee-cup p1 (W=596) : 3 rangées de titre
    // traversantes consécutives (cellule unique, dont « C R O C H E T P A T T E R N »
    // [107,375] qui finit à 0.63W — RATÉ par le seuil endX > 0.6·W du veto spanning,
    // d'où le test de couverture médiane dédié), puis la grille glossaire — chaque rangée porte la paire gauche (clé ‖ définition,
    // gap [100,137] hors zone) puis la paire droite FUSIONNÉE en une cellule (« FLO » +
    // espace + « Front Loops Only », gap 10 < X_GAP=18) avec son couloir dans la zone
    // médiane (gap [258,280]=22pt). Fusion nécessaire : sur la vraie page les 4 items
    // sont 4 cellules séparées et le gap FLO|Front (59pt) formerait un SECOND couloir
    // qui gagnerait le départage `inter` de detectColumnGutter (comptage par cellule
    // gauche : 6 > 4), envoyant FLO à GAUCHE du bound — la vraie page part de toute
    // façon par detectColumns ≥ 3 (N-col, inatteignable en V1), la fixture fige la
    // lecture régionale attendue. La grille sort
    // en 2-col au bound régional : « MR Magic Ring » appariés à gauche, « FLO Front Loops
    // Only » appariés à droite — « Front Loops Only » n'est plus promu en titre fantôme.
    const items = [
      at('Kawaii Coffee Cup', 47, 790, 370),
      at('C R O C H E T P A T T E R N', 107, 765, 268),
      at('www dot craftycreatureclub dot co dot uk', 89, 725, 286),
      at('MR', 18, 505, 82), at('Magic Ring', 137, 505, 121),
      at('FLO', 280, 505, 20), at(' ', 301, 505, 1, 10), at('Front Loops Only', 310, 505, 166),
      at('Sc', 18, 489, 82), at('Single Crochet', 137, 489, 121),
      at('BLO', 280, 489, 20), at(' ', 301, 489, 1, 10), at('Back Loops Only', 310, 489, 166),
      at('Inc', 18, 472, 82), at('Increase', 137, 472, 121),
      at('Hdc', 280, 472, 20), at(' ', 301, 472, 1, 10), at('Half Double Crochet', 310, 472, 166),
      at('Dec', 18, 456, 82), at('Decrease', 137, 456, 121),
      at('FO', 280, 456, 20), at(' ', 301, 456, 1, 10), at('Fasten Off', 310, 456, 166),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'Kawaii Coffee Cup',
      'C R O C H E T P A T T E R N',
      'www dot craftycreatureclub dot co dot uk',
      'MR Magic Ring',
      'Sc Single Crochet',
      'Inc Increase',
      'Dec Decrease',
      'FLO Front Loops Only',
      'BLO Back Loops Only',
      'Hdc Half Double Crochet',
      'FO Fasten Off',
    ])
    expect(lines.filter((l) => l.rightCol).map((l) => l.text)).toEqual([
      'FLO Front Loops Only', 'BLO Back Loops Only', 'Hdc Half Double Crochet', 'FO Fasten Off',
    ])
    // « titre fantôme » : Front Loops Only n'existe qu'apparié à sa clé FLO, jamais seul
    expect(lines.some((l) => l.text === 'Front Loops Only')).toBe(false)
    expect(lines.every((l) => !l.multiCol)).toBe(true)
    expectNoLoss(lines, items)
  })

  it('séquences indépendantes avec bandeau traversant : bandeau mono + séquences lues en BLOCS gauche puis droite, jamais en zigzag', () => {
    // Forme mini-otter p3 : deux séquences « 1..3 » indépendantes côte à côte, précédées
    // d'un bandeau traversant de 2 rangées (run K=2). La page échoue au gauntlet (le
    // bandeau, étroit [80,400] w=320 < 0.55W, referme le couloir page ET pèse 2 dans le
    // veto spanning > 1.4) → repli régional : bandeau en mono, séquences en 2-col.
    // Les items intercalés donnent [1,1,2,2,3,3] — non croissants → lecture en BLOCS
    // (gauche entière puis droite entière), JAMAIS en zigzag. La rangée de bourrage
    // « Meris tee page 4 » (en-tête, [80,140] : n'atteint pas ⅓W) n'est pas séparatrice :
    // elle forme sa propre bande mono au-dessus du bandeau.
    const items = [
      at('Meris tee page 4', 80, 770, 60),
      at('Bandeau traversant ligne une', 80, 750, 320),
      at('Bandeau traversant ligne deux', 80, 735, 320),
      at('1. Seq gauche un', 60, 700, 140), at('1. Seq droite un', 340, 700, 140),
      at('2. Seq gauche deux', 60, 680, 140), at('2. Seq droite deux', 340, 680, 140),
      at('3. Seq gauche trois', 60, 660, 140), at('3. Seq droite trois', 340, 660, 140),
      at('Suite gauche un', 60, 640, 120), at('Suite droite un', 340, 640, 120),
      at('Suite gauche deux', 60, 620, 120), at('Suite droite deux', 340, 620, 120),
      at('Suite gauche trois', 60, 600, 120), at('Suite droite trois', 340, 600, 120),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'Meris tee page 4',
      'Bandeau traversant ligne une',
      'Bandeau traversant ligne deux',
      '1. Seq gauche un',
      '2. Seq gauche deux',
      '3. Seq gauche trois',
      'Suite gauche un',
      'Suite gauche deux',
      'Suite gauche trois',
      '1. Seq droite un',
      '2. Seq droite deux',
      '3. Seq droite trois',
      'Suite droite un',
      'Suite droite deux',
      'Suite droite trois',
    ])
    // jamais de zigzag : tout le bloc gauche précède TOUT le bloc droit (rightCol)
    expect(lines.filter((l) => l.rightCol).map((l) => l.text)).toEqual([
      '1. Seq droite un', '2. Seq droite deux', '3. Seq droite trois',
      'Suite droite un', 'Suite droite deux', 'Suite droite trois',
    ])
    expectNoLoss(lines, items)
  })

  it('séquences indépendantes SANS bandeau : la page réussit son gauntlet → lecture 2-col page classique, inchangée par le repli régional', () => {
    // Mêmes séquences sans le bandeau : plus rien ne referme le couloir page, la gouttière
    // le trouve (mid≈270) → twoCols=true → le code régional est inatteignable. Les items
    // intercalés [1,1,2,2,3,3] restent non croissants → blocs, comme avant ce correctif.
    const items = [
      at('1. Seq gauche un', 60, 700, 140), at('1. Seq droite un', 340, 700, 140),
      at('2. Seq gauche deux', 60, 680, 140), at('2. Seq droite deux', 340, 680, 140),
      at('3. Seq gauche trois', 60, 660, 140), at('3. Seq droite trois', 340, 660, 140),
      at('Suite gauche un', 60, 640, 120), at('Suite droite un', 340, 640, 120),
      at('Suite gauche deux', 60, 620, 120), at('Suite droite deux', 340, 620, 120),
      at('Suite gauche trois', 60, 600, 120), at('Suite droite trois', 340, 600, 120),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      '1. Seq gauche un', '2. Seq gauche deux', '3. Seq gauche trois',
      'Suite gauche un', 'Suite gauche deux', 'Suite gauche trois',
      '1. Seq droite un', '2. Seq droite deux', '3. Seq droite trois',
      'Suite droite un', 'Suite droite deux', 'Suite droite trois',
    ])
    expect(lines.filter((l) => l.rightCol)).toHaveLength(6)
    expectNoLoss(lines, items)
  })

  it('mono pur : une page pleine largeur est un run géant → une seule région → toLines(filled) exact', () => {
    // Toutes les rangées traversent la zone médiane sans couloir → un seul run séparateur
    // géant → moins de 2 régions au total → retour mono pur, byte-identique (même appel,
    // même ordre d'objets qu'avant le repli régional).
    const items = [
      at('Paragraphe pleine largeur numero un', 60, 740, 410),
      at('Paragraphe pleine largeur numero deux', 60, 720, 410),
      at('Paragraphe pleine largeur numero trois', 60, 700, 410),
      at('Paragraphe pleine largeur numero quatre', 60, 680, 410),
      at('Paragraphe pleine largeur numero cinq', 60, 660, 410),
      at('Paragraphe pleine largeur numero six', 60, 640, 410),
      at('Paragraphe pleine largeur numero sept', 60, 620, 410),
      at('Paragraphe pleine largeur numero huit', 60, 600, 410),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'Paragraphe pleine largeur numero un', 'Paragraphe pleine largeur numero deux',
      'Paragraphe pleine largeur numero trois', 'Paragraphe pleine largeur numero quatre',
      'Paragraphe pleine largeur numero cinq', 'Paragraphe pleine largeur numero six',
      'Paragraphe pleine largeur numero sept', 'Paragraphe pleine largeur numero huit',
    ])
    expect(lines.every((l) => !l.rightCol && !l.multiCol)).toBe(true)
    expectNoLoss(lines, items)
  })

  it('2-col pure avec UNE traversante isolée au milieu : la gouttière page l’emporte → un seul flux 2-col, inchangé', () => {
    // Vraie 2-col qui réussit le gauntlet page via la gouttière (couloir [241,315] franc,
    // la traversante [60,470] est WIDE donc hors du calcul d'occupation) avec UNE rangée
    // traversante isolée au milieu (y=649, voisines = rangées de paires, pas de run ≥ 2).
    // twoCols=true → code régional inatteignable : la traversante reste DANS le flux
    // gauche (x=60 < bound), à sa place en Y — exactement le comportement d'avant.
    const items = [
      at('L9', 60, 720, 180), at('R9', 316, 720, 184),
      at('L8', 60, 700, 180), at('R8', 316, 700, 184),
      at('L7', 60, 680, 180), at('R7', 316, 680, 184),
      at('L6', 60, 660, 180), at('R6', 316, 660, 184),
      at('Bandeau traversant isole au milieu', 60, 649, 410),
      at('L5', 60, 640, 180), at('R5', 316, 640, 184),
      at('L4', 60, 620, 180), at('R4', 316, 620, 184),
      at('L3', 60, 600, 180), at('R3', 316, 600, 184),
      at('L2', 60, 580, 180), at('R2', 316, 580, 184),
      at('L1', 60, 560, 180), at('R1', 316, 560, 184),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'L9', 'L8', 'L7', 'L6', 'Bandeau traversant isole au milieu', 'L5', 'L4', 'L3', 'L2', 'L1',
      'R9', 'R8', 'R7', 'R6', 'R5', 'R4', 'R3', 'R2', 'R1',
    ])
    expect(lines.filter((l) => l.rightCol)).toHaveLength(9)
    expectNoLoss(lines, items)
  })

  it('page à moins de 8 cellules : inchangée, lecture mono exacte (garde régional)', () => {
    // Miroir du garde page (filled.length >= 8) au niveau régional, exigé par le plan :
    // une page minuscule (6 cellules) ne doit jamais être admise en régions —
    // ni le gauntlet page (6 < 8) ni une bande régionale (bande de 4 < 8) ne passent,
    // la sortie est toLines(filled) exact : ordre Y strict, cellules sœurs recollées.
    const items = [
      at('Titre court du haut', 60, 700, 300),
      at('Deuxieme ligne pleine largeur du bandeau', 60, 680, 340),
      at('Gauche un', 60, 640, 80), at('Droite un', 318, 640, 90),
      at('Gauche deux', 60, 620, 84), at('Droite deux', 318, 620, 90),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'Titre court du haut',
      'Deuxieme ligne pleine largeur du bandeau',
      'Gauche un Droite un',
      'Gauche deux Droite deux',
    ])
    expect(lines.every((l) => !l.rightCol && !l.multiCol)).toBe(true)
    expectNoLoss(lines, items)
  })
})

// ── V2a-T1 : grilles appariées clé|valeur (detectPairedGrid + readPairedGrid) ─────────
// La preuve « grille appariée » (clés étroites + appariement par rangée, spec
// 2026-09-04-colonnage-v2 §2.2) surclasse la cascade V1 : une grille de glossaire 2×2
// EST multi-colonnes ET gouttière-compatible — detectColumns/twoCols ne peuvent pas ne
// pas se tromper dessus (loupy p4 lue twoCols par la gouttière 351 ENTRE la clé droite et
// SA définition ; mini-kawaii p1 lue N-col, paires pulvérisées). Aucune contrainte
// byte-identique sur ces deux pages (cassées aujourd'hui) ; en revanche les
// non-déclenchements ci-dessous doivent rester EXACTEMENT au comportement V1.
describe('itemsToLines — grilles appariées clé|valeur (V2a)', () => {
  const at = (str, x, y, w, h = 10) => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h, fontName: 'f1' })

  // No-loss par FRONTIÈRES DE MOTS (variante du helper hoisté) : les grilles réelles ont
  // des clés d'UNE-DEUX lettres (« K », « CO » ⊂ « BLCO », « FO ») — un simple includes
  // les compterait dans toutes les lignes voisines. Lookarounds plutôt que \b…\b : \b
  // après une parenthèse fermante (« (12) ») ne matche jamais (')' n'est pas un word-char).
  // « CO » ne matche pas « BLCO », « K » ne matche pas « K2tog ».
  const expectNoLossWords = (lines, items) => {
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const counts = new Map()
    for (const it of items) {
      const t = it.str.trim()
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    for (const [t, n] of counts) {
      const re = new RegExp(`(?<=^|\\s)${esc(t)}(?=\\s|$)`)
      const got = lines.filter((l) => re.test(l.text)).length
      if (got !== n) throw new Error(`no-loss « ${t} » : ${got} ligne(s) en sortie, ${n} attendu(s)`)
    }
  }

  // Invariant parts↔text (le même que le test « toLines ne mute jamais cell.parts » V1) :
  // la lecture appariée recolle clé+def via le séparateur x=null, le wrap par-dessus —
  // aucun morceau inventé, aucun perdu.
  const expectPartsInvariant = (lines) => {
    for (const l of lines) {
      expect(l.parts.map((p) => p.text).join('').replace(/\s{2,}/g, ' ').trim()).toBe(l.text)
    }
  }

  it('loupy p4 : grille 2×2 « Abbreviations key » lue par paires — clé def par rangée, wrap rattaché, prose dessous en flux normal', () => {
    // Géométrie mesurée loupy-stripe-cardi p4 (W=595, sonde probe-v2a-bands du 04/09) :
    // titres lettres-espacées w=244/232 (run séparateur de 2), grille réelle x=36/108/298/370
    // (clés 22-41pt, defs 53-152pt — 6 rangées réelles + 1 wrap synthétique « as
    // established » suffisent ; la rangée réelle CO/cast on est écartée : « cast on » est
    // un sous-mot de « backwards loop cast on », interdit par le no-loss), prose pleine
    // largeur dessous (run séparateur de 4, y≤566).
    const items = [
      at('Instructions', 36, 774, 244),
      at('Abbreviations key', 36, 737, 232),
      at('BLCO', 36, 719, 33), at('backwards loop cast on', 108, 719, 152), at('REP', 298, 719, 27), at('repeat', 370, 719, 44),
      at('K2tog', 36, 690, 41), at('knit two together', 108, 690, 117), at('SSK', 298, 690, 26), at('slip slip knit', 370, 690, 80),
      at('LLI', 36, 676, 22), at('left lifted increase', 108, 676, 125), at('Sts', 298, 676, 24), at('stitches', 370, 676, 53),
      at('P2tog', 36, 661, 41), at('purl two together', 108, 661, 116), at('St st', 298, 661, 34), at('stockinette stitch', 370, 661, 120),
      at('RSA', 36, 647, 27), at('right side in Colour A', 108, 647, 135), at('WSA', 298, 647, 28), at('wrong side in Colour A,', 370, 647, 141),
      at('as established', 370, 632, 100), // wrap de def2 : rangée SANS clé → rattache à l'entrée WSA au-dessus
      at('RSB', 36, 618, 27), at('right side in colour B', 108, 618, 135), at('YO', 298, 618, 19), at('yarn over', 370, 618, 60),
      // bande prose dessous : 4 rangées pleine largeur séparatrices
      at('The pattern will be knitted in two row increments', 36, 566, 477),
      at('of colour A followed by colour B, as annotated below', 36, 551, 507),
      at('for the right side of the work in each colour', 36, 537, 491),
      at('Work the yoke exactly as described on the next page', 36, 523, 479),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 595 })
    expect(lines.map((l) => l.text)).toEqual([
      'Instructions',
      'Abbreviations key',
      // la grille : une ligne « clé def » PAR PAIRE, la rangée Y porte les deux paires —
      // « BLCO backwards loop cast on » PUIS « REP repeat » sur la même rangée Y
      'BLCO backwards loop cast on',
      'REP repeat',
      'K2tog knit two together',
      'SSK slip slip knit',
      'LLI left lifted increase',
      'Sts stitches',
      'P2tog purl two together',
      'St st stockinette stitch',
      'RSA right side in Colour A',
      // le wrap (« A, » sans fin de phrase → continue, grammaire readColumnGlossary)
      'WSA wrong side in Colour A, as established',
      'RSB right side in colour B',
      'YO yarn over',
      // la prose dessous : toLines normal, ordre Y autour de la grille
      'The pattern will be knitted in two row increments',
      'of colour A followed by colour B, as annotated below',
      'for the right side of the work in each colour',
      'Work the yoke exactly as described on the next page',
    ])
    // les 12 lignes grille (et elles seules) portent pairedRow ; JAMAIS rightCol (les defs
    // courtes répétées se feraient apprendre comme légendes) ni multiCol
    expect(lines.filter((l) => l.pairedRow).map((l) => l.text)).toEqual([
      'BLCO backwards loop cast on', 'REP repeat', 'K2tog knit two together', 'SSK slip slip knit',
      'LLI left lifted increase', 'Sts stitches', 'P2tog purl two together', 'St st stockinette stitch',
      'RSA right side in Colour A', 'WSA wrong side in Colour A, as established',
      'RSB right side in colour B', 'YO yarn over',
    ])
    expect(lines.some((l) => l.rightCol || l.multiCol)).toBe(false)
    // parts.x préservés, jamais synthétisés (pas de « = » fabriqué) : clé/def recollés par
    // le séparateur x=null de toLines, le wrap garde l'abscisse réelle de sa cellule (370)
    expect(lines.find((l) => l.text === 'BLCO backwards loop cast on').parts.map((p) => p.x)).toEqual([36, null, 108])
    expect(lines.find((l) => l.text === 'REP repeat').parts.map((p) => p.x)).toEqual([298, null, 370])
    expect(lines.find((l) => l.text === 'WSA wrong side in Colour A, as established').parts.map((p) => p.x)).toEqual([298, null, 370, null, 370])
    expectPartsInvariant(lines)
    expectNoLossWords(lines, items)
  })

  it('mini-kawaii p1 : grille « Abbreviations - US Terms » appariée par rangée — plus de titre fantôme « Front Loops Only »', () => {
    // Géométrie mesurée mini-kawaii-coffee-cup p1 (W=596, sonde probe-v2a-bands) :
    // 3 rangées titre séparatrices ; « What You Will Need » bande mono 1 cellule (n'atteint
    // pas ⅓W) ; matériel + titre abréviations = run séparateur de 4 (le titre x=19 w=186
    // CROISE ⅓W) ; grille x=20/136/280/361 (clés 14-23pt, defs 47-112pt) ; la prose du
    // patron vit dans la MÊME bande, en QUEUE contiguë (y=407..284) — elle pollue col0
    // (largeur médiane 92pt sur la bande entière vs 17pt sur les seules rangées appariées)
    // → les largeurs de colonnes se mesurent sur les rangées APPARIÉES (spec §2.2).
    const items = [
      at('Kawaii Coffee Cup', 47, 790, 369),
      at('C R O C H E T P A T T E R N', 105, 765, 253),
      at('www dot craftycreatureclub dot co dot uk', 90, 725, 283),
      at('What You Will Need', 20, 683, 143),
      at('Skinny chenille yarn in white and brown', 40, 650, 247),
      at('6mm safety eyes and 3.5mm crochet hook', 40, 618, 315),
      at('Black thread, stuffing and stitch marker', 40, 586, 368),
      at('Abbreviations - US Terms', 19, 537, 186),
      at('MR', 20, 505, 17), at('Magic Ring', 136, 505, 60), at('FLO', 280, 505, 22), at('Front Loops Only', 361, 505, 95),
      at('Sc', 20, 489, 14), at('Single Crochet', 136, 489, 81), at('BLO', 280, 489, 23), at('Back Loops Only', 361, 489, 93),
      at('Inc', 20, 472, 16), at('Increase', 136, 472, 47), at('Hdc', 280, 472, 23), at('Half Double Crochet', 361, 472, 112),
      at('Dec', 20, 456, 22), at('Decrease', 136, 456, 53), at('FO', 280, 456, 16), at('Fasten Off', 361, 456, 58),
      // queue de bande : prose du patron, résiduel queue contigu SANS entrelacement Y
      at('Pattern - Lid and Body', 19, 407, 163),
      at('1 With white: 6sc in a ring', 34, 376, 158),
      at('2 Make 6 increases (12)', 32, 346, 92),
      at('4 In back loops: 24sc', 32, 284, 102),
      // séparatrices (fin de la section, rangée wide)
      at('5 In front loops: 24hdc, fasten off', 32, 254, 253),
      at('6 Change to brown. In remaining back loops only', 32, 224, 520),
      // bande patron suite
      at('23sc around (24)', 65, 208, 95),
      at('7 (4sc, dec) x 4 (20)', 33, 178, 135),
      at('12 16sc', 30, 88, 59),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'Kawaii Coffee Cup',
      'C R O C H E T P A T T E R N',
      'www dot craftycreatureclub dot co dot uk',
      'What You Will Need',
      'Skinny chenille yarn in white and brown',
      '6mm safety eyes and 3.5mm crochet hook',
      'Black thread, stuffing and stitch marker',
      'Abbreviations - US Terms',
      // la grille : « MR Magic Ring » PUIS « FLO Front Loops Only » sur la même rangée Y
      'MR Magic Ring',
      'FLO Front Loops Only',
      'Sc Single Crochet',
      'BLO Back Loops Only',
      'Inc Increase',
      'Hdc Half Double Crochet',
      'Dec Decrease',
      'FO Fasten Off',
      // la queue de bande (titre de section + étapes) : toLines normal, ordre Y
      'Pattern - Lid and Body',
      '1 With white: 6sc in a ring',
      '2 Make 6 increases (12)',
      '4 In back loops: 24sc',
      '5 In front loops: 24hdc, fasten off',
      '6 Change to brown. In remaining back loops only',
      '23sc around (24)',
      '7 (4sc, dec) x 4 (20)',
      '12 16sc',
    ])
    expect(lines.filter((l) => l.pairedRow).map((l) => l.text)).toEqual([
      'MR Magic Ring', 'FLO Front Loops Only', 'Sc Single Crochet', 'BLO Back Loops Only',
      'Inc Increase', 'Hdc Half Double Crochet', 'Dec Decrease', 'FO Fasten Off',
    ])
    // PAS de titre fantôme : « Front Loops Only » n'existe qu'apparié à sa clé FLO
    expect(lines.some((l) => l.text === 'Front Loops Only')).toBe(false)
    expect(lines.some((l) => l.rightCol || l.multiCol)).toBe(false)
    expect(lines.find((l) => l.text === 'MR Magic Ring').parts.map((p) => p.x)).toEqual([20, null, 136])
    expect(lines.find((l) => l.text === 'FLO Front Loops Only').parts.map((p) => p.x)).toEqual([280, null, 361])
    expectPartsInvariant(lines)
    expectNoLossWords(lines, items)
  })

  it('NON-déclenchement (a) : 2-col prose avec items numérotés intercalés par la gouttière — le zigzag cas D continue de tirer, byte-identique', () => {
    // Les items de gauche/droite sont des PHRASES (~140pt), pas des colonnes clés étroites
    // (garde 10%W = 59.6pt) : detectPairedGrid doit renvoyer null et la voie twoCols/cas D
    // garder EXACTEMENT son comportement V1 (sortie figée avant implémentation V2a).
    const items = [
      at('1. Primero paso de la labor.', 40, 700, 140), at('2. Segundo paso de la labor.', 320, 700, 140),
      at('3. Tercero paso de la labor.', 40, 670, 140), at('4. Cuarto paso de la labor.', 320, 670, 140),
      at('5. Quinto paso de la labor.', 40, 640, 140), at('6. Sexto paso de la labor.', 320, 640, 140),
      at('Continuar rematando todo.', 40, 610, 120), at('Nota final del trabajo.', 320, 610, 120),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      '1. Primero paso de la labor.',
      '2. Segundo paso de la labor.',
      '3. Tercero paso de la labor.',
      '4. Cuarto paso de la labor.',
      '5. Quinto paso de la labor.',
      'Continuar rematando todo.',
      '6. Sexto paso de la labor.',
      'Nota final del trabajo.',
    ])
    expect(lines.filter((l) => l.rightCol).map((l) => l.text)).toEqual([
      '2. Segundo paso de la labor.', '4. Cuarto paso de la labor.',
      '6. Sexto paso de la labor.', 'Nota final del trabajo.',
    ])
    expect(lines.some((l) => l.pairedRow)).toBe(false)
  })

  it('NON-déclenchement (a-bis) : clés à préfixe de numérotation « 5. Así. » (forme sweet-mess es p4) — zigzag cas D, byte-identique', () => {
    // Régression mesurée au sweep V2a-T3 sur sweet-mess-dish-cloth-es p4-5 : tutoriel photo
    // à 2 colonnes d'étapes numérotées. Les clés gauches « 5. Así. »/« 7. Así. »/« 9. Salta… »
    // contiennent des LETTRES (la garde KEY_LIKE anti-numérique les accepte : 2/3 lettrées
    // courtes ≥ 0.5) et sont ÉTROITES (55pt ≤ 10%W) : toutes les gardes géométriques et de
    // contenu passent, la bande signe « grille appariée » — et readPairedBand insère le
    // numéro DROIT au milieu de la phrase de l'étape gauche : « 9. Salta 2 cadenetas y teje
    // 1 punto bajo en el 10. Así. ». C'est la forme cas D de la spec §2.2 (items numérotés
    // intercalés par la gouttière) : le DISCRIMINANT est le PRÉFIXE de numérotation
    // ^\d+[.)]\s — les vraies clés de glossaire (« BLCO », « MR », « Zun », « R1 »)
    // commencent toujours par une lettre, jamais par « 5. ».
    // Géométrie mesurée p4 (W=595, sonde probe-v2a-bands) : rangées appariées y=571/331/125,
    // clés x=42 (5. Así. 55pt / 7. Así. 55pt / 9. Salta… 230pt → médiane 55pt), defs x=304
    // (médiane 220pt), wraps defs y=555/539, wrap clé « último punto. » y=108. Le chrome de
    // page (sku, pied, Powered) est retiré : la bande signe quand même (9 cellules ≥ garde
    // 8) et le repli V1 tombe sur la voie bimodale (bound 42%W=249.9, 5 cellules droites,
    // zéro spanning) — même zigzag cas D que la vraie page via sa gouttière.
    const items = [
      at('5. Así.', 42, 571, 55), at('6. “Salta 2 cadenetas y teje 1 punto bajo,', 304, 571, 220),
      at('cadeneta y 1 punto alto en el siguiente', 322, 555, 196),
      at('punto”.', 322, 539, 37),
      at('7. Así.', 42, 331, 55), at('8. Repite de “ a “ hasta que queden 3 cadenetas', 304, 331, 248),
      at('9. Salta 2 cadenetas y teje 1 punto bajo en', 42, 125, 230), at('10. Así.', 304, 125, 36),
      at('último punto.', 60, 108, 69),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 595 })
    expect(lines.map((l) => l.text)).toEqual([
      // zigzag cas D : la numérotation 5→10 continue à travers la gouttière, chaque étape
      // reste UNE ligne (les wraps rejoignent leur colonne), jamais « clé def » apparié
      '5. Así.',
      '6. “Salta 2 cadenetas y teje 1 punto bajo,',
      'cadeneta y 1 punto alto en el siguiente',
      'punto”.',
      '7. Así.',
      '8. Repite de “ a “ hasta que queden 3 cadenetas',
      '9. Salta 2 cadenetas y teje 1 punto bajo en',
      'último punto.',
      '10. Así.',
    ])
    expect(lines.filter((l) => l.rightCol).map((l) => l.text)).toEqual([
      '6. “Salta 2 cadenetas y teje 1 punto bajo,',
      'cadeneta y 1 punto alto en el siguiente',
      'punto”.',
      '8. Repite de “ a “ hasta que queden 3 cadenetas',
      '10. Así.',
    ])
    expect(lines.some((l) => l.pairedRow)).toBe(false)
    // le bug : le numéro 10 ne doit JAMAIS se retrouver cousu dans la phrase de l'étape 9
    expect(lines.some((l) => l.text.includes('en el 10.'))).toBe(false)
    expectNoLossWords(lines, items)
  })

  it('NON-déclenchement (b) : 3 colonnes torsades (parité IMPAIRE) — N-col multiCol inchangé', () => {
    const items = [
      at('C1 haut', 20, 300), at('C2 haut', 200, 300), at('C3 haut', 380, 300),
      at('C1 mid', 20, 280), at('C2 mid', 200, 280), at('C3 mid', 380, 280),
      at('C1 bas', 20, 260), at('C2 bas', 200, 260), at('C3 bas', 380, 260),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 561 })
    expect(lines.map((l) => l.text)).toEqual([
      'C1 haut', 'C1 mid', 'C1 bas',
      'C2 haut', 'C2 mid', 'C2 bas',
      'C3 haut', 'C3 mid', 'C3 bas',
    ])
    expect(lines.every((l) => l.multiCol)).toBe(true)
    expect(lines.some((l) => l.pairedRow)).toBe(false)
  })

  it('NON-déclenchement (c) : table numérique (colonnes clés isGridToken) — reste en N-col V1, byte-identique', () => {
    // 4 clusters PAIRS, clés ÉTROITES (30pt < 10%W, < moitié des defs 120pt) : les gardes
    // géométriques PASSENT — c'est la garde de CONTENU qui doit rejeter (clés majoritairement
    // numériques « 56/14 »/« 0x » = table de mesures, hors périmètre V2a ; flower-child et
    // sœurs restent en lecture V1). Sortie figée avant implémentation : N-col multiCol.
    const items = [
      at('56/14', 18, 505, 30), at('Aire de mailles un', 137, 505, 120), at('0x', 280, 505, 30), at('Panneau avant blanc', 363, 505, 120),
      at('60/15', 18, 489, 30), at('Aire de mailles deux', 137, 489, 120), at('1x', 280, 489, 30), at('Panneau lateral blanc', 363, 489, 120),
      at('64/16', 18, 472, 30), at('Aire de mailles trois', 137, 472, 120), at('2x', 280, 472, 30), at('Panneau arriere blanc', 363, 472, 120),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      '56/14', '60/15', '64/16',
      'Aire de mailles un', 'Aire de mailles deux', 'Aire de mailles trois',
      '0x', '1x', '2x',
      'Panneau avant blanc', 'Panneau lateral blanc', 'Panneau arriere blanc',
    ])
    expect(lines.every((l) => l.multiCol)).toBe(true)
    expect(lines.some((l) => l.pairedRow)).toBe(false)
  })

  it('NON-déclenchement (d) : mono pur — run géant, aucune bande, sortie mono exacte', () => {
    const items = [
      at('Paragraphe pleine largeur numero un', 60, 740, 410),
      at('Paragraphe pleine largeur numero deux', 60, 720, 410),
      at('Paragraphe pleine largeur numero trois', 60, 700, 410),
      at('Paragraphe pleine largeur numero quatre', 60, 680, 410),
      at('Paragraphe pleine largeur numero cinq', 60, 660, 410),
      at('Paragraphe pleine largeur numero six', 60, 640, 410),
      at('Paragraphe pleine largeur numero sept', 60, 620, 410),
      at('Paragraphe pleine largeur numero huit', 60, 600, 410),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'Paragraphe pleine largeur numero un', 'Paragraphe pleine largeur numero deux',
      'Paragraphe pleine largeur numero trois', 'Paragraphe pleine largeur numero quatre',
      'Paragraphe pleine largeur numero cinq', 'Paragraphe pleine largeur numero six',
      'Paragraphe pleine largeur numero sept', 'Paragraphe pleine largeur numero huit',
    ])
    expect(lines.every((l) => !l.rightCol && !l.multiCol && !l.pairedRow)).toBe(true)
  })

  it('NON-déclenchement (e) : meris p7 contre-échantillon — la table Step‖MEANING ne signe PAS grille, sortie identique à la V1', () => {
    // Structure RÉELLE de la table meris p7 (sonde probe-v2a-bands sur le vrai PDF) : les
    // « Step N: » sont des cellules SÉPARÉES à x=67, les têtes de phrase à x=120, les defs
    // à x=318. L'écart médian 67→120 = 53pt < MIN_COL_WIDTH=60 fait FUSIONNER les deux
    // populations en une fausse « colonne clés » de médiane 46pt — les gardes parité,
    // largeur (46 ≤ 59.6pt) et contenu (« Step 1: » est lettré court) PASSENT TOUTES : c'est
    // la garde d'ALIGNEMENT qui doit rejeter (étalement 67→120 = 53pt ≫ 6pt). Sans elle,
    // la vraie page meris p7 basculait en lecture appariée et PERDAIT sa lecture régionale
    // V1 (table recollée en mono — régression engine mesurée avant le garde).
    // La sortie doit rester EXACTEMENT la voie V1 pour cette géométrie : la conclusion
    // (w=473, WIDE) ne referme pas le couloir page et l'intro est en bande extrême → la
    // GOUTTIÈRE PAGE passe → twoCols page (bloc gauche avec intro+conclusion, puis bloc
    // droit rightCol). (Le vrai PDF meris échoue ce gauntlet page — veto spanning + rangée
    // étroite — et part en régional ; les deux voies V1 sont couvertes : celle-ci ici,
    // celle-là par merisP7Items, test e-bis ci-dessous.)
    const items = [
      // intro : 2 rangées séparatrices
      at('To achieve that, the example increase round would be worked like this:', 60, 781, 370),
      at('(Remember, the INC to work in this example was m5oo1-B4-S2)', 60, 766, 345),
      // table Step ‖ MEANING : « Step N: » x=67 (w=34, gap 19 > X_GAP : cellule propre),
      // tête de phrase x=120, def x=318
      at('INSTRUCTIONS', 120, 742, 82), at('MEANING', 318, 742, 53),
      at('Step 1:', 67, 727, 34), at('k across half back stitches to INC', 120, 727, 179), at('k across half back until the next', 318, 727, 209),
      at('of prev rnd,', 120, 711, 60), at('7 stitches on your LH needle will be', 318, 711, 205),
      at('ones from the m7oo1 of the previous', 318, 695, 193),
      at('increase round,', 318, 679, 80),
      at('Step 2:', 67, 648, 34), at('work INC,', 120, 648, 49), at('k4, m5oo1, k2, distributing 4 sts', 318, 648, 205),
      at('and 2 to sleeve)', 318, 632, 77),
      at('Step 3:', 67, 601, 34), at('work INC,', 120, 601, 49), at('k2, m5oo1, k4, distributing 2 sts', 318, 601, 205),
      at('previous rnd,', 120, 585, 46), at('the ones from that m7oo1 increase', 318, 585, 195),
      // conclusion : 2 rangées séparatrices
      at('Now that you know how this raglan works, you can also follow', 60, 152, 473),
      at('the shortened version on the next page', 60, 136, 322),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual([
      'To achieve that, the example increase round would be worked like this:',
      '(Remember, the INC to work in this example was m5oo1-B4-S2)',
      // bloc GAUCHE (twoCols page : intro + table gauche + conclusion, ordre Y)
      'INSTRUCTIONS',
      'Step 1: k across half back stitches to INC',
      'of prev rnd,',
      'Step 2: work INC,',
      'Step 3: work INC,',
      'previous rnd,',
      'Now that you know how this raglan works, you can also follow',
      'the shortened version on the next page',
      // bloc DROIT (rightCol)
      'MEANING',
      'k across half back until the next',
      '7 stitches on your LH needle will be',
      'ones from the m7oo1 of the previous',
      'increase round,',
      'k4, m5oo1, k2, distributing 4 sts',
      'and 2 to sleeve)',
      'k2, m5oo1, k4, distributing 2 sts',
      'the ones from that m7oo1 increase',
    ])
    expect(lines.filter((l) => l.rightCol).map((l) => l.text)).toEqual([
      'MEANING', 'k across half back until the next', '7 stitches on your LH needle will be',
      'ones from the m7oo1 of the previous', 'increase round,', 'k4, m5oo1, k2, distributing 4 sts',
      'and 2 to sleeve)', 'k2, m5oo1, k4, distributing 2 sts', 'the ones from that m7oo1 increase',
    ])
    expect(lines.some((l) => l.pairedRow)).toBe(false)
    expectNoLoss(lines, items)
  })

  it('NON-déclenchement (e-bis) : la fixture V1 merisP7Items (cellules fusionnées) reste identique à la V1', () => {
    // La même table transcrite en cellules FUSIONNÉES (« Step 1: k across… » d'un seul
    // tenant, fixture du test régional V1) : rejetée par la garde de LARGEUR cette fois
    // (médiane 232pt ≫ 59.6pt) — les deux transcriptions de la même page doivent toutes
    // deux rester V1, quelle que soit la garde qui rejette.
    const lines = itemsToLines(merisP7Items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual(merisP7Expected)
    expect(lines.some((l) => l.pairedRow)).toBe(false)
    expectNoLoss(lines, merisP7Items)
  })
})

// ── V2b2-T5 : garde de refus « liste à étiquettes clairsemées » + grilles régionales ─
// Spec 2026-09-04-colonnage-v2 §4 : une bande qui signe la grille appariée au niveau
// RÉGIONAL se lit par paires (pairedRow, jamais rightCol) ; une bande qui ne signe NI
// grille NI la densité d'une vraie table — liste à étiquettes clairsemées + corps
// wrappé — REFUSE l'admission 2-col : la bonne lecture est le repli mono (recollement
// étiquette+corps par Y, l'ancienne lecture, celle d'avant V1).
describe('itemsToLines — V2b2 : refus des listes à étiquettes clairsemées', () => {
  const at = (str, x, y, w, h = 10) => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h, fontName: 'f1' })

  it('liste étiquetée clairsemée : 4 étiquettes sur 37 rangées → REFUS 2-col, repli mono (étiquette+corps recollés par Y)', () => {
    // Géométrie prescrite par la spec T5 (mesurée sur little-love-on-a-string-de p2,
    // sonde probe-v2a-bands 04/09) : étiquettes « 1. Reihe (Hin-R): » x=72 [72..182]
    // (w 103-111) sur 4 rangées, corps wrappé x=214 [214..526] (w 312) sur les 37
    // rangées de la bande. La page échoue au gauntlet page (gouttière : les rangées
    // étroites [72..300] de la conclusion referment le couloir page — le pied WIDE
    // y=60 étend le range Y pour que la conclusion reste HORS bande extrême, même
    // construction que le pied de merisP7Items ; bimodale : 0 cellule droite au bound
    // COL_X=249.9, le corps vit à x=214) → repli régional.
    // La bande PASSE le gauntlet régional (couloir [183..213] franc, inter=4 : chaque
    // étiquette partage sa rangée avec le corps) — mais la lecture en blocs
    // DÉSYNCHRONISE : readTwoColumns met TOUT le corps wrappé dans le bloc droit, les
    // étiquettes 2-4 finissent orphines en queue de flux gauche. Densité gauche
    // mesurée sur cette fixture : 4/37 ≈ 0.108 ≪ seuil 0.35 (meris p7 : 7/12 ≈ 0.58,
    // little-love réel : 4/13 ≈ 0.31) → REFUS, repli mono : chaque étiquette recollée
    // au corps de SA rangée par Y, ordre Y strict.
    const labels = [
      ['1. Reihe (Hin-R):', 103],
      ['2. Reihe (Rück-R):', 111],
      ['3. Reihe (Hin-R):', 103],
      ['4. Reihe (Rück-R):', 111],
    ]
    const labelRows = new Set([1, 10, 19, 28]) // i (0-based) des rangées étiquetées
    const items = [
      // bandeau plein cadre : run séparateur de 2 (cellules WIDE, hors occupation)
      at('Wimpelkette Anleitung Titel lange', 72, 780, 453),
      at('Die Wimpelkette wird in Reihen kraus rechts gearbeitet', 72, 766, 453),
      // la bande : 37 rangées (y=740 → 236, pas 14), corps sur toutes, 4 étiquettes
      ...Array.from({ length: 37 }, (_, i) => {
        const y = 740 - i * 14
        const body = at(`Stricke re bis 3 M vor Ende der Reihe hebe nummer ${String(i).padStart(2, "0")}`, 214, y, 312)
        if (!labelRows.has(i)) return [body]
        const [text, w] = labels[[...labelRows].indexOf(i)]
        return [at(text, 72, y, w), body]
      }).flat(),
      // conclusion étroite (w 228/232 < 0.55W) : referme le couloir PAGE → 2e run
      at('Schlage 6 M auf einer zur Wolle passenden Nadel', 72, 190, 228),
      at('Wimpelkette fertigstellen und alle Faden vernaeheren', 72, 176, 232),
      // pied WIDE : étend le range Y de la page (60..780) pour que la conclusion
      // étroite y=190/176 reste HORS de la bande extrême 6-94% et pèse au couloir page
      at('Urheberrechtliche Fusszeile der Anleitung die hier sehr lang ist', 72, 60, 428),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 595 })
    // sortie MONO attendue : bandeau verbatim, puis les 37 rangées dans l'ordre Y —
    // chaque étiquette recollée au corps de SA rangée (|Δy|=0), le corps wrap seul sur
    // les autres — puis la conclusion et le pied verbatim.
    const expected = [
      'Wimpelkette Anleitung Titel lange',
      'Die Wimpelkette wird in Reihen kraus rechts gearbeitet',
      ...Array.from({ length: 37 }, (_, i) => {
        const body = `Stricke re bis 3 M vor Ende der Reihe hebe nummer ${String(i).padStart(2, "0")}`
        if (!labelRows.has(i)) return body
        return `${labels[[...labelRows].indexOf(i)][0]} ${body}`
      }),
      'Schlage 6 M auf einer zur Wolle passenden Nadel',
      'Wimpelkette fertigstellen und alle Faden vernaeheren',
      'Urheberrechtliche Fusszeile der Anleitung die hier sehr lang ist',
    ]
    expect(lines.map((l) => l.text)).toEqual(expected)
    // pas de lecture 2-col du tout : ni rightCol (le corps n'est pas une colonne de
    // légendes) ni pairedRow (la bande ne signe pas : étiquettes 103-111pt ≫ 10%W)
    expect(lines.every((l) => !l.rightCol && !l.pairedRow && !l.multiCol)).toBe(true)
    expectNoLoss(lines, items)
  })

  it('contre-échantillon : la vraie table meris p7 (densité gauche 0.58) reste admise en 2-col régional — byte-identique V1', () => {
    // LE test critique de la vague (spec §4.1) : la garde de refus ne doit JAMAIS
    // toucher la table Step‖MEANING de merisP7Items — chaque rangée « Step N: ‖ def »
    // porte sa cellule gauche (7 rangées gauches sur 12 ≈ 0.58 ≫ 0.35), et les cellules
    // gauches ne sont PAS des étiquettes (têtes de phrase 33-43 chars sans « : » final).
    // Les deux mesures d'étalonnage du seuil : 4/37 ≈ 0.11 (fixture liste ci-dessus) et
    // 4/13 ≈ 0.31 (little-love réel p2) SOUS 0.35 ; 7/12 ≈ 0.58 (meris) AU-DESSUS.
    const lines = itemsToLines(merisP7Items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual(merisP7Expected)
    expect(lines.filter((l) => l.rightCol)).toHaveLength(12)
    expect(lines.some((l) => l.pairedRow)).toBe(false)
    expectNoLoss(lines, merisP7Items)
  })
})

// ── V2b2-T5 volet 1 : grille appariée au niveau RÉGIONAL ────────────────────────────
// Une grille appariée EMBARQUÉE dans une bande régionale se lit par readPairedBand
// (pairedRow, PAS de rightCol) au lieu de readTwoColumns — miroir exact de la
// priorité page (itemsToLines 2 bis : detectPairedGrid avant la cascade). Testé en
// DIRECT sur regionTwoColumns (exportée) car via itemsToLines la voie page signe
// toujours la bande d'abord (même partition, mêmes gardes) et court-circuite — le
// miroir régional garantit le bon lecteur au niveau bande par construction.
describe('regionTwoColumns — V2b2 : la bande qui signe la grille appariée se lit par paires', () => {
  // Cellules construites à la main (même forme que celles d'itemsToLines) : la bande
  // grille de loupy p4 (géométrie mesurée, cf. fixture V2a « loupy p4 ») — 6 rangées
  // 2×2, clés 22-41pt, defs 53-152pt.
  const cell = (text, x, y, w) => ({ text, x, y, endX: x + w, size: 10, bold: false, parts: [{ x, text }] })
  // Réplique minimale du toLines de itemsToLines (tri Y desc, recollage ≤ Y_TOL des
  // cellules sœurs par un séparateur x=null) — le vrai toLines est une fermeture
  // interne, regionTwoColumns le reçoit en argument.
  const toLinesFake = (list) => {
    const out = []
    let prev = null
    for (const c of [...list].sort((a, b) => b.y - a.y || a.x - b.x)) {
      if (prev && Math.abs(c.y - prev.y) <= 2.5) {
        prev.text += ` ${c.text}`
        prev.parts.push({ x: null, text: ' ' }, ...c.parts)
        continue
      }
      prev = { text: c.text, size: c.size, bold: c.bold, y: c.y, parts: [...c.parts] }
      out.push(prev)
    }
    return out
  }
  const loupyBand = [
    cell('BLCO', 36, 719, 33), cell('backwards loop cast on', 108, 719, 152), cell('REP', 298, 719, 27), cell('repeat', 370, 719, 44),
    cell('K2tog', 36, 690, 41), cell('knit two together', 108, 690, 117), cell('SSK', 298, 690, 26), cell('slip slip knit', 370, 690, 80),
    cell('LLI', 36, 676, 22), cell('left lifted increase', 108, 676, 125), cell('Sts', 298, 676, 24), cell('stitches', 370, 676, 53),
    cell('P2tog', 36, 661, 41), cell('purl two together', 108, 661, 116), cell('St st', 298, 661, 34), cell('stockinette stitch', 370, 661, 120),
    cell('RSA', 36, 647, 27), cell('right side in Colour A', 108, 647, 135), cell('WSA', 298, 647, 28), cell('wrong side in Colour A', 370, 647, 122),
    cell('RSB', 36, 618, 27), cell('right side in colour B', 108, 618, 135), cell('YO', 298, 618, 19), cell('yarn over', 370, 618, 60),
  ]

  it('une bande-grille signée → lecture appariée : pairedRow sur chaque ligne « clé def », JAMAIS rightCol', () => {
    const lines = regionTwoColumns(loupyBand, 595, toLinesFake)
    expect(lines.map((l) => l.text)).toEqual([
      'BLCO backwards loop cast on',
      'REP repeat',
      'K2tog knit two together',
      'SSK slip slip knit',
      'LLI left lifted increase',
      'Sts stitches',
      'P2tog purl two together',
      'St st stockinette stitch',
      'RSA right side in Colour A',
      'WSA wrong side in Colour A',
      'RSB right side in colour B',
      'YO yarn over',
    ])
    expect(lines.every((l) => l.pairedRow)).toBe(true)
    expect(lines.some((l) => l.rightCol)).toBe(false)
  })

  it("une bande qui ne signe PAS (items numérotés intercalés, forme cas D) garde la lecture readTwoColumns", () => {
    // La bande « séquences indépendantes » de la fixture V1 (mini-otter p3) : 12 rangées
    // de paires gauche/droite — elle PASSE le gauntlet régional (gouttière + inter) mais
    // ne signe PAS la grille appariée (clés « 1. Seq gauche un » à PRÉFIXE DE
    // NUMÉROTATION ^\d+[.)]\s — la garde KEY_NUMBERED_MAX les rejette : ce sont des
    // étapes de tutoriel, pas des clés de glossaire). Elle doit retomber sur
    // readTwoColumns : rightCol sur la colonne droite, AUCUN pairedRow.
    const band = [
      cell('1. Seq gauche un', 60, 700, 140), cell('1. Seq droite un', 340, 700, 140),
      cell('2. Seq gauche deux', 60, 680, 140), cell('2. Seq droite deux', 340, 680, 140),
      cell('3. Seq gauche trois', 60, 660, 140), cell('3. Seq droite trois', 340, 660, 140),
      cell('Suite gauche un', 60, 640, 120), cell('Suite droite un', 340, 640, 120),
      cell('Suite gauche deux', 60, 620, 120), cell('Suite droite deux', 340, 620, 120),
      cell('Suite gauche trois', 60, 600, 120), cell('Suite droite trois', 340, 600, 120),
    ]
    const lines = regionTwoColumns(band, 596, toLinesFake)
    expect(lines.some((l) => l.pairedRow)).toBe(false)
    expect(lines.filter((l) => l.rightCol)).toHaveLength(6)
  })
})

// ── Garde « chevauchement » : un sous-bloc indenté dans une colonne n'est pas une colonne ──
// Bug mesuré sur PDF réel (chunky-cortina-sweater-en-94fa2df p.2, reproduit par des scripts
// de diagnostic dédiés le 04/09) : une
// page à 2 vraies colonnes (instructions x=43, bloc infos x=305) partait en FAUSSE page
// 3 colonnes parce que la liste de fils du bloc infos, indentée à x=377 (4 cellules),
// formait un 3ᵉ cluster de x-début qui passait toutes les gardes existantes de
// detectColumns : écart médianes 377−305=72 ≥ MIN_COL_WIDTH (pas de fusion), rangées Y
// partagées avec sa colonne PARENTE (un sous-bloc est DANS le flux de sa parente — la
// garde solitaire MIN_SHARED_ROWS, taillée pour les étiquettes flottantes, ne l'élague
// pas), cellules alphabétiques (isGridToken inopérant). Conséquences : « Import risqué »
// à tort (blocking « columns ») sur une page 2 colonnes légitime, et lecture multiCol
// qui rejetait la liste de fils en FIN de flux de page. Correctif (garde ajoutée à la
// boucle d'élagage de detectColumns) : une vraie colonne n'est jamais écrite dessus par
// la colonne précédente (gouttière) — la cellule large « PUS 70 % baby alpaca… » de la
// colonne 305 (x=305, endX≈540) traverse le début de la « colonne » 377 de plus de X_GAP
// : c'est la preuve que celle-ci est un sous-bloc indenté, pas une colonne.
describe('itemsToLines — garde chevauchement (sous-bloc indenté ≠ colonne)', () => {
  // Variante AVEC width du helper PT1 (même signature que les describes « colonnage par
  // région » / V2a ci-dessus) : la géométrie du cas mesuré impose des endX contrôlés (la
  // cellule traversante doit finir à ≈540 pour exercer la garde) — sans width, endX=x et
  // aucun débordement ne peut exister.
  const at = (str, x, y, w, h = 10) => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h, fontName: 'f1' })

  it('un sous-bloc indenté dans une colonne légitime n’est pas une 3e colonne (Cortina p.2)', () => {
    // Géométrie fidèle au cas mesuré (W=595). Colonne gauche d’instructions x=43 : 6
    // rangées (y 700→380, écarts > Y_TOL), dont la dernière « Count outwards from the
    // middle of », encadrée du titre de page (y=800) et du bandeau copyright (y=40) —
    // fidèle à la page réelle (cf. plan : « colonne gauche instructions + bandeau
    // copyright en bas »), et INDISPENSABLE au repro : le range Y réel [40,800] garde la
    // rangée PUS y=745 dans la bande 6%-94% de detectColumns (avec le seul bloc infos
    // [100,780], la borne haute serait 739.2 et la cellule-vote serait exclue du calcul).
    // Colonne droite d’infos x=305 : bloc sur ~8 rangées (y 780→100) portant PLUSIEURS
    // lignes longues traversantes — la composition « PUS 70 % baby alpaca, 17 % acrylic,
    // 13 % polyamide, » [305,540] (w=235 < 0.55×595=327 : passe le filtre narrow et vote)
    // ET 5 lignes de description wrappées [305,~485-540] sur des rangées distinctes HORS
    // du sous-bloc : le vrai PDF en a 26 (mesuré au probe-cortina-clustering.mjs, 04/09).
    // Le couloir de la « colonne » 377 est ainsi piétiné sur 6 rangées (26 réelles)
    // contre 4 occupées par le sous-bloc : c’est le RATIO qui la condamne, pas une
    // cellule isolée. Sous-bloc indenté x=377 : les 4 cellules de la liste de fils, sur
    // des rangées qui PARTAGENT leur Y exact avec des cellules courtes de la colonne 305
    // (« Colour 1 » / « Colour 2 » sur 2 des 4) — indispensable pour que la fausse
    // colonne survive à la garde solitaire MIN_SHARED_ROWS SANS la garde chevauchement
    // (test ROUGE sans implémentation : page multiCol à tort, liste rejetée en fin de
    // flux). De même, 3 rangées d’instructions partagent leur Y avec la colonne droite
    // (y=700/660/460) : sans ça, la garde solitaire élagerait la vraie colonne 43 avant
    // même le bug et le faux positif ne se reproduirait pas (sur le PDF réel, les deux
    // colonnes partagent l’interligne du document).
    // Attendu APRÈS correctif : aucune ligne multiCol ; la page part sur la voie
    // 2-colonnes (gouttière : couloir libre entre la fin des instructions, ≤293, et le
    // début du bloc droit à 305) : colonne gauche entière puis colonne droite, avec les
    // 4 cellules du sous-bloc À LEUR POSITION Y dans la colonne droite (recollées à leur
    // voisine de rangée par toLines), PAS rejetées en fin de page.
    const items = [
      at('Cortina Sweater', 43, 800, 110),
      at('YARN', 305, 780, 35),
      at('PUS 70 % baby alpaca, 17 % acrylic, 13 % polyamide,', 305, 745, 235),
      at('Colour 1', 305, 720, 45), at('8 (9) 10 (11) balls', 377, 720, 93),
      at('With needle 4 cast on 88 (96) sts.', 43, 700, 200),
      at('Colour 2', 305, 700, 45), at('2 (2) 3 (3) balls', 377, 700, 88),
      at('Round 1: *K2, p2*, repeat to end.', 43, 660, 207),
      at('Mottled Anthracite 4010', 377, 660, 143),
      at('Off-White 4001', 377, 640, 88),
      at('Round 2: Knit.', 43, 620, 110),
      at('Round 3: *P2, k2*, repeat to end.', 43, 580, 207),
      at('ABBREVIATIONS', 305, 560, 80),
      at('Continue in rib until piece measures', 43, 460, 240),
      at('SIZES', 305, 460, 48),
      at('PUS is a soft and airy blend, perfect', 305, 440, 235),
      at('for warm and cosy winter accessories', 305, 420, 231),
      at('worked on big needles with a quick', 305, 400, 223),
      at('Count outwards from the middle of', 43, 380, 250),
      at('soft blend of premium fibres for a', 305, 360, 222),
      at('long lasting colourful result', 305, 340, 180),
      at('k knit, p purl.', 305, 100, 90),
      at('© House of Yarn AS', 43, 40, 95),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 595 })
    expect(lines.map((l) => l.text)).toEqual([
      // colonne gauche entière (ordre Y desc) : titre, instructions, bandeau copyright
      'Cortina Sweater',
      'With needle 4 cast on 88 (96) sts.',
      'Round 1: *K2, p2*, repeat to end.',
      'Round 2: Knit.',
      'Round 3: *P2, k2*, repeat to end.',
      'Continue in rib until piece measures',
      'Count outwards from the middle of',
      '© House of Yarn AS',
      // colonne droite : les cellules du sous-bloc x=377 entrelacées à LEUR position Y
      // dans l’ordre Y de la colonne droite, pas rejetées en fin de flux comme le
      // faisait la lecture 3-colonnes du bug
      'YARN',
      'PUS 70 % baby alpaca, 17 % acrylic, 13 % polyamide,',
      'Colour 1 8 (9) 10 (11) balls',
      'Colour 2 2 (2) 3 (3) balls',
      'Mottled Anthracite 4010',
      'Off-White 4001',
      'ABBREVIATIONS',
      'SIZES',
      'PUS is a soft and airy blend, perfect',
      'for warm and cosy winter accessories',
      'worked on big needles with a quick',
      'soft blend of premium fibres for a',
      'long lasting colourful result',
      'k knit, p purl.',
    ])
    expect(lines.every((l) => !l.multiCol)).toBe(true)
    // la voie retenue est bien la lecture 2-colonnes : tout le bloc droit (305 + le
    // sous-bloc 377 reclassé dedans) est marqué rightCol
    expect(lines.filter((l) => l.rightCol).map((l) => l.text)).toEqual([
      'YARN',
      'PUS 70 % baby alpaca, 17 % acrylic, 13 % polyamide,',
      'Colour 1 8 (9) 10 (11) balls',
      'Colour 2 2 (2) 3 (3) balls',
      'Mottled Anthracite 4010',
      'Off-White 4001',
      'ABBREVIATIONS',
      'SIZES',
      'PUS is a soft and airy blend, perfect',
      'for warm and cosy winter accessories',
      'worked on big needles with a quick',
      'soft blend of premium fibres for a',
      'long lasting colourful result',
      'k knit, p purl.',
    ])
    expectNoLoss(lines, items)
  })

  it('trade-off documenté (ratio) : une 3-colonnes ne tombe que si la gauche piétine le couloir sur PLUS de rangées que la cible n’en occupe', () => {
    // La garde v1 (quorum = 1 cellule débordante) mesurée au sweep corpus 3122 PDF :
    // 108 fichiers changés — des gains massifs (famille glow-check : tableaux
    // échantillons 3-tailles recollés par rangée, étiquettes avec leurs valeurs) MAIS
    // des régressions (stanley-the-knitting-bear p.6, dottie-beanie p.6 : cf. test
    // anti-régression ci-dessous). La garde v2 raisonne sur le RATIO D’OCCUPATION DU
    // COULOIR, en ensembles de rangées dédupliqués (clés Math.round(y/Y_TOL)) : B tombe
    // si |trav(B)| > |rows(B)|. Deux faces dans ce test :
    // (A) cible à 3 rangées + 4 traversantes de la colonne 2 sur 4 rangées distinctes
    //     ([200,420] : endX=420 > 380+18 ; w=220 < 0.55×561=308 → votantes) → 4 > 3 →
    //     colonne 3 écrasée : la page perd multiCol et retombe sur la voie 2-colonnes.
    //     La gouttière suit son cours normal : les traversantes [200,420] bouchent le
    //     couloir central [251,379], il ne reste que [157,199] (entre la fin des C1 à 70
    //     et le début des C2/Deb à 200) → bound=178 : C1 seul à gauche, C2 et C3
    //     recollés par rangée à droite. Trade-off assumé : dégradation de l’ORDRE de
    //     lecture uniquement, JAMAIS de perte de contenu (toutes les cellules restent
    //     dans le flux gauche/droit, expectNoLoss).
    // (B) symétrie : cible à 4 rangées + 3 traversantes → 3 ≤ 4 → conservée, la page
    //     RESTE multiCol. C’est le régime des vraies pages à débordements ponctuels
    //     (stanley p.6 : 3 traversantes pour ~10 rangées occupées).
    // Rangées de bourrage y=500/50 (même principe que le describe PT1 « élague une
    // colonne candidate solitaire ») : élargissent le range Y pour que la bande 6-94%
    // de detectColumns n’ampute pas les rangées utiles.
    const deb = (t, y) => at(t, 200, y, 220)
    const itemsA = [
      at('C1 pad+', 20, 500, 50), at('C2 pad+', 200, 500, 50), at('C3 pad+', 380, 500, 50),
      at('C1 haut', 20, 300, 50), at('C2 haut', 200, 300, 50), at('C3 haut', 380, 300, 50),
      at('C1 mid', 20, 280, 50), at('C2 mid', 200, 280, 50), at('C3 mid', 380, 280, 50),
      at('C1 bas', 20, 260, 50), at('C2 bas', 200, 260, 50), at('C3 bas', 380, 260, 50),
      deb('Deb une ligne large qui traverse la colonne 3 x', 240),
      deb('Deb deuxieme ligne large qui traverse la col 3', 220),
      deb('Deb troisieme ligne large qui traverse la col 3', 200),
      deb('Deb quatrieme ligne large qui traverse la col 3', 180),
      at('C1 pad-', 20, 50, 50), at('C2 pad-', 200, 50, 50), at('C3 pad-', 380, 50, 50),
    ]
    const linesA = itemsToLines(itemsA, {}, { pageWidth: 561 })
    expect(linesA.every((l) => !l.multiCol)).toBe(true)
    expect(linesA.map((l) => l.text)).toEqual([
      'C1 pad+',
      'C1 haut',
      'C1 mid',
      'C1 bas',
      'C1 pad-',
      'C2 pad+ C3 pad+',
      'C2 haut C3 haut',
      'C2 mid C3 mid',
      'C2 bas C3 bas',
      'Deb une ligne large qui traverse la colonne 3 x',
      'Deb deuxieme ligne large qui traverse la col 3',
      'Deb troisieme ligne large qui traverse la col 3',
      'Deb quatrieme ligne large qui traverse la col 3',
      'C2 pad- C3 pad-',
    ])
    expect(linesA.filter((l) => l.rightCol).map((l) => l.text)).toEqual([
      'C2 pad+ C3 pad+', 'C2 haut C3 haut', 'C2 mid C3 mid', 'C2 bas C3 bas',
      'Deb une ligne large qui traverse la colonne 3 x',
      'Deb deuxieme ligne large qui traverse la col 3',
      'Deb troisieme ligne large qui traverse la col 3',
      'Deb quatrieme ligne large qui traverse la col 3',
      'C2 pad- C3 pad-',
    ])
    expectNoLoss(linesA, itemsA)
    // (B) symétrie : cible 4 rangées (y 250→310) vs 3 traversantes → multiCol conservé
    const itemsB = [
      at('C1 pad+', 20, 500, 50), at('C2 pad+', 200, 500, 50), at('C3 pad+', 380, 500, 50),
      at('C1 un', 20, 310, 50), at('C2 un', 200, 310, 50), at('C3 un', 380, 310, 50),
      at('C1 deux', 20, 290, 50), at('C2 deux', 200, 290, 50), at('C3 deux', 380, 290, 50),
      at('C1 trois', 20, 270, 50), at('C2 trois', 200, 270, 50), at('C3 trois', 380, 270, 50),
      at('C1 quatre', 20, 250, 50), at('C2 quatre', 200, 250, 50), at('C3 quatre', 380, 250, 50),
      deb('Deb un debordement ponctuel de fin de ligne', 230),
      deb('Deb deuxieme debordement ponctuel de ligne', 210),
      deb('Deb troisieme debordement ponctuel de ligne', 190),
      at('C1 pad-', 20, 50, 50), at('C2 pad-', 200, 50, 50), at('C3 pad-', 380, 50, 50),
    ]
    const linesB = itemsToLines(itemsB, {}, { pageWidth: 561 })
    expect(linesB.every((l) => l.multiCol)).toBe(true)
    expect(linesB.map((l) => l.text)).toEqual([
      'C1 pad+', 'C1 un', 'C1 deux', 'C1 trois', 'C1 quatre', 'C1 pad-',
      'C2 pad+', 'C2 un', 'C2 deux', 'C2 trois', 'C2 quatre',
      'Deb un debordement ponctuel de fin de ligne',
      'Deb deuxieme debordement ponctuel de ligne',
      'Deb troisieme debordement ponctuel de ligne',
      'C2 pad-',
      'C3 pad+', 'C3 un', 'C3 deux', 'C3 trois', 'C3 quatre', 'C3 pad-',
    ])
  })

  it('anti-régression stanley/dottie : une vraie 3-colonnes aux débordements PONCTUELS reste multiCol', () => {
    // Régressions mesurées au sweep corpus (04/09) avec la garde v1 (quorum = 1 cellule
    // débordante) : stanley-the-knitting-bear p.6 — vrai tuto 3 colonnes dont seulement
    // 3 fins de ligne de col0 débordent sur col1 (3 traversantes pour ~10 rangées
    // occupées par la cible) → colonnes fusionnées rangée par rangée, texte mélangé ;
    // dottie-beanie p.6 — tableau de mesures, 3 traversantes vers la colonne 294 →
    // « recommandée recommandée pour le bonnet pour le bonnet ». Une vraie mise en page
    // n’écrit jamais SUR la colonne suivante : ses débordements sont ponctuels (fins de
    // lignes irrégulières, tuto Hobbii) et le couloir reste possédé par sa colonne.
    // Fixture minimale : 3 colonnes × 3 rangées (PT1) + UNE cellule votante de col0 à
    // x=100 (colOf(100)=0 : sous le seuil col1−CLUSTER_GAP=160 ; son x-début isolé
    // forme un cluster parasite d’1 cellule, filtré par MIN_COL_CELLS, mais elle reste
    // votante des gardes — pour rester narrow il FAUT qu’elle parte au-delà de x=90 :
    // une cellule [20, 400+] serait wide, hors narrow, et ne testerait rien) avec
    // w=305 : endX=405 > cols[2]+18=398 ET w < 0.55×561=308, posée sur une rangée
    // (y=240) où les colonnes cibles sont vides. trav = 1 rangée ≤ rows = 3 → les 3
    // colonnes sont conservées, la page RESTE multiCol — avec la garde v1 elle tombait
    // (c’est exactement la régression stanley).
    const items = [
      at('C1 haut', 20, 300, 50), at('C2 haut', 200, 300, 50), at('C3 haut', 380, 300, 50),
      at('C1 mid', 20, 280, 50), at('C2 mid', 200, 280, 50), at('C3 mid', 380, 280, 50),
      at('C1 bas', 20, 260, 50), at('C2 bas', 200, 260, 50), at('C3 bas', 380, 260, 50),
      at('Deb fine de ligne irreguliere qui depasse loin', 100, 240, 305),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 561 })
    expect(lines.every((l) => l.multiCol)).toBe(true)
    expect(lines.map((l) => l.text)).toEqual([
      'C1 haut', 'C1 mid', 'C1 bas', 'Deb fine de ligne irreguliere qui depasse loin',
      'C2 haut', 'C2 mid', 'C2 bas',
      'C3 haut', 'C3 mid', 'C3 bas',
    ])
  })
})

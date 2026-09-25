import { describe, it, expect } from 'vitest'
import { segmentSections, detectTitle, kindForTitle, isTitleLine } from '@/utils/pdf-import/segment'
import { NON_WORK_KINDS } from '@/utils/pdf-import/steps'

const L = (text, o = {}) => ({ text, size: 10, bold: false, y: 0, ...o })

describe('segmentSections', () => {
  it('découpe sur titres gras/majuscules et devine le kind', () => {
    const pages = [[
      L('Stockholm Sweater', { size: 24 }),
      L('Un pull raglan tout simple.'),
      L('ÉCHANTILLON', { size: 10 }),
      L('20 m x 28 rangs = 10 cm en jersey'),
      L('Corps', { bold: true, size: 14 }),
      L('Rang 1 : tricoter à l’endroit.'),
      L('Manches', { bold: true, size: 14 }),
      L('Relever 52 m. autour de l’emmanchure.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => [s.title, s.kind])).toEqual([
      ['Stockholm Sweater', 'pelote'],
      ['ÉCHANTILLON', 'echantillon'],
      ['Corps', 'corps'],
      ['Manches', 'manche'],
    ])
    expect(secs[2].lines.map((l) => l.text)).toEqual(['Rang 1 : tricoter à l’endroit.'])
  })
  it('marque les sections de référence (abréviations, matériel, mesures)', () => {
    const pages = [[
      L('ABRÉVIATIONS', { bold: true }), L('m. = maille'),
      L('MATÉRIEL', { bold: true }), L('Fil : Silk Mohair 25 g'),
      L('MESURES', { bold: true }), L('a. Tour de buste : 102 (112) 122 cm'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['abbr', 'materiel', 'mesures'])
  })
  it('bandeau de couverture ES « PATRÓN DE DOS AGUJAS » (page 0) est écarté comme bruit, pas fusionné dans Aiguilles', () => {
    // Cas réel penny-socks-es-3b0f0a03 (corpus Hobbii, vague 5) : le bandeau de
    // couverture espagnol pour un patron TRICOT (« deux aiguilles », par opposition à
    // « ganchillo » = crochet) n'était couvert par aucune alternative de
    // CRAFT_BANNER_RE — seuls punto/ganchillo/crochet/tricot l'étaient. Faute de ce
    // match, kindForTitle classait le bandeau `aiguilles` (collision `agujas?` sur la
    // sous-chaîne AGUJAS du bandeau lui-même), et ses 2 lignes de page de garde (nom du
    // patron coupé en 2 lignes) fusionnaient avec les vraies sections Aiguilles du
    // document — 2 items fabriqués dans la liste Matériel au final. Vérifié sans
    // régression sur le corpus complet (3122 PDF, `yarn corpus:measure`) : seuls les 14 patrons
    // hobbii/es/knitting portant ce bandeau changent (confirmé par balayage dédié de
    // leur page 0), tous dans le sens attendu ; 0 diff structurel ailleurs.
    const pages = [[
      L('PATRÓN DE DOS AGUJAS'),
      L('Penny'),
      L('Calcetines'),
      L('MATERIALES', { bold: true }),
      L('1 ovillo Friends Sock Wool color 27'),
      L('Un juego de 5 agujas de doble punta de', { bold: true }),
      L('2,25 mm'),
    ]]
    const secs = segmentSections(pages)
    const banner = secs.find((s) => s.title === 'PATRÓN DE DOS AGUJAS')
    expect(banner).toBeDefined()
    expect(banner.noise).toBe(true)
    expect(banner.ref).not.toBe('aiguilles')
    const aiguillesLines = secs.filter((s) => s.ref === 'aiguilles').flatMap((s) => s.lines.map((l) => l.text))
    expect(aiguillesLines).not.toContain('Penny')
    expect(aiguillesLines).not.toContain('Calcetines')
  })
  it('« Aguja lanera » (aiguille à laine, un vrai article de Matériel) n\'est pas classée aiguilles ni perdue', () => {
    // Cas réel penny-socks-es-3b0f0a03 (second mécanisme, après le bandeau de
    // couverture déjà corrigé ci-dessus) : « Aguja lanera » (aiguille à laine — un
    // accessoire, PAS une déclaration de taille d'aiguille) est promue à tort en titre
    // (gap vertical avant la ligne sur le PDF réel, ici reproduit par bold : signal
    // équivalent pour isTitleLine, la promotion elle-même est correcte et générique)
    // ET classée `aiguilles` par collision lexicale (« agujas? » de KIND_KEYWORDS
    // matche la sous-chaîne AGUJA de « Aguja lanera », comme « ear » matchait par
    // accident dans « Explorer », déjà corrigé plus haut dans ce fichier). Une fois
    // promue, son propre texte n'a ni chiffre ni « : » : rien ne le retenait comme
    // ligne (segment.js ~1466), disparaissant purement et simplement.
    // Une première piste (retenir le texte de tout titre référence qui rouvre le MÊME
    // ref que la section précédente) a été essayée et REJETÉE (11/09) : vérifiée
    // sur le corpus complet, elle régressait 672 patrons sur 3122 (le gabarit Hobbii
    // répète légitimement deux titres `ref=mesures` consécutifs, TAILLE puis MESURES).
    // Piste retenue à la place, plus étroite : reconnaître directement que « Aguja
    // lanera » n'est pas un vrai en-tête référence, sur le modèle des détecteurs
    // looksLikeGlossaryEntry/looksLikeActionTitle déjà présents pour cette même classe
    // de bug (collision lexicale incidente) — mirroir ES de
    // NEEDLE_ACCESSORY_QUALIFIER_ADJACENT_RE (reference.js), qui traite déjà FR
    // « aiguille à laine »/DE « Garnnadel » mais pas l'ES. Vérifié sur le corpus
    // complet (3122 PDF, `yarn corpus:measure`) : diff structurel nul (hors mesure,
    // cf. commentaire du correctif dans segment.js).
    const pages = [[
      L('MATERIALES', { bold: true }),
      L('1 ovillo Friends Sock Wool color 27'),
      L('Un juego de 5 agujas de doble punta de', { bold: true }),
      L('2,25 mm'),
      L('Aguja lanera', { bold: true }),
      L('Marcador de puntos'),
      L('Contador de vueltas'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.some((s) => s.title === 'Aguja lanera')).toBe(false)
    const aiguillesLines = secs.filter((s) => s.ref === 'aiguilles').flatMap((s) => s.lines.map((l) => l.text))
    expect(aiguillesLines).toContain('Aguja lanera')
  })
  it('route un titre de section « techniques » (astuces/comment faire) en référence dédiée', () => {
    // Barley Field – Gilet (fr, corpus réel) : « ASTUCES POUR RÉALISER
    // LES AUGMENTATIONS » n'était classée nulle part (kindForTitle → 'info', diluée en
    // Présentation) — 3e récidive journalisée. Astuces/
    // conseils/tips ne comptent QUE liés à un complément d'action (« pour »/« for »…) :
    // le mot nu reste vers `info`, cf. test de non-régression séparé ci-dessous (gate
    // « INFO AND TIPS »/« INFO ET CONSEILS »/« INFO UND TIPPS » → {other}).
    const pages = [[
      L('ASTUCES POUR RÉALISER LES AUGMENTATIONS', { bold: true }),
      L('M1R : Piquer l’aiguille gauche sous le brin entre deux mailles.'),
      L('Techniques', { bold: true }),
      L('Un rappel des points spéciaux utilisés dans ce modèle.'),
      L('Comment faire le croisement', { bold: true }),
      L('Plier la chaînette de départ pour joindre les extrémités.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['techniques', 'techniques', 'techniques'])
  })
  it('ne route PAS vers `techniques` un titre nu d’aide générale (gate : oracle {other} ; un arbitrage → kind dédié `infos`)', () => {
    // Decorative Pumpkins (en), Easter Egg (no), Penny the Panda (de), Soft Twist
    // Mittens (fr) : ces 4 refs du gate portent une rubrique d'aide générale titrée
    // avec les mêmes mots « tips »/« conseils » que Techniques, mais SANS complément
    // d'action — l'oracle les tague {other}, jamais {techniques}. Un arbitrage
    // (03/09) : ces rubriques gardent un kind dédié `infos` (section consultable),
    // sauf le mot « Tips » NU qui reste `info` (cf. bloc arbitrage plus bas).
    expect(kindForTitle('INFO AND TIPS')).toBe('infos')
    expect(kindForTitle('Tips')).toBe('info')
    expect(kindForTitle('INFO ET CONSEILS')).toBe('infos')
    expect(kindForTitle('INFO UND TIPPS')).toBe('infos')
  })
  // « \b » ne borne pas une lettre accentuée : « Tył » (pl) doit garder son kind.
  it('mot-clé finissant par une lettre accentuée : « Tył » → corps', () => {
    expect(kindForTitle('Tył')).toBe('corps')
    expect(kindForTitle('TYŁ')).toBe('corps')
  })
  it('un rang « Fila » (espagnol, à plat) referme un bloc abréviations comme « Vuelta » (Memory Game)', () => {
    // Memory Game (ES, crochet, corpus réel) : « Fila » manquait à ROW_START_RE → un rang
    // « Fila 1: … » collé sous ABREVIATURAS restait avalé dans la section abbr au lieu
    // d'ouvrir une section de travail (cf. Bug P0, l.315 segment.js).
    const pages = [[
      L('ABREVIATURAS', { bold: true }), L('pb = punto bajo'),
      L('Fila 1: 6 pb en el 2do anillo desde el gancho.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['abbr', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual(['Fila 1: 6 pb en el 2do anillo desde el gancho.'])
  })
  it('un rang « Ronda »/« Rondas » (espagnol crochet, en rond) referme un bloc abréviations comme « Vuelta » (holiday-ornament-es, palier 6)', () => {
    // holiday-ornament-es-c3ac4214 (corpus réel, crochet) : « Ronda » (mot de rang crochet ES
    // très courant, à côté de « Vuelta ») manquait à ROW_START_RE → « Ronda N: … » restait
    // avalé dans la section abbr, et une incise « Repite { } N veces » à l'intérieur d'un
    // rang non reconnu comme tel se faisait à tort marquer « × » (compteur REP parasite,
    // cf. steps.js l.42-49) au lieu de rester un rang cochable normal.
    const pages = [[
      L('ABREVIATURAS', { bold: true }), L('pb = punto bajo'),
      L('Ronda 1: 6 pb en el círculo mágico.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['abbr', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual(['Ronda 1: 6 pb en el círculo mágico.'])
  })
  it('un rang « Vt » (espagnol tricot, abréviation documentée de « Vuelta ») referme un bloc abréviations (serenity-sweater-es, palier 6)', () => {
    // serenity-sweater-es-f1e18764 (corpus réel, tricot) : « Vt 1: … »/« Vt 2: … » (légende
    // de point, abréviation « Vt » = « Vuelta » documentée dans le tableau d'abréviations du
    // patron lui-même, | Vt | Vuelta |) était classée à tort en TITRE de section (« ### Vt 1 »)
    // faute de reconnaissance comme rang — token court mais ancré en tête de ligne + chiffre
    // immédiat, comme les autres abréviations courtes déjà dans l'alternance (« r.\ », « krs »).
    const pages = [[
      L('ABREVIATURAS', { bold: true }), L('d = derecho'),
      L('Vt 1: *D1, r1, repite de * hasta el último pt, d1.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['abbr', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual(['Vt 1: *D1, r1, repite de * hasta el último pt, d1.'])
  })
  it('non-régression : « Vt » ne colle pas à un autre mot au chiffre voisin (aucune fausse détection de rang en milieu de phrase)', () => {
    // Garde anti-collision (token court « vt ») : ROW_START_RE est ancré en tête de ligne
    // (^\s*) — une ligne qui ne COMMENCE PAS par « vt »/« vts » ne doit jamais matcher, même
    // si « vt » apparaît ailleurs dans la phrase suivi d'un chiffre.
    const pages = [[
      L('Notes', { bold: true }),
      L('Consulte le tableau vt 2 fois si besoin, avant de continuer.'),
    ]]
    const secs = segmentSections(pages)
    // La ligne reste dans sa section d'origine (pas de split abbr→travail puisqu'il n'y a
    // pas de bloc abbr ici) : surtout, isTitleLine ne doit pas la considérer comme un rang
    // (elle n'est de toute façon pas un titre ici), et aucune section « Instructions » n'est
    // ouverte à tort par la logique de fermeture abbr/materiel/echantillon.
    expect(secs).toHaveLength(1)
    expect(secs[0].lines.map((l) => l.text)).toEqual(['Consulte le tableau vt 2 fois si besoin, avant de continuer.'])
  })
  it('« Hilera » (espagnol crochet, rang à plat) referme un bloc abréviations directement via ROW_START_RE (résorbé à la source, palier 6)', () => {
    // Même mécanisme que Fila/Vuelta/Ronda ci-dessus : avant ce correctif, « hilera » ne
    // vivait QUE dans ROW_RE (steps.js) — angle mort pour sectionHasRowLine/ROW_START_RE
    // (contourné jusqu'ici par la garde locale MISSED_ROW_RE, cf. tests plus bas). Ajouté
    // directement à ROW_START_RE : ce test vérifie le mécanisme PRINCIPAL (fermeture de
    // section), pas seulement la garde locale.
    const pages = [[
      L('ABREVIATURAS', { bold: true }), L('pb = punto bajo'),
      L('Hilera 1: 6 pb en el anillo mágico.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['abbr', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual(['Hilera 1: 6 pb en el anillo mágico.'])
  })
  it('« Reihe » (allemand, mot complet) referme un bloc abréviations directement via ROW_START_RE (résorbé à la source, palier 7, peonie-flower-de)', () => {
    // Même mécanisme que Hilera au palier 6 : avant ce correctif, « reihen? » ne vivait QUE
    // dans ROW_RE (steps.js) — angle mort pour sectionHasRowLine/ROW_START_RE, contourné
    // jusqu'ici par la garde locale MISSED_ROW_RE (retirée à ce palier, devenue redondante).
    const pages = [[
      L('ABKÜRZUNGEN', { bold: true }), L('fM = feste Masche'),
      L('Reihe 1: 6 fM in einen magischen Ring.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['abbr', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual(['Reihe 1: 6 fM in einen magischen Ring.'])
  })
  it('« R » (allemand, abréviation courte de « Reihe ») referme un bloc abréviations directement via ROW_START_RE (palier 7, peonie-flower-de, IMPACT RÉEL CONFIRMÉ)', () => {
    // peonie-flower-de-bc2e2ed0 (corpus réel, crochet) : 6 des 8 sections de travail du
    // corps (« R 1 :», « R 2: »… numérotées) restaient kind='pelote' faute de détection —
    // la reclassification post-hoc pelote→autre ne se déclenchait jamais pour elles.
    const pages = [[
      L('ABKÜRZUNGEN', { bold: true }), L('fM = feste Masche'),
      L('R 1 : 6 fM in einen magischen Ring'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['abbr', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual(['R 1 : 6 fM in einen magischen Ring'])
  })
  it('« Rd » (allemand, abréviation PRÉFIXE de « Runde », bernadette-tote-bag-de-1e86ff98) referme un bloc abréviations directement via ROW_START_RE', () => {
    // Même mécanisme que « R » ci-dessus, mais pour la forme crochet « Rd 6: … » (Runde).
    // En cascade sur le corpus réel : sans elle, sectionHasRowLine ne voyait aucun rang
    // dans « Bild 1 » → jamais reclassée pelote→autre, et ses longues rondes (>220 car.)
    // restaient des notes non cochables côté steps (asymétrie NEW_ITEM_RE/ROW_RE).
    const pages = [[
      L('ABKÜRZUNGEN', { bold: true }), L('fM = feste Masche'),
      L('Rd 6: 1 Lm (zählt nicht als M), 3 fM in den nächsten 3-Lm-Bg.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['abbr', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual(['Rd 6: 1 Lm (zählt nicht als M), 3 fM in den nächsten 3-Lm-Bg.'])
  })
  it('« 1st row: » (ordinal anglais ANTÉPOSÉ, Yarnspirations/Bernat, lush-life-crochet-blanket-en-97699620, corpus réel) referme un bloc abréviations comme « Row 1 »', () => {
    // ROW_START_RE n'acceptait que « mot de rang PUIS chiffre » (« Row 3 »). Les patrons
    // Yarnspirations/Bernat écrivent l'inverse : « 1st row: … », « 2nd row: … ». Avant ce
    // correctif, sectionHasRowLine ne voyait aucun rang dans la section « INSTRUCTIONS » du
    // PDF réel — elle se repliait en intro non cochable et les rangs partaient se coller au
    // titre technique suivant (« BRC0502-000987M | September 18, 2020 »).
    const pages = [[
      L('ABBREVIATIONS', { bold: true }), L('Ch = Chain'),
      L('1st row: (RS). 1 dc in 4th ch from hook (counts as 2 dc). Turn. 65 dc.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['abbr', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual([
      '1st row: (RS). 1 dc in 4th ch from hook (counts as 2 dc). Turn. 65 dc.',
    ])
  })
  it('« 2nd row »/« 3rd row »/« 4th row » (autres ordinaux anglais antéposés) sont aussi reconnus comme début de rang par isTitleLine', () => {
    // isTitleLine rejette IMMÉDIATEMENT (avant tout autre critère) une ligne qui matche
    // ROW_START_RE — même mécanisme de garde-fou EXPOSÉ que le test R0416 ci-dessous.
    // Lignes en gras, courtes, sans ponctuation finale : sans la détection ordinale, elles
    // seraient prises pour des titres.
    expect(isTitleLine(L('2nd row', { bold: true }), 10)).toBe(false)
    expect(isTitleLine(L('3rd row', { bold: true }), 10)).toBe(false)
    expect(isTitleLine(L('4th row', { bold: true }), 10)).toBe(false)
    expect(isTitleLine(L('21st round', { bold: true }), 10)).toBe(false)
  })
  it('« 1er rang »/« 2e rang »/« 1ère tour » (ordinaux français antéposés) sont reconnus comme début de rang par isTitleLine', () => {
    expect(isTitleLine(L('1er rang', { bold: true }), 10)).toBe(false)
    expect(isTitleLine(L('2e rang', { bold: true }), 10)).toBe(false)
    expect(isTitleLine(L('1ère tour', { bold: true }), 10)).toBe(false)
  })
  it('« 1.Reihe »/« 2.Runde »/« 1.Rd » (ordinal allemand COLLÉ au point, convention Hobbii DE, knit-domino-shawl-de) sont reconnus comme début de rang par isTitleLine', () => {
    // knit-domino-shawl-de-61747066 (corpus réel) : cet éditeur écrit l'ordinal SANS espace
    // après le point (« 1.Reihe (linke Seite): … », « 1.Rd: … »). Ni la branche ordinale
    // antéposée ci-dessus (suffixe st/nd/er/e collé AU chiffre, requis) ni BARE_ITEM_RE
    // (espace requis après le point) ne couvrent la forme collée. Garde-fou exposé, comme
    // pour les ordinaux EN/FR ci-dessus : une ligne qui matche ROW_START_RE sort en échec
    // immédiat d'isTitleLine, avant tout autre critère.
    expect(isTitleLine(L('1.Reihe (linke Seite)', { bold: true }), 10)).toBe(false)
    expect(isTitleLine(L('2.Reihe (rechte Seite)', { bold: true }), 10)).toBe(false)
    expect(isTitleLine(L('2.Runde', { bold: true }), 10)).toBe(false)
    expect(isTitleLine(L('1.Rd', { bold: true }), 10)).toBe(false)
  })
  it('non-régression : ordinal collé + mot NON-rang (« 1.Masche »/« 3.Stb ») ou numéro de liste nu n’est PAS un début de rang', () => {
    // Contre-tests de la branche ordinale collée : le MOT DE RANG (reihe/runde/rd) est
    // exigé après le point. Un ordinal suivi d'un nom non-rang, ou un numéro de liste nu
    // (bold → passe la garde BARE_ITEM, cf. test « 1. VORDERTEIL » plus bas), reste
    // éligible au titre — exactement comme avant le correctif.
    expect(isTitleLine(L('1.Masche abheben', { bold: true }), 10)).toBe(true)
    expect(isTitleLine(L('3.Stb in dieselbe Masche', { bold: true }), 10)).toBe(true)
    expect(isTitleLine(L('1. Zugabe', { bold: true }), 10)).toBe(true)
  })
  it('non-régression : « 2 rows below » (définition d’abréviation « Trfp », même PDF réel) n’est PAS pris pour un début de rang', () => {
    // Le même PDF réel (lush-life-crochet-blanket-en-97699620) porte, dans la définition de
    // l'abréviation « Trfp », la phrase « … around post of next dc 2 rows below at front of
    // work … ». Chiffre PUIS mot de rang, SANS ordinal antéposé (pas de « 2nd »/« 2e ») :
    // ne doit jamais matcher ROW_START_RE. Vérifié via isTitleLine (garde-fou exposé) :
    // si la ligne matchait ROW_START_RE à tort, isTitleLine retournerait `false` malgré le
    // gras — ici elle doit rester `true`.
    expect(isTitleLine(L('2 rows below', { bold: true }), 10)).toBe(true)
  })
  it('non-régression : « 3 rangs de plus » (même construction, chiffre puis mot de rang, français) n’est PAS pris pour un début de rang', () => {
    expect(isTitleLine(L('3 rangs de plus', { bold: true }), 10)).toBe(true)
  })
  it('non-régression CRITIQUE : « Instructions » (générique, en, AVEC de vrais rangs « 1st row: »/« 2nd row: », lush-life-crochet-blanket-en-97699620, corpus réel) ne devient PAS intro et reste reclassée vers « autre »', () => {
    // Même mécanisme que les tests Anleitung/Instrucciones ci-dessus (promotion post-hoc
    // pelote → intro d'un titre générique SANS rang) : ce titre-ci EN PORTE, via l'ordinal
    // antéposé — il ne doit donc jamais partir en intro non cochable.
    const pages = [[
      L('Instructions', { bold: true }),
      L('With A, ch 67.'),
      L('1st row: (RS). 1 dc in 4th ch from hook (counts as 2 dc). Turn. 65 dc.'),
      L('2nd row: Ch 1. 1 sc in each dc to end of row. Turn.'),
    ]]
    const secs = segmentSections(pages)
    const instr = secs.find((s) => s.title === 'Instructions')
    expect(instr).toBeTruthy()
    expect(instr.intro).toBe(false)
    expect(instr.kind).toBe('autre')
  })
  it('non-régression CRITIQUE : « R0416 » (référence de patron/SKU, venetien-shawl-fr-00cde606, corpus réel gate) ne matche JAMAIS ROW_START_RE — collision réelle trouvée, pas hypothétique', () => {
    // Vigilance anti-collision explicitement demandée pour le token d'UNE lettre « r » :
    // venetien-shawl-fr-00cde606 (25 réf. gate) porte deux lignes autonomes « R0416 »
    // (référence produit, cf. pied de page « hobbii-pattern-sku:pattern-R0416 ») qui
    // survivent à stripBoilerplate. Testé via isTitleLine (garde-fou EXPOSÉ : une ligne qui
    // matche ROW_START_RE sort en échec immédiat, avant même le test majuscules/gras/taille,
    // cf. segment.js l.277) plutôt que via segmentSections : « R0416 » satisfait de toute
    // façon le repli majuscules (aucune minuscule dans le texte) et deviendrait son propre
    // titre quelle que soit l'issue de ROW_START_RE — seul isTitleLine distingue si c'est
    // PARCE QUE ROW_START_RE ne matche pas (correct, résultat `true`) ou MALGRÉ un
    // court-circuit ROW_START_RE qui aurait dû s'appliquer (bug, `false` immédiat). Sans
    // l'exigence \s+ (espace obligatoire) entre le « R » et le chiffre — au lieu du \s*
    // partagé par les autres tokens de l'alternance — ce test échouerait (retournerait
    // `false`).
    expect(isTitleLine(L('R0416', { size: 10 }), 10)).toBe(true)
  })
  it('bug réel granny-shawl-jacket-de-5f09f875 : un item numéroté nu (« 1. Wann die Seelenwärmer gehäkelt ist, ») promu titre par le SEUL signal taille reste du texte', () => {
    // PDF réel : 3 consignes d'assemblage numérotées puis une légende de schéma elle-même
    // numérotée sont en taille 10 (bold=false, casse mixte) contre un corps de document à
    // 8 (dominé en poids de caractères par les blocs fil/matériel/légendes, pas par le
    // corps réel du patron) — ratio 1,25 ≥ 1,15 franchit le seuil `strongTitle`, scindant
    // à tort une liste d'assemblage en 4 « ## » fantômes (défaut bloquant, constaté sur le
    // corpus réel). BARE_ITEM_RE matche ces 6 lignes ; aucune n'est bold ni tout-capitales.
    expect(isTitleLine(L('1. Wann die Seelenwärmer gehäkelt ist,', { size: 10 }), 8)).toBe(false)
    expect(isTitleLine(L('2. Von der 2 Ecken gerechnet, am', { size: 10 }), 8)).toBe(false)
    expect(isTitleLine(L('3. Das Teil welche nicht genäht ist, formt', { size: 10 }), 8)).toBe(false)
    expect(isTitleLine(L('1. Falte In zwei Hälften', { size: 10 }), 8)).toBe(false)
    expect(isTitleLine(L('3. Armloch', { size: 10 }), 8)).toBe(false)
    expect(isTitleLine(L('2. Näh am', { size: 10 }), 8)).toBe(false)
  })
  it('anti-faux-positif : un VRAI titre de pièce numéroté (gras ou tout-capitales) reste promu malgré la forme BARE_ITEM_RE', () => {
    // La garde ci-dessus est étroite à dessein (SUPPRESS-ONLY, signal taille seul) : un
    // numéro de pièce authentique, mis en emphase par le gras ou les capitales dans le PDF
    // (contrairement aux 6 lignes ci-dessus, toutes bold=false et casse mixte), reste un
    // titre — sans quoi un vrai « 1. VORDERTEIL »/« 2. Rückenteil » du corpus serait démis
    // en texte au lieu d'ouvrir sa section.
    expect(isTitleLine(L('1. VORDERTEIL', { size: 8 }), 8)).toBe(true)
    expect(isTitleLine(L('2. Rückenteil', { size: 8, bold: true }), 8)).toBe(true)
  })
  it('compromis assumé (balayage corpus 3122 patrons) : un vrai titre de pièce en casse mixte, sans gras ni majuscules, perd son `##` sur cette garde', () => {
    // Documente le comportement ACTUEL, accepté en connaissance de cause plutôt que laissé
    // non couvert (revue suite au commit ec51e73d). Cas réel du corpus :
    // ravelry/plant-buddies-en-c42069ae, « 4. Top Leaves (Lace yarn, 1.75 mm hook) »
    // (taille 19,98 contre un corps à 14, casse mixte, non gras) — un vrai titre de pièce,
    // mais formellement indiscernable d'un item de liste numéroté puisque ni gras ni
    // majuscules ne le distinguent. Pas de régression nette mesurée sur ce fichier réel
    // (76 lignes identiques avant/après, fidélité globale même améliorée : 66→73) : la
    // garde reste la bonne étroitesse tant qu'aucune heuristique plus fine n'existe pour
    // séparer ce cas d'un vrai item BARE_ITEM_RE en casse mixte (cf. garde ci-dessus).
    expect(isTitleLine(L('4. Top Leaves (Lace yarn, 1.75 mm hook)', { size: 19.98 }), 14)).toBe(false)
  })
  it('non-régression : « R » ne colle pas à un chiffre sans espace en tête de ligne (aucune fausse détection de rang), y compris pour « r. » avec point', () => {
    // Généralise le cas R0416 ci-dessus : ni « R4 » (sans espace), ni « R.4 » (point sans
    // espace) ne doivent matcher — seule la forme réellement observée dans le corpus
    // (« R 1 :», « R. 41: », espace toujours présent avant le chiffre) doit matcher.
    const pages = [[
      L('MATÉRIEL', { bold: true }), L('Aiguille : n°4'),
      L('R4 en référence dans le catalogue.'),
      L('R.4 autre référence catalogue.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs).toHaveLength(1)
    expect(secs[0].ref).toBe('materiel')
    expect(secs[0].lines.map((l) => l.text)).toEqual([
      'Aiguille : n°4',
      'R4 en référence dans le catalogue.',
      'R.4 autre référence catalogue.',
    ])
  })
  it('un rang numéroté nu referme un bloc matériel comme un bloc abréviations (snuggle-blanket-fr)', () => {
    // snuggle-blanket-fr-e45fa989 (corpus réel) : le titre de section « Tutoriel – … »
    // (65 caractères) dépasse le plafond de longueur d'isSpacedTitle (42 car. hors
    // ALLCAPS) et n'est donc jamais promu en titre de section — ## Matériel reste
    // ouverte et les rangs du crochet qui suivent sont TOUS avalés dedans (perdus
    // comme lignes de matériel, non cochables). Même mécanisme que le bug P0 abbr
    // (l.384-402) : dès la 1re VRAIE ligne de rang, on referme materiel et on ouvre
    // une section de travail.
    const pages = [[
      L('MATÉRIEL', { bold: true }), L('Fil : Coton 50 g'),
      L('1. Monter 40 mailles avec l’aiguille n°4.'),
      L('2. Tricoter 3 rangs au point mousse.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['materiel', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual([
      '1. Monter 40 mailles avec l’aiguille n°4.',
      '2. Tricoter 3 rangs au point mousse.',
    ])
  })
  it('un rang numéroté nu referme un bloc échantillon comme un bloc matériel/abréviations (knit-domino-shawl-de, campagne de test palier 5)', () => {
    // knit-domino-shawl-de-61747066 (corpus réel) : la police embarquée rapporte
    // fontFamily 'serif' générique pour TITRES ET CORPS (même taille, Title Case) →
    // AUCUN titre suivant « Maschenprobe » (échantillon) n'est jamais promu (ni gras
    // ni majuscules ni grande police, isSpacedTitle désarmé en bloc echantillon
    // l.317-340) : tout le reste du patron (table d'abréviations, 2 « Bahn », le bord,
    // 5 blocs technique) s'engouffre dans une UNIQUE section échantillon, confiance
    // moteur 40. Même mécanisme que abbr/materiel (l.384-406) : dès la 1re VRAIE ligne
    // de rang numérotée nue, on referme échantillon et on ouvre une section de travail.
    const pages = [[
      L('MASCHENPROBE', { bold: true }), L('22 M = 10 cm'),
      L('1. Monter 47 mailles.'),
      L('2. Tricoter 2 rangs au point mousse.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['echantillon', null])
    expect(secs[1].lines.map((l) => l.text)).toEqual([
      '1. Monter 47 mailles.',
      '2. Tricoter 2 rangs au point mousse.',
    ])
  })
  it('« 1.Reihe » (ordinal COLLÉ, même PDF knit-domino-shawl-de) referme le bloc échantillon dès le PREMIER rang, pas au « 2. Reihe » espacé d’après', () => {
    // Suite directe du cas ci-dessus : dans le PDF réel, les rangs de la première
    // patcheck sont écrits dans la convention Hobbii DE ordinale COLLÉE (« 1.Reihe
    // (linke Seite): … », « 2.Reihe … ») et la première forme ESPACÉE (« 2. Reihe »,
    // BARE_ITEM_RE) n'arrive que 16 lignes d'instructions plus bas — la soupape
    // echantillon ne se fermait donc qu'à ce moment-là, toute l'introduction de la
    // première Bahn déversée dans la carte Échantillon. Avec la branche ordinale collée
    // de ROW_START_RE, la fermeture a lieu au premier « 1.Reihe » ; les intitulés qui ne
    // sont pas des rangs (« Erste Patchecke », pas promu titre : isSpacedTitle désarmé
    // en bloc echantillon) restent dans la carte, le correctif causal complet (désarmement
    // echantillon) étant reporté.
    const pages = [[
      L('MASCHENPROBE', { bold: true }), L('22 M = 10 cm'),
      L('Erste Patchecke'),
      L('1.Reihe (linke Seite): 1 M re abheben, re bis Ende der Nadel.'),
      L('Die mittlere Masche markieren.'),
      L('2.Reihe (rechte Seite): 1 M re abheben, re bis Nadelende.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.ref)).toEqual(['echantillon', null])
    expect(secs[0].lines.map((l) => l.text)).toEqual(['22 M = 10 cm', 'Erste Patchecke'])
    expect(secs[1].lines.map((l) => l.text)).toEqual([
      '1.Reihe (linke Seite): 1 M re abheben, re bis Ende der Nadel.',
      'Die mittlere Masche markieren.',
      '2.Reihe (rechte Seite): 1 M re abheben, re bis Nadelende.',
    ])
  })
  it('ne referme PAS un bloc échantillon normal (ligne de jauge numérique, tableau de tailles) — non-régression', () => {
    // Une section échantillon est PAR NATURE numérique (« 20 m x 28 rangs = 10 cm »).
    // Vérifie que les gardes existantes (KV_RE, looksLikeTableRow) empêchent bien une
    // VRAIE ligne de jauge/mesure de déclencher à tort la fermeture, comme pour abbr/
    // materiel. « 20 m x 28 rangs = 10 cm » ne matche même pas BARE_ITEM_RE (pas de
    // point/parenthèse après le nombre) ; un item KV (« 2) Aiguille : n°4 ») et une
    // rangée de tableau de tailles (« 36. 84 88 92 96 100 ») sont guardés explicitement.
    const pages = [[
      L('ÉCHANTILLON', { bold: true }),
      L('20 m x 28 rangs = 10 cm au point jersey'),
      L('2) Aiguille : n°4'),
      L('36. 84 88 92 96 100'),
      L('Taille 36 38 40 42'),
    ]]
    const secs = segmentSections(pages)
    expect(secs).toHaveLength(1)
    expect(secs[0].ref).toBe('echantillon')
    expect(secs[0].lines.map((l) => l.text)).toEqual([
      '20 m x 28 rangs = 10 cm au point jersey',
      '2) Aiguille : n°4',
      '36. 84 88 92 96 100',
      'Taille 36 38 40 42',
    ])
  })
  it('ne referme PAS un bloc matériel normal (quantités, item numéroté KV, tableau de tailles) — non-régression', () => {
    // Une ligne de quantité (« 2 pelotes de laine X »), un item de matériel numéroté
    // « clé : valeur » (« 2) Laine : Coton 50g », matche BARE_ITEM_RE mais guardé par
    // KV_RE) ou une rangée de tableau des tailles débutant par un numéro suivi d'un
    // point (« 36. 84 88 92 96 100 », matche BARE_ITEM_RE mais guardé par
    // looksLikeTableRow) ne doivent JAMAIS déclencher la fermeture : mêmes garde-fous
    // que pour abbr.
    const pages = [[
      L('MATÉRIEL', { bold: true }),
      L('2 pelotes de laine X'),
      L('Aiguille : n°4'),
      L('2) Laine : Coton 50g'),
      L('36. 84 88 92 96 100'),
      L('Taille 36 38 40 42'),
    ]]
    const secs = segmentSections(pages)
    expect(secs).toHaveLength(1)
    expect(secs[0].ref).toBe('materiel')
    expect(secs[0].lines.map((l) => l.text)).toEqual([
      '2 pelotes de laine X',
      'Aiguille : n°4',
      '2) Laine : Coton 50g',
      '36. 84 88 92 96 100',
      'Taille 36 38 40 42',
    ])
  })
  it('une ligne longue ou finissant par un point n’est jamais un titre', () => {
    const pages = [[L('Corps', { bold: true }), L('Tricoter en jersey. Continuer.', { bold: true })]]
    expect(segmentSections(pages)).toHaveLength(1)
  })
  it('préambule sans titre → section Présentation', () => {
    const pages = [[L('Un joli pull sans titre en tête.')]]
    const secs = segmentSections(pages)
    expect(secs[0].title).toBe('Présentation')
    expect(secs[0].kind).toBe('pelote')
  })
  it('rétrograde une mini-section de 4 lignes suivant un bloc référence (accessoires → matériel)', () => {
    // violet-dress : une liste de 4 accessoires sous un mini-titre non-caps devenait une
    // section fantôme au lieu de rejoindre ## Matériel (seuil isMiniLabel raté d'une ligne).
    const pages = [[
      L('MATÉRIEL', { bold: true }),
      L('Coton 50 g'),
      L('Il vous faut aussi', { bold: true }),
      L('Mètre ruban'),
      L('Paire de ciseaux'),
      L('Épingles'),
      L('Un stylo'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.title)).not.toContain('Il vous faut aussi')
    const mat = secs.find((s) => s.ref === 'materiel')
    expect(mat.lines.map((l) => l.text)).toContain('Un stylo')
  })
  it('rétrograde un item collisionnant avec « fil » (« Aiguille à laine ») après un bloc référence', () => {
    // nahia-sweater : « Aiguille à laine » (item matériel) a kindForTitle='fil' par collision
    // du mot « laine » → devient une section fantôme dont le titre est jeté (perte). Doit être
    // rétrogradée dans la section référence précédente.
    const pages = [[
      L('AIGUILLES', { bold: true }),
      L('Crochet 4 mm'),
      L('Aiguille à laine', { bold: true }),
    ]]
    const secs = segmentSections(pages)
    expect(secs.some((s) => s.title === 'Aiguille à laine')).toBe(false)
    expect(JSON.stringify(secs)).toMatch(/Aiguille à laine/)
  })
  it('ne rétrograde PAS un titre « fil » PORTEUR de chiffre après un bloc référence (vrai 2e fil)', () => {
    const pages = [[
      L('MATÉRIEL', { bold: true }),
      L('Coton 50 g'),
      L('Glitter Deluxe 30 g', { bold: true }),
      L('1 pelote Gold'), L('coloris or'), L('brillant'),
    ]]
    const secs = segmentSections(pages)
    // titre porteur de chiffre (« 30 g ») → non rétrogradé par la clause collision fil
    // (il reste géré par le mécanisme Au2 normal si applicable, mais pas via refKeywordCollision).
    expect(JSON.stringify(secs)).toMatch(/Glitter Deluxe/)
  })
  it('ne rétrograde PAS une vraie section de travail (≥5 lignes) après un bloc référence', () => {
    const pages = [[
      L('MATÉRIEL', { bold: true }),
      L('Fil : Coton 50 g'),
      L('Préparation', { bold: true }),
      L('Ligne un.'), L('Ligne deux.'), L('Ligne trois.'), L('Ligne quatre.'), L('Ligne cinq.'),
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.title)).toContain('Préparation')
  })
  // En page 0, une mini-section n'est pas versée dans une section d'abréviations (jetée en aval hors glossaire).
  it('page 0 : ne rétrograde pas une mini-section dans les abréviations', () => {
    const kept = (secs) => secs.filter((s) => !s.noise && s.ref !== 'abbr').flatMap((s) => s.lines.map((l) => l.text))
    const abbr = segmentSections([[
      L('ABBREVIATIONS', { bold: true, size: 14, y: 800 }),
      L('sc = single crochet', { y: 780 }), L('ch = chain', { y: 765 }), L('st = stitch', { y: 750 }),
      L('Good to know', { bold: true, size: 12, y: 720 }),
      L('Gently wash by hand in cold water.', { y: 700 }),
    ]])
    expect(kept(abbr)).toContain('Gently wash by hand in cold water.')
  })
  it('ne promeut PAS par simple espacement une ligne de continuation dans un bloc référence déjà ouvert (Umber Cloud gauge)', () => {
    // Umber Cloud Sweater (EN, corpus réel) : dans le bloc GAUGE (échantillon) déjà ouvert,
    // un saut de paragraphe (gap 27,2 vs modalGap 13,6, ratio ≈2,0 ≥1,7) précède « Always
    // use the needle size that gives you » — un simple retour à la ligne DANS la même
    // phrase, pas un nouveau titre. isSpacedTitle (repli faible : aucun signal fort de
    // gras/majuscules/grande police) la promouvait à tort en section (kindForTitle matche
    // « needle » → kind 'aiguilles'), coupant la phrase en deux : perte de contenu (1re
    // moitié jetée par reference.js, 2e moitié orpheline dans ## Matériel).
    const pages = [[
      { text: 'GAUGE', size: 12, bold: false, y: 800 },
      { text: '14 sts x 23 r = 10 x 10 cm in stockinette', size: 10, bold: false, y: 786 },
      { text: 'stitch using needles 5 mm / US 8', size: 10, bold: false, y: 772 },
      { text: 'Always use the needle size that gives you', size: 10, bold: false, y: 745 },
      { text: 'the correct gauge in both height and width,', size: 10, bold: false, y: 731 },
      { text: 'measured after washing and blocking.', size: 10, bold: false, y: 717 },
    ]]
    const secs = segmentSections(pages)
    expect(secs).toHaveLength(1)
    expect(secs[0].ref).toBe('echantillon')
    expect(secs[0].lines.map((l) => l.text)).toContain('Always use the needle size that gives you')
  })
  it('ne promeut PAS un label de diagramme (petit, suivi d’une légende « = ») en titre de section', () => {
    // Torsades Phildar p2 : le label « Dos-Devant » (police < corps, précédé d’un blanc de
    // diagramme = grand gap) précède sa légende de symboles « = 1 m. jersey… ». Promu en
    // section body, il coupait la section Manches et capturait le façonnage par taille.
    const pages = [[
      { text: 'Manches', size: 11, bold: false, y: 700 },
      { text: 'Monter 58 m. Tricoter.', size: 10, bold: false, y: 688 },
      { text: 'augmenter de chaque côté :', size: 10, bold: false, y: 676 },
      { text: 'Dos-Devant', size: 9, bold: false, y: 618 }, // gap 58 = blanc du diagramme
      { text: '= 1 m. jersey endroit', size: 10, bold: false, y: 606 },
      { text: '= 6 m. croisées à gauche', size: 10, bold: false, y: 594 },
      { text: 's : 25 x 1 m. tous les 4 rgs.', size: 10, bold: false, y: 582 },
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.title)).not.toContain('Dos-Devant')
    const manche = secs.find((s) => /manche/i.test(s.title))
    expect(manche).toBeTruthy()
    expect(manche.lines.map((l) => l.text)).toContain('s : 25 x 1 m. tous les 4 rgs.')
  })
  it('ne promeut pas un fragment de légende photo (grand gap dû à un bloc photo invisible du texte) en titre quand la ligne suivante enchaîne à espacement normal en minuscule (Teddy Doudou / Sara Doll)', () => {
    // teddy-snuggle-rag-rabbit-fr, cycle 9 : dans « Le carré » (granny en tutoriel photo
    // pas-à-pas), un rang coupé en 2 par un bloc de 4-5 photos (invisible de pdf.js) mesure
    // un gap Y de ~192px avant sa reprise (modalGap 16px, seuil isSpacedTitle 1,7×16≈27,2 —
    // largement dépassé). La ligne suivante enchaîne pourtant à espacement NORMAL (14px) en
    // minuscule : c'est la 2e moitié de la même phrase, pas un nouveau titre — sans quoi
    // « Le carré » se scinde en sections fantômes avec contenu dupliqué/éclaté.
    // 2 pages : le fragment doit être hors page 0 et sa section précédente ne doit pas être
    // une section référence (BOX_REF), sans quoi la rétrogradation générique « mini-section
    // page 0 / après bloc référence » masquerait le bug indépendamment du correctif visé.
    const pages = [
      [{ text: 'Couverture', size: 20, bold: true, y: 900 }],
      [
        { text: 'Le carré', bold: true, size: 12, y: 900 },
        { text: 'Monter 4 ml et fermer en anneau.', size: 10, bold: false, y: 884 },
        { text: 'Faire 3 ml, 2 br dans l’anneau.', size: 10, bold: false, y: 868 },
        { text: 'Fermer par une ms dans la 3e ml.', size: 10, bold: false, y: 852 },
        { text: 'Maintenant faire des mc jusqu’au premier', size: 10, bold: false, y: 660 }, // gap 192 = bloc photo
        { text: 'espace de ml. Faire 3 ml.', size: 10, bold: false, y: 646 }, // gap 14 ≈ modal, minuscule
      ],
    ]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.title)).not.toContain('Maintenant faire des mc jusqu’au premier')
    const carre = secs.find((s) => s.title === 'Le carré')
    expect(carre).toBeTruthy()
    expect(carre.lines.map((l) => l.text)).toContain('Maintenant faire des mc jusqu’au premier')
    expect(carre.lines.map((l) => l.text)).toContain('espace de ml. Faire 3 ml.')
  })
  it('garde un titre-étiquette qui finit par « : » comme section propre même suivi d’une entrée en minuscule à espacement normal (Abréviations: / cm: cercle magique)', () => {
    // Garde CRITIQUE du correctif ci-dessus : un vrai titre-étiquette (« Abréviations: »,
    // « Abbreviazioni: », « Skróty: ») arrive lui aussi très souvent après un grand gap (fin
    // de page/bloc photo) et est suivi d'une ligne à espacement NORMAL commençant en
    // minuscule (« cm: cercle magique ») — géométriquement indiscernable d'une phrase coupée
    // SANS l'exclusion « la ligne courante finit par : » dans le texte d'origine. Sans cette
    // exclusion, le gate régresse (boris-the-bee-pl, dino-pram-chain-it : tables d'abréviations
    // avalées).
    const pages = [[
      { text: 'Assemblage', bold: true, size: 12, y: 900 },
      { text: 'Coudre les pièces ensemble.', size: 10, bold: false, y: 884 },
      { text: 'Rembourrer chaque partie.', size: 10, bold: false, y: 868 },
      { text: 'Fixer les yeux de sécurité.', size: 10, bold: false, y: 852 },
      { text: 'Abréviations:', size: 10, bold: false, y: 660 }, // gap 192, titre-étiquette réel
      { text: 'cm: cercle magique', size: 10, bold: false, y: 646 }, // gap 14 ≈ modal, minuscule
    ]]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.title)).toContain('Abréviations')
    const abbr = secs.find((s) => s.ref === 'abbr')
    expect(abbr).toBeTruthy()
    expect(abbr.lines.map((l) => l.text)).toContain('cm: cercle magique')
  })
  it('ne promeut pas en titre une ligne d’instruction qui finit par un compte de mailles crochet (« 258dc ») même suivie d’un titre en MAJUSCULES (Confetti Glass Triangular Shawl, palier 6, P0)', () => {
    // confetti-glass-triangular-shawl-en-7cde445f (corpus réel) : « Rep
    // rows 2-4 a further 13 times. 258dc » clôt le corps du châle juste avant la section
    // FINISHING. Ligne courte, sans ponctuation finale, précédée d'un grand blanc de
    // paragraphe (fin de bloc de travail) → isSpacedTitle la promouvait à tort en titre de
    // section fantôme. La garde anti-phrase-coupée existante (ligne suivante à espacement
    // normal ET en minuscule) ne s'applique PAS ici puisque la ligne suivante, « FINISHING »,
    // est en MAJUSCULES — sans garde dédiée, la section fantôme (0 ligne, titre sans
    // parenthèses donc non rescapable par isRescuableTitle) est jetée en silence par
    // mergeEmptyTitledSections : la ligne — et son compte de mailles final — disparaît
    // intégralement du .md produit.
    // 2 pages, comme le fragment de légende photo plus haut : le fragment doit être hors
    // page 0 (sans quoi la rétrogradation générique « mini-section page 0 » masquerait le
    // bug indépendamment du correctif visé), et sa section précédente n'est pas une section
    // référence (BOX_REF), pour ne pas non plus déclencher cette autre rétrogradation.
    const pages = [
      [{ text: 'Confetti Glass Triangular Shawl', size: 20, bold: true, y: 900 }],
      [
        { text: 'PATTERN BEGINS', bold: true, size: 12, y: 900 },
        { text: 'Row 1: Ch3, 2dc, ch2, 3dc into magic ring, turn. 6dc', size: 10, bold: false, y: 884 },
        { text: 'Row 2: ch3, 2dc into same st, dc in each st. Turn. 6dc inc', size: 10, bold: false, y: 868 },
        { text: 'Row 3: ch3, 2 dc into same st, dc in each st. Turn. 6dc inc', size: 10, bold: false, y: 852 },
        { text: 'Row 4: ch3, 2dc into same st, dc in each st. Turn. 6dc inc', size: 10, bold: false, y: 836 },
        { text: 'Rep rows 2-4 a further 13 times. 258dc', size: 10, bold: false, y: 780 }, // gap 56 ≫ 1,7×16
        { text: 'FINISHING', size: 10, bold: false, y: 764 }, // MAJUSCULES : la garde « minuscule » ne s'arme pas
        { text: 'Cut yarn leaving a tail and fasten off.', size: 10, bold: false, y: 748 },
      ],
    ]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.title)).not.toContain('Rep rows 2-4 a further 13 times. 258dc')
    const body = secs.find((s) => s.title === 'PATTERN BEGINS')
    expect(body).toBeTruthy()
    expect(body.lines.map((l) => l.text)).toContain('Rep rows 2-4 a further 13 times. 258dc')
  })
  it('ne promeut pas en titre une consigne de changement d’outil en cours de rang (« Change hook to 4.5mm : », ups-and-downs-blanket-en-258ffe33, palier 7/8, P0)', () => {
    // ups-and-downs-blanket-en-258ffe33 (corpus réel, crochet) : dans ## BORDER AND FINISH,
    // « Change hook to 4.5mm : » était promue à tort en titre de section — kindForTitle la
    // classe ce titre fantôme ref='aiguilles' (alias \bhooks?\b), et reference.js (branche
    // ref==='aiguilles') engloutit alors tout ce qui suit dans materials.push dès que ça ne
    // matche pas un motif outil : Round 3-5, la clôture (« After completing… », « Weave all
    // ends in. ») et la signature de l'autrice disparaissaient de BORDER AND FINISH et
    // ressurgissaient en puces désordonnées sous ## Matériel. Sa jumelle syntaxique plus
    // longue, « Change hook to 3.5mm (or even 3mm), just for this round : » (même page,
    // même rôle, même formulation), reste correctement NON promue.
    //
    // CHEMIN RÉEL DE LA PROMOTION (vérifié sur les données pdf.js RÉELLES du PDF, pas
    // supposé) : les deux lignes sont bold=false — isTitleLine les rejette déjà toutes les
    // deux SANS ce correctif (majuscules/gras/grande police absents). La promotion fantôme
    // passe entièrement par le repli isSpacedTitle : gap réel mesuré 24 ≥ 1,7×modalGap (12)
    // pour les deux lignes, mais seule la plus courte franchit le plafond de longueur de
    // isSpacedTitle (42, sur le texte SANS le « : » final) — sa jumelle (bien plus longue)
    // en est déjà exclue. Ce test reproduit donc la géométrie réelle (gap de paragraphe
    // ≥ 1,7×modalGap avant chaque ligne « Change hook », gap normal ailleurs) et bold=false
    // partout, plutôt qu'un raccourci « bold:true » qui ne testerait qu'isTitleLine et
    // laisserait le vrai bug (dans isSpacedTitle) sans couverture.
    // gapBefore explicite par ligne (= gaps.get(line), l'écart Y avec la ligne précédente) :
    // 16 = interligne normal (dominant → modalGap = 16), 32 = saut de paragraphe (≥ 1,7×16),
    // exactement comme les deux lignes « Change hook » du PDF réel (gap mesuré 24, modalGap
    // mesuré 12, même ratio ≈ 2).
    let y = 900
    const rows = []
    const push = (text, gapBefore, o = {}) => {
      if (gapBefore != null) y -= gapBefore
      rows.push(L(text, { y, ...o }))
    }
    push('BORDER AND FINISH', null, { bold: true, size: 14 })
    push('Round 1 (RS): 1ch, and along top : sl st in each st.', 16)
    push('Change hook to 3.5mm (or even 3mm), just for this round :', 32)
    push('Round 2: 1ch, work 1sc on top of each sl st all around.', 16)
    push('Change hook to 4.5mm :', 32) // bold=false, comme dans le PDF réel
    push('Round 3: 2ch, and along top : repeat (1DC, 1sc in next st).', 16)
    push('Round 4: 1ch, and along top : repeat (1sc, 1DC in next st).', 16)
    push('Round 5: as Round 3.', 16)
    push('After completing the fourth corner, sl st on top and F.O.', 16)
    push('Weave all ends in.', 16)
    push('Alessandra', 16)
    const pages = [rows]
    const secs = segmentSections(pages)
    expect(secs.map((s) => s.title)).not.toContain('Change hook to 4.5mm')
    expect(secs.map((s) => s.title)).not.toContain('Change hook to 3.5mm (or even 3mm), just for this round')
    const body = secs.find((s) => s.title === 'BORDER AND FINISH')
    expect(body).toBeTruthy()
    expect(body.lines.map((l) => l.text)).toContain('Round 3: 2ch, and along top : repeat (1DC, 1sc in next st).')
    expect(body.lines.map((l) => l.text)).toContain('Round 4: 1ch, and along top : repeat (1sc, 1DC in next st).')
    expect(body.lines.map((l) => l.text)).toContain('Weave all ends in.')
    expect(body.lines.map((l) => l.text)).toContain('Alessandra')
  })
  it('reclasse pelote→autre sur un verbe d’action même sans rang numéroté (Bellis, corpus réel)', () => {
    const pages = [[
      L('Bolos', { bold: true, size: 14 }),
      L('Parte delantera y trasera', { bold: true, size: 12 }),
      L('Monta 34 puntos en agujas circulares de 5mm con doble hilo, teje de ida y vuelta a punto arroz.'),
    ]]
    const sections = segmentSections(pages)
    const bolos = sections.find((s) => s.title === 'Bolos')
    expect(bolos).toBeDefined()
    // Le vocabulaire ES (commit 0374145) matche désormais « Monta »/« teje » dans
    // ce texte : la section bascule vers 'autre', résultat attendu et vérifié sur le PDF
    // réel bellis-purse-es.
    expect(bolos.kind).toBe('autre')
  })
  it('reclasse pelote→autre via sectionHasActionableProse (câblage, vocabulaire EN)', () => {
    const pages = [[
      L('Presentación', { bold: true, size: 14 }),
      L('Cast on 18 sts with 2 strands of yarn held together.'),
    ]]
    const sections = segmentSections(pages)
    const sec = sections.find((s) => s.title === 'Presentación')
    expect(sec).toBeDefined()
    expect(sec.kind).toBe('autre')
  })
  it('reste pelote si aucun rang ET aucun verbe d’action (vraie section non-actionnable)', () => {
    const pages = [[
      L('Créditos', { bold: true, size: 14 }),
      L('Design : REGIA Designteam'),
    ]]
    const sections = segmentSections(pages)
    const sec = sections.find((s) => s.title === 'Créditos')
    expect(sec).toBeDefined()
    expect(sec.kind).toBe('pelote')
  })

  describe('un faux titre n’ouvre plus une rubrique de référence (Juice_Sweater réel)', () => {
    // Juice_Sweater_by_Kutovakika (EN, corpus réel) : deux lignes matchent un mot-clé de
    // titre référence par pur hasard lexical, sans EN être une — l'ancienne logique les
    // promouvait quand même en section référence (### DPN = double pointed needle
    // [ref=aiguilles], ### Join new yarn and work as follows [ref=fil]), détournant une
    // explication de technique vers le bloc Matériel et un rang de tricot vers le bloc Fil.
    it('une entrée de glossaire « clé = définition » (DPN = double pointed needle, mot « needle ») n’ouvre pas ## Aiguilles et reste dans la section abréviations en cours', () => {
      const pages = [[
        L('ABBREVIATIONS', { bold: true }),
        L('DPN = double pointed needle', { bold: true }),
        L('DS = double stitch, used when working German Short Rows. Work as follows:'),
      ]]
      const secs = segmentSections(pages)
      expect(secs).toHaveLength(1)
      expect(secs[0].ref).toBe('abbr')
      // Ne jamais perdre l'info : les deux lignes VERBATIM survivent dans la section en cours.
      expect(secs[0].lines.map((l) => l.text)).toEqual([
        'DPN = double pointed needle',
        'DS = double stitch, used when working German Short Rows. Work as follows:',
      ])
    })
    it('une consigne de travail contenant un verbe d’action (Join new yarn and work as follows, mot « yarn ») n’ouvre pas ## Fil et reste dans la section en cours', () => {
      const pages = [[
        L('Sleeves', { bold: true, size: 14 }),
        L('Only sizes XS, 2XL, 3XL, 4Xl and 5XL:'),
        L('Join new yarn and work as follows', { bold: true }),
        L('Row 1 (RS): K3, p1, k1, RM, p1, *k1, p1* to m, RM, k1, p1, k3. Turn work.'),
      ]]
      const secs = segmentSections(pages)
      expect(secs).toHaveLength(1)
      expect(secs[0].ref).toBeNull()
      // Ne jamais perdre l'info : le rang VERBATIM survit dans la section de travail en cours.
      expect(secs[0].lines.map((l) => l.text)).toEqual([
        'Only sizes XS, 2XL, 3XL, 4Xl and 5XL:',
        'Join new yarn and work as follows',
        'Row 1 (RS): K3, p1, k1, RM, p1, *k1, p1* to m, RM, k1, p1, k3. Turn work.',
      ])
    })
  })

  describe('un faux titre n’ouvre plus une rubrique de référence — gardes de non-régression', () => {
    // Ces titres réels doivent CONTINUER d'ouvrir leur rubrique après ce correctif :
    // aucun n'a la forme « clé = définition » ni ne porte un verbe d'action tricot/crochet.
    it('« NEEDLES » ouvre toujours ## Aiguilles', () => {
      const secs = segmentSections([[L('NEEDLES', { bold: true }), L('4 mm circular needles')]])
      expect(secs[0].ref).toBe('aiguilles')
    })
    it('« SUGGESTED YARN » ouvre toujours ## Fil', () => {
      const secs = segmentSections([[L('SUGGESTED YARN', { bold: true }), L('100% cotton, 50g/125m')]])
      expect(secs[0].ref).toBe('fil')
    })
    it('« GAUGE » ouvre toujours ## Échantillon', () => {
      const secs = segmentSections([[L('GAUGE', { bold: true }), L('20 sts x 28 rows = 10 x 10 cm')]])
      expect(secs[0].ref).toBe('echantillon')
    })
    it('« ABBREVIATIONS » ouvre toujours ## Abréviations', () => {
      const secs = segmentSections([[L('ABBREVIATIONS', { bold: true }), L('k = knit')]])
      expect(secs[0].ref).toBe('abbr')
    })
    // Aide-mémoire — Juice_Sweater_by_Kutovakika (EN, corpus réel) : le titre
    // « NOTIONS » (16 marqueurs, mercerie du patron) n'ouvrait jusqu'ici aucune rubrique
    // référence (kindForTitle ne connaissait pas le mot) → le contenu réel (matériel)
    // n'atteignait jamais le bloc Matériel de l'aide-mémoire. `notions` ajouté à la famille
    // `materiel` de KIND_KEYWORDS (segment.js) comble ce trou.
    it('« NOTIONS » ouvre ## Matériel (Juice_Sweater_by_Kutovakika, EN, corpus réel)', () => {
      const secs = segmentSections([[L('NOTIONS', { bold: true }), L('16 stitch markers (I recommend using different colored markers as follows: 2 sets of 2 markers in colors one and two, 3 sets of 4 markers in')]])
      expect(secs).toHaveLength(1)
      expect(secs[0].title).toBe('NOTIONS')
      expect(secs[0].ref).toBe('materiel')
    })
    // Garde de non-régression : un titre CONSTRUIT qui porte le mot
    // « notions » au fil d'une phrase (pas un vrai verbe d'action en tête, pas une entrée
    // de glossaire « clé = déf ») ne doit pas être écarté à tort par les gardes T2
    // (looksLikeGlossaryEntry / looksLikeActionTitle) : il reste un titre référence normal.
    it('« Special notions used in this pattern » (construit) : le nouveau mot ne casse pas les gardes T2 — reste ## Matériel', () => {
      const secs = segmentSections([[L('Special notions used in this pattern', { bold: true }), L('16 stitch markers.')]])
      expect(secs[0].ref).toBe('materiel')
    })
    it('« Aiguilles suggérées » ouvre toujours ## Aiguilles', () => {
      const secs = segmentSections([[L('Aiguilles suggérées', { bold: true }), L('4 mm circulaires')]])
      expect(secs[0].ref).toBe('aiguilles')
    })
    it('« MATERIALS » ouvre toujours ## Matériel', () => {
      const secs = segmentSections([[L('MATERIALS', { bold: true }), L('Stitch markers')]])
      expect(secs[0].ref).toBe('materiel')
    })
    it('non-régression : un titre référence portant lui-même une donnée (« Crochet 6 mm ») ouvre toujours sa rubrique ET conserve sa ligne', () => {
      const secs = segmentSections([[L('Crochet 6 mm', { bold: true })]])
      expect(secs[0].ref).toBe('aiguilles')
      expect(secs[0].lines.map((l) => l.text)).toEqual(['Crochet 6 mm'])
    })
    it('non-régression : un titre référence portant lui-même une donnée (« Aiguilles 2,5 et 3 ») ouvre toujours sa rubrique ET conserve sa ligne', () => {
      const secs = segmentSections([[L('Aiguilles 2,5 et 3', { bold: true })]])
      expect(secs[0].ref).toBe('aiguilles')
      expect(secs[0].lines.map((l) => l.text)).toEqual(['Aiguilles 2,5 et 3'])
    })
    // Bug réel DROPS EN (sunny-daze-en-bc4eee5a, 27/08) : l'étiquette et sa valeur
    // sont collées SANS espace après le « : » (mise en page DROPS), la ligne entière est
    // promue titre par isSpacedTitle (KV_RE exige un espace après « : », ne l'écarte donc
    // pas) — mais la donnée qui suit (le nom de la laine) ne porte AUCUN chiffre, contrairement
    // à « Crochet 6 mm »/« Aiguilles 2,5 et 3 » ci-dessus : sans le second signe (« : » suivi
    // de texte), elle disparaissait entièrement du document généré.
    it('non-régression : un titre référence « Materials:DROPS Paris from Garnstudio » (étiquette et valeur collées, sans chiffre) conserve sa ligne', () => {
      const secs = segmentSections([[L('Materials:DROPS Paris from Garnstudio', { bold: true })]])
      expect(secs[0].ref).toBe('materiel')
      expect(secs[0].lines.map((l) => l.text)).toEqual(['Materials:DROPS Paris from Garnstudio'])
    })
  })

  describe('un faux titre n’ouvre plus une rubrique de référence — premier correctif (mesure 3187 PDF, gardes resserrées)', () => {
    // La mesure sur les 3187 PDF a montré que les deux gardes en place étaient trop larges : elles
    // écartaient 6 rubriques référence légitimes. Discriminants resserrés (aucun mot ajouté) :
    // - glossaire : la clé (avant « = »/« : »/tiret) doit être COURTE (≤ 8 car.) ET SANS
    //   ESPACE, même critère que le balayage global de reference.js (m[1].trim().length <= 8
    //   && !/\s/.test(...)) — sinon un vrai titre qui contient un « = »/tiret par hasard
    //   (mesures/coordonnées) est pris pour un glossaire.
    // - verbe d'action : le verbe doit être le 1er mot du titre (seule une puce/numérotation
    //   ASCII simple tolérée avant lui) — sinon un titre qui contient le mot plus loin
    //   (« How to Join… », ou précédé d'un symbole décoratif ☆) est pris pour une consigne.
    it('« Gauge 18 sts x 24 rows= 4"/10cm in pattern » (stash-invaders-from-outer-space-en) : clé longue et espacée, pas un glossaire → ## Échantillon conservé', () => {
      const secs = segmentSections([[L('Gauge 18 sts x 24 rows= 4"/10cm in pattern', { bold: true })]])
      expect(secs[0].ref).toBe('echantillon')
    })
    it('« Stickfasthet – stickad enligt diagram » (chunky-bark-scarf-sv) : clé de 12 caractères (> 8), pas un glossaire → ## Échantillon conservé', () => {
      const secs = segmentSections([[L('Stickfasthet – stickad enligt diagram', { bold: true })]])
      expect(secs[0].ref).toBe('echantillon')
    })
    it('« Tensione della maglia a coste: 1 dir, 1 » (po-neck-warmer-it) : clé longue et espacée, pas un glossaire → ## Échantillon conservé', () => {
      const secs = segmentSections([[L('Tensione della maglia a coste: 1 dir, 1', { bold: true })]])
      expect(secs[0].ref).toBe('echantillon')
    })
    it('« Obwód w klatce piersiowej od-do: Próbka » (sweter-vela-air-pl) : clé longue et espacée, pas un glossaire → ## Échantillon conservé', () => {
      const secs = segmentSections([[L('Obwód w klatce piersiowej od-do: Próbka', { bold: true })]])
      expect(secs[0].ref).toBe('echantillon')
    })
    it('« US 9 - 5.5mm NEEDLES » (shawl-nebula-ja) : clé « US 9 » espacée, pas un glossaire → ## Aiguilles conservé', () => {
      const secs = segmentSections([[L('US 9 - 5.5mm NEEDLES', { bold: true })]])
      expect(secs[0].ref).toBe('aiguilles')
    })
    it('« ☆ knit with two yarns together YARN » (shawl-nebula-ja) : le verbe « knit » est le 2ᵉ mot, précédé d’un symbole décoratif (pas une puce) → ## Fil conservé', () => {
      const secs = segmentSections([[L('☆ knit with two yarns together YARN', { bold: true })]])
      expect(secs[0].ref).toBe('fil')
    })
    it('« How to Join Squares » : le verbe « Join » n’est pas le 1er mot (« How » l’est) → ## Techniques conservé', () => {
      const secs = segmentSections([[L('How to Join Squares', { bold: true })]])
      expect(secs[0].ref).toBe('techniques')
    })
    it('« How to Change Colours » : le verbe « Change » n’est pas le 1er mot (« How » l’est) → ## Techniques conservé', () => {
      const secs = segmentSections([[L('How to Change Colours', { bold: true })]])
      expect(secs[0].ref).toBe('techniques')
    })
    it('non-régression : « DPN = double pointed needle » (clé courte sans espace) reste écarté', () => {
      const secs = segmentSections([[
        L('ABBREVIATIONS', { bold: true }),
        L('DPN = double pointed needle', { bold: true }),
      ]])
      expect(secs).toHaveLength(1)
      expect(secs[0].ref).toBe('abbr')
    })
    it('non-régression : « Join new yarn and work as follows » (verbe en 1er mot) reste écarté', () => {
      const secs = segmentSections([[
        L('Sleeves', { bold: true, size: 14 }),
        L('Join new yarn and work as follows', { bold: true }),
      ]])
      expect(secs).toHaveLength(1)
      expect(secs[0].ref).toBeNull()
    })
  })

  describe('un faux titre n’ouvre plus une rubrique de référence — deuxième passe (revue : perte de rangs dans une section fil restée ouverte)', () => {
    // La revue a trouvé que la garde consigne (premier correctif) peut laisser une section
    // ref==='fil' ouverte sur tout le reste du patron : un titre écarté (« Join new yarn and
    // work as follows ») rejoint la section en cours au lieu d'ouvrir une nouvelle section,
    // et les rangs qui suivent (jamais des lignes de fil) partaient tous vers pushYarn
    // (reference.js), plafonné SANS repli → perdus purement et simplement. Même correctif
    // que abbr/materiel/echantillon déjà en place : dès le premier vrai rang, la section fil
    // se referme et un bloc « Instructions » (ref null) reprend le corps du patron.
    it('une section fil restée ouverte sur un titre écarté se referme au premier rang détecté — aucun des 25 rangs n’est perdu (scénario réel de la revue, SUGGESTED YARN)', () => {
      const rows = []
      for (let i = 1; i <= 25; i++) rows.push(`Row ${i} (RS): K3, p1, k1. Turn work.`)
      const pages = [[
        L('SUGGESTED YARN', { bold: true }),
        L('Join new yarn and work as follows', { bold: true }),
        ...rows.map((r) => L(r)),
      ]]
      const secs = segmentSections(pages)
      expect(secs.map((s) => s.ref)).toEqual(['fil', null])
      // Le titre écarté reste seul dans la section fil (comportement du premier correctif, inchangé).
      expect(secs[0].lines.map((l) => l.text)).toEqual(['Join new yarn and work as follows'])
      // Ne jamais perdre l'info : les 25 rangs VERBATIM survivent tous dans le bloc Instructions.
      expect(secs[1].title).toBe('Instructions')
      expect(secs[1].lines.map((l) => l.text)).toEqual(rows)
    })
  })
})

describe('segmentSections — une entrée de glossaire n’est pas un titre', () => {
  it('garde les entrées « clé = définition » dans la rubrique Abréviations (Juice_Sweater)', () => {
    // Interligne modal ~14 pt ; le glossaire est aéré à ~28 pt → repli « titre par espacement ».
    // Ce fixture est porteur sur DEUX paramètres à la fois, tous deux nécessaires pour
    // reproduire le défaut réel — n'en réduire aucun sans revérifier :
    //  1. Glossaire placé en page 1 (pas 0) : sur la page 0, la rétrogradation mini-étiquette
    //     de segmentSections (sec.page === 0, l.676) réabsorbe silencieusement les fragments
    //     dans la section précédente et masque le défaut, indépendamment de tout correctif.
    //  2. page0 porte 6 lignes de remplissage (pas moins) : modalLineGap (l.350) regroupe les
    //     écarts de TOUTES les pages, pas page par page. Avec seulement 3 lignes de
    //     remplissage (comme dans une version antérieure de ce test), l'écart modal groupé
    //     bascule à 28 — dominé par l'espacement du glossaire lui-même — et le seuil de
    //     promotion (1,7 × 28 ≈ 47,6) n'est alors plus jamais dépassé : isSpacedTitle ne
    //     tente même pas la promotion, le test passe alors même si GLOSSARY_ENTRY_RE est
    //     entièrement retiré (test non discriminant, vérifié). 6 lignes à 14 pt d'écart
    //     dominent le pool (5 occurrences de 14 contre 3 occurrences de ~28) → modal groupé
    //     = 14, condition de promotion bien franchie par le glossaire (28-31 ≥ 1,7×14).
    const L = (text, y, size = 9) => ({ text, size, bold: false, y })
    const page0 = [
      L('Le corps est tricoté en rond.', 800), L('Continuer ainsi.', 786), L('Puis rabattre.', 772),
      L('Encore une ligne.', 758), L('Et une autre.', 744), L('Toujours pareil.', 730),
    ]
    const page1 = [
      L('ABBREVIATIONS', 800, 13),
      L('BOR = beginning of round', 769),
      L('K = knit', 741),
      L('P = purl', 712),
      L('PM = place marker', 684),
      L('RM = remove marker', 656),
    ]
    const secs = segmentSections([page0, page1])
    const abbr = secs.find((s) => s.ref === 'abbr')
    expect(abbr.lines.map((l) => l.text)).toEqual([
      'BOR = beginning of round', 'K = knit', 'P = purl', 'PM = place marker', 'RM = remove marker',
    ])
    expect(secs.some((s) => s.title === 'K = knit')).toBe(false)
  })

  // Correctif A (mesure sur le corpus, 26/07) — la garde ci-dessus était TROP LARGE : un vrai
  // titre de section au format « clé = compte » (sunshine-children-s-sweater-en, corpus réel,
  // 179 mots perdus) matche la même forme sans être une entrée de glossaire. Réutilise
  // EXACTEMENT la géométrie du fixture ci-dessus (6 lignes de remplissage sur page0, glossaire/
  // titre sur page1 — les deux paramètres restent nécessaires pour la même raison documentée
  // plus haut : modal groupé, rétrogradation page 0) — seul le contenu de page1 change.
  it('un vrai titre « clé = compte » (Corner = 3trc, ch2, 3trc) reste promu et garde le contenu qui le suit (sunshine-children-s-sweater-en, corpus réel)', () => {
    const L = (text, y, size = 9) => ({ text, size, bold: false, y })
    const page0 = [
      L('Le corps est tricoté en rond.', 800), L('Continuer ainsi.', 786), L('Puis rabattre.', 772),
      L('Encore une ligne.', 758), L('Et une autre.', 744), L('Toujours pareil.', 730),
    ]
    const page1 = [
      L('Une phrase de clôture précédente.', 800),
      L('Corner = 3trc, ch2, 3trc', 769), // gap 31 depuis la ligne précédente, comme le glossaire ci-dessus
      L('Row 6: Ch3 (counts as first dc), work around.', 758), // gap 11 (normal) : reste attaché au titre
    ]
    const secs = segmentSections([page0, page1])
    const corner = secs.find((s) => s.title === 'Corner = 3trc, ch2, 3trc')
    expect(corner).toBeDefined()
    expect(corner.lines.map((l) => l.text)).toEqual([
      'Row 6: Ch3 (counts as first dc), work around.',
    ])
  })
})

describe('detectTitle', () => {
  it('prend la plus grande police des 2 premières pages', () => {
    const pages = [[{ text: 'petit', size: 9, bold: false, y: 0 }, { text: 'Stockholm Sweater', size: 26, bold: true, y: 0 }]]
    expect(detectTitle(pages)).toBe('Stockholm Sweater')
  })
  it('écarte un tampon de difficulté à lettres espacées (Phildar QUALIFIÉE)', () => {
    const pages = [[
      { text: 'Q U A L I F I É E 328', size: 19, bold: false, y: 800 },
      { text: 'Pull torsades ajourées', size: 19, bold: false, y: 770 },
    ]]
    expect(detectTitle(pages)).toBe('Pull torsades ajourées')
  })
  it('ne casse pas un titre normal court avec une initiale', () => {
    const pages = [[{ text: 'A Line Cardigan', size: 22, bold: false, y: 800 }]]
    expect(detectTitle(pages)).toBe('A Line Cardigan')
  })
  it('n’agrafe pas un tampon letter-spacing en sous-titre (tampon APRÈS le titre)', () => {
    const pages = [[
      { text: 'Pull torsades ajourées', size: 22, bold: false, y: 800 },
      { text: 'Q U A L I F I É E 328', size: 19, bold: false, y: 775 },
    ]]
    expect(detectTitle(pages)).toBe('Pull torsades ajourées')
  })
  it('écarte un chiffre nu de pictogramme (bug lush-life-crochet-blanket-en-97699620 : « 6 », symbole CYC Super Bulky) — cas RÉDUIT qui isole la règle « il faut une lettre »', () => {
    // PDF réel mesuré (extraction brute) : le « 6 » du pictogramme d'épaisseur de fil est
    // à 22,4 pt, contre 10 pt pour « LUSH LIFE CROCHET BLANKET » et surtout 12 pt pour
    // plusieurs lignes de corps (« Bernat® Blanket™ (10.5 oz/300g; 220 yds/201 m) »,
    // « ABBREVIATIONS », « MEASUREMENTS »…) qui restent DEVANT le vrai titre dans le tri
    // par taille même une fois le « 6 » écarté — la maquette PDF place ce bandeau plus
    // petit que du texte de liste, un défaut du tri par taille N'AYANT RIEN À VOIR avec ce
    // correctif (non couvert ici, à traiter séparément si besoin, cf. rapport final).
    // Fixture ci-dessous : cas RÉDUIT (titre volontairement rendu plus grand que le
    // pictogramme, géométrie inverse du PDF réel) qui isole et verrouille UNIQUEMENT la
    // règle testée — « 6 » nu, quelle que soit sa taille, ne doit jamais gagner face à une
    // ligne qui porte de vraies lettres.
    const pages = [[
      { text: 'SUPER BULKY', size: 10, bold: false, y: 800 },
      { text: 'CROCHET I SKILL LEVEL: EASY', size: 10, bold: false, y: 790 },
      { text: '6', size: 40, bold: false, y: 700 },
      { text: 'LUSH LIFE CROCHET BLANKET', size: 16, bold: true, y: 950 },
    ]]
    expect(detectTitle(pages)).toBe('LUSH LIFE CROCHET BLANKET')
  })
  it('non-régression : une ligne de ponctuation/ornement nu (sans lettre) n’est jamais retenue comme titre', () => {
    const pages = [[
      { text: '— • — • —', size: 50, bold: false, y: 800 },
      { text: 'Petit Bonnet', size: 18, bold: true, y: 770 },
    ]]
    expect(detectTitle(pages)).toBe('Petit Bonnet')
  })
  it('non-régression : un ornement nu (sans lettre) juste après le titre n’est jamais agrafé comme sous-titre', () => {
    // Même garde « il faut une lettre » que pour le titre principal, appliquée cette fois
    // à la ligne `next` candidate au sous-titre : un filet décoratif satisferait sinon les
    // autres critères (taille, longueur, pas de ponctuation finale, pas de chiffre en tête).
    const pages = [[
      { text: 'Petit Bonnet', size: 22, bold: true, y: 800 },
      { text: '— • —', size: 18, bold: false, y: 786 },
    ]]
    expect(detectTitle(pages)).toBe('Petit Bonnet')
  })
})

describe('kindForTitle — bugs corpus DROPS', () => {
  it('« TAILLES » ne doit pas être classé en queue (limite de mot)', () => {
    // « tailles » contient « tail » : sans limite de mot, matchait queue (amigurumi).
    expect(kindForTitle('TOUTES LES TAILLES')).not.toBe('queue')
  })
  it('conserve les vrais titres queue/tail', () => {
    expect(kindForTitle('Queue')).toBe('queue')
    expect(kindForTitle('Tail')).toBe('queue')
  })
  it('« LAINE » est reconnu comme fil (kind référence dédié, v2)', () => {
    // v2 : « fil » est un kind référence distinct de « materiel » (routage plus fin,
    // tous deux consommés dans l'aide-mémoire).
    expect(kindForTitle('LAINE')).toBe('fil')
    expect(kindForTitle('LAINE:')).toBe('fil')
    expect(kindForTitle('Wool')).toBe('fil')
  })
  it('« Passe » (allemand, empiècement) est classé corps, pas pelote', () => {
    // Patron DE crochet réel : titre de section « Passe » (= yoke) ne matchait aucune
    // famille → retombait en `pelote` (NON_WORK_KINDS) → rangs non cochables.
    expect(kindForTitle('Passe')).toBe('corps')
  })
  // hazy-whisper-sweater-de-3f672f59 (corpus réel, tricot, palier 6) : le PDF source
  // utilise le ẞ CAPITAL moderne (U+1E9E, rendu Google Docs de l'eszett en majuscules —
  // « GRÖẞE »/« MAẞE », orthographe allemande correcte depuis 2017), PAS le repli « SS »
  // traditionnel. Or le flag /i des regex JS NE case-fold PAS U+1E9E → U+00DF (ß), contrairement
  // à `String.prototype.toLowerCase()` : `/ß/i.test('ẞ')` → false, `'ẞ'.toLowerCase()` → 'ß'.
  // Chaque motif contenant (?:ß|ss) sous /i (ici la famille `mesures`) échoue donc
  // silencieusement, et ces titres retombaient en `pelote` (sections dupliquées, sans
  // {kind}, jamais fondues dans le bloc référence — cf. mêmes titres, tests sizes.js/reference.js).
  it('« GRÖẞE »/« MAẞE » (ẞ capital moderne, PAS « SS ») sont classés mesures, pas pelote', () => {
    expect(kindForTitle('GRÖẞE')).toBe('mesures')
    expect(kindForTitle('MAẞE')).toBe('mesures')
  })
  // Cas réel snowman-coaster-de-623a0c1d : « ABMESSUNGEN » (synonyme
  // usuel de « Maße » pour les cotes de l'ouvrage fini) ne contient PAS la sous-chaîne
  // « Maße »/« Masse » (préfixe « Ab- » + racine « -messungen ») — ma(?:ß|ss)e\b ne la
  // couvrait donc pas, et la section restait hors du tableau Tailles (mesures adjacentes,
  // ex. « GRÖSSE »), un doublon non fondu à part.
  it('« Abmessungen » (synonyme allemand de mesures, préfixe « Ab- ») est classé mesures', () => {
    expect(kindForTitle('ABMESSUNGEN')).toBe('mesures')
    expect(kindForTitle('Abmessungen')).toBe('mesures')
  })
  it('« Messungen » nu (sans préfixe) est aussi classé mesures', () => {
    expect(kindForTitle('Messungen')).toBe('mesures')
  })
  // Garde discriminante : \b(?:ab)?messungen\b exige une frontière de mot AVANT « messungen » —
  // un préfixe allemand quelconque collé sans frontière (« Ver- », « Nach- »…) ne doit jamais
  // matcher par accident. « Vermessungen » (arpentage/relevés topographiques, sans rapport avec
  // les cotes d'un ouvrage) n'a aucune frontière entre « Ver » et « messungen ».
  it('« Vermessungen » (préfixe SANS frontière de mot, faux ami) n’est PAS classé mesures', () => {
    expect(kindForTitle('Vermessungen')).not.toBe('mesures')
  })
  it('« Rand » (allemand, bord/bordure) est classé bordure, pas pelote', () => {
    expect(kindForTitle('Rand')).toBe('bordure')
  })
  it('« Rock » (allemand, jupe) est classé corps, pas pelote', () => {
    expect(kindForTitle('Rock')).toBe('corps')
  })
  it('« ELÁSTICO » (accentué) est classé bordure comme sa forme sans accent', () => {
    // Patron ES crochet réel : « ELÁSTICO » ne matchait pas la famille bordure
    // (regex sans accent « elastico », /i ne neutralise pas les accents).
    expect(kindForTitle('ELÁSTICO')).toBe('bordure')
    expect(kindForTitle('Elastico')).toBe('bordure')
  })
  it('« Bordes »/« Borde » (espagnol générique) est classé bordure', () => {
    expect(kindForTitle('Bordes')).toBe('bordure')
    expect(kindForTitle('Borde')).toBe('bordure')
  })
  it('« RIPPENBUND » (allemand, bord-côtes composé collé) est classé bordure (palier 7, ydun-hat-de, IMPACT RÉEL CONFIRMÉ)', () => {
    // ydun-hat-de-c7811f90 (corpus réel, tricot) : « RIPPENBUND » ne matchait aucune famille
    // (le diminutif « bündchen » déjà couvert ne matche pas ce composé) → repli `pelote` →
    // section entière en remarques `>` non cochables au lieu de puces `-`.
    expect(kindForTitle('RIPPENBUND')).toBe('bordure')
    expect(kindForTitle('Bund')).toBe('bordure')
  })
  it('non-régression : « verbunden »/« gebunden » (allemand, formes verbales courantes de « lier », sans rapport avec une bordure) ne sont PAS classés bordure', () => {
    // Garde anti-collision demandée pour « bund\b » (frontière de mot en FIN seulement,
    // pour matcher le composé collé « RIPPENBUND ») : ces deux formes verbales très
    // courantes contiennent la sous-chaîne « bund » mais jamais suivie d'une frontière de
    // mot (« bunden », pas « bund$ ») — vérifié explicitement, comme demandé, plutôt que
    // supposé.
    expect(kindForTitle('verbunden')).not.toBe('bordure')
    expect(kindForTitle('gebunden')).not.toBe('bordure')
  })
  it('« Verbrauch » (allemand, en-tête Hobbii « ce dont tu as besoin ») est classé materiel', () => {
    // Patron DE réel (knit-domino-shawl) : liste combinée aiguilles/fil/crochet/marqueur
    // sous « Verbrauch: » (littéralement « consommation ») — absent des alias allemands
    // de la famille materiel → kindForTitle renvoyait null → repli `pelote` non classée.
    expect(kindForTitle('Verbrauch')).toBe('materiel')
    expect(kindForTitle('Verbrauch:')).toBe('materiel')
  })
  it('« Tripa » (espagnol, ventre d\'amigurumi) est classé travail, pas pelote', () => {
    // Patron ES crochet réel (Hilda the Horse) : titre de section « Tripa » (pièce
    // ronde cousue sur le corps) ne matchait aucune famille → retombait en `pelote`
    // (NON_WORK_KINDS) → tous les rangs de la section devenaient des remarques `>`
    // non cochables au lieu de puces `-`.
    const kind = kindForTitle('Tripa')
    expect(kind).toBeTruthy()
    expect(NON_WORK_KINDS.has(kind)).toBe(false)
  })
  it('« Crin » (espagnol, crinière du cheval amigurumi) est classé travail, pas pelote', () => {
    // Même patron : « Crin » (3 pièces cousues formant la crinière) ne matchait aucune
    // famille anatomique existante (tête/oreille/museau/queue/membre) → même bug.
    const kind = kindForTitle('Crin')
    expect(kind).toBeTruthy()
    expect(NON_WORK_KINDS.has(kind)).toBe(false)
  })
  it('« FIBRA » (espagnol, sous-titre marque/composition/métrage de fil) est classé fil (holiday-ornament-es/serenity-sweater-es, palier 6)', () => {
    expect(kindForTitle('FIBRA')).toBe('fil')
    expect(kindForTitle('Fibras')).toBe('fil')
  })
  it('« Escote » (espagnol, synonyme de « cuello » pour l\'encolure) est classé encolure (palier 6)', () => {
    expect(kindForTitle('Escote')).toBe('encolure')
  })
  it('« Unión »/« Union » (espagnol, assemblage) est classé finitions (palier 6)', () => {
    expect(kindForTitle('Unión')).toBe('finitions')
    expect(kindForTitle('Union')).toBe('finitions')
  })
  it('« Asemblaje » (espagnol, orthographe fautive RÉELLE du PDF serenity-sweater-es pour « ensamblaje », confirmée {finishing} par une référence de contrôle) est classé finitions (palier 6)', () => {
    expect(kindForTitle('ASEMBLAJE')).toBe('finitions')
    expect(kindForTitle('Ensamblaje')).toBe('finitions')
  })
  it('« FERTIGSTELLEN » (allemand, forme verbale de finitions) est classé finitions (palier 7, peonie-flower-de, IMPACT RÉEL CONFIRMÉ)', () => {
    // peonie-flower-de-bc2e2ed0 (corpus réel, crochet) : titre RÉEL « FERTIGSTELLEN »
    // (section finition — couper/coller/enrouler le fil du fil de fer), seule la forme
    // nominale « fertigstellung » était couverte jusqu'ici → repli `pelote`.
    expect(kindForTitle('FERTIGSTELLEN')).toBe('finitions')
    expect(kindForTitle('Fertig stellen')).toBe('finitions') // variante espacée tolérée
    expect(kindForTitle('Fertigstellung')).toBe('finitions') // non-régression : forme nominale déjà couverte
  })

  // Cas réel (explorer-hat-en-532723fb, corpus réel, IMPACT RÉEL CONFIRMÉ) : le
  // titre nu « Explorer » (nom du patron, page de garde) était classé à tort `oreille`
  // ({ear}) — la branche ASCII de l'alternative `[øo]rer?\b` n'avait de frontière de mot
  // qu'EN FIN, jamais en tête, et matchait donc en simple sous-chaîne la fin de n'importe
  // quel mot terminé par « -ore »/« -orer » (pas seulement « Explorer »). Scindée en
  // `ører?\b|\borer?\b` : la branche ASCII exige maintenant un mot ASCII isolé, la branche
  // « ø » (danois/norvégien) reste nue car `\b` de JS ne reconnaît aucune frontière autour
  // d'un caractère non-ASCII (un ancrage y serait un no-op silencieux, jamais un vrai fix).
  it('« Explorer » (nom de patron EN, page de garde) n\'est plus classé oreille (campagne vague 5, IMPACT RÉEL CONFIRMÉ)', () => {
    expect(kindForTitle('Explorer')).not.toBe('oreille')
    expect(kindForTitle('Explorer')).toBeNull()
  })
  it('non-régression : d\'autres mots anglais fréquents terminés par « -ore »/« -orer » ne sont pas classés oreille', () => {
    expect(kindForTitle('Explore')).not.toBe('oreille')
    expect(kindForTitle('Before')).not.toBe('oreille')
    expect(kindForTitle('Store')).not.toBe('oreille')
    expect(kindForTitle('Score')).not.toBe('oreille')
    expect(kindForTitle('Adore')).not.toBe('oreille')
  })
  it('conserve les vrais titres oreille EN/FR/DE et la variante ASCII isolée « orer »/« ore »', () => {
    expect(kindForTitle('EARS')).toBe('oreille')
    expect(kindForTitle('OREILLES')).toBe('oreille')
    expect(kindForTitle('Ohren')).toBe('oreille')
    // Variante danoise/norvégienne « øre »/« ører » (ears) : ø non ASCII, hors corpus mesuré
    // (aucun « ø » dans les 67 PDF des vagues 1/3/4/5), conservée non ancrée à dessein.
    expect(kindForTitle('Ører')).toBe('oreille')
    expect(kindForTitle('ØRER')).toBe('oreille')
  })

  // Cas réel (spring-headband-de-cfeb6f9e, corpus réel, IMPACT RÉEL CONFIRMÉ) : le
  // mot-clé nu `muster\b` de la famille `motif` (non ancré en tête À DESSEIN — cf. son
  // commentaire, requis par les composés allemands « Ajourmuster »/« Blattmuster ») matche
  // aussi le bandeau de couverture nu « STRICKMUSTER » (page 0, « type d'ouvrage » — même
  // rôle que « KNITTING PATTERN »/« HÄKELANLEITUNG »). Non ancrable ICI sans casser les
  // composés légitimes : voir tests/unit/mdlab-engine.spec.js pour le vrai correctif,
  // apporté par une alternative dédiée de CRAFT_BANNER_RE (page 0 uniquement). Au niveau
  // kindForTitle seul (sans le contexte page 0), « STRICKMUSTER » reste `motif` — attendu,
  // non un défaut : c'est le gate page 0 de CRAFT_BANNER_RE qui route le bandeau en bruit.
  it('kindForTitle seul classe encore « STRICKMUSTER » en motif (le correctif est au niveau du bandeau page 0, pas ici)', () => {
    expect(kindForTitle('STRICKMUSTER')).toBe('motif')
    expect(kindForTitle('Ajourmuster')).toBe('motif')
    expect(kindForTitle('Blattmuster')).toBe('motif')
  })

  // Bug 2 (to-the-beach-fr-c33da181) : « INFO CROCHET: » est un encart
  // technique récurrent des patrons DROPS (comment commencer/terminer un tour), pas une
  // annonce de taille de crochet — mais l'alternative `crochet\s*(?::|n[°o]|\d)` de la
  // famille aiguilles, non ancrée, matchait « crochet: » en sous-chaîne où qu'il apparaisse
  // dans le titre. La section partait vers l'extracteur de taille d'aiguille, qui n'y
  // trouve aucune taille, et ses phrases retombaient en puces anonymes dans ## Matériel —
  // alors que le patron y renvoie deux fois (« VOIR INFO CROCHET », « ne pas oublier INFO
  // CROCHET! »). Sondage sur 10 PDF DROPS fr (corpus-web/drops) : le même encart apparaît
  // dans 3/10 (back-to-the-beach, blueberry-picking, to-the-beach) — défaut structurel de
  // cette source (~110 PDF du corpus).
  // Correctif en TROIS temps, chacun insuffisant seul : (1) ancrer en tête (`^crochet…`)
  // l'alternative crochet de la famille aiguilles règle la collision avec cette famille,
  // MAIS révèle une SECONDE collision — le mot « INFO » nu appartient à la famille `info`
  // (INTRO_KEYS), qui absorbe alors la section dans la Présentation (le titre disparaît
  // quand même, fondu dans l'intro au lieu d'être jeté dans le Matériel — vérifié par
  // l'exécution réelle du pipeline avant ce correctif). (2) `INFO_CRAFT_INSERT_RE` excluait
  // le titre EXACT « INFO CROCHET »/« INFO TRICOT » avant tout balayage de KIND_KEYWORDS
  // (null : section sauvée mais NON TYPÉE, repli pelote). (3) Un arbitrage (03/09) : le
  // même encart rejoint la famille dédiée `infos` — l'exclusion null est retirée, ses
  // motifs repliés dans l'entrée `infos` de KIND_KEYWORDS (harmonisation demandée).
  it('« INFO CROCHET: » (encart technique DROPS) n’est plus pris pour une annonce de taille de crochet, ni absorbé par « info » — kind dédié `infos`', () => {
    expect(kindForTitle('INFO CROCHET:')).toBe('infos')
    expect(kindForTitle('INFO CROCHET!')).toBe('infos')
  })
  it('« INFO TRICOT » (même encart, variante tricot DROPS) rejoint lui aussi `infos`', () => {
    // Non trouvé dans le sondage réel (10 PDF DROPS fr), mais le même défaut structurel de
    // la source existe côté tricot chez DROPS — couverture symétrique par anticipation.
    expect(kindForTitle('INFO TRICOT:')).toBe('infos')
    expect(kindForTitle('INFO TRICOT')).toBe('infos')
  })
  it('non-régression : une rubrique d’aide générale « INFO … » à plusieurs mots rejoint `infos` (section consultable, un arbitrage)', () => {
    // Un arbitrage (03/09) : ces rubriques multi-mots (gate-validées {other} par l'oracle
    // de référence — donc des SECTIONS, pas de l'intro) reçoivent le kind dédié au lieu du
    // routage `info` qui les fondait dans la Présentation. Seul le mot « Tips » NU reste
    // `info` (ambigu, gate easter-egg-no).
    expect(kindForTitle('INFO AND TIPS')).toBe('infos')
    expect(kindForTitle('INFO ET CONSEILS')).toBe('infos')
    expect(kindForTitle('INFO UND TIPPS')).toBe('infos')
  })
  it('non-régression : « Crochet 6 mm »/« Crochet : 6 mm »/« CROCHET: » (vraie annonce de taille de crochet) restent classés aiguilles', () => {
    expect(kindForTitle('Crochet 6 mm')).toBe('aiguilles')
    expect(kindForTitle('Crochet : 6 mm')).toBe('aiguilles')
    expect(kindForTitle('CROCHET:')).toBe('aiguilles') // back-to-the-beach-fr-00af529a : titre réel, suivi de « CROCHET DROPS n° 4.5. »
    expect(kindForTitle('Crochet n° 6')).toBe('aiguilles')
  })
  it('non-régression : segmentSections garde « INFO CROCHET » comme section à part entière (ref ni aiguilles, kind non-intro)', () => {
    const pages = [[
      L('INFO CROCHET:', { bold: true }),
      L("Chaque tour de mailles serrées se commence par 1 maille en l'air."),
      L('Chaque tour de brides se commence par 3 mailles en l’air.'),
    ]]
    const secs = segmentSections(pages)
    const sec = secs.find((s) => s.title === 'INFO CROCHET')
    expect(sec).toBeTruthy()
    expect(sec.ref).not.toBe('aiguilles')
    expect(sec.intro).toBe(false)
    expect(sec.lines.map((l) => l.text)).toEqual([
      "Chaque tour de mailles serrées se commence par 1 maille en l'air.",
      'Chaque tour de brides se commence par 3 mailles en l’air.',
    ])
  })

  // Bug systémique (4e signalement) : contrairement aux cas
  // ci-dessus (Passe/Rand/Rock/Tripa/Crin — un mot-clé MANQUAIT à une famille existante),
  // ces titres sont GÉNÉRIQUES par nature : aucun mot-clé anatomique/fonctionnel ne les
  // décrira jamais (« Instructions » fr — probablement le titre de section le plus
  // fréquent du corpus français ; « PIEZA DELANTERA/TRASERA » es — accord féminin de
  // delantero/trasero ; « Träger »/« Armausschnitt » de — bretelle/emmanchure). kindForTitle
  // renvoie null → repli kind='pelote' (segment.js l.351) → NON_WORK_KINDS dégrade toute
  // la section en remarques non cochables. Seule une reclassification POST-HOC (une fois
  // les lignes assignées) peut rattraper ces titres, à condition que la section porte un
  // VRAI rang (même détecteur que le garde de rétrogradation ci-dessus, hasRowLine) —
  // sinon on risquerait de reclasser à tort une section non-actionable mal titrée.
  describe('reclassification post-hoc pelote → travail (titre générique + vrais rangs)', () => {
    it('« Instructions » (fr, titre générique) avec de vrais rangs numérotés est reclassée hors NON_WORK_KINDS', () => {
      const pages = [[
        L('Instructions', { bold: true }),
        L('Rang 1 : monter 40 mailles avec l’aiguille n°4.'),
        L('Rang 2 : tricoter à l’endroit toutes les mailles.'),
        L('Rabattre toutes les mailles souplement.'),
      ]]
      const secs = segmentSections(pages)
      const instr = secs.find((s) => s.title === 'Instructions')
      expect(instr).toBeTruthy()
      expect(kindForTitle('Instructions')).toBeNull() // prémisse : aucune famille ne matche
      expect(NON_WORK_KINDS.has(instr.kind)).toBe(false)
    })
    it('« PIEZA DELANTERA » (espagnol, accord féminin absent des familles) avec de vrais rangs est reclassée hors NON_WORK_KINDS', () => {
      const pages = [[
        L('PIEZA DELANTERA', { bold: true }),
        L('Vuelta 1: 6 pb en el anillo mágico.'),
        L('Vuelta 2: 2 pb en cada pb alrededor. (12)'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'PIEZA DELANTERA')
      expect(sec).toBeTruthy()
      expect(kindForTitle('PIEZA DELANTERA')).toBeNull()
      expect(NON_WORK_KINDS.has(sec.kind)).toBe(false)
    })
    it('« Träger » (allemand, bretelle, aucune famille dédiée) avec des rangs numérotés nus est reclassée hors NON_WORK_KINDS', () => {
      // Items numérotés nus (BARE_ITEM_RE), signal indépendant du mot de rang employé (« Reihe »
      // ou tout autre) : reste valide même depuis que ROW_START_RE couvre « reihen? »/« r » à
      // partir du palier 7 (cf. tests « Reihe »/« R » dédiés plus haut pour ce mécanisme).
      const pages = [[
        L('Träger', { bold: true }),
        L('1. 30 Maschen anschlagen.'),
        L('2. Glatt rechts stricken bis 10 cm.'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'Träger')
      expect(sec).toBeTruthy()
      expect(kindForTitle('Träger')).toBeNull()
      expect(NON_WORK_KINDS.has(sec.kind)).toBe(false)
    })
    it('« HERZ DER BLUME » (allemand, aucune famille dédiée) avec des rangs « R N: » est reclassée hors NON_WORK_KINDS (palier 7, peonie-flower-de, IMPACT RÉEL CONFIRMÉ)', () => {
      // Avant ce correctif (ROW_START_RE sans « r »/« reihen? »), ce titre générique restait
      // kind='pelote' faute de tout signal détectable (ni famille anatomique, ni item numéroté
      // nu — les rangs sont introduits par « R N: », pas « N. »). C'est le symptôme exact des
      // 6 sections affectées de peonie-flower-de-bc2e2ed0.
      const pages = [[
        L('HERZ DER BLUME', { bold: true }),
        L('R 1 : 6 fM in einen magischen Ring'),
        L('R 2: 6 Zun (12 M)'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'HERZ DER BLUME')
      expect(sec).toBeTruthy()
      expect(kindForTitle('HERZ DER BLUME')).toBeNull()
      expect(NON_WORK_KINDS.has(sec.kind)).toBe(false)
      expect(sec.kind).toBe('autre')
    })
    it('non-régression : une section « pelote » SANS aucun rang réel (vraiment non-actionable) n’est PAS reclassée', () => {
      const pages = [[
        L('Remarques', { bold: true }),
        L('Ce modèle est proposé à titre indicatif.'),
        L('Les mesures peuvent varier selon la tension de chacun.'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'Remarques')
      expect(sec).toBeTruthy()
      expect(kindForTitle('Remarques')).toBeNull()
      expect(sec.kind).toBe('pelote')
    })
    it('non-régression : le préambule sans titre (Présentation, intro) n’est jamais reclassé même s’il contient un rang', () => {
      // Une section intro part vers consolidateIntro (assemble.js) en notes quel que soit
      // son kind — mais la reclassification elle-même doit rester inerte sur intro (garde
      // explicite), pour ne jamais interférer avec ce chemin séparé.
      const pages = [[L('Rang 1 : ceci ne devrait jamais arriver en tête de document.')]]
      const secs = segmentSections(pages)
      expect(secs[0].title).toBe('Présentation')
      expect(secs[0].intro).toBe(true)
      expect(secs[0].kind).toBe('pelote')
    })
  })

  // Bug 1 (mountaintop-pullover-es-b0cc556d, 1018 mots perdus) : « Talla
  // infantil »/« Tallas adultas » donnent la construction du canesú raglan EN INSTRUCTIONS,
  // réparties par groupe de tailles — ce ne sont pas des tableaux de cotes. L'alternative
  // espagnole non ancrée `tallas?|tama[ñn]os?` (comme les cinq autres mots non ancrés de la
  // famille `mesures` — storlek/koot/taglia/maten/rozmiar) les classe pourtant ref='mesures' :
  // la section devient un tableau de référence et ses lignes sont jetées EN BLOC par
  // assemble.js (filtre `!s.ref`). Le titre seul ne peut PAS distinguer les deux cas (cf.
  // « Tabla de tallas », qui ne commence pas par « tallas » — un ancrage casserait ce vrai
  // tableau, fix 3c577ce7) : le discriminant est le CONTENU — un tableau de cotes n'a jamais
  // de vrai rang numéroté (sectionHasRowLine), une répartition de travail par taille, si.
  describe('reclassification post-hoc mesures → travail (mot de taille non ancré + vrais rangs)', () => {
    it('« Talla infantil » (espagnol, canesú raglan) avec de vrais rangs n’est plus un tableau de mesures', () => {
      const pages = [[
        L('Talla infantil', { bold: true }),
        L('Vuelta 1: 6 pb en el anillo mágico.'),
        L('Vuelta 2: 2 pb en cada pb alrededor. (12)'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'Talla infantil')
      expect(sec).toBeTruthy()
      expect(kindForTitle('Talla infantil')).toBe('mesures') // prémisse : la collision existe bien au niveau du titre seul
      expect(sec.ref).not.toBe('mesures')
      expect(NON_WORK_KINDS.has(sec.kind)).toBe(false)
      expect(sec.lines.map((l) => l.text)).toEqual([
        'Vuelta 1: 6 pb en el anillo mágico.',
        'Vuelta 2: 2 pb en cada pb alrededor. (12)',
      ])
    })
    it('« Tallas adultas » (espagnol, canesú raglan, item numéroté nu) est aussi reclassée hors mesures', () => {
      const pages = [[
        L('Tallas adultas', { bold: true }),
        L('1. Montar 96 (104, 112) puntos.'),
        L('2. Tejer en redondo hasta 10 cm.'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'Tallas adultas')
      expect(sec).toBeTruthy()
      expect(sec.ref).not.toBe('mesures')
      expect(NON_WORK_KINDS.has(sec.kind)).toBe(false)
    })
    it('non-régression : « Tabla de tallas » (un VRAI tableau de cotes, sans aucun rang) reste une section mesures', () => {
      const pages = [[
        L('Tabla de tallas', { bold: true }),
        L('Talla S 90 94 98 cm'),
        L('Talla M 100 104 108 cm'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'Tabla de tallas')
      expect(sec).toBeTruthy()
      expect(sec.ref).toBe('mesures')
    })
    it('non-régression : « Tallas » suivie d’un vrai tableau (lignes label + vecteur de nombres) reste une section mesures', () => {
      // Une ligne de tableau (looksLikeTableRow) n'est ni un mot de rang ni un item numéroté
      // nu : sectionHasRowLine doit rester false, la section ne doit donc pas être reclassée.
      const pages = [[
        L('Tallas', { bold: true }),
        L('Busto 90 94 98 102 cm'),
        L('Cintura 70 74 78 82 cm'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'Tallas')
      expect(sec).toBeTruthy()
      expect(sec.ref).toBe('mesures')
    })
    // 2e variante du même bug (open-back-sweater-fr-c9b6e744,
    // corpus réel) : un titre de taille NU SANS « seulement/uniquement » (« TAILLE S »…) n'a
    // ni le mot d'exclusivité qui l'exclurait de 'mesures' (cf. le garde SEULEMENT sur
    // KIND_KEYWORDS['mesures']), ni un mot de rang reconnu par ROW_START_RE — ce patron
    // étiquette ses rangs par une abréviation dérivée du nom de la pièce (« EAR 27 »), jamais
    // par le mot « rang »/« row » lui-même. Sans le signal « Faites » + chiffre (repli ajouté
    // à sectionHasWorkRow), 8 sections (2 pièces × 4 tailles) restaient classées 'mesures' et
    // leurs rangs — de vraies instructions cochables — étaient jetés en bloc puis réinjectés
    // en tête de document sans étiquette de taille (filet de secours reference.js).
    it('« TAILLE S » nue (crochet FR, rang étiqueté « EAR 27 » + verbe « Faites » sans mot de rang) est aussi reclassée hors mesures', () => {
      const pages = [[
        L('TAILLE S', { bold: true }),
        L('EAR 27 Faites 3 ml, sautez la 1ère ml, 2 ms dans les deux ml suivantes, 8 ms. (10)'),
        L('EAR 28-30 Faites 1 ml et tournez votre travail, ms dans chaque m jusqu’à la fin du rang. (10)'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'TAILLE S')
      expect(sec).toBeTruthy()
      expect(kindForTitle('TAILLE S')).toBe('mesures') // prémisse : la collision existe bien au niveau du titre seul
      expect(sec.ref).not.toBe('mesures')
      expect(NON_WORK_KINDS.has(sec.kind)).toBe(false)
      expect(sec.lines.map((l) => l.text)).toEqual([
        'EAR 27 Faites 3 ml, sautez la 1ère ml, 2 ms dans les deux ml suivantes, 8 ms. (10)',
        'EAR 28-30 Faites 1 ml et tournez votre travail, ms dans chaque m jusqu’à la fin du rang. (10)',
      ])
    })
    it('non-régression : « Faites » sans chiffre immédiat (« Faites attention », prose) ne déclenche pas le repli — une vraie section mesures sans rang le reste', () => {
      const pages = [[
        L('TAILLE M', { bold: true }),
        L('Faites attention à bien mesurer à plat, sans étirer le tricot.'),
        L('Tour de poitrine 90 94 98 cm'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'TAILLE M')
      expect(sec).toBeTruthy()
      expect(sec.ref).toBe('mesures')
    })
  })

  // Promotion post-hoc pelote → intro (titre générique « Instructions »/« Instrucciones »/
  // « Anleitung » SANS aucun rang réel) : bellis-purse-es-80beb715 (corpus réel,
  // palier 5). Une vue d'ensemble de construction en PROSE (« Se teje de ida y vuelta
  // con agujas circulares 5 con hilo doble. » …) titrée « Instrucciones » ne matche aucune
  // famille de KIND_KEYWORDS (kindForTitle → null) → repli kind='pelote', ref=null,
  // intro=false (le mot n'est PAS dans INTRO_KEYS). Sans correctif, NON_WORK_KINDS (pelote)
  // la sérialise en fausse section de travail (remarques `>` non grasses) à sa position
  // d'origine dans le document, au lieu de rejoindre la Présentation en tête de fichier.
  // Symétrique — ET MUTUELLEMENT EXCLUSIVE via sectionHasRowLine — de la reclassification
  // post-hoc pelote → travail ci-dessus : cleo-tube-scarf-fr-639429a8 porte le MÊME titre
  // générique « Instructions » mais avec de VRAIS rangs numérotés (corrigée au palier 4 vers
  // kind='autre') — ce cas ne doit JAMAIS devenir intro (test de non-régression ci-dessous).
  describe('promotion post-hoc pelote → intro (titre générique « instructions » SANS aucun rang)', () => {
    it('« Instrucciones » (es, prose de construction SANS rang) devient une section intro (bellis-purse-es)', () => {
      const pages = [[
        L('Instrucciones', { bold: true }),
        L('Se teje de ida y vuelta con agujas circulares 5 con hilo doble.'),
        L('Se acaba el bolso tejiendo los laterales.'),
        L('Teje el icord, cuando el bolso esté terminado.'),
      ]]
      const secs = segmentSections(pages)
      const instr = secs.find((s) => s.title === 'Instrucciones')
      expect(instr).toBeTruthy()
      expect(kindForTitle('Instrucciones')).toBeNull() // prémisse : aucune famille ne matche
      expect(instr.intro).toBe(true)
    })
    it('non-régression CRITIQUE : « Instructions » (fr, AVEC de vrais rangs numérotés, cleo-tube-scarf-fr) ne devient JAMAIS intro et reste reclassée vers « autre »', () => {
      // Même titre EXACT que le cas Bellis ci-dessus, mais AVEC des rangs — doit continuer
      // à emprunter le chemin EXISTANT (pelote → autre, sectionHasRowLine) validé au palier
      // 4, jamais le nouveau chemin intro. Si ce test casse, le correctif a mis « instructions »
      // dans INTRO_KEYS (ou un motif trop large) : régression du palier 4 (cf. avertissement
      // du protocole — Cleo redeviendrait des remarques non cochables, `pelote` ∈ NON_WORK_KINDS).
      const pages = [[
        L('Instructions', { bold: true }),
        L('1. Monter 184 ml, et former un rond avec 1 mc dans la première ml.'),
        L('2. Faire 3 ml (remplacent la 1ère br). Crocheter 1 br dans chaque ml tout le tour.'),
        L('3. Faire 1 ml. Crocheter 1 br Rav autour des 4 m suivantes.'),
      ]]
      const secs = segmentSections(pages)
      const instr = secs.find((s) => s.title === 'Instructions')
      expect(instr).toBeTruthy()
      expect(instr.intro).toBe(false)
      expect(instr.kind).toBe('autre')
      expect(NON_WORK_KINDS.has(instr.kind)).toBe(false)
    })
    it('non-régression : « Anleitung » (de, AVEC de vrais rangs « Reihe N: ») ne devient PAS intro — angle mort ROW_START_RE RÉSORBÉ À LA SOURCE au palier 7 (cf. test Träger)', () => {
      // ROW_START_RE (segment.js, sectionHasRowLine) ne couvrait PAS le mot allemand « Reihe »
      // avant ce palier (limitation documentée par le test Träger ci-dessus). Résorbé À LA
      // SOURCE au palier 7 (même mécanisme que « hilera » au palier 6, cf. test ci-dessous) :
      // sectionHasRowLine détecte désormais directement ces rangs, la section devient
      // pleinement cochable (kind='autre'), plus seulement « ne devient pas intro ».
      const pages = [[
        L('Anleitung', { bold: true }),
        L('Reihe 1: 30 Maschen anschlagen.'),
        L('Reihe 2: Glatt rechts stricken bis 10 cm.'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'Anleitung')
      expect(sec).toBeTruthy()
      expect(sec.intro).toBe(false)
      expect(sec.kind).toBe('autre')
    })
    it('non-régression : « Instrucciones » (es, AVEC de vrais rangs « Hilera N: ») ne devient PAS intro', () => {
      // Même symptôme que le cas Anleitung/Reihe ci-dessus, côté espagnol, mais l'angle mort
      // ROW_START_RE a été RÉSORBÉ À LA SOURCE au palier 6 : « hilera » est maintenant dans
      // ROW_START_RE (segment.js) au même titre que dans ROW_RE (steps.js) — sectionHasRowLine
      // détecte donc directement ces rangs. Gardé en non-régression : la section ne doit
      // toujours JAMAIS devenir intro, désormais via le chemin PRINCIPAL (sectionHasRowLine)
      // plutôt qu'une garde locale (MISSED_ROW_RE, entièrement retirée au palier 7).
      const pages = [[
        L('Instrucciones', { bold: true }),
        L('Hilera 1: 6 pb en el anillo mágico.'),
        L('Hilera 2: 2 pb en cada pb alrededor.'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'Instrucciones')
      expect(sec).toBeTruthy()
      expect(sec.intro).toBe(false)
    })
  })

  // (corpus Retours-banc/2026-08-27-vague7) : cinq trous du dictionnaire
  // KIND_KEYWORDS sur des titres RÉELS — un test par sous-cas, chacun ancré sur son PDF
  // témoin. Les corrections vont dans les entrées EXISTANTES sans changer l'ordre du
  // tableau (premier match gagne).
  describe('campagne vague 7 — lexiques de kinds et frontières unicode', () => {
    // 1a. « Esquema » (ES) : primula-bloomers-es-306383c5 — la section « Esquema » était
    // perdue alors que le corps du patron y renvoie 6 fois. « esquema » ne collisionne
    // avec aucune famille précédente (le « schema\b » existant ne le matche pas : pas de
    // sous-chaîne « schema » dans « esquema »).
    it('« Esquema » (espagnol, diagramme) est classé diagramme (primula-bloomers-es, vague 7)', () => {
      expect(kindForTitle('Esquema')).toBe('diagramme')
      expect(kindForTitle('ESQUEMAS')).toBe('diagramme')
    })
    // 1b. « DIAGRAMS » (EN pluriel) : owen-stoat-en-d68ee50e — `diagram(?:met)?\b` exige
    // une frontière de mot après « diagram » : entre « m » et « s » de « diagrams » les deux
    // sont des caractères de mot, aucune frontière → aucun match. Le pluriel manquait donc,
    // malgré les apparences (la famille semble déjà couvrir « diagram »).
    it('« DIAGRAMS » (pluriel anglais) est classé diagramme (owen-stoat-en, vague 7)', () => {
      expect(kindForTitle('DIAGRAMS')).toBe('diagramme')
      expect(kindForTitle('Diagrams')).toBe('diagramme')
    })
    it('non-régression : Diagram/Diagramme/DIAGRAMMET (formes déjà couvertes) restent diagramme', () => {
      expect(kindForTitle('Diagram')).toBe('diagramme')
      expect(kindForTitle('Diagramme')).toBe('diagramme')
      expect(kindForTitle('DIAGRAMMET')).toBe('diagramme')
    })
    // 2. Famille corps — quatre titres réels routés ailleurs que {body} faute de mot-clé :
    // lemon-heart « ## SHAWL {other} », cella « ## CANESÚ », sunflower « ## RUMPFTEIL »
    // (ses sœurs Rückenteil/Vorderteil sont déjà couvertes), very-granny « ## DEVANTS »
    // (le singulier « devant » existait, pas le pluriel).
    it('« SHAWL »/« SHAWLS » (châle, pièce principale) est classé corps (lemon-heart-en, vague 7)', () => {
      expect(kindForTitle('SHAWL')).toBe('corps')
      expect(kindForTitle('Shawls')).toBe('corps')
    })
    it('« CANESÚ » (espagnol, empiècement) est classé corps (cella-cardigan-es, vague 7)', () => {
      expect(kindForTitle('CANESÚ')).toBe('corps')
      expect(kindForTitle('Canesu')).toBe('corps')
    })
    it('« RUMPFTEIL » (allemand, partie torse) est classé corps (sunflower-slip-top-de, vague 7)', () => {
      expect(kindForTitle('RUMPFTEIL')).toBe('corps')
      expect(kindForTitle('Rumpfteil')).toBe('corps')
    })
    it('« DEVANTS » (pluriel français) est classé corps comme le singulier déjà couvert (very-granny-cardigan-fr, vague 7)', () => {
      expect(kindForTitle('DEVANTS')).toBe('corps')
      expect(kindForTitle('Devant')).toBe('corps')
    })
    // 3. « ZUSAMMENFÜGEN » (DE, assembler) : bernadette-tote-bag — « zusammennähen » (coudre
    // ensemble) était couvert, pas sa variante « zusammenfügen », routée {other} au lieu de
    // {finishing}.
    it('« ZUSAMMENFÜGEN » (allemand, assembler) est classé finitions (bernadette-tote-bag-de, vague 7)', () => {
      expect(kindForTitle('ZUSAMMENFÜGEN')).toBe('finitions')
      expect(kindForTitle('Zusammenfügen')).toBe('finitions')
      expect(kindForTitle('Zusammennähen')).toBe('finitions') // non-régression : déjà couvert
    })
    // 4. « détails » volé par queue : \b de JS est aveugle hors ASCII — « é » n'est PAS un
    // caractère de mot, donc entre « é » et « t » de « détails » il voit une frontière et
    // \btails?\b matchait (angle mort Unicode déjà documenté deux fois dans reflow.js).
    // boo-the-bat « ## Ajouter les détails » était routé {tail}. Frontières Unicode
    // explicites (?<![\p{L}])…(?![\p{L}]) sur l'alternative « tails ».
    it('« Ajouter les détails » (« tails » collé à « é », hors ASCII) n’est PAS classé queue (boo-the-bat-fr, vague 7)', () => {
      expect(kindForTitle('Ajouter les détails')).not.toBe('queue')
      expect(kindForTitle('détaillé')).not.toBe('queue')
    })
    it('non-régression : Tail/TAILS/Queue restent queue', () => {
      expect(kindForTitle('Tail')).toBe('queue')
      expect(kindForTitle('TAILS')).toBe('queue')
      expect(kindForTitle('Queue')).toBe('queue')
    })
    // 5. « SCHEMATIC » volé par bordure : l'alternative /hems?/ était SANS frontière du
    // tout — « hem » en sous-chaîne de « schematic » (sc-HEM-atic) matchait, amelia avait
    // sa section de schéma routée {border}. Même ancrage Unicode que « tails ».
    it('« SCHEMATIC » (« hem » en sous-chaîne) n’est PAS classé bordure (amelia-colourwork-vest-en, vague 7)', () => {
      expect(kindForTitle('SCHEMATIC')).not.toBe('bordure')
    })
    it('non-régression : HEM/Hems/Bottom hem (vrais titres de bordure) restent bordure', () => {
      expect(kindForTitle('HEM')).toBe('bordure')
      expect(kindForTitle('Hems')).toBe('bordure')
      expect(kindForTitle('Bottom hem')).toBe('bordure')
    })
  })

  // Un arbitrage (tranché le 03/09 — « reco OK », option 1 retenue) : les rubriques de SERVICE/CONSEILS multilingues
  // qui existent déjà comme sections H2 restaient SANS kind (repli 'pelote' : titre nu dans le
  // MD) ou, pire, étaient fondues dans la Présentation via la famille `info` (INTRO_KEYS) —
  // pendant que le corps du patron continue d'y renvoyer (« HÄKELINFORMATION lesen », bttb ;
  // « VOIR INFO CROCHET »). Périmètre : un kind DÉDIÉ `infos`, la rubrique RESTE une
  // section consultable du flux (jamais aide-mémoire, jamais intro). Hors périmètre : les
  // rubriques « information SUR le patron » (INFORMATION SUR LE TUTORIEL, INFORMATION ZUR
  // ANLEITUNG, INFORMACIÓN SOBRE EL PATRÓN — sans complément conseils/astuces) restent `info`
  // → Présentation ; la fusion-intro par segmentation de titres (moss-rose, helly) est un
  // autre chantier. Entrée testée ENTRE `techniques` et `info` : les explications de technique
  // (« ASTUCES POUR… », « CONSEJOS PARA… ») gardent la priorité.
  describe('campagne vague 7 / un arbitrage — rubriques de service → kind `infos`', () => {
    it('FR : encart technique DROPS « INFO CROCHET »/« INFO TRICOT » harmonisé — kind dédié au lieu du null', () => {
      // Auparavant : INFO_CRAFT_INSERT_RE renvoyait null (section sauvée mais non typée).
      // Ce même titre rejoint la nouvelle famille — harmonisation demandée par
      // l'arbitrage (plus de double emploi entre l'ancienne exclusion et la nouvelle entrée).
      expect(kindForTitle('INFO CROCHET:')).toBe('infos')
      expect(kindForTitle('INFO CROCHET!')).toBe('infos')
      expect(kindForTitle('INFO TRICOT')).toBe('infos')
      expect(kindForTitle('INFORMATION CROCHET')).toBe('infos')
      expect(kindForTitle('INFORMATION TRICOT:')).toBe('infos')
    })
    it('FR : « INFO/INFOS/INFORMATION(S) ET CONSEILS/ASTUCES » → infos (soft-twist gate)', () => {
      expect(kindForTitle('INFO ET CONSEILS')).toBe('infos')
      expect(kindForTitle('INFOS ET CONSEILS')).toBe('infos')
      expect(kindForTitle('INFORMATIONS ET ASTUCES')).toBe('infos')
    })
    it('ES : « INFORMACIÓN Y CONSEJOS » (hooked-on-you) et « ATENCIÓN » (bird-nest) → infos', () => {
      expect(kindForTitle('INFORMACIÓN Y CONSEJOS')).toBe('infos')
      expect(kindForTitle('INFO Y CONSEJOS')).toBe('infos')
      expect(kindForTitle('ATENCIÓN')).toBe('infos')
      expect(kindForTitle('ATENCIÓN:')).toBe('infos')
    })
    it('EN : « INFO AND TIPS » et encarts DROPS suffixés « …TIP »/« …INFORMATION » → infos', () => {
      expect(kindForTitle('INFO AND TIPS')).toBe('infos')
      expect(kindForTitle('INFORMATION AND TIPS')).toBe('infos')
      expect(kindForTitle('INCREASE TIP:')).toBe('infos')
      expect(kindForTitle('DECREASE TIP (applies to mid under sleeve):')).toBe('infos')
      expect(kindForTitle('CROCHET INFORMATION:')).toBe('infos')
      expect(kindForTitle('KNITTING INFORMATION')).toBe('infos')
    })
    it('DE : HÄKELINFORMATION/STRICKINFORMATION, …TIPP, « …-KURZBESCHREIBUNG DER ARBEIT » → infos (back-to-the-beach)', () => {
      expect(kindForTitle('HÄKELINFORMATION:')).toBe('infos')
      expect(kindForTitle('STRICKINFORMATION')).toBe('infos')
      expect(kindForTitle('HÄKELTIPP (gilt für die Luftmaschen):')).toBe('infos')
      expect(kindForTitle('ZUNAHMETIPP-1:')).toBe('infos')
      expect(kindForTitle('ZUNAHMETIPP-2 (gleichmäßig verteilt):')).toBe('infos')
      expect(kindForTitle('ABNAHMETIPP')).toBe('infos')
      expect(kindForTitle('TIPPS')).toBe('infos')
      expect(kindForTitle('NETZ - KURZBESCHREIBUNG DER ARBEIT')).toBe('infos')
    })
    it('contre-tests : ces motifs ne happent AUCUN titre de section de travail', () => {
      // « ATENCIÓN » ancré titre ENTIER : un mot noyé dans un titre de travail ne matche pas.
      expect(kindForTitle('Puntos de atención')).toBeNull()
      expect(kindForTitle('Continuación')).toBeNull()
      // « TIP(S) » suffixés DROPS uniquement après increase/decrease : le mot nu (« Tips »,
      // gate easter-egg/Decorative Pumpkins) et les composés anglais (« Fingertips ») non.
      expect(kindForTitle('Fingertips')).toBeNull()
      expect(kindForTitle('Fingertip decreases')).toBeNull()
      // « TIPP » allemand : composés NON-conseil (Schulter…) non couverts, repli inchangé.
      expect(kindForTitle('Schulterpartie')).toBeNull()
    })
    it('contre-tests : priorité de `techniques` préservée (complément d’action avant `infos`)', () => {
      expect(kindForTitle('ASTUCES POUR RÉALISER LES AUGMENTATIONS')).toBe('techniques')
      expect(kindForTitle('CONSEJOS PARA AUMENTOS (raglán)')).toBe('techniques')
    })
    it('non-régression : rubriques « information SUR le patron » (sans complément conseils) restent `info` → Présentation', () => {
      expect(kindForTitle('INFORMATION SUR LE TUTORIEL')).toBe('info')
      expect(kindForTitle('INFORMACIÓN SOBRE EL PATRÓN')).toBe('info')
      expect(kindForTitle('INFORMATION ZUR ANLEITUNG')).toBe('info')
      expect(kindForTitle('Tips')).toBe('info')
      expect(kindForTitle('Wskazówka')).toBe('info')
    })
    it('non-régression : vraies annonces de taille de crochet toujours aiguilles', () => {
      expect(kindForTitle('CROCHET:')).toBe('aiguilles')
      expect(kindForTitle('Crochet 6 mm')).toBe('aiguilles')
    })
    it('segmentSections : la rubrique service reste une section CONSULTABLE (kind infos, ni ref ni intro) — hooked-on-you', () => {
      const pages = [[
        L('INFORMACIÓN Y CONSEJOS', { bold: true }),
        L('1. Esta bufanda se trabaja de ida y vuelta.'),
        L('2. Al principio de cada vuelta, haz un nudo corredizo.'),
      ]]
      const secs = segmentSections(pages)
      const sec = secs.find((s) => s.title === 'INFORMACIÓN Y CONSEJOS')
      expect(sec).toBeTruthy()
      expect(sec.kind).toBe('infos')
      expect(sec.ref).toBeNull()
      expect(sec.intro).toBe(false)
      expect(sec.noise).toBe(false)
      expect(sec.lines).toHaveLength(2)
    })
    it('`infos` est un kind non-travail : la prose de conseil reste une note, pas un rang cochable', () => {
      // Même rendu que l'ancien repli 'pelote' (référence oracle : prose de conseil en `>`),
      // et cohérent avec NON_WORK_KINDS exporté (steps.js) — testé CONTRE la liste réelle.
      expect(NON_WORK_KINDS.has('infos')).toBe(true)
    })
  })
})

// D4 (défauts DROPS) : les titres de sections « AUGMENTATIONS »/« DIMINUTIONS »
// (et équivalents IT/DE/EN mesurés) sont des explications de TECHNIQUE (comment
// augmenter/diminuer), pas du travail en rangs — routés vers l'aide-mémoire `techniques`,
// conforme à l'oracle de référence to-the-beach-fr-c33da181-ideal.md (l.32-46) qui place
// « ### AUGMENTATIONS » sous « ## Techniques {techniques} ». « ASTUCE CROCHET » rejoint
// `infos` (jumeau de « INFO CROCHET », un arbitrage).
describe('D4 vague 2 — titres AUGMENTATIONS/DIMINUTIONS/ASTUCE CROCHET (drops)', () => {
  it('route les titres augmentation/diminution vers techniques (aide-mémoire, cf. oracle to-the-beach)', () => {
    for (const t of [
      'AUGMENTATIONS', 'AUGMENTATIONS:', 'AUGMENTATIONS-1:', 'AUGMENTATIONS-2 (à intervalles réguliers):',
      'AUGMENTATIONS ENCOLURE:', 'AUGMENTATIONS EMMANCHURE:', 'DIMINUTIONS TALON (à tricoter en jersey):',
      'DIMINUTIONS (milieu sous les manches):', 'AUMENTI:', 'AUMENTI PER LA SCOLLATURA:',
      'DIMINUZIONI PER IL TALLONE (lavorate a maglia rasata):', 'ZUNAHMEN FÜR DEN HALSAUSSCHNITT:',
      'ZUNAHMEN FÜR DEN ARMAUSSCHNITT:', 'INCREASE FOR NECKLINE:', 'INCREASE FOR ARMHOLE:',
    ]) {
      expect(kindForTitle(t)).toBe('techniques')
    }
  })
  it('ne matche pas les lignes de CORPS homonymes (bornes de longueur)', () => {
    for (const t of [
      'augmentations pour les emmanchures sont terminées, on a 98-106-114-114-122-136-148 mailles. Arrêter',
      'AUMENTI e RICORDARSI DI MANTENERE LA CORRETTA TENSIONE DEL LAVORO! Terminati gli aumenti, ci',
      'Zunahmen für die Armausschnitt weiterarbeiten, wie folgt stricken:',
      'Increase 1 stitch on each side of marker thread as follows: Work until 2 stitches remain before marker thread,',
    ]) {
      expect(kindForTitle(t)).not.toBe('techniques')
    }
  })
  it('ASTUCE CROCHET rejoint infos (jumeau de INFO CROCHET, un arbitrage)', () => {
    expect(kindForTitle('ASTUCE CROCHET')).toBe('infos')
    expect(kindForTitle('ASTUCE CROCHET (pour les mailles en l\'air):')).toBe('infos')
  })
  it('INCREASE TIP reste à infos (pas volé par techniques)', () => {
    expect(kindForTitle('INCREASE TIP-1:')).toBe('infos')
    expect(kindForTitle('DECREASE TIP (applies to mid under sleeve):')).toBe('infos')
  })
})

describe('segmentSections — branche allemande (isGerman, Piste 2)', () => {
  // 2 pages, PAS 1 : segment.js applique une rétrogradation générique « mini-section
  // page de garde » (segment.js:548-593, `sec.page === 0`) qui replie dans la section
  // précédente toute mini-section (≤4 lignes, sans kind reconnu, pas tout-caps) trouvée
  // sur la page 0 — INDÉPENDAMMENT de isSpacedTitle/isGerman. Sur une seule page, cette
  // rétrogradation masquerait le comportement qu'on veut tester ici (même schéma que le
  // test existant « fragment de légende photo… Teddy Doudou / Sara Doll », plus haut dans
  // ce même fichier, qui utilise 2 pages pour la même raison). Une page de garde minimale
  // (page 0) porte juste le titre du patron ; tout le contenu du test vit sur la page 1.
  const pagesDe = [
    [{ text: 'Pullover Beispiel', bold: true, size: 20, y: 900 }],
    [
      { text: 'Rückenteil', bold: true, size: 12, y: 900 },
      { text: 'Schlage 80 Maschen an und stricke im Bündchenmuster.', size: 10, bold: false, y: 884 },
      { text: 'Muster fortlaufend bis zur gewünschten', size: 10, bold: false, y: 868 },
      { text: 'Höhe stricken, dann für die Ärmel', size: 10, bold: false, y: 852 }, // 3 gaps de 16 → modalGap=16
      { text: 'Wiederhole diese Reihe für die gesamte', size: 10, bold: false, y: 620 }, // gap 232 = bloc photo ; se termine sur un adjectif décliné (GERMAN_ADJ_RE)
      { text: 'Länge des Rückenteils.', size: 10, bold: false, y: 606 }, // gap 14 ≈ modal, majuscule allemande
    ],
  ]

  it('SANS isGerman, la continuation allemande est promue à tort en titre de section (bug reproduit)', () => {
    const secs = segmentSections(pagesDe)
    expect(secs.map((s) => s.title)).toContain('Wiederhole diese Reihe für die gesamte')
  })

  it('AVEC isGerman, la même continuation reste dans la section en cours (correctif, via le signal adjectif décliné)', () => {
    const secs = segmentSections(pagesDe, { isGerman: true })
    expect(secs.map((s) => s.title)).not.toContain('Wiederhole diese Reihe für die gesamte')
    const rueck = secs.find((s) => s.title === 'Rückenteil')
    expect(rueck).toBeTruthy()
    expect(rueck.lines.map((l) => l.text)).toContain('Wiederhole diese Reihe für die gesamte')
    expect(rueck.lines.map((l) => l.text)).toContain('Länge des Rückenteils.')
  })
})

describe('segmentSections — un vrai titre allemand reste un titre (isGerman, non-régression ash-knit-wrist-warmers-de)', () => {
  // Bug réel trouvé au câblage bout en bout (24/07) : la Piste 1 avalait à tort un vrai
  // titre de section (« Daumenloch ») suivi normalement d'une nouvelle phrase qui
  // commence par une majuscule — comme TOUTE phrase allemande. Le titre lui-même ne se
  // termine PAS par un mot pendant/adjectif décliné (aucun signal positif Piste 2), donc
  // il doit rester un titre, contrairement à la continuation de phrase du bloc ci-dessus.
  const pagesDaumenloch = [
    [{ text: 'Ash - Handstulpen', bold: true, size: 20, y: 900 }],
    [
      { text: 'Stulpen', bold: true, size: 14, y: 900 },
      { text: 'Stricke bis 6 Maschen vor dem Anfang der Runde.', size: 10, bold: false, y: 884 },
      { text: 'Stricke weiter bis 12 Maschen abketten.', size: 10, bold: false, y: 868 },
      { text: 'Die Runde zu Ende stricken.', size: 10, bold: false, y: 852 }, // 3 gaps de 16 → modalGap=16
      { text: 'Daumenloch', size: 10, bold: false, y: 700 }, // gap 152 = bloc photo, vrai titre
      { text: 'Weiter gerade hoch stricken bis die Arbeit misst.', size: 10, bold: false, y: 686 }, // gap 14 ≈ modal, majuscule allemande normale
    ],
  ]

  it('AVEC isGerman, un vrai titre suivi normalement d’une nouvelle phrase reste un titre', () => {
    const secs = segmentSections(pagesDaumenloch, { isGerman: true })
    expect(secs.map((s) => s.title)).toContain('Daumenloch')
  })
})

describe('segmentSections — le test minuscule reste valide en allemand EN PLUS du signal (non-régression)', () => {
  // Écart DÉLIBÉRÉ vis-à-vis du fixture littéral d'origine (« Stricke rund auf
  // Nadelspiel oder Rundnadel mit magic », 52 caractères) : ce texte est rejeté par le
  // plafond de longueur d'isSpacedTitle (l.411, `t.length > 42` — capsLead ne s'applique
  // pas ici) AVANT même d'atteindre la branche allemande testée ici. Résultat vérifié :
  // le test tel que rédigé initialement passe QUE le correctif soit appliqué ou non — il
  // ne teste rien (repéré en le lançant AVANT le correctif segment.js et en constatant
  // qu'il était déjà vert). Fixture raccourci à ≤ 42 caractères (« oder Rundnadel » retiré,
  // sens préservé) pour que la ligne candidate atteigne réellement la comparaison
  // germanLooksIncomplete / minuscule qui est l'objet du correctif.
  const pagesEmprunt = [
    [{ text: 'Ash - Handstulpen', bold: true, size: 20, y: 900 }],
    [
      { text: 'Stulpen', bold: true, size: 14, y: 900 },
      { text: 'Stricke bis 6 Maschen vor dem Anfang der Runde.', size: 10, bold: false, y: 884 },
      { text: 'Stricke weiter bis 12 Maschen abketten.', size: 10, bold: false, y: 868 },
      { text: 'Die Runde zu Ende stricken.', size: 10, bold: false, y: 852 }, // 3 gaps de 16 → modalGap=16
      { text: 'Stricke rund auf Nadelspiel mit magic', size: 10, bold: false, y: 700 }, // gap 152 = bloc photo, 37 car. (≤42)
      { text: 'loop weiter bis zur gewünschten Länge.', size: 10, bold: false, y: 686 }, // gap 14 ≈ modal, minuscule non-allemande
    ],
  ]

  it('AVEC isGerman, un candidat suivi d’un emprunt en minuscule reste une continuation (pas un titre)', () => {
    const secs = segmentSections(pagesEmprunt, { isGerman: true })
    expect(secs.map((s) => s.title)).not.toContain('Stricke rund auf Nadelspiel mit magic')
  })
})

describe('segmentSections — titre sur deux lignes', () => {
  it('recolle « ABRÉVIATIONS » et « ET DÉFINITIONS » (star-stitch)', () => {
    // Positions réelles du PDF : x=227 pour les deux, taille 10, y 533,5 puis 522,5.
    const T = (text, y) => ({ text, size: 10, bold: false, y, parts: [{ x: 227, text }] })
    const E = (key, def, y) => ({
      text: `${key} ${def}`, size: 8, bold: false, y,
      parts: [{ x: 227, text: key }, { x: null, text: ' ' }, { x: 255, text: def }],
    })
    const page = [
      T('ABRÉVIATIONS', 533), T('ET DÉFINITIONS', 522),
      E('m', 'Maille(s)', 512), E('chaîn', 'Chaînette, maille en l’air', 503), E('jt', 'Jeté', 493),
    ]
    const secs = segmentSections([page])
    const abbr = secs.filter((s) => s.ref === 'abbr')
    expect(abbr).toHaveLength(1)
    expect(abbr[0].title).toBe('ABRÉVIATIONS ET DÉFINITIONS')
    expect(abbr[0].lines).toHaveLength(3)
    expect(secs.some((s) => s.title === 'ET DÉFINITIONS')).toBe(false)
  })

  // Avertissement 0 : fixture corrigé — la version littérale d'origine (FINITIONS à
  // y=480, écart de 53 pt avec ABRÉVIATIONS à y=533) n'est PAS discriminante : le test passe
  // même en retirant la garde « aucune ligne de contenu » testée, car l'écart de 53 pt dépasse
  // déjà le seuil d'interligne (1,5 × 10 = 15) et bloque le recollage à lui seul, sans que la
  // garde entre en jeu (vérifié : mutation « a.lines.length || » retirée → suite encore verte).
  // FINITIONS est donc rapprochée à y=522 (écart titre-à-titre 533-522=11 ≤ 15, condition
  // d'interligne satisfaite) pour que seule la garde « aucune ligne » empêche le recollage.
  // « m = maille » (y=528, entre les deux titres) reste, comme prévu
  // (execAbbrLine/looksLikeGlossaryEntry, clé courte sans espace), explicitement empêchée de
  // devenir un titre : elle retombe en ligne de contenu de ABRÉVIATIONS, qui n'est alors plus
  // vide — c'est cette non-vacuité, et elle seule, qui doit bloquer le recollage. Preuve par
  // mutation à l'étape 5 : retirer « a.lines.length || » fait maintenant ÉCHOUER ce test.
  it('ne recolle pas deux titres séparés par du contenu', () => {
    const T = (text, y, size = 10) => ({ text, size, bold: false, y, parts: [{ x: 40, text }] })
    const secs = segmentSections([[T('ABRÉVIATIONS', 533), T('m = maille', 528, 8), T('FINITIONS', 522)]])
    expect(secs.some((s) => s.title === 'ABRÉVIATIONS FINITIONS')).toBe(false)
  })

  // Deuxième passe (bug trouvé en convertissant crossbody-belt-bag-velvet-fr-ab429269, non prévu
  // initialement) avait étendu le recollage à toute section vide (pas seulement `ref='abbr'`)
  // — « Crossbody/ » + « Belt bag » (sections génériques `ref=null`) se recollaient alors
  // correctement grâce à une resynchronisation de `titleLine`. La troisième passe (balayage corpus
  // complet, 3232 PDF, revue) a mesuré que cette extension au-delà de `abbr` causait des
  // pertes SÈCHES ailleurs : une section référence vide (mesures/matériel/fil…) recollée
  // avec une VRAIE ligne de contenu voisine (mise en page Hobbii dense, mêmes page/x/taille/
  // interligne) route ce contenu vers un extracteur de rubrique qui n'a jamais été durci
  // pour l'absorber (chiffres de mesures perdus sur silly-owl-children-s-sweater-nl,
  // cabled-jacket-with-hood-baby-fr…), et des étiquettes de taille/pièce distinctes
  // (« Baby », « - Baby ») se recollaient à tort faute de signal fiable pour les distinguer
  // d'un vrai titre coupé. Resserré à `a.ref === 'abbr'` uniquement (seule rubrique durcie
  // dans ce même ensemble de correctifs, à tolérer du contenu multi-bloc) : ce cas-ci ne fusionne
  // plus DU TOUT — il retombe sur le comportement antérieur (2 lignes distinctes via la
  // rétrogradation mini-étiquette déjà existante), toujours sans perte.
  it('ne fusionne PAS un titre coupé hors rubrique abbr, même si la géométrie correspond (portée resserrée round 3, non-régression crossbody)', () => {
    const T = (text, y) => ({ text, size: 10, bold: true, y, parts: [{ x: 40, text }] })
    const page = [
      T('Introduction', 600),
      { text: 'Un petit texte de présentation.', size: 9, bold: false, y: 590 },
      T('Crossbody/', 533),
      T('Belt bag', 522),
    ]
    const secs = segmentSections([page])
    expect(secs.some((s) => s.title === 'Crossbody/ Belt bag')).toBe(false)
    expect(secs.some((s) => s.lines.some((l) => l.text === 'Crossbody/'))).toBe(true)
    expect(secs.some((s) => s.lines.some((l) => l.text === 'Belt bag'))).toBe(true)
  })

  // La cinquième passe (balayage corpus, revue — 5ᵉ tour, dernier) : bug trouvé en relisant UNE PAR UNE
  // les 57 fusions restantes après la troisième passe (a.ref==='abbr' seul). cardigan-cable-fr-
  // aa494e24 et cardigan-moss-stitch-fr-22dd7693 (glossaires « torsade ») passaient encore
  // la garde (≥3 lignes reconnues par execAbbrLine) tout en perdant du contenu réel : leurs
  // entrées sont écrites sur PLUSIEURS LIGNES PHYSIQUES par repli de mise en page (ex.
  // « Boutonnière Est travaillée sur les 6 m de la patte de » + 4 lignes suivantes = UNE
  // seule entrée), qu'aucun des deux mécanismes de lecture ne recompose. Mesuré sur le vrai
  // PDF : seules 22,7 % du texte de la section fusionnée étaient effectivement rattachées à
  // une entrée reconnue — le reste (« m Maille(s) », « Boutonnière … ») disparaissait en
  // silence à l'extraction (une section ref='abbr' n'a aucun repli générique). Un simple
  // COMPTE de lignes reconnues (≥3) ne suffit donc pas : il faut un taux de COUVERTURE du
  // texte ≥ 90 %. Fixture reproduisant le même défaut en miniature : 3 lignes courtes
  // reconnues par execAbbrLine (« 1. p : … ») contre 2 lignes de prose NON reconnues, bien
  // plus longues (repli sur plusieurs lignes physiques, comme « Boutonnière … ») — ratio de
  // couverture mesuré ≈ 0,19, largement sous le seuil.
  it('ne recolle pas un glossaire dont la majorité du texte n’est pas reconnue par l’extracteur (non-régression cardigan-cable-fr)', () => {
    const T = (text, y) => ({ text, size: 10, bold: false, y, parts: [{ x: 227, text }] })
    const K = (key, def, y) => ({ text: `${key} : ${def}`, size: 8, bold: false, y })
    const P = (text, y) => ({ text, size: 8, bold: false, y })
    const page = [
      T('ABRÉVIATIONS', 533),
      T('ET DÉFINITIONS', 522),
      P('m Maille(s) r Rang(s) end Endroit env Envers', 512),
      P(
        'Boutonnière Est travaillée sur les 6 m de la patte de boutonnage avec plusieurs ' +
          'mots supplémentaires qui allongent nettement ce texte pour dépasser largement ' +
          'la part reconnue par le scanner clé-valeur',
        502,
      ),
      K('1. p', '{4 end, 4 env}', 492),
      K('2. p', '{4 env, 4 end}', 482),
      K('3. p', 'id r 1', 472),
    ]
    const secs = segmentSections([page])
    const abbr = secs.find((s) => s.ref === 'abbr')
    expect(abbr.lines).toHaveLength(0)
    expect(secs.some((s) => s.title === 'ET DÉFINITIONS')).toBe(true)
    expect(secs.some((s) => s.title === 'ABRÉVIATIONS ET DÉFINITIONS')).toBe(false)
  })

  // La troisième passe (balayage corpus, revue) : la garde « a.ref === 'abbr' » (l.~766) est ce qui
  // borne le recollage à la seule rubrique durcie pour du contenu multi-bloc — sans elle,
  // même une section générique (ref=null) au contenu par ailleurs parfaitement abbr-like
  // (≥90 % reconnu par execAbbrLine) se recollerait, exposant reference.js à des sections
  // jamais mesurées pour ce chemin. Fixture ISOLANT cette garde spécifiquement : b.lines
  // contient un glossaire PROPRE (3 lignes clé:valeur, couverture 100 %) qui passerait
  // `looksLikeContentNotTitle`, l'exclusion REF_KEYS(b) ET `probablyParsesAsAbbr` haut la
  // main — seule la garde `a.ref === 'abbr'` bloque encore ce cas (a='Notes diverses' n'a
  // aucun ref).
  it('ne fusionne pas un titre coupé générique même si b contient un glossaire propre (isole la garde a.ref===abbr)', () => {
    const T = (text, y) => ({ text, size: 10, bold: true, y, parts: [{ x: 40, text }] })
    const K = (key, def, y) => ({ text: `${key} : ${def}`, size: 8, bold: false, y })
    const page = [
      T('Notes diverses', 533),
      T('Suite', 522),
      K('m', 'Maille', 512),
      K('r', 'Rang', 502),
      K('p', 'Point', 492),
    ]
    const secs = segmentSections([page])
    expect(secs.some((s) => s.title === 'Notes diverses Suite')).toBe(false)
  })
})

describe('segmentSections — soupape de sûreté des sections de référence', () => {
  it('ne coupe pas une phrase laissée ouverte par une virgule (Mia_Cardigan)', () => {
    const L = (text, y, size = 10) => ({ text, size, bold: false, y })
    const page = [
      L('Gauge:', 518),
      L('21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm after blocking', 505),
      L('300 (300, 350) 500 g Merino Singles by Sysleriget (100g = 366m) held together with 150 (150, 150,', 374),
      L('150) (150, 200) 200 g Silk Mohair by Sysleriget (50g = 420m).', 361),
    ]
    const secs = segmentSections([page])
    expect(secs.some((s) => s.title === 'Instructions')).toBe(false)
  })

  it('coupe toujours sur un vrai rang après une phrase terminée', () => {
    const L = (text, y, size = 10) => ({ text, size, bold: false, y })
    const page = [
      L('Gauge:', 518),
      L('21 sts x 28 rows on 4mm needles = 10 x 10 cm after blocking.', 505),
      L('1. Cast on 96 sts.', 480),
      L('2. Work k1, p1 ribbing.', 467),
    ]
    expect(segmentSections([page]).some((s) => s.title === 'Instructions')).toBe(true)
  })

  // Revue — la remise à zéro de `prevLineText` au SITE TITRE
  // (`cur = { …, titleLine: line, … }`) n'était couverte par AUCUN test : les deux tests
  // ci-dessus ne traversent jamais de frontière de section entre la ligne-virgule et le
  // bareItem. Séquence à 3 lignes REPRODUISANT le risque documenté dans le commentaire du
  // correctif : « Matériel: » ouvre une section avec une ligne-virgule non terminée
  // (« Laine : 5 (5, 6, » — variables porteuses : le nombre ET la virgule finale, sans eux
  // le test ne couvre rien), PUIS un second TITRE « Échantillon: » ouvre une AUTRE section
  // de référence, PUIS un bareItem (« 150) mailles = 10 cm ») y apparaît immédiatement. Sans
  // la remise à zéro, `prevLineText` reste « Laine : 5 (5, 6, » à travers le changement de
  // section : la virgule d'une phrase déjà refermée par le titre désarmerait À TORT la
  // soupape de la section SUIVANTE, alors qu'aucune phrase n'est réellement restée ouverte
  // (le titre a fermé le sujet). La soupape doit se déclencher : la ligne bareItem n'est en
  // rien la suite de « Laine : 5 (5, 6, », elle suit un TITRE.
  it('un titre referme la phrase en cours : la virgule d’une section précédente ne désarme pas la soupape de la section suivante', () => {
    const L = (text, y, size = 10) => ({ text, size, bold: false, y })
    const page = [
      L('Matériel:', 600),
      L('Laine : 5 (5, 6,', 587),
      L('Échantillon:', 500),
      L('150) mailles = 10 cm', 487),
    ]
    expect(segmentSections([page]).some((s) => s.title === 'Instructions')).toBe(true)
  })

  // Bug réel DROPS EN (sunny-daze-en-bc4eee5a, 27/08) : un patron crocheté en rond
  // ouvre par un rang FONDATEUR sans numéro (« Hat: Crochet 4 ch and make a ring with a sl
  // st in the first ch. »), collé à la suite du bloc Matériel sur la même page (mise en page
  // DROPS, aucun espacement ni gras ne le distingue). Ni ROW_START_RE ni BARE_ITEM_RE ne le
  // reconnaissent (aucun numéro de rang) : sans FOUNDING_RING_RE, la ligne restait dans la
  // section ref='materiel' et finissait scannée par isNeedleLine (reference.js) — « Crochet
  // 4 » y ressemblant à une taille de crochet nue — ## Aiguilles au lieu d'## Instructions.
  it('la soupape se déclenche aussi sur un rang fondateur sans numéro (« … make a ring… », DROPS EN)', () => {
    const L = (text, y, size = 10) => ({ text, size, bold: false, y })
    const page = [
      L('Materials:', 600),
      L('150 g color no 59, light old pink', 587),
      L('Hat: Crochet 4 ch and make a ring with a sl st in the first ch.', 574),
      L('1st round: Crochet 10 dc in ring.', 561),
    ]
    const secs = segmentSections([page])
    const instr = secs.find((s) => s.title === 'Instructions')
    expect(instr).toBeTruthy()
    expect(instr.lines.map((l) => l.text)).toEqual([
      'Hat: Crochet 4 ch and make a ring with a sl st in the first ch.',
      '1st round: Crochet 10 dc in ring.',
    ])
  })

  // FOUNDING_RING_RE ne doit JAMAIS s'armer pour `abbr` : « MR = magic ring » est une entrée
  // de glossaire authentique et récurrente (amigurumi) — l'armer là romprait le glossaire en
  // cours à la première ligne au lieu de laisser execAbbrLine la traiter normalement.
  it('n’arme pas la soupape « anneau » pour une section Abréviations (« MR = magic ring » reste une entrée de glossaire)', () => {
    const L = (text, y, size = 10) => ({ text, size, bold: false, y })
    const page = [
      L('Abbreviations:', 600),
      L('MR = magic ring', 587),
      L('sc = single crochet', 574),
    ]
    expect(segmentSections([page]).some((s) => s.title === 'Instructions')).toBe(false)
  })

  // Bug réel moss-stitch-basket-square-fr-d86efcef (Retours-banc, Go Handmade,
  // paniers crochet 3 tailles) : le titre fort dimensionnel « Panier 15 x 15 x H 9 cm »
  // (taille 14 sur un corps à 8, non gras — promu par la SEULE grande police) est suivi
  // de l'étiquette faible « Le fond: » (gap 29 pour un interligne modal ~9), puis de
  // rangs, puis « Les parois: », etc. Chaque étiquette faible ouvrait sa PROPRE section,
  // laissant la section « Panier … » VIDE — mergeEmptyTitledSections (assemble.js) la
  // jetait alors en silence (isRescuableTitle exige une parenthèse) : les 3 titres de
  // taille disparaissaient du document. Garde SUPPRESS-ONLY au site d'appel
  // (subLabelUnderDimensionalTitle, segment.js) : l'étiquette faible retombe en LIGNE
  // de la section dimensionnelle courante — sticky sur le TITRE de cur, pas sur sa
  // vacuité, pour couvrir aussi « Les parois: » une fois la section alimentée.
  describe('une sous-étiquette faible ne vide pas un titre de taille dimensionnel (moss-stitch-basket-square-fr)', () => {
    // Mêmes pièges que les témoins emptiesPrecedingSection (pdf-import-segment-titles.spec.js) :
    // l'Intro en page 0 évite la rétrogradation des mini-étiquettes (qui masquerait le défaut),
    // et les rangs à interligne 13 dominent en effectif les blancs 27 → modalGap = 13, seuil
    // d'isSpacedTitle 1,7×13 = 22,1 < 27.
    const page0 = [L('Intro', { bold: true, size: 13, y: 900 })]
    it('(a) « Le fond: »/« Les parois: » restent des LIGNES de « Panier 15 x 15 x H 9 cm », une seule section, rien de perdu', () => {
      const page1 = [
        L('Panier 15 x 15 x H 9 cm', { size: 14, y: 900 }), // titre FORT par la taille seule, comme le PDF réel
        L('Le fond:', { y: 873 }), // gap 27 → candidat faible, cur encore VIDE
        L('Rang 1 : 6 ms dans une maille coulée.', { y: 860 }),
        L('Rang 2 : 2 ms dans chaque maille.', { y: 847 }),
        L('Rang 3 : serrer le fil.', { y: 834 }),
        L('Les parois:', { y: 807 }), // gap 27 → candidat faible, cur DÉJÀ alimenté (portée sticky)
        L('Rang 4 : crocheter en spirale.', { y: 794 }),
        L('Rang 5 : continuer tout droit.', { y: 781 }),
      ]
      const secs = segmentSections([page0, page1])
      const panier = secs.find((s) => s.title === 'Panier 15 x 15 x H 9 cm')
      expect(panier).toBeTruthy()
      // Garde anti-perte : les étiquettes ET les rangs, verbatim, dans l'ordre.
      expect(panier.lines.map((l) => l.text)).toEqual([
        'Le fond:',
        'Rang 1 : 6 ms dans une maille coulée.',
        'Rang 2 : 2 ms dans chaque maille.',
        'Rang 3 : serrer le fil.',
        'Les parois:',
        'Rang 4 : crocheter en spirale.',
        'Rang 5 : continuer tout droit.',
      ])
      expect(secs.find((s) => s.title === 'Le fond')).toBeFalsy()
      expect(secs.find((s) => s.title === 'Les parois')).toBeFalsy()
    })
    // Contre-exemple flamingo-love-blanket-de-f1f48ccf : un faux titre fort NON
    // dimensionnel (« Sunflower (#36) - 1 Knäuel », page de garde) suivie du vrai titre
    // faible « Abkürzungen: » — le discriminateur DIMENSIONNEL de la garde doit laisser
    // la rubrique s'ouvrir (protéger un pareil faux titre empêchait le glossaire de
    // s'ouvrir et avalait tout le patron sous « ## Sunflower… »).
    it('(b) contre-exemple flamingo : sous un faux titre fort NON dimensionnel, « Abkürzungen: » ouvre toujours sa section', () => {
      const page1 = [
        L('Sunflower (#36) - 1 Knäuel', { bold: true, size: 13, y: 900 }),
        L('Abkürzungen:', { y: 873 }),
        L('M = Masche', { y: 860 }),
        L('R = Reihe', { y: 847 }),
        L('L = Luftmasche', { y: 834 }),
      ]
      const secs = segmentSections([page0, page1])
      const abbr = secs.find((s) => s.title === 'Abkürzungen')
      expect(abbr).toBeTruthy()
      expect(abbr.ref).toBe('abbr')
      expect(abbr.lines.map((l) => l.text)).toEqual(['M = Masche', 'R = Reihe', 'L = Luftmasche'])
    })
    it('(c) une étiquette faible à deux-points de 5+ mots ouvre normalement sa section (pas d’absorption)', () => {
      const page1 = [
        L('Panier 15 x 15 x H 9 cm', { size: 14, y: 900 }),
        L('Le fond du panier se crochète ainsi:', { y: 873 }), // 7 mots — hors du périmètre de la garde
        L('Rang 1 : 6 ms dans une maille coulée.', { y: 860 }),
        L('Rang 2 : 2 ms dans chaque maille.', { y: 847 }),
        L('Rang 3 : serrer le fil.', { y: 834 }),
        L('Rang 4 : continuer tout droit.', { y: 821 }),
      ]
      const secs = segmentSections([page0, page1])
      const label = secs.find((s) => s.title === 'Le fond du panier se crochète ainsi')
      expect(label).toBeTruthy()
      expect(label.lines.length).toBeGreaterThan(0)
    })
    it('(d) un VRAI titre fort suivant (« Panier 18 x 18 x H 10 cm ») referme la section dimensionnelle et ouvre la sienne', () => {
      const page1 = [
        L('Panier 15 x 15 x H 9 cm', { size: 14, y: 900 }),
        L('Le fond:', { y: 873 }),
        L('Rang 1 : 6 ms dans une maille coulée.', { y: 860 }),
        L('Rang 2 : 2 ms dans chaque maille.', { y: 847 }),
        L('Rang 3 : serrer le fil.', { y: 834 }),
        L('Rang 4 : continuer tout droit.', { y: 821 }),
        L('Panier 18 x 18 x H 10 cm', { size: 14, y: 794 }), // gap 27 MAIS titre fort → non exclu par la garde
        L('Le fond:', { y: 767 }),
        L('Rang 1 : 8 ms dans une maille coulée.', { y: 754 }),
        L('Rang 2 : 3 ms dans chaque maille.', { y: 741 }),
        L('Rang 3 : continuer en spirale.', { y: 728 }),
      ]
      const secs = segmentSections([page0, page1])
      expect(secs.map((s) => s.title)).toEqual([
        'Intro',
        'Panier 15 x 15 x H 9 cm',
        'Panier 18 x 18 x H 10 cm',
      ])
      expect(secs[1].lines.map((l) => l.text)).toEqual([
        'Le fond:',
        'Rang 1 : 6 ms dans une maille coulée.',
        'Rang 2 : 2 ms dans chaque maille.',
        'Rang 3 : serrer le fil.',
        'Rang 4 : continuer tout droit.',
      ])
      expect(secs[2].lines.map((l) => l.text)).toEqual([
        'Le fond:',
        'Rang 1 : 8 ms dans une maille coulée.',
        'Rang 2 : 3 ms dans chaque maille.',
        'Rang 3 : continuer en spirale.',
      ])
    })
    it('(e) une étiquette faible d’un kind référence (« Matériel: ») n’est jamais absorbée par la garde', () => {
      const page1 = [
        L('Panier 15 x 15 x H 9 cm', { size: 14, y: 900 }),
        L('Matériel:', { y: 873 }),
        L('Fil Cosy, 150 g', { y: 860 }),
        L('Crochet 4 mm', { y: 847 }),
      ]
      const secs = segmentSections([page0, page1])
      const mat = secs.find((s) => s.title === 'Matériel')
      expect(mat).toBeTruthy()
      expect(mat.ref).toBe('materiel')
      expect(mat.lines.map((l) => l.text)).toEqual(['Fil Cosy, 150 g', 'Crochet 4 mm'])
    })
  })
})

// PDF réel Mia Cardigan (P2-11) : « Button Band » sortait {buttonhole} (attendu
// {border}), « Finish » et « PATTERN » sortaient {other} (attendu {finishing}/{motif}), et
// les 14 sections d'empiècement variant par taille (« Sizes 2 and 5 only: ») sortaient
// {other} au lieu d'hériter {body} de la section « Yoke » qui les précède. Noms de kind
// RÉELS du moteur (relevé src/utils/pdf-import/segment.js + src/utils/pattern-md/dialect.js,
// avant d'écrire ce test) : bordure→border, finitions→finishing, motif→motif, corps→body,
// autre→other, pelote→(pas de balise, kind par défaut).
describe('kindForTitle — libelles anglais manquants (Mia Cardigan)', () => {
  it('« Button Band » est une bordure', () => {
    expect(kindForTitle('Button Band')).toBe('bordure')
  })

  it('« Finish » est une finition', () => {
    expect(kindForTitle('Finish')).toBe('finitions')
  })

  it('« PATTERN » est un motif', () => {
    expect(kindForTitle('PATTERN')).toBe('motif')
  })

  // Garde anti-régression (point 4) : « pattern »/« finish » sont des mots
  // anglais très fréquents EN MILIEU DE PHRASE — l'ancrage doit rester sur le titre
  // ENTIER, jamais une frontière de mot nue, sinon des phrases de travail basculeraient
  // à tort.
  it('« finish »/« pattern » en milieu de phrase de travail ne bascule pas le kind', () => {
    expect(kindForTitle('Work in the already established pattern until piece measures 10 cm')).not.toBe('motif')
    expect(kindForTitle('Finish the row with k2tog')).not.toBe('finitions')
  })
})

describe('variante par taille — herite du type de la section precedente', () => {
  const L = (text, o = {}) => ({ text, size: 11, bold: false, y: 0, ...o })

  it('« Sizes 2 and 5 only: » sous un empiecement reste un empiecement', () => {
    const secs = segmentSections([[
      L('Yoke', { bold: true, size: 13 }),
      L('Cast on 99 sts on a 4mm circular needle.'),
      L('Sizes 2 and 5 only:', { bold: true, size: 13 }),
      L('Row 1 (WS): P1, slip M8, k1, p3, k1.'),
    ]])
    const yoke = secs.find((s) => s.title.trim() === 'Yoke')
    const variante = secs.find((s) => s.title.trim().startsWith('Sizes 2 and 5 only'))
    expect(variante).toBeTruthy()
    expect(variante.kind).toBe(yoke.kind)
    expect(yoke.kind).toBe('corps')
    // Garde : jamais un type non-travail, sinon les rangs cessent d’etre cochables.
    expect(variante.kind).not.toBe('pelote')
  })

  // Garde du point 3 : « echantillon » est le SEUL kind qui soit a la
  // fois un vrai kind de travail (isKind renvoie true) ET un ref (REF_KEYS), donc le
  // seul cas ou `prev.kind === 'pelote'` ne suffit PAS a bloquer une section de
  // reference — seul le garde `prev.ref` le fait. Sans lui, la variante heriterait
  // {echantillon} d'un bloc Echantillon qui la precede, au lieu de rester {autre}.
  it('n’herite pas du kind d’une section de reference (Echantillon), meme si son kind est un vrai kind de travail', () => {
    const secs = segmentSections([[
      L('ÉCHANTILLON', { bold: true, size: 13 }),
      L('20 m x 28 rangs = 10 cm en jersey'),
      L('Sizes 2 and 5 only:', { bold: true, size: 13 }),
      L('Row 1 (WS): P1, slip M8, k1, p3, k1.'),
    ]])
    const echantillon = secs.find((s) => s.title.trim() === 'ÉCHANTILLON')
    const variante = secs.find((s) => s.title.trim().startsWith('Sizes 2 and 5 only'))
    expect(echantillon.ref).toBe('echantillon')
    expect(variante).toBeTruthy()
    expect(variante.kind).not.toBe('echantillon')
  })
})

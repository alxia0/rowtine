import { describe, it, expect } from 'vitest'
import { isSpacedTitle, segmentSections } from '@/utils/pdf-import/segment'

// Lignes REELLES de Mia Cardigan (English) v1.1. modalGap = 13 (interligne mesure),
// gap de paragraphe mesure entre 26,6 et 28,1.
const L = (text, o = {}) => ({ text, size: 11, bold: false, y: 0, ...o })
const SUITE = L('Now work back and forth in stockinette stitch over the front')
const MODAL = 13

describe('isSpacedTitle — point final sur un titre tres court', () => {
  it('temoin de reference : « All sizes » SANS point est deja un titre', () => {
    expect(isSpacedTitle(L('All sizes'), 26.6, MODAL, SUITE, MODAL)).toBe(true)
  })

  it('« All sizes. » AVEC point devient un titre', () => {
    expect(isSpacedTitle(L('All sizes.'), 26.6, MODAL, SUITE, MODAL)).toBe(true)
  })

  it('une vraie phrase courte reste du texte', () => {
    expect(isSpacedTitle(L('Break the yarn.'), 26.6, MODAL, SUITE, MODAL)).toBe(false)
    expect(isSpacedTitle(L('Weave in all ends.'), 26.6, MODAL, SUITE, MODAL)).toBe(false)
  })

  it('une phrase longue a point final reste du texte', () => {
    expect(isSpacedTitle(
      L('Bind off using your preferred bind-off technique.'), 26.6, MODAL, SUITE, MODAL,
    )).toBe(false)
  })

  it('un total de mailles a point final reste du texte', () => {
    expect(isSpacedTitle(L('There are 197 sts.'), 26.6, MODAL, SUITE, MODAL)).toBe(false)
  })

  // Garde isSizeLabelDot (segment.js, ~ligne 469) : le point final n'est tolere QUE sur
  // une etiquette SANS verbe d'action en tete (ACTION_LEAD_RE). Les 2 temoins existants
  // ci-dessus (« Break the yarn. », « Weave in all ends. ») echouent deja sur SIZE_WORD_RE
  // (aucun mot de taille) — ils ne verrouillent donc PAS ce garde. Ces 2 lignes portent a
  // la fois un verbe d'action (« Change », « Work ») ET un mot de taille (« sizes ») :
  // seul ACTION_LEAD_RE les retient hors de l'exception shortLabelDot.
  it('une consigne a verbe d’action ET mot de taille reste du texte (garde ACTION_LEAD_RE)', () => {
    expect(isSpacedTitle(L('Change sizes.'), 26.6, MODAL, SUITE, MODAL)).toBe(false)
    expect(isSpacedTitle(L('Work all sizes.'), 26.6, MODAL, SUITE, MODAL)).toBe(false)
  })
})

describe('isSpacedTitle — tete de colonne (aucun blanc mesurable avant)', () => {
  it('temoin de reference : « Size 4 only: » (3 mots) est deja un titre', () => {
    expect(isSpacedTitle(L('Size 4 only:'), null, MODAL, SUITE, MODAL)).toBe(true)
  })

  it('« Sizes 2 and 5 only: » (5 mots) devient un titre', () => {
    expect(isSpacedTitle(L('Sizes 2 and 5 only:'), null, MODAL, SUITE, MODAL)).toBe(true)
  })

  it('« Sizes 8, 9, 10, and 11 only: » (7 mots) devient un titre', () => {
    expect(isSpacedTitle(L('Sizes 8, 9, 10, and 11 only:'), null, MODAL, SUITE, MODAL)).toBe(true)
  })

  it('une phrase longue en tete de colonne reste du texte', () => {
    expect(isSpacedTitle(
      L('Now work back and forth in stockinette stitch over the front and back'),
      null, MODAL, SUITE, MODAL,
    )).toBe(false)
  })
})

// Cas reel lucent-sweater-en (banc, patron a 9 tailles reparties en 1 taille nue +
// 2 groupes de 4 : XS (S, M, L, XL) (2XL, 3XL, 4XL, 5XL)). Deux etiquettes JUMELLES de la
// meme construction, l'une avec la taille nue retenue (« Sizes XS (...) only: »), l'autre
// avec la taille nue EXCLUE et donc remplacee par un tiret (« Sizes - (...) only: ») —
// jumelles au sens structurel (meme contexte : juste apres un « Rows N-M: ... » dans le
// corps BACK+FRONT), mais de longueur textuelle differente selon la longueur des codes de
// taille qu'elles enumerent. Avant le correctif, le plafond generique (42 caracteres)
// promouvait la forme courte (41/42 caracteres) en section H2 autonome tout en laissant la
// forme longue (44/45 caracteres) en simple annotation dans la section courante — deux
// traitements incoherents pour la meme construction. gap != null (paragraphe en milieu de
// page, contrairement au bloc « tete de colonne » ci-dessus) : c'est la branche reellement
// empruntee par ces etiquettes dans le PDF reel (pas en tete de page/colonne).
describe('isSpacedTitle — etiquette « Sizes ... only: » a 9 tailles (lucent-sweater-en, plafond de longueur)', () => {
  it('la forme courte (taille nue EXCLUE, tiret) est deja un titre avant le correctif', () => {
    expect(isSpacedTitle(
      L('Sizes - (S, M, L, XL) (-, 3XL, -, -) only:'), 26.6, MODAL, SUITE, MODAL,
    )).toBe(true)
  })

  it('la forme jumelle plus longue (taille nue XS retenue) devient AUSSI un titre (regression corrigee)', () => {
    expect(isSpacedTitle(
      L('Sizes XS (-, -, -, -) (2XL, -, 4XL, 5XL) only:'), 26.6, MODAL, SUITE, MODAL,
    )).toBe(true)
  })

  it('la seconde paire du meme document (row 9, chart) est traitee de la meme facon', () => {
    expect(isSpacedTitle(
      L('Sizes - (-, M, L, -) (-, 3XL, 4XL, -) only:'), 26.6, MODAL, SUITE, MODAL,
    )).toBe(true)
    expect(isSpacedTitle(
      L('Sizes XS (S, -, -, XL) (2XL, -, -, 5XL) only:'), 26.6, MODAL, SUITE, MODAL,
    )).toBe(true)
  })

  // Negatif discriminant : le plafond relache (65) reste BORNE — une vraie phrase de prose,
  // meme si elle commence par un mot de taille suivi de « only » plus loin (collision
  // lexicale), ne doit pas devenir un titre simplement parce qu'elle est sous ce plafond.
  it('non-regression : une phrase de prose sous le plafond relache reste du texte', () => {
    expect(isSpacedTitle(
      L('Sizes vary quite a bit across brands, so only trust your own gauge swatch here.'),
      26.6, MODAL, SUITE, MODAL,
    )).toBe(false)
  })

  // Negatif discriminant : sans le « : » final, sizeVariantLead ne s’arme pas — la ligne
  // retombe sur le plafond generique (42) et une etiquette qui le depasse reste du texte,
  // exactement comme avant le correctif. Prouve que la relaxation est bien restreinte au
  // deux-points, pas une exception generale au motif « Sizes ... only ».
  it('non-regression : sans « : » final, le plafond generique (42) s’applique toujours', () => {
    expect(isSpacedTitle(
      L('Sizes XS (-, -, -, -) (2XL, -, 4XL, 5XL) only'), 26.6, MODAL, SUITE, MODAL,
    )).toBe(false)
  })

  // Revue (Important 1) : le relachement ne valait QUE pour la branche generale
  // (gap != null, paragraphe en milieu de page). La branche « tete de colonne/page »
  // (gap == null) porte son PROPRE plafond de repli (l.837 et suivantes de segment.js), non
  // relache par le premier correctif — memes deux etiquettes JUMELLES, MEME incoherence
  // reapparue sous gap == null. Les etiquettes reelles de lucent-sweater-en sont toutes en
  // gap != null (verifie par le fix precedent), donc ce chemin n'etait pas expose sur CE
  // PDF — mais rien ne garantit qu'un futur PDF du corpus ne place pas la meme construction
  // en tete de page/colonne, d'ou ce test dedie.
  it('la meme incoherence existait sous gap == null (tete de colonne) — corrigee aussi', () => {
    expect(isSpacedTitle(
      L('Sizes - (S, M, L, XL) (-, 3XL, -, -) only:'), null, MODAL, SUITE, MODAL,
    )).toBe(true)
    expect(isSpacedTitle(
      L('Sizes XS (-, -, -, -) (2XL, -, 4XL, 5XL) only:'), null, MODAL, SUITE, MODAL,
    )).toBe(true)
  })

  // Revue (Important 2) : negatif discriminant reel — une phrase de PROSE qui contient
  // incidemment le vocabulaire « Sizes ... only » ET se termine par « : » ET tombe DANS la
  // fenetre relachee (43-65 caracteres) matchait encore SIZE_VARIANT_TITLE_RE avant l'ajout
  // de SIZE_VARIANT_GROUP_RE — seule l'heuristique de blanc (1,7×modalGap) s'y opposait,
  // insuffisante seule puisqu'un vrai blanc precede n'importe quel nouveau paragraphe (d'ou
  // gap=26.6 ici, un vrai blanc de paragraphe mesure, pas une fixture degeneree). Sans un
  // vrai groupe parenthese de codes de taille courts dans la ligne, elle est promue a tort.
  it('non-regression : une phrase de prose avec un vrai blanc de paragraphe et un « : » final reste du texte (pas de groupe de tailles)', () => {
    expect(isSpacedTitle(
      L('Sizes for this pattern are only approximate:'), 26.6, MODAL, SUITE, MODAL,
    )).toBe(false)
  })
})

describe('segmentSections — un titre de tete de colonne (Tache 4) immediatement suivi d’un vrai titre ne se perd pas', () => {
  // Cas reel corpus (knit-baby-hat-cotton-fr-9ffabfc0, regression trouvee au banc corpus
  // 3234 PDF de la Tache 4) : le bandeau de vente croisee « Obtenez votre fil et vos
  // accessoires ici: » (40 caracteres, finit par « : », gap == null car meme tete de
  // colonne) est desormais promu par la branche elargie de la Tache 4. Mais la ligne
  // SUIVANTE, « Abreviations », est elle-meme un VRAI titre (gras) : la section ouverte
  // par le bandeau serait donc a 0 ligne, jetee EN SILENCE par mergeEmptyTitledSections
  // (assemble.js) faute de parenthese rescapable (isRescuableTitle) — le bandeau
  // disparaissait purement et simplement (perte de contenu mesuree : MD_LINES 89 -> 87).
  it('un titre en tete de colonne fini par « : » suivi d’un titre fort ne s’ouvre pas et son texte survit', () => {
    const pages = [[
      L('Matériel', { bold: true, size: 13, y: 900 }),
      L('50 (50) 50 g Hobbii Rainbow', { y: 887 }),
      L('Pompon- 10 cm', { y: 874 }),
      L('Obtenez votre fil et vos accessoires ici:', { y: 0 }),
      L('Abréviations', { bold: true, size: 13, y: 0 }),
      L('m: maille', { y: 0 }),
    ]]
    const secs = segmentSections(pages)
    // Le bandeau ne doit jamais former sa propre section (elle serait vide, jetee en
    // silence) : aucune section ne porte ce titre.
    expect(secs.find((s) => s.title.trim() === 'Obtenez votre fil et vos accessoires ici')).toBeFalsy()
    // Ne jamais perdre l'info : le texte verbatim du bandeau doit survivre quelque part.
    const allText = secs.flatMap((s) => s.lines.map((l) => l.text)).join('\n')
    expect(allText).toContain('Obtenez votre fil et vos accessoires ici:')
    // « Abréviations » doit rester un vrai titre, avec son contenu.
    const abbr = secs.find((s) => s.title.trim() === 'Abréviations')
    expect(abbr).toBeTruthy()
    expect(abbr.lines.map((l) => l.text)).toEqual(['m: maille'])
  })
})

describe('segmentSections — curRescuableIfEmptied protege une vraie rubrique de reference', () => {
  // Cas reel corpus (flamingo-love-blanket-de-f1f48ccf, regression trouvee au banc corpus
  // 3234 PDF de la Tache 4, tour 3) : une simple liste de coloris de fil en tete de page
  // (« Sunflower (#36) - 1 Knäuel ») est classee `strongTitle` par isTitleLine (gras)
  // SANS etre un vrai titre — kindForTitle n'y reconnait aucun mot-cle (kind=null). Si
  // cette section fantome est protegee contre le vidage au meme titre qu'une VRAIE section
  // (cf. « Body »/« Sleeves » ci-dessous), le VRAI titre de glossaire qui suit
  // (« Abréviations: », lui aussi en tete de colonne) ne peut plus s'ouvrir : ses
  // entrees (212 dans le PDF reel) se retrouvent avalees sous le faux titre. Ce temoin
  // verifie que curRescuableIfEmptied distingue les deux cas : la fausse section (kind
  // null) ne doit PAS etre protegee, la vraie rubrique Abreviations doit s'ouvrir et
  // garder ses entrees. Coordonnees Y : « Sunflower... » et « Abreviations: » PARTAGENT
  // la meme ordonnee (900) pour reproduire gap == null (tete de colonne, aucun blanc
  // mesurable), comme dans le PDF reel — les entrees qui suivent portent un pas de 13 pour
  // rester coherentes avec le reste du fichier, meme si cette branche d'isSpacedTitle
  // (plafond etroit, court titre) ne depend pas du modalGap.
  it('une fausse section sans kind ne bloque pas la vraie rubrique Abreviations qui suit', () => {
    const page0 = [L('Intro', { bold: true, size: 13, y: 900 })]
    const page1 = [
      L('Sunflower (#36) - 1 Knäuel', { bold: true, size: 13, y: 900 }),
      L('Abréviations:', { y: 900 }),
      L('m: maille', { y: 887 }),
      L('end: endroit', { y: 874 }),
      L('env: envers', { y: 861 }),
    ]
    const secs = segmentSections([page0, page1])
    const abbr = secs.find((s) => s.title.trim() === 'Abréviations')
    expect(abbr).toBeTruthy()
    expect(abbr.lines.length).toBeGreaterThan(0)
    expect(abbr.lines.map((l) => l.text)).toEqual([
      'm: maille',
      'end: endroit',
      'env: envers',
    ])
  })
})

describe('segmentSections — emptiesPrecedingSection (garde emptiesPrecedingSection)', () => {
  // Cas reel Mia Cardigan (section Yoke) : le titre « Body » n'a qu'UNE seule ligne de
  // contenu, « All sizes. » — la promouvoir en titre laisserait « Body » a 0 ligne, que
  // mergeEmptyTitledSections (assemble.js) jette alors en silence faute de parenthese
  // rescapable (isRescuableTitle). Coordonnees Y reelles pour que le gap de paragraphe
  // (26,6, mesure) et le modalGap (13, interligne mesure) soient calcules par
  // modalLineGap/gaps comme dans le moteur, pas des valeurs a 0 qui desarmeraient
  // isSpacedTitle en amont (gap == null).
  //
  // Deux pieges trouves en construisant ce temoin (a documenter pour la prochaine fois
  // qu'un temoin segmentSections est ecrit) :
  //  1. modalLineGap balaie TOUTES les pages. Une seule page avec « Body »/« All sizes. »
  //     en tete produit UN SEUL echantillon de petit gap (13) contre un de grand gap (27,
  //     le paragraphe avant « All sizes. ») — a effectif egal, modalLineGap garde le
  //     PREMIER rencontre (pas de departage), qui peut devenir le grand gap et desarmer
  //     isSpacedTitle (gap >= 1,7×modalGap echoue). Il faut assez de lignes de contenu
  //     APRES pour que le petit gap (13) domine clairement en effectif.
  //  2. Une mini-section (<=4 lignes, kind inconnu, pas tout-caps) EN PAGE 0 est
  //     retrogradee dans la section precedente par un mecanisme SEPARE (rescapage des
  //     etiquettes de boite, plus bas dans segmentSections) — meme AVEC emptiesPrecedingSection
  //     desarme, cet autre mecanisme masque le defaut en repliant quand meme « All sizes »
  //     dans « Body ». D'ou les 2 pages ci-dessous : « Body » sur la page 1 (pas 0) evite
  //     ce chemin parasite et isole vraiment le garde teste.
  it('promouvoir « All sizes. » ne vide pas la section qui precede', () => {
    const page0 = [
      L('Intro', { bold: true, size: 13, y: 900 }),
    ]
    const page1 = [
      L('Body', { bold: true, size: 13, y: 900 }),
      L('All sizes.', { y: 873.4 }),
      L('Work back and forth in stockinette stitch over the front and back.', { y: 860.4 }),
      L('and in the broken rib textured pattern down each side of the.', { y: 847.4 }),
      L('third filler line here for padding purposes only please.', { y: 834.4 }),
      L('fourth filler line here for padding purposes only too please.', { y: 821.4 }),
    ]
    const secs = segmentSections([page0, page1])
    const body = secs.find((s) => s.title.trim() === 'Body')
    expect(body).toBeTruthy()
    expect(body.lines.length).toBeGreaterThan(0)
  })
})

describe('segmentSections — point final retire du titre promu (garde segment.js ~ligne 825)', () => {
  // Meme etiquette « All sizes. » que ci-dessus, mais PAS en toute premiere ligne de
  // « Body » cette fois (une ligne de consigne l'y precede) : emptiesPrecedingSection ne
  // s'arme donc pas, « All sizes. » est promue en SECTION A PART ENTIERE — c'est ce
  // chemin-la, et lui seul, qui passe par le retrait du point final (cur.title =
  // line.text...replace(/\s*\.\s*$/, '')). Sans ce retrait, le titre promu reste
  // « All sizes. » (point compris) au lieu de « All sizes » (ideal mesure).
  it('« All sizes. » promue en section garde son titre SANS le point final', () => {
    const page0 = [L('Intro', { bold: true, size: 13, y: 900 })]
    const page1 = [
      L('Body', { bold: true, size: 13, y: 900 }),
      L('Work in stockinette until piece measures desired length here now.', { y: 887 }),
      L('All sizes.', { y: 860.4 }),
      L('Work back and forth in stockinette stitch over the front and back.', { y: 847.4 }),
      L('and in the broken rib textured pattern down each side of the.', { y: 834.4 }),
      L('third filler line here for padding purposes only please.', { y: 821.4 }),
      L('fourth filler line here for padding purposes only too please.', { y: 808.4 }),
    ]
    const secs = segmentSections([page0, page1])
    expect(secs.map((s) => s.title.trim())).toEqual(['Intro', 'Body', 'All sizes'])
  })
})

describe('isSpacedTitle — phrase de transition', () => {
  it('« Decrease rounds are worked as follows » reste du texte', () => {
    expect(isSpacedTitle(
      L('Decrease rounds are worked as follows'), 27.8, MODAL, SUITE, MODAL,
    )).toBe(false)
  })

  it('un vrai titre court reste un titre', () => {
    expect(isSpacedTitle(L('Button Band'), 27.8, MODAL, SUITE, MODAL)).toBe(true)
    expect(isSpacedTitle(L('Sleeves'), 27.8, MODAL, SUITE, MODAL)).toBe(true)
    expect(isSpacedTitle(L('Buttonholes'), 27.8, MODAL, SUITE, MODAL)).toBe(true)
  })
})

describe('segmentSections — une annonce de couleur de fil ne vide pas le vrai titre de pièce (gingerbread-doll-en-68a5ddbc)', () => {
  // Cas reel corpus (gingerbread-doll-en-68a5ddbc, 27/08) : le PDF porte
  // systematiquement un titre de piece gras/grande police (« Head », « Cheeks (Make 2) »,
  // « Hood », « Bow ») suivi IMMEDIATEMENT d'une ligne d'annonce de couleur (« In nude »,
  // « In pink yarn », « In brown », « In pastel mint ») sur une seule ligne, sans aucun rang
  // entre les deux. Le blanc de paragraphe avant l'annonce de couleur (mesure ~27-30 sur ce
  // PDF reel, modalGap ~14) depasse le seuil 1,7×modalGap d'isSpacedTitle : l'annonce de
  // couleur etait promue a tort en titre, videant la vraie section (« Head » a 0 ligne),
  // jetee en silence par mergeEmptyTitledSections (aucune parenthese rescapable). Reproduit
  // ici avec « Head »/« In nude », le cas le plus simple des quatre.
  it('« In nude » reste une ligne de « Head », jamais un titre a part', () => {
    const page0 = [L('Intro', { bold: true, size: 13, y: 900 })]
    const page1 = [
      L('Head', { bold: true, size: 13, y: 900 }),
      L('In nude', { y: 873 }),
      L('Start with a magic ring.', { y: 860 }),
      L('R 1: 6 sc in the magic ring (6)', { y: 847 }),
      L('R 2: [1 inc] x6 (12)', { y: 834 }),
      L('R 3: [1 sc, 1 inc] x6 (18)', { y: 821 }),
    ]
    const secs = segmentSections([page0, page1])
    const head = secs.find((s) => s.title.trim() === 'Head')
    expect(head).toBeTruthy()
    expect(head.lines.map((l) => l.text)).toEqual([
      'In nude',
      'Start with a magic ring.',
      'R 1: 6 sc in the magic ring (6)',
      'R 2: [1 inc] x6 (12)',
      'R 3: [1 sc, 1 inc] x6 (18)',
    ])
    expect(secs.find((s) => s.title.trim() === 'In nude')).toBeFalsy()
  })

  // Variante avec un titre de piece a parenthese (« Cheeks (Make 2) ») dont l'annonce de
  // couleur porte en plus le mot « yarn » (« In pink yarn ») : sans le garde, cette ligne
  // ouvrait a tort une section referee « fil » (isFilKeywordCollision, cf. kindForTitle),
  // puis la soupape ROW_START_RE (segment.js, section abbr/materiel/echantillon/fil) la
  // remplacait au premier rang venu par un titre generique « Instructions » — perte du
  // titre ET de l'annonce de couleur, pas seulement une promotion a tort.
  it('« In pink yarn » reste une ligne de « Cheeks (Make 2) », jamais une section « fil » ni « Instructions »', () => {
    const page0 = [L('Intro', { bold: true, size: 13, y: 900 })]
    const page1 = [
      L('Cheeks (Make 2)', { bold: true, size: 13, y: 900 }),
      L('In pink yarn', { y: 873 }),
      L('Start with a magic ring.', { y: 860 }),
      L('R 1: 6 sc in the ring (6)', { y: 847 }),
      L('Finish with 1 sl st in the first sc.', { y: 834 }),
      L('Weave in ends and leave a long tail for attaching.', { y: 821 }),
    ]
    const secs = segmentSections([page0, page1])
    const cheeks = secs.find((s) => s.title.trim() === 'Cheeks (Make 2)')
    expect(cheeks).toBeTruthy()
    expect(cheeks.ref).toBeFalsy()
    expect(cheeks.lines.map((l) => l.text)).toEqual([
      'In pink yarn',
      'Start with a magic ring.',
      'R 1: 6 sc in the ring (6)',
      'Finish with 1 sl st in the first sc.',
      'Weave in ends and leave a long tail for attaching.',
    ])
    expect(secs.find((s) => s.title.trim() === 'In pink yarn')).toBeFalsy()
    expect(secs.find((s) => s.title.trim() === 'Instructions')).toBeFalsy()
  })

  // 3e variante (revue de code, chemin b) : un titre de piece a parenthese ET a mot-cle
  // RECONNU par kindForTitle (« Arms (Make 2) » -> kind 'membre'), suivi d'une annonce de
  // couleur SANS collision « fil » (« In white », pas « yarn »). Avant le garde, ce cas
  // n'etait pas jete en silence (parenthese + kind reconnu = isRescuableTitle, cf.
  // assemble.js) mais rescape en simple note fusionnee dans la section SUIVANTE — deux
  // pieces differentes (ex. « Head » et « Arms (Make 2) », toutes deux en « In nude »)
  // devenaient alors indiscernables dans la liste des sections (meme titre de heading).
  // Ce temoin verifie que le garde couvre aussi CE chemin : « Arms (Make 2) » reste son
  // propre titre de section, avec « In white » en 1ere ligne de contenu — jamais videe ni
  // fusionnee dans une section voisine.
  it('« In white » reste une ligne de « Arms (Make 2) » (titre a parenthese et kind reconnu), jamais une note fusionnee ailleurs', () => {
    const page0 = [L('Intro', { bold: true, size: 13, y: 900 })]
    const page1 = [
      L('Arms (Make 2)', { bold: true, size: 13, y: 900 }),
      L('In white', { y: 873 }),
      L('Start with a magic ring.', { y: 860 }),
      L('R 1: 6 sc in the magic ring (6)', { y: 847 }),
      L('R 2-3: 6 sc (2 rounds, 6)', { y: 834 }),
      L('Weave in ends and leave a long tail for sewing on the arms.', { y: 821 }),
    ]
    const secs = segmentSections([page0, page1])
    const arms = secs.find((s) => s.title.trim() === 'Arms (Make 2)')
    expect(arms).toBeTruthy()
    expect(arms.lines.map((l) => l.text)).toEqual([
      'In white',
      'Start with a magic ring.',
      'R 1: 6 sc in the magic ring (6)',
      'R 2-3: 6 sc (2 rounds, 6)',
      'Weave in ends and leave a long tail for sewing on the arms.',
    ])
    expect(secs.find((s) => s.title.trim() === 'In white')).toBeFalsy()
    // Aucune note de secours « **Arms (Make 2)** » ne doit fuiter ailleurs (mergeEmptyTitledSections,
    // assemble.js, ne s'en mele meme pas : la section n'est jamais vide a ce stade).
    const allText = secs.flatMap((s) => s.lines.map((l) => l.text)).join('\n')
    expect(allText).not.toContain('**Arms (Make 2)**')
  })
})

describe('isSpacedTitle — tête de page, titre à tête MAJUSCULE suivi d’une précision entre parenthèses (capsLead)', () => {
  // Cas réel corpus (peacock-shawl-in-kid-silk-en-56e7da11, 27/08) : « PEACOCK
  // PATTERN (aka wave pattern) » ouvre la page 3 du PDF, bold=false et de la MÊME taille
  // que le corps (isTitleLine la rejette donc aussi) — seul ce repli par espacement peut
  // la promouvoir. gap=null (toute première ligne d'une page, aucun blanc mesurable) :
  // AVANT correctif, la branche « tête de colonne/page » plafonnait à 32 caractères ET
  // 4 mots SANS jamais consulter capsLead (contrairement à la branche générale, qui
  // relâche déjà ce plafond à 70 caractères pour un titre à tête MAJUSCULE) — 34
  // caractères et 5 mots la faisaient échouer, et la définition du point (4 rangs)
  // tombait comme simple contenu de la section précédente au lieu d'ouvrir la sienne.
  it('« PEACOCK PATTERN (aka wave pattern) » (34 car., 5 mots) devient un titre en tête de page', () => {
    expect(isSpacedTitle(L('PEACOCK PATTERN (aka wave pattern)'), null, MODAL, SUITE, MODAL)).toBe(true)
  })

  // Témoin de non-régression : SANS le signal capsLead (pas de tête d'au moins 4
  // majuscules consécutives), le plafond étroit (32 caractères / 4 mots) reste
  // inchangé — une phrase ordinaire à majuscule initiale simple, même de longueur et
  // de nombre de mots comparables, ne doit toujours pas être promue en tête de page.
  it('sans capsLead, une phrase comparable (majuscule simple en tête) reste du texte', () => {
    expect(isSpacedTitle(L('Continue working in the pattern as set'), null, MODAL, SUITE, MODAL)).toBe(false)
  })
})

describe('segmentSections — un titre en tête de page (capsLead) ne se fait plus avaler par le bandeau qui précède (peacock-shawl-in-kid-silk-en-56e7da11)', () => {
  // Reproduction resserrée du PDF réel : « Hashtags for social media » (vrai titre de
  // bruit de page, grande police 14 contre un corps à 11) ouvre la fin de la page 2,
  // suivi du bandeau de hashtags. La définition du point « PEACOCK PATTERN (aka wave
  // pattern) » et ses 4 rangs ouvrent la page 3 SUIVANTE (gap=null, cf. ci-dessus).
  // AVANT correctif : faute de titre reconnu, ces 4 rangs tombaient comme simple
  // contenu de la section « Hashtags for social media » au lieu d'ouvrir leur propre
  // section — perte de la structure la plus utile du patron (bloquant, retour banc).
  const page0 = [L('Intro', { bold: true, size: 13, y: 900 })]
  const page1 = [
    L('Hashtags for social media', { size: 14, y: 900 }),
    L('#hobbiidesign #hobbiipeacockshawl', { y: 887 }),
  ]
  const page2 = [
    L('PEACOCK PATTERN (aka wave pattern)', { y: 900 }),
    L('Row 1: k all st', { y: 882 }),
    L('Row 2: p all st', { y: 864 }),
    L('Row 3: some pattern instruction here today.', { y: 846 }),
    L('Row 4: k all st', { y: 828 }),
  ]

  it('« PEACOCK PATTERN (aka wave pattern) » ouvre sa propre section, avec ses 4 rangs', () => {
    const secs = segmentSections([page0, page1, page2])
    const peacock = secs.find((s) => s.title.trim() === 'PEACOCK PATTERN (aka wave pattern)')
    expect(peacock).toBeTruthy()
    expect(peacock.lines.map((l) => l.text)).toEqual([
      'Row 1: k all st',
      'Row 2: p all st',
      'Row 3: some pattern instruction here today.',
      'Row 4: k all st',
    ])
    const hashtags = secs.find((s) => s.title.trim() === 'Hashtags for social media')
    expect(hashtags).toBeTruthy()
    expect(hashtags.lines.map((l) => l.text)).not.toContain('Row 1: k all st')
  })
})

describe('isSpacedTitle — phrase de titre en tête de page démarrant par un mot-clé générique d’instructions (bug1, knit-dishcloth-basket-stitch-de-3163a83e)', () => {
  it('« Anleitung – Siehe … : » (73 caractères) devient un titre malgré sa longueur', () => {
    expect(isSpacedTitle(
      L('Anleitung – Siehe Beschreibung mit Bildern weiter unten in der Anleitung:'),
      null, MODAL, SUITE, MODAL,
    )).toBe(true)
  })

  // Non discriminant en soi (cette phrase dépassait déjà le plafond de 42 caractères
  // avant ce correctif — elle échouait donc pour la même raison sans lui) : garde de
  // NON-EXTENSION du périmètre, pour prouver que le relâchement du plafond reste bien
  // réservé au mot-clé générique et ne s'étend pas à toute phrase longue en tête de page.
  it('une phrase longue en tête de page qui ne démarre PAS par ce mot-clé reste du texte', () => {
    expect(isSpacedTitle(
      L('Nun mit den Nadeln in dieser Reihenfolge weiterstricken bis zum Ende:'),
      null, MODAL, SUITE, MODAL,
    )).toBe(false)
  })

  it('« Anleitung » sans « : » final reste du texte (le repli exige la ponctuation d’étiquette)', () => {
    expect(isSpacedTitle(
      L('Anleitung – Siehe Beschreibung mit Bildern weiter unten in der Anleitung'),
      null, MODAL, SUITE, MODAL,
    )).toBe(false)
  })
})

describe('isSpacedTitle — formule de politesse finale allemande jamais promue en titre (bug2, knit-dishcloth-basket-stitch-de-3163a83e)', () => {
  it('« Viel Spass☺ » précédée d’un grand blanc reste du texte', () => {
    expect(isSpacedTitle(L('Viel Spass☺'), 58, MODAL, SUITE, MODAL)).toBe(false)
  })

  // Témoin discriminant (revue) : SANS ponctuation finale, pour prouver que
  // c'est bien isClosingFormula qui bloque la promotion — pas SENTENCE_END_RE, qui aurait
  // déjà rejeté un témoin finissant par « ! » (comme « Viel Spaß beim Stricken! », cité
  // dans actionable-prose.js) sans jamais passer par ce garde. Cette même phrase (« Viel
  // Spaß… », orthographe allemande avec « ß ») a aussi servi à découvrir un bug réel dans
  // CLOSING_FORMULA_RE : son « \b » final ne matche jamais juste après un « ß » (non
  // reconnu comme caractère de mot par \b en JS sans portée Unicode) suivi d'un espace —
  // l'orthographe allemande ne déclenchait donc JAMAIS ce garde avant sa réécriture en
  // « (?!\p{L}) ».
  it('« Viel Spaß beim Stricken » (orthographe allemande, SANS ponctuation finale) reste du texte', () => {
    expect(isSpacedTitle(L('Viel Spaß beim Stricken'), 58, MODAL, SUITE, MODAL)).toBe(false)
  })

  it('« Viel Spass beim Häkeln » (orthographe suisse, SANS ponctuation finale) reste du texte', () => {
    expect(isSpacedTitle(L('Viel Spass beim Häkeln'), 58, MODAL, SUITE, MODAL)).toBe(false)
  })

  // Garde de précision (négatif) : un titre qui démarre par les mêmes lettres mais PAS le
  // même mot (« Spassig », adjectif allemand courant, pas « Spass »/« Spaß ») n'est PAS une
  // formule de clôture et doit rester promouvable normalement — sinon CLOSING_FORMULA_RE
  // serait un simple préfixe « viel spa », pas le mot-clé mesuré.
  it('« Viel Spassig ist das Muster » (mot différent, pas une formule de clôture) devient un titre', () => {
    expect(isSpacedTitle(L('Viel Spassig ist das Muster'), 58, MODAL, SUITE, MODAL)).toBe(true)
  })
})

describe('segmentSections — le montage et les rangs réels ouvrent leur propre section « Anleitung » au lieu de rester engloutis dans « Randmasche » (bug1, knit-dishcloth-basket-stitch-de-3163a83e)', () => {
  // Reproduction resserrée du PDF réel : « Randmasche: » (définition de glossaire, page 1)
  // est immédiatement suivie, sur la page 2, de la ligne d'instructions réelle « Anleitung
  // – Siehe … : » puis du montage et des rangs 1-12. AVANT correctif, cette ligne dépassait
  // le plafond de longueur d'isSpacedTitle (73 caractères) et restait absorbée par la
  // section « Randmasche » précédente — montage et rangs classés {other} sous un titre de
  // glossaire, jamais cochables comme travail.
  const page0 = [
    L('Randmasche:', { y: 500 }),
    L('1 Umschlag, 1 M li abheben (mit der rechten', { y: 484 }),
    L('Würfelmuster: teilbar durch 8+2 M', { y: 452 }),
  ]
  const page1 = [
    L('Anleitung – Siehe Beschreibung mit Bildern weiter unten in der Anleitung:', { y: 900 }),
    L('66 M anschlagen.', { y: 884 }),
    L('1. Reihe: 1 Randmasche, (4 re, 4 li) im Wechsel bis auf 1 M, 1 re.', { y: 868 }),
  ]

  it('« Anleitung – … » ouvre sa propre section avec le montage et le rang 1', () => {
    const secs = segmentSections([page0, page1], { isGerman: true })
    const anleitung = secs.find((s) =>
      s.title.trim() === 'Anleitung – Siehe Beschreibung mit Bildern weiter unten in der Anleitung',
    )
    expect(anleitung).toBeTruthy()
    expect(anleitung.lines.map((l) => l.text)).toEqual([
      '66 M anschlagen.',
      '1. Reihe: 1 Randmasche, (4 re, 4 li) im Wechsel bis auf 1 M, 1 re.',
    ])
    const randmasche = secs.find((s) => s.title.trim() === 'Randmasche')
    expect(randmasche).toBeTruthy()
    expect(randmasche.lines.map((l) => l.text)).not.toContain('66 M anschlagen.')
  })
})

describe('segmentSections — la formule de politesse finale n’ouvre plus de fausse section et l’étape 4 reste dans « Beschreibung - Abketten » (bug2, knit-dishcloth-basket-stitch-de-3163a83e)', () => {
  // Reproduction resserrée du PDF réel : la formule de clôture « Viel Spass☺ » tombe entre
  // l'étape 3 (TIPP) et l'étape 4 finale du rabattage, avec un grand blanc de paragraphe
  // devant elle (bloc centré en bas de page). AVANT correctif, ce blanc suffisait à la
  // promouvoir en titre de section fantôme « Viel Spass☺ », sous lequel l'étape 4 finale
  // (dernière consigne RÉELLE du patron) se retrouvait égarée.
  const page0 = [
    L('Beschreibung - Abketten:', { y: 900 }),
    L('3. TIPP. Falls die letzte Masche zu locker wird,', { y: 800 }),
    L('kann sie mit der Randmasche der vorigen Reihe zusammengestrickt werden.', { y: 784 }),
    L('Viel Spass☺', { y: 726 }),
    L('4. Die letzte Masche lang ziehen, Faden abschneiden und vernähen.', { y: 600 }),
  ]

  it('aucune section « Viel Spass☺ » ne s’ouvre ; l’étape 4 reste dans « Beschreibung - Abketten »', () => {
    const secs = segmentSections([page0], { isGerman: true })
    expect(secs.find((s) => s.title.trim() === 'Viel Spass☺')).toBeFalsy()
    const abketten = secs.find((s) => s.title.trim() === 'Beschreibung - Abketten')
    expect(abketten).toBeTruthy()
    expect(abketten.lines.map((l) => l.text)).toContain(
      '4. Die letzte Masche lang ziehen, Faden abschneiden und vernähen.',
    )
  })
})

describe('segmentSections — grilles appariées (V2a-T2) : une rangée pairedRow n’est jamais un titre d’espacement', () => {
  // Cas réel loupy p4 (ravelry, corpus-web) : readPairedGrid (T1) rend la grille
  // d'abréviations 2×2 en UN flux « clé1 def1 » puis « clé2 def2 » par rangée Y — la
  // ligne de colonne 2 suit sa jumelle à Y IDENTIQUE, donc gap NUL, donc « tête de
  // colonne » aux yeux d'isSpacedTitle : chaque clé courte de la 2ᵉ colonne (« REP
  // repeat », 11 caractères, 2 mots) était promue en titre de section et le glossaire
  // ENTIER se retrouvait éclaté en sections d'une ligne (« ## REP repeat », « ## St st
  // stockinette stitch »…, mesuré aussi sur mini-kawaii p1 : « ## FLO Front Loops
  // Only ») AVANT que le routage abbr d'assemble.js ne puisse le lire en colonnes. Le
  // flag pairedRow (posé par readPairedGrid et par lui seul) est le signal exact : une
  // rangée de grille n'est jamais un titre « par espacement ». Garde SUPPRESS-ONLY au
  // site d'appel, comme measureLabelFollowedByBareValue voisin (isSpacedTitle ne
  // connaît pas le contexte de la ligne) ; strongTitle reste actif — gras/majuscules/
  // grande police restent des signaux fiables, même sur une rangée de grille.
  const L2 = (text, o = {}) => ({ text, size: 12, bold: false, ...o })
  const rows = [
    ['BLCO backwards loop cast on', 'REP repeat'],
    ['CO cast on', 'Sl slip'],
    ['K knit', 'SM stitch marker'],
    ['K2tog knit two together', 'SSK slip slip knit'],
  ]
  const grid = []
  let y = 719
  for (const [c1, c2] of rows) {
    grid.push(L2(c1, { y, pairedRow: true }))
    grid.push(L2(c2, { y, pairedRow: true }))
    y -= 14.4
  }
  const page = [
    L2('Abbreviations key', { y: 737, size: 24 }),
    ...grid,
    L2('Cast On and Yoke', { y: 487, size: 24 }),
    L2('Row 0 (RSA): Cast on 76 sts, placing SM after 15 sts.', { y: 465 }),
  ]

  // Page d'index 1 (comme loupy p4, page 3 réelle) : la rétrogradation isMiniLabel
  // n'arme sa branche « page de garde » (sec.page === 0) ni BOX_REF (abbr n'en fait pas
  // partie) — c'est bien le garde pairedRow qui doit faire le travail, pas le filet.
  const cover = [L2('Stripey Raglan Cardigan', { y: 900, size: 34 })]

  it('la grille ENTIÈRE (les deux colonnes de clés) reste dans LA section abbr, aucune clé promue en titre', () => {
    const secs = segmentSections([cover, page])
    const abbr = secs.find((s) => s.title.trim() === 'Abbreviations key')
    expect(abbr).toBeTruthy()
    expect(abbr.ref).toBe('abbr')
    expect(abbr.lines.map((l) => l.text)).toEqual(grid.map((l) => l.text))
  })

  it('aucune section fantôme « REP repeat »/« SSK slip slip knit » n’est créée', () => {
    const secs = segmentSections([cover, page])
    expect(secs.some((s) => s.title.trim() === 'REP repeat')).toBe(false)
    expect(secs.some((s) => s.title.trim() === 'SSK slip slip knit')).toBe(false)
    // Le vrai titre qui suit la grille ouvre toujours sa section (rien d'avalé).
    const yoke = secs.find((s) => s.title.trim() === 'Cast On and Yoke')
    expect(yoke).toBeTruthy()
    expect(yoke.lines.map((l) => l.text)).toContain(
      'Row 0 (RSA): Cast on 76 sts, placing SM after 15 sts.',
    )
  })
})

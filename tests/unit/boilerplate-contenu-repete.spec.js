import { describe, it, expect } from 'vitest'
import { stripBoilerplate } from '@/utils/pdf-import/boilerplate'

const textes = (pages) => pages.flat().map((l) => l.text)

// Deux mécanismes distincts de stripBoilerplate peuvent écarter une ligne :
//  1) la répétition « en bande de page » (en-tête/pied) ;
//  2) la légende apprise de colonne droite (rightCol + brièveté).
// Mesuré sur le PDF réel Mia Cardigan : c'est le mécanisme (2), et lui seul, qui
// détruisait « All sizes. » (x5), « increased) » (x7), « sts increased) » (x7) et
// « follows: » (x6) — cf. les tests « colonne de texte » plus bas. Le mécanisme (1)
// ne les touchait pas : « All sizes. » n'est en bande que sur 2 pages sur 12, pour
// un seuil de 6. Sa garde « bande de page » suffit et reste vérifiée ici.

describe('stripBoilerplate — chrome vs contenu répété', () => {
  it('retire toujours un pied de page répété à hauteur stable (chrome)', () => {
    const pages = [
      [{ text: 'Row 1 (WS): purl to M8.', y: 700 }, { text: 'Version 1.1 (English)', y: 40 }],
      [{ text: 'Row 2 (RS): knit across row.', y: 700 }, { text: 'Version 1.1 (English)', y: 40 }],
    ]
    expect(textes(stripBoilerplate(pages))).not.toContain('Version 1.1 (English)')
  })

  it('retire le pied stable mais garde la même ligne égarée en plein corps', () => {
    // Le chrome n'est écarté qu'à SA hauteur de pied : la même chaîne isolée au
    // milieu d'une page reste du contenu tant qu'on n'a pas la preuve du contraire.
    const pages = [
      [{ text: 'Row 1 (WS): purl to M8.', y: 700 }, { text: 'Notes de taille', y: 40 }],
      [{ text: 'Row 2 (RS): knit across row.', y: 700 }, { text: 'Notes de taille', y: 40 }],
      [{ text: 'Row 3 (RS): knit.', y: 700 }, { text: 'Notes de taille', y: 400 }, { text: 'Row 4: purl.', y: 40 }],
    ]
    const kept = textes(stripBoilerplate(pages))
    expect(kept.filter((t) => t === 'Notes de taille')).toHaveLength(1)
  })
})

describe('stripBoilerplate — légende photo vs colonne droite de TEXTE', () => {
  // Mesuré sur Mia_Cardigan__English__v1.1.pdf : la colonne droite est une vraie
  // colonne de texte (longueur médiane ~60 caractères, 7 à 22 % de lignes courtes).
  // La colonne droite du poncho (bug #8) est une colonne de LÉGENDES : ses lignes
  // sont courtes quasi partout. C'est ce profil de colonne qui sépare les deux.
  const l = (text, y, rightCol = false) => ({ text, y, size: 10, bold: false, rightCol })
  const instruction = (n) => `Row ${n} (RS) raglan increase row: K1, M1R, knit to M2, slip M2.`

  it('garde un fragment court répété dans une colonne droite de TEXTE (cas Mia)', () => {
    // « increased) » = fin de phrase coupée par la mise en colonnes, répétée sur
    // 3 pages dans une colonne par ailleurs pleine d'instructions longues.
    // Le pied ancre la bande basse : « increased) » est en plein corps, pas en bande.
    const pages = [1, 2, 3].map((p) => [
      l(`Instructions page ${p}`, 780),
      ...[0, 1, 2, 3, 4, 5].map((i) => l(instruction(p * 10 + i), 660 - i * 20, true)),
      l('increased)', 520 - p * 40, true),
      l('Version 1.1 (English)', 20),
    ])
    const kept = textes(stripBoilerplate(pages))
    expect(kept.filter((t) => t === 'increased)')).toHaveLength(3)
  })

  it('écarte toujours une légende courte récurrente d’une colonne droite de LÉGENDES', () => {
    // Non-régression du bug poncho #8 : ici la colonne droite n'est faite que de
    // légendes courtes → c'est bien une colonne d'illustration.
    const pages = [1, 2, 3].map((p) => [
      l('EXPLICATIONS', 800),
      l(`${p}. Faire 3 ml puis crocheter des brides serrées`, 600),
      l(`${p + 1}. Comme ceci.`, 600 - p * 40, true),
      l('Finir avec 1 mc.', 400),
      l('Pied de page repete', 20),
    ])
    const kept = textes(stripBoilerplate(pages))
    expect(kept.some((t) => /Comme ceci/.test(t))).toBe(false)
    expect(kept.filter((t) => /Finir avec 1 mc/.test(t))).toHaveLength(3)
  })

  it('garde une clé de légende de diagramme (« END: maille endroit ») même répétée dans une colonne droite courte', () => {
    // Régression réelle — PDF Hobbii ottolie-chevron-cardigan-with-pockets-fr/nl : le
    // correctif crochet-cotton-makeup-pads-de-921e621a (excludeExtremeBands, lines.js)
    // corrige la détection bimodale 2-colonnes et fait basculer côté rightCol des pages
    // jusque-là lues en mono-flux — dont celle-ci. Sa colonne droite est une succession
    // de « Diagramme X Légende », chacune redéfinissant les MÊMES clés d'abréviation
    // (« END: maille endroit », « ENV: maille envers ») : dès 3 diagrammes, ce garde-fou
    // de légende récurrente les traitait à tort comme une légende photo et les effaçait
    // de TOUS les diagrammes sauf le dernier lu. Une entrée « clé: définition » a la
    // forme d'execAbbrLine — jamais une légende photo (« Comme ceci » n'a pas de « : »).
    const pages = ['A', 'C', 'D', 'E'].map((diag) => [
      l(`Diagramme ${diag} Légende`, 800),
      l('END: maille endroit', 700, true),
      l('ENV: maille envers', 680, true),
      l('Rang 1 (END): tricoter jusqu’à la fin.', 400),
      l('Pied de page repete', 20),
    ])
    const kept = textes(stripBoilerplate(pages))
    expect(kept.filter((t) => t === 'END: maille endroit')).toHaveLength(4)
    expect(kept.filter((t) => t === 'ENV: maille envers')).toHaveLength(4)
  })

  it('limite connue et assumée : une légende photo à forme clé/valeur accidentelle fuit, non filtrée', () => {
    // Revue de code (correctif crochet-cotton-makeup-pads-de-921e621a) : la garde
    // execAbbrLine ajoutée au test précédent ne distingue pas une vraie clé de glossaire
    // d'une légende photo qui adopte accidentellement la MÊME forme « mot court : texte »
    // (ex. « Detail: comme ceci » — execAbbrLine ne regarde que la FORME de la ligne, pas
    // son contexte). Compromis assumé, cohérent avec l'arbitrage déjà pris pour
    // glossary-columns.js (« un faux glossaire est pire qu'un glossaire manquant ») :
    // mieux vaut laisser fuiter une légende que risquer d'effacer une vraie entrée de
    // glossaire. Ce test rend la fuite EXPLICITE plutôt que silencieuse — si ce
    // comportement change un jour (garde affinée avec un signal de contexte), ce test
    // échouera et forcera une décision consciente au lieu d'une régression découverte
    // sur un patron réel.
    const pages = [1, 2, 3].map((p) => [
      l('EXPLICATIONS', 800),
      l(`${p}. Faire 3 ml puis crocheter des brides serrées`, 600),
      l('Detail: comme ceci', 600 - p * 40, true),
      l('Finir avec 1 mc.', 400),
      l('Pied de page repete', 20),
    ])
    const kept = textes(stripBoilerplate(pages))
    expect(kept.filter((t) => t === 'Detail: comme ceci')).toHaveLength(3) // fuite connue, pas filtrée
  })
})

// Régression réelle (V2b1) — PDF Hobbii flower-child-children-s-sweater-fr p6 : la
// grille de mesures (Taille | Devant-Dos | Manches) est lue en 2 colonnes par la
// lecture régionale V1 ; la colonne Manches sort rightCol avec des lignes courtes
// « 2 x 2 »/« 2 x 3 »/« 3 x 4 » dont le gabarit normalisé (« # x # », ≤ CAPTION_LEN)
// revient 7 fois → appris comme légende photo récurrente (capSeen ≥ 3) et TOUTE la
// colonne disparaissait. Discriminant : une vraie légende photo n'est JAMAIS un token
// numérique pur (isGridToken, lines.js) — on exclut ces tokens de l'apprentissage.
// NB fixture : « 12 » nu matche isGridToken mais AUSSI la RE numéro-de-page de
// NOISE_RES (mécanisme orthogonal, préexistant) — on utilise « 12-18 », le vrai token
// de la colonne Taille de ce PDF, pour ne tester QUE la garde captions.
describe('stripBoilerplate — V2b1 : tokens de grille numérique vs légendes photo', () => {
  const l = (text, y, rightCol = false) => ({ text, y, size: 10, bold: false, rightCol })
  // Trois pages dont la colonne droite est une colonne de LÉGENDES (majorité de lignes
  // courtes → isCaptionColumn vrai) mêlant vraies légendes et tokens de grille.
  const pages = [1, 2, 3].map((p) => [
    l('EXPLICATIONS', 800),
    l(`${p}. Faire 3 ml puis crocheter des brides serrées`, 600),
    l('Comme ceci.', 600 - p * 40, true),
    l('2 x 2', 580 - p * 40, true),
    l('9/10/9', 560 - p * 40, true),
    l('12-18', 540 - p * 40, true),
    l("L'aiguille indique", 520 - p * 40, true),
    l('Finir avec 1 mc.', 400),
    l('Pied de page repete', 20),
  ])

  it('garde les tokens de grille numérique répétés d’une colonne droite (flower-child p6, colonne Manches)', () => {
    const kept = textes(stripBoilerplate(pages))
    expect(kept.filter((t) => t === '2 x 2')).toHaveLength(3)
    expect(kept.filter((t) => t === '9/10/9')).toHaveLength(3)
    expect(kept.filter((t) => t === '12-18')).toHaveLength(3)
  })

  it('filtre toujours les vraies légendes courtes répétées (Comme ceci / L’aiguille indique)', () => {
    const kept = textes(stripBoilerplate(pages))
    expect(kept.some((t) => t === 'Comme ceci.')).toBe(false)
    expect(kept.some((t) => t === "L'aiguille indique")).toBe(false)
  })
})

// Régression réelle (V2b2) — chart key de diagramme (saroyan-it p3/p4, défaut
// PRÉEXISTANT : 6/10 entrées déjà perdues avant V1) : les libellés courts d'une clé
// de diagramme (« RS: purl », « bind off », « knit thru back loop ») tombent en bande
// de page sur les pages qui portent la clé (imprimée deux fois « for reference ») —
// le filtre repeated (seuil max(2, N/2) pages) les apprend comme en-tête/pied
// structurel et les jette PARTOUT. Une garde TEXTE seule est insuffisante :
// execAbbrLine exige un séparateur (« = », « : ») et « knit thru back loop » n'en a
// pas — seul le FLAG pairedRow (posé par lines.js sur les rangées de grille appariée,
// voyagé par les spreads {...l} de toLines/reflow) porte le contexte « rangée de
// grille », jamais un en-tête structurel.
describe('stripBoilerplate — V2b2 : repeated épargne les lignes pairedRow', () => {
  const l = (text, y, flags = {}) => ({ text, y, size: 10, bold: false, ...flags })

  it('garde un libellé de chart key pairedRow répété en bande de page (ne le filtre plus)', () => {
    // 4 pages, seuil repeated = max(2, ceil(4/2)) = 2 : sans la garde, le gabarit
    // « knit thru back loops » (en bande basse sur p1 et p2) serait appris puis filtré
    // PARTOUT — y compris p3/p4. Avec : la ligne pairedRow survit sur les 4 pages.
    const pages = [1, 2, 3, 4].map((p) => [
      l(`Chart key ${p}`, 780),
      l('knit thru back loops', 60, { pairedRow: true }),
      l('Structure footer', 30),
    ])
    const kept = textes(stripBoilerplate(pages))
    expect(kept.filter((t) => t === 'knit thru back loops')).toHaveLength(4)
  })

  it('n’APPREND pas un gabarit depuis une ligne pairedRow (une copie non-paired y échappe)', () => {
    // Volet apprentissage : le gabarit vu sur des lignes pairedRow (p1/p2, en bande)
    // ne doit pas non plus nourrir seenOnPages — sinon une copie ORDINAIRE du même
    // texte, en bande sur p3, se ferait filtrer par contamination (seuil 2 atteint :
    // 2 pairedRow + 1 ordinaire). Restore-only : sans le flag, comportement inchangé.
    const pages = [
      [l('Chart key 1', 780), l('bind off', 60, { pairedRow: true }), l('Structure footer', 30)],
      [l('Chart key 2', 780), l('bind off', 60, { pairedRow: true }), l('Structure footer', 30)],
      [l('Corps 3', 780), l('bind off', 60), l('Structure footer', 30)],
    ]
    const kept = textes(stripBoilerplate(pages))
    // les 2 pairedRow survivent (garde filtre) ; la copie ordinaire de p3 survit aussi
    // (le gabarit n'a été appris d'aucune page : 1 occurrence ordinaire < seuil 2)
    expect(kept.filter((t) => t === 'bind off')).toHaveLength(3)
  })

  it('filtre toujours la même ligne répétée en bande SANS le flag pairedRow (contrôle)', () => {
    // Le mécanisme repeated reste intact pour les vrais en-têtes : mêmes pages sans
    // le flag → appris (2/3 pages ≥ seuil 2) et filtré partout.
    const pages = [1, 2, 3].map((p) => [
      l(`Chart key ${p}`, 780),
      l('knit thru back loops', 60),
      l('Structure footer', 30),
    ])
    const kept = textes(stripBoilerplate(pages))
    expect(kept.some((t) => t === 'knit thru back loops')).toBe(false)
    expect(kept.some((t) => t === 'Structure footer')).toBe(false)
  })
})

// Régression réelle — patron espagnol « Hilma - Manta de bebé » (série de tests en
// cours) : 2 règles de NOISE_RES trop larges détruisaient du contenu réel.
describe('stripBoilerplate — URL nue : boutique/réseau connu vs lien tuto', () => {
  it('filtre une URL nue vers une boutique connue (hobbii)', () => {
    const pages = [[{ text: 'https://shop.hobbii.fr/produit-exemple', y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toHaveLength(0)
  })

  it('filtre une URL nue vers un réseau social connu (instagram)', () => {
    // Domaine NON couvert par la règle hobbii/garnstudio existante : seule la règle
    // URL-nue restreinte peut l'attraper — vérifie vraiment la restriction par domaine
    // (et pas une autre règle du tableau qui ferait passer le test par coïncidence).
    const pages = [[{ text: 'https://www.instagram.com/hobbii_official', y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toHaveLength(0)
  })

  it('garde un lien tuto youtu.be seul sur sa ligne (contenu légitime)', () => {
    // Cas réel Hilma : lien vers un tuto vidéo i-Cord, seul sur sa ligne dans le corps
    // du patron. L'ancienne règle « toute URL = bruit » le supprimait — perte de
    // contenu. Confirmé aussi sur le corpus mesuré : potholder-in-waffle-pattern-8-4
    // (en) a un lien youtu.be nu que la référence garde comme contenu.
    const pages = [[{ text: 'https://youtu.be/hEHGSkgFJ1M', y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toContain('https://youtu.be/hEHGSkgFJ1M')
  })

  it('garde un lien youtube.com seul sur sa ligne', () => {
    const pages = [[{ text: 'https://www.youtube.com/watch?v=hEHGSkgFJ1M', y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toContain(
      'https://www.youtube.com/watch?v=hEHGSkgFJ1M',
    )
  })
})

describe('stripBoilerplate — « del » : partage (da/no) vs mot espagnol', () => {
  it('garde la ligne espagnole réelle « del i-Cord … » (Hilma, contenu de rang)', () => {
    // « del » = contraction espagnole de « de + el », pas le début d'un appel au
    // partage. Rang réel tronqué par l'ancienne règle (préfixe « del » nu).
    const texte = 'del i-Cord y unir el principio y el final del borde con punto colchón.'
    const pages = [[{ text: texte, y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toContain(texte)
  })

  it('filtre toujours une vraie formule de partage danoise « del dette mønster »', () => {
    const pages = [[{ text: 'Del dette mønster med dine venner', y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toHaveLength(0)
  })

  it('filtre toujours une vraie formule de partage norvégienne « del denne oppskriften »', () => {
    const pages = [[{ text: 'Del denne oppskriften med venner', y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toHaveLength(0)
  })
})

// Régression réelle — patron allemand « Hilma - Babydecke » (série de tests en
// cours, hilma-baby-blanket-de-2adbb17d.pdf) : même classe de bug que « del » ci-dessus.
// L'alternative « teil » (préfixe NU, sans ancrage) collisionnait avec « Teil »/« Teile »,
// mot allemand TRÈS courant en patron tricot/crochet (« pièce(s) » à assembler) — 3
// fragments de rang réels tronqués en tête de ligne PDF brute (mesuré sur le PDF réel) :
// « Teile mit dem Leiterstich zusammen. », « Teile in der KF 1, KF 3 und KF 5 beginnen »,
// « Teile in KF 2 und KF 4 beginnen und ».
describe('stripBoilerplate — « teil » : partage (de) vs « Teil(e) » = pièce(s)', () => {
  it('garde « Teile mit dem Leiterstich zusammen. » (intro, contenu réel)', () => {
    const texte = 'Teile mit dem Leiterstich zusammen.'
    const pages = [[{ text: texte, y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toContain(texte)
  })

  it('garde « Teile in der KF 1, KF 3 und KF 5 beginnen » (FARBKOMBINATION, contenu réel)', () => {
    const texte = 'Teile in der KF 1, KF 3 und KF 5 beginnen'
    const pages = [[{ text: texte, y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toContain(texte)
  })

  it('garde « Teile in KF 2 und KF 4 beginnen und » (FARBKOMBINATION, contenu réel)', () => {
    const texte = 'Teile in KF 2 und KF 4 beginnen und'
    const pages = [[{ text: texte, y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toContain(texte)
  })

  it('filtre une vraie formule de partage allemande ancrée réseau social (mot-clé)', () => {
    // Aucune ligne PDF brute du corpus mesuré ne commence par « teil » comme appel au
    // partage à elle seule (la vraie formule trouvée sur ce PDF — « Wenn du magst,
    // teile dein Werk auf Instagram mit dem Hashtag #hilmablanketbaby … » — est
    // enchâssée en milieu de phrase, jamais en tête de ligne ; la référence la GARDE
    // d'ailleurs comme contenu légitime). Motif de repli prudent mais réaliste,
    // documenté dans boilerplate.js : exige la présence d'un signal réseau social
    // (instagram/facebook/hashtag/@mention/#hashtag) à proximité immédiate.
    const texte = 'Teile dein Bild mit uns auf Instagram!'
    const pages = [[{ text: texte, y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toHaveLength(0)
  })

  it('filtre une vraie formule de partage allemande ancrée sur un #hashtag nu', () => {
    // Les signaux réellement observés dans ce corpus sont des hashtags/mentions
    // NUS (« #hilmablanketbaby », « @kolibri.by_johanna »), pas les mots
    // « instagram »/« facebook » eux-mêmes. Un « \b » placé juste avant « # » ou « @ »
    // ne matche jamais après un espace (aucune transition mot/non-mot) : ce cas
    // vérifie que l'alternative dédiée [@#]\w+ (sans \b) fonctionne réellement.
    const texte = 'Teile dein Foto mit uns #hilmablanket'
    const pages = [[{ text: texte, y: 300 }]]
    expect(textes(stripBoilerplate(pages))).toHaveLength(0)
  })
})

// Un verbe de partage en tête de ligne ne suffit pas : « Partager les mailles… » est une consigne.
describe('stripBoilerplate — partage (fr/en/nl/sv) vs consigne de répartition', () => {
  it('garde les consignes de répartition qui commencent par le verbe', () => {
    const consignes = [
      "Partager le travail en deux pour l'encolure.",
      'Partager les mailles sur 2 aiguilles.',
      'Share the stitches evenly over 4 needles.',
      'Deel de steken over 2 naalden.',
      'Dela maskorna på 2 stickor.',
    ]
    const pages = [consignes.map((text, i) => ({ text, y: 700 - i * 20 }))]
    expect(textes(stripBoilerplate(pages))).toEqual(consignes)
  })

  it('filtre toujours les appels au partage', () => {
    const appels = [
      'Partage ta création avec #rowtine',
      'Partagez vos photos sur Instagram',
      'Share your finished project with us!',
      'Deel je werk met ons',
      'Comparte tu labor con nosotros',
      'Condividi il tuo lavoro',
    ]
    const pages = [appels.map((text, i) => ({ text, y: 700 - i * 20 }))]
    expect(textes(stripBoilerplate(pages))).toHaveLength(0)
  })
})

// « Side N » seul est aussi un intertitre anglais (face d'un coussin) : seul « Side N af/av M » est un folio sûr.
describe('stripBoilerplate — « Side N » : folio (da/no) vs intertitre (en)', () => {
  it('garde les intertitres « Side 1 » / « Side 2 » au milieu de la page', () => {
    const pages = [[
      { text: 'Side 1', y: 600 },
      { text: 'Round 1: 6 sc in a magic ring.', y: 580 },
      { text: 'Side 2', y: 400 },
      { text: 'Round 1: 6 sc in a magic ring.', y: 380 },
    ]]
    expect(textes(stripBoilerplate(pages))).toContain('Side 1')
    expect(textes(stripBoilerplate(pages))).toContain('Side 2')
  })

  it('filtre toujours le folio « Side 2 af 5 »', () => {
    const pages = [[{ text: 'Side 2 af 5', y: 10 }]]
    expect(textes(stripBoilerplate(pages))).toHaveLength(0)
  })
})

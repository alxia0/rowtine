// LES DESCRIPTIONS D'IMAGES DU GUIDE SONT LONGUES À DESSEIN, et ce test existe pour qu'on
// ne les « simplifie » pas de bonne foi. Elles ont fait 15 à 19 caractères jusqu'au
// 2026-08-12 — « L'accueil de Rowtine » —, ce qui NOMME la capture au lieu de la décrire :
// une lectrice au lecteur d'écran apprenait qu'il y a une image, et rien de ce qu'elle
// montre. Les descriptions actuelles disent ce qui est réellement affiché, valeurs
// comprises, et viennent du site vitrine qui les avait écrites de son côté.
//
// LE PLANCHER EST À 80 ET NON À 170, bien que les descriptions en fassent 170 à 200 : il
// n'est pas là pour imposer un style mais pour attraper la RÉGRESSION — un retour aux
// libellés de trois mots. Une reformulation plus courte mais toujours descriptive reste
// possible sans avoir à toucher au test.
//
// L'INTERDIT DES COULEURS tient au thème sombre. « Le rang en cours cerclé de rouille »
// décrit le thème clair, et l'app en a deux : en sombre, la lectrice entend une couleur
// qu'elle n'a pas sous les yeux — et c'est précisément celle qui ne peut pas vérifier.
// Vérifié le 2026-08-14 sur images/ et images-dark/ : le cerclage de 03d et les deux
// lignes de calage de 03c sont ROUILLE en clair et AMBRÉS en sombre.
//
// LA LISTE EST RELEVÉE, PAS DEVINÉE (relevé du 2026-08-14, sur les quatre guides, avant
// correction : 14 figures et 18 occurrences — fr 5, en 5, de 2, es 2). La règle ne porte
// QUE sur les textes alternatifs : « laine verte » dans la prose décrit une laine et reste
// juste. « noir / black / schwarz / negro » (03c) est volontairement HORS liste, et ce
// n'est pas un oubli : le fond du plein écran est identique dans les deux captures, donc
// la phrase reste vraie dans les deux thèmes. Voir aussi les trois écartés, plus bas.
//
// DEUX PIÈGES DU MOTIF, PAYÉS LE 2026-08-14, ET QUI SE REPAIERONT :
//   1. \b EST ASCII EN JAVASCRIPT, MÊME SOUS /u. « é » et « ó » ne sont pas des \w, donc
//      \bécru\b et \bóxido\b ne peuvent JAMAIS s'apparier : la garde aurait été aveugle aux
//      deux termes qu'elle vise le plus, sans qu'aucun rouge ne le dise. C'est ce qui
//      donnait « espagnol : 1 cas » là où il y en avait 2. D'où les lookarounds Unicode —
//      qui bloquent toujours « ouvert », « vert » y étant précédé d'une lettre. Les
//      frontières ne sont pas retirées, elles sont réparées.
//   2. L'ALLEMAND COLLE SES COMPOSÉS. \brost\b ne voit pas « rostfarbene », et c'est ce qui
//      faisait croire l'allemand cinq fois plus propre que le français. L'allemand n'a donc
//      PAS de borne à droite : la racine ouvre sur sa queue. Les verts à préfixe
//      (hellgrün, dunkelgrün, olivgrün) restent en clair, la borne de gauche les bloquant.
//   3. ET LA QUEUE OUVERTE SE PAIE À SON TOUR, sur toute racine qui est le PRÉFIXE d'un mot
//      courant. « grün » attrapait « gründlich », « Gründen », « Gründung » — de l'allemand
//      parfaitement légitime. Le danger ne tient pas à un témoin précis dans le corpus, il
//      tient à la LANGUE : Grund et sa famille sont de l'allemand courant, qu'une description
//      peut employer à tout moment. Un témoin concret l'avait révélé — « auf schwarzem Grund »
//      était dans de/03c, seul l'umlaut l'en séparant — mais il a depuis disparu du texte
//      (09f2524a, 2026-08-14), la phrase qui le portait s'étant révélée fausse. Le risque, lui,
//      reste entier : « auf gründlich dunklem Grund » ferait toujours rougir la garde sur un
//      texte juste. D'où le « grün(?!d) » de la liste, mesuré le 2026-08-14 : il bloque les
//      trois, et garde grün, grüne, grünliche, hellgrüne.
//      LES ENTRÉES DE LA LISTE SONT DONC DES FRAGMENTS D'EXPRESSION RÉGULIÈRE, pas des mots
//      nus — ne pas les échapper en recopiant la liste ailleurs.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const GUIDE = path.join(ICI, '../../src/content/guide')
const LANGUES = ['fr', 'en', 'de', 'es']
const FIGURE = /!\[([^\]]*)\]\(images\/([a-z]{2})\/([^)]+)\.webp\)/g
const PLANCHER = 80

// Relevés — présents dans le corpus avant la correction du 2026-08-14 : rouille/rust/rost/
// óxido et vert/green/grün/verde. Préventifs — absents ce jour-là, gardés parce que
// l'accent du thème sombre est AMBRÉ : un alt écrit devant une capture sombre nommerait
// « ambre » ou « doré », et aucune liste ne le portait. Écru et lichen sont les deux autres
// couleurs nommées de la palette.
//
// CE QUI EST ÉCARTÉ L'EST POUR DEUX RAISONS DIFFÉRENTES, ET IL FAUT LES DISTINGUER :
//
// ÉCARTÉS SUR MESURE — chacun s'apparierait sur un texte réel, compté :
//   — « jaune / yellow / gelb / amarillo » : 4 alt aujourd'hui (05b, les quatre langues,
//     « pastille jaune Moutarde »). C'est la couleur d'une laine SAISIE par l'utilisatrice,
//     une donnée affichée et non un jeton de la palette. Les refuser serait le « laine
//     verte » que ce relevé existe pour éviter.
//   — « flecht » (lichen en allemand) : l'allemand n'ayant pas de borne à droite, il
//     s'apparie sur « Flechtmuster » et « flechten » — du vocabulaire de tricot pur, mesuré
//     le 2026-08-14. C'est le prix de la queue ouverte, et il ne se paie qu'ici :
//     « lichen » et « liquen », bornés des deux côtés, ne coûtent rien et restent.
//
// ÉCARTÉ PAR ANALOGIE — ZÉRO occurrence dans les 108 alt, dans un sens comme dans l'autre,
// donc rien ne le mesure et il faut le dire :
//   — « noir / black / schwarz / negro » : a changé de côté le 2026-08-14. Ce commentaire le
//     comptait « sur mesure », 4 alt (03c, les quatre langues, « sur fond noir » / « auf
//     schwarzem Grund » / « on black » / « fondo negro ») — mais la phrase qu'il mesurait
//     était FAUSSE : seules la barre du haut et la bande de consigne du bas sont sombres, le
//     quadrillage occupe tout le reste sur du blanc. Sa réécriture (09f2524a) a fait
//     disparaître le mot des cent alt sans le remplacer par un autre terme de fond : la
//     mesure s'est éteinte avec la phrase qu'elle comptait. L'exclusion, elle, ne bouge pas :
//     « noir » n'est pas un jeton de la palette du produit et n'a pas à entrer dans l'interdit.
//   — « brun / brown / braun / marrón » : écarté parce que « laine brune » est un nom de
//     laine PLAUSIBLE, au même titre que le jaune qui, lui, est là. C'est un raisonnement
//     par ressemblance, pas un relevé.
//
// « ORANGE » A FAIT L'ALLER-RETOUR, ET C'EST LA CORRECTION LA PLUS INSTRUCTIVE DE LA PASSE.
// Il avait été écarté avec « brun », par la même analogie du nom de laine. À tort : c'est le
// mot LE PLUS PROBABLE pour nommer l'accent ambré du thème sombre, celui-là même dont ce
// test constate le changement sur 03c et 03d. On devinait « doré », « gold », « bernstein »
// pour couvrir ce cas, et on retirait le mot qui le nomme d'abord — un alt disant « une
// seule barre orange » passait en silence. Il est donc revenu avec les préventifs ambrés :
// la règle ne portant QUE sur les alt, la laine orange du stock n'est pas concernée.
// Fragments d'expression régulière, pas des mots nus : voir le piège 3 pour « grün(?!d) ».
// En allemand, « orange » couvre « orangefarbene » par la queue ouverte — pas d'entrée en plus.
const COULEURS = {
  fr: ['rouille', 'vert', 'verte', 'verts', 'vertes', 'lichen', 'écru', 'écrue',
       'ambre', 'ambré', 'ambrée', 'doré', 'dorée', 'orange', 'orangé', 'orangée'],
  en: ['rust', 'green', 'lichen', 'ecru', 'amber', 'gold', 'golden', 'orange'],
  de: ['rost', 'grün(?!d)', 'hellgrün', 'dunkelgrün', 'olivgrün', 'ecru', 'bernstein',
       'gold', 'orange'],
  es: ['óxido', 'oxido', 'verde', 'verdes', 'liquen', 'crudo', 'cruda',
       'ámbar', 'ambar', 'dorado', 'dorada', 'naranja'],
}

// Borne de gauche partout ; borne de droite partout SAUF en allemand (voir le piège 2).
const motifCouleurs = langue =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_])(${COULEURS[langue].join('|')})` +
      (langue === 'de' ? '' : '(?![\\p{L}\\p{N}_])'),
    'iu',
  )

const figures = langue =>
  [...fs.readFileSync(path.join(GUIDE, `${langue}.md`), 'utf8').matchAll(FIGURE)]
    .map(([, alt, , nom]) => ({ alt: alt.trim(), nom }))

describe('les descriptions d images du guide décrivent au lieu de nommer', () => {
  it.each(LANGUES)('%s : aucune description sous %i caractères', langue => {
    const courtes = figures(langue).filter(f => f.alt.length < PLANCHER)
    expect(courtes.map(f => `${f.nom} (${f.alt.length})`)).toEqual([])
  })

  it.each(LANGUES)('%s : aucune description ne nomme une couleur de la palette', langue => {
    const motif = motifCouleurs(langue)
    const fautives = figures(langue).filter(f => motif.test(f.alt))
    expect(fautives.map(f => f.nom)).toEqual([])
  })

  it.each(LANGUES)('%s : les 27 captures en portent une', langue => {
    expect(figures(langue)).toHaveLength(27)
  })

  // Le motif est lui-même éprouvé : sans cela, une garde aveugle passerait au vert et on
  // la croirait. Les deux premiers cas sont ceux que \b(...)\b laissait silencieusement
  // filer ; le troisième est le faux positif que les frontières doivent bloquer.
  it('le motif attrape les accents, les composés allemands, et épargne « ouvert »', () => {
    expect(motifCouleurs('es').test('un recuadro de color óxido')).toBe(true)
    expect(motifCouleurs('de').test('zwei rostfarbene Linien')).toBe(true)
    expect(motifCouleurs('fr').test('le patron ouvert sur son onglet')).toBe(false)
    // LA QUEUE OUVERTE DE L'ALLEMAND SE RETOURNE CONTRE LES TERMES GARDÉS, et c'est ici que
    // ça se voit : ces trois-là sont de l'allemand légitime que « grün » nu attrapait. Le
    // dernier n'est pas une curiosité — « auf schwarzem Grund » est déjà dans de/03c.
    expect(motifCouleurs('de').test('gründlich gearbeitet')).toBe(false)
    expect(motifCouleurs('de').test('aus diesen Gründen')).toBe(false)
    expect(motifCouleurs('de').test('auf gründlich dunklem Grund')).toBe(false)
    // …sans rien perdre des verts qu'elle doit attraper.
    expect(motifCouleurs('de').test('die Reihen darunter sind grün')).toBe(true)
    expect(motifCouleurs('de').test('eine grünliche Reihe')).toBe(true)
    // Et les écartés ne doivent pas revenir par mégarde : « flecht » serait un piège à
    // Flechtmuster, et « jaune » un piège à la laine que 05b nomme déjà.
    expect(motifCouleurs('de').test('ein Flechtmuster über acht Maschen')).toBe(false)
    expect(motifCouleurs('fr').test('pastille jaune Moutarde, marque Drops')).toBe(false)
    // « orange » est revenu : c'est le mot le plus probable pour l'accent ambré du sombre.
    expect(motifCouleurs('fr').test('une seule barre orange, celle de cette semaine')).toBe(true)
    expect(motifCouleurs('de').test('zwei orangefarbene Linien')).toBe(true)
  })
})

// Les descriptions d'images du guide sont LONGUES À DESSEIN : elles disent ce qui est
// réellement affiché, valeurs comprises, au lieu de nommer la capture (« L'accueil de
// Rowtine » n'apprend rien à une lectrice au lecteur d'écran). Le plancher (80) est
// volontairement sous les 170 à 200 caractères réels consignés dans AGENTS.md : il attrape
// la régression vers des libellés de trois mots, il n'impose pas ce style précis.
//
// Aucune couleur de la palette dans les alt : l'app a deux thèmes, et en sombre l'accent
// rouille devient ambré, donc la lectrice entendrait une couleur qu'elle n'a pas sous les
// yeux. La règle ne porte QUE sur les alt (« laine verte » dans la prose reste juste).
//
// Pièges du motif :
//   1. \b est ASCII en JavaScript, même sous /u : \bécru\b et \bóxido\b ne s'apparient
//      jamais. D'où les lookarounds Unicode, qui bloquent toujours « ouvert ».
//   2. L'allemand colle ses composés (« rostfarbene ») : pas de borne à droite en allemand.
//   3. Cette queue ouverte attrape tout mot dont la racine est le préfixe (« gründlich »,
//      « Gründen ») : d'où « grün(?!d) », qui garde grün, grüne, grünliche, hellgrüne.
//      Les entrées de la liste sont donc des FRAGMENTS D'EXPRESSION RÉGULIÈRE, pas des mots
//      nus : ne pas les échapper en recopiant la liste ailleurs.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const GUIDE = path.join(ICI, '../../src/content/guide')
const LANGUES = ['fr', 'en', 'de', 'es']
const FIGURE = /!\[([^\]]*)\]\(images\/([a-z]{2})\/([^)]+)\.webp\)/g
const PLANCHER = 80

// Termes relevés dans le corpus (rouille, vert et leurs traductions), plus des préventifs
// pour l'accent ambré du thème sombre (ambre, doré, orange) et les autres couleurs nommées
// de la palette (écru, lichen). « orange » est le mot le plus probable pour cet accent.
//
// Écartés volontairement :
//   - « jaune » et traductions : couleur d'une laine SAISIE par l'utilisatrice (05b), une
//     donnée affichée, pas un jeton de la palette.
//   - « flecht » (lichen en allemand) : la queue ouverte l'apparierait sur « Flechtmuster »,
//     vocabulaire de tricot ; « lichen » et « liquen », bornés, restent.
//   - « noir » et traductions : pas un jeton de la palette.
//   - « brun » et traductions : nom de laine plausible, comme le jaune.
// En allemand, « orange » couvre « orangefarbene » par la queue ouverte.
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

  it.each(LANGUES)('%s : les 28 captures en portent une', langue => {
    expect(figures(langue)).toHaveLength(28)
  })

  // Le motif est lui-même éprouvé, sinon une garde aveugle passerait au vert : les deux
  // premiers cas sont ceux que \b(...)\b laissait filer, le troisième un faux positif à bloquer.
  it('le motif attrape les accents, les composés allemands, et épargne « ouvert »', () => {
    expect(motifCouleurs('es').test('un recuadro de color óxido')).toBe(true)
    expect(motifCouleurs('de').test('zwei rostfarbene Linien')).toBe(true)
    expect(motifCouleurs('fr').test('le patron ouvert sur son onglet')).toBe(false)
    // La queue ouverte de l'allemand ne doit pas attraper de l'allemand légitime.
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

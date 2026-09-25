import { describe, it, expect } from 'vitest'
import { countMultiColPages, computeBlocking, detectMultiPattern, analyzeMultiPattern, MULTI_PATTERN_REJECTS } from '@/utils/pdf-import/blocking'

describe('blocking — colonnes', () => {
  it('countMultiColPages compte les pages portant une ligne multiCol', () => {
    const pages = [
      [{ text: 'a' }, { text: 'b', multiCol: true }],
      [{ text: 'c' }],
      [{ text: 'd', multiCol: true }],
    ]
    expect(countMultiColPages(pages)).toBe(2)
  })
  it('computeBlocking bloque avec raison columns si ≥1 page multiCol', () => {
    const pages = [[{ text: 'x', multiCol: true }]]
    const b = computeBlocking(pages)
    expect(b.blocked).toBe(true)
    expect(b.reasons).toContain('columns')
  })
  it('ne bloque pas une page normale', () => {
    expect(computeBlocking([[{ text: 'x' }]]).blocked).toBe(false)
  })
})

describe('blocking — multi-patrons (resserré)', () => {
  const L = (text, size = 10) => ({ text, size, bold: false, y: 0 })
  const recueil = [
    [L('Bonnet Alpin', 24), L('Matériel', 12), L('2 pelotes de 50 g, coloris Écru'), L('Aiguilles circulaires 4 mm'), L('Rang 1 : *2 m. end., 2 m. env.*')],
    [L('Rang 2 : tricoter les mailles comme elles se présentent.')],
    [L('Écharpe Brume', 24), L('Fournitures', 12), L('3 pelotes de 50 g'), L('Aiguilles 5 mm'), L('Rang 1 : tricoter à l’endroit.')],
    [L('Rang 2 : tricoter à l’envers.')],
    [L('Mitaines Givre', 24), L('Matériel', 12), L('1 pelote de 50 g'), L('Aiguilles 3,5 mm'), L('Rang 1 : côtes 1/1.')],
    [L('Rang 2 : tricoter à l’endroit.')],
  ]

  it('recueil : trois en-têtes suivis de leur liste, séparés par un titre nouveau', () => {
    expect(analyzeMultiPattern(recueil)).toMatchObject({ headings: 3, realHeadings: 3, patterns: 3 })
    expect(detectMultiPattern(recueil)).toBe(true)
  })

  // Décision de la propriétaire, 2026-09-24 08:41 (choix B) : un recueil a au moins
  // MIN_BOOK_PATTERNS = 3 patrons. Un ensemble de deux pièces sans mot de variante n'est
  // donc jamais refusé.
  it('ensemble « Bonnet » puis « Snood » sans mot de variante : deux patrons, pas un recueil', () => {
    const pages = [
      [L('Bonnet', 24), L('Matériel', 12), L('2 pelotes de 50 g'), L('Aiguilles 4 mm'), L('Rang 1 : côtes 2/2.')],
      [L('Rang 2 : tricoter les mailles comme elles se présentent.')],
      [L('Snood', 24), L('Matériel', 12), L('3 pelotes de 50 g'), L('Aiguilles 5 mm'), L('Rang 1 : côtes 2/2.')],
      [L('Rang 2 : tricoter les mailles comme elles se présentent.')],
    ]
    expect(analyzeMultiPattern(pages)).toMatchObject({ patterns: 2, variant: null })
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('recueil sans grand titre : deux blocs de tailles différents séparent les patrons', () => {
    const pages = [
      [L('Tailles : S (M) L'), L('Matériel'), L('4 pelotes de 50 g'), L('Aiguilles 4 mm')],
      [L('Rang 1 : tricoter à l’endroit.'), L('Rang 2 : tricoter à l’envers.')],
      [L('Tailles : 1 an (2 ans) 4 ans'), L('Matériel'), L('2 pelotes de 50 g'), L('Aiguilles 3 mm')],
      [L('Rang 1 : tricoter à l’endroit.'), L('Rang 2 : tricoter à l’envers.')],
      [L('Tailles : 36 (38) 40'), L('Matériel'), L('1 pelote de 50 g'), L('Aiguilles 3,5 mm')],
      [L('Rang 1 : tricoter à l’endroit.')],
    ]
    expect(detectMultiPattern(pages)).toBe(true)
  })

  it('couverture qui répète « Matériel » sans liste : un seul patron (Review Focus)', () => {
    const pages = [
      [L('Pull Jade', 28), L('Matériel'), L('Tailles : S (M) L')],
      [L('Pull Jade', 24), L('Matériel', 12), L('6 (7) 8 pelotes de 50 g'), L('Aiguilles 4 mm'), L('Rang 1 : côtes 2/2.')],
      [L('Rang 2 : tricoter les mailles comme elles se présentent.')],
      [L('Finitions : rentrer les fils.')],
    ]
    const a = analyzeMultiPattern(pages)
    expect(a.headings).toBe(2) // l'ancien détecteur l'aurait déclaré recueil
    expect(a.patterns).toBe(1)
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('patron bilingue qui répète titre, matériel et tailles : un seul patron (Review Focus)', () => {
    const pages = [
      [L('Mia Cardigan', 24), L('Materials', 12), L('5 balls of 50 g'), L('4 mm circular needles'), L('Sizes: S (M) L'), L('Row 1: knit.')],
      [L('Row 2: purl.')],
      [L('Mia Cardigan', 24), L('Matériel', 12), L('5 pelotes de 50 g'), L('Aiguilles circulaires 4 mm'), L('Tailles : S (M) L'), L('Rang 1 : endroit.')],
      [L('Rang 2 : envers.')],
    ]
    expect(analyzeMultiPattern(pages)).toMatchObject({ realHeadings: 2, patterns: 1 })
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('deux en-têtes réels sans séparateur entre eux : un seul patron', () => {
    const pages = [
      [L('Materials'), L('5 balls of 50 g'), L('4 mm needles')],
      [L('Row 1: knit.')],
      [L('Fournitures'), L('5 pelotes de 50 g'), L('Aiguilles 4 mm')],
      [L('Rang 1 : endroit.')],
    ]
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('document court (< 4 pages) : jamais un recueil', () => {
    expect(detectMultiPattern(recueil.slice(0, 3))).toBe(false)
  })

  it('en-tête nu sans liste (ancien cas positif) : ne compte plus', () => {
    const pages = [[L('Materials'), L('Rang 1 : ...')], [L('Corps')], [L('Fournitures'), L('Rang 1 : ...')], [L('Fin')]]
    expect(analyzeMultiPattern(pages).realHeadings).toBe(0)
    expect(detectMultiPattern(pages)).toBe(false)
  })

  // Calage 2026-09-24 : forme des 12 fiches Hobbii « Go handmade » (cosy-dolls, sensory-*,
  // vest-lace…) que le seul candidat 2 déclarait recueils. Couverture avec sa liste, page de
  // photos légendées en gros corps, puis le patron avec la même liste : aucun rang entre les
  // deux en-têtes, le premier « patron » n'avait pas de corps.
  it('couverture AVEC liste, page de photos légendées, puis le patron : un seul patron (Review Focus)', () => {
    const pages = [
      [L('Patron', 40), L('Cosy Dolls', 28), L('MATÉRIEL', 11.5), L('Yeux de sécurité : 12 mm', 11.5), L('Crochet : 2,5 - 3,5 mm', 11.5), L('Nombreuses couleurs', 11.5), L('Go handmade', 28)],
      [L('Belinda, Jennifer & Conni', 17), L('Monter le miroir dans', 16), L('le dessous de la doudou.', 16)],
      [L('MATÉRIEL :'), L('Yeux de sécurité 12 mm', 8), L('Crochet 2,5 - 3,5 mm', 8), L('Tour 1 : 6 ms dans un cercle magique.', 8)],
      [L('Tour 2 : 2 ms dans chaque m. (12)', 8), L('Tour 3 : *1 ms, aug.* (18)', 8)],
    ]
    const a = analyzeMultiPattern(pages)
    expect(a).toMatchObject({ realHeadings: 2, patterns: 1 })
    expect(a.trace[1].why).toBe('sans rang')
    expect(detectMultiPattern(pages)).toBe(false)
  })

  // Calage 2026-09-24 : forme de 8036-436 (Katia, six langues) et de Wilkinson (en/fr/de).
  // Chaque langue répète l'en-tête avec sa liste, ses tailles traduites (donc « différentes »)
  // et ses rangs : une langue jamais vue est une traduction, pas un nouveau patron.
  // Revue de la tâche 5 : plancher de MIN_BODY_ROWS = 2 rangs. Une ligne « Rang 1 » isolée
  // (un exemple de point sur une couverture) ne fait pas un corps de patron.
  it('un seul rang entre deux en-têtes ne suffit pas à faire un patron', () => {
    const pages = [
      [L('Patron', 40), L('Cosy Dolls', 28), L('MATÉRIEL'), L('Yeux de sécurité : 12 mm'), L('Crochet : 2,5 - 3,5 mm'), L('Rang 1 : exemple de point.')],
      [L('Belinda, Jennifer & Conni', 17)],
      [L('MATÉRIEL :'), L('Yeux de sécurité 12 mm'), L('Crochet 2,5 - 3,5 mm'), L('Tour 1 : 6 ms dans un cercle magique.')],
      [L('Tour 2 : 2 ms dans chaque m. (12)')],
    ]
    expect(analyzeMultiPattern(pages).trace[1]).toMatchObject({ why: 'sans rang', rows: 1 })
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('patron multilingue aux tailles traduites : un seul patron (Review Focus)', () => {
    const pages = [
      [L('TALLAS: –a) 38-40 –b) 42-44'), L('MATERIALES'), L('Col. 44 verde: –a) 2 –b) 2 ovillos'), L('Agujas n.º 4'), L('Vuelta 1: *2 d., 2 r.*')],
      [L('TAILLES : –a) 38-40 –b) 42-44'), L('FOURNITURES'), L('Col. 44 vert : –a) 2 –b) 2 pelotes'), L('Aiguilles n° 4'), L('Rang 1 : *2 m. end., 2 m. env.*')],
      [L('SIZE: –a) 37 3/4” –b) 41 3/4”'), L('MATERIALS'), L('–a) 2 –b) 2 balls green col. 44'), L('4 mm needles'), L('Row 1: *k2, p2*')],
      [L('Row 2: knit the sts as they appear.')],
    ]
    const a = analyzeMultiPattern(pages)
    expect(a).toMatchObject({ realHeadings: 3, patterns: 1 })
    // fr répète les tailles de l'espagnol (rien ne sépare) ; en les traduit en pouces (armé).
    expect(a.trace.map((t) => t.why)).toEqual([null, 'sans séparateur', 'traduction'])
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('recueil dont le premier patron est multilingue : les patrons suivants comptent encore', () => {
    const pages = [
      [L('Pull Rayé', 24), L('MATERIALES'), L('Col. 44: 2 ovillos'), L('Agujas 4 mm'), L('Vuelta 1: *2 d., 2 r.*')],
      [L('FOURNITURES'), L('Col. 44 : 2 pelotes'), L('Aiguilles 4 mm'), L('Rang 1 : *2 m. end., 2 m. env.*'), L('Rang 2 : idem.')],
      [L('Bonnet Brume', 24), L('Fournitures'), L('1 pelote de 50 g'), L('Aiguilles 5 mm'), L('Rang 1 : côtes 1/1.')],
      [L('Rang 2 : endroit.')],
      [L('Mitaines Givre', 24), L('Fournitures'), L('1 pelote de 50 g'), L('Aiguilles 3,5 mm'), L('Rang 1 : côtes 1/1.')],
      [L('Rang 2 : endroit.')],
    ]
    expect(analyzeMultiPattern(pages)).toMatchObject({ patterns: 3 })
    expect(detectMultiPattern(pages)).toBe(true)
  })

  it('une ligne de la liste de fournitures n’arme jamais un titre, même en gros corps', () => {
    const pages = [
      [L('Bonnet', 24), L('Matériel'), L('Crochet : 4 mm', 16), L('2 pelotes de 50 g', 16), L('Tour 1 : 6 ms.')],
      [L('Tour 2 : aug.')],
      [L('Matériel'), L('Crochet : 4 mm'), L('2 pelotes de 50 g'), L('Tour 3 : 18 ms.')],
      [L('Tour 4 : 24 ms.')],
    ]
    expect(analyzeMultiPattern(pages).trace[1].why).toBe('sans séparateur')
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('une ligne « color 22 » compte comme fourniture (recueil Hobbii en, Agnes)', () => {
    const pages = [[L('Materials'), L('4 (4) (5) 5 Alpaca Silk, color 22 &'), L('DPN and 32” Circular needles US 8 (5 mm)')]]
    expect(analyzeMultiPattern(pages).realHeadings).toBe(1)
  })

  // Frontière de la branche « coloris » : une référence de coloris ne compte que si la ligne
  // porte AUSSI une quantité. « Col. 44 vert » seul est une ligne de nuancier, pas une fourniture.
  it('une référence de coloris sans quantité, ou « color » seul, ne compte pas comme fourniture', () => {
    const needles = L('4 mm circular needles')
    expect(analyzeMultiPattern([[L('Materials'), L('Col. 44 vert'), needles]]).realHeadings).toBe(0)
    expect(analyzeMultiPattern([[L('Materials'), L('Alpaca Silk, color'), needles]]).realHeadings).toBe(0)
    expect(analyzeMultiPattern([[L('Materials'), L('Farbe 84'), needles]]).realHeadings).toBe(0)
    expect(analyzeMultiPattern([[L('Materials'), L('1 Knäuel in Farbe 84'), needles]]).realHeadings).toBe(1)
  })

  // Revue de la tâche 5 : « Material » est allemand, anglais au singulier ou espagnol. Sa
  // langue se lit dans la liste qui le suit, sinon la garde des langues ne voit pas la
  // traduction d'un patron unique.
  const de = [
    L('Pullover Mia', 24), L('Material'), L('3 Knäuel Wolle in Farbe 12 und 1 Knäuel für den Kragen'), L('Rundstricknadel 4 mm mit 80 cm Seil'), L('Maschenprobe: 22 M und 30 R mit der Nadel'),
    L('Reihe 1: *2 M rechts, 2 M links* bis zum Ende der Reihe.'),
  ]
  it('patron unique allemand puis espagnol, « Material » des deux côtés : un seul patron (sonde de revue)', () => {
    const pages = [
      de,
      [L('Reihe 2: die Maschen stricken, wie sie erscheinen.')],
      [L('Jersey Mia', 24), L('Material'), L('3 ovillos de lana en color 12 y 1 ovillo para el cuello'), L('Agujas circulares de 4 mm con cable de 80 cm'), L('Muestra: 22 p y 30 h con las agujas'), L('Vuelta 1: *2 d., 2 r.* hasta el final de la vuelta.')],
      [L('Vuelta 2: tejer los puntos como se presentan.')],
    ]
    const a = analyzeMultiPattern(pages)
    expect(a.trace.map((t) => t.why)).toEqual([null, 'traduction'])
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('patron unique allemand puis anglais, « Material » au singulier des deux côtés : un seul patron', () => {
    const pages = [
      de,
      [L('Reihe 2: die Maschen stricken, wie sie erscheinen.')],
      [L('Mia Sweater', 24), L('Material'), L('3 balls of yarn in colour 12 and 1 ball for the collar'), L('4 mm circular needles with an 80 cm cable'), L('Gauge: 22 sts and 30 rows with the needles'), L('Row 1: *k2, p2* to the end of the row.')],
      [L('Row 2: work the stitches as they appear.')],
    ]
    expect(analyzeMultiPattern(pages).trace.map((t) => t.why)).toEqual([null, 'traduction'])
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('recueil allemand, « Material » à chaque patron : les trois patrons comptent', () => {
    const pages = [
      de,
      [L('Reihe 2: die Maschen stricken, wie sie erscheinen.')],
      [L('Mütze Anna', 24), L('Material'), L('1 Knäuel Wolle in Farbe 5 und 1 Knäuel für den Bommel'), L('Rundstricknadel 5 mm mit 40 cm Seil'), L('Reihe 1: rechts stricken bis zum Ende.')],
      [L('Reihe 2: links stricken.')],
      [L('Schal Lena', 24), L('Material'), L('2 Knäuel Wolle in Farbe 7 und 1 Knäuel für die Fransen'), L('Stricknadeln 5 mm mit Seil'), L('Reihe 1: rechts stricken bis zum Ende.')],
      [L('Reihe 2: links stricken.')],
    ]
    expect(detectMultiPattern(pages)).toBe(true)
  })

  it('recueil anglais qui alterne « Materials » et « Material » : les trois patrons comptent', () => {
    const pages = [
      [L('Mia Sweater', 24), L('Materials'), L('3 balls of yarn in colour 12 and 1 ball for the collar'), L('4 mm circular needles with an 80 cm cable'), L('Row 1: *k2, p2* to the end of the row.')],
      [L('Row 2: work the stitches as they appear.')],
      [L('Anna Hat', 24), L('Material'), L('1 ball of yarn in colour 5 and 1 ball for the pompom'), L('5 mm circular needles with a 40 cm cable'), L('Row 1: knit to the end of the row.')],
      [L('Row 2: purl.')],
      [L('Lena Scarf', 24), L('Materials'), L('2 balls of yarn in colour 7 and 1 ball for the fringe'), L('5 mm needles with a cable'), L('Row 1: knit to the end of the row.')],
      [L('Row 2: purl.')],
    ]
    expect(detectMultiPattern(pages)).toBe(true)
  })
})

// Décision de la propriétaire, 2026-09-24 08:28 : un PDF qui décrit des VARIANTES d'un même
// patron (adulte/enfant, ensemble assorti, tricot/crochet, manches courtes/longues) n'est
// JAMAIS un recueil, même quand chaque variante a son titre, sa liste, ses tailles et ses rangs.
describe('blocking — variantes d’un même patron (jamais un recueil)', () => {
  const L = (text, size = 10) => ({ text, size, bold: false, y: 0 })
  const LANGS = {
    fr: { head: 'Matériel', supply: ['4 pelotes de 50 g', 'Aiguilles circulaires 4 mm'], sizes: ['Tailles : S (M) L', 'Tailles : 2 (4) 6 ans', 'Tailles : 0 (3) 6 mois'], rows: ['Rang 1 : *2 m. end., 2 m. env.*', 'Rang 2 : idem.'] },
    en: { head: 'Materials', supply: ['4 balls of 50 g', '4 mm circular needles'], sizes: ['Sizes: S (M) L', 'Sizes: 2 (4) 6 years', 'Sizes: 0 (3) 6 months'], rows: ['Row 1: *k2, p2*', 'Row 2: as set.'] },
    de: { head: 'Material', supply: ['4 Knäuel à 50 g und 1 Knäuel für den Rand', 'Rundstricknadel 4 mm mit Seil'], sizes: ['Größen: S (M) L', 'Größen: 2 (4) 6 Jahre', 'Größen: 0 (3) 6 Monate'], rows: ['Reihe 1: *2 M rechts, 2 M links*', 'Reihe 2: die Maschen wie sie erscheinen.'] },
    es: { head: 'Materiales', supply: ['4 ovillos de 50 g', 'Agujas circulares de 4 mm'], sizes: ['Tallas: S (M) L', 'Tallas: 2 (4) 6 años', 'Tallas: 0 (3) 6 meses'], rows: ['Vuelta 1: *2 d., 2 r.*', 'Vuelta 2: igual.'] },
  }
  // Trois variantes (le seuil d'un recueil depuis le 2026-09-24 08:41), chacune avec son
  // titre (gros corps), sa liste, ses tailles et ses rangs : tout ce qui fait un recueil,
  // sauf le mot de variante.
  const doc = (lang, main, v1, v2, v3) => {
    const k = LANGS[lang]
    const part = (title, sizes) => [
      [L(title, 24), L(sizes), L(k.head), ...k.supply.map((t) => L(t)), L(k.rows[0])],
      [L(k.rows[1])],
    ]
    return [[L(main, 28), L('Design Rowtine')], ...part(v1, k.sizes[0]), ...part(v2, k.sizes[1]), ...part(v3, k.sizes[2])]
  }
  const FORMES = {
    'adulte / enfant': { fr: ['Pull Mia', 'Version adulte', 'Version enfant', 'Version bébé'], en: ['Mia Sweater', 'Adult version', 'Child version', 'Baby version'], de: ['Pullover Mia', 'Für Erwachsene', 'Für Kinder', 'Für Babys'], es: ['Jersey Mia', 'Talla adulto', 'Talla niño', 'Talla bebé'] },
    'ensemble assorti': { fr: ['Bonnet, snood et mitaines assortis', 'Bonnet', 'Snood', 'Mitaines'], en: ['Matching hat, cowl and mitts', 'Hat', 'Cowl', 'Mitts'], de: ['Passendes Set Mütze, Loop und Stulpen', 'Mütze', 'Loop', 'Stulpen'], es: ['Gorro, cuello y mitones a juego', 'Gorro', 'Cuello', 'Mitones'] },
    'tricot / crochet': { fr: ['Châle Lune', 'Version tricot', 'Version crochet', 'Version tunisienne'], en: ['Moon Shawl', 'Knit version', 'Crochet version', 'Tunisian version'], de: ['Tuch Mond', 'Strickversion', 'Häkelversion', 'Tunesische Version'], es: ['Chal Luna', 'Versión en punto', 'Versión en ganchillo', 'Versión tunecina'] },
    'manches courtes / longues': { fr: ['Pull Mia', 'Manches courtes', 'Manches longues', 'Sans manches'], en: ['Mia Sweater', 'Short sleeves', 'Long sleeves', 'Sleeveless'], de: ['Pullover Mia', 'Kurzarm', 'Langarm', 'Ärmellos'], es: ['Jersey Mia', 'Manga corta', 'Manga larga', 'Sin mangas'] },
  }
  for (const [forme, byLang] of Object.entries(FORMES)) {
    for (const [lang, [main, v1, v2, v3]] of Object.entries(byLang)) {
      it(`${forme} (${lang}) : trois patrons comptés, mais jamais un recueil`, () => {
        const pages = doc(lang, main, v1, v2, v3)
        const a = analyzeMultiPattern(pages)
        expect(a.patterns).toBe(3) // sans la garde, ce serait un recueil
        expect(a.variant).toBeTruthy()
        expect(detectMultiPattern(pages)).toBe(false)
      })
    }
  }

  it('étiquette de variante en corps courant, juste avant son en-tête : reconnue aussi', () => {
    const k = LANGS.fr
    const pages = [
      [L('Pull Mia', 28), L(k.sizes[0]), L('Pour l’adulte'), L(k.head), ...k.supply.map((t) => L(t)), L(k.rows[0])],
      [L(k.rows[1])],
      [L(k.sizes[1]), L('Pour l’enfant'), L(k.head), ...k.supply.map((t) => L(t)), L(k.rows[0])],
      [L(k.rows[1])],
      [L(k.sizes[2]), L('Pour le bébé'), L(k.head), ...k.supply.map((t) => L(t)), L(k.rows[0])],
      [L(k.rows[1])],
    ]
    expect(analyzeMultiPattern(pages)).toMatchObject({ patterns: 3 })
    expect(detectMultiPattern(pages)).toBe(false)
  })

  it('le même document sans mot de variante reste un recueil (la garde ne vise que les variantes)', () => {
    const pages = doc('fr', 'Trois modèles', 'Bonnet Alpin', 'Écharpe Brume', 'Mitaines Givre')
    expect(analyzeMultiPattern(pages).variant).toBeNull()
    expect(detectMultiPattern(pages)).toBe(true)
  })
})

describe('blocking — cumul de raisons', () => {
  const L = (text, size = 10) => ({ text, size, bold: false, y: 0 })
  // MIN_BOOK_PATTERNS = 3 (tâche 5) : il faut trois patrons, comme dans le recueil de tête de
  // fichier, pour que detectMultiPattern s'arme et que la branche « variante B » du test ait
  // quelque chose à couvrir — avec seulement deux patrons, elle passerait même si
  // computeBlocking ignorait toujours multiPattern.
  it('computeBlocking porte columns, et multiPattern seulement quand le refus est désactivé (variante B)', () => {
    const pages = [
      [L('Bonnet Alpin', 24), L('Matériel', 12), L('2 pelotes de 50 g'), L('Aiguilles 4 mm'), { text: 'x', multiCol: true }],
      [L('Rang 1'), L('Rang 2')],
      [L('Écharpe Brume', 24), L('Fournitures', 12), L('3 pelotes de 50 g'), L('Aiguilles 5 mm')],
      [L('Rang 1'), L('Rang 2')],
      [L('Mitaines Givre', 24), L('Matériel', 12), L('1 pelote de 50 g'), L('Aiguilles 3,5 mm')],
      [L('Rang 1'), L('Rang 2')],
    ]
    expect(detectMultiPattern(pages)).toBe(true)
    const b = computeBlocking(pages)
    expect(b.reasons).toContain('columns')
    expect(b.reasons.includes('multiPattern')).toBe(!MULTI_PATTERN_REJECTS)
  })
})

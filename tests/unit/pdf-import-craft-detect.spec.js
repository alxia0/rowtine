import { describe, it, expect } from 'vitest'
import { detectCraft } from '@/utils/pdf-import/craft-detect'

// Une page construite : une ligne par texte, dans l'ordre.
const page = (...texts) => texts.map((text, i) => ({ text, size: 10, bold: false, y: 800 - i * 12 }))
const accepted = (pages) => {
  const r = detectCraft(pages)
  expect(r, JSON.stringify(r)).toMatchObject({ isPattern: true, reason: null })
  return r
}
const refused = (pages, reason) => {
  const r = detectCraft(pages)
  expect(r, JSON.stringify(r)).toMatchObject({ isPattern: false, reason })
  return r
}

describe('detectCraft : gardiens (textes réels des fixtures, jamais refusés)', () => {
  it('fixture du site vector-pattern.pdf / photo-pattern.pdf', () => {
    accepted([page('Pull Vector Test', 'Corps', 'Rang 1 : monter 104 (108) 112 m.', 'Rang 2 : tricoter à l\'endroit.', 'Répéter ce rang 8 (9) 10 fois.')])
  })
  it('fixture NOMINAL de pdf-import-orchestrator.spec.js', () => {
    accepted([page('Pull Exemple', 'Corps', 'Rang 1 : tricoter toutes les mailles à l’endroit.', 'Rang 2 : tricoter toutes les mailles à l’envers.')])
  })
  it('fixture Mia Cardigan de pdf-import-orchestrator.spec.js', () => {
    accepted([
      page('M I A C A R D I G A N', 'Share your version of the Mia Cardigan on social media with hashtags'),
      page('Sizes:', 'Rang 1 : tricoter toutes les mailles à l’endroit.'),
    ])
  })
  it('fixture de pdf-import-vector-integration.spec.js', () => {
    accepted([
      page('Rang 1 : tricoter toutes les mailles à l’endroit du début à la fin du rang.', 'Rang 2 : tricoter toutes les mailles à l’envers du début à la fin du rang.'),
      page('Diagramme dos'),
    ])
  })
})

describe('detectCraft : vrais patrons, onze langues', () => {
  it('fr tricot', () => accepted([page('Monter 88 mailles sur les aiguilles circulaires 4 mm.', 'Tricoter en côtes 2/2 pendant 5 cm.', 'Échantillon : 22 m. x 30 rangs = 10 x 10 cm.')]))
  it('fr crochet', () => accepted([page('Faire un cercle magique avec 6 ms.', 'Tour 2 : 2 ms dans chaque m. (12 ms)', 'Crochet n° 3,5.')]))
  it('en knit', () => accepted([page('Cast on 88 sts.', 'Row 1: *K2, p2; rep from * to end.', 'K2tog, ssk.', 'Needles: 4 mm circular needles.')]))
  it('en crochet', () => accepted([page('Ch 21.', 'Row 1: Sc in 2nd ch from hook and in each ch across. (20 sc)', 'Hook: 4 mm crochet hook.', 'Gauge: 16 sc x 18 rows = 10 cm.')]))
  it('de', () => accepted([page('60 M mit der Rundnadel 4 mm anschlagen.', 'Im Rippenmuster 2 M re, 2 M li stricken.', 'Maschenprobe: 22 M x 30 R = 10 x 10 cm.')]))
  it('es ganchillo', () => accepted([page('Anillo mágico con 6 pb.', 'Vuelta 2: 2 pb en cada punto (12 pb).', 'Ganchillo de 3,5 mm.')]))
  it('it', () => accepted([page('Avviare 60 m sui ferri circolari n. 4.', 'Lavorare a maglia rasata: 1 f. a dritto, 1 f. a rovescio.', 'Campione: 22 m x 30 f = 10 x 10 cm.')]))
  it('nl', () => accepted([page('Zet 60 st op met rondbreinaald 4 mm.', 'Brei boordsteek: 2 r, 2 av.', 'Stekenverhouding: 22 st x 30 nld = 10 x 10 cm.')]))
  it('da', () => accepted([page('Slå 60 m op på rundpind 4 mm.', 'Strik rib 2 r, 2 vr.', 'Strikkefasthed: 22 m x 30 p = 10 x 10 cm.')]))
  it('no', () => accepted([page('Legg opp 60 m på rundpinne 4 mm.', 'Strikk vrangbord 2 r, 2 vr.', 'Strikkefasthet: 22 m x 30 omg = 10 x 10 cm.')]))
  it('sv', () => accepted([page('Lägg upp 60 m på rundsticka 4 mm.', 'Sticka resår 2 rm, 2 am.', 'Masktäthet: 22 m x 30 v = 10 x 10 cm.')]))
  it('fi', () => accepted([page('Luo 60 s pyöröpuikolle 4 mm.', 'Neulo joustinta 2 o, 2 n.', 'Neuletiheys: 22 s x 30 krs = 10 x 10 cm.')]))
  it('pl', () => accepted([page('Nabrać 60 oczek na druty z żyłką nr 4.', 'Przerabiać ściągaczem 2 o. prawe, 2 o. lewe.', 'Próbka: 22 o. x 30 rz. = 10 x 10 cm.')]))
})

describe('detectCraft : Review Focus', () => {
  it('page de diagramme courte : peu de texte, mais du vocabulaire du métier', () => {
    accepted([page('Diagramme A', 'Légende', '□ = 1 m. end.', '● = 1 jeté', 'Monter 40 m. sur aiguilles 4 mm.')])
  })
  it('patron de tricot qui se termine par une broderie : le lexique contraire ne l’emporte pas', () => {
    const r = accepted([page(
      'Monter 88 mailles sur les aiguilles circulaires 4 mm.', 'Tricoter en côtes 2/2 pendant 5 cm.',
      'Échantillon : 22 m. x 30 rangs = 10 x 10 cm.', 'Broder les yeux au point de tige avec du mouliné DMC 310.',
    )])
    expect(r.contra).toBeGreaterThan(0)
  })
  // Phrases relevées dans corpus-web/hobbii/crochet/fr/trio-crochet-top-fr (tutoriel vidéo).
  const TRIO_FR = [
    'MATÉRIEL', 'Crochet 6 mm', 'Ciseaux', 'Aiguille à laine',
    'Créez votre propre haut tendance en crochet', 'crochetez un haut à la fois simple et époustouflant.',
  ]
  it('patron en vidéo : matériel, verbe du métier et renvoi à la vidéo, sans consigne écrite → accepté', () => {
    const r = accepted([page('TUTORIEL CROCHET - Tutoriel Vidéo', ...TRIO_FR, 'https://www.youtube.com/watch?v=KtG7Y4apOUM')])
    expect(r.instr).toBe(false)
    expect(r.video).toBe(true)
  })
  it('patron en vidéo : c’est bien la règle vidéo qui l’accepte (sans renvoi à une vidéo → refusé)', () => {
    const r = refused([page('TUTORIEL CROCHET', ...TRIO_FR)], 'noCraftVocabulary')
    expect(r.video).toBe(false)
  })
  // Relevé dans corpus-web/ravelry/crochet/en/butter-bloom-flower-en.
  const BUTTER = [
    'C r o c h e t e d b y t e s s', 'T h e B u t t e r B l o o m F l o w e r',
    'P l e a s e n o t e t h a t t h e s t a r t i n g a n d c l o s i n g c h a i n s d o e s',
    'I n a m a g i c c i r c l e m a k e : s t c h 1 , 5 s c , d o n ’ t t i g h t e n y o u r c i r c l e',
    'c o m p l e t e l y y e t , 1 s l s t i n t h e f i r s t s t t o c l o s e',
    'R n d 2 . W o r k o v e r r n d 1 a n d b a c k i n t o t h e m a g i c c i r c l e',
    '* 1 s l s t + c h 2 + 2 d c + c h 2 + 1 s l s t i n e a c h a t a c r o s s , f o',
  ]
  it('texte en lettres espacées (extraction illisible) : pas de verdict, jamais refusé', () => {
    const r = accepted([page(...BUTTER)])
    expect(r.illegible).toBe(true)
  })
  it('lettres espacées dans quelques titres seulement : le verdict reste dû', () => {
    refused([page('F A C T U R E', 'Client : Atelier Dupont', 'Désignation : 3 pelotes de laine', 'Total TTC : 45,00 €')], 'noCraftVocabulary')
  })
  it('une seule ligne espacée, sous le plancher de volume : le verdict reste dû', () => {
    const r = refused([page('C A T A L O G U E 2 0 2 6')], 'noCraftVocabulary')
    expect(r.illegible).toBe(false)
  })
  it('couture en lettres espacées : l’abstention ne l’accepte pas', () => {
    const sp = (t) => [...t].join(' ')
    const r = refused([page(...[
      'Seam allowances of 1.5 cm are included.', 'Cut 2 on the fold, following the grain line.',
      'Apply interfacing to the facing.', 'Topstitch 3 mm from the edge with the sewing machine.',
      'Use a knit fabric such as jersey.', 'Press the seams open with a steam iron.',
    ].map(sp))], 'noCraftVocabulary')
    expect(r.illegible).toBe(false)
  })
  it('page de cotes (Ivy Sweater Schematics) : presque pas de texte courant, pas de verdict', () => {
    // Relevé dans Modèles tricot/Ivy_Sweater_Schematics.pdf (décision de la propriétaire : jamais refusé).
    const r = accepted([page(
      'Centimeter', 'a. Overvidde', 'b. Længde midt bag', 'c. Indvendig ærmelængde', 'd. Overarmsvidde', 'e. Ærmegabsdybde',
      'Inches', 'a. Bust circumference', 'b. Length mid back', 'c. Inner sleeve length', 'd. Upper arm circumference', 'e. Armhole depth',
      'IVY SWEATER', 'XXS XS S M L XL 2XL 3XL 4XL 5XL',
      '92 97 102 107 112 122 130 140 150 158', '52 54 56 58 60 61 62 63 67 67', '46 46 46 46 46 45 44 42 42 40',
      '31 33 33 34 36 38 41 43 46 49', '21 21 21 21 22 23 24 25 27 29', 'XXS XS S M L XL 2XL 3XL 4XL 5XL',
      '36¼ 38¼ 40¼ 42¼ 44 48 51¼ 55 59 62¼', '20½ 21¼ 22 22¾ 23½ 24 24½ 24¾ 26½ 26½', '18 18 18 18 18 17¾ 17¼ 16½ 16½ 15¾',
      '12¼ 13 13 13½ 14¼ 15 16¼ 17 18 19¼', '8¼ 8¼ 8¼ 8¼ 8¾ 9 9½ 9¾ 10¾ 11½',
      'Mette Wendelboe Okkels ©COPYRIGHT 2025', 'www.petiteknit.com // Instagram: @petiteknit',
    )])
    expect(r.tabular).toBe(true)
  })
  it('facture chiffrée : le texte courant suffit à juger, pas d’abstention', () => {
    const r = refused([page(
      'Invoice 2026-118', 'Bill to: Atelier Dupont, 12 rue des Lilas, 75011 Paris',
      'Description Qty Unit price Amount', 'Merino yarn 50 g 3 4.50 13.50', 'Shipping 1 6.90 6.90',
      'Subtotal 20.40', 'Tax 20 % 4.08', 'Total 24.48', 'Payment due within 30 days by bank transfer.',
    )], 'noCraftVocabulary')
    expect(r.tabular).toBe(false)
  })
  it('catalogue de laines : aiguilles et échantillon, mais aucune consigne → refusé', () => {
    const r = refused([page(
      'Merino Soft', '100 % laine mérinos, pelote de 50 g = 125 m.',
      'Aiguilles 4 mm. Échantillon : 22 m. x 30 rangs = 10 x 10 cm.', 'Lavage en machine à 30 °C.',
      'Coloris disponibles : 01 Écru, 02 Gris, 03 Rouge.',
    )], 'noCraftVocabulary')
    expect(r.instr).toBe(false)
  })
})

describe('detectCraft : catalogues et sondes de la revue (matériel et échantillon ne valent jamais consigne)', () => {
  it('fr : laine à tricoter, aiguilles et échantillon en mailles x rangs → refusé', () => {
    refused([page('Laine à tricoter, pelote de 50 g', 'Aiguilles 4 mm. Échantillon : 22 mailles x 30 rangs')], 'noCraftVocabulary')
  })
  it('fr : coton à crochet, crochet 3 mm, « tricot et crochet » → refusé', () => {
    refused([page('Coton à crochet', 'Crochet 3 mm', 'tricot et crochet')], 'noCraftVocabulary')
  })
  it('fr : échantillon abrégé « 22 m x 30 rgs » → refusé', () => {
    refused([page('Merino Soft', 'Laine à tricoter, pelote de 50 g = 125 m.', 'Aiguilles 4 mm. Échantillon : 22 m x 30 rgs = 10 x 10 cm.')], 'noCraftVocabulary')
  })
  it('en : yarn for knitting, needles et gauge en sts x rows → refusé', () => {
    const r = refused([page('Merino Soft', '100% merino wool yarn for knitting, 50 g = 125 m.', 'Needles 4 mm. Gauge: 22 sts x 30 rows = 10 x 10 cm.', 'Machine wash 30 °C.')], 'noCraftVocabulary')
    expect(r.instr).toBe(false)
  })
  it('de : Garn zum Stricken, Nadeln et Maschenprobe « 22 M. und 30 R. » → refusé', () => {
    const r = refused([page('Merino Soft', 'Garn zum Stricken, 50 g = 125 m.', 'Nadeln Nr. 4 mm. Maschenprobe: 22 M. und 30 R. = 10 x 10 cm.')], 'noCraftVocabulary')
    expect(r.instr).toBe(false)
  })
  it('es : hilo para tejer, agujas et muestra « 22 p. x 30 v. » → refusé', () => {
    const r = refused([page('Merino Soft', 'Hilo para tejer, ovillo de 50 g = 125 m.', 'Agujas 4 mm. Muestra: 22 p. x 30 v. = 10 x 10 cm.')], 'noCraftVocabulary')
    expect(r.instr).toBe(false)
  })
})

describe('detectCraft : autres loisirs et documents sans rapport', () => {
  it('couture (fr) → otherCraft', () => refused([page('Robe Capucine', 'Valeurs de couture de 1 cm comprises.', 'Placer les pièces sur le droit-fil du tissu.', 'Coudre endroit contre endroit, puis surfiler les bords.', 'Entoilage thermocollant : 50 cm.')], 'otherCraft'))
  it('couture (en) qui parle de « knit fabric » → otherCraft', () => refused([page('Seam allowances of 1.5 cm are included.', 'Cut 2 on the fold, following the grain line.', 'Apply interfacing to the facing.', 'Topstitch 3 mm from the edge with the sewing machine.', 'Use a knit fabric such as jersey.')], 'otherCraft'))
  it('point de croix → otherCraft', () => refused([page('Grille de broderie', 'Toile Aïda 14 points, 50 x 50 cm.', 'Broder au point de croix avec 2 brins de mouliné.', 'DMC 310 noir, DMC 321 rouge, DMC 666 rouge vif.', 'Commencer au centre de la grille.')], 'otherCraft'))
  it('macramé → otherCraft', () => refused([page('Suspension en macramé', 'Corde de coton 5 mm, 30 m.', "Faire 12 têtes d'alouette sur l'anneau en bois.", 'Enchaîner 6 rangs de nœuds plats.')], 'otherCraft'))
  it('tissage → otherCraft', () => refused([page('Écharpe tissée sur métier à tisser à peigne envergeur', 'Ourdir 120 fils de chaîne.', 'Tisser en toile, 8 duites par cm.')], 'otherCraft'))
  it('facture → noCraftVocabulary', () => refused([page('Facture n° 2026-118', 'Client : Atelier Dupont', 'Désignation : 3 pelotes de laine', 'Total TTC : 45,00 €')], 'noCraftVocabulary'))
  it('article → noCraftVocabulary', () => refused([page('Abstract', 'We propose a method for measuring the thermal conductivity of thin films.', 'Results show a 12 % improvement.')], 'noCraftVocabulary'))
  it('aucune page → noCraftVocabulary', () => refused([], 'noCraftVocabulary'))
})

// Corpus négatif enrichi en fr, de, es le 2026-09-24 : extraits synthétiques bâtis sur la forme des
// cas relevés (aucun texte du corpus recopié), chacun accepté à tort par le détecteur d'avant.
describe('detectCraft : corpus négatif fr, de, es (relevé 2026-09-24)', () => {
  it('fr : manuel de couture qui parle de tissage, de bâti et d’« aiguille à l’envers » → otherCraft', () => {
    // Forme de couture/cdeacf-couture-au-fil-des-jours-fr : score 3 (fr-endroit sur « à l'envers »,
    // en-crochet-word sur le crochet porte-bobine), contra 4 ; le bâti fait passer contra à 5.
    const r = refused([page(
      'Le porte-bobine : c’est le crochet sur lequel tu mets ta bobine.',
      'Le pied-de-biche maintient le tissu. Place le patron sur le droit fil.',
      'Avant de coudre, fais un bâti à la main. Ce repère t’évite de mettre l’aiguille à l’envers.',
      'L’homme a inventé le tissage bien avant la machine.',
    )], 'otherCraft')
    expect(r.contraMarkers).toContain('c-couture-fr-tissu')
  })
  it('de : tissage où l’on « anschlagen » la trame au peigne et enfile avec une Häkelnadel → otherCraft', () => {
    // Forme de tissage/archaicarts-kettaufzug-de : de-anschlag (le tassement de la trame) et de-nadel
    // (l'outil d'enfilage) donnaient 4 contre un seul marqueur contraire.
    const r = refused([page(
      'Material: Webrahmen und Schiffchen, Garn für Kette und Schuss.',
      'Einziehhilfe für die Kette: Einziehhaken oder feine Häkelnadel.',
      'Den Kettfaden durch Schlitz und Loch ziehen.',
      'Den Schussfaden einlegen, den Kamm aus der Halterung nehmen und damit anschlagen.',
    )], 'otherCraft')
    expect(r.markers).not.toContain('de-anschlag')
  })
  it('de : « anschlagen » d’un nombre de mailles reste une consigne de tricot', () => {
    expect(detectCraft([page('Maschen anschlagen und 4 cm im Bündchenmuster stricken.')]).markers).toContain('de-anschlag')
    expect(detectCraft([page('Mit Farbe A 37 Lm anschlagen.')]).markers).toContain('de-anschlag')
    expect(detectCraft([page('Für das linke Vorderteil 42 (46) M anschlagen.')]).markers).toContain('de-anschlag')
  })
  it('de : Makramee, Plattstich et Stickvorlage relevés → otherCraft', () => {
    refused([page('Makramee-Blumenampel', 'Schnur aus Baumwolle, 4 mm, 20 m.', 'Die Fäden am Ring befestigen.')], 'otherCraft')
    refused([page('Stickvorlage Blumenkranz', 'Blätter im Plattstich, Blütenmitten mit Knötchenstich.')], 'otherCraft')
  })
  it('de : Webkante (Schnittmuster) → otherCraft', () => {
    refused([page('Kinderschürze', 'Stoffbruch parallel zur Webkante legen.', 'Schnittteile zuschneiden.')], 'otherCraft')
  })
  it('es : costura (máquina de coser, entretela, hilvanar) → otherCraft', () => {
    refused([page('Cómo coser', 'Ajuste la máquina de coser a puntada recta.', 'Planche la entretela por el revés.', 'Hilvanar derecho con derecho antes de coser.')], 'otherCraft')
  })
  it('es : macramé en nudos cuadrados y de alondra, bordado con bastidor → otherCraft', () => {
    refused([page('Llavero', 'Cordón encerado de 1 mm.', 'Nudo de alondra sobre la argolla, luego 10 nudos cuadrados.')], 'otherCraft')
    refused([page('Guía de bordado', 'Tensa la tela en el bastidor de 15 cm.', 'Hilo de algodón, 2 hebras.')], 'otherCraft')
  })
  it('es : un patrón de punto dont la seule consigne est le « punto elástico » reste accepté', () => {
    // Gardien du relevé : retirer « punto elástico » refusait un vrai patron (Hobbii Sif Sweater, es),
    // et c'est le mot qui fait passer le catalogue Casasol, laissé accepté faute de mieux.
    accepted([page('Agujas circulares de 4 mm.', 'Tejer 6 cm en punto elástico.', 'Muestra: 22 p x 30 v = 10 x 10 cm.')])
  })
})

describe('detectCraft : mécanique', () => {
  it('un marqueur répété compte une fois', () => {
    const r = refused([page(...Array.from({ length: 40 }, () => 'Tricoter.'))], 'noCraftVocabulary')
    expect(r.markers).toEqual(['fr-tricoter'])
    expect(r.score).toBe(1)
  })
  it('frontières Unicode : une abréviation collée à une lettre ne compte pas', () => {
    expect(detectCraft([page('12 msn')]).markers).not.toContain('fr-crochet-pts')
    expect(detectCraft([page('12 ms,')]).markers).toContain('fr-crochet-pts')
  })
})

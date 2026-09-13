import { describe, it, expect } from 'vitest'
import { stripBoilerplate } from '@/utils/pdf-import/boilerplate'

const textes = (pages) => pages.flat().map((l) => l.text)

describe('stripBoilerplate — mention « usage personnel uniquement »', () => {
  it('retire « for personal use only » (ligne réelle, PDF Mia Cardigan v1.1)', () => {
    const pages = [[
      { text: 'Pattern and items knitted using this pattern are for personal use only.', y: 700 },
      { text: 'Row 1 (WS): purl to M8.', y: 660 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain(
      'Pattern and items knitted using this pattern are for personal use only.',
    )
    expect(kept).toContain('Row 1 (WS): purl to M8.')
  })

  it('ne mord pas une instruction contenant « personal » hors de la formule complète', () => {
    const pages = [[
      { text: 'Adjust for your personal gauge before casting on.', y: 700 },
    ]]
    expect(textes(stripBoilerplate(pages))).toContain(
      'Adjust for your personal gauge before casting on.',
    )
  })
})

describe('stripBoilerplate — bug critique : rangs de patron pris pour un en-tête répété', () => {
  // Reproduit blueberry-picking-en-77762884 (DROPS, crochet, anglais) : ROUND 4/5/6
  // tombent en bas de la page 1, ROUND 7/8/9 en haut de la page 2. Une fois normalisés
  // par norm() (chiffres -> #), ces six rangs partagent EXACTEMENT le même gabarit
  // (« round #: * # single crochet in each of the first/next # stitches, … »).
  // edgeLines() les marque comme bord de page (bande haute/basse à 12 %) ; comme le
  // gabarit normalisé se répète sur >= 2 pages, stripBoilerplate() les prenait pour un
  // en-tête/pied structurel et les supprimait TOUS — six tours de patron consécutifs,
  // sans aucun avertissement. ROUND 3 (gabarit différent : « in the first/next stitch »
  // sans « each of » ni second chiffre) et ROUND 10 (au milieu de la page 2) doivent
  // rester, ainsi que la vraie répétition structurelle (bannière de tirets).
  const round = (n, prevCount, nextCount, y) => ({
    text: `ROUND ${n}: * 1 single crochet in each of the first/next ${prevCount} stitches, 2 single crochets in the next stitch *, work from *-* to end of round = ${nextCount} stitches.`,
    y,
  })

  const pages = [
    [
      { text: 'ROUND 1: Work 6 single crochets around the ring with ice blue.', y: 700 },
      { text: 'Now work STRIPES – read description above.', y: 650 },
      { text: 'ROUND 2: Work 2 single crochets in each single crochet = 12 stitches.', y: 600 },
      {
        text: 'ROUND 3: * 1 single crochet in the first/next stitch, 2 single crochets in the next stitch *, work from *-* to end of round = 18 stitches.',
        y: 550,
      },
      round(4, 2, 24, 100),
      round(5, 3, 30, 60),
      round(6, 4, 36, 20),
    ],
    [
      round(7, 5, 42, 630),
      round(8, 6, 48, 660),
      round(9, 7, 54, 700),
      { text: 'ROUND 10: * 1 single crochet in each of the first/next 8 stitches, 2 single crochets in the next stitch *, work from *-* to end of round = 60 stitches.', y: 300 },
      { text: '-------------------------------------------------------', y: 50 },
    ],
    [
      { text: 'Some other page content in the middle.', y: 400 },
      { text: '-------------------------------------------------------', y: 700 },
    ],
  ]

  it('garde ROUND 4 à 9 même pris en bord de page et répétés sur plusieurs pages', () => {
    const kept = textes(stripBoilerplate(pages))
    for (const n of [4, 5, 6, 7, 8, 9]) {
      expect(kept.some((t) => t.startsWith(`ROUND ${n}:`))).toBe(true)
    }
  })

  it('garde ROUND 1, 2, 3 et 10 (déjà non affectés)', () => {
    const kept = textes(stripBoilerplate(pages))
    for (const n of [1, 2, 3, 10]) {
      expect(kept.some((t) => t.startsWith(`ROUND ${n}:`))).toBe(true)
    }
  })

  it('filtre toujours une vraie bannière de tirets répétée en bord de page', () => {
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('-------------------------------------------------------')
  })

  it('garde des rangs Hobbii notés « R N » (pas seulement « ROUND N ») coupés par un saut de page', () => {
    // Notation dominante du corpus Hobbii (« R 23 », « R 24 »… vérifié sur
    // kawaii-watermelon-rattle-en-3555f8af). Même mécanisme que ci-dessus, mais avec
    // le mot de rang abrégé à la seule lettre « R » — couvert par une branche distincte
    // de ROW_START_RE, pas par le mot « round »/« row » explicite.
    const rRow = (n, y) => ({
      text: `R ${n}: 2 sc, dec 1 st, 13 sc, dec 1 st, 3 sc, dec 1 st, 13 sc, dec 1 st, 1 sc (36),`,
      y,
    })
    const hobbiiPages = [
      [rRow(4, 100), rRow(5, 60), rRow(6, 20)],
      [rRow(7, 700), rRow(8, 660), rRow(9, 620)],
    ]
    const kept = textes(stripBoilerplate(hobbiiPages))
    for (const n of [4, 5, 6, 7, 8, 9]) {
      expect(kept.some((t) => t.startsWith(`R ${n}:`))).toBe(true)
    }
  })

  // (revue) La copie LOCALE de ROW_START_RE avait divergé de
  // l'originale (segment.js, exportée) : « rd » (bernadette-tote-bag-de, commit 1d525f45)
  // et la branche ordinale pointée « 1.Reihe »/« 3.Runde » (commit 7ef3c237) lui
  // manquaient — le garde ci-dessus ne protégeait plus ces notations, supprimées en bloc
  // comme « en-tête répété » dès qu'un saut de page les faisait tomber en bande haute/
  // basse avec des gabarits normalisés identiques. La copie est remplacée par l'import
  // de la source unique (segment.js) : ces tests verrouillent chaque branche récente.
  it('garde des rangs « Rd N » (crochet allemand) de même gabarit en bord de page', () => {
    const rd = (n, y) => ({
      text: `Rd ${n}: 3 Lm, 1 M in jede nächste M häkeln, 1 M zunehmen = ${12 + n} M.`,
      y,
    })
    const pages = [
      [rd(3, 100), rd(4, 60), rd(5, 20)],
      [rd(6, 630), rd(7, 660), rd(8, 700)],
    ]
    const kept = textes(stripBoilerplate(pages))
    for (const n of [3, 4, 5, 6, 7, 8]) {
      expect(kept.some((t) => t.startsWith(`Rd ${n}:`))).toBe(true)
    }
  })

  it('garde des rangs ordinaux pointés « 1. Reihe: » espacé et « 1.Reihe »/« 3.Runde » collés en bord de page', () => {
    // Espacé : déjà couvert par BARE_ITEM_RE (item numéroté nu) — assertion de
    // non-régression. Collé : seule la branche ordinale de ROW_START_RE (segment.js)
    // le reconnaît, BARE_ITEM_RE exige un espace après le point.
    const spaced = (n, y) => ({
      text: `1. Reihe: (rechte Seite) ${n} M re stricken, dabei alle 2 M zunehmen = ${2 * n} M.`,
      y,
    })
    const glued = (n, y) => ({
      text: `1.Reihe (rechte Seite): ${n} M re stricken, dabei alle 2 M zunehmen = ${2 * n} M.`,
      y,
    })
    const runde = (n, y) => ({
      text: `3.Runde: ${n} M häkeln, dabei alle 2 M zunehmen = ${2 * n} M.`,
      y,
    })
    for (const mk of [spaced, glued, runde]) {
      const pages = [
        [mk(20, 100), mk(22, 60), mk(24, 20)],
        [mk(26, 630), mk(28, 660), mk(30, 700)],
      ]
      expect(textes(stripBoilerplate(pages))).toHaveLength(6)
    }
  })
})

describe('stripBoilerplate — le vrai boilerplate reste filtré (garde non-régression)', () => {
  it('filtre le pied de page Hobbii et la pagination « Page N »', () => {
    const pages = [[
      { text: 'Hobbii Friends - Super Cute Design - Copyright © 2019 - All rights reserved. Page 1', y: 50 },
      { text: 'Powered by TCPDF (www.tcpdf.org)', y: 20 },
      { text: 'hobbii-pattern-sku:pattern-1011-194-2960', y: 780 },
      { text: 'R 1: 12 sc, 3 sc in same st, 11 sc, inc 1 st (28),', y: 400 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept.some((t) => t.includes('Powered by TCPDF'))).toBe(false)
    expect(kept.some((t) => t.includes('Copyright © 2019'))).toBe(false)
    expect(kept.some((t) => t.startsWith('hobbii-pattern-sku:'))).toBe(false)
    expect(kept).toContain('R 1: 12 sc, 3 sc in same st, 11 sc, inc 1 st (28),')
  })

  it('filtre la formule de clôture DROPS (Garnstudio) et son lien', () => {
    const pages = [[
      { text: 'Have you finished this pattern?', y: 750 },
      { text: 'Do you need help with this pattern?', y: 700 },
      {
        text: "You'll find 8 tutorial videos, a Comments/Questions area and more by visiting the pattern on garnstudio.com.",
        y: 650,
      },
      { text: 'ROUND 12: Work 1 single crochet in each stitch to end of round.', y: 300 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('Have you finished this pattern?')
    expect(kept).not.toContain('Do you need help with this pattern?')
    expect(kept.some((t) => t.includes('garnstudio.com'))).toBe(false)
    expect(kept).toContain('ROUND 12: Work 1 single crochet in each stitch to end of round.')
  })
})

describe('stripBoilerplate — bug 2 : fragment d’URL enroulée sur deux lignes', () => {
  it('retire le reste du slug après un lien boutique coupé par la mise en page (en)', () => {
    // PDF réel kawaii-watermelon-rattle-en-3555f8af : "http://shop.hobbii.com/kawaii-water"
    // puis, sur la ligne suivante, "melon-rattle" — reste du lien, jamais capté seul.
    const pages = [[
      { text: 'Purchase your yarn here:', y: 700 },
      { text: 'http://shop.hobbii.com/kawaii-water', y: 660 },
      { text: 'melon-rattle', y: 640 },
      { text: 'R 1: 12 sc, 3 sc in same st, 11 sc, inc 1 st (28),', y: 400 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('http://shop.hobbii.com/kawaii-water')
    expect(kept).not.toContain('melon-rattle')
    expect(kept).toContain('R 1: 12 sc, 3 sc in same st, 11 sc, inc 1 st (28),')
  })

  it('retire le reste du slug après un lien boutique coupé par la mise en page (es)', () => {
    // PDF réel kawaii-strawberry-pram-chain-es-820b5ca4.
    const pages = [[
      { text: 'Compra la lana aquí:', y: 700 },
      { text: 'http://shop.hobbii.es/kawaii-fresa', y: 660 },
      { text: '-cadena-para-carrito', y: 640 },
      { text: '1 aum - teje 2 pb en el mismo punto', y: 400 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('http://shop.hobbii.es/kawaii-fresa')
    expect(kept).not.toContain('-cadena-para-carrito')
    expect(kept).toContain('1 aum - teje 2 pb en el mismo punto')
  })

  it('ne mord pas une ligne à tirets qui ne suit pas un lien boutique', () => {
    const pages = [[
      { text: 'Change to a smaller or a larger hook size.', y: 700 },
      { text: 'anti-clockwise-turn', y: 660 },
    ]]
    expect(textes(stripBoilerplate(pages))).toContain('anti-clockwise-turn')
  })
})

describe('stripBoilerplate — bug 3 : mentions légales non répétées prises pour des rangs', () => {
  it('filtre les trois lignes légales de brianza-shawl-de (PDF réel, une seule occurrence chacune)', () => {
    const pages = [[
      { text: '1 M wie zum Rechtsstricken abheben, 2 M rechts zusammenstricken und die abgehobene M überziehen.', y: 700 },
      { text: 'Bitte beachten Sie die Nutzungsbedingungen zu dieser Anleitung auf unserer Webseite.', y: 660 },
      { text: '© Copyright MEZ GmbH, 2024.', y: 630 },
      { text: 'MEZ GmbH · Schnewlinstraße 12 · D-79098 Freiburg, Germany · www.regiayarns.com', y: 600 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('Bitte beachten Sie die Nutzungsbedingungen zu dieser Anleitung auf unserer Webseite.')
    expect(kept).not.toContain('© Copyright MEZ GmbH, 2024.')
    expect(kept).not.toContain('MEZ GmbH · Schnewlinstraße 12 · D-79098 Freiburg, Germany · www.regiayarns.com')
    expect(kept).toContain(
      '1 M wie zum Rechtsstricken abheben, 2 M rechts zusammenstricken und die abgehobene M überziehen.',
    )
  })
})

describe('stripBoilerplate — bug 4 : boilerplate DROPS allemand', () => {
  it('filtre la question de clôture allemande à ordre des mots inversé', () => {
    const pages = [[
      { text: 'Haben Sie diese Anleitung nachgearbeitet?', y: 700 },
      { text: 'ab dem Pfeil im Diagramm in Hin- und Rück-Reihen häkeln.', y: 660 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('Haben Sie diese Anleitung nachgearbeitet?')
    expect(kept).toContain('ab dem Pfeil im Diagramm in Hin- und Rück-Reihen häkeln.')
  })

  it('filtre les deux moitiés de phrase orphelines (fragments non recollés)', () => {
    const pages = [[
      {
        text: 'Sie finden 7 Videotutorials, einen Kommentar/Fragen-Bereich und vieles mehr, wenn sie die Anleitung bei garnstudio.com',
        y: 700,
      },
      { text: 'aufrufen.', y: 680 },
      {
        text: 'Haben Sie ein DROPS Garn verwendet, um diese Anleitung nachzuarbeiten? Dann haben Sie Anspruch auf Hilfe von dem Laden,',
        y: 660,
      },
      { text: 'bei dem Sie das Garn gekauft haben.', y: 640 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('aufrufen.')
    expect(kept).not.toContain('bei dem Sie das Garn gekauft haben.')
  })

  it('filtre la mention copyright allemande sans le mot « copyright »', () => {
    const pages = [[
      {
        text: '© 1982-2026 DROPS Design A/S. Wir besitzen alle Rechte. Dieses Dokument, einschließlich aller Untersektionen, hat',
        y: 700,
      },
      {
        text: 'Urheberrechte. Mehr dazu, was Sie mit unseren Anleitungen machen können, finden Sie ganz unten auf der Seite zu jeder',
        y: 680,
      },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept.some((t) => t.startsWith('Urheberrechte. Mehr dazu'))).toBe(false)
  })
})

describe('stripBoilerplate — vague 7 : satellites du bandeau Hobbii et queues DROPS', () => {
  // Le filtrage se fait ligne à ligne AVANT le recoll des phrases coupées par la mise
  // en page (bug documenté dans boilerplate.js) : la moitié « utile » de chaque formule
  // est déjà filtrée, mais sa queue wrappée ou son intitulé de bandeau survit seul en
  // pleine section Fil/Échantillon. Citations réelles du corpus, formes
  // vérifiées sur le corpus complet (2 972 PDF, pdftotext) : aucune ligne pleine
  // identique n'y apparaît comme contenu légitime.

  it('filtre le titre du bandeau hashtags et la formule de clôture allemands (sofie/viking)', () => {
    const pages = [[
      { text: 'Bestelle hier das Garn', y: 700 },
      { text: 'http://shop.hobbii.de/sofie-pullunder', y: 680 },
      { text: 'Hashtags für die sozialen Medien', y: 660 },
      { text: '#hobbiidesign #hobbiisofie', y: 640 },
      { text: 'Ganz viel Vergnügen!', y: 620 },
      { text: 'Maschenprobe', y: 300 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('Hashtags für die sozialen Medien')
    expect(kept).not.toContain('Ganz viel Vergnügen!')
    expect(kept).toContain('Maschenprobe')
  })

  it('tolère les variantes de clôture observées dans le corpus (☺, «  :) », bang absent)', () => {
    const pages = [[
      { text: 'Ganz viel Vergnügen☺', y: 700 },
      { text: 'Ganz viel Vergnügen :)', y: 680 },
      { text: 'Tricotez joyeusement', y: 660 },
      { text: '¡Pásalo bien tejiendo! ☺', y: 640 },
      { text: 'Maschenprobe', y: 620 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toHaveLength(1) // seul le texte de contrôle survit
    expect(kept).toContain('Maschenprobe')
  })

  it('filtre le bandeau hashtags et la formule de clôture espagnols (primula/universe/cella)', () => {
    const pages = [[
      { text: 'Hashtags para redes sociales', y: 700 },
      { text: '#hobbiidesign #hobbiiprimula', y: 680 },
      { text: '¡Pásalo bien tejiendo!', y: 660 },
      { text: 'Tallas', y: 300 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('Hashtags para redes sociales')
    expect(kept).not.toContain('¡Pásalo bien tejiendo!')
    expect(kept).toContain('Tallas')
  })

  it('filtre le CTA français « Obtenez votre fil et vos accessoires » (toutes formes corpus) et sa clôture (nadia)', () => {
    const pages = [[
      { text: 'Obtenez votre fil et vos accessoires ici:', y: 700 },
      { text: 'Tricotez joyeusement!', y: 680 },
      { text: '18 mailles et 24 tours pour 10 cm', y: 300 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('Obtenez votre fil et vos accessoires ici:')
    expect(kept).not.toContain('Tricotez joyeusement!')
    expect(kept).toContain('18 mailles et 24 tours pour 10 cm')
  })

  it('filtre la queue « ici » wrapée après le CTA (nadia : « Obtenez votre fil et vos accessoires / ici / http://… »)', () => {
    const pages = [[
      { text: 'Obtenez votre fil et vos accessoires', y: 700 },
      { text: 'ici', y: 680 },
      { text: 'http://shop.hobbii.fr/nadia-pull', y: 660 },
      { text: 'Les techniques en vidéos', y: 300 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('Obtenez votre fil et vos accessoires')
    expect(kept).not.toContain('ici')
    expect(kept).toContain('Les techniques en vidéos')
  })

  it('garde un « ici » qui n’est pas la queue du CTA (titre letter-spaced « Commencer ici », butterfly-besties)', () => {
    const pages = [[
      { text: 'Comm', y: 700 },
      { text: 'encer', y: 680 },
      { text: 'ici', y: 660 },
      { text: 'R 1: 12 bs, 3 bs dans le même point', y: 300 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toContain('ici')
  })

  it('filtre les queues DROPS « yarn. » et « about what you can do… » en fin de légende (lemon-heart/sunny-song)', () => {
    const pages = [[
      { text: '=slip 1 stitch as if to knit, knit 2 together and pass the slipped stitch over the knitted together stitches', y: 700 },
      {
        text: "Have you purchased DROPS yarn to make this pattern? Then you are entitled to receive help from the store that sold you the",
        y: 680,
      },
      { text: 'yarn.', y: 660 },
      {
        text: '© 1982-2026 DROPS Design A/S. We reserve all rights. This document, including all its sub-sections, has copyrights. Read more',
        y: 640,
      },
      { text: 'about what you can do with our patterns at the bottom of each pattern on our site.', y: 620 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('yarn.')
    expect(kept.some((t) => t.startsWith('about what you can do'))).toBe(false)
    expect(kept.some((t) => t.startsWith('=slip 1 stitch'))).toBe(true)
  })

  it('garde « yarn. » quand c’est la queue d’une VRAIE instruction wrappée (bow-children, pink-heart)', () => {
    // Mesuré dans le corpus : « …put the sleeve sts on hold on stitch wire/scrap / yarn. »
    // et « …make more rounds with increases. Remember extra / yarn. » — un « ^yarn\.$ »
    // global détruirait ce contenu légitime, d'où la condition contextuelle.
    const pages = [[
      { text: 'On the next rnd, put the sleeve sts on hold on stitch wire/scrap', y: 700 },
      { text: 'yarn.', y: 680 },
      { text: 'K until the first M, (remove M), put the sleeve sts on hold on stitch wire', y: 300 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toContain('yarn.')
  })

  it('filtre « Anleitung. », mot orphelin du copyright DROPS allemand (sunflower/back-to-the-beach)', () => {
    const pages = [[
      {
        text: 'Urheberrechte. Mehr dazu, was Sie mit unseren Anleitungen machen können, finden Sie ganz unten auf der Seite zu jeder',
        y: 700,
      },
      { text: 'Anleitung.', y: 680 },
      { text: '1 M wie zum Rechtsstricken abheben', y: 300 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('Anleitung.')
    expect(kept).toContain('1 M wie zum Rechtsstricken abheben')
  })

  it('garde « Anleitung. » hors du contexte du pied de page DROPS (aucune ligne précédente « …zu jeder »)', () => {
    const pages = [[
      { text: 'Lesen Sie die Technik am Ende der', y: 700 },
      { text: 'Anleitung.', y: 680 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toContain('Anleitung.')
  })

  it('retire un reste de slug à tiret INITIAL après un lien boutique coupé (primula « -cortos »)', () => {
    const pages = [[
      { text: 'Compra la lana aquí:', y: 700 },
      { text: 'http://shop.hobbii.es/primula-pantalones', y: 680 },
      { text: '-cortos', y: 660 },
      { text: 'Tallas', y: 300 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).not.toContain('http://shop.hobbii.es/primula-pantalones')
    expect(kept).not.toContain('-cortos')
    expect(kept).toContain('Tallas')
  })

  it('ne mord pas un mot simple sans tiret après un lien boutique (garde du fragment étendu)', () => {
    const pages = [[
      { text: 'http://shop.hobbii.fr/nadia-pull', y: 700 },
      { text: 'maschenprobe', y: 680 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toContain('maschenprobe')
  })
})

describe('stripBoilerplate — D3 vague 2 : queues de pied de page coupées en deux (DROPS)', () => {
  // Témoin mesuré to-the-beach-fr-c33da181.pdf.txt l.68-77 : le filtrage du bruit étant
  // ligne à ligne AVANT recollage, la moitié « utile » de chaque phrase de pied de page
  // est filtrée mais sa queue wrappée survit seule (« assistance complémentaire. »,
  // « notre site. », « …la page du modèle » avant « sur garnstudio.com »).

  it('retire la queue APRÈS une ligne de pied de page filtrée (cascade avant)', () => {
    const pages = [[
      { text: 'Un vrai rang de travail ici, tricoter à l’endroit', y: 30 },
      { text: 'Vous avez acheté le fil DROPS pour réaliser ce modèle ? Vous pouvez alors contacter le magasin qui vous a vendu le fil pour toute', y: 92 },
      { text: 'assistance complémentaire.', y: 94 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toEqual(['Un vrai rang de travail ici, tricoter à l’endroit'])
  })

  it('retire la queue AVANT une ligne filtrée courte (cascade arrière)', () => {
    const pages = [[
      { text: 'Un vrai rang de travail ici, tricoter à l’endroit', y: 30 },
      { text: 'Vous trouverez 10 tutoriels vidéo, une rubrique commentaires/questions et plus encore en vous rendant sur la page du modèle', y: 92 },
      { text: 'sur garnstudio.com', y: 94 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toEqual(['Un vrai rang de travail ici, tricoter à l’endroit'])
  })

  it('ne touche pas une continuation minuscule HORS bande après un CTA filtré', () => {
    const pages = [[
      { text: 'Colonne de texte en haut de page', y: 20 },
      { text: 'Obtenez votre fil et vos accessoires ici :', y: 50 },
      { text: 'puis continuer le rang suivant', y: 52 },
      { text: 'Colonne de texte en bas de page', y: 80 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toContain('puis continuer le rang suivant')
  })

  // (premier correctif) Gabarit DROPS le plus fréquent (10 PDF FR + 8 NL) : le pied de page
  // multi-lignes occupe ~30 % du BAS de la page (coords PDF : y bas) — déclencheur
  // hors bande 12 % mais dans la bande de cascade 35 %. Reproduit to-the-beach p3
  // (bloc pied de page mesuré aux positions 0-28 % de l'étendue y).
  it('retire la queue quand le pied de page occupe ~30 % du bas de page (bande de cascade 35 %)', () => {
    const pages = [[
      { text: 'Un vrai rang de travail ici, tricoter à l’endroit', y: 640 },
      { text: 'Vous trouverez 10 tutoriels vidéo, une rubrique commentaires/questions et plus encore en vous rendant sur la page du modèle', y: 200 },
      { text: 'sur garnstudio.com', y: 190 },
      { text: 'notre site.', y: 100 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toEqual(['Un vrai rang de travail ici, tricoter à l’endroit'])
  })

  // (premier correctif) Contretest de la garde « déclencheur = prose » : URL/email filtrés en
  // bande 35 %, voisins minuscules courts — blocs contact/CTA Hobbii compactés, PAS
  // des queues de phrase (« email us at » + email, URL + « maschenprobe »).
  it('ne retire PAS une ligne minuscule voisine d’une URL/email filtré en bande 35 % (garde prose)', () => {
    const pages = [[
      { text: 'Colonne de texte en haut de page', y: 640 },
      { text: 'email us at', y: 210 },
      { text: 'contact@hobbii.com', y: 200 },
      { text: 'http://shop.hobbii.fr/nadia-pull', y: 190 },
      { text: 'maschenprobe', y: 180 },
      { text: 'Colonne de texte en bas de page', y: 100 },
    ]]
    const kept = textes(stripBoilerplate(pages))
    expect(kept).toEqual([
      'Colonne de texte en haut de page',
      'email us at',
      'maschenprobe',
      'Colonne de texte en bas de page',
    ])
  })
})

import { describe, it, expect } from 'vitest'
import { hasActionableVerb, sectionHasActionableProse } from '../../src/utils/pdf-import/actionable-prose'

function sec(...texts) {
  return { lines: texts.map((text) => ({ text })) }
}

describe('sectionHasActionableProse — EN', () => {
  it('détecte un impératif de construction en tête de ligne', () => {
    // hilma-baby-blanket-en (corpus réel)
    expect(
      sectionHasActionableProse(
        sec('Cast on 18 sts with 2 strands of yarn held together.'),
      ),
    ).toBe(true)
  })

  it('détecte un impératif de construction ailleurs dans la ligne (clause avant)', () => {
    // lucia-sweater-en (corpus réel) — clause introductive avant le verbe
    expect(
      sectionHasActionableProse(
        sec(
          'If you do not get the right gauge, change to a smaller or larger needle size and try again.',
        ),
      ),
    ).toBe(true)
  })

  it('détecte un impératif de construction après une négation', () => {
    // melting-pot-shawl-en (corpus réel)
    expect(
      sectionHasActionableProse(
        sec("If the amount of sts is less than 3 don't work the bobble."),
      ),
    ).toBe(true)
  })

  it('ne matche pas la voix passive "is worked" (forme distincte de l\'impératif "work")', () => {
    // klara-baby-sweater-en (corpus réel), section "Structure", non-actionnable
    expect(
      sectionHasActionableProse(
        sec(
          'The sweater is worked top down in one piece.',
          'The yoke is worked back and forth.',
        ),
      ),
    ).toBe(false)
  })

  it('ne matche pas une formule de clôture sans verbe de construction', () => {
    // hilma-baby-blanket-en, eric-doll-en (corpus réel, 10 occurrences)
    expect(sectionHasActionableProse(sec('Enjoy!'))).toBe(false)
  })

  it('renvoie false sur une section sans lignes', () => {
    expect(sectionHasActionableProse({ lines: [] })).toBe(false)
  })
})

describe('sectionHasActionableProse — ES', () => {
  it('détecte l\'impératif tú en tête de ligne', () => {
    // bellis-purse-es-80beb715 (corpus réel, PDF déclencheur du chantier)
    expect(
      sectionHasActionableProse(
        sec(
          'Monta 34 puntos en agujas circulares de 5mm con doble hilo, teje de ida y vuelta a punto arroz.',
        ),
      ),
    ).toBe(true)
  })

  it('détecte l\'impératif tú ailleurs dans la ligne (clause avant)', () => {
    // lou-mini-top-es (corpus réel)
    expect(
      sectionHasActionableProse(sec('Coloca todos los paneles según el esquema.')),
    ).toBe(true)
  })

  it('détecte la forme négative "no cortes" (subjonctif figé, distincte de l\'impératif "corta")', () => {
    // heart-full-of-joy-pillow-es-ba96e958, section LADO 2 (corpus réel, cas déjà
    // escaladé : "LADO 2" restait 100% non cochable avant ce chantier)
    expect(
      sectionHasActionableProse(
        sec(
          'Crea el Lado 2 siguiendo las instrucciones del Lado 1.',
          'Al final de la vuelta 72, NO cortes el hilo C y T todavía.',
        ),
      ),
    ).toBe(true)
  })

  it('détecte la forme négative "no cortes" isolée (sans autre verbe dans la section)', () => {
    // heart-full-of-joy-pillow-es-ba96e958, section LADO 2, ligne 2 seule (corpus
    // réel) — isolée de la ligne "Crea..." pour prouver que c'est bien "cortes"
    // qui déclenche la détection, et non un autre verbe présent ailleurs
    expect(
      sectionHasActionableProse(
        sec('Al final de la vuelta 72, NO cortes el hilo C y T todavía.'),
      ),
    ).toBe(true)
  })

  it('ne matche pas une bannière commerciale sans verbe de construction', () => {
    // pompom-shawl-es (corpus réel)
    expect(sectionHasActionableProse(sec('Compra la lana aquí:'))).toBe(false)
  })

  it('ne matche pas une note générale sans instruction (corpus réel)', () => {
    // fairy-dust-cardi-es, section NOTAS (corpus réel)
    expect(
      sectionHasActionableProse(
        sec(
          'Considera este patrón más como una receta que como un conjunto de instrucciones por vueltas.',
        ),
      ),
    ).toBe(false)
  })

  it('détecte un infinitif de consigne en tête de ligne', () => {
    // cella-cardigan-es (corpus réel) — ES_VERB_RE ne liste que l'impératif tú
    // ("teje", "monta"...), pas l'infinitif ("tejer", "montar"...) massivement employé
    // en tête de ligne dans le corpus réel (tejer 434 occ. brutes, trabajar 214, repetir 57).
    expect(
      sectionHasActionableProse(sec('Tejer el canesú en redondo en aguja circular.')),
    ).toBe(true)
    expect(
      sectionHasActionableProse(
        sec('Trabajar 1 pr en la cad de base de la hoja 1 donde has hecho el último pb.'),
      ),
    ).toBe(true)
    expect(
      sectionHasActionableProse(
        sec('Repetir estas dos v hasta que el elástico mida aprox. 3 cm.'),
      ),
    ).toBe(true)
    expect(
      sectionHasActionableProse(sec('Montar 65 (69) 73 (73) 77 (81) pts en ag. circular de 5 mm.')),
    ).toBe(true)
  })

  it('ne confond PAS l\'infinitif-consigne avec le substantif verbal derrière une préposition', () => {
    // uranus-kids-sweater-es, to-the-beach-fr-style (corpus réel ES) — "Al tejer"/"Para
    // trabajar" : le mot qui précède l'infinitif (préposition/article) est TOUJOURS le
    // premier mot réel de la ligne, jamais l'infinitif lui-même ; l'ancrage en tête de
    // ligne suffit donc à exclure ces tournures sans règle d'exclusion séparée.
    expect(
      sectionHasActionableProse(
        sec('Al tejer las secciones de jacquard, utiliza dos colores diferentes.'),
      ),
    ).toBe(false)
    // (antanilla-lace-cardigan-es, kvitka-textured-flower-mittens-es — note de matériel,
    // pas une consigne)
    expect(
      sectionHasActionableProse(
        sec('Agujas de 2 mm adecuadas para trabajar circunferencias pequeñas en circular.'),
      ),
    ).toBe(false)
  })

  it('ne confond PAS l\'infinitif-consigne avec le futur narratif ("trabajarás", "terminarás")', () => {
    // dasher-headband-es, penny-socks-es (corpus réel) — "trabajar\b"/"terminar\b" sans
    // garde unicode matcheraient À TORT dans "Trabajarás"/"Terminarás" (le "á" qui suit
    // n'est pas un caractère de mot pour \b en JS sans point de code unicode explicite) :
    // description au futur de ce qui va être fait, pas une consigne à l'infinitif.
    // (isolée de "Luego se cose todo en la diadema" — ce fragment déclenche à part le
    // "cose" impératif de ES_VERB_RE, non lié au comportement testé ici)
    expect(
      sectionHasActionableProse(sec('Trabajarás la cubierta y cada detalle por separado.')),
    ).toBe(false)
    expect(
      sectionHasActionableProse(
        sec('Terminarás con un total de 32 vueltas o 16 repeticiones.'),
      ),
    ).toBe(false)
  })
})

describe('sectionHasActionableProse — FR', () => {
  it('détecte un infinitif-consigne en tête de ligne', () => {
    // baby-couture-set-fr, hilma-baby-blanket-fr (corpus réel)
    expect(
      sectionHasActionableProse(sec('Tricoter jusqu\'à une hauteur de 4 (5) cm.')),
    ).toBe(true)
    expect(
      sectionHasActionableProse(
        sec('Monter 18 m avec 2 brins de fil tenus ensemble.'),
      ),
    ).toBe(true)
  })

  it('détecte un infinitif-consigne négatif en tête ("Ne + infinitif")', () => {
    // berry-sweater-fr (corpus réel)
    expect(
      sectionHasActionableProse(
        sec(
          'Ne couper pas le fil lors du changement de colour, vous le travaillez avec le nouveau fil.',
        ),
      ),
    ).toBe(true)
  })

  it('ne détecte PAS un infinitif narratif au milieu de phrase (biographie)', () => {
    // kvitka-textured-flower-mittens-fr (corpus réel, section biographie designer)
    expect(
      sectionHasActionableProse(
        sec(
          "Tetyana Vyazovska d'Odessa... Sa mère lui a appris à tricoter quand elle avait sept ans.",
        ),
      ),
    ).toBe(false)
  })

  it('ne détecte PAS un infinitif narratif au futur périphrastique (à propos du design)', () => {
    // coralia-tank-fr (corpus réel)
    expect(
      sectionHasActionableProse(
        sec(
          'Nous allons travailler les deux parties séparément et ensuite les coudre ensemble.',
        ),
      ),
    ).toBe(false)
  })

  it('détecte l\'impératif vous n\'importe où dans la ligne', () => {
    // hilma-baby-blanket-fr, athena-sweater-fr, stacking-cubes-with-animals-fr (corpus réel)
    expect(
      sectionHasActionableProse(
        sec('Disposez toutes les pièces selon le schéma fourni.'),
      ),
    ).toBe(true)
    expect(sectionHasActionableProse(sec('Montez 36 m. tricotez le premier tour.'))).toBe(
      true,
    )
    expect(sectionHasActionableProse(sec('Cousez les cornes sur la tête.'))).toBe(true)
  })

  it('EXCLUT délibérément "obtenez" (trouvé dans une bannière commerciale, pas une consigne)', () => {
    // hilma-baby-blanket-fr (corpus réel) — "Obtenez ... ici" type CTA marketing
    expect(sectionHasActionableProse(sec('Obtenez votre réduction ici.'))).toBe(false)
  })

  it('ne détecte pas une formule de clôture sans verbe de construction', () => {
    // hilma-baby-blanket-fr et 7 autres PDF (corpus réel)
    expect(sectionHasActionableProse(sec('Amusez-vous !'))).toBe(false)
  })
})

describe('D1 vague 2 — infinitif de consigne après deux-points (drops FR)', () => {
  it('reconnaît l’infinitif immédiatement après un deux-points', () => {
    expect(hasActionableVerb('Après le marqueur: Crocheter 1 maille serrée dans la première maille serrée')).toBe(true)
    expect(hasActionableVerb('Avant le marqueur: Crocheter jusqu’à ce qu’il reste 2 mailles serrées avant le marqueur')).toBe(true)
    expect(hasActionableVerb('INFO: Augmenter 1 maille de chaque côté')).toBe(true)
  })
  it('les faux positifs narratifs documentés restent exclus', () => {
    expect(hasActionableVerb('Nous allons travailler ce point pendant quelques rangs')).toBe(false)
    expect(hasActionableVerb('…elle lui a appris à tricoter pendant son enfance')).toBe(false)
    expect(hasActionableVerb('Prendre la mesure avant de continuer si nécessaire')).toBe(false)
  })
  it('round 1 — les clefs de légende nues END/ENV n’arment pas l’infinitif après deux-points (hiedra)', () => {
    // Entrées de légende de diagramme (hiedra-shawl-…-fr, sections Jeté/Légende) : la clef
    // de face NUE devant le deux-points n'est pas une amorce de consigne.
    expect(hasActionableVerb('END: glisser à l’envers avec le fil devant')).toBe(false)
    expect(hasActionableVerb('ENV: glisser')).toBe(false)
    // Une clef PARENTHÉSÉE n'est pas une clef nue : la parenthèse brise le lookbehind,
    // la consigne de rang reste armée.
    expect(hasActionableVerb('Rang 2 (ENV): glisser les 3 premières mailles')).toBe(true)
  })
  it('revue finale — la garde END/ENV accepte tout espacement du deux-points', () => {
    // I1 (revue finale) : le lookbehind négatif exigeait exactement UN espace après le
    // deux-points alors que le positif accepte tout espacement — « Materials:DROPS Paris »
    // (segment.js) documente des deux-points sans espace chez DROPS. Le négatif couvre
    // désormais le même spectre : zéro, un, plusieurs espaces.
    expect(hasActionableVerb('END:glisser')).toBe(false)
    expect(hasActionableVerb('ENV:  glisser')).toBe(false)
  })
})

describe('sectionHasActionableProse — DE', () => {
  it('détecte un impératif en tête de ligne', () => {
    // coral-children-s-cardigan-de (corpus réel)
    expect(
      sectionHasActionableProse(
        sec('Arbeite nach der Aufstellung unten für deine Größe.'),
      ),
    ).toBe(true)
  })

  it('détecte un verbe à préverbe séparable même très éloigné en fin de ligne', () => {
    // hilma-baby-blanket-de (corpus réel) — "Schlage" (radical) ... "an" (préverbe,
    // ~19 mots plus loin) : recherche non ancrée, le radical seul suffit à matcher.
    expect(
      sectionHasActionableProse(
        sec(
          'Schlage 18 Maschen mit 2 zusammengehaltenen Fäden mit deiner Lieblingsanschlagmethode an.',
        ),
      ),
    ).toBe(true)
  })

  it('détecte un infinitif rejeté en fin de proposition négative', () => {
    // heart-full-of-joy-pillow-de (corpus réel) — même patron que le cas ES "no cortes",
    // confirmant le même piège dans une 2e langue
    expect(
      sectionHasActionableProse(
        sec('Am Ende von Reihe 72 das Garn NICHT abschneiden.'),
      ),
    ).toBe(true)
  })

  it('détecte un verbe rejeté en fin de subordonnée comparative', () => {
    // outlandish-capelet-de (corpus réel)
    expect(
      sectionHasActionableProse(
        sec(
          'Wie beim Stricken und nicht wie beim Häkeln, am Ende des Projekts die Maschen abketten.',
        ),
      ),
    ).toBe(true)
  })

  it('ne détecte pas une biographie de designer sans instruction', () => {
    // undulate-garter-fan-scarf-de (corpus réel)
    expect(
      sectionHasActionableProse(
        sec('Mary Beth Kelso ist eine in Kalifornien ansässige Strickdesignerin.'),
      ),
    ).toBe(false)
  })

  it('ne détecte pas une formule de clôture sans verbe de construction', () => {
    // outlandish-capelet-de, birch-beanie-de (corpus réel)
    expect(sectionHasActionableProse(sec('Viel Spaß!'))).toBe(false)
  })

  it('détecte un infinitif de consigne en fin de proposition (mode d\'emploi de diagramme)', () => {
    // brianza-shawl-de-7df22b4d (corpus réel, Retours-banc vague3) — mode d'emploi
    // du motif ajouré, 246 caractères, aucun verbe précédemment reconnu (impératif
    // seul dans DE_VERB_RE) : restait une note non cochable malgré 3 infinitifs
    // de consigne réels (stricken, lesen, beginnen).
    expect(
      sectionHasActionableProse(
        sec(
          'Nach Strickschrift in R stricken. Die Hinr von rechts nach links lesen, in den ' +
            'nichtgezeichneten Rückr die M und Umschläge links stricken. Mit den 8 M vor dem ' +
            'Rapport beginnen, die 10 M des Rapports stets wdh., enden mit den 9 M nach dem ' +
            'Rapport.',
        ),
      ),
    ).toBe(true)
  })

  it('détecte "wiederholen" et "beginnen" infinitifs en fin de proposition (corpus réel)', () => {
    // ex-hobbii DE (corpus réel, balayage hobbii+drops/de) — infinitifs isolés
    expect(
      sectionHasActionableProse(sec('Diese 4 Reihen wiederholen, bis der Schal die gewünschte Länge hat.')),
    ).toBe(true)
    expect(sectionHasActionableProse(sec('Mit hellgrau beginnen.'))).toBe(true)
  })

  it('ne confond PAS l\'infinitif-verbe avec le substantif verbal ("beim Stricken")', () => {
    // pascal-unisex-slipover-de (corpus réel) — formule de clôture, "Stricken" est
    // ici le substantif ("le tricot"), précédé de "beim" (bei + dem) : pas une
    // instruction, ne doit pas basculer en rang.
    expect(sectionHasActionableProse(sec('Viel Spaß beim Stricken!'))).toBe(false)
  })

  it('ne détecte pas un infinitif isolé, seul mot d\'une ligne (titre de section)', () => {
    // brianza-shawl-de-7df22b4d (corpus réel) — une page du diagramme porte une section
    // titrée littéralement "Stricken" (rien avant le mot). hasActionableVerb() est aussi
    // appelé sur un mot ISOLÉ par segment.js (looksLikeActionTitle, firstWord d'un titre
    // candidat) : un titre d'une section référence ne doit jamais être confondu avec une
    // consigne de travail au seul motif qu'il partage l'orthographe de l'infinitif.
    expect(sectionHasActionableProse(sec('Stricken'))).toBe(false)
    expect(sectionHasActionableProse(sec('Häkeln'))).toBe(false)
    expect(sectionHasActionableProse(sec('Arbeiten.'))).toBe(false)
  })

  it('ne confond PAS l\'infinitif-verbe avec une forme conjuguée au pluriel non finale', () => {
    // cosy-dolls-conni-de, granny-shawl-jacket-de (corpus réel) — "häkeln" ici est
    // la 3e personne du pluriel ("tricotent/crochètent"), pas en position de verbe
    // final de proposition : note générale sur la tension, pas une instruction.
    expect(
      sectionHasActionableProse(
        sec(
          'Alle häkeln unterschiedlich: manche häkeln mit einer Häkelnadel 2,0 mm und ' +
            'erreichen die gleiche Größe.',
        ),
      ),
    ).toBe(false)
  })

  it('détecte un infinitif suivi d\'une incise parenthétique TERMINALE (corpus réel)', () => {
    // ellie-summer-top-de-3b3fd253 (Retours-banc vague5, section « TRÄGER ») : la
    // ponctuation de fin de clause ne suit pas immédiatement le verbe, une incise
    // s'intercale avant le point — la section entière retombait en `pelote` (aucun
    // kind, rendu blockquote) faute d'autre signal détectable.
    expect(
      sectionHasActionableProse(
        sec('Über die 10 M des Trägers 11-13 cm feste Maschen häkeln (leicht gestreckt gemessen).'),
      ),
    ).toBe(true)
    // amulet-open-cardigan-de-89e92d96 (Retours-banc vague1)
    expect(
      sectionHasActionableProse(sec('2 Reihen im 1x1-Rippenmuster arbeiten (in Hin- und Rückreihen).')),
    ).toBe(true)
    // stanley-the-knitting-bear-de-35a44599 (Retours-banc vague4) — vérifié sur la
    // ligne REFLOWÉE : la parenthèse ne se referme qu'après recollage des lignes PDF.
    expect(
      sectionHasActionableProse(
        sec(
          'Wenn dir das zu schwierig ist, kannst du auch ein einfaches Stück in Reihen ' +
            'häkeln (5-6 Reihen mit festen Maschen, mit einer gelben Reihe in der Mitte).',
        ),
      ),
    ).toBe(true)
    // incise nue en fin de ligne, sans point final (spring-headband-de-cfeb6f9e,
    // « wiederholen (50 M) » — cas déjà couvert par `\s*$`, non régressé par l'ajout).
    expect(sectionHasActionableProse(sec('Diese 4 Reihen wiederholen (50 M)'))).toBe(true)
  })

  it('ne détecte PAS une incise parenthétique NON terminale (garde ponctuation immédiate)', () => {
    // Même risque que « Alle häkeln unterschiedlich: » (garde ci-dessus) sous une forme
    // avec incise : la virgule/deux-points après la parenthèse n'a jamais été observée
    // dans le corpus mesuré — seul un point (ou la fin de ligne) l'a été. Si l'incise
    // n'est pas suivie IMMÉDIATEMENT d'un point/fin de chaîne, ce n'est pas un signal
    // fiable de consigne.
    expect(sectionHasActionableProse(sec('Alle häkeln (und stricken) unterschiedlich.'))).toBe(false)
    expect(sectionHasActionableProse(sec('Manche häkeln (fest), manche locker.'))).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { reflowLines } from '@/utils/pdf-import/reflow'

const L = (text, y = 0, size = 10) => ({ text, y, size, bold: false })

describe('reflowLines — span de répétition ouvert', () => {
  it('recolle un rang crochet coupé après « Répéter de * à * »', () => {
    // Cas réel : châle Classical Attitude (hobbii FR), rang 6 scindé par la colonne.
    const out = reflowLines([
      L('6. *1 ml, sauter 1 m, 1 br dans la m suivante* Répéter de * à *'),
      L('10 fois au total.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('6. *1 ml, sauter 1 m, 1 br dans la m suivante* Répéter de * à * 10 fois au total.')
  })
  it('ne fusionne PAS un rang suivant même après un span de répétition ouvert', () => {
    // Garde : OPEN_REP est testé APRÈS NEW_ITEM_RE → un « 7. … » n'est jamais avalé.
    const out = reflowLines([
      L('Répéter de * à *'),
      L('7. Rang suivant en ms.'),
    ])
    expect(out).toHaveLength(2)
  })
  it('laisse une directive de répétition déjà terminée intacte', () => {
    const out = reflowLines([
      L('Répéter les rangs 9 à 11 au total 17 fois.'),
      L('Bordure'),
    ])
    expect(out).toHaveLength(2)
  })
  it('ne fusionne pas les entrées de glossaire à tiret ASCII (unicorn-pillow)', () => {
    // « ml - … », « ms - … » commençaient par une minuscule → étaient recollées à la ligne
    // précédente en une bouillie. Chacune doit rester une ligne distincte.
    const out = reflowLines([
      L('m - maille'),
      L('ml - maille en l’air'),
      L('ms - maille serrée'),
    ])
    expect(out).toHaveLength(3)
    expect(out.map((l) => l.text)).toEqual(['m - maille', 'ml - maille en l’air', 'ms - maille serrée'])
  })
})

describe('reflowLines — entrées de glossaire à tiret cadratin/en dash (lucent-sweater-en)', () => {
  // Cas réel : glossaire ABBREVIATIONS de Lucent Sweater (Hobbii EN), qui utilise un tiret
  // cadratin « – » (U+2013) au lieu du tiret ASCII « - ». « CO – cast on » se termine par
  // « on », homographe de la préposition anglaise dangling de DANGLING_RE (testée avant la
  // garde symétrique à ASCII_DASH_KV_RE) : sans le nouveau garde-fou, la ligne suivante
  // « C4B – cable 4 back » était avalée dans la même cellule de glossaire, et la clé « C4B »
  // — utilisée plus loin dans le corps du patron pour un point torsadé — disparaissait
  // entièrement du tableau d'abréviations.
  it('ne fusionne pas les 15 entrées du glossaire ABBREVIATIONS malgré « cast on » finissant par un mot-outil', () => {
    const out = reflowLines([
      'CO – cast on',
      'C4B – cable 4 back',
      'C4F – cable 4 front',
      'Inc – increase',
      'K – knit',
      'M1l – make 1 left',
      'M1r – make 1 right',
      'P – purl',
      'Pm – place marker',
      'Rep – repeat',
      'Rnd(s) – round(s)',
      'RS – right side',
      'Sm – slip marker',
      'St(s) – stitch(es)',
      'WS – wrong side',
    ].map((t) => L(t)))
    expect(out).toHaveLength(15)
    expect(out.map((l) => l.text)).toEqual([
      'CO – cast on',
      'C4B – cable 4 back',
      'C4F – cable 4 front',
      'Inc – increase',
      'K – knit',
      'M1l – make 1 left',
      'M1r – make 1 right',
      'P – purl',
      'Pm – place marker',
      'Rep – repeat',
      'Rnd(s) – round(s)',
      'RS – right side',
      'Sm – slip marker',
      'St(s) – stitch(es)',
      'WS – wrong side',
    ])
  })

  it('non-régression (négatif discriminant) : un « nt » qui ressemble à une entrée à tiret cadratin continue de fusionner quand « p » n’en est pas une (a-shaped-maxi-skirt-es)', () => {
    // Cas réel : le vecteur de tailles se termine par un chiffre nu, et la ligne suivante
    // commence par son UNITÉ « cm » suivie d'un tiret cadratin puis d'une remarque — « cm »
    // matche la même forme clé-courte-tiret-définition que « C4B » ci-dessus, mais ici la
    // fusion reste obligatoire (l'unité clôt le vecteur de tailles) : seul le fait que la
    // ligne PRÉCÉDENTE ne matche pas elle-même cette forme distingue ce cas du bug corrigé
    // ci-dessus — la garde est donc restreinte à la CONJONCTION (p ET nt), jamais nt seul.
    const out = reflowLines([
      L('Contorno de cadera: 69 (76) 84 (92) 100 (108) 116'),
      L('cm – ten en cuenta que la falda es de tiro bajo.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Contorno de cadera: 69 (76) 84 (92) 100 (108) 116 cm – ten en cuenta que la falda es de tiro bajo.',
    )
  })

  it('non-régression (négatif discriminant) : une VRAIE suite en minuscule après une entrée à tiret cadratin continue de fusionner', () => {
    // « p » matche la forme (entrée de glossaire complète) mais « nt » ne la matche pas (pas
    // de tiret cadratin en tête) : la garde ne doit bloquer QUE la conjonction des deux
    // formes, pas toute continuation après une entrée à tiret cadratin en général.
    const out = reflowLines([L('CO – cast on'), L('and provisional methods.')])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('CO – cast on and provisional methods.')
  })
})

describe('reflowLines — code couleur A/B/C/D/E vs article anglais « a »/« an »', () => {
  it('ne fusionne pas « fil A » (code couleur) avec le Tour 1 qui suit (sara-doll-fr)', () => {
    // Cas réel : patron « Sara - Doll » (hobbii FR, crochet amigurumi). « fil A » est un
    // code couleur (convention Hobbii A/B/C/D/E), pas l'article anglais « a » — la lettre
    // isolée est en MAJUSCULE. Avant correctif, DANGLING_RE (testé /i) matchait « a » sur
    // le « A » majuscule et court-circuitait NEW_ITEM_RE, qui aurait dû bloquer la fusion
    // devant un nouveau rang.
    const out = reflowLines([
      L('En faire 2 avec le fil A'),
      L('Tour 1: 6 ms dans un cm'),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual(['En faire 2 avec le fil A', 'Tour 1: 6 ms dans un cm'])
  })
  it('« fil D » (autre code couleur du même document) ne fusionne pas non plus', () => {
    const out = reflowLines([
      L('En faire 2 avec le fil D'),
      L('Tour 1: 6 ms dans un cm'),
    ])
    expect(out).toHaveLength(2)
  })
  it('un vrai article anglais minuscule en fin de ligne continue de fusionner (« with a »)', () => {
    // Non-régression : contrairement au code couleur, l'article anglais est toujours en
    // minuscule dans le corpus — il doit continuer à déclencher le raccord de mot pendant.
    const out = reflowLines([
      L('Continue working in the same colour with a'),
      L('contrasting yarn for the next round.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Continue working in the same colour with a contrasting yarn for the next round.')
  })
  it('un vrai article anglais « an » en fin de ligne continue de fusionner', () => {
    const out = reflowLines([
      L('Work the next stitches using an'),
      L('extra strand held together.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Work the next stitches using an extra strand held together.')
  })
})

describe('reflowLines — « : » en fin de ligne suivi d’une parenthèse (mountaintop-pullover-de)', () => {
  it('recolle un label de mesure lettré et sa valeur entre parenthèses coupés par la colonne', () => {
    // Cas réel : patron « Mountaintop Pullover » (hobbii DE, tricot). Le label de mesure
    // « F. Gesamte Länge (…) : » est coupé de sa valeur « (47, 54,5, …) cm » par la colonne.
    // Avant correctif : TERMINAL_RE (ligne 41) bloquait la fusion avant même que la règle
    // « suite ouverte sur parenthèse » (ligne 44) ait sa chance → reference.js reçoit un
    // label sans valeur et JETTE la ligne en silence (perte de contenu, pas juste cosmétique).
    const out = reflowLines([
      L('F. Gesamte Länge (Unterer Rand des Saums bis zum oberen Rand der Halsblende):'),
      L('(47, 54,5, 59,5) (65, 73, 75, 77,5, 82, 83, 84,5) cm'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'F. Gesamte Länge (Unterer Rand des Saums bis zum oberen Rand der Halsblende): (47, 54,5, 59,5) (65, 73, 75, 77,5, 82, 83, 84,5) cm'
    )
  })

  it('ne fusionne PAS un « : » de fin de ligne quand la suite n’est pas entre parenthèses (non-régression)', () => {
    // Garde : un « : » de fin de ligne reste un vrai terminateur quand la ligne suivante
    // n'ouvre pas sur une parenthèse — ex. une étiquette de section suivie d'une nouvelle
    // section (« Abréviations: » → nouvelle section en majuscule).
    const out = reflowLines([
      L('Abréviations:'),
      L('MESURES'),
    ])
    expect(out).toHaveLength(2)
  })

  it('ne fusionne pas un « . » de fin de ligne suivi d’une parenthèse (le correctif cible « : » seulement)', () => {
    // Garde : une vraie fin de phrase (« . ») suivie d'une remarque entre parenthèses ne
    // doit pas fusionner — seul « : » est concerné par l'exception.
    const out = reflowLines([
      L('Rembourrer le corps au fur et à mesure.'),
      L('(voir photo 1)'),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — KV_RE ne doit plus court-circuiter la règle de continuation minuscule', () => {
  // Bug récurrent paliers 5-7 : quand la ligne
  // SUIVANTE (nt) ressemble accidentellement à une entrée « clé: valeur » (KV_RE) tout en
  // étant en réalité la suite d'une phrase de prose coupée par la colonne, KV_RE était testé
  // AVANT la règle de continuation en minuscule (l.64) et bloquait la fusion à tort, cassant
  // la phrase en deux morceaux (perte de contenu en aval dans reference.js, cf. Rigmor #4/#5).

  it('recolle une mesure de prose scindée par la colonne (Rigmor - Jumper, EN)', () => {
    // Cas réel palier 8 : « Length, measured in the middle of front » + « piece: approx.
    // 63 cm » — « piece » matche accidentellement KV_RE (mot-outil anglais, pas une clé
    // d'abréviation) et commence en minuscule : c'est une suite de phrase légitime.
    const out = reflowLines([
      L('Length, measured in the middle of front'),
      L('piece: approx. 63 cm'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Length, measured in the middle of front piece: approx. 63 cm')
  })

  it('recolle « as » + « follows : … » scindé par la colonne (90\'s memories, EN)', () => {
    // Cas réel palier 6 : « …as » + « follows : work 52… » — « follows » matche KV_RE
    // (mot-outil « as follows »), commence en minuscule → suite de phrase légitime.
    const out = reflowLines([
      L('Continue in pattern as'),
      L('follows : work 52 sts, turn.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Continue in pattern as follows : work 52 sts, turn.')
  })

  it('recolle une clause de prose ES scindée (Heart Full of Joy, ES)', () => {
    // Cas réel palier 5 : « que llevas: t… » — « que llevas » matche KV_RE (Alt 2, clé
    // courte multi-tokens) alors que c'est une clause de prose ordinaire.
    const out = reflowLines([
      L('Cinturón de flores que llevas'),
      L('que llevas: te permite ajustar el tamaño.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Cinturón de flores que llevas que llevas: te permite ajustar el tamaño.')
  })

  it('ne fusionne PAS deux entrées de glossaire consécutives à clé minuscule (non-régression)', () => {
    // Garde CRITIQUE : contrairement aux cas de prose ci-dessus, deux VRAIES entrées de
    // glossaire consécutives (clé courte minuscule + séparateur « = ») ne doivent jamais
    // fusionner entre elles, même si la 1re n'a pas de ponctuation terminale et que la 2e
    // commence en minuscule — sinon on recrée le bug unicorn-pillow (déjà corrigé pour le
    // format tiret ASCII) sous sa variante « = »/« : ».
    const out = reflowLines([
      L('ch = chain'),
      L('sc = single crochet'),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual(['ch = chain', 'sc = single crochet'])
  })

  it('ne fusionne PAS un en-tête de glossaire nu avec sa première entrée (non-régression)', () => {
    const out = reflowLines([
      L('Abréviations'),
      L('ch = chain'),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual(['Abréviations', 'ch = chain'])
  })

  it('ne fusionne pas un vrai item clé:valeur suivi d’un NOUVEAU titre majuscule (non-régression)', () => {
    const out = reflowLines([
      L('Aiguilles: 4mm'),
      L('MESURES'),
    ])
    expect(out).toHaveLength(2)
  })

  it('ne fusionne PAS une entrée de glossaire à clé minuscule courte avec la fin de la VALEUR de la ligne précédente (lacey-bandana-fr — non-régression, gate)', () => {
    // Cas réel trouvé au gate (25 réfs) en validant CE correctif : dans un tableau
    // d'abréviations rendu en lignes de tableau, la ligne précédente est la VALEUR de
    // l'entrée précédente (« tricoter 2 mailles ensemble à l'endroit », prose complète,
    // multi-mots, sans ponctuation terminale) et la ligne suivante est une VRAIE nouvelle
    // entrée de glossaire à clé minuscule très courte (« m = maille(s) »). Contrairement aux
    // 3 cas de prose scindée ci-dessus (clé ≥ 5 caractères : piece/follows/que llevas), une
    // clé d'abréviation réelle du corpus est quasi toujours ≤ 3 caractères — la garde de
    // longueur de clé doit empêcher l'exception minuscule de s'appliquer ici.
    const out = reflowLines([
      L('tricoter 2 mailles ensemble à l’endroit'),
      L('m = maille(s)'),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual(['tricoter 2 mailles ensemble à l’endroit', 'm = maille(s)'])
  })

  it('ne fusionne PAS une clé Alt 2 courte à 2 tokens (« ch sp ») malgré une longueur totale égale à un cas de prose (non-régression, mdlab-engine.spec.js)', () => {
    // Garde CRITIQUE : la longueur TOTALE de la clé ne suffit pas à distinguer les 2 familles
    // — « ch sp » (5 caractères, 2 tokens de 2) a EXACTEMENT la même longueur totale que
    // « piece » (5 caractères, 1 token), qui doit lui fusionner. Seul le token le plus long
    // (2 ici, < 4) sépare fiablement les deux cas. Cf. tests/unit/mdlab-engine.spec.js pour le
    // test historique équivalent (« reconnaît une clé KV à deux tokens courts avec « : » »).
    const out = reflowLines([
      L('travail en cours'),
      L('ch sp = chain space'),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual(['travail en cours', 'ch sp = chain space'])
  })
})

describe('reflowLines — branche allemande (isGerman, Piste 2)', () => {
  it('recolle une phrase allemande coupée juste avant un adjectif décliné en attente d’un nom (isGerman: true)', () => {
    // « für die gesamte » : "gesamte" est un adjectif décliné (pas un nom complet) qui
    // annonce un nom encore à venir ("Länge") — signal positif Piste 2 (GERMAN_ADJ_RE),
    // pas un bypass en bloc du test minuscule.
    const out = reflowLines([
      L('Wiederhole diese Reihe für die gesamte'),
      L('Länge des Schals.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Wiederhole diese Reihe für die gesamte Länge des Schals.')
  })

  it('sans isGerman (comportement par défaut), la même coupure allemande reste scindée (non-régression)', () => {
    const out = reflowLines([
      L('Wiederhole diese Reihe für die gesamte'),
      L('Länge des Schals.'),
    ])
    expect(out).toHaveLength(2)
  })

  it('isGerman ne contourne PAS les gardes existantes : une vraie fin de phrase reste séparée', () => {
    const out = reflowLines([
      L('Die Anleitung ist hiermit beendet.'),
      L('Nächstes Kapitel: Zusammennähen'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })

  it('isGerman ne fusionne pas un nouvel item de liste allemand (NEW_ITEM_RE reste prioritaire)', () => {
    const out = reflowLines([
      L('Wiederhole für die gesamte'),
      L('2. Reihe: alle Maschen rechts.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })

  it('isGerman : NEW_ITEM_RE (« Rd ») a priorité sur le signal allemand — un rang ne fusionne jamais même quand la ligne précédente porte un signal positif (non-régression, penny-the-panda-baby-comforter-de)', () => {
    // Bug réel trouvé au câblage bout en bout (24/07) : NEW_ITEM_RE ne reconnaissait pas
    // l'abréviation allemande courte « Rd » (Runde) — jusqu'à 38 rangs consécutifs
    // fusionnaient en un seul paragraphe. Corrigé en étendant NEW_ITEM_RE (cf. Étape 3).
    // Fixture volontairement construit pour ISOLER ce correctif : la ligne précédente se
    // termine par « die gesamte » (matche GERMAN_ADJ_RE) — si NEW_ITEM_RE ne bloquait pas
    // « Rd 6: » en premier, le signal allemand positif fusionnerait à tort. Un fixture qui
    // finit par un simple compte entre parenthèses (comme "(30)") ne teste PAS cette
    // priorité : le signal allemand ne s'y déclenche de toute façon jamais, donc la ligne
    // resterait séparée même sans le correctif NEW_ITEM_RE — ce fixture-ci le prouve vraiment.
    const out = reflowLines([
      L('Stricke weiter für die gesamte'),
      L('Rd 6: (4 fM, Zun) x 6 (36)'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })

  it('isGerman : une ligne mesure/valeur allemande ne fusionne pas avec la phrase toute nouvelle qui suit (non-régression, picnic-children-s-top-de)', () => {
    // Bug réel trouvé au câblage bout en bout (24/07) : la Piste 1 fusionnait à tort une
    // ligne de mesure sans ponctuation finale avec la phrase suivante, faute du seul
    // garde-fou qu'elle retirait (majuscule de la suite). Piste 2 ne fusionne QUE si la
    // ligne précédente porte un signal positif d'inachèvement — une valeur numérique
    // complète n'en porte aucun.
    const out = reflowLines([
      L('Länge: 31,5 (34) (36) cm'),
      L('Das Stück ist mit einem Bewegungsspielraum von 2-7 cm konzipiert.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })

  it('isGerman : un nom féminin complet en « -e » ne déclenche pas à tort le signal adjectif décliné', () => {
    // Garde CRITIQUE du signal adjectif décliné : de nombreux noms allemands féminins
    // finissent aussi en « -e » (Länge, Masche, Reihe…) — un vrai nom complet en fin de
    // ligne, suivi d'une toute nouvelle phrase, ne doit jamais fusionner.
    const out = reflowLines([
      L('Wir messen die Länge'),
      L('Neue Reihe beginnt hier.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })

  it('isGerman : un emprunt anglais en minuscule (« Magic Loop ») continue de fusionner — le test minuscule reste valide EN PLUS du signal allemand, pas remplacé par lui (non-régression, ash-knit-wrist-warmers-de)', () => {
    // Bug réel trouvé à la jauge finale (24/07) : le signal allemand REMPLAÇAIT le test
    // minuscule au lieu de s'y ajouter. « loop » n'est pas un nom commun allemand (c'est
    // le terme anglais de la technique « Magic Loop », utilisé tel quel) : le test
    // minuscule DOIT continuer à s'appliquer même en allemand pour ce genre de mot.
    const out = reflowLines([
      L('50 (60) Maschen anschlagen und stricke rund auf Nadelspiel oder Rundnadel mit magic'),
      L('loop.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('50 (60) Maschen anschlagen und stricke rund auf Nadelspiel oder Rundnadel mit magic loop.')
  })

  it('recolle une phrase allemande coupée juste après « mehr oder weniger », devant le nom (majuscule) qu’elle quantifie (GERMAN_MORE_OR_LESS_RE, non-régression hurricane-granny-shawl-de)', () => {
    // Cas réel (banc) : « Die Größe kann leicht verändert werden, indem mehr oder
    // weniger » / « Runden gehäkelt werden. » — GERMAN_ADJ_RE ne couvre pas cette locution
    // (aucun article ne la précède), et le test minuscule ne peut pas s'appliquer (« Runden »
    // est un substantif allemand, donc capitalisé). Sans le recollage, la valeur du champ
    // « Maße: » restait tronquée et sa fin de phrase devenait un rang orphelin dans Matériel.
    const out = reflowLines([
      L('Die Größe kann leicht verändert werden, indem mehr oder weniger'),
      L('Runden gehäkelt werden.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Die Größe kann leicht verändert werden, indem mehr oder weniger Runden gehäkelt werden.')
  })

  it('sans isGerman, la même coupure après « mehr oder weniger » reste scindée (non-régression)', () => {
    const out = reflowLines([
      L('Die Größe kann leicht verändert werden, indem mehr oder weniger'),
      L('Runden gehäkelt werden.'),
    ])
    expect(out).toHaveLength(2)
  })

  it('« mehr oder weniger » ne fusionne pas un nouvel item de liste allemand (NEW_ITEM_RE reste prioritaire)', () => {
    const out = reflowLines([
      L('Es werden mehr oder weniger'),
      L('2. Reihe: alle Maschen rechts.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })

  it('recolle une phrase allemande coupée juste après « beide », devant le nom (majuscule) qu’elle quantifie (GERMAN_DANGLING_RE, non-régression ydun-hat-de)', () => {
    // Cas réel (banc, 7 puces cochables cassées : rounds 1/3/7/11/15/19, PLUS une
    // deuxième occurrence du round 1 réutilisé tel quel en phase de diminution) : « … stricke
    // die 1. Masche rechts von vorne und lasse beide » / « Maschen auf die rechte Nadel
    // gleiten*, … » — « Maschen » est toujours en majuscule (substantif allemand), donc le
    // test minuscule ne peut pas prendre le relais ; sans ce recollage, un rang à torsades se
    // scindait en deux puces cochables distinctes.
    const out = reflowLines([
      L('1. Runde: *6 rechts, stricke die 1. Masche rechts von vorne und lasse beide'),
      L('Maschen auf die rechte Nadel gleiten*, wiederhole von * bis * auf der Runde.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      '1. Runde: *6 rechts, stricke die 1. Masche rechts von vorne und lasse beide Maschen auf die rechte Nadel gleiten*, wiederhole von * bis * auf der Runde.',
    )
  })

  it('sans isGerman, la même coupure après « beide » reste scindée (non-régression)', () => {
    const out = reflowLines([
      L('1. Runde: *6 rechts, stricke die 1. Masche rechts von vorne und lasse beide'),
      L('Maschen auf die rechte Nadel gleiten*, wiederhole von * bis * auf der Runde.'),
    ])
    expect(out).toHaveLength(2)
  })

  it('« beide » ne fusionne pas un nouvel item de liste allemand (NEW_ITEM_RE reste prioritaire)', () => {
    // Garde : un rang qui suit un rang se terminant par « beide » ne doit JAMAIS être avalé,
    // même avec le signal allemand positif — c'est ce qui empêche la fusion d'engloutir un
    // rang entier au lieu de recoller une simple coupure de colonne.
    const out = reflowLines([
      L('… stricke die 1. Masche rechts von vorne und lasse beide'),
      L('2. Runde: 1 Runde rechts.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })

  it('« beide » suivi d’une majuscule qui débute une NOUVELLE phrase (après un point) reste scindé', () => {
    // Négatif discriminant : TERMINAL_RE bloque la fusion dès que p se termine par une vraie
    // ponctuation de fin de phrase, quel que soit le mot qui précède — un mot allemand
    // capitalisé qui ouvre une nouvelle phrase ne doit jamais être recollé à la précédente.
    const out = reflowLines([
      L('Wir haben beide.'),
      L('Nadel bereit.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — préposition française « à » en fin de ligne (DANGLING_FR_A_RE)', () => {
  // Bug réel : \b en JavaScript sans /u se calcule sur [A-Za-z0-9_], donc « à » (hors
  // de cette classe) ne peut jamais former de frontière de mot avec \b — l'entrée « à »
  // de DANGLING_RE ne matchait donc JAMAIS. Cas réel mesuré (diaphane-top-buttoned-shirt-fr) :
  // « … ou jusqu'à » / « 2 cm de moins que la longueur désirée. » restait scindé en deux
  // lignes (deux cases à cocher dans le lecteur, la seconde sans queue ni tête).
  it('recolle une phrase coupée juste après « jusqu\'à » (apostrophe collée, sans espace)', () => {
    const out = reflowLines([
      L('Travailler droit en jersey jusqu’à ce que la Manche mesure 4,5 cm depuis l’aisselle ou jusqu’à'),
      L('2cm de moins que la longueur désirée.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Travailler droit en jersey jusqu’à ce que la Manche mesure 4,5 cm depuis l’aisselle ou jusqu’à 2cm de moins que la longueur désirée.'
    )
  })

  it('recolle une phrase coupée après « à » précédé d’un espace', () => {
    const out = reflowLines([
      L('Rang suivant (END): Rabattre 3 (5, 5, 5, 7, 9, 13, 17, 19, 19) m, travailler comme établi jusqu’à'),
      L('la fin. 50 (52, 58, 64, 70, 76, 76, 80, 84, 90) m'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Rang suivant (END): Rabattre 3 (5, 5, 5, 7, 9, 13, 17, 19, 19) m, travailler comme établi jusqu’à la fin. 50 (52, 58, 64, 70, 76, 76, 80, 84, 90) m'
    )
  })

  it('ne fusionne pas un mot qui se termine par « à » sans en être un (« voilà », non-régression)', () => {
    // Garde : la frontière Unicode explicite ne doit matcher que le mot « à » isolé, pas
    // la terminaison d'un autre mot comme « voilà » ou « delà ».
    const out = reflowLines([
      L('Le motif est prêt, le voilà'),
      L('MESURES'),
    ])
    expect(out).toHaveLength(2)
  })

  it('n’avale pas un nouveau rang qui suit un « à » pendant (NEW_ITEM_RE reste prioritaire)', () => {
    const out = reflowLines([
      L('Continuer comme établi jusqu’à'),
      L('3. Rang suivant en mt.'),
    ])
    expect(out).toHaveLength(2)
  })

  it('une « À » majuscule qui ouvre une nouvelle phrase sur la ligne suivante ne fusionne pas à tort (non-régression)', () => {
    // La ligne précédente ne porte ici aucun signal d'inachèvement (elle se termine sur
    // une phrase complète) : la nouvelle phrase qui commence par « À » majuscule doit
    // rester distincte, comme n'importe quelle autre nouvelle phrase.
    const out = reflowLines([
      L('Le rang est terminé.'),
      L('À partir d’ici, changer de fil.'),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — préposition allemande « über » en fin de ligne (GERMAN_DANGLING_UBER_RE)', () => {
  // Même défaut que « à » ci-dessus : « über » commence par « ü », hors de la classe \w
  // ASCII utilisée par \b sans /u — l'entrée était du code mort dans GERMAN_DANGLING_RE.
  it('recolle une phrase allemande coupée juste après « über » (isGerman: true)', () => {
    const out = reflowLines([
      L('Wir sprechen über'),
      L('Das ganze Muster.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Wir sprechen über Das ganze Muster.')
  })

  it('sans isGerman, la même coupure allemande reste scindée (non-régression)', () => {
    const out = reflowLines([
      L('Wir sprechen über'),
      L('Das ganze Muster.'),
    ])
    expect(out).toHaveLength(2)
  })

  it('ne fusionne pas un mot qui se termine par « über » sans en être un (« hinüber », non-régression)', () => {
    const out = reflowLines([
      L('Das Garn geht hinüber'),
      L('Neue Reihe beginnt hier.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — garde guillemet droit d’ouverture', () => {
  it('recolle une suite qui s’ouvre sur un guillemet droit " (pas seulement les guillemets courbes)', () => {
    // Régression : une revue a trouvé que le guillemet droit ASCII (U+0022, ")
    // avait été remplacé par un guillemet courbe fermant (U+201D, ”) dans la classe
    // de caractères du garde ligne 87 lors d'une édition précédente. Ce garde n'est
    // PAS conditionné par isGerman — il s'applique à tous les appelants (FR/EN/ES
    // compris). Sans le guillemet droit dans la classe, NEW_ITEM_RE (qui liste aussi
    // « " » comme marqueur de liste/dialogue) prenait la main et bloquait à tort la
    // fusion — aucun test existant n'exerçait ce caractère.
    const out = reflowLines([
      L('Le motif est appelé'),
      L('"Point mousse" par la designer.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Le motif est appelé "Point mousse" par la designer.')
  })
})

describe('reflowLines — cas D : NEW_ITEM_RE prioritaire sur DANGLING_RE (2 colonnes)', () => {
  it('n\'avale pas un item numéroté qui suit un mot pendant en fin de colonne gauche (the-sheep-lambert-and-lana-es)', () => {
    // Cas réel : PDF brebis, section « Hendiduras » — un item numéroté de la colonne
    // droite disparaissait fusionné dans la ligne précédente parce que DANGLING_RE
    // (mot-outil « les ») était testé avant NEW_ITEM_RE dans shouldJoin().
    const out = reflowLines([
      L('1. Crocheter une bride dans les'),
      L('3. Faire ainsi de suite jusqu\'à la fin.'),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual([
      '1. Crocheter une bride dans les',
      '3. Faire ainsi de suite jusqu\'à la fin.',
    ])
  })

  it('continue de recoller un mot pendant suivi d\'un chiffre SANS marqueur de liste (non-régression, « 63 prochaines m »)', () => {
    // Un chiffre nu (pas de « N. » ni « N) ») ne matche jamais NEW_ITEM_RE — ce cas
    // continue de fusionner exactement comme avant le réordonnancement.
    const out = reflowLines([
      L('Continuer à crocheter dans les'),
      L('63 prochaines mailles.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Continuer à crocheter dans les 63 prochaines mailles.')
  })
})

describe('reflowLines — invalidation des positions', () => {
  it('retire parts de la ligne fusionnée (le texte a changé, les positions mentiraient)', () => {
    const lines = [
      { text: 'une phrase coupée en', size: 10, y: 100, parts: [{ x: 40, text: 'une phrase coupée en' }] },
      { text: 'deux morceaux.', size: 10, y: 88, parts: [{ x: 40, text: 'deux morceaux.' }] },
    ]
    const out = reflowLines(lines, { para: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('une phrase coupée en deux morceaux.')
    expect(out[0].parts).toBeUndefined()
  })

  it('garde parts intact sur une ligne NON fusionnée', () => {
    const lines = [{ text: 'Abréviations', size: 10, y: 100, parts: [{ x: 40, text: 'Abréviations' }] }]
    expect(reflowLines(lines, { para: true })[0].parts).toEqual([{ x: 40, text: 'Abréviations' }])
  })
})

describe('reflowLines — coupure a l’interieur d’un vecteur de tailles', () => {
  // Lignes REELLES de Mia Cardigan (English) v1.1, page 2, telles que pdf.js les rend.
  it('recolle la ligne Materiel coupee en plein vecteur', () => {
    const out = reflowLines([
      L('300 (300, 350, 350, 350) (400, 400, 400, 450) 500, 500 g Merino Singles by Sysleriget (100g = 366m) held together with 150 (150, 150, 150,'),
      L('150) (150, 200, 200, 200) 200, 200 g Silk Mohair by Sysleriget (50g = 420m). If you wish to lengthen or shorten the cardigan, you may require more or less yarn.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toContain('150 (150, 150, 150, 150) (150, 200, 200, 200) 200, 200 g')
  })

  it('recolle la phrase des sous-tailles coupee en plein vecteur', () => {
    const out = reflowLines([
      L('Sizes 1 (2, 3, 4, 5) (6, 7, 8, 9) 10, 11 are intended to fit an approximate actual bust circumference of 75 (80, 85, 90, 95) (100, 110, 120,'),
      L('130) 140, 150 cm.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toContain('(100, 110, 120, 130) 140, 150 cm.')
  })

  // TEMOIN DISCRIMINANT : une vraie puce numerotee apres une virgule pendante.
  // Sans parenthese ouverte, la regle ne doit PAS s’appliquer.
  it('n’avale pas une vraie puce numerotee', () => {
    const out = reflowLines([
      L('Work the following steps in order,'),
      L('1) Cast on 20 sts.'),
    ])
    expect(out).toHaveLength(2)
  })

  it('n’avale pas une puce numerotee meme avec une parenthese DEJA REFERMEE avant', () => {
    const out = reflowLines([
      L('Work the steps (in this order),'),
      L('2) Knit across.'),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — URL enroulée sur deux coupures de colonne (compass-rose-north-granny-square-fr)', () => {
  // Cas réel : le lien YouTube de l'abréviation « demi-dbr » est coupé sur TROIS lignes PDF.
  // La 1ère fusion (ligne 1 + 2) suit la règle générique « suite ouverte sur parenthèse »
  // (espace inséré, normal : « bride (https://... »). La 2ème fusion (résultat + ligne 3) doit
  // recoller SANS espace : « OwmQky7iv) » est la fin littérale du token d'URL, pas un nouveau
  // mot — un espace injecté casserait le lien (espace au milieu de l'URL).
  it('recolle la queue d’URL sans espace, même en MAJUSCULE', () => {
    const out = reflowLines([
      L('demi-dbr = demi double bride'),
      L('(https://youtu.be/q4knnOkISo8?si=IpOYTGz'),
      L('OwmQky7iv)'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('demi-dbr = demi double bride (https://youtu.be/q4knnOkISo8?si=IpOYTGzOwmQky7iv)')
  })

  it('ne recolle pas sans espace une suite qui n’est pas un fragment d’URL (parenthèse ouverte ordinaire)', () => {
    // Garde-fou : hasOpenParen(p) seul ne suffit pas, il faut aussi un « http(s):// » déjà
    // amorcé dans p — sinon une parenthèse ouverte ordinaire (remarque, précision) perdrait
    // son espace de continuation normal.
    const out = reflowLines([
      L('Continuer (voir'),
      L('remarque)'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Continuer (voir remarque)')
  })

  it('n’avale pas sans espace un rang qui suit, même quand une URL et une parenthèse ouverte coexistent SANS RAPPORT dans la ligne précédente', () => {
    // Revue : le http(s):// doit vivre DANS la parenthèse encore ouverte, pas n'importe où
    // dans p — sinon une URL citée en amont + une parenthèse ouverte sans rapport (remarque
    // fermée par erreur, note…) suffiraient à recoller sans espace la ligne suivante, y
    // compris un vrai rang que NEW_ITEM_RE bloque normalement mais que ce chemin
    // court-circuite (il tourne AVANT shouldJoin).
    const out = reflowLines([
      L('Voir https://exemple.fr pour le détail (voir'),
      L('R1:'),
    ])
    expect(out).toHaveLength(2)
  })

  it('n’avale pas sans espace un rang qui suit une URL entre parenthèses DÉJÀ REFERMÉE (cas courant du glossaire, pas l’exception)', () => {
    // Bloquant (revue) : la classe finale de OPEN_PAREN_URL_TAIL_RE était `\S*$`, qui matche
    // aussi un « ) » — une URL entre parenthèses fermée en fin de ligne (le cas COURANT d'une
    // entrée de glossaire, « … (https://youtu.be/abc) », pas l'exception à 3 lignes visée par
    // ce garde-fou) satisfaisait donc la regex tout autant qu'une vraie parenthèse non
    // refermée, et collait sans espace le vrai rang qui suit. La classe finale doit refuser
    // tout « ) » après le début de l'URL.
    const out = reflowLines([
      L('demi-dbr = demi double bride (https://youtu.be/abc)'),
      L('R1:'),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].text).toBe('demi-dbr = demi double bride (https://youtu.be/abc)')
    expect(out[1].text).toBe('R1:')
  })
})

describe('reflowLines — parenthèse ouvrant un vecteur numérique n’est pas une continuation (candy-cane-stripes-sweater-en)', () => {
  it('ne colle pas la quantité du fil B au libellé du fil A qui la précède (pull bicolore, 2 fils/2 quantités)', () => {
    // Cas réel : patron « Candy Cane Stripes Sweater » (hobbii EN), pull à rayures
    // bicolores. Avant correctif, la règle générale « suite ouverte sur parenthèse »
    // fusionnait aveuglément « Feather col. 07 (A) » avec la ligne suivante dès qu'elle
    // commençait par « ( » — ici le vecteur de quantité du fil B, sans rapport avec le
    // libellé du fil A. Résultat : la quantité de B se retrouvait collée au nom de A, et
    // B se retrouvait sans quantité (erreur d'achat de fil pour l'utilisatrice).
    const out = reflowLines([
      L('(4, 4, 4) (4, 5, 5) (5, 6, 6) skeins of Kind'),
      L('Feather col. 07 (A)'),
      L('(3, 3, 4) (4, 4, 4) (5, 5, 5) skeins of Kind'),
      L('Feather col. 02 (B)'),
    ])
    expect(out).toHaveLength(4)
    expect(out.map((l) => l.text)).toEqual([
      '(4, 4, 4) (4, 5, 5) (5, 6, 6) skeins of Kind',
      'Feather col. 07 (A)',
      '(3, 3, 4) (4, 4, 4) (5, 5, 5) skeins of Kind',
      'Feather col. 02 (B)',
    ])
  })

  it('un libellé qui se termine par « : » continue de fusionner avec le vecteur numérique qui suit (non-régression, mountaintop-pullover-de)', () => {
    // L'exception COLON_THEN_PAREN_RE doit continuer à s'appliquer même avec le nouveau
    // garde : un libellé qui annonce explicitement sa valeur via « : » attend bien un
    // vecteur numérique juste après, ce n'est pas le cas ambigu du test précédent.
    const out = reflowLines([
      L('Poids total du fil A:'),
      L('(100, 100, 150) g'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Poids total du fil A: (100, 100, 150) g')
  })

  it('une parenthèse ouvrante NON numérique continue de fusionner comme avant (non-régression)', () => {
    // Le garde est restreint aux vecteurs numériques (chiffre juste après la parenthèse) :
    // une parenthèse de continuation ordinaire (remarque, précision) reste inchangée.
    const out = reflowLines([
      L('Le motif est appelé'),
      L('(voir remarque ci-dessous) par la designer.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Le motif est appelé (voir remarque ci-dessous) par la designer.')
  })

  it('deux vecteurs numériques consécutifs coupés PILE entre eux continuent de fusionner (non-régression, Neckline One)', () => {
    // Cas réel (candy-cane-stripes-sweater-en) découvert en vérifiant le correctif ci-dessus
    // de bout en bout : un rang enchaîne plusieurs vecteurs de tailles côte à côte, et la
    // colonne coupe PILE entre deux vecteurs plutôt qu'au milieu d'un seul. Contrairement au
    // cas « Feather col. 07 (A) », la ligne précédente se termine ELLE-MÊME par un vecteur
    // numérique fermé (« (7, 8, 9) ») — TRAILING_NUMERIC_VECTOR_RE doit le distinguer d'un
    // code couleur/libellé court et laisser la fusion se produire.
    const out = reflowLines([
      L('Row 2: ch2, 1dc in first st, *3dc in next sp* to final 2 sts, sk 1 st, 1dc in final st, turn. (7, 8, 9)'),
      L('(10, 11, 13) (14, 15, 17) 3dc clusters.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Row 2: ch2, 1dc in first st, *3dc in next sp* to final 2 sts, sk 1 st, 1dc in final st, turn. (7, 8, 9) (10, 11, 13) (14, 15, 17) 3dc clusters.'
    )
  })

  it('un chiffre nu juste avant un vecteur numérique continue de fusionner (non-régression, laura-sweater-en)', () => {
    // Autre cas réel trouvé en vérifiant le correctif de bout en bout : la première valeur
    // d'un vecteur de tailles reste NUE en fin de ligne précédente (pas de parenthèse), et
    // seul le RESTE du vecteur est entre parenthèses sur la ligne suivante — même schéma que
    // le commentaire hasOpenParen plus haut (« Sizes 1 (2, 3, 4, 5) … »). Un chiffre nu n'a
    // pas de parenthèse fermée du tout : trailingClosedParenHasNoDigit ne matche pas, donc
    // ce n'est pas bloqué.
    const out = reflowLines([
      L('repeat from * to * on entire round = 12 stitches increased = 132'),
      L('(144, 156) stitches.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('repeat from * to * on entire round = 12 stitches increased = 132 (144, 156) stitches.')
  })
})

describe('reflowLines — abréviation anglaise « R » (Hobbii) non reconnue par NEW_ITEM_RE (kawaii-watermelon-rattle-en)', () => {
  // Cas réel : patron « Kawaii Watermelon - Rattle » (hobbii EN, crochet). Chaque rang se
  // termine par une VIRGULE (« … inc 1 st (28), ») au lieu d'un point — DANGLING_RE (la
  // virgule finale) fusionnait donc systématiquement avec le rang suivant, et NEW_ITEM_RE ne
  // reconnaissait que des mots de rang complets (row/round/rnd…), jamais le simple « R » que
  // Hobbii utilise en anglais — rien ne bloquait la fusion avant DANGLING_RE. Résultat :
  // jusqu'à six rangs fusionnés en une seule puce à cocher, perte totale du suivi de
  // progression.
  it('ne fusionne pas deux rangs « R N: » séparés par une virgule finale', () => {
    const out = reflowLines([
      L('R 1: 12 sc, 3 sc in same st, 11 sc, inc 1 st (28),'),
      L('R 2: inc 1 st, 11 sc, inc 1 st, 1 sc, inc 1 st, 11 sc, inc 1 st, 1 sc (32),'),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual([
      'R 1: 12 sc, 3 sc in same st, 11 sc, inc 1 st (28),',
      'R 2: inc 1 st, 11 sc, inc 1 st, 1 sc, inc 1 st, 11 sc, inc 1 st, 1 sc (32),',
    ])
  })

  it('ne fusionne pas une plage de rangs « R N-M: » non plus (même mécanisme)', () => {
    const out = reflowLines([
      L('R 9: work 1 sc in each st (40),'),
      L('R 10: 2 sc, dec 1 st, 13 sc, dec 1 st, 3 sc, dec 1 st, 13 sc, dec 1 st, 1 sc (36),'),
    ])
    expect(out).toHaveLength(2)
  })

  it('non-régression : « fil A »/« fil D » (code couleur) devant un Tour continue de bloquer la fusion', () => {
    // Garde de non-régression explicite demandée : la ponctuation de kawaii-watermelon
    // déclenche le défaut, pas une convention Hobbii générale — le code couleur A/B/C/D/E
    // (DANGLING_EN_ARTICLE_RE) ne doit pas être affecté par l'ajout du « R » nu à NEW_ITEM_RE.
    const out = reflowLines([
      L('En faire 2 avec le fil A'),
      L('Tour 1: 6 ms dans un cm'),
    ])
    expect(out).toHaveLength(2)
  })

  it('non-régression : les versions FR/ES du même éditeur (rang fini par une parenthèse seule) ne sont pas concernées', () => {
    // La ponctuation FR/ES de Hobbii (parenthèse seule en fin de rang, pas de virgule) ne
    // déclenchait déjà pas le défaut — vérifie qu'un « R » nu français hypothétique ne casse
    // pas non plus un cas qui finissait déjà correctement par une fermeture de parenthèse.
    const out = reflowLines([
      L('Rang 1: 12 ms (28)'),
      L('Rang 2: 12 ms (32)'),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — chiffre nu ou vecteur en fin de ligne devant une abréviation allemande (isGerman, summer-squares-wrap-cardigan-de / martha-blouse-with-lace-pattern-de)', () => {
  // Cas réel « Letzte Runde Q2 » (summer-squares) : la formule récurrente du crochet
  // carré-par-carré est coupée en plein milieu, juste après un chiffre NU annonçant l'unité
  // qui le suit (« … beendest, 4 » / « Lm (zählen als Stb, 1 Lm) … »). Aucune règle ne
  // traitait un chiffre nu en fin de ligne comme un signal d'attente devant une abréviation
  // allemande de maille (Lm, Maschen) — et la règle de continuation par minuscule ne peut
  // pas s'appliquer : ces mots sont conventionnellement en MAJUSCULE (noms allemands).
  // Constaté sur au moins 5 rangs de l'assemblage (Q1, Q2, Q5, Q6, MQ1).
  it('recolle un chiffre nu en fin de ligne devant « Lm » qui continue la même formule (Letzte Runde Q2)', () => {
    const out = reflowLines([
      L('Letzte Runde Q2: Zu Farbe A wechseln, indem du die Km der vorherigen Runde beendest, 4'),
      L('Lm (zählen als Stb, 1 Lm) Stb in denselben Bg, 2 Lm, V-M in denselben Bg, V-M in den'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Letzte Runde Q2: Zu Farbe A wechseln, indem du die Km der vorherigen Runde beendest, 4 Lm (zählen als Stb, 1 Lm) Stb in denselben Bg, 2 Lm, V-M in denselben Bg, V-M in den'
    )
  })

  it('recolle un vecteur de tailles fermé en fin de ligne devant « Maschen » qui continue la même phrase (martha-blouse-with-lace-pattern-de)', () => {
    // Même signal, sous sa forme vecteur (pas un chiffre nu) : « … bis auf 6 (9, 13, 17, 20,
    // 23) » / « Maschen vor dem Markierer stricken, … ».
    const out = reflowLines([
      L('Vom Anfang der Runde (die 10. Runde in der Strickschrift) bis auf 6 (9, 13, 17, 20, 23)'),
      L('Maschen vor dem Markierer stricken, 12 (18, 26, 34, 40, 46) Maschen abketten.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Vom Anfang der Runde (die 10. Runde in der Strickschrift) bis auf 6 (9, 13, 17, 20, 23) Maschen vor dem Markierer stricken, 12 (18, 26, 34, 40, 46) Maschen abketten.'
    )
  })

  it('sans isGerman, la même coupure reste scindée (non-régression)', () => {
    const out = reflowLines([
      L('Letzte Runde Q2: Zu Farbe A wechseln, indem du die Km der vorherigen Runde beendest, 4'),
      L('Lm (zählen als Stb, 1 Lm) Stb in denselben Bg, 2 Lm, V-M in denselben Bg, V-M in den'),
    ])
    expect(out).toHaveLength(2)
  })

  it('isGerman : un nouveau rang « Rd 6: » n\'est jamais avalé même après un chiffre nu (NEW_ITEM_RE reste prioritaire)', () => {
    const out = reflowLines([
      L('Wiederhole 4'),
      L('Rd 6: (4 fM, Zun) x 6 (36)'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })

  it('isGerman : un chiffre nu en fin de ligne devant un mot ordinaire (pas une unité de maille) ne fusionne pas à tort (non-régression)', () => {
    const out = reflowLines([
      L('Der Cardigan hat 4'),
      L('Größen zur Auswahl.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — total de mailles replié après une VRAIE fin de phrase (easter-chick-pip-de / hiedra-shawl-wrap-with-leaf-motif-fr)', () => {
  // Cas réel « easter-chick-pip-de » : le total de mailles d'un rang, entre parenthèses, est
  // rejeté seul sur la ligne suivante par la largeur de colonne (« … auf der Runde. » / «
  // (24) »). TERMINAL_RE (le point final) bloquait la fusion AVANT que la règle « suite
  // ouverte sur parenthèse » ait sa chance — COLON_THEN_PAREN_RE a déjà cette exception pour
  // un « : », il n'en existait pas pour un « . » suivi d'un total NU (chiffres seuls, rien
  // d'autre). Constaté sur 9 rangs de ce patron (corps + ailes).
  it('recolle un total de mailles entre parenthèses replié après un point final', () => {
    const out = reflowLines([
      L('4. *1 fM in die nächsten 2 m, 2 fM in die nächste M.* Wiederhole von * bis * auf der Runde.'),
      L('(24)'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      '4. *1 fM in die nächsten 2 m, 2 fM in die nächste M.* Wiederhole von * bis * auf der Runde. (24)'
    )
  })

  // Cas réel « hiedra-shawl-wrap-with-leaf-motif-fr » : même défaut, sans parenthèses cette
  // fois — le total se détache en aparté flottant (« … 3 m end. » / « 21m »).
  it('recolle un total de mailles nu (chiffres + unité collée) replié après un point final', () => {
    const out = reflowLines([
      L('Rang 9: 9 m end, jeté, 1 m end, jeté, 2 m end, 3m ens end, 2 m env, 2m ens end, 3 m end.'),
      L('21m'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Rang 9: 9 m end, jeté, 1 m end, jeté, 2 m end, 3m ens end, 2 m env, 2m ens end, 3 m end. 21m'
    )
  })

  it('ne fusionne pas un « . » de fin de ligne suivi d’une VRAIE remarque entre parenthèses (non-régression, garde déjà existante)', () => {
    // Garde explicitement redemandée : une vraie fin de phrase suivie d'une remarque (pas un
    // total nu) reste séparée — le correctif ne doit élargir la fusion qu'aux totaux nus.
    const out = reflowLines([
      L('Rembourrer le corps au fur et à mesure.'),
      L('(voir photo 1)'),
    ])
    expect(out).toHaveLength(2)
  })

  it('ne fusionne pas un total suivi d’un point final (picture-ornament-fr — non-régression : ce total est déjà correctement isolé)', () => {
    // Cas réel picture-ornament-fr (déjà vetté, inchangé) : « (12). » porte lui-même un point
    // final — restreint au total NU (rien après la parenthèse fermante) pour ne pas rouvrir
    // ce cas, qui doit rester séparé comme aujourd'hui.
    const out = reflowLines([
      L('Tour 1: 12 ms dans le cercle magique. Fermer le cercle magique. Mc dans la première ms.'),
      L('(12).'),
    ])
    expect(out).toHaveLength(2)
  })

  // Cas réel snowman-coaster-de-623a0c1d : 3e variante du même défaut, avec CETTE fois
  // parenthèses ET unité collée ensemble (« (12 M) ») — ni BARE_COUNT_PAREN_RE (chiffres
  // seuls) ni BARE_COUNT_UNIT_RE (unité collée SANS parenthèses, « 21m ») ne couvrent cette
  // forme mixte. Sans ce correctif, chaque total de ce type reste une puce orpheline détachée
  // de son rang (et, en amont, ferait même basculer la ligne en faux titre `##` dans
  // segment.js — corrigé séparément côté isTitleLine).
  it('recolle un total de mailles entre parenthèses ET unité collée (« (12 M) », allemand)', () => {
    const out = reflowLines([
      L('Runde 1: 3 Lm, 11 Stb in den Ring häkeln. mit 1 Km auf die oberste der 3 Lm schließen.'),
      L('(12 M)'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Runde 1: 3 Lm, 11 Stb in den Ring häkeln. mit 1 Km auf die oberste der 3 Lm schließen. (12 M)'
    )
  })

  it('ne fusionne pas une mesure entre parenthèses avec une autre unité que « M » (non-régression, garde discriminante)', () => {
    // BARE_COUNT_PAREN_UNIT_JOIN_RE est restreinte à l'unité « M » (Masche, seule observée sous
    // cette forme repliée dans le corpus) — une mesure « (10 cm) » ne doit jamais être
    // fusionnée à tort par cette même règle : ce n'est pas un total de mailles.
    const out = reflowLines([
      L('Durchmesser ca. 10 cm.'),
      L('(10 cm)'),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — article allemand décliné en fin de ligne (« einer »/« einem »/« einen »/« eines », martha-blouse-with-lace-pattern-de)', () => {
  // DANGLING_RE listait déjà « ein »/« eine » (nominatif) mais pas les formes déclinées au
  // datif/accusatif/génitif — cas réel : « … cm misst. Schließe mit einer » / « Rückreihe. »
  // (Rückreihe, nom allemand, est TOUJOURS en majuscule : la règle de continuation par
  // minuscule ne peut donc jamais s'appliquer ici, contrairement aux autres mots-outils de
  // DANGLING_RE).
  it('recolle une ligne coupée juste après « mit einer » (article décliné au datif)', () => {
    const out = reflowLines([
      L('Wie das Rückenteil stricken bis die Arbeit 44 (45, 46, 47, 48, 49) cm misst. Schließe mit einer'),
      L('Rückreihe.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Wie das Rückenteil stricken bis die Arbeit 44 (45, 46, 47, 48, 49) cm misst. Schließe mit einer Rückreihe.'
    )
  })

  it('recolle une ligne coupée juste après « in einen » (article décliné à l’accusatif, summer-squares-wrap-cardigan-de)', () => {
    const out = reflowLines([
      L('V-M in den nächsten Bg (zwischen den Mg) bis zur nächsten Ecke, V-M, 1 Lm, Km in einen'),
      L('2-Lm-Eckbogen von Q1, Stb in den 2-Lm-Bg von Q2.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'V-M in den nächsten Bg (zwischen den Mg) bis zur nächsten Ecke, V-M, 1 Lm, Km in einen 2-Lm-Eckbogen von Q1, Stb in den 2-Lm-Bg von Q2.'
    )
  })

  it('n’avale pas un nouveau rang qui suit un article décliné pendant (NEW_ITEM_RE reste prioritaire)', () => {
    const out = reflowLines([
      L('Arbeite weiter mit einer'),
      L('4. Reihe: alle Maschen rechts.'),
    ])
    expect(out).toHaveLength(2)
  })
  it('n’avale pas un rang ordinal COLLÉ « 2.Reihe » qui suit un article décliné pendant (NEW_ITEM_RE, knit-domino-shawl-de)', () => {
    // knit-domino-shawl-de-61747066 (corps réel, Hobbii DE) : ordinal collé au point
    // (« 2.Reihe (rechte Seite): … »). L'alt « \d+[.)](?=\s|$) » de NEW_ITEM_RE exige un
    // espace (ou une fin de ligne) après le point : sans la branche ordinale collée, la
    // forme allemande ne bloquait pas la fusion et une continuation pendante l'avalait en
    // tête de ligne suivante.
    const out = reflowLines([
      L('Arbeite weiter mit einer'),
      L('2.Reihe (rechte Seite): alle Maschen rechts.'),
    ])
    expect(out).toHaveLength(2)
  })
  it('non-régression : un ordinal collé + mot NON-rang (« 1.Masche … ») reste fusionnable comme continuation', () => {
    // Contre-test : la branche ordinale collée exige le mot de rang (reihe/runde/rd)
    // après le point — « 1.Masche » n'est pas un marqueur de rang, la continuation
    // allemande pendante doit continuer de se recoller (même résultat qu'avant).
    const out = reflowLines([
      L('Arbeite weiter mit einer'),
      L('1.Masche am Nadelende.'),
    ])
    expect(out).toHaveLength(1)
  })
})

describe('reflowLines — total de mailles nu avec unité « st »/« sts » entre parenthèses (rainbow-applique-en-79d9ccb4)', () => {
  // Cas réel : Row 3 de la section RAINBOW se termine par une vraie fin de phrase
  // (« Change to Color Sunflower. »), et son propre total de mailles est replié par la
  // colonne sur la ligne suivante SOUS FORME D'UNITÉ EXPLICITE (« (15 sts) »), pas de
  // chiffres nus (BARE_COUNT_PAREN_RE) ni de l'unité allemande « M » (BARE_COUNT_PAREN_
  // UNIT_JOIN_RE). Sans BARE_COUNT_PAREN_STS_RE, ce total devenait une puce à cocher
  // orpheline, désynchronisant la numérotation des rangs suivants.
  it('recolle un total « (N sts) » à la vraie fin de phrase qui le précède', () => {
    const out = reflowLines([
      L('Row 3: ch 1 and turn, 1 sc in the last st of the previous row, *inc in the next st, 1 sc in the next 2 sts*. Repeat from * to * 3 times in total, inc in the last st. Change to Color Sunflower.'),
      L('(15 sts)'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Row 3: ch 1 and turn, 1 sc in the last st of the previous row, *inc in the next st, 1 sc in the next 2 sts*. Repeat from * to * 3 times in total, inc in the last st. Change to Color Sunflower. (15 sts)'
    )
  })
  it('recolle aussi le singulier « (1 st) »', () => {
    const out = reflowLines([L('Fasten off.'), L('(1 st)')])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Fasten off. (1 st)')
  })
  it('ne fusionne pas une remarque entre parenthèses avec du texte après « st »/« sts » (forme non-nue)', () => {
    const out = reflowLines([L('Fasten off.'), L('(15 sts total for this section)')])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — phrase « Change to Color »/« Change to Colour » devant un nom de couleur capitalisé (rainbow-applique-en-79d9ccb4)', () => {
  // Cas réel : Rows 4 et 5 de la section RAINBOW se terminent par « … Change to Color »,
  // coupés par la colonne juste avant le nom de couleur propre (toujours capitalisé,
  // convention Hobbii) qui les complète. Sans ce signal, la règle de continuation par
  // minuscule ne pouvait pas prendre le relais (le nom de couleur commence en majuscule) et
  // le reste de la phrase devenait une puce orpheline. Restreint à la PHRASE COMPLÈTE
  // (CHANGE_TO_COLOR_RE), pas au seul mot « color »/« colour » ajouté puis retiré de
  // DANGLING_RE : ce mot seul termine aussi des phrases ordinaires sans rapport (nom de
  // laine, glossaire, titre — cf. describe suivant), qu'il ne faut jamais fusionner.
  it('recolle une ligne coupée juste après « Change to Color »', () => {
    const out = reflowLines([
      L('Row 4: ch 1 and turn, inc in the last st of the previous row, *1 sc in the next 3 sts, inc in next st*. Repeat from * to * 3 times in total, 1 sc in next st, inc in the last st. Change to Color'),
      L('Orange. (20 sts)'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Row 4: ch 1 and turn, inc in the last st of the previous row, *1 sc in the next 3 sts, inc in next st*. Repeat from * to * 3 times in total, 1 sc in next st, inc in the last st. Change to Color Orange. (20 sts)'
    )
  })
  it('recolle « Change to Colour » (orthographe britannique)', () => {
    const out = reflowLines([L('Change to Colour'), L('Tomato.')])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Change to Colour Tomato.')
  })
  it('ne fusionne PAS un nom de laine qui finit par « colour » avec la phrase suivante (dream-colour-shawl-fr, régression trouvée à la vérification corpus)', () => {
    // « colour » y termine un nom de laine (« Dream colour »), pas une annonce de couleur :
    // généraliser au seul mot (sans exiger « change to » devant) fusionnait à tort ce nom de
    // laine avec la phrase d'appel à l'achat qui suit, sans aucun rapport sémantique.
    const out = reflowLines([
      L('Laine Hobbii Dream colour'),
      L('Acheter la laine et les accessoires ici:'),
    ])
    expect(out).toHaveLength(2)
  })
  it('ne fusionne pas deux entrées de glossaire consécutives se terminant/commençant par « color » (watercolor-capelet-en)', () => {
    const out = reflowLines([L('CC = contrasting color'), L('CO = cast on')])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — marqueur fermant « * »/« ** » d’un span de répétition en tête de ligne (playset-doll-clothes-fr-541b5d41, et 5 autres PDF de la campagne)', () => {
  // Cas réel assigné : Rang 2 du T-shirt (playset-doll-clothes-fr) scindé pile entre le
  // verbe « rép depuis » et le marqueur fermant « * » du span imbriqué simple/double
  // astérisque qui le referme — NEW_ITEM_RE (qui traite un « * » de tête comme une NOUVELLE
  // puce) bloquait la fusion avant que ce signal n'ait sa chance. Vérifié sans faux positif
  // sur les 43 occurrences d'une ligne commençant par « * »/« ⋆ » dans les PDF des vagues 1
  // à 6 (cf. commentaire de REPEAT_VERB_RE dans reflow.js) ; corrige aussi, en bonus,
  // frosty-flower-t-shirt-fr, compass-rose-north-granny-square-fr, granny-smith-skirt-en,
  // floral-breeze-dress-es et maddy-top-es (×3), qui partagent la même forme.
  it('recolle « rép depuis » avec le marqueur fermant simple astérisque qui suit', () => {
    const out = reflowLines([
      L('Rang 2 1 m end, JETÉ, 2m ens end, (forme la boutonnière) *aug barr, 1 m end, rép depuis'),
      L('*trois fois, aug barr, 6 m end, **aug barr, 1 m end, rép depuis ** trois fois, aug barr, 3 m'),
      L('end [ 34 m]'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Rang 2 1 m end, JETÉ, 2m ens end, (forme la boutonnière) *aug barr, 1 m end, rép depuis *trois fois, aug barr, 6 m end, **aug barr, 1 m end, rép depuis ** trois fois, aug barr, 3 m end [ 34 m]'
    )
  })
  it('recolle « rep from » anglais avec le marqueur fermant double astérisque qui suit', () => {
    const out = reflowLines([
      L('ch 1, 3 dc in the same space, ch 1 **, rep from * to'),
      L('** twice, join with sl st to top of ch 3.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('ch 1, 3 dc in the same space, ch 1 **, rep from * to ** twice, join with sl st to top of ch 3.')
  })
  it('ne fusionne pas une entrée de glossaire qui suit une AUTRE entrée de glossaire, même si celle-ci définit la notation « *…* »', () => {
    // p n'a jamais le verbe de répétition en fin de ligne dans ce cas : c'est une clé de
    // glossaire différente (« ens = ensemble »), pas une directive de rang en cours.
    const out = reflowLines([
      L('ens = ensemble (diminution)'),
      L('*...* = répéter entre ‘X’ nombre de fois'),
    ])
    expect(out).toHaveLength(2)
  })
  it('n’avale pas un nouveau rang qui commence par un « * » de tête sans verbe de répétition sur p', () => {
    const out = reflowLines([
      L('Rechte Schulterpasse'),
      L('**Mit dem Kreuzanschlag, Garn A und der größeren Nadel 31 M'),
    ])
    expect(out).toHaveLength(2)
  })
  it('ne fusionne pas une note indépendante avec un verbe de répétition qui ne parle d’AUCUN span « *…* » (faux positif trouvé en revue, anglais)', () => {
    // « Repeat rows 1-4 » ne parle que d'un ensemble de rangs ordinaire — p n'a AUCUN
    // astérisque, donc REPEAT_VERB_RE seule (sans la garde /[*⋆]/.test(p)) fusionnerait à
    // tort la note indépendante qui suit avec cette phrase.
    const out = reflowLines([
      L('Repeat rows 1-4 as many times as needed for your size, then move to the collar'),
      L('* See chart on page 12 for stitch counts'),
    ])
    expect(out).toHaveLength(2)
  })
  it('ne fusionne pas une note indépendante avec un verbe de répétition qui ne parle d’AUCUN span « *…* » (faux positif trouvé en revue, français)', () => {
    const out = reflowLines([
      L('Rép les rangs 1 à 4 autant de fois que nécessaire pour votre taille, puis passez au col en changeant'),
      L('* Astuce perso : comptez vos mailles avant de continuer'),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — clé de glossaire à compte nu (banc vague 6)', () => {
  // Cas réel ES : scallops-rectangular-placemat-es. KV_RE (clé/valeur classique) exclut tout
  // token qui commence par un chiffre pour ne jamais avaler un marqueur de rang (« Rang 1 : »)
  // — mais « s 1 p = salta un punto » a justement un chiffre EN TIÈRE de token, donc y échappe
  // aussi. Sans garde séparée, la règle de repli « une suite en minuscule continue toujours »
  // fusionnait cette entrée dans la définition de « pb » qui précède.
  it('ne fusionne pas « s 1 p = salta un punto » dans la définition de l’entrée précédente', () => {
    const out = reflowLines([L('pb = punto bajo'), L('s 1 p = salta un punto')])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual(['pb = punto bajo', 's 1 p = salta un punto'])
  })
  // Cas réel FR : open-back-sweater-fr. Même échec de KV_RE (chiffre en TÊTE de clé cette
  // fois), mais un mécanisme différent prenait le relais : DANGLING_RE matche à tort le « e »
  // final de « serrée » comme mot-outil isolé (\b, non conscient d'Unicode par défaut en JS,
  // traite l'accent « é » comme un caractère non-mot et pose donc une frontière juste avant
  // le dernier « e » — même angle mort déjà connu pour « à », cf. DANGLING_FR_A_RE).
  it('ne fusionne pas « 2 ms ens. = … » dans la définition de « ms » qui précède (accent + mot-outil isolé)', () => {
    const out = reflowLines([L('ms = maille serrée'), L('2 ms ens. = 2 mailles serrées ensemble')])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual(['ms = maille serrée', '2 ms ens. = 2 mailles serrées ensemble'])
  })
  it('recolle malgré tout la continuation entre parenthèses de la nouvelle entrée', () => {
    // « (diminution) » doit rester une continuation de « 2 ms ens. = … », pas de « ms = … » :
    // le nouveau garde-fou ne doit pas empêcher la règle « suite ouverte sur parenthèse » de
    // jouer normalement sur la ligne SUIVANTE.
    const out = reflowLines([
      L('ms = maille serrée'),
      L('2 ms ens. = 2 mailles serrées ensemble'),
      L('(diminution)'),
    ])
    expect(out).toHaveLength(2)
    expect(out[1].text).toBe('2 ms ens. = 2 mailles serrées ensemble (diminution)')
  })
  it('ne bloque pas la fusion d’une clé/valeur SANS chiffre (non-régression KV_RE)', () => {
    const out = reflowLines([L('ch = chain'), L('sc = single crochet')])
    expect(out).toHaveLength(2)
  })
  it('ne prend pas un rang numéroté nu (sans « = »/« : ») pour une clé à compte nu', () => {
    // Discriminant : isNumericAbbrKeyLine exige un séparateur « = »/« : ». Un item de liste
    // numéroté (« 3. Tricoter… ») n'en a jamais — la non-fusion ici vient de NEW_ITEM_RE
    // (déjà en place avant ce correctif), pas du nouveau garde-fou ; ce test vérifie juste
    // que la présence d'un chiffre isolé dans nt ne fait pas basculer isNumericAbbrKeyLine
    // à tort en l'absence de tout séparateur « = »/« : ».
    const out = reflowLines([L('Continuer ainsi jusqu’à la fin du rang,'), L('3. Tricoter 6 mailles envers.')])
    expect(out).toHaveLength(2)
  })
  it('n’active pas le garde-fou sur un compte à 3 chiffres — garde discriminante réelle (banc corpus)', () => {
    // Les deux VRAIES clés du corpus (« s 1 p », « 2 ms ens. ») portent un compte à 1
    // chiffre : isNumericAbbrKeyLine se borne volontairement à 1-2 chiffres (`\d{1,2}`).
    // Un compte à 3 chiffres reste une valeur ordinaire de patron, jamais une clé de
    // glossaire. Revue : la première version de ce test (« environ 100 : … ») ne
    // discriminait rien — « environ » (7 car.) dépassait déjà le plafond ≤ 6 car./token de
    // NUMERIC_ABBR_KEY_RE, donc le test restait vert même si `\d{1,2}` avait été relâché en
    // `\d{1,3}`. Ici, les DEUX tokens (« reste », « 100 ») restent ≤ 6 car. — seule la
    // longueur du nombre distingue ce cas des deux vraies clés.
    const out = reflowLines([
      L('Continuer à tricoter encore'),
      L('reste 100 : mailles à répartir sur les aiguilles.'),
    ])
    expect(out).toHaveLength(1)
  })
  it('n’active pas le garde-fou sur une clé à 4 tokens — garde discriminante réelle (banc corpus)', () => {
    // Même principe pour le nombre de tokens : les deux vraies clés du corpus tiennent en
    // 2-3 tokens (« s 1 p », « 2 ms ens. »). isNumericAbbrKeyLine se borne à 3 tokens au
    // maximum avant le séparateur — une suite à 4 tokens ou plus (même chacun ≤ 6 car., même
    // avec un chiffre dedans) reste une phrase de prose ordinaire, jamais une clé de
    // glossaire, et continue de fusionner comme avant ce correctif.
    const out = reflowLines([
      L('Il ne reste plus qu’un'),
      L('petit 2 de trop : rabattre normalement.'),
    ])
    expect(out).toHaveLength(1)
  })
})

describe('reflowLines — garde symétrique hasStrongContinuationSignal (revue, préemption à tort)', () => {
  // Revue bloquante : isNumericAbbrKeyLine ne regardait jamais `p`, donc elle préemptait TOUT
  // signal de continuation positif situé plus bas dans shouldJoin (DANGLING_RE, OPEN_REP_RE,
  // les règles allemandes…) dès que nt avait la forme « compte nu = / : définition », pas
  // seulement le faux positif DANGLING_RE visé par le correctif d'origine. Chacun des cas
  // ci-dessous fusionnait AVANT le correctif isNumericAbbrKeyLine, restait scindé À TORT une
  // fois ce correctif posé seul, et doit refusionner avec la garde symétrique.
  it('laisse DANGLING_RE fusionner un mot-outil RÉEL (« de ») suivi d’un compte nu « = »/« : »', () => {
    const out = reflowLines([
      L("Continuer jusqu'à une longueur totale de"),
      L('45 cm : rabattre toutes les mailles.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe("Continuer jusqu'à une longueur totale de 45 cm : rabattre toutes les mailles.")
  })
  it('laisse OPEN_REP_RE fusionner un span de répétition ouvert suivi d’un compte nu « = »/« : »', () => {
    const out = reflowLines([L('Répéter depuis *'), L('10 fois : au total 30 rangs.')])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Répéter depuis * 10 fois : au total 30 rangs.')
  })
  it('laisse DANGLING_RE fusionner un mot-outil anglais RÉEL (« for »)', () => {
    const out = reflowLines([L('Continue working the pattern for'), L('12 rows: then bind off.')])
    expect(out).toHaveLength(1)
  })
  it('laisse DANGLING_RE fusionner un mot-outil anglais RÉEL (« with »)', () => {
    const out = reflowLines([L('Finish the round with'), L('10 sts: then fasten off.')])
    expect(out).toHaveLength(1)
  })
  it('ne laisse PAS le mot-outil « e » ARTEFACT D’ACCENT (« serrée ») rouvrir le bug FR d’origine', () => {
    // La garde symétrique ne doit PAS réutiliser DANGLING_RE telle quelle sur p — sinon ce
    // cas précis (le bug d'origine que ce fichier corrige) redeviendrait « signal positif
    // détecté » et refusionnerait. endsOnDanglingWord compare le DERNIER TOKEN ENTIER de p
    // (« serrée »), jamais un \b interne : « serrée » ≠ « e », donc pas de faux déblocage.
    const out = reflowLines([L('ms = maille serrée'), L('2 ms ens. = 2 mailles serrées ensemble')])
    expect(out).toHaveLength(2)
  })
  it('ne laisse PAS un mot-outil final ordinaire (« bajo », pas un mot-outil isolé) débloquer le garde-fou', () => {
    const out = reflowLines([L('pb = punto bajo'), L('s 1 p = salta un punto')])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — suite « 15 (16) » après une ligne finissant sur un total (agnes-sweater-en-4f1102bf)', () => {
  // Cas réel agnes-sweater-en-4f1102bf (suite du correctif 162b2dec) : après
  // restitution de « Neck: … = 13 (14) » dans sa section, la queue physique du rang reste
  // une puce orpheline — la continuation s'ouvre sur un VECTEUR ALTERNÉ « 15 (16) sts. »
  // (chiffre + espace + parenthèse ouvrante) qu'aucun signal existant ne reconnaît :
  // NEW_ITEM_RE exige un marqueur de liste APRÈS le chiffre (« 15. », « 15) »),
  // OPEN_NUMERIC_VECTOR_RE exige la parenthèse en TÊTE de nt, et le test minuscule ne
  // s'applique pas (nt commence par un chiffre). Même famille observée côté allemand
  // (viking) : totaux « = 24 (27) 29 (31) Maschen » scindés entre deux tailles du vecteur.
  // Correctif ADDITIF : le nouveau signal est testé en DERNIER RECOURS dans shouldJoin,
  // après tous les refus existants — il ne peut préempter aucun garde déjà en place.
  it('recolle « 15 (16) sts. … » après une ligne finissant sur un total entre parenthèses', () => {
    const out = reflowLines([
      L('Neck: Bind off the centre 10 sts for neck, dec 2 sts at each end of the next 4 rows = 13 (14)'),
      L('15 (16) sts. Bind off on next row*.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Neck: Bind off the centre 10 sts for neck, dec 2 sts at each end of the next 4 rows = 13 (14) 15 (16) sts. Bind off on next row*.'
    )
  })
  it('recolle aussi la même continuation après un total NU (chiffre sans parenthèses)', () => {
    // trailingNumberOrVector couvre les DEUX formes de total en fin de ligne : chiffre nu
    // (« = 13 ») ou parenthèse fermée contenant un chiffre (« 13 (14) »). Le chiffre nu est
    // la forme du cas viking (« = 24 (27) » / « 29 (31) Maschen »).
    const out = reflowLines([
      L('Neck: Bind off the centre 10 sts for neck, dec 2 sts = 13'),
      L('14 (15) sts. Bind off on next row*.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Neck: Bind off the centre 10 sts for neck, dec 2 sts = 13 14 (15) sts. Bind off on next row*.')
  })
  it('ne fusionne pas une liste de matériaux « …aiguilles : » + « 3 (4) skeins » (contre-test, garanti par l’ordre des tests)', () => {
    // La garantie vient de l'ORDRE de shouldJoin : TERMINAL_RE (le « : » final de p) bloque
    // la fusion (return false du bloc TERMINAL_RE/COLON_THEN_PAREN_RE) AVANT tout signal
    // positif — le nouveau signal « total + vecteur alterné », testé en dernier recours,
    // n'est jamais atteint pour une ligne finissant sur « : ». Ce test ancre cette
    // garantie pour qu'une réorganisation future de shouldJoin ne la casse pas en silence.
    const out = reflowLines([
      L('Matériel : 1 pelote de laine, aiguilles :'),
      L('3 (4) skeins of yarn.'),
    ])
    expect(out).toHaveLength(2)
  })
  it('ne fusionne pas une VRAIE fin de phrase suivie d’un vecteur alterné (TERMINAL_RE garde, non-régression)', () => {
    // Même principe : un point final sur p bloque la fusion avant tout signal positif —
    // seuls les totaux nus (BARE_COUNT_*) y échappent, et « 15 (16) sts. … » n'en est pas un.
    const out = reflowLines([
      L('Neck: Bind off on next row.'),
      L('15 (16) sts. Bind off on next row*.'),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — paquet allemand vague 7 (sunburst-adult-s-top-de, bernadette-tote-bag-de, sofie-vest-de, easter-chick-pip-de, sunshine-children-s-sweater-en)', () => {
  // Discipline du ledger de GERMAN_DANGLING_RE : UN token cité par cas réel, extension de
  // liste uniquement, jamais de nouvelle mécanique. Chaque paire ci-dessous est la citation
  // verbatim du .pdf.txt du patron témoin (sauf easter-chick, corpus antérieur).

  // ——— « or » anglais (DANGLING_RE) ———
  it('recolle « …43cm or » devant le vecteur de tailles qui le complète (sunshine-children-s-sweater-en)', () => {
    // Cas réel (l.92-93 du .pdf.txt) : « …is (25/27/31/35/37/39/43cm or » / « 10/11/12/14/15/16/17’ » —
    // la conjonction anglaise « or » pend en fin de ligne devant la seconde moitié du vecteur
    // cm/pouces ; token standard, même liste que « og » (DA/NO), « und » (DE), « and » (EN).
    const out = reflowLines([
      L('Continue Row 4 until the height of your panel is (25/27/31/35/37/39/43cm or'),
      L('10/11/12/14/15/16/17’'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Continue Row 4 until the height of your panel is (25/27/31/35/37/39/43cm or 10/11/12/14/15/16/17’')
  })
  it('« or » ne fusionne pas un nouvel item de liste (NEW_ITEM_RE reste prioritaire)', () => {
    const out = reflowLines([
      L('If you prefer, track your rounds with a stitch marker or'),
      L('2. Row: work in stockinette.'),
    ])
    expect(out).toHaveLength(2)
  })

  // ——— « beiden » (GERMAN_DANGLING_RE) ———
  it('recolle « …der beiden » devant « Bobbel » (sunburst-adult-s-top-de)', () => {
    // Cas réel (l.133-134) : « …und arbeite aus der Mitte der beiden » / « Bobbel gleichzeitig. » —
    // forme déclinée (génitif pluriel) du quantificateur « beide » déjà dans la liste.
    const out = reflowLines([
      L('ein Knäuel in zwei Hälften, wickle es in 2 Bobbel und arbeite aus der Mitte der beiden'),
      L('Bobbel gleichzeitig. Du kannst aber auch eine andere Methode wählen.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'ein Knäuel in zwei Hälften, wickle es in 2 Bobbel und arbeite aus der Mitte der beiden Bobbel gleichzeitig. Du kannst aber auch eine andere Methode wählen.',
    )
  })
  it('recolle « …auf beiden » devant « Seiten » (sofie-vest-de)', () => {
    // Cas réel (l.61-62) : « …Für den Armausschnitt auf beiden » / « Seiten abnehmen: ».
    const out = reflowLines([
      L('Glatt rechts in Reihen auf der Rundstricknadel stricken. Für den Armausschnitt auf beiden'),
      L('Seiten abnehmen:'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Glatt rechts in Reihen auf der Rundstricknadel stricken. Für den Armausschnitt auf beiden Seiten abnehmen:',
    )
  })
  it('« beiden » ne fusionne pas un nouvel item de liste allemand (NEW_ITEM_RE reste prioritaire)', () => {
    const out = reflowLines([
      L('Für den Armausschnitt auf beiden'),
      L('2. Reihe: alle Maschen rechts.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
  it('sans isGerman, la même coupure après « beiden » reste scindée (non-régression)', () => {
    const out = reflowLines([
      L('Glatt rechts in Reihen auf der Rundstricknadel stricken. Für den Armausschnitt auf beiden'),
      L('Seiten abnehmen:'),
    ])
    expect(out).toHaveLength(2)
  })

  // ——— radicaux « erst »/« link » + article contracté « am » (GERMAN_ADJ_RE) ———
  it('recolle « …am ersten » devant « Maschenmarkierer » (sunburst-adult-s-top-de)', () => {
    // Cas réel (l.183-184) : « …vernähen, wenn du am ersten » / « Maschenmarkierer bist. » —
    // l'ordinal adjectival « ersten » attend son nom ; il est précédé de la contraction
    // « am » (an+dem), absente du groupe d'articles d'origine.
    const out = reflowLines([
      L('schließen und den Faden abschneiden und vernähen, wenn du am ersten'),
      L('Maschenmarkierer bist.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'schließen und den Faden abschneiden und vernähen, wenn du am ersten Maschenmarkierer bist.',
    )
  })
  it('recolle « …mit der linken » devant « Seite » (sunburst-adult-s-top-de)', () => {
    // Cas réel (l.208-209) : « …dass dein Top mit der linken » / « Seite nach außen liegt. ».
    const out = reflowLines([
      L('Zuerst werden die Seitennähte geschlossen. Achte darauf, dass dein Top mit der linken'),
      L('Seite nach außen liegt.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'Zuerst werden die Seitennähte geschlossen. Achte darauf, dass dein Top mit der linken Seite nach außen liegt.',
    )
  })
  it('« am » seul devant un nom ordinaire ne déclenche pas le signal (radical exigé)', () => {
    // Le nouvel article « am » ne fusionne QUE suivi d'un radical de la liste CHOISIE —
    // « am Nachmittag » est un groupe prépositionnel complet, pas un adjectif en attente.
    const out = reflowLines([
      L('Wir treffen uns am'),
      L('Nachmittag.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
  it('« am ersten » ne fusionne pas un nouvel item de liste allemand (NEW_ITEM_RE reste prioritaire)', () => {
    const out = reflowLines([
      L('Vernähe die Fäden, wenn du am ersten'),
      L('2. Reihe: alle Maschen rechts.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })

  // ——— unités Km / M / Stb / Schlaufen / Seite (GERMAN_UNIT_RE) ———
  it('recolle « durch 2 » devant « Schlaufen ziehen » (sunburst-adult-s-top-de, Reihe 3)', () => {
    // Cas réel (l.101-102) : « …umschlagen, durch 2 » / « Schlaufen ziehen, … ».
    const out = reflowLines([
      L('umschlagen, in die Masche stechen, eine Schlaufe durchziehen, umschlagen, durch 2'),
      L('Schlaufen ziehen, es sind noch 2 Schlaufen auf der Nadel.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'umschlagen, in die Masche stechen, eine Schlaufe durchziehen, umschlagen, durch 2 Schlaufen ziehen, es sind noch 2 Schlaufen auf der Nadel.',
    )
  })
  it('recolle « Schließe die Runde mit 1 » devant « Km oben… » (sunburst-adult-s-top-de, Reihe 3)', () => {
    // Cas réel (l.105-106) : « …bis du insgesamt 16 hast. Schließe die Runde mit 1 » /
    // « Km oben in die erste M und schließe die Arbeit. ».
    const out = reflowLines([
      L('Weitere oben in die M der vorigen Runde 15 Blütenblatt-M häkeln (aber nicht in die'),
      L('1-Lm-Bögen) mit 2 Lm jeweils danach, bis du insgesamt 16 hast. Schließe die Runde mit 1'),
      L('Km oben in die erste M und schließe die Arbeit.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
  })
  it('recolle « …die letzten 3 » devant « M zus. (23) » (easter-chick-pip-de)', () => {
    // Cas réel (l.117-118 du .pdf.txt) : « …1 fM in die nächsten 5 m. die letzten 3 » /
    // « M zus. (23) » — le total « M zus. » du rang 9 des ailes était une puce orpheline.
    // NB : la citation d'origine « die 1. / M schließen » (sunburst Reihe 2) est recollée
    // depuis l'exception ordinale GERMAN_PREP_ORDINAL_RE — cf. le describe dédié en fin de
    // fichier (sunburst-adult-s-top-de / knit-domino-shawl-de).
    const out = reflowLines([
      L('9. 1 fM in die ersten 5 m. 2 fM in die nächsten 6 m. 1 fM in die nächsten 5 m. die letzten 3'),
      L('M zus. (23)'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      '9. 1 fM in die ersten 5 m. 2 fM in die nächsten 6 m. 1 fM in die nächsten 5 m. die letzten 3 M zus. (23)',
    )
  })
  it('recolle « (Insgesamt: 12 » devant « Stb, 12 RStb-v). » (bernadette-tote-bag-de, Rd 2)', () => {
    // Cas réel (l.81-82) : le total de fin de rond « (Insgesamt: 12 » / « Stb, 12 RStb-v). ».
    const out = reflowLines([
      L('Rd 2: 3 Lm (zählen als Stb), RStb-v um dieselbe M aus Rd 1, (Stb in die nächste M, RStb-v um'),
      L('dieselbe M aus Rd 1) x 11, mit einer Km in die 3. der 3 Lm vom Anfang verbinden. (Insgesamt: 12'),
      L('Stb, 12 RStb-v).'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
  })
  it('recolle « …nur an 1 » devant « Seite des Quadrats » (sunburst-adult-s-top-de)', () => {
    // Cas réel (l.156-157) : « …3 Lm und wenden (du solltest nur an 1 » /
    // « Seite des Quadrats gehäkelt haben). ».
    const out = reflowLines([
      L('ersten Ecke. 3 Lm in den Lm-Bogen an der Ecke, 3 Lm und wenden (du solltest nur an 1'),
      L('Seite des Quadrats gehäkelt haben). Für Größe XL die Arbeit schließen.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'ersten Ecke. 3 Lm in den Lm-Bogen an der Ecke, 3 Lm und wenden (du solltest nur an 1 Seite des Quadrats gehäkelt haben). Für Größe XL die Arbeit schließen.',
    )
  })
  it('les nouvelles unités ne fusionnent pas un nouveau rang (NEW_ITEM_RE reste prioritaire)', () => {
    const out = reflowLines([
      L('Schließe die Runde mit 1'),
      L('Rd 3: 3 Lm in jeden Bogen.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
  it('sans isGerman, la coupure chiffre nu + unité reste scindée (non-régression)', () => {
    const out = reflowLines([
      L('9. 1 fM in die ersten 5 m. 2 fM in die nächsten 6 m. 1 fM in die nächsten 5 m. die letzten 3'),
      L('M zus. (23)'),
    ])
    expect(out).toHaveLength(2)
  })
  it('une tête d’unité sans chiffre ni vecteur en fin de ligne précédente ne fusionne pas (non-régression)', () => {
    // La branche GERMAN_UNIT_RE exige trailingNumberOrVector(p) : « Seite » en tête de nt
    // ne recolle que la suite d'un COMPTE, jamais d'une phrase ordinaire terminée.
    const out = reflowLines([
      L('Die Teile liegen nun bereit'),
      L('Seite an Seite.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — ordinal allemand pointé en fin de ligne (sunburst-adult-s-top-de / knit-domino-shawl-de)', () => {
  // L'ORDINAL allemand avec point (« die 1. », « der 1. ») en toute fin de ligne est lu par
  // TERMINAL_RE comme une fin de phrase — bloc dur en tête de shouldJoin. Un signal
  // grammatical fort le contourne : une phrase allemande ne se termine JAMAIS sur
  // préposition/article suivi d'un ordinal pointé (« in die 1. » attend son nom, ici « M »).
  // Chaque paire ci-dessous est la citation verbatim du .pdf.txt.

  it('recolle « …mit 1 Km oben in die 1. » devant « M schließen… » (sunburst-adult-s-top-de, Reihe 2)', () => {
    // Cas réel (l.98-99) : « …bis du insgesamt 16 hast, mit 1 Km oben in die 1. » /
    // « M schließen. Die Arbeit noch nicht schließen. » — sans recollage, « M schließen. »
    // devient une puce orpheline dans la série des rangs.
    const out = reflowLines([
      L('vorigen Runde häkeln, gefolgt von 1 Lm, bis du insgesamt 16 hast, mit 1 Km oben in die 1.'),
      L('M schließen. Die Arbeit noch nicht schließen.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      'vorigen Runde häkeln, gefolgt von 1 Lm, bis du insgesamt 16 hast, mit 1 Km oben in die 1. M schließen. Die Arbeit noch nicht schließen.',
    )
  })
  it('recolle « …der 1. Patchecke in der 1. » devant « Bahn aufstricken = 47 m. » (knit-domino-shawl-de)', () => {
    // Cas réel (l.70-71) : « 24 M anschlagen, … an der rechten Seite der 1. Patchecke in der 1. » /
    // « Bahn aufstricken = 47 m. » — « in der 1. Bahn » = dans la 1re file ; la suite ouverte
    // sur « Bahn » (substantif capitalisé) n'est captée par aucune autre règle, et KV_RE ne
    // matche pas (« aufstricken », 2e token, dépasse la longueur de clé possible).
    const out = reflowLines([
      L('24 M anschlagen, auf der Vorderseite 23 M an der rechten Seite der 1. Patchecke in der 1.'),
      L('Bahn aufstricken = 47 m.'),
    ], { isGerman: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      '24 M anschlagen, auf der Vorderseite 23 M an der rechten Seite der 1. Patchecke in der 1. Bahn aufstricken = 47 m.',
    )
  })
  it('une vraie fin de phrase suivie d’un nouveau rang ne fusionne pas (NEW_ITEM_RE prioritaire)', () => {
    // « …bis 3 Maschen zurück sind. » : le « bis » est en MILIEU de phrase, p finit sur le
    // verbe conjugué — l'exception ordinale ne s'arme pas, et « 2.Reihe » est de toute façon
    // un nouvel item.
    const out = reflowLines([
      L('Nimm die Maschen wieder auf und stricke, bis 3 Maschen zurück sind.'),
      L('2.Reihe (rechte Seite): 1 M re abheben, re bis Nadelende.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
  it('l’exception ordinale n’avale pas un nouveau rang : « …in der 1. » + « 2.Reihe » reste scindé (garde NEW_ITEM_RE)', () => {
    // La double garde exigée par la note de méthode : l'exception ne peut s'armer que si la
    // suite n'ouvre RIEN — ici elle ouvre le rang 2.
    const out = reflowLines([
      L('Arbeite die Abnahmen jeweils in der 1.'),
      L('2.Reihe (linke Seite): 1 M re abheben, re bis Nadelende.'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
  it('sans isGerman, une phrase française finissant sur « …du rang 1. » ne fusionne pas (exception isolée à l’allemand)', () => {
    const out = reflowLines([
      L('Continuer en jersey endroit jusqu’à la fin du rang 1.'),
      L('puis tourner l’ouvrage.'),
    ])
    expect(out).toHaveLength(2)
  })
  it('« …in der 1. » suivi d’une clé de glossaire « k1 = … » ne fusionne pas (garde KV_RE)', () => {
    // Même garde que NEW_ITEM_RE : une clé « clé = définition » en tête de suite ouvre une
    // entrée de glossaire, pas une continuation de phrase.
    const out = reflowLines([
      L('Wiederhole die Zunahmen in der 1.'),
      L('k1 = 1 Masche rechts stricken'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
  // (revue) La double garde de l'exception ordinale ne couvrait que
  // NEW_ITEM_RE et KV_RE : une entrée de glossaire à tiret cadratin (EN_DASH_KV_RE) ou à
  // clé comptée (« 2 M zus = … », isNumericAbbrKeyLine) n'ouvrait RIEN aux yeux de ces
  // deux gardes et se faisait fusionner dans la fin de phrase allemande qui la précède.
  it('« …in der 1. » suivi d’une entrée de glossaire à tiret cadratin « M – Masche » ne fusionne pas (garde EN_DASH_KV_RE)', () => {
    const out = reflowLines([
      L('…an der rechten Seite der 1.'),
      L('M – Masche'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
    expect(out[1].text).toBe('M – Masche')
  })
  it('« …in der 1. » suivi d’une clé comptée « 2 M zus = … » ne fusionne pas (garde isNumericAbbrKeyLine)', () => {
    // Clé de glossaire à compte nu — KV_RE ne la voit pas (token chiffre en tête), seul
    // isNumericAbbrKeyLine la reconnaît : sans la garde symétrique, l'exception ordinale
    // l'avalait dans la phrase précédente.
    const out = reflowLines([
      L('Stricke die Abnahmen jeweils in der 1.'),
      L('2 M zus = 2 Maschen rechts zusammenstricken'),
    ], { isGerman: true })
    expect(out).toHaveLength(2)
  })
})

describe('reflowLines — ordinal anglais antéposé « 1st row » (revue, famille Yarnspirations)', () => {
  // ROW_START_RE (segment.js) reconnaît l'ordinal antéposé depuis le 27/08 (commit
  // 8a3420dc, lush-life-crochet-blanket-en) ; NEW_ITEM_RE ne l'a jamais reçu. Une ligne
  // « 1st row: … » qui suit une ligne finissant sur un mot-outil (DANGLING_RE) était donc
  // fusionnée : le rang avalé dans la ligne d'avant. La branche ajoutée est l'ordinale
  // ANGLAISE (st/nd/rd/th + row/round), miroir compact de la branche correspondante de
  // ROW_START_RE ; les ordinaux français (1er/1ère rang) restent hors vocabulaire, comme
  // dans le reste de NEW_ITEM_RE.
  it('n’avale pas « 1st row: … » après un mot-outil en fin de ligne (DANGLING_RE, garde NEW_ITEM_RE)', () => {
    const out = reflowLines([
      L('Continue as set for the'),
      L('1st row: (RS). 1 dc in each dc to end of row.'),
    ])
    expect(out).toHaveLength(2)
    expect(out[1].text).toBe('1st row: (RS). 1 dc in each dc to end of row.')
  })
  it('mode para : « …as follows: » + « 1st row: … » ne fusionne pas (sameParagraph ne consulte que NEW_ITEM_RE/KV_RE)', () => {
    // Le recoll paragraphe (gap d’interligne normal) court-circuite shouldJoin et son
    // bloc dur TERMINAL_RE : « …as follows: » fusionnait donc avec le rang qui suit dès
    // lors que NEW_ITEM_RE ne le reconnaissait pas — c’était le chemin du bug, invisible
    // au seul test de shouldJoin.
    const out = reflowLines([
      L('Work the scarf as follows:', 100),
      L('1st row: (RS). 1 dc in next dc.', 88),
    ], { para: true })
    expect(out).toHaveLength(2)
    expect(out[1].text).toBe('1st row: (RS). 1 dc in next dc.')
  })
  it('non-régression : un compte SANS suffixe ordinal (« 2 rows below… », définition d’abréviation) reste fusionnable', () => {
    // Même contre-test que la branche ROW_START_RE de segment.js : « 2 rows » n’a pas de
    // suffixe ordinal collé au chiffre, la branche ne le touche donc jamais — le recoll
    // par mot-outil pend « the » doit continuer à fonctionner.
    const out = reflowLines([
      L('Trfp = treble front post (see the'),
      L('2 rows below the armhole).'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Trfp = treble front post (see the 2 rows below the armhole).')
  })
})

describe('reflowLines — garde bandeau copyright (Cortina p.2, « middle of © House of Yarn AS »)', () => {
  // Cas réel (111-14-chunky-cortina-sweater-en, p.2, colonne gauche) : la colonne finit par
  // « …work diagram A. Count outwards from the middle of » puis le bandeau copyright en bas
  // de page. La fusion a DEUX chemins en OU — shouldJoin (DANGLING_RE attrape le « of »
  // final) ET sameParagraph (mode para : interligne court, ne consulte que NEW_ITEM_RE/
  // KV_RE sur la ligne suivante) — donc la garde doit être une condition NÉGATIVE du `if`
  // de fusion lui-même, pas un simple return false dans shouldJoin (que sameParagraph
  // contourne). Sans elle : « middle of © House of Yarn AS » dans le MD final.

  it('chemin shouldJoin : ne recolle PAS « …from the middle of » au bandeau « © House of Yarn AS » (mode non-para)', () => {
    // DANGLING_RE (« of » final) aurait joint — la ligne courante est une TÊTE de bandeau,
    // jamais la continuation d'une phrase du patron.
    const out = reflowLines([
      L('At the same time, when the piece measures 44 cm (women) / 50 cm (men), work diagram A. Count outwards from the middle of'),
      L('© House of Yarn AS'),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual([
      'At the same time, when the piece measures 44 cm (women) / 50 cm (men), work diagram A. Count outwards from the middle of',
      '© House of Yarn AS',
    ])
  })

  it('chemin shouldJoin bloqué aussi en mode para', () => {
    const out = reflowLines([
      L('work diagram A. Count outwards from the middle of', 100),
      L('© House of Yarn AS', 88),
    ], { para: true })
    expect(out).toHaveLength(2)
    expect(out[1].text).toBe('© House of Yarn AS')
  })

  it('chemin sameParagraph : une tête de bandeau « © … » ne recolle pas même à interligne court (shouldJoin dit non, para dirait oui)', () => {
    // Isolation du chemin sameParagraph : la ligne précédente ne porte AUCUN signal de
    // shouldJoin (pas de mot-outil pendant, pas de ponctuation terminale) — seule la
    // géométrie para (gap 12 ≤ 1.6 × size 10) fusionnait, en court-circuitant tous les
    // gardes typographiques. C'est exactement le bug mesuré sur le PDF réel.
    const out = reflowLines([
      L('Continue in stocking st and count outwards from the middle', 100),
      L('© House of Yarn AS', 88),
    ], { para: true })
    expect(out).toHaveLength(2)
    expect(out.map((l) => l.text)).toEqual([
      'Continue in stocking st and count outwards from the middle',
      '© House of Yarn AS',
    ])
  })

  it('les autres têtes du motif (« Copyright … », « (c) … ») sont bloquées de la même façon', () => {
    const out1 = reflowLines([L('Continue the diagram and count outwards from the middle of'), L('Copyright 2026 House of Yarn AS. All rights reserved.')])
    expect(out1).toHaveLength(2)
    const out2 = reflowLines([L('Continue the diagram and count outwards from the middle of'), L('(c) House of Yarn AS. All rights reserved.')])
    expect(out2).toHaveLength(2)
  })

  it('fusion INTERNE au bandeau préservée : « The copying… » (continuation, pas une tête) recolle à « © House of Yarn AS » à interligne court', () => {
    // La garde ne doit bloquer que quand la COURANTE est une TÊTE de bandeau (©/(c)/
    // Copyright) — la 2e ligne d'un bandeau (« The copying… ») n'en est pas une et doit
    // continuer de fusionner (bandeau compact). Chemin sameParagraph pur : shouldJoin
    // ne dit rien ici (p finit sur « AS » sans ponctuation, nt commence par une majuscule).
    const out = reflowLines([
      L('© House of Yarn AS', 100),
      L('The copying and publication of materials and patterns, or their use for commercial purposes,', 88),
    ], { para: true })
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(
      '© House of Yarn AS The copying and publication of materials and patterns, or their use for commercial purposes,'
    )
  })
})


describe('reflowLines — tiret cadratin espacé en fin de ligne (jingle-bells-ornament-de)', () => {
  it('recolle un nom de coloris coupé après un tiret cadratin espacé', () => {
    // Cas réel : Jingle Bells Ornament (Hobbii DE), « Farbe 18121 – » / « Garn B » ne
    // fusionnaient jamais — \b (DANGLING_RE) ne matche pas un tiret précédé d'un espace.
    const out = reflowLines([
      L('1 Knäuel Glitter Deluxe 30g, Farbe 18121 –'),
      L('Garn B'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('1 Knäuel Glitter Deluxe 30g, Farbe 18121 – Garn B')
  })
  it('fusionne aussi après un tiret cadratin (em dash, U+2014)', () => {
    const out = reflowLines([L('Ligne A —'), L('Ligne B')])
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Ligne A — Ligne B')
  })
  it('ne fusionne pas une puce de liste à tiret ASCII en tête de ligne (non-régression unicorn-pillow)', () => {
    const out = reflowLines([L('m - maille'), L('ml - maille en l’air')])
    expect(out).toHaveLength(2)
  })
  it('ne fusionne pas deux entrées de glossaire à tiret cadratin consécutives (non-régression lucent-sweater-en)', () => {
    const out = reflowLines([L('CO – cast on'), L('C4B – cable 4 back')])
    expect(out).toHaveLength(2)
  })
})

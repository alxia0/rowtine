// Patrons et projets de DÉMONSTRATION, version française.
//
// ⚠️ Contenu INVENTÉ pour l'application (30/07). Il remplace les 4 patrons transcrits de
// PDF réels sous copyright, déplacés dans tests/unit/__fixtures__/ : ils servaient de
// fixtures riches aux tests du moteur, ils y restent, mais ils ne sont plus livrés.
//
// Rédigé NATIVEMENT dans chaque langue (fr/en/de/es), jamais traduit à l'exécution : un
// patron de tricot a un vocabulaire propre à sa langue, qu'une traduction mot à mot rend
// illisible pour une tricoteuse. Les quatre fichiers partagent la même STRUCTURE (mêmes
// demoId, mêmes genres de section, mêmes compteurs) — c'est ce que vérifiera
// tests/unit/demo-parity.spec.js (tâche C5, à venir).
//
// Court par construction : ces exemples montrent ce que l'application sait faire
// (compteurs multi-tailles, répétitions, diagramme, aide-mémoire), ils ne prétendent pas
// être des patrons publiables.
//
// Le Bonnet Torsade a été recalculé à la main (30/07) : la version d'origine faisait perdre
// des mailles à un rythme qui ne divise pas juste (« 2 end., 2 ens. » répété tel quel sur un
// compte qui cesse vite d'être multiple de 4) et affichait un total final inventé sans lien
// avec le calcul. La diminution du sommet suit ici la technique réelle « 8 marqueurs, 1
// diminution par section » : à chaque tour de diminution on retire exactement 8 m. (une par
// marqueur), ce qui reste vrai quel que soit le nombre de mailles en cours. Vérifié :
// 96→88→…→16 (10 tours), 104→96→…→16 (11 tours), 112→104→…→16 (12 tours) — les trois
// tailles finissent à 16 m., un compte réaliste à rassembler à l'aiguille à laine. Les
// hauteurs en cm sont dérivées du nombre de tours réellement tricotés (26 tours = 10 cm) et
// changent si la structure du corps ou du sommet change — pas recopiées. Le diagramme
// (24 rangs) est suivi en entier via un unique compteur `REP` avant de commencer le
// sommet : s'arrêter à mi-motif comme le faisait un brouillon antérieur aurait laissé la
// torsade inachevée sur le seul patron censé la démontrer.
import { buildReference } from '@/utils/reader-reference'
import { DEMO_SKETCH_BONNET, DEMO_SKETCH_ECHARPE, DEMO_SKETCH_SAC } from '@/constants/demo-visuals'
// Mini-DSL de construction des étapes (c/ROW/NOTE/REP/CHART/chartRounds) : code logique
// pur, partagé par les 4 fichiers de langue — voir dsl.js pour la justification.
import { c, ROW, NOTE, REP, CHART, chartRounds } from './dsl'

const CHART_TORSADE = {
  rows: 24,
  cols: 8,
  img: '/demo/torsade-chart.svg',
  repeat: '8 m × 24 rangs',
  readDir: 'rtl', // code, pas une phrase : traduit à l'affichage (reader.chart.readDir.*)
}

/* ───────────────────────────── Bonnet Torsade (patron du projet en cours) ─────────────── */
const BONNET = {
  demoId: 'bonnet',
  name: 'Bonnet Torsade',
  type: 'knitting',
  category: 'accessories',
  sizes: ['S', 'M', 'L'],
  needleMm: '4.5',
  gaugeStitches: '20',
  gaugeRows: '26',
  photos: [DEMO_SKETCH_BONNET],
  reader: {
    sizeLabels: ['S', 'M', 'L'],
    sizeSub: ['50-52', '54-56', '58-60'],
    sizeSubLabel: 'tour de tête (cm)',
    chart: CHART_TORSADE,
    sections: [
      {
        id: 'bordure', kind: 'bordure', title: 'Bordure en côtes',
        steps: [
          ROW('Monter {{0}} m. avec les aiguilles circulaires n° 4 et fermer en rond.', c(88, 96, 104)),
          ROW('Placer un anneau marqueur : il repère le début du tour.'),
          ROW('Tricoter en côtes 2/2 (2 m. end., 2 m. env.) pendant {{0}} cm.', c(4, 5, 6)),
        ],
      },
      {
        id: 'corps', kind: 'motif', title: 'Corps et torsade', chart: CHART_TORSADE,
        steps: [
          ROW('Passer aux aiguilles n° 4,5 et tricoter 1 tour à l’end. en répartissant {{0}} augmentations.', c(8, 8, 8)),
          NOTE('On a maintenant {{0}} m. sur l’aiguille.', c(96, 104, 112)),
          NOTE('La torsade se tricote sur les 8 m. centrales du devant, en suivant le diagramme.'),
          CHART,
          ROW('Suivre le diagramme sur les 8 m. centrales, tour après tour, en tricotant tout le reste du tour à l’end.'),
          chartRounds('Tricoter les {{0}} tours du diagramme.', CHART_TORSADE, 3),
          NOTE('Le bonnet mesure alors environ {{0}} cm depuis le bord.', c(14, 15, 16)),
        ],
      },
      {
        id: 'sommet', kind: 'corps', title: 'Diminutions du sommet',
        steps: [
          NOTE('Le diagramme est terminé : le sommet se tricote entièrement à l’end.'),
          ROW('Placer 7 AM de plus, tous les {{0}} m. : avec le marqueur de début de tour, cela fait 8 repères en tout.', c(12, 13, 14)),
          ROW('Tour de diminution : * tricoter à l’end. jusqu’à 2 m. avant l’AM suivant, 2 m. ens. à l’end. *, répéter aux 8 AM : il reste {{0}} m.', c(88, 96, 104)),
          ROW('Tricoter 1 tour sans diminuer.'),
          REP('Répéter ces deux tours encore {{0}} fois : il reste {{1}} m.', c(9, 10, 11), c(16, 16, 16)),
        ],
      },
      {
        id: 'finitions', kind: 'finitions', title: 'Finitions',
        steps: [
          ROW('Couper le fil, le passer dans les m. restantes et serrer.'),
          ROW('Rentrer les fils sur l’envers.'),
          NOTE('Astuce : faire sécher le bonnet humide sur un saladier pour arrondir la calotte.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'm.', def: 'maille(s)' },
        { key: 'end.', def: 'à l’endroit' },
        { key: 'env.', def: 'à l’envers' },
        { key: 'ens.', def: 'ensemble — tricoter plusieurs mailles en une seule' },
        { key: 'AM', def: 'anneau marqueur — un repère qu’on glisse sur l’aiguille' },
      ],
      gauge: '20 m. × 26 tours en jersey endroit, aiguilles n° 4,5 = 10 × 10 cm.',
      needles: 'Aiguilles circulaires n° 4 et n° 4,5 (40 cm), aiguille à torsade, 8 anneaux marqueurs.',
      yarn: 'Fil à tricoter d’épaisseur moyenne (110 m = 50 g) : 100 (100) 150 g.',
      techniques: [
        { title: 'Croiser une torsade vers la gauche', body: 'Glisser 4 m. sur l’aiguille à torsade et la laisser DEVANT l’ouvrage, tricoter les 4 m. suivantes à l’end., puis tricoter à l’end. les 4 m. en attente.' },
        { title: 'Tricoter 2 mailles ensemble', body: 'Piquer l’aiguille droite dans 2 mailles à la fois et les tricoter comme une seule : il reste 1 maille au lieu de 2. C’est une diminution.' },
      ],
      sizeTable: [
        { label: 'Tour de tête (cm)', values: ['50-52', '54-56', '58-60'] },
        { label: 'Hauteur finie (cm)', values: ['21', '23', '25'] },
      ],
      tips: ['Cet exemple est livré avec l’application pour te montrer comment fonctionne le lecteur. Tu peux le modifier ou le supprimer à tout moment.'],
    }),
  },
}

/* ───────────────────────────── Écharpe Nuage (taille unique) ─────────────────────────── */
const ECHARPE = {
  demoId: 'echarpe',
  name: 'Écharpe Nuage',
  type: 'knitting',
  category: 'accessories',
  sizes: [],
  needleMm: '6',
  gaugeStitches: '14',
  gaugeRows: '20',
  photos: [DEMO_SKETCH_ECHARPE],
  reader: {
    sizeLabels: [],
    sections: [
      {
        id: 'debut', kind: 'bordure', title: 'Mise en place',
        steps: [
          ROW('Monter 40 m. avec les aiguilles n° 6.'),
          ROW('Tricoter 4 rangs au point mousse (toutes les mailles à l’end., à l’aller comme au retour).'),
        ],
      },
      {
        id: 'corps', kind: 'corps', title: 'Corps de l’écharpe',
        steps: [
          ROW('Rang 1 (endroit) : 4 m. end., * 2 m. env., 2 m. end. *, répéter de * à * jusqu’aux 4 dernières m., 4 m. end.'),
          ROW('Rang 2 (envers) : tricoter les m. comme elles se présentent.'),
          ROW('Répéter les rangs 1 et 2 jusqu’à ce que l’écharpe mesure environ 150 cm.'),
        ],
      },
      {
        id: 'fin', kind: 'finitions', title: 'Finitions',
        steps: [
          ROW('Tricoter 4 rangs au point mousse, puis rabattre souplement.'),
          ROW('Rentrer les fils sur l’envers.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'm.', def: 'maille(s)' },
        { key: 'end.', def: 'à l’endroit' },
        { key: 'env.', def: 'à l’envers' },
        { key: 'point mousse', def: 'toutes les mailles à l’endroit, à l’aller comme au retour' },
      ],
      gauge: '14 m. × 20 rangs en côtes détendues, aiguilles n° 6 = 10 × 10 cm.',
      needles: 'Aiguilles droites n° 6.',
      yarn: 'Fil épais (80 m = 50 g) : 400 g environ.',
      tips: ['Exemple livré avec l’application. Une écharpe est le projet idéal pour apprendre à suivre un patron rang par rang.'],
    }),
  },
}

/* ───────────────────────────── Sac Granny (crochet) ──────────────────────────────────── */
const SAC = {
  demoId: 'sac',
  name: 'Sac Granny',
  type: 'crochet',
  category: 'accessories',
  sizes: [],
  needleMm: '4',
  photos: [DEMO_SKETCH_SAC],
  reader: {
    sizeLabels: [],
    sections: [
      {
        id: 'carre', kind: 'motif', title: 'Le carré granny',
        steps: [
          ROW('Faire une boucle magique, puis 3 ml (elles comptent comme la 1re br).'),
          ROW('Tour 1 : 2 br dans la boucle, * 2 ml, 3 br *, répéter de * à * 3 fois, 2 ml, fermer par 1 mc.'),
          ROW('Tour 2 : 3 ml, * dans l’espace de 2 ml : 3 br, 2 ml, 3 br *, répéter de * à * à chaque coin, fermer par 1 mc.'),
          ROW('Tour 3 : répéter le tour 2 en ajoutant 3 br sur chaque côté droit.'),
          NOTE('Le carré mesure alors environ 12 cm de côté.'),
          ROW('Réaliser 8 carrés identiques.'),
        ],
      },
      {
        id: 'assemblage', kind: 'corps', title: 'Assemblage',
        steps: [
          ROW('Assembler les carrés 4 par 4 en mc, côté contre côté, pour former les deux faces du sac.'),
          ROW('Assembler les deux faces sur trois côtés, en laissant le haut ouvert.'),
        ],
      },
      {
        id: 'anses', kind: 'finitions', title: 'Anses et finitions',
        steps: [
          ROW('Faire 1 tour de ms tout autour de l’ouverture.'),
          ROW('Pour chaque anse : 60 ml, puis 1 rang de ms sur la chaînette. Coudre les extrémités à 8 cm de chaque coin.'),
          ROW('Rentrer les fils.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'ml', def: 'maille en l’air' },
        { key: 'ms', def: 'maille serrée' },
        { key: 'br', def: 'bride' },
        { key: 'mc', def: 'maille coulée' },
      ],
      gauge: 'Un carré granny de 3 tours = environ 12 cm de côté, crochet n° 4.',
      needles: 'Crochet n° 4, aiguille à laine.',
      yarn: 'Coton à crocheter (125 m = 50 g) : 200 g, en 2 à 4 couleurs.',
      tips: ['Exemple livré avec l’application, pour montrer qu’un patron au crochet se suit exactement comme un patron au tricot.'],
    }),
  },
}

export default {
  patterns: [BONNET, ECHARPE, SAC],
  // Deux projets d'exemple : une IDÉE (statut « future ») liée au patron « Écharpe Nuage »
  // et un projet EN COURS lié au patron « Bonnet Torsade ». Le second reprend son nom du
  // patron à l'exécution ; la première garde son propre nom (une envie n'est pas le patron
  // dont elle s'inspire). Les deux reçoivent leur `patternId` au semis (cf.
  // `seedExamplesIfEmpty`) : c'est ce qui leur donne une image sans écrire dans `photos`.
  projects: {
    idea: {
      name: 'Écharpe douillette',
      // Note d'exemple PARLANTE : elle montre à quoi sert le champ (garder ses envies et ses
      // modifications), plutôt que l'ancien « Projet exemple. » qui n'apprenait rien.
      notes:
        'Idée pour cet hiver : laine mérinos vert sauge, 400 g environ, et 20 cm de plus que le patron. Les notes servent à ça — garder ses envies et ses modifications. Exemple livré avec l’application : tu peux le modifier ou le supprimer.',
    },
    wip: { notes: 'Projet exemple lié à un patron de la bibliothèque — tu peux le modifier ou le supprimer.' },
    // Repli quand aucun patron démo n'a pu être semé (cf. seedExamplesIfEmpty).
    fallbackKnitting: 'Pull torsadé',
    fallbackCrochet: 'Sac granny au crochet',
    fallbackNotes: 'Projet exemple — tu peux le modifier ou le supprimer.',
  },
  freePattern: {
    name: 'Patron libre',
    sectionTitle: 'Mon tricot',
    stepText: 'Projet libre : suis ton avancement avec les compteurs ci-dessous. Tu pourras créer un patron détaillé plus tard.',
  },
}

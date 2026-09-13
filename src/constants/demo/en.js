// Patrons et projets de DÉMONSTRATION, version anglaise.
//
// Rédigé NATIVEMENT (jamais traduit à l'exécution) sur le modèle STRUCTUREL de fr.js —
// mêmes demoId, mêmes genres de section, mêmes compteurs. Voir fr.js pour le contexte
// complet (patrons inventés, recalcul du sommet du Bonnet Torsade, etc.).
import { buildReference } from '@/utils/reader-reference'
import { DEMO_SKETCH_BONNET, DEMO_SKETCH_ECHARPE, DEMO_SKETCH_SAC } from '@/constants/demo-visuals'
import { c, ROW, NOTE, REP, CHART, chartRounds } from './dsl'

const CHART_TORSADE = {
  rows: 24,
  cols: 8,
  img: '/demo/torsade-chart.svg',
  repeat: '8 sts × 24 rows',
  readDir: 'rtl',
}

/* ───────────────────────────── Cable Beanie (pattern for the in-progress project) ────── */
const BONNET = {
  demoId: 'bonnet',
  name: 'Cable Beanie',
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
    sizeSubLabel: 'head circumference (cm)',
    chart: CHART_TORSADE,
    sections: [
      {
        id: 'bordure', kind: 'bordure', title: 'Ribbed brim',
        steps: [
          ROW('Cast on {{0}} sts on 4mm circular needles and join in the round.', c(88, 96, 104)),
          ROW('Place a marker: it marks the start of the round.'),
          ROW('Work 2/2 rib (k2, p2) for {{0}} cm.', c(4, 5, 6)),
        ],
      },
      {
        id: 'corps', kind: 'motif', title: 'Body and cable', chart: CHART_TORSADE,
        steps: [
          ROW('Switch to 4.5mm needles and knit 1 round, evenly increasing {{0}} sts.', c(8, 8, 8)),
          NOTE('You now have {{0}} sts on the needle.', c(96, 104, 112)),
          NOTE('The cable is worked over the 8 centre front sts, following the chart.'),
          CHART,
          ROW('Follow the chart over the 8 centre sts, round after round, knitting the rest of the round plain.'),
          chartRounds('Work all {{0}} rounds of the chart.', CHART_TORSADE, 3),
          NOTE('The beanie now measures about {{0}} cm from the brim.', c(14, 15, 16)),
        ],
      },
      {
        id: 'sommet', kind: 'corps', title: 'Crown decreases',
        steps: [
          NOTE('The chart is complete: the crown is worked entirely in stocking stitch.'),
          ROW('Place 7 more markers, every {{0}} sts: with the start-of-round marker, that makes 8 markers in total.', c(12, 13, 14)),
          ROW('Decrease round: * knit to 2 sts before the next marker, k2tog *, repeat at all 8 markers: {{0}} sts remain.', c(88, 96, 104)),
          ROW('Knit 1 round even.'),
          REP('Repeat these two rounds {{0}} more times: {{1}} sts remain.', c(9, 10, 11), c(16, 16, 16)),
        ],
      },
      {
        id: 'finitions', kind: 'finitions', title: 'Finishing',
        steps: [
          ROW('Cut the yarn, thread it through the remaining sts and pull tight.'),
          ROW('Weave in ends on the wrong side.'),
          NOTE('Tip: block the damp beanie over a bowl to round out the crown.'),
        ],
      },
    ],
    reference: buildReference({
      // Notation collée (« k2 », « k2tog ») : le tokenizer réel (src/utils/reader.js,
      // tokenizeLine) exige des frontières de mot, or l'anglais colle la lettre au
      // chiffre — une clé générique « k »/« p »/« tog » ne matcherait jamais dans
      // « k2 » ou « k2tog » et resterait un bouton mort. On déclare donc les formes
      // COMPACTES réellement écrites (seule notation qu'une tricoteuse anglophone
      // reconnaît — lui insérer un espace serait pire), vérifié par
      // tests/unit/demo-glossary-coverage.spec.js.
      abbr: [
        { key: 'sts', def: 'stitches' },
        { key: 'k2', def: 'knit 2 stitches' },
        { key: 'p2', def: 'purl 2 stitches' },
        { key: 'k2tog', def: 'knit 2 stitches together (tog) — a decrease' },
        { key: 'marker', def: 'a ring slipped onto the needle to mark a spot' },
        { key: 'markers', def: 'rings slipped onto the needle to mark a spot' },
      ],
      gauge: '20 sts × 26 rounds in stockinette, 4.5mm needles = 10 × 10 cm.',
      needles: '4mm and 4.5mm circular needles (40 cm), cable needle, 8 stitch markers.',
      yarn: 'Worsted weight yarn (110 m = 50 g): 100 (100) 150 g.',
      techniques: [
        { title: 'Cable left', body: 'Slip 4 sts onto the cable needle and hold in FRONT of the work, knit the next 4 sts, then knit the 4 sts from the cable needle.' },
        { title: 'Knit two together', body: 'Insert the right needle into 2 stitches at once and knit them as one: 1 stitch remains instead of 2. This is a decrease.' },
      ],
      sizeTable: [
        { label: 'Head circumference (cm)', values: ['50-52', '54-56', '58-60'] },
        { label: 'Finished height (cm)', values: ['21', '23', '25'] },
      ],
      tips: ['This example ships with the app to show you how the reader works. You can edit or delete it at any time.'],
    }),
  },
}

/* ───────────────────────────── Cloud Scarf (one size) ────────────────────────────────── */
const ECHARPE = {
  demoId: 'echarpe',
  name: 'Cloud Scarf',
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
        id: 'debut', kind: 'bordure', title: 'Getting started',
        steps: [
          ROW('Cast on 40 sts on 6mm needles.'),
          ROW('Work 4 rows in garter stitch (knit every st, both right and wrong side).'),
        ],
      },
      {
        id: 'corps', kind: 'corps', title: 'Scarf body',
        steps: [
          ROW('Row 1 (RS): k4, * p2, k2 *, repeat from * to * to last 4 sts, k4.'),
          ROW('Row 2 (WS): work the sts as they appear.'),
          ROW('Repeat rows 1 and 2 until the scarf measures about 150 cm.'),
        ],
      },
      {
        id: 'fin', kind: 'finitions', title: 'Finishing',
        steps: [
          ROW('Work 4 rows in garter stitch, then bind off loosely.'),
          ROW('Weave in ends on the wrong side.'),
        ],
      },
    ],
    reference: buildReference({
      // Voir le commentaire équivalent dans BONNET ci-dessus : « st »/« sts » distincts
      // (singulier « every st », pluriel « the sts »/« last 4 sts »), et compte-collé
      // pour k2/p2/k4 — sinon boutons morts, cf. tests/unit/demo-glossary-coverage.spec.js.
      abbr: [
        { key: 'st', def: 'stitch' },
        { key: 'sts', def: 'stitches' },
        { key: 'k2', def: 'knit 2 stitches' },
        { key: 'p2', def: 'purl 2 stitches' },
        { key: 'k4', def: 'knit 4 stitches' },
        { key: 'garter stitch', def: 'every stitch knit, on both right and wrong side rows' },
      ],
      gauge: '14 sts × 20 rows in relaxed rib, 6mm needles = 10 × 10 cm.',
      needles: '6mm straight needles.',
      yarn: 'Chunky yarn (80 m = 50 g): about 400 g.',
      tips: ['Example shipped with the app. A scarf is the ideal project for learning to follow a pattern row by row.'],
    }),
  },
}

/* ───────────────────────────── Granny Bag (crochet) ──────────────────────────────────── */
const SAC = {
  demoId: 'sac',
  name: 'Granny Bag',
  type: 'crochet',
  category: 'accessories',
  sizes: [],
  needleMm: '4',
  photos: [DEMO_SKETCH_SAC],
  reader: {
    sizeLabels: [],
    sections: [
      {
        id: 'carre', kind: 'motif', title: 'The granny square',
        steps: [
          ROW('Make a magic ring, then ch 3 (counts as the first dc).'),
          ROW('Round 1: 2 dc in the ring, * ch 2, 3 dc *, repeat from * to * 3 times, ch 2, join with a sl st.'),
          ROW('Round 2: ch 3, * in each ch-2 space: 3 dc, ch 2, 3 dc *, repeat from * to * at each corner, join with a sl st.'),
          ROW('Round 3: repeat round 2, adding 3 dc along each straight side.'),
          NOTE('The square now measures about 12 cm across.'),
          ROW('Make 8 identical squares.'),
        ],
      },
      {
        id: 'assemblage', kind: 'corps', title: 'Assembly',
        steps: [
          ROW('Join the squares in groups of 4 with sl st, edge to edge, to form the two sides of the bag.'),
          ROW('Join the two sides along three edges, leaving the top open.'),
        ],
      },
      {
        id: 'anses', kind: 'finitions', title: 'Straps and finishing',
        steps: [
          ROW('Work 1 round of sc all around the opening.'),
          ROW('For each strap: ch 60, then 1 row of sc into the chain. Sew the ends 8 cm from each corner.'),
          ROW('Weave in ends.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'ch', def: 'chain' },
        { key: 'sc', def: 'single crochet' },
        { key: 'dc', def: 'double crochet' },
        { key: 'sl st', def: 'slip stitch' },
      ],
      gauge: 'A 3-round granny square = about 12 cm across, 4mm hook.',
      needles: '4mm crochet hook, yarn needle.',
      yarn: 'Cotton crochet yarn (125 m = 50 g): 200 g, in 2 to 4 colours.',
      tips: ['Example shipped with the app, to show that a crochet pattern is followed exactly like a knitting pattern.'],
    }),
  },
}

export default {
  patterns: [BONNET, ECHARPE, SAC],
  projects: {
    idea: {
      name: 'Cosy scarf',
      notes:
        'Idea for this winter: sage green merino, about 400 g, and 20 cm longer than the pattern. That is what notes are for — keeping your ideas and your changes. Example shipped with the app: you can edit or delete it.',
    },
    wip: { notes: 'Example project linked to a pattern from the library — you can edit or delete it.' },
    fallbackKnitting: 'Cable sweater',
    fallbackCrochet: 'Granny crochet bag',
    fallbackNotes: 'Example project — you can edit or delete it.',
  },
  freePattern: {
    name: 'Free pattern',
    sectionTitle: 'My knitting',
    stepText: 'Free project: track your progress with the counters below. You can create a detailed pattern later.',
  },
}

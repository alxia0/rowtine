// Patrons et projets de DÉMONSTRATION, version allemande.
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
  repeat: '8 M × 24 Reihen',
  readDir: 'rtl',
}

/* ───────────────────────────── Zopfmütze (Patron des laufenden Projekts) ──────────────── */
const BONNET = {
  demoId: 'bonnet',
  name: 'Zopfmütze',
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
    sizeSubLabel: 'Kopfumfang (cm)',
    chart: CHART_TORSADE,
    sections: [
      {
        id: 'bordure', kind: 'bordure', title: 'Bündchen',
        steps: [
          ROW('Mit der Rundstricknadel Nr. 4 {{0}} M anschlagen und zur Runde schließen.', c(88, 96, 104)),
          ROW('Einen Maschenmarkierer setzen: er markiert den Rundenanfang.'),
          ROW('{{0}} cm im 2/2-Rippenmuster stricken (2 M re, 2 M li).', c(4, 5, 6)),
        ],
      },
      {
        id: 'corps', kind: 'motif', title: 'Rumpf und Zopf', chart: CHART_TORSADE,
        steps: [
          ROW('Auf die Nadel Nr. 4,5 wechseln und 1 Runde re stricken, dabei {{0}} M gleichmäßig zunehmen.', c(8, 8, 8)),
          NOTE('Jetzt liegen {{0}} M auf der Nadel.', c(96, 104, 112)),
          NOTE('Der Zopf wird über die mittleren 8 M der Vorderseite nach der Strickschrift gearbeitet.'),
          CHART,
          ROW('Die Strickschrift über die mittleren 8 M Runde für Runde arbeiten, den Rest der Runde rechts stricken.'),
          chartRounds('Alle {{0}} Runden der Strickschrift arbeiten.', CHART_TORSADE, 3),
          NOTE('Die Mütze misst jetzt etwa {{0}} cm ab dem Bündchen.', c(14, 15, 16)),
        ],
      },
      {
        id: 'sommet', kind: 'corps', title: 'Abnahmen am Oberteil',
        steps: [
          NOTE('Die Strickschrift ist fertig: das Oberteil wird nun komplett rechts gestrickt.'),
          ROW('7 weitere Maschenmarkierer setzen, alle {{0}} M: zusammen mit dem Rundenanfang-Marker ergibt das 8 Markierer insgesamt.', c(12, 13, 14)),
          ROW('Abnahmerunde: * bis 2 M vor dem nächsten Marker rechts stricken, 2 M re zus. *, an allen 8 Markern wiederholen: es bleiben {{0}} M.', c(88, 96, 104)),
          ROW('1 Runde ohne Abnahme stricken.'),
          REP('Diese beiden Runden noch {{0}} Mal wiederholen: es bleiben {{1}} M.', c(9, 10, 11), c(16, 16, 16)),
        ],
      },
      {
        id: 'finitions', kind: 'finitions', title: 'Fertigstellung',
        steps: [
          ROW('Den Faden abschneiden, durch die restlichen M ziehen und festziehen.'),
          ROW('Fäden auf der Innenseite vernähen.'),
          NOTE('Tipp: die feuchte Mütze über eine Schüssel spannen, damit die Kappe schön rund wird.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'M', def: 'Masche(n)' },
        { key: 're', def: 'rechte Masche(n) — rechts stricken' },
        { key: 'li', def: 'linke Masche(n) — links stricken' },
        { key: 'zus.', def: 'zusammen — mehrere Maschen als eine stricken' },
        { key: 'Maschenmarkierer', def: 'ein Ring, der zur Markierung auf die Nadel geschoben wird' },
      ],
      gauge: '20 M × 26 Runden in glatt rechts, Nadel Nr. 4,5 = 10 × 10 cm.',
      needles: 'Rundstricknadeln Nr. 4 und Nr. 4,5 (40 cm), Zopfnadel, 8 Maschenmarkierer.',
      yarn: 'Garn mittlerer Stärke (110 m = 50 g): 100 (100) 150 g.',
      techniques: [
        { title: 'Zopf nach links kreuzen', body: 'Die nächsten 4 M auf die Zopfnadel legen und VOR die Arbeit halten, die folgenden 4 M re stricken, dann die 4 M von der Zopfnadel re stricken.' },
        { title: 'Zwei Maschen zusammenstricken', body: 'Die rechte Nadel gleichzeitig in 2 Maschen einstechen und sie als eine stricken: es bleibt 1 Masche statt 2. Das ist eine Abnahme.' },
      ],
      sizeTable: [
        { label: 'Kopfumfang (cm)', values: ['50-52', '54-56', '58-60'] },
        { label: 'Fertige Höhe (cm)', values: ['21', '23', '25'] },
      ],
      tips: ['Dieses Beispiel wird mit der App geliefert, um dir zu zeigen, wie du hier einer Anleitung folgst. Du kannst es jederzeit bearbeiten oder löschen.'],
    }),
  },
}

/* ───────────────────────────── Wolkenschal (Einheitsgröße) ───────────────────────────── */
const ECHARPE = {
  demoId: 'echarpe',
  name: 'Wolkenschal',
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
        id: 'debut', kind: 'bordure', title: 'Los geht\'s',
        steps: [
          ROW('Mit der Nadel Nr. 6 40 M anschlagen.'),
          ROW('4 Reihen kraus rechts stricken (jede Reihe komplett rechts, hin und zurück).'),
        ],
      },
      {
        id: 'corps', kind: 'corps', title: 'Schalkörper',
        steps: [
          ROW('1. Reihe (Hinreihe): 4 M re, * 2 M li, 2 M re *, von * bis * bis 4 M vor Reihenende wiederholen, 4 M re.'),
          ROW('2. Reihe (Rückreihe): die Maschen stricken, wie sie erscheinen.'),
          ROW('Reihe 1 und 2 wiederholen, bis der Schal etwa 150 cm misst.'),
        ],
      },
      {
        id: 'fin', kind: 'finitions', title: 'Fertigstellung',
        steps: [
          ROW('4 Reihen kraus rechts stricken, dann locker abketten.'),
          ROW('Fäden auf der Innenseite vernähen.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'M', def: 'Masche(n)' },
        { key: 're', def: 'rechte Masche(n) — rechts stricken' },
        { key: 'li', def: 'linke Masche(n) — links stricken' },
        { key: 'kraus rechts', def: 'jede Reihe rechts gestrickt, hin und zurück' },
      ],
      gauge: '14 M × 20 Reihen im lockeren Rippenmuster, Nadel Nr. 6 = 10 × 10 cm.',
      needles: 'Gerade Stricknadeln Nr. 6.',
      yarn: 'Dickes Garn (80 m = 50 g): etwa 400 g.',
      tips: ['Beispiel, das mit der App geliefert wird. Ein Schal ist das ideale Projekt, um das reihenweise Folgen einer Anleitung zu üben.'],
    }),
  },
}

/* ───────────────────────────── Granny-Tasche (Häkeln) ────────────────────────────────── */
const SAC = {
  demoId: 'sac',
  name: 'Granny-Tasche',
  type: 'crochet',
  category: 'accessories',
  sizes: [],
  needleMm: '4',
  photos: [DEMO_SKETCH_SAC],
  reader: {
    sizeLabels: [],
    sections: [
      {
        id: 'carre', kind: 'motif', title: 'Das Granny-Quadrat',
        steps: [
          ROW('Einen Fadenring legen, dann 3 Lm häkeln (zählen als 1. Stb).'),
          ROW('1. Runde: 2 Stb in den Ring, * 2 Lm, 3 Stb *, von * bis * 3 Mal wiederholen, 2 Lm, mit 1 Km schließen.'),
          ROW('2. Runde: 3 Lm, * in den 2-Lm-Bogen: 3 Stb, 2 Lm, 3 Stb *, von * bis * an jeder Ecke wiederholen, mit 1 Km schließen.'),
          ROW('3. Runde: Runde 2 wiederholen und dabei 3 Stb an jeder geraden Seite ergänzen.'),
          NOTE('Das Quadrat misst jetzt etwa 12 cm Kantenlänge.'),
          ROW('8 gleiche Quadrate häkeln.'),
        ],
      },
      {
        id: 'assemblage', kind: 'corps', title: 'Zusammennähen',
        steps: [
          ROW('Die Quadrate zu je 4 mit Km aneinanderfügen, Kante an Kante, um die beiden Taschenseiten zu bilden.'),
          ROW('Die beiden Seiten an drei Kanten zusammenfügen, oben offen lassen.'),
        ],
      },
      {
        id: 'anses', kind: 'finitions', title: 'Henkel und Fertigstellung',
        steps: [
          ROW('1 Runde fM rund um die Öffnung häkeln.'),
          ROW('Für jeden Henkel: 60 Lm häkeln, dann 1 Reihe fM in die Luftmaschenkette. Die Enden 8 cm von jeder Ecke festnähen.'),
          ROW('Fäden vernähen.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'Lm', def: 'Luftmasche' },
        { key: 'fM', def: 'feste Masche' },
        { key: 'Stb', def: 'Stäbchen' },
        { key: 'Km', def: 'Kettmasche' },
      ],
      gauge: 'Ein Granny-Quadrat mit 3 Runden = etwa 12 cm Kantenlänge, Häkelnadel Nr. 4.',
      needles: 'Häkelnadel Nr. 4, Wollnadel.',
      yarn: 'Häkelbaumwolle (125 m = 50 g): 200 g, in 2 bis 4 Farben.',
      tips: ['Beispiel, das mit der App geliefert wird, um zu zeigen, dass eine Häkelanleitung genauso befolgt wird wie eine Strickanleitung.'],
    }),
  },
}

export default {
  patterns: [BONNET, ECHARPE, SAC],
  projects: {
    idea: {
      name: 'Kuscheliger Schal',
      notes:
        'Idee für diesen Winter: salbeigrüne Merinowolle, etwa 400 g, und 20 cm länger als in der Anleitung. Genau dafür sind die Notizen da — halte deine Ideen und Änderungen fest. Beispiel, das mit der App geliefert wird: du kannst es bearbeiten oder löschen.',
    },
    wip: { notes: 'Beispielprojekt, verknüpft mit einer Anleitung aus der Bibliothek — du kannst es bearbeiten oder löschen.' },
    fallbackKnitting: 'Zopfpullover',
    fallbackCrochet: 'Gehäkelte Granny-Tasche',
    fallbackNotes: 'Beispielprojekt — du kannst es bearbeiten oder löschen.',
  },
  freePattern: {
    name: 'Freies Projekt',
    sectionTitle: 'Mein Strickstück',
    stepText: 'Freies Projekt: verfolge deinen Fortschritt mit den Zählern unten. Du kannst später eine detaillierte Anleitung erstellen.',
  },
}

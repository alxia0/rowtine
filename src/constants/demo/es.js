// Patrons et projets de DÉMONSTRATION, version espagnole.
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
  repeat: '8 p. × 24 vueltas',
  readDir: 'rtl',
}

/* ───────────────────────────── Gorro de Trenzas (patrón del proyecto en curso) ────────── */
const BONNET = {
  demoId: 'bonnet',
  name: 'Gorro de Trenzas',
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
    sizeSubLabel: 'contorno de cabeza (cm)',
    chart: CHART_TORSADE,
    sections: [
      {
        id: 'bordure', kind: 'bordure', title: 'Borde en punto elástico',
        steps: [
          ROW('Montar {{0}} p. con agujas circulares del 4 y cerrar en redondo.', c(88, 96, 104)),
          ROW('Colocar un marcador: indica el inicio de la vuelta.'),
          ROW('Tejer en punto elástico 2/2 (2 p. d., 2 p. r.) durante {{0}} cm.', c(4, 5, 6)),
        ],
      },
      {
        id: 'corps', kind: 'motif', title: 'Cuerpo y trenza', chart: CHART_TORSADE,
        steps: [
          ROW('Cambiar a agujas del 4,5 y tejer 1 vuelta al derecho repartiendo {{0}} aumentos.', c(8, 8, 8)),
          NOTE('Ahora hay {{0}} p. en la aguja.', c(96, 104, 112)),
          NOTE('La trenza se teje sobre los 8 p. centrales del delantero, siguiendo el gráfico.'),
          CHART,
          ROW('Seguir el gráfico sobre los 8 p. centrales, vuelta tras vuelta, tejiendo el resto de la vuelta al derecho.'),
          chartRounds('Tejer las {{0}} vueltas del gráfico.', CHART_TORSADE, 3),
          NOTE('El gorro mide ahora unos {{0}} cm desde el borde.', c(14, 15, 16)),
        ],
      },
      {
        id: 'sommet', kind: 'corps', title: 'Menguados de la copa',
        steps: [
          NOTE('El gráfico ha terminado: la copa se teje ahora completamente al derecho.'),
          ROW('Colocar 7 marcadores más, cada {{0}} p.: junto con el marcador de inicio de vuelta, son 8 marcadores en total.', c(12, 13, 14)),
          ROW('Vuelta de menguado: * tejer al derecho hasta 2 p. antes del siguiente marcador, tejer 2 p. jtos. al derecho *, repetir en los 8 marcadores: quedan {{0}} p.', c(88, 96, 104)),
          ROW('Tejer 1 vuelta sin menguar.'),
          REP('Repetir estas dos vueltas {{0}} veces más: quedan {{1}} p.', c(9, 10, 11), c(16, 16, 16)),
        ],
      },
      {
        id: 'finitions', kind: 'finitions', title: 'Acabados',
        steps: [
          ROW('Cortar el hilo, pasarlo por los p. restantes y ajustar.'),
          ROW('Esconder los hilos por el revés.'),
          NOTE('Truco: dejar secar el gorro húmedo sobre un bol para redondear la copa.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'p.', def: 'punto(s)' },
        { key: 'd.', def: 'punto al derecho' },
        { key: 'r.', def: 'punto al revés' },
        { key: 'jtos.', def: 'juntos — tejer varios puntos como uno solo' },
        { key: 'marcador', def: 'un aro que se desliza en la aguja para señalar un punto' },
        { key: 'marcadores', def: 'aros que se deslizan en la aguja para señalar un punto' },
      ],
      gauge: '20 p. × 26 vueltas en punto jersey, agujas del 4,5 = 10 × 10 cm.',
      needles: 'Agujas circulares del 4 y del 4,5 (40 cm), aguja auxiliar para trenzas, 8 marcadores.',
      yarn: 'Hilo de grosor medio (110 m = 50 g): 100 (100) 150 g.',
      techniques: [
        { title: 'Cruzar la trenza a la izquierda', body: 'Pasar 4 p. a la aguja auxiliar y dejarla DELANTE de la labor, tejer al derecho los 4 p. siguientes y después tejer al derecho los 4 p. de la aguja auxiliar.' },
        { title: 'Tejer dos puntos juntos', body: 'Introducir la aguja derecha en 2 puntos a la vez y tejerlos como uno solo: queda 1 punto en lugar de 2. Es una disminución.' },
      ],
      sizeTable: [
        { label: 'Contorno de cabeza (cm)', values: ['50-52', '54-56', '58-60'] },
        { label: 'Altura acabada (cm)', values: ['21', '23', '25'] },
      ],
      tips: ['Este ejemplo se incluye con la aplicación para mostrarte cómo funciona el lector. Puedes modificarlo o eliminarlo cuando quieras.'],
    }),
  },
}

/* ───────────────────────────── Bufanda Nube (talla única) ────────────────────────────── */
const ECHARPE = {
  demoId: 'echarpe',
  name: 'Bufanda Nube',
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
        id: 'debut', kind: 'bordure', title: 'Para empezar',
        steps: [
          ROW('Montar 40 p. con agujas del 6.'),
          ROW('Tejer 4 hileras en punto bobo (todos los puntos al derecho, tanto de ida como de vuelta).'),
        ],
      },
      {
        id: 'corps', kind: 'corps', title: 'Cuerpo de la bufanda',
        steps: [
          ROW('Hilera 1 (derecho): 4 p. d., * 2 p. r., 2 p. d. *, repetir de * a * hasta los últimos 4 p., 4 p. d.'),
          ROW('Hilera 2 (revés): tejer los puntos tal como se presentan.'),
          ROW('Repetir las hileras 1 y 2 hasta que la bufanda mida unos 150 cm.'),
        ],
      },
      {
        id: 'fin', kind: 'finitions', title: 'Acabados',
        steps: [
          ROW('Tejer 4 hileras en punto bobo y cerrar los puntos sin apretar.'),
          ROW('Esconder los hilos por el revés.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'p.', def: 'punto(s)' },
        { key: 'd.', def: 'punto al derecho' },
        { key: 'r.', def: 'punto al revés' },
        { key: 'punto bobo', def: 'todos los puntos al derecho, tanto de ida como de vuelta' },
      ],
      gauge: '14 p. × 20 hileras en canalé relajado, agujas del 6 = 10 × 10 cm.',
      needles: 'Agujas rectas del 6.',
      yarn: 'Hilo grueso (80 m = 50 g): unos 400 g.',
      tips: ['Ejemplo incluido con la aplicación. Una bufanda es el proyecto ideal para aprender a seguir un patrón hilera a hilera.'],
    }),
  },
}

/* ───────────────────────────── Bolso Granny (ganchillo) ──────────────────────────────── */
const SAC = {
  demoId: 'sac',
  name: 'Bolso Granny',
  type: 'crochet',
  category: 'accessories',
  sizes: [],
  needleMm: '4',
  photos: [DEMO_SKETCH_SAC],
  reader: {
    sizeLabels: [],
    sections: [
      {
        id: 'carre', kind: 'motif', title: 'El cuadrado granny',
        steps: [
          ROW('Hacer un anillo mágico y después 3 cad. (cuentan como el 1er pa).'),
          ROW('Vuelta 1: 2 pa en el anillo, * 2 cad., 3 pa *, repetir de * a * 3 veces, 2 cad., cerrar con 1 pe.'),
          ROW('Vuelta 2: 3 cad., * en cada espacio de 2 cad.: 3 pa, 2 cad., 3 pa *, repetir de * a * en cada esquina, cerrar con 1 pe.'),
          ROW('Vuelta 3: repetir la vuelta 2 añadiendo 3 pa en cada lado recto.'),
          NOTE('El cuadrado mide ahora unos 12 cm de lado.'),
          ROW('Hacer 8 cuadrados iguales.'),
        ],
      },
      {
        id: 'assemblage', kind: 'corps', title: 'Montaje',
        steps: [
          ROW('Unir los cuadrados de 4 en 4 con pe, lado con lado, para formar las dos caras del bolso.'),
          ROW('Unir las dos caras por tres lados, dejando la parte de arriba abierta.'),
        ],
      },
      {
        id: 'anses', kind: 'finitions', title: 'Asas y acabados',
        steps: [
          ROW('Tejer 1 vuelta de pb alrededor de toda la abertura.'),
          ROW('Para cada asa: 60 cad., después 1 hilera de pb sobre la cadeneta. Coser los extremos a 8 cm de cada esquina.'),
          ROW('Esconder los hilos.'),
        ],
      },
    ],
    reference: buildReference({
      abbr: [
        { key: 'cad.', def: 'cadeneta' },
        { key: 'pb', def: 'punto bajo' },
        { key: 'pa', def: 'punto alto' },
        { key: 'pe', def: 'punto enano' },
      ],
      gauge: 'Un cuadrado granny de 3 vueltas = unos 12 cm de lado, ganchillo del 4.',
      needles: 'Ganchillo del 4, aguja lanera.',
      yarn: 'Algodón de ganchillo (125 m = 50 g): 200 g, en 2 a 4 colores.',
      tips: ['Ejemplo incluido con la aplicación, para mostrar que un patrón de ganchillo se sigue exactamente igual que un patrón de punto.'],
    }),
  },
}

export default {
  patterns: [BONNET, ECHARPE, SAC],
  projects: {
    idea: {
      name: 'Bufanda suave',
      notes:
        'Idea para este invierno: lana merina verde salvia, unos 400 g, y 20 cm más larga que el patrón. Para eso sirven las notas: guardar tus ideas y tus cambios. Ejemplo incluido con la aplicación: puedes modificarlo o eliminarlo.',
    },
    wip: { notes: 'Proyecto de ejemplo vinculado a un patrón de la biblioteca — puedes modificarlo o eliminarlo.' },
    fallbackKnitting: 'Jersey de trenzas',
    fallbackCrochet: 'Bolso granny de ganchillo',
    fallbackNotes: 'Proyecto de ejemplo — puedes modificarlo o eliminarlo.',
  },
  freePattern: {
    name: 'Patrón libre',
    sectionTitle: 'Mi labor',
    stepText: 'Proyecto libre: sigue tu progreso con los contadores de abajo. Más adelante podrás crear un patrón detallado.',
  },
}

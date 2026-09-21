// Rendu canvas pur de la carte calendaire (heatmap hebdomadaire) d'un projet, dessinée sur la
// moitié droite OU en dessous du cartouche du badge selon la place disponible (cf.
// `statsAreaWithCalendar`, badge-render.js) — réutilise le calcul de grille DÉJÀ pur de
// `stats-grid.js` (via `aggregateProjectStats`, qui pose `stats.grid.columns`), aucun recalcul
// ici. Couleur des cellules dérivée DIRECTEMENT de la couleur RÉELLE choisie pour le badge —
// PAS de `theme/palette.js` (`generateHeatColors`), qui resynthétise une palette propre au
// THÈME de l'app à partir de la seule teinte d'accent des Réglages : la carte calendaire du
// badge suit la couleur DU BADGE (même principe que le dégradé de fond, cf. badge-render.js),
// jamais celle des Réglages.
//
// Correctif 17/09 (retour Julien, test réel Pixel) : la grille SEULE, sans initiales de jour,
// libellés de mois ni légende de couleur, était illisible hors du contexte de l'app (où
// StatsHeatmap.vue affiche ces trois éléments à côté). Ce module reste PUR (pas d'import
// vue-i18n) : les mots de légende ARRIVENT déjà traduits (`legend.less`/`legend.more`),
// calculés par l'appelant (`renderBadge`, qui a `t`), jamais lus ici depuis un store.
import { weekdayNames } from '@/utils/time-periods'

// Exportées : `badge-render.js` (qui importe déjà ce module pour `drawCalendar`/
// `calendarRealHeight`) réimplémentait ces deux utilitaires à l'identique — un seul endroit
// pour ne pas les faire diverger.
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}
export function hslCss(h, s, l) {
  return `hsl(${h} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}%)`
}

const CELL_GAP = 4
const MIN_CELL = 14
const MAX_CELL = 32
const PAD = 16
const MONTH_LABEL_GAP = 6
// Chrome textuel autour de la grille elle-même : gouttière des initiales de jour (gauche),
// ligne des libellés de mois (haut), ligne de légende (bas) — un écart fixe les sépare de la
// grille (CHROME_GAP), indépendant de la taille des cases (qui, elle, varie avec la place).
const GUTTER_W = 26
const LABEL_H = 24
const LEGEND_H = 30
const CHROME_GAP = 3

// Éclaircissement par niveau d'activité (index = `cell.level`, 0 à 4, cf. `levelOf` dans
// stats-grid.js) — niveau 0 : juste un liseré (pas de remplissage, contrairement à StatsHeatmap.vue),
// niveaux 1-4 : même teinte/saturation que le badge, seule la luminosité augmente avec l'activité —
// jamais une couleur resynthétisée. Réutilisé tel quel par la légende (mêmes couleurs que les cases).
const LEVEL_LIGHTNESS = [null, 30, 45, 60, 78]

// Choisit les dernières `maxCols` semaines (colonnes) d'une grille — `buildGrid` (stats-grid.js)
// range la plus ANCIENNE en premier, l'activité récente est donc en fin de tableau et plus
// pertinente à montrer qu'un historique tronqué au début pour un projet de plusieurs mois/ans.
export function recentWeeks(columns, maxCols) {
  if (!Array.isArray(columns) || columns.length <= maxCols) return columns || []
  return columns.slice(columns.length - maxCols)
}

// Hauteur RÉELLE (chrome fixe + grille) que `drawCalendar` occupera pour `weeksCount` semaines
// dans une zone de largeur `areaW`, SANS présupposer de hauteur disponible (c'est justement ce
// qu'on cherche à déterminer, avant même de savoir combien de hauteur lui réserver) — reproduit
// exactement la partie de `drawCalendar` qui dépend de la LARGEUR (`cellFromWidth`), seule
// contrainte pertinente ici : en mode côte à côte (calendrier Vertical), la hauteur réservée par
// `statsAreaWithCalendar` est structurellement généreuse (dérivée du bloc stats, pas du
// calendrier), donc c'est presque toujours la largeur, jamais la hauteur, qui borne la taille
// réelle de la cellule — cf. commentaire de `DATE_ROW_H`, badge-render.js. Utilisée par
// `statsAreaWithCalendar` (badge-render.js) pour ne réserver, en mode `side`, que la hauteur
// dont le calendrier a RÉELLEMENT besoin, jamais plus — sans quoi la ligne date qui suit hérite
// d'une marge excessive (grille centrée par `drawCalendar` dans une zone trop haute pour elle,
// cf. `startY` plus bas).
// Largeur de cellule pour `weeksWanted` semaines dans une zone intérieure de largeur `innerW` —
// formule commune à `calendarRealHeight` (estimation AVANT tout dessin) et `drawCalendar` (dessin
// réel) : `maxCols`/le plafonnage du nombre de semaines réellement affichées (`recentWeeks` dans
// `drawCalendar`) DOIVENT être reproduits partout où `cellFromWidth` l'est, sans quoi un
// historique de 60 semaines dans une zone qui n'en affiche RÉELLEMENT que 15 (`drawCalendar` en
// tronque le reste, la grille ne montrant que les semaines les plus récentes) ferait diviser
// `innerW` par 60 au lieu de 15 dans l'estimation, sous-estimant `cellFromWidth` (et donc
// `gridH`) très en dessous de ce que `drawCalendar` dessine réellement — exactement l'inverse de
// ce que `calendarRealHeight` doit garantir (ne jamais réserver moins que le réel). Une seule
// fonction pour les deux appelants : ils ne peuvent plus se désynchroniser.
function cellWidthFor(innerW, weeksWanted) {
  const maxCols = Math.max(1, Math.floor((innerW + CELL_GAP) / (MIN_CELL + CELL_GAP)))
  const cols = Math.min(weeksWanted, maxCols)
  const cellFromWidth = Math.floor((innerW - CELL_GAP * (cols - 1)) / cols)
  return { maxCols, cellFromWidth }
}

export function calendarRealHeight(areaW, weeksCount) {
  if (!weeksCount) return 0
  const innerW = areaW - 2 * PAD - GUTTER_W - CHROME_GAP
  if (innerW <= 0) return 0
  const { cellFromWidth } = cellWidthFor(innerW, weeksCount)
  if (cellFromWidth < MIN_CELL) return 0 // même garde de renoncement que `drawCalendar` (ligne 76)
  const cell = clamp(cellFromWidth, MIN_CELL, MAX_CELL)
  const gridH = 7 * cell + 6 * CELL_GAP
  return 2 * PAD + LABEL_H + 2 * CHROME_GAP + LEGEND_H + gridH
}

// `locale` est constant sur toute une grille (jusqu'à une douzaine d'appels par carte, un par
// semaine qui commence un mois) : un seul formateur mémoïsé par locale plutôt qu'un
// `Intl.DateTimeFormat` reconstruit à chaque libellé.
const monthFmtCache = new Map()
function monthFmt(locale) {
  let fmt = monthFmtCache.get(locale)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { month: 'short' })
    monthFmtCache.set(locale, fmt)
  }
  return fmt
}

function monthLabel(monday, locale) {
  const [y, m, d] = monday.split('-').map(Number)
  return monthFmt(locale).format(new Date(y, m - 1, d))
}

// Dessine la grille dans le rectangle `area` (déjà positionné par `computeBadgeGeometry`,
// cf. badge-render.js), entourée des initiales de jour, des libellés de mois et d'une légende
// de couleur. `hue`/`s` : la couleur RÉELLE du badge, déjà extraite par l'appelant
// (`parseHsl`). `textColor` : couleur du liseré des jours de niveau 0 ET du texte (initiales,
// mois, légende), celle déjà calculée par l'appelant pour contraster avec le bandeau
// (`autoTextColor`), jamais une valeur fixe. `locale`/`legend` : cf. commentaire d'en-tête.
export function drawCalendar(ctx, area, columns, hue, s, textColor, locale = 'fr', legend = { less: '', more: '' }) {
  if (!columns || !columns.length) return
  const gridTop = area.y + PAD + LABEL_H + CHROME_GAP
  const innerW = area.w - 2 * PAD - GUTTER_W - CHROME_GAP
  const innerH = area.y + area.h - PAD - LEGEND_H - CHROME_GAP - gridTop
  if (innerW <= 0 || innerH <= 0) return

  const cellFromHeight = Math.floor((innerH - CELL_GAP * 6) / 7)
  const { maxCols, cellFromWidth } = cellWidthFor(innerW, columns.length)
  const weeks = recentWeeks(columns, maxCols)
  const rawCell = Math.min(cellFromHeight, cellFromWidth)
  if (rawCell < MIN_CELL) return // pas assez de place pour une seule rangée lisible : on renonce plutôt que d'empiler des cellules illisibles
  const cell = clamp(rawCell, MIN_CELL, MAX_CELL)

  const gridW = weeks.length * cell + (weeks.length - 1) * CELL_GAP
  const gridH = 7 * cell + 6 * CELL_GAP
  // Centrage horizontal du bloc ENTIER gouttière+grille (retour Julien, 20/09). Le 18/09, un
  // centrage de la grille SEULE avait été refusé : ça la détachait visiblement de la gouttière
  // des initiales de jour (L M M J V S D), restée fixe à gauche (cf. git blame, ancien
  // commentaire à cet endroit). Depuis, le mode empilé du gabarit Horizontal
  // (`statsAreaWithCalendar`, badge-render.js) donne à `drawCalendar` la PLEINE largeur du
  // cartouche (`calendarArea.w = colW`) — avec peu de semaines, la grille (largeur réelle
  // `gridW`) laissait un vide net à droite. Solution retenue par Julien (20/09) : le bloc
  // gouttière+grille se déplace ENSEMBLE (`blockOffsetX` s'applique aux DEUX), jamais la
  // grille seule — rien ne se détache, l'ensemble se centre dans l'excédent. `Math.max(0, ...)` :
  // si le bloc est déjà plus large que la zone (grille dense, mode côte à côte), l'offset reste
  // nul plutôt que négatif. `(innerW - gridW) / 2`, pas `(area.w - 2 * PAD - blockW) / 2`
  // redéveloppé : `innerW` (calculé plus haut) vaut déjà `area.w - 2*PAD - GUTTER_W -
  // CHROME_GAP`, et `blockW` vaut `GUTTER_W + CHROME_GAP + gridW`, donc les deux formes sont
  // strictement équivalentes — celle-ci lit directement l'invariant voulu (l'offset est la
  // moitié de l'excédent de la grille) sans avoir à le re-dériver à la lecture. `Math.floor` :
  // sans lui, un excédent impair donnait un offset à la moitié de pixel près, qui cassait la
  // netteté du liseré 1px des cases de niveau 0 (`strokeRect(x + 0.5, ...)` suppose un `x`
  // entier) — même parti pris que le centrage vertical côte à côte (`Math.floor(...)`,
  // badge-render.js).
  const blockOffsetX = Math.floor(Math.max(0, (innerW - gridW) / 2))
  const dayLabelX = area.x + PAD + blockOffsetX
  const startX = area.x + PAD + blockOffsetX + GUTTER_W + CHROME_GAP
  const startY = gridTop + Math.max(0, (innerH - gridH) / 2)

  // Initiales de jour, lundi en tête — même appel que StatsHeatmap.vue (`weekdayNames`), même
  // convention de premier jour (1 = lundi, non paramétrable ici : la grille des stats projet
  // n'est jamais construite avec un autre premier jour, cf. project-stats.js).
  ctx.fillStyle = textColor
  ctx.font = '20px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  weekdayNames(locale, 1, 'narrow').forEach((label, ri) => {
    ctx.fillText(label, dayLabelX, startY + ri * (cell + CELL_GAP) + cell / 2)
  })

  // Libellés de mois : un par semaine qui EN COMMENCE un (`col.monthStart`, déjà posé par
  // buildGrid/stats-grid.js) — jamais recalculé ici. Une semaine tronquée en tête de fenêtre
  // (recentWeeks a coupé avant son vrai début de mois) ne porte simplement pas ce drapeau :
  // dégradation acceptée, pas une exception.
  ctx.textBaseline = 'alphabetic'
  let monthLabelRight = -Infinity
  weeks.forEach((col, ci) => {
    if (!col.monthStart) return
    const label = monthLabel(col.monday, locale)
    const x = startX + ci * (cell + CELL_GAP)
    if (x < monthLabelRight + MONTH_LABEL_GAP) return // chevaucherait le libellé précédent : on saute plutôt que d'empiler
    // `- 5`, pas `- 2` : marge revue à la hausse après relecture (17/09) — à 20px, la
    // descendante d'un « j » (janv./juin/juil. en français) mesure ~4-5px ; sans cette marge,
    // le cas déjà tendu (peu de hauteur disponible, pas de centrage) laissait moins d'1px de
    // vrai espace libre pour ces mois précis, risquant un effleurement visuel de la grille.
    ctx.fillText(label, x, startY - CHROME_GAP - 5)
    monthLabelRight = x + ctx.measureText(label).width
  })

  weeks.forEach((col, ci) => {
    ;(col.cells || []).forEach((day, ri) => {
      if (day.future) return
      const x = startX + ci * (cell + CELL_GAP)
      const y = startY + ri * (cell + CELL_GAP)
      const l = LEVEL_LIGHTNESS[day.level] ?? null
      if (l == null) {
        ctx.strokeStyle = textColor
        ctx.globalAlpha = 0.25
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1)
        ctx.globalAlpha = 1
      } else {
        ctx.fillStyle = hslCss(hue, s, l)
        ctx.fillRect(x, y, cell, cell)
      }
    })
  })

  // Légende « moins ⬜▪▪▪▪ plus », centrée sous la grille — mêmes couleurs EXACTES que les
  // cases (niveau 0 en liseré, 1-4 pleins via LEVEL_LIGHTNESS), jamais un dégradé recalculé à
  // part. Bloc ENTIER (mots ET pastilles) sauté si les deux mots sont vides (appelant sans
  // légende disponible, ex. les tests existants qui appellent `drawCalendar` sans `legend`) :
  // pas de pastilles orphelines sans mots pour les situer, et surtout pas de dessin en plus
  // pour un appelant qui n'a rien demandé.
  if (legend.less || legend.more) {
    const swatch = 20
    const swatchGap = 6
    ctx.font = '16px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const wordW = (word) => (word ? ctx.measureText(word).width : 0)
    const legendW = (legend.less ? wordW(legend.less) + swatchGap : 0) + 5 * swatch + 4 * swatchGap + (legend.more ? swatchGap + wordW(legend.more) : 0)
    // La légende est sautée si elle ne peut pas tenir dans la zone sans déborder excessivement :
    // on renonce plutôt que de la dessiner troncaturée ou loin de sa grille, même philosophie
    // que la grille elle-même quand elle est trop petite (ligne 76).
    if (legendW > area.w - PAD * 2) return
    // Centrée sous la grille RÉELLE (`startX`/`gridW`), pas sous toute la zone (`area.w`) :
    // depuis le 20/09, le bloc gouttière+grille SE CENTRE dans `area` (`blockOffsetX`, cf.
    // commentaire plus haut) — mais `startX` reste la position RÉELLE de la grille une fois ce
    // centrage appliqué, pas une position fixe à gauche. Centrer la légende sur `startX`/`gridW`
    // la garde donc solidaire du bloc entier, où qu'il se trouve dans `area` ; centrer directement
    // sur `area.w` la détacherait dès que `blockOffsetX` n'est pas nul — le même risque que
    // l'ancien centrage isolé de la grille seule (avant le 18/09) évitait déjà, pas parce que la
    // grille ne bougerait jamais.
    let lx = startX + gridW / 2 - legendW / 2
    lx = Math.max(area.x + PAD, Math.min(lx, area.x + area.w - PAD - legendW))
    // Même bug que celui déjà corrigé pour le libellé de mois (17/09) : ancrer la légende au
    // bas de `area` (fixe) plutôt qu'au bas RÉEL de la grille (`startY + gridH`) la laissait
    // très loin en dessous dès que la grille se centrait dans une zone haute — la légende
    // « en dessous du calendrier » doit suivre la grille, pas le cartouche.
    // `+ 8` (retour Julien, 17/09 soir) : l'écart CHROME_GAP seul (3px), pensé pour coller la
    // légende à la grille dans le pire cas (peu de place), paraissait trop serré une fois la
    // grille bien dégagée — un peu plus d'air entre les deux reste lisible sans redevenir le
    // bug d'origine (des centaines de px d'écart).
    const ly = startY + gridH + CHROME_GAP + 8 + LEGEND_H / 2
    if (legend.less) {
      ctx.fillStyle = textColor
      ctx.fillText(legend.less, lx, ly)
      lx += wordW(legend.less) + swatchGap
    }
    for (let n = 0; n <= 4; n++) {
      const l = LEVEL_LIGHTNESS[n]
      if (l == null) {
        ctx.strokeStyle = textColor
        ctx.globalAlpha = 0.4
        ctx.lineWidth = 1
        ctx.strokeRect(lx + 0.5, ly - swatch / 2 + 0.5, swatch - 1, swatch - 1)
        ctx.globalAlpha = 1
      } else {
        ctx.fillStyle = hslCss(hue, s, l)
        ctx.fillRect(lx, ly - swatch / 2, swatch, swatch)
      }
      lx += swatch + swatchGap
    }
    if (legend.more) {
      ctx.fillStyle = textColor
      ctx.fillText(legend.more, lx, ly)
    }
  }
}

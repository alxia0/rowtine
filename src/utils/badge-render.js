// Composition canvas du badge de partage — module PUR (aucun DOM monté, aucun store, aucun
// accès réseau). Couleurs dérivées DIRECTEMENT de la couleur `hsl(h s% l%)` choisie par
// l'utilisatrice (refonte 16/09) — PAS de generatePalette/theme/palette.js, qui ne retient
// que la teinte et resynthétise saturation/luminosité propres au THÈME de l'app : une
// utilisatrice qui choisit un rouge vif précis doit retrouver CE rouge sur le badge, pas une
// teinte réinterprétée. Légendes traduites AU DESSIN via `t` — jamais stockées comme clé
// (règle du projet : un libellé affiché ne sert jamais de clé de donnée).
import { formatDuration } from '@/utils/project-stats'
import { formatLocalDate } from '@/utils/date-format'
import { drawCalendar, calendarRealHeight, clamp, hslCss } from '@/utils/badge-calendar'
import { drawStitchMotif, STITCH_MOTIF_HEIGHT } from '@/utils/badge-stitch-motif'
import { ICONS } from '@/utils/icons'
import { formatLength } from '@/utils/units'
import { parseDecimal } from '@/utils/decimal'

// Parse tolérant du format `hsl(h s% l%)` (CSS Color 4, sans virgules — celui que produisent
// COLOR_PALETTE et ColorPickerDialog). Repli neutre si la chaîne est absente/mal formée.
export function parseHsl(str) {
  const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/.exec(str || '')
  if (!m) return { h: 220, s: 70, l: 45 }
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) }
}

// h: 0-360, s/l: 0-100 → [r, g, b] 0-255. Conversion HSL→RGB standard, nécessaire pour le
// calcul de contraste ci-dessous (WCAG opère en RGB/luminance relative, pas en HSL).
function hslToRgb(h, s, l) {
  const sN = s / 100
  const lN = l / 100
  const c = (1 - Math.abs(2 * lN - 1)) * sN
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let [r, g, b] = [0, 0, 0]
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = lN - c / 2
  return [r, g, b].map((v) => Math.round((v + m) * 255))
}

// Luminance relative WCAG (0 = noir, 1 = blanc) à partir d'un triplet RGB 0-255.
function relativeLuminance([r, g, b]) {
  const [rl, gl, bl] = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

function contrastRatio(l1, l2) {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (a + 0.05) / (b + 0.05)
}

// Couleur du texte du bandeau : noir ou blanc, celui des deux qui contraste le mieux contre
// le bandeau RÉELLEMENT peint (bandColor composité par-dessus l'arrêt sombre du dégradé, cf.
// renderBadge) — pas un blanc fixe. Une couleur de fond très claire choisie par
// l'utilisatrice (ex. pastel) laissait un texte blanc illisible avant ce calcul.
function autoTextColor(bandRgb) {
  const bandLum = relativeLuminance(bandRgb)
  const withWhite = contrastRatio(bandLum, 1)
  const withBlack = contrastRatio(bandLum, 0)
  return withWhite >= withBlack ? '#fff' : '#111'
}

// Crée le canvas ÉPHÉMÈRE utilisé par `generate()` (BadgeComposer.vue) pour produire le
// fichier final — fonction dédiée plutôt qu'un `document.createElement('canvas')` direct,
// pour que les tests puissent la mocker SANS intercepter aussi le <canvas> de prévisu monté
// dans le template (lui, un vrai nœud DOM, jamais mocké).
export function createBadgeCanvas() {
  return document.createElement('canvas')
}

// Gabarits : seulement la taille de canvas et l'orientation — la géométrie du/des slot(s)
// photo et du cartouche de texte est CALCULÉE (cf. computeBadgeGeometry ci-dessous), pas
// figée ici, pour dépendre du ratio de photo choisi (refonte 16/09, revue « carré/rectangle »).
export const BADGE_TEMPLATES = {
  vertical: { canvas: { w: 1080, h: 1620 }, orientation: 'portrait', hasPhoto: true },
  horizontal: { canvas: { w: 1350, h: 1080 }, orientation: 'landscape', hasPhoto: true },
  minimal: { canvas: { w: 1080, h: 1350 }, orientation: 'portrait', hasPhoto: false },
  double: { canvas: { w: 1080, h: 1350 }, orientation: 'portrait', hasPhoto: true, double: true },
}

const MARGIN = 90
// Espace entre le(s) slot(s) photo et le cartouche de texte.
const GAP = 60
const GAP_DOUBLE = 40
// Marge interne du texte À L'INTÉRIEUR du cartouche (haut/bas/gauche/droite) — le cartouche
// lui-même (bandeau + statsArea) va bord à bord, cette marge est ce qui garde le texte
// lisible, à distance du bord de l'image et des coins arrondis des photos voisines.
const TEXT_PAD = 60
// Rythme vertical du texte (repris tel quel par renderBadge ci-dessous) : baseline du titre,
// hauteur de ligne — nécessaires ICI aussi pour calculer la hauteur du bloc titre (multi-lignes).
const TITLE_BASELINE = 56
const LINE_HEIGHT = 64
// Mesure sur Pixel 7 (Tâche 13, chantier « badge corrections typo/zoom », 19/09) : à 40,
// l'écart bas-dernière-stat → haut-ligne-date mesurait 129px sur un badge Vertical réel
// (calendrier + 5 stats), largement au-dessus de l'écart entre deux paires de stats voisines
// (STACK_PAIR_GAP, mesuré réellement à 37px entre deux paires libellé+valeur adjacentes sur
// ce même badge — jamais supposé égal aux 20px du code, cf. son propre commentaire). Le mode
// côte à côte (calendrier présent, ici) réutilise le budget de hauteur du bloc stats+date pour
// dimensionner le calendrier : `DATE_ROW_H` ne peut donc PAS y descendre assez pour atteindre
// 37px pile, un plancher structurel indépendant de cette constante, hors périmètre de cette
// tâche (qui ne touche QUE `DATE_ROW_H`).
//
// Plancher de sécurité mesuré : en mode SANS calendrier (`none`) avec un texte libre (dernier
// contenu avant la ligne date, tous deux en police 28px), l'écart mesuré n'a plus rien à voir
// avec l'intuition « bande = gap + hauteur de ligne » — à 20, l'écart réel tombait à 3px
// (quasi-chevauchement, badge Deux images sans calendrier + texte libre, mesure directe sur
// canevas). 32 : remonte cet écart à ~15px de marge réelle (calibré depuis cette mesure, pente
// 1 vérifiée par construction — `DATE_ROW_H` s'ajoute tel quel à la position de la ligne date)
// tout en gardant un peu de la réduction visée côté calendrier (129 → ~121, modeste : c'est le
// plancher sans calendrier qui borne la marge de manœuvre, pas l'écart-cible côté calendrier).
const DATE_ROW_H = 32

// Chantier « badge cartouche condensé » (18/09c), unifié sur un seul style empilé pour les 4
// gabarits depuis le chantier « badge corrections typo/zoom » (19/09) : la ligne
// `Label · Valeur` (LINE_HEIGHT, 64px, partagée avec le titre) est remplacée PARTOUT par un
// modèle à deux étages — un label PETIT au-dessus d'une valeur EN GRAS. Ces polices/tailles
// sont posées ICI (plutôt que dans le module de dessin) parce que la géométrie et le dessin
// doivent lire exactement les mêmes valeurs — jamais deux constantes qui pourraient diverger.
// `BADGE_PILL_*` : pastille Technique posée sur la rangée du titre (Task 2), jamais
// programmatique en espacement de lettres (`ctx.letterSpacing` absent des WebView Android
// ciblées, même piège que `ctx.roundRect` évité plus haut via `arcTo`) — l'effet MAJUSCULES,
// s'il y en a un, passe par la casse du texte dessiné, jamais par l'API.
const STACK_LABEL_FONT = '16px sans-serif'
const STACK_VALUE_FONT = 'bold 26px sans-serif'
const STACK_ROW_H = 74                          // 58 → 74 : interligne demandé par Julien (19/09)
const STACK_LABEL_BASELINE_OFFSET = 24          // 22 → 24, proportionnel à STACK_ROW_H
const STACK_VALUE_BASELINE_INSET = 14           // 12 → 14, idem
// Écart SUPPLÉMENTAIRE entre deux paires DIFFÉRENTES (valeur d'une paire → libellé/valeur de
// la paire suivante) — jamais entre un libellé et SA PROPRE valeur (retour Julien, 19/09
// soir : l'écart interne à une paire est jugé bon, celui entre deux données différentes ne
// l'était pas, les deux valant jusqu'ici le même STACK_ROW_H).
const STACK_PAIR_GAP = 20
const BADGE_PILL_FONT = '18px sans-serif'
const BADGE_PILL_PAD_X = 14
const BADGE_PILL_PAD_Y = 7
const BADGE_PILL_GAP = 16
// Taille numérique de BADGE_PILL_FONT, reparsée depuis la chaîne (pas dupliquée en dur à côté :
// un seul nombre à tenir à jour si BADGE_PILL_FONT change un jour) — utilisée par
// `drawTechniqueBadge` pour approximer la hauteur de la pastille (aucune métrique
// ascent/descent fiable partout, cf. son commentaire).
const BADGE_PILL_FONT_SIZE = parseInt(BADGE_PILL_FONT, 10)
// Approximation du sommet d'une majuscule à 56px gras sans-serif au-dessus de sa ligne de
// base (aucune métrique ascent/descent fiable partout, même famille d'approximation que
// BADGE_PILL_FONT_SIZE ci-dessus) — sert à aligner le HAUT de la pastille Technique sur le
// HAUT du titre plutôt que sur sa baseline (retour Julien, 19/09 : la pastille paraissait
// alignée en bas de la ligne de titre).
const TITLE_CAP_HEIGHT_RATIO = 0.72

// Texte libre (Task 5, chantier « badge cartouche condensé » 18/09c ; universel aux 4 gabarits
// depuis le 19/09) : sorti du bloc stats condensé pour en faire un bloc À PART, dessiné pleine
// largeur du cartouche, entre le bloc stats+calendrier et la ligne date/rowtine.app (cf.
// `reserveFreeTextBlock`/`renderBadge` plus bas) — police dédiée, ni celle du titre (56px, bien
// trop grande) ni `STACK_VALUE_FONT` (pensée pour une VALEUR à côté d'un libellé, ce que le
// texte libre n'est pas). Un seul jeu de constantes, partagé par les 4 gabarits : jamais un
// dessin par gabarit.
const FREE_TEXT_FONT = '28px sans-serif'
const FREE_TEXT_LINE_H = 36
const FREE_TEXT_GAP = 24 // espace entre le bas du bloc stats+calendrier et la 1re ligne
// Ascendant approximé de FREE_TEXT_FONT (même approche que BADGE_PILL_FONT_SIZE/
// STACK_LABEL_BASELINE_OFFSET : aucune métrique ascent/descent fiable partout) — laisse aussi
// de la place, sous la dernière ligne, à la descendante avant la réserve DATE_ROW_H qui suit.
const FREE_TEXT_BASELINE_OFFSET = 26

// Gabarit Horizontal SEULEMENT : la photo n'est plus jamais rétrécie pour faire de la place
// au texte (comme les gabarits portrait depuis le 17/09) — c'est le CANEVAS qui s'élargit si
// besoin pour garantir au cartouche cette largeur MINIMALE de lecture, quelle que soit la
// largeur (non plafonnée) qu'atteint la photo à sa hauteur ancrée (600). Avant ce changement,
// le pire cas (photo plafonnée à 900 px de large) laissait un cartouche à ~300 px ; 420 px
// laisse un peu plus de marge tout en restant un plancher, jamais une largeur cible.
const MIN_LANDSCAPE_TEXT_W = 420

// `anchor` : la dimension FIXÉE en premier (largeur en portrait, hauteur en paysage).
// `ratio` : w/h voulu. `maxOther` : plafond de l'autre dimension — si dépassé, c'est l'ANCRE
// elle-même qui cède (recalculée à partir du plafond), pas l'autre dimension qui déborde.
function fitAnchoredSlot({ anchorIsWidth, anchor, maxOther, ratio }) {
  if (anchorIsWidth) {
    let w = anchor
    let h = Math.round(w / ratio)
    if (h > maxOther) {
      h = maxOther
      w = Math.round(h * ratio)
    }
    return { w, h }
  }
  let h = anchor
  let w = Math.round(h * ratio)
  if (w > maxOther) {
    w = maxOther
    h = Math.round(w / ratio)
  }
  return { w, h }
}

// Largeur de cartouche RÉELLEMENT disponible pour le texte, par gabarit — utilisée à la fois
// par `computeBadgeGeometry` (pour poser `statsArea.w`) et par `renderBadge` (pour mesurer/
// wrapper le texte AVANT de connaître la taille finale du canevas) : une seule formule, pour
// que mesure et géométrie finale ne divergent jamais.
// Largeur PLANCHER du canevas, gabarit Texte seul UNIQUEMENT, quand la carte calendaire est
// affichée (retour Julien, 17/09 soir) : le format paysage laisse assez de place pour le texte
// à côté du calendrier sans l'écraser dans une colonne étroite. Valeur alignée sur la largeur
// du gabarit Horizontal, pour une cohérence visuelle entre les deux formats paysage du badge.
const MINIMAL_LANDSCAPE_W = 1350

function textColumnWidth(templateKey, photoRatio, includeCalendar = false, requiredTextWidth = 0) {
  const tpl = BADGE_TEMPLATES[templateKey] || BADGE_TEMPLATES.vertical
  if (!tpl.hasPhoto) {
    const baseW = includeCalendar ? MINIMAL_LANDSCAPE_W : tpl.canvas.w
    // Texte seul : cartouche à marges (x = MARGIN), élargi si le texte l'exige — même motif que
    // les 3 autres branches de cette fonction (`Math.max(..., requiredTextWidth)`). Avant le
    // style empilé unique (Task 3, chantier « badge corrections typo/zoom » 19/09), ce gabarit
    // seul pouvait ignorer `requiredTextWidth` : sa ligne jointe `Label · Valeur` passait par
    // `wrapText` à cette largeur fixe et ne débordait donc jamais. Depuis que le LIBELLÉ
    // s'enroule (`wrapStackedLabels`), `requiredTextWidth` reste nécessaire pour élargir le
    // cartouche autour d'un contenu large plutôt que de le compresser mot par mot dès que
    // possible (bug confirmé en revue, 19/09 — la VALEUR, elle aussi wrappée depuis ce
    // correctif, cf. `wrapStackedLabels`/`drawStackedBlocks`, ne débordait alors plus du
    // cartouche mais restait inutilement écrasée sans cet élargissement).
    return Math.max(baseW - MARGIN * 2, requiredTextWidth)
  }
  if (tpl.orientation === 'landscape') {
    const slot = fitAnchoredSlot({ anchorIsWidth: false, anchor: 600, maxOther: Infinity, ratio: photoRatio })
    return Math.max(MIN_LANDSCAPE_TEXT_W, tpl.canvas.w - (MARGIN + slot.w + GAP), requiredTextWidth)
  }
  // Deux images ET Vertical : cartouche bord à bord (x = 0), élargi si le texte l'exige (Deux
  // images : retour 17/09 ; Vertical : retour Julien, 18/09 — un titre du type « Anders
  // Cardigan » qui revenait à la ligne sans que le gabarit ne puisse s'élargir).
  return Math.max(tpl.canvas.w, requiredTextWidth)
}

// Décision de mise en page quand la carte calendaire (revue 17/09, « inclure la carte
// calendaire du projet ») est demandée : CÔTÉ (mode `side`, moitié droite du cartouche,
// comme avant) si le texte garde une largeur confortable une fois la moitié cédée, sinon
// EN DESSOUS (mode `stack`, pleine largeur, correctif 17/09 après retour de Julien sur Pixel
// réel : un texte compressé sous ~300px à la police 40px des lignes de stats devenait
// illisible mot par mot). Décision fondée UNIQUEMENT sur la largeur réellement disponible
// (`colW`), jamais sur le nom du gabarit : en pratique seul le gabarit Horizontal avec une
// photo large ou carrée tombe sous le seuil aujourd'hui, mais un futur ajustement de
// MIN_LANDSCAPE_TEXT_W ou du texte affiché ne doit rien casser en silence.
const CALENDAR_GAP = 30
const CALENDAR_MIN_TEXT_W = 400
// Espace entre le bas du calendrier et la ligne date (mode empilé, ET terme de sécurité dans
// `naturalDateLineY` du mode côte-à-côte, cf. plus bas) — RESTE à 40, jamais réduit : une
// valeur sous `DATE_ROW_H` (32) désactive le plancher `Math.max(area.h, ...)` qui protège le
// mode côte-à-côte (`area.h === contentH` pour les gabarits portrait, no-op tant que
// `CALENDAR_STACK_GAP >= DATE_ROW_H` — repéré le 20/09 en essayant de réduire cette constante
// à 16, ce qui cassait silencieusement le centrage vertical fraîchement corrigé). Le réglage
// « trop d'espace perdu » demandé par Julien ne concernait QUE l'écart AVANT le calendrier en
// mode empilé — cf. `CALENDAR_STACK_TOP_GAP` ci-dessous, seule constante touchée pour ça.
const CALENDAR_STACK_GAP = 40
// Écart AVANT le calendrier en mode empilé UNIQUEMENT (entre le bas des stats et le haut du
// calendrier) — distincte de `CALENDAR_STACK_GAP` (retour Julien, 20/09 : « trop d'espace
// perdu entre les stats et le calendrier en mode empilé »). Volontairement séparée de
// `CALENDAR_STACK_GAP` : cette dernière reste seule responsable de la marge de sécurité avant
// la ligne date (mode empilé ET côte-à-côte), une valeur plus petite ici n'a aucun effet sur
// ce plancher.
const CALENDAR_STACK_TOP_GAP = 16
const CALENDAR_STACK_HEIGHT = 330

function calendarLayout(colW, includeCalendar) {
  if (!includeCalendar) return { mode: 'none', textW: colW, calendarW: 0 }
  const sideTextW = Math.floor((colW - CALENDAR_GAP) / 2)
  if (sideTextW >= CALENDAR_MIN_TEXT_W) return { mode: 'side', textW: sideTextW, calendarW: colW - sideTextW - CALENDAR_GAP }
  return { mode: 'stack', textW: colW, calendarW: colW }
}

// Largeur de colonne de texte APRÈS décision de mise en page (mode `side` seulement : le
// texte cède la moitié droite) — utilisée pour mesurer/wrapper le texte (renderBadge) AVANT
// de connaître la géométrie finale. En mode `stack`/`none`, le texte garde sa largeur pleine.
function textWidthForCalendar(colW, includeCalendar) {
  return calendarLayout(colW, includeCalendar).textW
}

// Découpe `area` (le cartouche de texte, avant partage) en `{ statsArea, calendarArea }` —
// `calendarArea` reste `null` si `includeCalendar` est faux. `contentH` : hauteur RÉELLE du
// texte (titre + stats), toujours `<= area.h` (en paysage, `area.h` est la hauteur PLEINE du
// cartouche, généreuse ; dans les autres gabarits, `area.h === contentH` exactement, sans
// marge). En mode `stack`, la carte calendaire prend place juste sous le texte, dans la marge
// déjà disponible (`area.h - contentH`) si elle suffit, sinon `statsArea.h` grandit pour
// l'accueillir — c'est CETTE valeur, jamais `area.h` telle quelle, que l'appelant doit relire
// pour dimensionner son canevas (cf. les 4 branches de computeBadgeGeometry ci-dessous).
function statsAreaWithCalendar(area, contentH, includeCalendar, titleLineCount = 1, weeksCount = 0) {
  const layout = calendarLayout(area.w, includeCalendar)
  // `contentBottom` (Task 5, texte libre) : bord bas RÉEL du contenu (les stats seules, ou le
  // plus grand des deux — stats/calendrier — en mode côte à côte), AVANT la réserve
  // `TEXT_PAD + DATE_ROW_H` de la ligne date/rowtine.app qui suit — jamais `textBottom`
  // lui-même (qui inclut déjà cette réserve et, en mode côte à côte/empilé, dépend de la
  // hauteur du CALENDRIER, structurellement différente de celle des stats). Dérivé de
  // `contentH` (jamais de `area.h`, potentiellement gonflé par le plancher photo du gabarit
  // Horizontal, cf. son commentaire dans `computeBadgeGeometry`) : `contentH` vaut TOUJOURS
  // `TEXT_PAD * 2 + statsBlockHeight(...) + DATE_ROW_H`, quel que soit le mode calendrier, donc
  // `area.y + contentH - TEXT_PAD - DATE_ROW_H` est TOUJOURS le bas réel des stats seules,
  // avant toute considération de calendrier — c'est `reserveFreeTextBlock` (plus bas) qui lit
  // ce champ pour ancrer le texte libre, jamais un recalcul APRÈS coup depuis `textBottom`.
  const statsOnlyBottom = area.y + contentH - TEXT_PAD - DATE_ROW_H
  if (layout.mode === 'none') return { statsArea: area, calendarArea: null, textBottom: area.y + area.h, contentBottom: statsOnlyBottom }
  if (layout.mode === 'side') {
    const calendarX = area.x + layout.textW + CALENDAR_GAP
    // Le calendrier commence SOUS le bloc titre, jamais à côté de lui (retour Julien, 18/09) :
    // le titre est désormais dessiné en pleine largeur au-dessus (cf. `renderBadge`), seules
    // les STATS restent à côté du calendrier. `titleOffset` approxime le haut de la 1re ligne
    // de stats : la 1re rangée démarre immédiatement APRÈS le bloc titre (pas de
    // `TITLE_TO_STATS_GAP` — le style empilé n'en a pas besoin, la hauteur de rangée intègre
    // déjà son propre rythme visuel).
    const titleOffset = titleBlockHeight(titleLineCount)
    const calendarTop = area.y + titleOffset
    // Plafonné à la hauteur RÉELLE de la grille (Task « marge date/calendrier », 20/09) : le
    // budget hérité du bloc stats (`area.h - TEXT_PAD`) est presque toujours plus généreux que
    // ce dont le calendrier a besoin en mode `side` — `drawCalendar` centre alors sa grille dans
    // l'excédent (cf. `startY`, badge-calendar.js), ce qui éloignait la ligne date de la légende
    // sans raison. `calendarDrawArea.w` (drawCalendar reçoit `layout.calendarW - TEXT_PAD`, cf.
    // `renderBadge` plus bas) est reproduit ici via `layout.calendarW - TEXT_PAD` pour que la
    // largeur mesurée soit EXACTEMENT celle réellement dessinée.
    const realH = weeksCount > 0 ? calendarRealHeight(layout.calendarW - TEXT_PAD, weeksCount) : Infinity
    const uncappedH = area.h - TEXT_PAD
    const calendarH = Math.min(uncappedH, realH || uncappedH)
    // Centré jusqu'à la ligne date ELLE-MÊME, pas seulement jusqu'à `statsOnlyBottom` (retour
    // Julien, 20/09 soir) : centrer seulement jusqu'à `statsOnlyBottom` (version du matin du
    // 20/09, ci-dessus dans l'historique git) laissait un écart TOUJOURS plus grand sous le
    // calendrier qu'au-dessus, d'exactement `CALENDAR_STACK_GAP` (40px) — la ligne date suit
    // `statsOnlyBottom + CALENDAR_STACK_GAP`, jamais le calendrier tant qu'il reste plus court
    // que les stats, donc structurellement inégal quelle que soit la position du calendrier
    // dans l'ancienne zone. `naturalDateLineY` anticipe cette position EN SUPPOSANT que les
    // stats restent le terme dominant du `Math.max` de `rawTextBottom` (ci-dessous) — vrai tant
    // que `calendarY + calendarH` (borné par `maxOffset`, cf. juste après) ne dépasse jamais
    // `statsOnlyBottom` : ce plafond garantit que cette hypothèse reste toujours vraie, jamais
    // un pari.
    const naturalDateLineY = statsOnlyBottom + CALENDAR_STACK_GAP
    const zoneH = naturalDateLineY - calendarTop
    const rawOffset = Math.floor(Math.max(0, (zoneH - calendarH) / 2))
    // Plafond (jamais dépassé) : un calendrier assez grand pour que ce nouveau centrage plus
    // généreux le pousse au-delà de `statsOnlyBottom` retombe sur l'ancien comportement (bas du
    // calendrier collé à `statsOnlyBottom`, comme avant cette tâche) plutôt que de faire
    // basculer `rawTextBottom` sur le calendrier — ce cas (calendrier presque aussi haut que la
    // zone) restait déjà proche de son ancrage d'origine avant cette tâche, ce plafond ne fait
    // que garder cet invariant intact.
    const maxOffset = Math.max(0, statsOnlyBottom - calendarTop - calendarH)
    const calendarY = calendarTop + Math.min(rawOffset, maxOffset)
    // La ligne date/rowtine.app reste TOUJOURS la toute dernière chose du cartouche (retour
    // Julien, 18/09) : dérivée du bas RÉEL du calendrier (+ un vrai espace, `CALENDAR_STACK_GAP`),
    // jamais l'inverse — une version précédente dérivait la hauteur du calendrier depuis
    // `area.h` directement, ce qui faisait COÏNCIDER son bas avec la baseline de la ligne date
    // (collision, pas un espace) plutôt que de l'espacer d'elle. `Math.max(statsOnlyBottom, ...)`
    // (Task « marge date/calendrier », 20/09) : depuis que `calendarH` peut être plafonné à une
    // hauteur RÉELLE plus courte que le budget hérité des stats, le bas du calendrier peut
    // désormais remonter au-dessus du bas RÉEL du bloc stats affiché à côté de lui — la ligne
    // date doit toujours suivre le PLUS BAS des deux blocs, jamais le calendrier seul (même
    // logique que `contentBottom` ci-dessous). `calendarArea.h`, lui, reste la hauteur RÉELLE du
    // calendrier (`calendarH`), jamais gonflée pour combler cet écart : c'est `textBottom`
    // (donc l'espace entre la légende et la ligne date) qui absorbe la différence, pas la boîte
    // que `drawCalendar` centre sa grille dedans (`startY`, badge-calendar.js) — gonfler
    // `calendarArea.h` aurait réintroduit la moitié de la marge qu'on cherche justement à
    // retirer. Repéré par les tests de non-régression « projet complet » (stats à 5
    // lignes/groupes, calendrier à une seule semaine).
    const rawTextBottom = Math.max(statsOnlyBottom, calendarY + calendarH) + CALENDAR_STACK_GAP + TEXT_PAD
    // Plancher à `area.h` (revue, correctif après-coup) : avant cette tâche, `calendarH` valait
    // TOUJOURS `area.h - TEXT_PAD` (jamais plafonné), ce qui garantissait implicitement
    // `textBottom - area.y > area.h` par construction (la chaîne d'additions le forçait). Une
    // fois `calendarH` plafonné à sa hauteur RÉELLE, cette garantie disparaît — repéré en revue
    // sur le gabarit Horizontal avec une photo haute (ratio proche de 9:16) : `area.h` y vaut
    // `Math.max(minH, contentH)` (le plancher PHOTO, cf. `computeBadgeGeometry`), qui peut
    // dépasser largement `contentH` ; sans ce plancher, `canvasH` (= `statsArea.h` dans ce
    // gabarit) devenait plus courte que la photo elle-même, qui se retrouvait dessinée
    // hors-canevas et rognée (`photoSlot.y` négatif). Seul ce gabarit est concerné (portrait/
    // Deux images/Texte seul : `area.h === contentH` toujours, jamais gonflé par un plancher
    // externe — ce plancher n'y change donc rien, `Math.max` y est déjà un no-op). `textBottom`
    // est re-dérivé du total plafonné (pas seulement `statsArea.h`) pour que la ligne date garde
    // sa position invariante au bas RÉEL du cartouche — la plafonner sans recalculer `textBottom`
    // aurait seulement déplacé l'excès de marge que cette tâche retire, pas supprimé le défaut.
    const totalH = Math.max(area.h, rawTextBottom - area.y)
    const textBottom = area.y + totalH
    return {
      statsArea: { ...area, w: layout.textW, h: totalH },
      calendarArea: { x: calendarX, y: calendarY, w: layout.calendarW, h: calendarH },
      textBottom,
      // Le plus haut des deux (stats seules à côté, ou calendrier) — cf. commentaire de
      // `statsOnlyBottom` ci-dessus : brief Task 5, « peu importe lequel des deux est le plus
      // haut ».
      contentBottom: Math.max(statsOnlyBottom, calendarY + calendarH),
    }
  }
  // Mode empilé : `contentH` inclut déjà la réserve pour la ligne date/rowtine.app à sa toute
  // fin (`DATE_ROW_H`) — le calendrier doit pourtant s'intercaler AVANT elle, jamais après
  // (retour Julien, 18/09 : « date + rowtine.app toujours tout en bas »). `statsOnlyH` retire
  // cette réserve pour placer le calendrier juste après les VRAIES lignes de texte, la ligne
  // date étant repositionnée après lui (même principe que le mode `side` ci-dessus).
  const statsOnlyH = contentH - DATE_ROW_H
  const calendarY = area.y + statsOnlyH + CALENDAR_STACK_TOP_GAP
  const textBottom = calendarY + CALENDAR_STACK_HEIGHT + CALENDAR_STACK_GAP + TEXT_PAD
  const totalH = Math.max(area.h, textBottom - area.y)
  return {
    statsArea: { ...area, h: totalH },
    calendarArea: { x: area.x, y: calendarY, w: layout.calendarW, h: CALENDAR_STACK_HEIGHT },
    textBottom,
    // Le calendrier empilé est TOUJOURS sous les stats ici (par construction, cf. `calendarY`
    // ci-dessus) : son propre bas est donc TOUJOURS le bas réel du contenu.
    contentBottom: calendarY + CALENDAR_STACK_HEIGHT,
  }
}

// Hauteur du bloc titre pour `titleLineCount` lignes (retour à la ligne si le nom du projet ne
// tient pas sur une seule ligne, cf. `wrapText` plus bas) — même hauteur de ligne que les
// stats (`LINE_HEIGHT`), le titre étant dessiné à une taille de police proche (56px vs 40px,
// écart jugé négligeable pour ce calcul de mise en page).
function titleBlockHeight(titleLineCount) {
  return TITLE_BASELINE + Math.max(0, titleLineCount - 1) * LINE_HEIGHT
}

// Écart entre le bas du bloc titre et la première rangée condensée (filet « registre » Vertical,
// premier bloc empilé Horizontal) — revue FINALE de branche, 19/09. `titleBlockHeight` s'arrête
// EXACTEMENT sur la ligne de base de la dernière ligne du titre : elle ne réserve donc rien sous
// elle, ni pour les descendantes du titre (gras 56px, ~12px sous la ligne de base), ni pour la
// pastille Technique posée sur cette même rangée, qui descend de BADGE_PILL_PAD_Y + le descendant
// approximé de sa police (7 + 3,6 = 10,6px) plus la moitié de son trait de bordure. Sans cet
// écart, le premier filet/bloc démarrait pile sur la ligne de base et coupait les deux. 20px :
// couvre le plus profond des deux (~12px pour le titre) avec ~8px de respiration, sans ouvrir un
// trou visible dans un cartouche dont tout l'objet est d'être CONDENSÉ. Réservé par
// `statsBlockHeight` (donc par la hauteur du canevas) ET appliqué à la coordonnée de dessin par
// `renderBadge`, via la MÊME fonction `condensedTitleRowHeight` ci-dessous : appliqué d'un seul
// côté, la ligne date/rowtine.app se décalerait de 20px par rapport à ce que la géométrie a
// réservé (trou ou chevauchement). Style unique depuis le 19/09 (retrait de `'legacy'`) : les 4
// gabarits en bénéficient tous désormais.
const CONDENSED_TITLE_GAP = 20

// Hauteur TOTALE de la rangée titre (+ pastille Technique), écart compris — lue à la fois par la
// géométrie (`statsBlockHeight`) et par le dessin (`renderBadge`, coordonnée `top` de
// `drawStackedBlocks`), jamais recomposée à la main d'un côté ou de l'autre.
function condensedTitleRowHeight(titleLineCount) {
  return titleBlockHeight(titleLineCount) + CONDENSED_TITLE_GAP
}

// Hauteur du bloc titre + stats, UNIQUE style depuis le 19/09 (retrait de la distinction
// `'ledger'`/`'stacked'`/`'legacy'`) : le titre (et sa pastille Technique, Task 2 — même
// rangée), son écart de garde (`condensedTitleRowHeight` ci-dessus), puis `statLineCount`
// rangées de hauteur FIXE (`STACK_ROW_H`), bien plus compactes qu'une `LINE_HEIGHT` de 64px par
// stat. Ne couvre PAS `TEXT_PAD` ni `DATE_ROW_H` : ceux-ci sont ajoutés PAR-DESSUS, par
// l'appelant (`contentHeightFor` ci-dessous).
// `pairCount` (défaut 0, cf. `computeBadgeGeometry` plus bas) : nombre de GROUPES logiques
// (cf. `countGroups` — une entrée `groupStart: false`, comme la seconde phrase de `startedOn`,
// ne compte pas comme un nouveau groupe) — réserve `Math.max(0, pairCount - 1) *
// STACK_PAIR_GAP`, l'écart supplémentaire entre deux groupes DIFFÉRENTS qu'ajoute maintenant
// `drawStackedBlocks` (jamais entre un libellé et sa propre valeur, déjà compté dans
// `STACK_ROW_H` ci-dessus). Un appel qui omet ce paramètre (défaut 0) réserve `Math.max(0, -1)
// * STACK_PAIR_GAP === 0` : résultat bit à bit identique à avant ce correctif.
function statsBlockHeight(statLineCount, titleLineCount, pairCount = 0) {
  return condensedTitleRowHeight(titleLineCount) + statLineCount * STACK_ROW_H + Math.max(0, pairCount - 1) * STACK_PAIR_GAP
}

// Hauteur totale de contenu du cartouche — même structure globale (marge haut/bas, ligne date)
// pour les 4 gabarits, autour du bloc titre/stats condensé.
function contentHeightFor(statLineCount, titleLineCount, pairCount = 0) {
  return TEXT_PAD * 2 + statsBlockHeight(statLineCount, titleLineCount, pairCount) + DATE_ROW_H
}

// Réserve la hauteur du bloc "texte libre" (Task 5) par-dessus `base` (le résultat DÉJÀ
// entièrement figé de `statsAreaWithCalendar`, cf. les 4 branches de `computeBadgeGeometry`
// ci-dessous) — TOUJOURS après coup, jamais mélangée au calcul stats+calendrier lui-même
// (`contentH`, `statsBlockHeight`) : si cette hauteur était ajoutée AVANT (ex. dans
// `contentH`), le calendrier en mode `side` s'étirerait pour occuper cet espace en plus (sa
// hauteur suit `area.h`, cf. `statsAreaWithCalendar`) — un effet de bord que ce chantier
// proscrit explicitement (`calendarLayout`/sa répartition 50-50 restent inchangés, contrainte
// du plan). `freeTextTop` : position Y (repère canvas) du HAUT du bloc — directement
// `base.contentBottom` (cf. son commentaire dans `statsAreaWithCalendar` : le bas RÉEL du
// contenu, stats seules ou le plus grand des deux avec un calendrier, jamais dérivé de
// `textBottom` par soustraction, dont la structure diffère trop d'un mode à l'autre pour une
// arithmétique fiable). Le total (`base.textBottom + h`) reste, lui, valable dans les 3 modes :
// `h` s'insère PAR-DESSUS tout ce qui existait, la ligne date/rowtine.app gardant sa place à la
// toute fin, après le texte libre (retour Julien, 18/09 : « date + rowtine.app toujours tout en
// bas »). `null` si aucun texte libre (rien à positionner) — jamais 0, une coordonnée canvas
// par ailleurs valide.
function reserveFreeTextBlock(base, freeTextLineCount) {
  // `contentBottom` est un champ interne (lu ci-dessous quand il y a un texte libre à
  // positionner) — jamais renvoyé tel quel à l'appelant final de `computeBadgeGeometry`, y
  // compris dans ce repli à 0 ligne (sinon son absence dans l'autre branche, juste en dessous,
  // deviendrait une asymétrie silencieuse selon `freeTextLineCount`).
  if (!freeTextLineCount) return { statsArea: base.statsArea, calendarArea: base.calendarArea, textBottom: base.textBottom, freeTextTop: null }
  const h = FREE_TEXT_GAP + freeTextLineCount * FREE_TEXT_LINE_H
  return {
    statsArea: { ...base.statsArea, h: base.statsArea.h + h },
    calendarArea: base.calendarArea,
    textBottom: base.textBottom + h,
    freeTextTop: base.contentBottom,
  }
}

// Géométrie complète d'un gabarit pour un ratio de photo donné : slot(s) photo + cartouche de
// texte. `photoRatio` est soit un nombre (appliqué au slot unique, ou aux deux slots du
// gabarit Deux images), soit `[r1, r2]` pour deux slots à ratios INDÉPENDANTS (choisis au
// recadrage, cf. BadgeComposer.vue) — 1 = carré, 4/3 ou 16/9 = rectangle large, 3/4 ou 9/16 =
// rectangle haut. Le cartouche va bord à bord sur l'axe qui n'est PAS contraint par la photo
// — toute la LARGEUR en portrait, toute la HAUTEUR en paysage (revue « cartouche pleine
// largeur/hauteur », 16/09) — l'autre axe suit simplement la fin du slot photo + GAP.
// `statLineCount` : nombre de lignes de stats + texte libre réellement affichées. Gabarit
// Texte seul (sans photo) : le cartouche s'adapte à ce nombre DANS le canvas fixe, sans
// couvrir toute la hauteur disponible (revue « pas de place perdue », 17/09). Gabarits
// portrait à photo (Vertical, Deux images) : c'est le CANVAS qui grandit pour que le
// cartouche loge TOUJOURS `contentHeightFor(statLineCount, ...)` en entier, quelle que soit la
// hauteur de la photo — remonté par une utilisatrice (17/09) : une photo au format portrait
// laissait un cartouche trop court, texte chevauché. La photo n'est donc plus plafonnée en
// hauteur (elle l'était avant, pour lui faire de la place dans un canvas fixe).
// `freeTextLineCount` (Task 5, 7e paramètre depuis le retrait de `layoutStyle`, chantier
// « badge corrections typo/zoom » 19/09 — auparavant 8e, après `layoutStyle`) : nombre de
// lignes du bloc "texte libre" PLEINE LARGEUR (`customText`, wrappé à `titleMaxWidth` par
// l'appelant, cf. `renderBadge`), réservées PAR-DESSUS la géométrie stats+calendrier déjà
// calculée (cf. `reserveFreeTextBlock`) — jamais dans `statLineCount`/`contentHeightFor`, pour
// aucun gabarit (les 4 en sont désormais sortis, style empilé unique). Par défaut 0 (aucun
// bloc, `base` renvoyé tel quel) : tout appel existant qui omet ce paramètre garde un résultat
// bit-à-bit identique.
// `pairCount` (Task 9/13, 8e paramètre) : nombre de GROUPES logiques (cf.
// `countGroups` — ni de paires { label, value }, ni de sous-lignes) parmi les stats
// affichées, réservé PAR-DESSUS `statsBlockHeight` sous forme de `Math.max(0, pairCount - 1)
// * STACK_PAIR_GAP` (l'écart supplémentaire entre deux groupes différents, cf. commentaire de
// `statsBlockHeight` ci-dessus). Par défaut 0 : tout appel existant qui l'omet garde un
// résultat bit-à-bit identique.
// `weeksCount` (Task « marge date/calendrier », 20/09, 9e et dernier paramètre) : nombre de
// semaines (colonnes) de la grille calendaire, transmis à `statsAreaWithCalendar` pour plafonner
// la hauteur réservée au calendrier en mode `side` à sa hauteur RÉELLE (cf. `calendarRealHeight`,
// badge-calendar.js) au lieu du budget hérité du bloc stats. Par défaut 0 : `statsAreaWithCalendar`
// retombe alors sur l'ancien comportement (calendrier prenant toute la hauteur disponible), donc
// tout appel existant qui omet ce paramètre garde un résultat bit-à-bit identique.
export function computeBadgeGeometry(templateKey, photoRatio = 1, statLineCount = 0, titleLineCount = 1, includeCalendar = false, requiredTextWidth = 0, freeTextLineCount = 0, pairCount = 0, weeksCount = 0) {
  const tpl = BADGE_TEMPLATES[templateKey] || BADGE_TEMPLATES.vertical
  // `tpl.canvas.h` n'est PAS lu ici : la hauteur réelle est TOUJOURS dérivée du contenu (photo
  // ancrée + texte), jamais d'une valeur fixe de gabarit — pour Horizontal aussi depuis le
  // correctif du 17/09 soir (elle l'était encore avant, cf. git blame). `BADGE_TEMPLATES.*.canvas.h`
  // reste une valeur nominale/documentaire (aperçus, tests), pas un plancher de mise en page.
  const { w } = tpl.canvas
  if (!tpl.hasPhoto) {
    const baseW = includeCalendar ? MINIMAL_LANDSCAPE_W : w
    const contentH = contentHeightFor(statLineCount, titleLineCount, pairCount)
    const colW = textColumnWidth(templateKey, photoRatio, includeCalendar, requiredTextWidth)
    // `colW` avant `canvasW` (correctif 19/09, cf. `textColumnWidth`) : le canevas doit relire
    // `colW` pour s'élargir avec lui — même motif que `double`/paysage/vertical plus bas
    // (`Math.max(w, colW)`), en conservant ici la marge symétrique (`x: MARGIN`) déjà en place.
    // Cas courant (`requiredTextWidth` sous le plancher) : `colW === baseW - MARGIN * 2`, donc
    // `colW + MARGIN * 2 === baseW` — résultat bit à bit identique à avant ce correctif.
    const canvasW = Math.max(baseW, colW + MARGIN * 2)
    const base = statsAreaWithCalendar({ x: MARGIN, y: MARGIN, w: colW, h: contentH }, contentH, includeCalendar, titleLineCount, weeksCount)
    const { statsArea, calendarArea, textBottom, freeTextTop } = reserveFreeTextBlock(base, freeTextLineCount)
    return { canvas: { w: canvasW, h: MARGIN * 2 + statsArea.h }, photoSlot: null, statsArea, calendarArea, textBottom, freeTextTop }
  }
  if (tpl.double) {
    const [r1, r2] = Array.isArray(photoRatio) ? photoRatio : [photoRatio, photoRatio]
    const colW = textColumnWidth(templateKey, photoRatio, includeCalendar, requiredTextWidth)
    const canvasW = Math.max(w, colW)
    const anchorW = (canvasW - MARGIN * 2 - GAP_DOUBLE) / 2
    const s1 = fitAnchoredSlot({ anchorIsWidth: true, anchor: anchorW, maxOther: Infinity, ratio: r1 })
    const s2 = fitAnchoredSlot({ anchorIsWidth: true, anchor: anchorW, maxOther: Infinity, ratio: r2 })
    const photoSlots = [
      { x: MARGIN, y: MARGIN, w: s1.w, h: s1.h, aspect: r1 },
      { x: MARGIN + anchorW + GAP_DOUBLE, y: MARGIN, w: s2.w, h: s2.h, aspect: r2 },
    ]
    // Le cartouche démarre sous le PLUS HAUT des deux slots (top-alignés, hauteurs
    // potentiellement différentes si les deux photos ont des ratios différents).
    const statsY = MARGIN + Math.max(s1.h, s2.h) + GAP
    const contentH = contentHeightFor(statLineCount, titleLineCount, pairCount)
    const base = statsAreaWithCalendar({ x: 0, y: statsY, w: canvasW, h: contentH }, contentH, includeCalendar, titleLineCount, weeksCount)
    const { statsArea, calendarArea, textBottom, freeTextTop } = reserveFreeTextBlock(base, freeTextLineCount)
    return { canvas: { w: canvasW, h: statsY + statsArea.h }, photoSlots, statsArea, calendarArea, textBottom, freeTextTop }
  }
  if (tpl.orientation === 'landscape') {
    // Plancher 600 pour la hauteur de la photo (17/09 : elle ne doit plus jamais être rétrécie
    // pour faire de la place au texte) — la photo suit désormais la hauteur du canevas quand le
    // contenu est plus haut que ce plancher (20/09 : à 600 fixe, une photo 16:9
    // ne représentait qu'environ un tiers de la surface du badge, l'inverse était souhaité).
    // `slot600` ne sert donc
    // plus qu'à poser ce plancher (`minH`) ET la valeur de repli quand le contenu tient dedans —
    // sa LARGEUR à 600 de haut n'est, elle, jamais utilisée directement pour dessiner la photo.
    const slot600 = fitAnchoredSlot({ anchorIsWidth: false, anchor: 600, maxOther: Infinity, ratio: photoRatio })
    const colW = textColumnWidth(templateKey, photoRatio, includeCalendar, requiredTextWidth)
    const contentH = contentHeightFor(statLineCount, titleLineCount, pairCount)
    const minH = slot600.h + MARGIN * 2
    // Cartouche calculé à `x = 0` D'ABORD : sa HAUTEUR (celle qu'on doit connaître pour
    // dimensionner la photo) n'en dépend pas — seuls `statsArea.x`/`calendarArea.x` en dépendent
    // (vérifié en lisant `statsAreaWithCalendar`/`reserveFreeTextBlock` : aucun autre champ ne
    // relit `area.x`), décalés à la toute fin une fois `statsX` connu plutôt que refaits avec le
    // bon `x` d'entrée — un second appel donnerait un résultat strictement identique ici (la
    // dépendance à `area.x` y est purement additive) mais referait tout le calcul pour rien.
    const base = statsAreaWithCalendar({ x: 0, y: 0, w: colW, h: Math.max(minH, contentH) }, contentH, includeCalendar, titleLineCount, weeksCount)
    const { statsArea: statsArea0, calendarArea: calendarArea0, textBottom, freeTextTop } = reserveFreeTextBlock(base, freeTextLineCount)
    const canvasH = statsArea0.h
    // `max(600, canvasH - MARGIN*2)` : en pratique, la branche `slot600.h` (600) ne l'emporte
    // JAMAIS — c'est `minH` (ci-dessus, déjà injecté dans `area.h` avant `statsArea0.h`) qui
    // TIENT le plancher, en garantissant `canvasH >= minH = slot600.h + MARGIN*2`, donc
    // `canvasH - MARGIN*2 >= slot600.h` en toute circonstance. Ce `Math.max` n'est qu'une garde
    // supplémentaire (ceinture et bretelles, prescrite par le plan), jamais le mécanisme qui
    // assure le plancher lui-même. Conséquence directe : `photoH === canvasH - MARGIN*2`
    // TOUJOURS, donc `photoSlot.y` (le centrage `(canvasH - photoH) / 2` juste plus bas) vaut
    // de fait TOUJOURS exactement `MARGIN` — ce centrage ne jouerait un rôle réel que si
    // `canvasH` pouvait descendre sous 780, ce qui n'arrive jamais.
    const photoH = Math.max(slot600.h, canvasH - MARGIN * 2)
    const photoW = Math.round(photoH * photoRatio)
    const statsX = MARGIN + photoW + GAP
    const canvasW = statsX + colW
    const statsArea = { ...statsArea0, x: statsArea0.x + statsX }
    const calendarArea = calendarArea0 ? { ...calendarArea0, x: calendarArea0.x + statsX } : null
    const photoSlot = { x: MARGIN, y: (canvasH - photoH) / 2, w: photoW, h: photoH, aspect: photoRatio }
    return { canvas: { w: canvasW, h: canvasH }, photoSlot, statsArea, calendarArea, textBottom, freeTextTop }
  }
  // portrait (vertical) : largeur ANCRÉE (bord à bord des marges) et élargie si le texte
  // l'exige (retour Julien, 18/09 — même traitement que Deux images, cf. `textColumnWidth`),
  // hauteur dérivée du ratio, SANS plafond — le canvas grandit pour la loger. La photo, ancrée
  // en largeur sur ce même canevas, s'élargit avec lui (ratio conservé, donc plus haute aussi).
  const colW = textColumnWidth(templateKey, photoRatio, includeCalendar, requiredTextWidth)
  const canvasW = Math.max(w, colW)
  const slot = fitAnchoredSlot({ anchorIsWidth: true, anchor: canvasW - MARGIN * 2, maxOther: Infinity, ratio: photoRatio })
  const photoSlot = { x: MARGIN, y: MARGIN, w: slot.w, h: slot.h, aspect: photoRatio }
  const statsY = MARGIN + slot.h + GAP
  const contentH = contentHeightFor(statLineCount, titleLineCount, pairCount)
  const base = statsAreaWithCalendar({ x: 0, y: statsY, w: canvasW, h: contentH }, contentH, includeCalendar, titleLineCount, weeksCount)
  const { statsArea, calendarArea, textBottom, freeTextTop } = reserveFreeTextBlock(base, freeTextLineCount)
  return { canvas: { w: canvasW, h: statsY + statsArea.h }, photoSlot, statsArea, calendarArea, textBottom, freeTextTop }
}

// Découpe `text` en lignes qui tiennent chacune dans `maxWidth`, avec la police déjà posée sur
// `ctx` (`ctx.font` doit être réglé AVANT l'appel) — retour à la ligne mot par mot, JAMAIS de
// troncature à l'ellipse (remplace l'ancien `fitText`, cf. revue 17/09 : « le texte ne doit
// jamais être coupé, le canevas grandit si besoin »). Dernier recours si un seul mot dépasse
// déjà `maxWidth` (ex. mot très long sans espace) : coupure caractère par caractère, pour ne
// jamais dépasser silencieusement — jamais rencontré en usage réel (noms de projet, libellés
// de stats), mais un mot qui déborderait sans coupure romprait l'invariant « toujours dans le
// cartouche ».
export function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(' ').filter((w) => w.length)
  if (!words.length) return ['']
  const lines = []
  let current = ''
  for (const word of words) {
    const withWord = current ? `${current} ${word}` : word
    if (ctx.measureText(withWord).width <= maxWidth) {
      current = withWord
      continue
    }
    if (current) {
      lines.push(current)
      current = ''
    }
    if (ctx.measureText(word).width > maxWidth) {
      const pieces = splitLongWord(ctx, word, maxWidth)
      lines.push(...pieces.slice(0, -1))
      current = pieces.at(-1)
    } else {
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function splitLongWord(ctx, word, maxWidth) {
  const lines = []
  let current = ''
  for (const ch of word) {
    const candidate = current + ch
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate
    } else {
      lines.push(current)
      current = ch
    }
  }
  if (current) lines.push(current)
  return lines
}

// Libellé « marque modèle » d'une laine, tel qu'affiché à la fois sur le badge (statLines
// ci-dessous) et sur la pastille dédiée de l'onglet Infos (BadgeComposer.vue,
// `yarnsSummaryText`) — une seule construction, pour que les deux ne divergent jamais.
// Champs VIDES écartés avant la jointure (même discipline que `labelOf` dans
// db/purchases-reprise.js) : `model` est facultatif (`emptyYarn()` le pose à ''), une
// concaténation naïve donnerait « Drops  · 4 pelotes » (double espace) sur le badge.
// Repli sur `colorName` quand marque ET modèle sont vides — cas ATTEIGNABLE : le `<select>`
// de marque de StashView.vue ouvre sur `<option value="">` et `save()` n'exige que
// `colorName`, seul champ réellement obligatoire d'une fiche laine (le reste de l'app assume
// déjà ce vide, cf. `brand || '—'` dans YarnCard.vue/ProjectDetailView.vue/ProjectEditView.vue).
// Sans ce repli la ligne du badge démarrait sur un séparateur orphelin (« · 4 pelotes ») et
// la pastille « Laine(s) » restait vide, invisible mais cliquable. Repli sur le NOM DU
// COLORIS et non sur « — » : la décision « identité = marque + modèle » (spec 18/09) porte
// sur les champs à PRIVILÉGIER quand ils existent, et un tiret long sur une image partagée
// est précisément ce que proscrit la règle du séparateur ci-dessous.
export function yarnLabel(yarn) {
  const label = [yarn?.brand, yarn?.model].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ')
  return label || String(yarn?.colorName ?? '').trim()
}

// Une seule logique pour « Commencé le / Terminé le », partagée par `statValue` (pastille,
// phrase jointe par « · ») et `statLines` (badge, une ligne PAR phrase) — jamais dupliquée.
// Une date ABSENTE ne produit aucune phrase : `startedAt` vaut '' tant que le projet n'a
// jamais été travaillé (défaut de `emptyProject()`, posé au premier chrono seulement), et
// `formatLocalDate('')` rend '' — sans ce garde, le badge afficherait « Commencé le » suivi
// de rien. Retourne donc parfois un tableau vide (projet sans aucune date).
function startedOnParts(project, t, locale) {
  const parts = []
  if (project?.startedAt) parts.push(t('project.startedOn', { date: formatLocalDate(project.startedAt, locale) }, { locale }))
  if (project?.finishedAt) parts.push(t('project.finishedOn', { date: formatLocalDate(project.finishedAt, locale) }, { locale }))
  return parts
}

// Valeur SEULE d'une statistique, SANS le libellé (« Label · ») — la ligne complète dessinée
// sur le badge se construit toujours via `statLines()` plus bas, qui compose maintenant à
// partir de cette fonction plutôt que de dupliquer chaque calcul. Exportée séparément pour que
// `BadgeComposer.vue` affiche cette même valeur sur les pastilles de sélection de l'onglet
// Infos (revue 17/09 : « la valeur directement, plutôt qu'un titre générique comme Technique
// ou Période »). `locale` choisit dans QUELLE langue `t()` traduit — indépendant de la langue
// active de l'app (choix fait dans l'assistant du badge, BadgeComposer.vue).
export function statValue(key, stats, t, locale, project) {
  switch (key) {
    case 'totalTime':
      return formatDuration(stats.totalSeconds)
    case 'sessionsCount':
      return t('project.stats.sessionsValue', stats.sessionsCount, { locale })
    case 'startedOn':
      return startedOnParts(project, t, locale).join(' · ')
    case 'bestStreak':
      return t('project.stats.streakValue', stats.bestStreak, { locale })
    case 'technique':
      return project?.technique ? t(`technique.${project.technique}`, {}, { locale }) : ''
    case 'progress':
      return stats.rowsProgress
        ? t('project.stats.progressValue', { pct: Math.round((100 * stats.rowsProgress.done) / stats.rowsProgress.total) }, { locale })
        : ''
    default:
      return ''
  }
}

// Une entrée logique peut produire PLUSIEURS lignes réelles (laines : une paire nom +
// pelotes PAR laine liée, jamais de total regroupé — décision Julien ; date : 1 ligne en
// cours, 2 si le projet est terminé). Retourne TOUJOURS un tableau, même vide (clé
// inconnue, ou 'yarns' sans laine liée). Séparateur « · » (point médian), jamais « — »
// (tiret long, identifié comme un marqueur visuel d'IA).
// `structured` (Task 3, chantier « badge cartouche condensé » 18/09c) : `false` (défaut)
// renvoie la chaîne déjà composée `Label · Valeur` (repli sans contexte 2D uniquement, cf.
// `renderBadge`) ; `true` renvoie `{ label, value }` séparément — nécessaire au dessin "bloc
// empilé" (`drawStackedBlocks`, label et valeur dessinés séparément), UNIQUE style des 4
// gabarits depuis le 19/09 : un seul mécanisme de séparation label/valeur, jamais un second qui
// re-parserait le « · » d'une chaîne déjà jointe. `label` est vide (`''`), jamais absent, pour
// les entrées déjà auto-descriptives sans libellé propre (`sessionsCount`, `technique`, chaque
// phrase de `startedOn`) — l'appelant ne dessine alors QUE la valeur, jamais un libellé vide à
// côté.
// `groupStart` (Task 13, chantier « badge corrections typo/zoom » 19/09) : posé UNIQUEMENT sur
// les paires structurées de `startedOn` — ses deux phrases (« Commencé le »/« Terminé le ») sont
// UNE SEULE donnée logique (une plage), l'écart supplémentaire entre données DIFFÉRENTES
// (`STACK_PAIR_GAP`, cf. `drawStackedBlocks`/`statsBlockHeight`) ne doit s'appliquer QU'AVANT la
// première phrase, jamais entre les deux. Absent (`undefined`) pour toutes les autres entrées
// structurées (yarns compris — chaque laine reste sa propre donnée, jamais regroupée) : à
// traiter comme `true` (chaque entrée démarre son propre groupe) partout où il est lu.
function statLines(key, stats, t, locale, project, yarnUsage, structured = false, unitSystem) {
  if (key === 'yarns') {
    return (yarnUsage || []).map(({ yarn, balls }) => {
      const label = yarnLabel(yarn)
      const ballsText = t('project.stats.ballsValue', balls, { locale })
      const meters = balls * (parseDecimal(yarn.lengthM) || 0)
      if (!meters) return structured ? { label, value: ballsText } : `${label} · ${ballsText}`
      const len = formatLength(meters, { locale, system: unitSystem, profile: 'total' })
      const value = `${ballsText} (${len.text} ${t(len.unitKey, {}, { locale })})`
      return structured ? { label, value } : `${label} · ${value}`
    })
  }
  if (key === 'startedOn') {
    const parts = startedOnParts(project, t, locale)
    return structured
      ? parts.map((value, i) => ({ label: '', value, groupStart: i === 0 }))
      : parts
  }
  const value = statValue(key, stats, t, locale, project)
  switch (key) {
    case 'totalTime':
    case 'bestStreak': {
      const label = t(`project.stats.${key}`, {}, { locale })
      return [structured ? { label, value } : `${label} · ${value}`]
    }
    case 'sessionsCount':
    case 'technique':
      return [structured ? { label: '', value } : value]
    case 'progress': {
      if (!value) return []
      const label = t('project.stats.progress', {}, { locale })
      if (!structured) return [`${label} · ${value}`]
      // `motif` (Task B, chantier « badge motif d'avancement » 20/09) : `undefined` (jamais un
      // objet à champs vides) quand `rowsProgress` est `null`, pour que `wrapStackedLabels`/
      // `drawStackedBlocks` n'aient qu'à tester `row.motif` en vérité JS simple — cohérent avec
      // `value` déjà vide dans ce cas (`if (!value) return []` ci-dessus).
      const motif = stats.rowsProgress
        ? { technique: project?.technique === 'crochet' ? 'crochet' : 'knitting', done: stats.rowsProgress.done, total: stats.rowsProgress.total }
        : undefined
      return [{ label, value, motif }]
    }
    default:
      return []
  }
}

// Espace insécable entre un chiffre et ce qui le suit immédiatement — SEULEMENT dans les
// lignes composées ici, jamais dans formatDuration/formatLength/formatWeight
// (project-stats.js, format-*.js) : ces fonctions sont partagées avec ProjectDetailView.vue/
// YarnCard.vue/etc., qui n'ont pas cette contrainte visuelle.
function withNbsp(text) {
  return text.replace(/(\d) /g, '$1 ')
}

// Point d'entrée UNIQUE pour "quelles lignes brutes le badge va-t-il afficher", appelé par
// `renderBadge()` (dessin réel) ET par `BadgeComposer.vue` (`statLineCount`, pour
// dimensionner la prévisu — AUCUN contexte 2D nécessaire ici, seul le retour à la ligne du
// texte, plus loin, en a besoin). Ne jamais dupliquer cette construction à un second
// endroit : deux bugs de hauteur de canevas mal prédite ont déjà été causés par un tel
// écart entre les deux appelants.
// `structured` (Task 3) : cf. `statLines` ci-dessus — répercuté ICI sur `customText` aussi
// (texte libre optionnel), pour que l'appelant reçoive un tableau de forme UNIFORME (que des
// chaînes, ou que des `{ label, value }`), jamais un mélange des deux.
export function buildRawStatLines(statKeys, { stats, t, locale, project, yarnUsage, customText, structured = false, unitSystem }) {
  const lines = (statKeys || []).flatMap((key) => statLines(key, stats, t, locale, project, yarnUsage, structured, unitSystem))
  if (customText && customText.trim()) {
    lines.push(structured ? { label: '', value: customText.trim() } : customText.trim())
  }
  if (!structured) return lines.map(withNbsp)
  // `groupStart` (Task 13) propagé TEL QUEL — un spread AVANT les champs recalculés (`label`/
  // `value`, seuls passés par `withNbsp`) plutôt qu'une déstructuration `{ label, value }`, qui
  // perdrait silencieusement ce champ pour les paires de `startedOn` qui le portent.
  return lines.map((line) => ({ ...line, label: withNbsp(line.label), value: withNbsp(line.value) }))
}

// Rayon des coins arrondis des photos (revue « bord arrondi », 16/09) — tracé à la main via
// `arcTo` plutôt que `ctx.roundRect` (API canvas récente, pas garantie sur toutes les
// WebView Android ciblées) : compatible partout où `clip()`/`arcTo` existent, donc partout.
const PHOTO_RADIUS = 28

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function drawPhotoCover(ctx, img, slot) {
  const slotRatio = slot.w / slot.h
  const imgRatio = img.naturalWidth / img.naturalHeight
  let sx, sy, sw, sh
  if (imgRatio > slotRatio) {
    sh = img.naturalHeight
    sw = sh * slotRatio
    sx = (img.naturalWidth - sw) / 2
    sy = 0
  } else {
    sw = img.naturalWidth
    sh = sw / slotRatio
    sx = 0
    sy = (img.naturalHeight - sh) / 2
  }
  ctx.save()
  roundRectPath(ctx, slot.x, slot.y, slot.w, slot.h, PHOTO_RADIUS)
  ctx.clip()
  ctx.drawImage(img, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h)
  ctx.restore()
}

function formatBadgeDate(date, locale = 'fr') {
  const d = date instanceof Date ? date : new Date(date || Date.now())
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' })
}

// `ICONS.labelVegan.body` est pensée pour un <svg v-html> (AppIcon.vue), pas un Path2D —
// deux <path d="..."> concaténés à extraire. Path2D absent de jsdom (jamais polyfillé,
// cf. tests/unit/setup.js) : garde, comme ResizeObserver ailleurs dans le composeur.
// viewBox 24×24, largeur de trait 1.7 — mêmes valeurs que le rendu SVG par défaut
// d'AppIcon.vue (labelVegan ne les surcharge pas).
// Extraction par regex mise en cache : `ICONS.labelVegan.body` est une chaîne constante du
// module, la refaire à chaque badge dessiné (chemin déjà chaud, cf. commentaire sur
// PREVIEW_DEBOUNCE_MS dans BadgeComposer.vue) n'a aucune raison d'être répété.
let veganIconPathData = null
function veganIconPaths() {
  if (!veganIconPathData) veganIconPathData = [...ICONS.labelVegan.body.matchAll(/d="([^"]+)"/g)].map((m) => m[1])
  return veganIconPathData
}
function drawVeganIcon(ctx, x, y, size, color) {
  if (typeof Path2D === 'undefined') return
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.7
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of veganIconPaths()) ctx.stroke(new Path2D(d))
  ctx.restore()
}

// Pastille Technique (Task 2, chantier « badge cartouche condensé » 18/09c) — les 4 gabarits
// depuis le style empilé unique (19/09, cf. `renderStatKeys`/`techniqueLabel` dans
// `renderBadge` : plus aucune condition de gabarit) : la technique quitte les lignes de stats
// pour être dessinée directement sur la rangée du titre, comme l'icône vegan déjà collée à sa
// fin.
// `(x, y)` : point de départ de la ligne de base du TEXTE, exactement le contrat de
// `ctx.fillText` (pas un coin de boîte) — l'appelant n'a donc qu'à mesurer la fin du titre et
// lui ajouter BADGE_PILL_GAP, jamais à connaître la géométrie interne de la pastille. Fond
// transparent (laisse voir le bandeau derrière — une pastille pleine concurrencerait la
// lisibilité du titre juste à côté), bordure `textColor` à 40 % d'opacité (`ctx.globalAlpha`,
// pas une couleur rgba composée à la main : `textColor` est tantôt '#fff' tantôt '#111', cf.
// `autoTextColor`). Coins arrondis en pleine capsule (rayon = moitié de la hauteur de la
// pastille) via `roundRectPath` (arcTo, jamais `ctx.roundRect` — même contrainte WebView que
// les photos, cf. son commentaire). Majuscules par la CASSE du texte dessiné, jamais
// `ctx.letterSpacing` (absent des WebView Android ciblées). Ascendant/descendant approximés à
// 0,8/0,2 de la taille de police (`BADGE_PILL_FONT_SIZE`) : aucune métrique fiable partout
// (`measureText().actualBoundingBox*` n'est pas garanti sur les WebView ciblées, cf. le
// contexte 2D minimal utilisé par les tests) — approximation usuelle pour un sans-serif,
// suffisante pour une bordure qui encadre visuellement le texte, pas une mesure typographique
// exacte. Retourne la largeur totale dessinée (bordure/padding compris), pour que l'appelant
// sache où continuer si besoin (même service que `lastTitleLineWidth` rend déjà pour l'icône
// vegan) — mesurée depuis le bord GAUCHE de la pastille (x - BADGE_PILL_PAD_X), pas depuis x.
export function drawTechniqueBadge(ctx, x, y, text, textColor) {
  const label = String(text || '').toUpperCase()
  if (!label) return 0
  ctx.font = BADGE_PILL_FONT
  const textW = ctx.measureText(label).width
  const ascent = BADGE_PILL_FONT_SIZE * 0.8
  const descent = BADGE_PILL_FONT_SIZE * 0.2
  const w = textW + BADGE_PILL_PAD_X * 2
  const h = ascent + descent + BADGE_PILL_PAD_Y * 2
  const rectX = x - BADGE_PILL_PAD_X
  const rectY = y - ascent - BADGE_PILL_PAD_Y
  ctx.save()
  ctx.globalAlpha = 0.4
  ctx.strokeStyle = textColor
  ctx.lineWidth = 1.5
  roundRectPath(ctx, rectX, rectY, w, h, h / 2)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = textColor
  ctx.font = BADGE_PILL_FONT
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(label, x, y)
  return w
}

// Répartit le libellé de chaque paire sur autant de lignes que nécessaire pour qu'il ne soit
// JAMAIS coupé en plein mot (même invariant que `wrapText` partout dans ce fichier) —
// généralisation du mécanisme posé pour le style « registre » du 18/09c (`wrapLedgerLabels`,
// retiré avec ce chantier) à l'unique style empilé, désormais commun aux 4 gabarits. Appelée
// DEUX fois pour un même badge, avec exactement la même largeur : en phase de MESURE (le total
// des sous-lignes devient le `statLineCount` transmis à `computeBadgeGeometry`) puis passée
// TELLE QUELLE à `drawStackedBlocks` — jamais recalculée côté dessin. Une paire sans libellé
// (`sessionsCount`, `technique`, chaque phrase de `startedOn`) donne `labelLines: []` — un bloc
// d'une seule ligne, valeur seule.
function wrapStackedLabels(ctx, pairs, width) {
  return (pairs || []).map(({ label, value, groupStart, motif }) => {
    ctx.font = STACK_VALUE_FONT
    const valueLines = wrapText(ctx, value, Math.max(1, width))
    if (!label) return { value, valueLines, labelLines: [], groupStart, motif }
    ctx.font = STACK_LABEL_FONT
    return { value, valueLines, labelLines: wrapText(ctx, label.toUpperCase(), Math.max(1, width)), groupStart, motif }
  })
}

// Nombre de sous-lignes RÉELLEMENT dessinées (donc de hauteurs de rangée consommées) par le
// résultat de `wrapStackedLabels` — une paire sans libellé occupe quand même sa rangée. Depuis
// que la VALEUR se wrappe elle aussi (jamais plus une seule ligne fixe, cf. `wrapStackedLabels`
// ci-dessus), une paire consomme `labelRows` (libellé, min 1) PLUS les sous-lignes de valeur
// AU-DELÀ de la première (`valueLines.length - 1`, jamais négatif) : la toute première sous-
// ligne de valeur partage sa rangée avec la dernière ligne de libellé, exactement comme avant
// (`drawStackedBlocks` la dessine sur cette même rangée) — seules les sous-lignes de valeur
// SUPPLÉMENTAIRES ajoutent une rangée chacune.
// `motif` (Task B) : rangée FIXE de hauteur `STACK_ROW_H` en plus, une par stat porteuse d'un
// motif (`progress` avec `rowsProgress` connu) — indépendante du nombre de mailles réellement
// dessinées (cf. `badge-stitch-motif.js`), donc jamais recalculée ici en fonction de la largeur :
// c'est tout l'intérêt de ce découpage, aucune seconde phase de mesure à garder synchronisée.
function stackedRowCount(rows) {
  return (rows || []).reduce(
    (n, { labelLines, valueLines, motif }) => n + Math.max(1, labelLines.length) + Math.max(0, (valueLines?.length || 1) - 1) + (motif ? 1 : 0),
    0,
  )
}

// Nombre de GROUPES logiques (Task 13) dans une liste de paires structurées — jamais le nombre
// d'entrées : deux entrées d'un même groupe (les deux phrases de `startedOn`, cf. `statLines`)
// ne comptent que pour UN groupe, faute de quoi la géométrie (`statsBlockHeight`) réserverait un
// `STACK_PAIR_GAP` que `drawStackedBlocks` ne dessine plus entre elles. `groupStart !== false` :
// `true` OU `undefined` (toute entrée hors `startedOn`) démarre son propre groupe.
export function countGroups(structuredPairs) {
  return (structuredPairs || []).filter((p) => p.groupStart !== false).length
}

// Dessin "bloc empilé" des lignes de stats — UNIQUE style des 4 gabarits depuis ce chantier
// (19/09) : Vertical abandonne le style "registre" (filets, libellé gauche/valeur droite),
// Texte seul/Deux images abandonnent la ligne jointe "Label · Valeur". Chaque paire
// `{ label, value }` de `buildRawStatLines(..., { structured: true })` dessine un bloc à
// deux étages — libellé en MAJUSCULES au-dessus (STACK_LABEL_FONT), valeur en gras juste en
// dessous (STACK_VALUE_FONT), tous deux alignés à GAUCHE (jamais de centrage : une colonne
// de texte étroite est l'objectif de ce style). Un libellé trop long revient à la ligne
// (`wrapStackedLabels`, jamais de troncature) — la valeur, depuis ce correctif (19/09, bug
// confirmé en mode calendrier `side`), revient à la ligne exactement de la même façon plutôt
// que de déborder du cartouche à largeur fixe. Une entrée sans libellé ne dessine que sa
// valeur, à la même position dans le bloc (bas), pour garder les valeurs alignées sur une même
// grille verticale que le libellé soit présent ou non.
function drawStackedBlocks(ctx, rows, { left, top, rowH, textColor, maxWidth }) {
  if (!rows.length) return
  ctx.textBaseline = 'alphabetic'
  let rowTop = top
  rows.forEach(({ valueLines, labelLines, motif }, i) => {
    const labelRows = Math.max(1, labelLines.length)
    const lines = valueLines?.length ? valueLines : ['']
    // `textRows` : sous-lignes de texte seules (libellé + valeur), AVANT le motif — c'est le
    // décompte d'avant cette tâche, conservé tel quel pour ne rien décaler côté texte. `motif`
    // ajoute sa PROPRE rangée fixe juste en dessous, jamais mélangée aux sous-lignes de texte.
    const textRows = labelRows + Math.max(0, lines.length - 1)
    const blockRows = textRows + (motif ? 1 : 0)
    if (labelLines.length) {
      ctx.font = STACK_LABEL_FONT
      ctx.fillStyle = textColor
      labelLines.forEach((line, j) => ctx.fillText(line, left, rowTop + STACK_LABEL_BASELINE_OFFSET + j * rowH))
    }
    ctx.font = STACK_VALUE_FONT
    ctx.fillStyle = textColor
    // La 1re sous-ligne de valeur partage la DERNIÈRE rangée du libellé (comportement inchangé
    // quand la valeur tient sur une seule ligne) — chaque sous-ligne SUPPLÉMENTAIRE occupe sa
    // propre rangée juste en dessous, jamais superposée.
    lines.forEach((line, k) => {
      const rowIndex = labelRows - 1 + k
      ctx.fillText(line, left, rowTop + (rowIndex + 1) * rowH - STACK_VALUE_BASELINE_INSET)
    })
    // Motif « mailles » (Task B, chantier « badge motif d'avancement » 20/09) : rangée FIXE
    // `rowH` (= `STACK_ROW_H`) juste sous le texte, centrée verticalement dans cette rangée
    // (`STITCH_MOTIF_HEIGHT` est largement plus petit que `rowH`). Sa hauteur réservée ne
    // dépend jamais du nombre de mailles dessinées (`stackedRowCount` compte déjà cette rangée
    // à hauteur fixe) — seule leur LARGEUR s'adapte à `maxWidth` au moment du dessin, ici et
    // nulle part ailleurs (`badge-stitch-motif.js`, commentaire de tête).
    if (motif) {
      const motifTop = rowTop + textRows * rowH
      const motifY = motifTop + (rowH - STITCH_MOTIF_HEIGHT) / 2
      drawStitchMotif(ctx, left, motifY, { technique: motif.technique, done: motif.done, total: motif.total, textColor, maxWidth })
    }
    // Task 13 : le gap ne s'applique que si la PROCHAINE paire démarre un nouveau groupe — les
    // deux phrases de `startedOn` (« Commencé le »/« Terminé le ») sont une seule donnée
    // logique, cf. `statLines`/`countGroups`.
    const nextStartsGroup = i === rows.length - 1 || rows[i + 1].groupStart !== false
    rowTop += blockRows * rowH + (i < rows.length - 1 && nextStartsGroup ? STACK_PAIR_GAP : 0)
  })
}

// Dessine le badge sur `canvas` (déjà créé par l'appelant, ex. document.createElement('canvas'))
// et renvoie sa data URL JPEG. `color` : chaîne `hsl(h s% l%)` choisie par l'utilisatrice
// (couleur RÉELLE du dégradé, cf. commentaire d'en-tête). `customText` : ligne libre
// optionnelle (étape Infos) — bloc À PART pleine largeur après les stats, pour les 4 gabarits
// depuis ce chantier (19/09 ; auparavant Vertical/Horizontal seulement, cf. `rawFreeTextLines`/
// `freeTextLines` plus bas). `locale` : locale i18n de l'app (défaut 'fr', rétrocompatible),
// pour ne pas figer les dates du badge en français quelle que soit la langue choisie.
// `includeTechnique` (revue finale de branche, 19/09 ; universel depuis ce chantier) : pilote
// la PASTILLE Technique — booléen plutôt qu'une chaîne technique déjà résolue : même forme que
// `includeCalendar` juste à côté dans cette signature, et la construction du libellé reste au
// seul endroit qui la connaît (`statValue`), jamais dupliquée chez l'appelant. Défaut `true`
// (et non `false` comme `includeCalendar`) : tout appel existant qui l'omet garde le
// comportement d'avant ce correctif.
export function renderBadge(canvas, { templateKey, color, photoRatio = 1, statKeys, stats, photoImg, photoImg2, project, t, generatedAt, locale = 'fr', customText, includeCalendar = false, includeTechnique = true, yarnUsage, vegan = false, unitSystem }) {
  const ctx = canvas.getContext('2d')

  // Technique (Task 2, chantier « badge cartouche condensé » 18/09c ; universel aux 4 gabarits
  // depuis le 19/09) : dessinée en pastille sur la rangée du titre (plus bas), jamais comme
  // ligne de stats — retirée ICI de la liste avant `buildRawStatLines`, pour qu'aucune trace
  // n'en reste dans `rawStatPairs` (hauteur de cartouche, retour à la ligne, etc.).
  const renderStatKeys = (statKeys || []).filter((k) => k !== 'technique')

  // Paires { label, value } (Task 3, généralisées aux 4 gabarits par ce chantier) : nécessaires
  // au dessin "bloc empilé" (`drawStackedBlocks`) ET seule source du décompte de repli utilisé
  // si `ctx` est absent (`geometryStatLineCount` plus bas), pour que le CANEVAS reste dimensionné
  // de façon prévisible même sans dessin réel — `statLines`/`buildRawStatLines` donnent
  // TOUJOURS le même nombre d'entrées, `structured` ou non (seule la FORME de chaque entrée en
  // dépend, jamais leur nombre) : nul besoin de construire séparément une version non structurée
  // rien que pour compter ses lignes, ce qui referait tout le travail de traduction/formatage en
  // double à chaque rendu. `customText` en est TOUJOURS exclu (Task 5, chantier « badge
  // cartouche condensé » 18/09c ; universel depuis le 19/09) : il ne doit plus y atterrir (c'est
  // désormais un bloc à part, cf. `rawFreeTextLines` plus bas). `buildRawStatLines` reste
  // INTOUCHÉE (contrainte du plan) : c'est l'APPELANT qui choisit de ne pas lui donner
  // `customText` ici, jamais une nouvelle branche interne à la fonction.
  const rawStatPairs = buildRawStatLines(renderStatKeys, { stats, t, locale, project, yarnUsage, structured: true, unitSystem })
  // Texte libre isolé (Task 5) : `buildRawStatLines([], ...)` réutilise TEL QUEL le mécanisme de
  // trim/espaces insécables de `customText` (aucune stat ne peut en sortir, `statKeys` vide) —
  // plutôt que de le dupliquer à la main ici, ce qui romprait l'invariant « un seul point de
  // construction » documenté sur `buildRawStatLines`. `[]` (jamais `['']`) si `customText` est
  // vide/absent : `rawFreeTextLines`/`freeTextLines` y restent alors des tableaux vides sans
  // incidence.
  const rawFreeTextLines = buildRawStatLines([], { customText })
  // Libellé de la pastille Technique, résolu UNE SEULE FOIS ici (revue finale de branche,
  // 19/09) — il est lu à DEUX endroits ensuite : la réserve de largeur (`requiredTextWidth`,
  // juste en dessous) et le dessin lui-même (plus bas, sur la rangée du titre). Deux
  // évaluations indépendantes de la même condition (`includeTechnique && technique`) finiraient
  // par diverger — c'est très exactement le genre d'écart mesure/dessin que ce fichier
  // documente partout ailleurs. Chaîne vide (jamais `null`) quand il n'y a rien à dessiner : un
  // seul test de vérité (`if (techniqueLabel)`) aux deux endroits.
  const techniqueLabel = includeTechnique ? statValue('technique', stats, t, locale, project) : ''
  let titleLines = [project?.name || '']
  let freeTextLines = rawFreeTextLines
  // Blocs empilés, libellés DÉJÀ répartis sur leurs sous-lignes (`wrapStackedLabels`) — calculés
  // ici, en phase de mesure, puis relus DEUX fois : pour le `statLineCount` transmis à la
  // géométrie (nombre de sous-lignes, jamais de paires) et pour le dessin lui-même. Reste `null`
  // sans contexte 2D (repli jsdom) : la géométrie retombe alors sur `rawStatPairs.length`,
  // exactement comme `BadgeComposer.vue#statLineCount` de son côté — les deux restent
  // synchronisés.
  let stackedRows = null
  // Largeur naturelle (SANS retour à la ligne) de la ligne la plus longue, mesurée aux polices
  // RÉELLEMENT utilisées — plancher de largeur pour Horizontal/Deux images UNIQUEMENT (retour
  // Julien, 17/09 soir), cf. `textColumnWidth`. Plafonnée : un texte libre pathologiquement
  // long (jusqu'à 80 caractères, cf. `maxlength` du champ dans BadgeComposer.vue) repasse alors
  // sur plusieurs lignes plutôt que de produire un canevas absurde. Reste à 0 (comportement
  // inchangé) si `ctx` est absent (repli jsdom, cf. commentaire plus bas).
  const REQUIRED_TEXT_WIDTH_CAP = 1800
  let requiredTextWidth = 0
  // `statsMaxWidth` (Task B, motif) : déclarée ICI (portée de toute la fonction), pas dans le
  // bloc `if (ctx)` plus bas où elle est calculée — `drawStackedBlocks`, plus loin, en a besoin
  // pour `maxWidth` (largeur de dessin du motif), hors de ce bloc. Reste à 0 sans contexte 2D
  // (repli jsdom) : `drawStackedBlocks` n'est de toute façon jamais atteint dans ce cas
  // (`if (!ctx) return null`, plus bas).
  let statsMaxWidth = 0
  if (ctx) {
    // Mesure/retour à la ligne AVANT de connaître la taille finale du canevas : `measureText`
    // ne dépend que de `ctx.font`, pas des dimensions du canvas (redimensionner `canvas.width`/
    // `height` plus bas RÉINITIALISE l'état du contexte, y compris `font` — c'est pour ça que
    // la police est reposée avant chaque groupe de `fillText` ci-dessous, comme avant ce
    // changement).
    ctx.font = 'bold 56px sans-serif'
    requiredTextWidth = ctx.measureText(project?.name || '').width
    // Pastille Technique (revue FINALE de branche, 19/09) : elle est dessinée SUR la rangée du
    // titre, ancrée après sa dernière ligne — sa largeur fait donc partie de ce que le titre
    // exige du cartouche, au même titre que le titre lui-même. Sans cette addition, dès que
    // `requiredTextWidth` devenait le facteur d'élargissement (titre long), `titleMaxWidth`
    // valait EXACTEMENT la largeur du titre et la pastille démarrait hors du canevas : perte de
    // donnée silencieuse et déterministe, mesurée à partir d'une trentaine de caractères en
    // métriques réelles. Empreinte comptée : largeur du texte MAJUSCULE réellement dessiné
    // (`drawTechniqueBadge` fait le `toUpperCase`), plus l'écart au titre (`BADGE_PILL_GAP`) et
    // les DEUX paddings horizontaux de la pastille — pas la largeur du trait de bordure
    // (1,5 px, négligeable devant TEXT_PAD, qui reste de toute façon après elle). Ajoutée à la
    // contribution du TITRE avant le `Math.max` avec les lignes de stats (et non après) : une
    // ligne de stats plus longue que « titre + pastille » suffit déjà, à elle seule, à loger la
    // pastille. Gardée par `techniqueLabel`, donc jamais réservée pour une pastille que la case
    // à cocher « Technique » supprime (cf. son commentaire plus haut).
    if (techniqueLabel) {
      ctx.font = BADGE_PILL_FONT
      requiredTextWidth += ctx.measureText(techniqueLabel.toUpperCase()).width + BADGE_PILL_GAP + BADGE_PILL_PAD_X * 2
    }
    // Mesure aux polices RÉELLEMENT dessinées par `drawStackedBlocks` (`STACK_VALUE_FONT`/
    // `STACK_LABEL_FONT`), sur les paires structurées plutôt que sur les lignes jointes — depuis
    // ce chantier (19/09), plus aucun gabarit ne dessine à `40px sans-serif` pour les stats.
    ctx.font = STACK_VALUE_FONT
    for (const { value } of rawStatPairs) requiredTextWidth = Math.max(requiredTextWidth, ctx.measureText(value).width)
    ctx.font = STACK_LABEL_FONT
    for (const { label } of rawStatPairs) {
      if (label) requiredTextWidth = Math.max(requiredTextWidth, ctx.measureText(label.toUpperCase()).width)
    }
    // Texte libre (Task 5) : mesuré ICI séparément (`rawStatPairs` ne le contient plus, cf. plus
    // haut) — sa largeur naturelle continue d'influer sur `requiredTextWidth` (élargissement du
    // cartouche si besoin), un comportement simplement DÉPLACÉ, pas retiré. Police `40px
    // sans-serif` conservée ici (aucun style de dessin réel ne s'applique au texte libre à ce
    // stade de la mesure, cf. `FREE_TEXT_FONT` plus bas pour le dessin réel).
    ctx.font = '40px sans-serif'
    for (const line of rawFreeTextLines) requiredTextWidth = Math.max(requiredTextWidth, ctx.measureText(line).width)
    requiredTextWidth = Math.min(requiredTextWidth + TEXT_PAD * 2, REQUIRED_TEXT_WIDTH_CAP)

    // Le titre est dessiné en pleine largeur du cartouche, MÊME quand la carte calendaire
    // partage la largeur avec les stats (mode `side`, retour Julien, 18/09) : seules les
    // stats cèdent leur moitié au calendrier, jamais le titre (cf. `statsAreaWithCalendar`,
    // qui décale désormais le calendrier sous le bloc titre plutôt qu'à côté de lui).
    const colW = textColumnWidth(templateKey, photoRatio, includeCalendar, requiredTextWidth)
    const titleMaxWidth = colW - TEXT_PAD * 2
    statsMaxWidth = textWidthForCalendar(colW, includeCalendar) - TEXT_PAD * 2
    ctx.font = 'bold 56px sans-serif'
    titleLines = wrapText(ctx, project?.name || '', titleMaxWidth)
    // Texte libre (Task 5) : wrappé à `titleMaxWidth` — largeur PLEINE du cartouche, comme le
    // titre juste au-dessus — JAMAIS `statsMaxWidth` : c'est tout l'objet de cette tâche (cf.
    // son commentaire de tête). Un texte plus large que la colonne stats (réduite par le
    // calendrier en mode `side`, ou étroite en mode empilé) ne doit pas se retrouver coupé mot
    // par mot à cette largeur alors qu'il tient en une seule ligne à la largeur pleine.
    ctx.font = '40px sans-serif'
    freeTextLines = rawFreeTextLines.flatMap((line) => wrapText(ctx, line, titleMaxWidth))
    // `statsMaxWidth` vaut exactement le `right - left`/`left` que `drawStackedBlocks` recevra
    // plus bas (`statsArea.w - TEXT_PAD * 2`, dans les trois modes de calendrier) : mesurer ici
    // et dessiner là-bas portent donc sur la MÊME largeur, condition pour que la hauteur
    // réservée corresponde au nombre de lignes réellement tracées.
    stackedRows = wrapStackedLabels(ctx, rawStatPairs, statsMaxWidth)
  }

  // `statLineCount`/`freeTextLineCount` transmis à la géométrie (Task 5) : le texte libre ne
  // compte plus dans le premier (il a sa propre réserve, `freeTextLines.length`, ajoutée APRÈS
  // le bloc stats+calendrier par `reserveFreeTextBlock`) — `rawStatPairs`/`freeTextLines` en
  // sont déjà expurgés/isolés l'un de l'autre plus haut, ce sont donc directement leurs
  // longueurs respectives (repli sans contexte 2D : le décompte NON wrappé, comme avant ce
  // chantier). Le compte transmis n'est, lui, jamais celui du retour à la ligne d'une chaîne
  // jointe : c'est le nombre de SOUS-LIGNES que `drawStackedBlocks` va réellement tracer —
  // libellés wrappés compris (`wrapStackedLabels`/`stackedRowCount`). Sans ça, la hauteur
  // réservée ignorait les lignes de libellé supplémentaires et les rangées débordaient sur la
  // ligne date/rowtine.app.
  const geometryStatLineCount = stackedRows ? stackedRowCount(stackedRows) : rawStatPairs.length
  // `pairCount` (Task 9, dernier argument) : nombre de GROUPES (jamais de paires ni de
  // sous-lignes, cf. `geometryStatLineCount` juste au-dessus — Task 13 : les deux phrases de
  // `startedOn` ne comptent que pour UN groupe, cf. `countGroups`).
  const { canvas: canvasSize, photoSlot, photoSlots, statsArea, calendarArea, textBottom, freeTextTop } = computeBadgeGeometry(templateKey, photoRatio, geometryStatLineCount, titleLines.length, includeCalendar, requiredTextWidth, freeTextLines.length, stackedRows ? countGroups(stackedRows) : countGroups(rawStatPairs), stats?.grid?.columns?.length || 0)
  const { w, h } = canvasSize
  // Le canevas est dimensionné ICI, AVANT le retour anticipé qui suit — comme avant ce
  // changement (17/09) — parce que jsdom (tests) ne fournit pas de contexte 2D natif : le
  // <canvas> de prévisu monté dans BadgeComposer.vue appelle quand même `renderBadge` à
  // chaque changement de réglage, et le composant lit `canvas.width`/`height` (positionnement
  // du bouton « Modifier », cf. `onPreviewClick`/`previewFixStyle`) même quand aucun dessin
  // n'a eu lieu. Sans contexte, `titleLines`/`rawStatPairs` restent le décompte NON wrappé
  // ci-dessus (repli ci-dessus) — qui correspond exactement à ce que
  // `BadgeComposer.vue#currentTemplate` calcule de son côté (même fonction, mêmes arguments,
  // `titleLineCount` omis = 1 par défaut) : les deux restent synchronisés tant qu'aucun retour
  // à la ligne réel n'est mesuré. En navigateur réel, `ctx` est toujours présent, ce repli ne
  // joue donc aucun rôle en production.
  canvas.width = w
  canvas.height = h
  // jsdom (tests) ne fournit pas de contexte 2D natif : sortie silencieuse plutôt qu'une
  // exception — les navigateurs réels ont toujours ce contexte.
  if (!ctx) return null
  const { h: hue, s, l } = parseHsl(color)
  // Deux arrêts de LA MÊME couleur (teinte + saturation conservées), juste plus clair en
  // haut et plus sombre en bas — donne l'effet dégradé sans jamais dénaturer la couleur
  // choisie (contrairement à l'ancien generatePalette, qui resynthétisait une paire
  // brand/brand-deep propre au thème de l'app à partir de la seule teinte).
  const topL = clamp(l + 12, 8, 92)
  const deepL = clamp(l - 18, 5, 90)

  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, hslCss(hue, s, topL))
  grad.addColorStop(1, hslCss(hue, s, deepL))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  if (photoSlot && photoImg) {
    drawPhotoCover(ctx, photoImg, photoSlot)
  } else if (photoSlots) {
    if (photoImg) drawPhotoCover(ctx, photoImg, photoSlots[0])
    if (photoImg2) drawPhotoCover(ctx, photoImg2, photoSlots[1])
  }

  // Cartouche : bandeau semi-transparent exactement à la taille de `statsArea` (bord à bord
  // sur son axe plein, cf. computeBadgeGeometry) — garantit un contraste constant quelle que
  // soit la couleur choisie, sans changer le dégradé lui-même. La couleur du TEXTE posé
  // dessus, elle, n'est plus fixe (cf. autoTextColor ci-dessous) : une couleur de fond très
  // claire laissait un texte blanc illisible malgré le bandeau à 50 % d'opacité.
  // Le bandeau couvre TOUJOURS le cartouche complet (texte + carte calendaire s'il y en a
  // une), même si `statsArea` ne couvre plus tout le cartouche seule, que ce soit en largeur
  // (mode `side`, elle ne décrit plus que sa moitié gauche) ou en hauteur relative à la carte
  // calendaire empilée (mode `stack`, elle grandit pour l'englober mais le TEXTE lui-même
  // s'arrête plus haut, cf. `textBottom`) — cf. `statsAreaWithCalendar`. Un bandeau qui
  // s'arrêterait avant la carte calendaire la laisserait sans fond, illisible sur le dégradé.
  const bandRect = calendarArea
    ? {
        x: Math.min(statsArea.x, calendarArea.x),
        y: Math.min(statsArea.y, calendarArea.y),
        w: Math.max(statsArea.x + statsArea.w, calendarArea.x + calendarArea.w) - Math.min(statsArea.x, calendarArea.x),
        h: Math.max(statsArea.y + statsArea.h, calendarArea.y + calendarArea.h) - Math.min(statsArea.y, calendarArea.y),
      }
    : statsArea
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(bandRect.x, bandRect.y, bandRect.w, bandRect.h)
  // Couleur composite RÉELLE du bandeau (noir 50 % par-dessus l'arrêt du dégradé à cette
  // hauteur) : interpolation linéaire entre l'arrêt haut et l'arrêt bas selon la position du
  // bandeau, puis assombrissement de moitié (alpha 0,5 sur fond noir = chaque canal ÷ 2).
  const bandT = clamp(bandRect.y / h, 0, 1)
  const bandBgL = topL + (deepL - topL) * bandT
  const textColor = autoTextColor(hslToRgb(hue, s, bandBgL).map((v) => v / 2))

  // Texte : décalé de TEXT_PAD à l'intérieur du cartouche sur les 4 côtés — le cartouche va
  // bord à bord, le texte lui garde une marge de lecture.
  const textX = statsArea.x + TEXT_PAD
  const textTop = statsArea.y + TEXT_PAD

  ctx.fillStyle = textColor
  ctx.textBaseline = 'alphabetic'
  ctx.font = 'bold 56px sans-serif'
  titleLines.forEach((line, i) => {
    ctx.fillText(line, textX, textTop + TITLE_BASELINE + i * LINE_HEIGHT)
  })

  // Mesure partagée de la dernière ligne du titre — icône vegan (ci-dessous) ET pastille
  // Technique (Task 2, juste après) s'y accolent toutes deux, `ctx.font` est encore posé sur
  // « bold 56px » (police du titre, réglée juste au-dessus) au moment de cette mesure.
  // `titleRowRightEdge` : curseur horizontal PARTAGÉ, avancé par chaque élément accolé au fur
  // et à mesure qu'il est dessiné (icône vegan PUIS pastille Technique) — un projet avec
  // couverture, une laine vegan ET une technique renseignée est un badge tout à fait ordinaire
  // (pas un cas d'angle) : sans ce curseur commun, les deux s'ancreraient indépendamment sur la
  // fin du titre et se chevaucheraient.
  const lastTitleLine = titleLines[titleLines.length - 1] || ''
  const lastTitleLineWidth = ctx.measureText(lastTitleLine).width
  const lastTitleBaseline = textTop + TITLE_BASELINE + (titleLines.length - 1) * LINE_HEIGHT
  let titleRowRightEdge = textX + lastTitleLineWidth

  if (vegan) {
    // Collée à la fin du nom du patron (retour Julien, 18/09), pas dans un coin fixe du
    // cartouche : ancrée sur sa ligne de base.
    const ICON_SIZE = 32
    const ICON_GAP = 10
    drawVeganIcon(ctx, titleRowRightEdge + ICON_GAP, lastTitleBaseline - ICON_SIZE * 0.8, ICON_SIZE, textColor)
    titleRowRightEdge += ICON_GAP + ICON_SIZE
  }

  // Pastille Technique (Task 2, chantier « badge cartouche condensé » 18/09c ; universelle aux
  // 4 gabarits depuis le 19/09, cf. `renderStatKeys` plus haut) — dessinée sur la rangée du
  // titre, juste après sa dernière ligne (ou après l'icône vegan si elle est présente, cf.
  // `titleRowRightEdge` ci-dessus). `techniqueLabel` : résolu tout en haut de cette fonction
  // (case à cocher « Technique » + valeur présente), le MÊME que celui dont `requiredTextWidth`
  // a réservé la largeur — jamais un second `statValue` ici, qui pourrait dire autre chose que
  // la réserve (cf. son commentaire).
  if (techniqueLabel) {
    // Sommet du titre (56px gras) - même sommet visé pour le haut de la pastille (retour
    // Julien, 19/09). `drawTechniqueBadge` prend une baseline de TEXTE, pas un coin de boîte
    // (cf. son commentaire) : on résout donc l'ordonnée qui, une fois son propre ascendant +
    // padding retirés, retombe exactement sur ce sommet.
    const titleCapTop = lastTitleBaseline - 56 * TITLE_CAP_HEIGHT_RATIO
    const pillAscent = BADGE_PILL_FONT_SIZE * 0.8
    const pillY = titleCapTop + pillAscent + BADGE_PILL_PAD_Y
    drawTechniqueBadge(ctx, titleRowRightEdge + BADGE_PILL_GAP + BADGE_PILL_PAD_X, pillY, techniqueLabel, textColor)
  }

  // `computeBadgeGeometry` réserve, pour les 4 gabarits, une rangée de hauteur FIXE et plus
  // petite (`STACK_ROW_H`) par stat plutôt que l'ancienne `LINE_HEIGHT` (64px) — UNIQUE chemin
  // de dessin depuis ce chantier (19/09) : plus de distinction par gabarit, `stackedRows` (déjà
  // wrappé en phase de mesure) est passé TEL QUEL à `drawStackedBlocks`.
  drawStackedBlocks(ctx, stackedRows || [], {
    left: textX,
    top: textTop + condensedTitleRowHeight(titleLines.length),
    rowH: STACK_ROW_H,
    textColor,
    maxWidth: statsMaxWidth,
  })

  // Texte libre (Task 5, chantier « badge cartouche condensé » 18/09c ; universel aux 4
  // gabarits depuis le 19/09). Bloc À PART, dessiné APRÈS le bloc stats+calendrier et AVANT la
  // ligne date/rowtine.app, en x = `textX` (bord gauche du CARTOUCHE, pas de la colonne stats —
  // c'est la même abscisse que le titre, jamais `statsArea.x + statsArea.w` : la largeur
  // pleine, pas la colonne réduite). `freeTextTop` (posé par `reserveFreeTextBlock`,
  // `computeBadgeGeometry`) est `null` quand `freeTextLines` est vide, d'où la garde explicite
  // plutôt qu'un simple `.forEach` sur un tableau vide (qui suffirait à ne rien dessiner, mais
  // `freeTextTop` resterait alors inutilisé, jamais lu).
  if (freeTextLines.length && freeTextTop != null) {
    ctx.font = FREE_TEXT_FONT
    ctx.fillStyle = textColor
    freeTextLines.forEach((line, i) => {
      ctx.fillText(line, textX, freeTextTop + FREE_TEXT_GAP + FREE_TEXT_BASELINE_OFFSET + i * FREE_TEXT_LINE_H)
    })
  }

  ctx.font = '28px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(formatBadgeDate(generatedAt, locale), textX, textBottom - TEXT_PAD)
  // "rowtine.app" : jamais traduit (nom de domaine, pas un libellé), toujours dessiné, aligné
  // à droite sur la même ligne que la date — réutilise le bandeau semi-transparent déjà là,
  // pas de nouveau cartouche. Ancré sur `bandRect`, jamais `statsArea` : ce dernier ne
  // décrit plus que la colonne de texte depuis le partage avec la carte calendaire (mode
  // `side`), `bandRect` seul atteint le vrai coin bas-droit de la carte complète.
  ctx.textAlign = 'right'
  ctx.fillText('rowtine.app', bandRect.x + bandRect.w - TEXT_PAD, textBottom - TEXT_PAD)

  // Retour Julien (19/09, capture d'écran) : « le calendrier dépasse sur la zone photo au lieu
  // d'être aligné avec le reste du texte ». Pas un chevauchement de rectangles (`calendarArea`
  // reste toujours structurellement sous `photoSlot`, cf. `statsAreaWithCalendar`) mais un
  // défaut de MARGE : `calendarArea` va bord à bord jusqu'au bord droit du canevas (cartouche
  // pleine largeur, revue « cartouche pleine largeur/hauteur », 16/09 — nécessaire pour que le
  // bandeau semi-transparent et `rowtine.app`, ancrés sur ce même rectangle, restent corrects,
  // cf. leurs tests dédiés), alors que TOUT ce qui se dessine à l'intérieur du cartouche respecte
  // par ailleurs une marge `TEXT_PAD` (titre, valeurs de stats, date, « rowtine.app ») — sauf le
  // calendrier, dont le seul retrait interne est `PAD` (badge-calendar.js, 16px, pensé pour
  // séparer la grille de SA PROPRE zone, pas du bord du canevas). Dès qu'il y a assez de
  // semaines pour remplir toute la largeur disponible (`maxCols` non limitant), la grille vient
  // alors buter à 16-20px du bord réel de l'image, très en deçà des 60px (`TEXT_PAD`) ou 90px
  // (`MARGIN`, marge de la photo) de tout le reste du badge — mesuré dans le rapport de cette
  // tâche (banc `renderBadge` avec un historique de 60 semaines). On ne réduit PAS
  // `calendarArea` lui-même (ni `computeBadgeGeometry`) : seule la zone TRANSMISE à
  // `drawCalendar` perd `TEXT_PAD` sur sa largeur, pour que son propre `PAD` interne s'applique
  // ensuite à une marge cohérente avec le reste du cartouche.
  //
  // Retenue UNIQUEMENT en mode `side` (calendrier à côté des stats — celui du gabarit Vertical,
  // objet de ce retour) : en mode `stack` (calendrier empilé pleine largeur SOUS les stats,
  // `calendarArea.x === statsArea.x`), le bord GAUCHE du calendrier partage déjà l'ancrage du
  // texte (`statsArea.x`) mais garde lui aussi un simple `PAD` (16px) au lieu de `TEXT_PAD` —
  // une marge trop courte, mais SYMÉTRIQUE des deux côtés. Y appliquer cette même retenue
  // seulement à droite créerait un calendrier visiblement décentré (16px à gauche, 76px à
  // droite) : un défaut différent, plus visible, pas demandé par ce retour. `calendarArea.x >
  // statsArea.x` distingue les deux modes sans nouveau champ à faire remonter par
  // `computeBadgeGeometry` (vrai en mode `side`, où le calendrier démarre après la colonne de
  // texte + `CALENDAR_GAP` ; faux en mode `stack`, où les deux partagent le même `x`).
  if (calendarArea && stats?.grid?.columns?.length) {
    const sideMode = calendarArea.x > statsArea.x
    const calendarDrawArea = sideMode ? { ...calendarArea, w: calendarArea.w - TEXT_PAD } : calendarArea
    drawCalendar(ctx, calendarDrawArea, stats.grid.columns, hue, s, textColor, locale, {
      less: t('stats.heatmap.less', {}, { locale }),
      more: t('stats.heatmap.more', {}, { locale }),
    })
  }

  return canvas.toDataURL('image/jpeg', 0.9)
}

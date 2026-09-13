// Lecteur de patron interactif — fonctions pures (rendu des chiffres multi-tailles,
// tokenisation des lignes pour les abréviations, validation des données `reader`).
// Aucune dépendance Vue/DOM ici : tout est testable unitairement.
import { sectionKind } from './section-kinds'

// Notation multi-taille brute : [104,108,108,112,116,120] → "104 (108) 108 (112) 116 (120)".
export function formatSizes(vals) {
  return (vals || []).map((v, i) => (i % 2 === 1 ? `(${v})` : `${v}`)).join(' ')
}

// Valeur d'un tableau de counts pour une taille (index), ou null si pas de taille choisie.
export function pickCount(vals, sizeIndex) {
  if (sizeIndex == null) return null
  return vals?.[sizeIndex] ?? null
}

// Découpe une ligne de patron en jetons pour un rendu sûr (pas de v-html) :
//  - `{{i}}`         → { type:'count', values:[...] }   (chiffre multi-taille)
//  - mot du dico     → { type:'abbr', key, text }        (abréviation avec tooltip)
//  - reste           → { type:'text', text }
// `abbrKeys` est la liste des clés d'abréviation (triée en interne du + long au + court).
// Un vecteur de comptes est « vide » (à ne pas afficher) s'il est absent, vide,
// ou entièrement composé de zéros/valeurs vides — artefact d'import (placeholder
// {{i}} sans vraie valeur par taille, comblé par des zéros). Un vecteur qui
// contient au moins une vraie valeur (même avec des zéros) reste affiché.
export function isBlankCount(values) {
  if (!Array.isArray(values) || values.length === 0) return true
  return values.every((v) => v == null || v === '' || v === 0 || v === '0')
}

// Ajuste le vecteur de valeurs d'une RANGÉE du tableau des tailles à `n` colonnes, sans
// jamais perdre une cellule saisie (règle cardinale du projet) ni en inventer une
// (grammaire de non-invention) :
//   - rangée trop COURTE : complétée par des cases VIDES — une case vide ne fabrique
//     aucune donnée, l'utilisatrice voit qu'il manque une valeur et la saisit ;
//   - rangée trop LONGUE : le surplus est REPLIÉ dans la dernière colonne (jamais
//     tronqué), même geste que `splitAbbr` (selection-to-reference.js) sur une entrée de
//     glossaire à plus de deux cellules. La rangée fait alors exactement `n` valeurs :
//     elle se relit sans `sizes.countMismatch` au prochain passage du parseur, et le
//     texte en trop reste visible dans sa cellule au lieu de disparaître.
// Largeur minimale de 1 : à n = 0 (aucune taille connue), une rangée garde quand même sa
// colonne de valeurs — sinon tout ce qui suit le label serait jeté.
export function fitSizeRowValues(values, n) {
  const src = Array.isArray(values) ? [...values] : []
  const width = Math.max(Number(n) || 0, 1)
  if (src.length === width) return src
  if (src.length < width) return [...src, ...Array(width - src.length).fill('')]
  const folded = src
    .slice(width - 1)
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return [...src.slice(0, width - 1), folded]
}

export function tokenizeLine(text, counts = [], abbrKeys = []) {
  const src = String(text ?? '')
  // 1) éclater sur les placeholders {{i}} en gardant l'index ;
  //    on ignore les vecteurs vides/tout-zéro (placeholder orphelin d'import).
  const parts = []
  const phRe = /\{\{(\d+)\}\}/g
  let last = 0
  let m
  while ((m = phRe.exec(src))) {
    if (m.index > last) parts.push({ text: src.slice(last, m.index) })
    const values = counts[Number(m[1])] || []
    if (!isBlankCount(values)) parts.push({ count: values })
    last = m.index + m[0].length
  }
  if (last < src.length) parts.push({ text: src.slice(last) })

  if (!abbrKeys.length) {
    return parts.map((p) => (p.count ? { type: 'count', values: p.count } : { type: 'text', text: p.text }))
  }

  // 2) dans les morceaux de texte, repérer les abréviations (une seule regex, + long d'abord).
  // `abbrKeys` reste la même référence tant que le glossaire du patron ne change pas (computed
  // Vue stable) : mise en cache par référence pour éviter de retrier/rééchapper/recompiler la
  // regex à chaque rang affiché (le glossaire, lui, ne varie pas d'un rang à l'autre).
  const abbrRe = buildAbbrRegex(abbrKeys)
  const tokens = []
  for (const p of parts) {
    if (p.count) {
      tokens.push({ type: 'count', values: p.count })
      continue
    }
    let idx = 0
    let mm
    abbrRe.lastIndex = 0
    while ((mm = abbrRe.exec(p.text))) {
      if (mm.index > idx) tokens.push({ type: 'text', text: p.text.slice(idx, mm.index) })
      tokens.push({ type: 'abbr', key: mm[1], text: mm[1] })
      idx = mm.index + mm[0].length
    }
    if (idx < p.text.length) tokens.push({ type: 'text', text: p.text.slice(idx) })
  }
  return tokens
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const abbrRegexCache = new WeakMap()

// Motif qui n'accepte JAMAIS rien (`(?!)` = lookahead négatif toujours vrai) : la valeur de
// repli quand il ne reste aucune clé exploitable. Cf. la garde ci-dessous.
const NEVER_RE = () => new RegExp('(?!)', 'g')

function buildAbbrRegex(abbrKeys) {
  const cached = abbrRegexCache.get(abbrKeys)
  if (cached) return cached
  // Clés VIDES écartées AVANT l'alternation, et alternation vide écartée après. Une clé `''`
  // produit une alternative de longueur nulle : `exec` matche alors à la position courante
  // sans consommer un seul caractère, `lastIndex` ne progresse pas, et la boucle
  // `while ((mm = abbrRe.exec(...)))` de `tokenizeLine` empile des jetons jusqu'à épuiser la
  // mémoire — gel complet, reproduit sous Node. Une fois les clés vides retirées, la liste
  // peut se retrouver VIDE : `keys.join('|')` vaudrait `''` et rendrait `(?<!…)()(?!…)`,
  // exactement la même alternative de longueur nulle par un autre chemin — d'où le repli
  // explicite plutôt qu'une regex construite.
  //
  // Corrigé ICI, à la construction, et non chez l'appelant : le chemin `.md` filtrait déjà
  // ses clés (reader-reference.js), mais PAS la restauration de sauvegarde, qui rejoue une
  // donnée écrite par une version antérieure. Une garde par appelant, c'est un appelant
  // oublié ; la source les couvre tous, y compris ceux à venir.
  const keys = [...abbrKeys]
    .map((k) => String(k ?? ''))
    .filter((k) => k !== '')
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
  const re = keys.length
    ? new RegExp(`(?<![\\wàâäéèêëîïôöûüç-])(${keys.join('|')})(?![\\wàâäéèêëîïôöûüç-])`, 'g')
    : NEVER_RE()
  abbrRegexCache.set(abbrKeys, re)
  return re
}

// Sens de lecture d'un diagramme. Depuis le 30/07, les patrons de l'application portent un
// CODE ('rtl'/'ltr') traduit ici ; les patrons importés avant portent une phrase toute
// faite dans leur langue d'origine, qu'on laisse passer telle quelle — mieux vaut une
// phrase française sur un écran allemand qu'un « rtl » brut, et rien n'est perdu.
const READ_DIR_CODES = new Set(['rtl', 'ltr'])

export function readDirLabel(readDir, t) {
  if (!readDir) return ''
  if (READ_DIR_CODES.has(readDir)) return t(`reader.chart.readDir.${readDir}`)
  return readDir
}

// Libellé du motif d'un diagramme (revue finale du chantier multilingue, 31/07). Même
// principe que readDirLabel ci-dessus, en miroir : `chart.repeat` est une PHRASE toute
// faite (traduite pour les exemples livrés, dans la langue d'origine pour un patron
// importé) — on l'affiche VERBATIM sans jamais y toucher, elle ne doit ni se perdre ni
// s'écraser. Mais `chart.repeat` ne survit PAS à un aller-retour par le format
// Rowtine-MD (parse.js ne le fabrique plus du tout, cf. commentaire là-bas) : `cols`/
// `rows`, eux, survivent toujours fidèlement. Quand `repeat` est absent, on reconstruit
// donc un libellé équivalent à partir de cols/rows, traduit dans la langue COURANTE de
// l'écran (jamais fabriqué en français en dur dans le moteur).
export function chartMotifLabel(chart, t) {
  if (chart?.repeat) return chart.repeat
  const cols = Number(chart?.cols)
  const rows = Number(chart?.rows)
  if (cols > 0 && rows > 0) return t('reader.chart.motifDefault', { cols, rows })
  return ''
}

// Total d'une répétition pour une taille (fallback index 0 tant qu'aucune taille n'est choisie).
export function repeatTotal(repeat, sizeIndex) {
  if (!repeat) return 0
  return Number(repeat.total?.[sizeIndex ?? 0]) || 0
}

// Transition rang/répétition d'un diagramme (source unique inline + plein écran).
// Dépassement du dernier rang : roll-over vers la répétition suivante (borné à reps) ;
// sinon rang borné [1, rows], répétition inchangée.
export function nextChartPosition(chart, row, rep, delta) {
  const rows = Math.max(1, Number(chart?.rows) || 1)
  const reps = Number(chart?.reps) || 0
  const target = (Number(row) || 1) + (Number(delta) || 0)
  if (target > rows) {
    if (reps && rep < reps) return { row: 1, rep: rep + 1 }
    return { row: rows, rep }
  }
  return { row: Math.max(1, Math.min(rows, target)), rep }
}

// Position du surlignage d'un rang de diagramme (rang 1 = bas). Renvoie des % CSS.
// current 1..rows ; done = rangs déjà faits (en dessous). `frame` (optionnel) = zone
// verticale du quadrillage dans l'image, { top, bottom } en % (calage poignées) —
// absent/invalide = plein cadre (0–100), bit-identique à l'historique.
export function chartBands(current, rows, frame) {
  const T = Math.max(1, rows || 1)
  const r = Math.max(1, Math.min(T, current || 1))
  const top = Number.isFinite(frame?.top) ? frame.top : 0
  const bottom = Number.isFinite(frame?.bottom) ? frame.bottom : 100
  const span = bottom - top
  return {
    hlTop: top + ((T - r) / T) * span,
    hlHeight: (1 / T) * span,
    doneTop: top + ((T - (r - 1)) / T) * span,
    doneHeight: ((r - 1) / T) * span,
  }
}

// Position d'un tour de diagramme radial (motif en tours concentriques, ex. granny square).
// Forme ('circle'|'square') d'une limite (r0 ou r1) : celle posée dans le frame si valide,
// sinon dérivée de `chartShape` ('radial-square' → 'square', tout le reste, y compris
// absent → 'circle') — repli qui rend un calage déjà enregistré AVANT ce champ (ancien
// calage à 3 poignées) bit-identique à son rendu d'hier, sans migration de données.
function shapeFallback(shape, chartShape) {
  if (shape === 'circle' || shape === 'square') return shape
  return chartShape === 'radial-square' ? 'square' : 'circle'
}

// current 1..rows ; frame = { cx, cy, r0, r1 } en % de l'image (repli sur un anneau plein-cadre
// par défaut si absente/invalide, même contrat que chartBands). Renvoie le centre et les rayons
// (à mi-épaisseur, pour un rendu SVG en anneau — stroke épais, fill:none) du tour courant (hl)
// et de tout ce qui est déjà fait (done, un seul anneau englobant tous les tours précédents).
export function chartRings(current, rows, frame, chartShape) {
  const T = Math.max(1, rows || 1)
  const r = Math.max(1, Math.min(T, current || 1))
  const cx = Number.isFinite(frame?.cx) ? frame.cx : 50
  const cy = Number.isFinite(frame?.cy) ? frame.cy : 50
  const r0 = Number.isFinite(frame?.r0) ? frame.r0 : 0
  const r1 = Number.isFinite(frame?.r1) ? frame.r1 : 50
  const span = r1 - r0
  const hlOuter = r0 + (r / T) * span
  const hlInner = r0 + ((r - 1) / T) * span
  const r0Shape = shapeFallback(frame?.r0Shape, chartShape)
  const r1Shape = shapeFallback(frame?.r1Shape, chartShape)
  const switchRound = Number.isFinite(frame?.switchRound) ? frame.switchRound : null
  // Bascule nette (pas de fondu) : tout rang avant switchRound reste en r0Shape, celui-là
  // et les suivants passent en r1Shape. Sans switchRound (formes identiques ou calage
  // ancien), r0Shape s'applique partout — cohérent puisque r0Shape===r1Shape dans ce cas.
  const shapeForRound = (round) => (switchRound && round >= switchRound ? r1Shape : r0Shape)
  return {
    cx,
    cy,
    hlR: (hlInner + hlOuter) / 2,
    hlStrokeWidth: hlOuter - hlInner,
    doneR: (r0 + hlInner) / 2,
    doneStrokeWidth: hlInner - r0,
    hasDone: r > 1,
    hlShape: shapeForRound(r),
    doneShape: shapeForRound(Math.max(1, r - 1)),
  }
}

// Point de référence utilisé UNE SEULE FOIS pour décider quel côté d'un tracé est "vers
// l'extérieur" (voir offsetPath ci-dessous). Aucune étape de calage ne l'expose à
// l'utilisatrice — c'est un centre géométrique fixe, pas un réglage. Généralisation du point
// choisi dans la maquette validée (`Path.dc.html`, CHART_REF = {x:55,y:46}, déjà proche du
// centre) : le centre exact de l'image marche pour tout diagramme, sans calibration en plus.
const IMAGE_CENTER_REF = { x: 50, y: 50 }
const MITER_LIMIT = 2.2

function normalizeVec(x, y) {
  const len = Math.hypot(x, y) || 1
  return { x: x / len, y: y / len }
}

// Décide UNE FOIS, sur l'ensemble du tracé, quel signe de décalage perpendiculaire s'éloigne de
// `ref`. Recalculer ce signe par segment (une 1re approche l'a fait) se retourne près d'un coude
// marqué et produit une pointe qui s'échappe du tracé — un signe unique, décidé sur l'ensemble
// du tracé, ne se retourne jamais en cours de route.
function globalOutwardSign(points, ref) {
  let sx = 0
  let sy = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const t = normalizeVec(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
    sx += -t.y
    sy += t.x
  }
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length
  const my = points.reduce((s, p) => s + p.y, 0) / points.length
  const dOut = Math.hypot(mx + sx - ref.x, my + sy - ref.y)
  const dOrig = Math.hypot(mx - ref.x, my - ref.y)
  return dOut > dOrig ? 1 : -1
}

function segOffset(p1, p2, dist, sign) {
  const t = normalizeVec(p2.x - p1.x, p2.y - p1.y)
  const nx = -t.y * sign
  const ny = t.x * sign
  return [{ x: p1.x + nx * dist, y: p1.y + ny * dist }, { x: p2.x + nx * dist, y: p2.y + ny * dist }]
}

function lineIntersect(a1, a2, b1, b2) {
  const denom = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x)
  if (Math.abs(denom) < 1e-6) return null
  const c1 = a1.x * a2.y - a1.y * a2.x
  const c2 = b1.x * b2.y - b1.y * b2.x
  return {
    x: (c1 * (b1.x - b2.x) - (a1.x - a2.x) * c2) / denom,
    y: (c1 * (b1.y - b2.y) - (a1.y - a2.y) * c2) / denom,
  }
}

// Décale une polyligne vers l'extérieur d'une distance donnée (% de l'image) : chaque SEGMENT
// est décalé indépendamment (signe unique, cf. globalOutwardSign), puis les segments voisins
// sont ré-intersectés pour retrouver un coin net (comme un contour de trait dans un logiciel
// vectoriel) — repli en biseau si l'intersection s'emballe (coin très marqué), plutôt qu'une
// pointe qui s'échappe de l'image. Sert à générer les rangs 2..N d'un calage par tracé à partir
// du rang 1 posé par l'utilisatrice (voir chartPathRows).
export function offsetPath(points, dist) {
  if (!dist || !points || points.length < 2) return (points || []).map((p) => ({ x: p.x, y: p.y }))
  const sign = globalOutwardSign(points, IMAGE_CENTER_REF)
  const segs = []
  for (let i = 0; i < points.length - 1; i += 1) segs.push(segOffset(points[i], points[i + 1], dist, sign))
  const out = [segs[0][0]]
  for (let i = 0; i < segs.length - 1; i += 1) {
    const [a1, a2] = segs[i]
    const [b1, b2] = segs[i + 1]
    const origVertex = points[i + 1]
    const inter = lineIntersect(a1, a2, b1, b2)
    const bevel = { x: (a2.x + b1.x) / 2, y: (a2.y + b1.y) / 2 }
    if (!inter) {
      out.push(bevel)
    } else {
      const d = Math.hypot(inter.x - origVertex.x, inter.y - origVertex.y)
      out.push(d <= dist * MITER_LIMIT ? inter : bevel)
    }
  }
  out.push(segs[segs.length - 1][1])
  return out
}

// Espacement par défaut entre rangs générés (% de l'image) — valeur validée dans la maquette
// de conception interactive (réglage par défaut proposé, jamais changé pendant les tests
// utilisatrice). Utilisé quand `spacing` est absent/invalide plutôt que de propager un NaN
// silencieux (qui ferait retomber chaque rang généré sur une copie exacte du rang 1).
export const DEFAULT_PATH_SPACING = 4.5

// Tous les rangs d'un calage par tracé (bordure/edging) : le rang 1 est le tracé posé par
// l'utilisatrice (`points`, en % de l'image) ; chaque rang suivant est ce même tracé décalé
// un peu plus loin vers l'extérieur, à un espacement réglable (`spacing`, % de l'image).
// Plafond de rangs d'un calage par TRACÉ. Les deux autres formes (radial, linéaire) se
// dessinent en temps constant ; le tracé, lui, fabrique un chemin décalé PAR RANG. Un
// `rows` de 999 999 999 — que rien n'empêchait d'écrire dans un `.md` (« 8 m × 999999999
// rangs · forme tracé ») ni de restaurer depuis une sauvegarde — alloue un milliard de
// chemins et fige le rendu. Le plafond vit ICI, au plus près de la boucle, et pas seulement
// au parsing : la restauration de sauvegarde ne passe pas par le parseur MD.
// 2 000 rangs, c'est déjà bien au-delà de ce qu'une bordure reste lisible à l'écran.
export const CHART_PATH_MAX_ROWS = 2000

export function chartPathRows(points, rows, spacing) {
  const T = Math.min(CHART_PATH_MAX_ROWS, Math.max(1, rows || 1))
  const s = Number.isFinite(spacing) ? spacing : DEFAULT_PATH_SPACING
  const list = []
  for (let k = 0; k < T; k += 1) list.push(offsetPath(points, s * k))
  return list
}

// Rideau de progression horizontale (repère de position dans le rang, plein écran) :
// { x, side }. `x` = position du bord en % de la LARGEUR de l'image — jumeau horizontal de
// `frame` (qui est en % de hauteur). `side` = quel côté de `x` est teinté « déjà fait ».
// Absent (null/undefined) = jamais posé sur cette grille pour ce projet, traité comme
// rétracté côté droit par défaut (sens de lecture le plus courant en tricot), librement
// inversé par la bascule dès le premier rang.
function retractedCurtainX(side) {
  return side === 'left' ? 0 : 100
}

export function curtainBand(curtain) {
  const side = curtain?.side === 'left' ? 'left' : 'right'
  const rawX = Number(curtain?.x)
  const x = Number.isFinite(rawX) ? Math.max(0, Math.min(100, rawX)) : retractedCurtainX(side)
  return side === 'left' ? { left: 0, width: x } : { left: x, width: 100 - x }
}

export function retractCurtain(curtain) {
  const side = curtain?.side === 'left' ? 'left' : 'right'
  return { x: retractedCurtainX(side), side }
}

export function flipCurtainSide(curtain) {
  const side = curtain?.side === 'left' ? 'right' : 'left'
  return { x: retractedCurtainX(side), side }
}

// Un item de section est-il un rang/action cochable ? (ni note, ni diagramme)
export function isCheckable(step) {
  return !!step && !step.note && !step.chart
}

// Cible de défilement à l'ouverture du lecteur (#9) : une section explicite dans l'URL
// (clic depuis l'onglet Sections de la fiche projet, `?section=<id>`) PRIME sur la reprise
// au rang en cours. Fonction pure (aucun DOM ici — l'appelant fait le scrollIntoView) :
// renvoie l'id DOM cible (`rsec-<id>` ou `rstep-<id>`), ou `null` si aucune cible n'est
// déterminable (pas de query.section ET pas de rang courant, ex. patron déjà entièrement fait).
export function scrollTargetId(query, currentStepId) {
  const sec = query?.section
  if (sec != null && sec !== '') return 'rsec-' + sec
  return currentStepId != null ? 'rstep-' + currentStepId : null
}

// Progression du lecteur à partir d'un `readerState` de projet ({ size, done, counters }).
// Renvoie { sections:[{id,icon,title,done,total,complete}], done, total, pct } — pour l'aperçu
// de l'onglet Sections d'un projet, sans monter le lecteur.
export function readerProgress(reader, state = {}) {
  const size = typeof state?.size === 'number' ? state.size : null
  const done = state?.done || {}
  const counters = state?.counters || {}
  const stepDone = (s) => {
    if (s.repeat) {
      const tot = repeatTotal(s, size)
      return tot === 0 ? true : (counters[s.id] || 0) >= tot
    }
    return !!done[s.id]
  }
  const sections = (reader?.sections || []).map((sec) => {
    const countable = sec.steps.map((s, i) => ({ ...s, id: `${sec.id}#${i}` })).filter(isCheckable)
    const doneN = countable.filter(stepDone).length
    return {
      id: sec.id,
      kind: sectionKind(sec),
      title: sec.title,
      done: doneN,
      total: countable.length,
      pct: countable.length ? Math.round((doneN / countable.length) * 100) : 0,
      complete: countable.length > 0 && doneN === countable.length,
    }
  })
  const total = sections.reduce((a, s) => a + s.total, 0)
  const doneTotal = sections.reduce((a, s) => a + s.done, 0)
  return { sections, done: doneTotal, total, pct: total ? Math.round((doneTotal / total) * 100) : 0 }
}

// Validation légère d'un objet `reader` (test de non-régression sur les patrons seed).
// Modèle « plat » : chaque item de section est ROW / NOTE / REP / CHART. Renvoie les erreurs.
//
// ⚠️ Les phrases poussées ci-dessous sont des DIAGNOSTICS TECHNIQUES en français en dur, non
// traduits et NON destinés à une tricoteuse (« count[0] ≠ 3 tailles », etc.) — pas des
// avertissements du catalogue `warning-codes.js`. Elles ne doivent JAMAIS atteindre l'écran.
// Ce tableau est nommément renommé `warnings` par `assemble.js` (import PDF) et remonte
// jusqu'à `PatternView.vue` : s'il n'est pas vide, il s'affiche tel quel, quelle que soit la
// langue de l'application. La garantie qu'il reste TOUJOURS vide sur le chemin de production
// vient en amont, de la normalisation — jamais de ce fichier lui-même (qui reste zéro-
// dépendance i18n, importable sous Node nu par les bancs `tools/mdlab/*.mjs`) :
//   - `normalizeReaderForSave` (reader-edit.js) appelle `compactStepCounts` (renumérote les
//     placeholders {{i}} en 0..k-1 sans trou et ne garde qu'une colonne `c` par placeholder
//     référencé) puis `resizeStepCounts` (complète chaque `c[j]`/`repeat.total` à la longueur
//     de `sizeLabels`) — cela rend structurellement impossibles les 4 dernières erreurs.
//   - `assemble.js` (import PDF, ligne ~270) garantit `sizeLabels` toujours non vide (repli
//     `['Taille unique']`) — ce qui rend impossible la 1re erreur (« sizeLabels vide »).
// Invariant verrouillé par un test dans `tests/unit/reader.spec.js` : sur un reader normalisé
// via la vraie `normalizeReaderForSave`, `validateReader` renvoie toujours `[]`.
export function validateReader(reader) {
  const errors = []
  if (!reader) return ['reader manquant']
  const n = reader.sizeLabels?.length || 0
  if (!n) errors.push('sizeLabels vide')
  reader.sections?.forEach((sec) => {
    sec.steps?.forEach((st, i) => {
      const where = `${sec.id}#${i}`
      if (st.chart) return
      const phs = [...String(st.t || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))
      const nc = (st.c || []).length
      ;(st.c || []).forEach((arr, j) => {
        if (!Array.isArray(arr) || arr.length !== n) errors.push(`${where}: count[${j}] ≠ ${n} tailles`)
      })
      const maxPh = phs.length ? Math.max(...phs) : -1
      if (maxPh >= nc) errors.push(`${where}: placeholder {{${maxPh}}} sans count`)
      for (let j = 0; j < nc; j++) if (!phs.includes(j)) errors.push(`${where}: count[${j}] inutilisé`)
      if (st.repeat && (!Array.isArray(st.total) || st.total.length !== n)) {
        errors.push(`${where}: repeat.total ≠ ${n} tailles`)
      }
    })
  })
  return errors
}

// --- Adaptateur patron → reader (unification Lot A) ---------------------------
// Un patron « classique » (sections[] texte) est transformé en reader SIMPLE :
// pas de multi-tailles (impossible à déduire du texte), chaque ligne = une étape ROW.

// Slug kebab ascii pour les id de section (retire les diacritiques et la ponctuation).
export function slug(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Prédicat unique « ce patron est en taille unique » — unifie cinq comparaisons qui
// vivaient chacune dans leur coin (quatre en `=== 'Taille unique'` strict, une en regex
// insensible à la casse). N'écrit RIEN dans la donnée : 'Taille unique' reste la chaîne
// produite par les deux seuls producteurs (assemble.js, pdf-import/index.js) et lue en
// front-matter `sizes:` — sujet reporté (front-matter multilingue), pas celui-ci.
// ASSOUPLISSEMENT ASSUMÉ : contrairement à l'ancien `===` strict, ce prédicat est
// insensible à la casse et aux espaces autour ('taille unique', ' Taille unique ' →
// true). Les producteurs n'écrivent jamais ces variantes ; elles ne peuvent venir que
// d'un patron.md modifié à la main, cas où cet assouplissement fait MIEUX que l'ancien
// comportement strict (qui aurait traité la variante comme une vraie taille nommée).
// AUTRE resserrement (safe) : trois des quatre sites unifiés ne vérifiaient QUE
// `sizeLabels[0] === 'Taille unique'`, sans condition sur la longueur du tableau — un
// hypothétique `['Taille unique', 'S']` (deux libellés, jamais produit par les deux
// producteurs actuels, mais pas impossible sur une donnée éditée à la main) aurait fait
// disparaître 'S' (violation « jamais perdre d'info »). Le `length === 1` ici (déjà
// présent dans l'ancienne regex de refblocks.js) empêche désormais ce cas sur les
// quatre sites : direction sûre, mais c'est un second changement de comportement,
// distinct de l'assouplissement casse/espaces ci-dessus — à ne pas fusionner avec lui.
export function isSingleSize(sizeLabels) {
  return (
    Array.isArray(sizeLabels) &&
    sizeLabels.length === 1 &&
    /^taille unique$/i.test(String(sizeLabels[0]).trim())
  )
}

// Libellé de taille affiché (lot 3b/T2, modèle `readDirLabel` ci-dessus) : la sentinelle
// « Taille unique » (isSingleSize) reste la chaîne FR gelée EN DONNÉE — project.activeSize
// et reader.sizeLabels ne changent jamais (cf. lot-3a-decision.md §3.1) — seule sa
// PRÉSENTATION à l'écran suit la langue courante, via la clé i18n stable `reader.singleSize`.
// Une vraie taille (S/M/L, mesures…) n'est pas du vocabulaire de l'app : elle ressort telle
// quelle, jamais traduite. `t` est injecté par l'appelant (composant Vue, useI18n) : ce
// module reste zéro-dépendance i18n/Vue, comme le reste de reader.js.
export function sizeLabelText(lab, t) {
  return isSingleSize([lab]) ? t('reader.singleSize') : lab
}

// Titre de section affiché (lot 3b/T3 ; revu au lot « clé stable », intent
// 2026-09-07-titres-francais-donnees-generes) : reconnaît l'intro par `id === 'presentation'`
// EN PREMIER — la clé stable posée par `parseIntro` (parse.js), même logique que `isIntro`
// (serialize.js). Repli sur `title === 'Présentation'` UNIQUEMENT quand `id` est vide :
// patrons persistés avant ce lot, et sections produites par le pipeline d'import PDF
// (`assemble.js`, hors périmètre de ce lot — il ne pose jamais cet id). Ce repli protège
// aussi contre le même risque que `isIntro` : une section de TRAVAIL portant un id distinct
// et non vide, même titrée « Présentation » par coïncidence, n'est jamais traduite (branche
// id prioritaire). Traduire la DONNÉE elle-même reste hors de question : cela changerait
// l'id de section (slug du titre, reader-edit.js:174) et ferait perdre la
// progression/les compteurs/l'état des diagrammes classés par cet id. Seule la
// présentation à l'écran suit la langue courante, via `reader.section.intro`.
export function sectionTitleLabel(sec, t) {
  const isIntro = sec?.id ? sec.id === 'presentation' : sec?.title === 'Présentation'
  return isIntro ? t('reader.section.intro') : sec?.title
}

// Découpe un bloc d'instructions en étapes ROW (une par ligne non vide).
export function splitInstructions(txt) {
  return String(txt ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((t) => ({ t }))
}

// Dérive un objet reader depuis un patron. Si le patron a déjà un reader riche, on le garde.
export function patternToReader(pattern) {
  if (pattern?.reader) return pattern.reader
  const sections = (pattern?.sections || []).map((s, i) => {
    const steps = splitInstructions(s.instructions)
    // Variantes par taille → notes préfixées du nom de taille (rien n'est perdu).
    for (const [size, txt] of Object.entries(s.bySize || {})) {
      const v = String(txt ?? '').trim()
      if (v) steps.push({ t: `${size} : ${v}`, note: true })
    }
    return {
      id: slug(s.name) || `sec${i}`,
      kind: s.isDiagram ? 'diagramme' : 'pelote',
      title: s.name || `Section ${i + 1}`,
      steps,
    }
  })
  return { sizeLabels: [], sections }
}

// Cœur PUR : regroupe les boîtes de tracés vectoriels (minMax transformés) en régions
// de diagramme. Aucune dépendance pdfjs/DOM. Coordonnées en points PDF, y vers le haut.

const DEFAULTS = { gap: 24, minW: 150, minH: 40, minPaths: 8, dedupIoU: 0.5, fullPageRatio: 0.9, dust: 2 }

// Calcule l'intersection sur l'union (IoU) entre deux boîtes.
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  const inter = ix * iy
  if (inter <= 0) return 0
  const ua = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter
  return ua > 0 ? inter / ua : 0
}

// Deux boîtes sont « proches » si elles se chevauchent ou sont distantes de < gap sur les
// deux axes (marge de gap ajoutée autour de chaque boîte).
function near(a, b, gap) {
  return (
    a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 &&
    a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1
  )
}

function union(a, b) {
  return {
    page: a.page,
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
    count: (a.count || 1) + (b.count || 1),
  }
}

export function clusterPathBoxes(boxes, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const byPage = new Map()
  for (const b of boxes || []) {
    const w = b.x1 - b.x0
    const h = b.y1 - b.y0
    // Pré-filtre PAR TRACÉ, AVANT le regroupement (fidèle à extract_images.py du banc).
    // Sans ça, un grand tracé de fond/cadre de gabarit se retrouve « proche » de tous les
    // autres tracés et les agglomère en un seul cluster pleine-page, ensuite rejeté par le
    // filtre pleine-page du cluster → 0 région sur un patron réel dense (bug Phildar device).
    if (w < o.dust && h < o.dust) continue // poussière
    const pa = (o.pageArea && o.pageArea[b.page]) || 0
    if (pa > 0 && w * h > o.fullPageRatio * pa) continue // tracé pleine-page (fond/cadre)
    if (!byPage.has(b.page)) byPage.set(b.page, [])
    byPage.get(b.page).push({ ...b, count: 1 })
  }
  const regions = []
  for (const [, pageBoxes] of byPage) {
    const clusters = []
    for (const box of pageBoxes) {
      let merged = box
      // Fusion transitive : on absorbe tout cluster proche du courant, en boucle.
      let changed = true
      while (changed) {
        changed = false
        for (let i = clusters.length - 1; i >= 0; i--) {
          if (near(merged, clusters[i], o.gap)) {
            merged = union(merged, clusters[i])
            clusters.splice(i, 1)
            changed = true
          }
        }
      }
      clusters.push(merged)
    }
    // Filtrage des régions. PAS de rejet « cluster pleine-page » : le garde-fou pleine-page
    // agit UNIQUEMENT par tracé, en amont (comme extract_images.py du banc). Une page peut
    // être ENTIÈREMENT un diagramme (Phildar p.3, grille dense couvrant ~90 % de la page) :
    // rejeter le cluster à cause de sa taille perdrait ce diagramme. La densité (minPaths)
    // suffit à écarter les pages non-diagramme (le texte n'émet pas de tracés).
    for (const c of clusters) {
      const w = c.x1 - c.x0
      const h = c.y1 - c.y0
      if (w < o.minW || h < o.minH) continue
      if ((c.count || 0) < o.minPaths) continue
      const raster = (o.rasterBoxes || []).filter((r) => r.page === c.page)
      if (raster.some((r) => iou(c, r) >= o.dedupIoU)) continue
      regions.push(c)
    }
  }
  return regions
}

// Découpe un profil de densité 1D en segments de contenu, séparés par des gouttières
// (runs ≤ inkFloor de longueur ≥ gapMin). Rejette les segments < minLen. Indices inclusifs.
export function findGutters(profile, opts = {}) {
  const { gapMin = 48, minLen = 80, inkFloor = 0 } = opts
  const segs = []
  let start = -1
  let lastInk = -1
  let gap = 0
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > inkFloor) {
      if (start < 0) start = i
      lastInk = i
      gap = 0
    } else if (start >= 0) {
      gap++
      if (gap >= gapMin) {
        segs.push({ start, end: lastInk })
        start = -1
      }
    }
  }
  if (start >= 0) segs.push({ start, end: lastInk })
  return segs.filter((s) => s.end - s.start + 1 >= minLen)
}

// Profil de densité d'encre le long d'un axe, dans une bbox pixel, échantillonné.
// data = RGBA plat ; un pixel « encré » = canal R < inkThreshold.
export function computeInkProfile(data, width, bbox, axis, opts = {}) {
  const { inkThreshold = 200, step = 3 } = opts
  const { x0, y0, x1, y1 } = bbox
  if (axis === 'y') {
    const prof = Array.from({ length: Math.max(0, y1 - y0) }).fill(0)
    for (let y = y0; y < y1; y++) {
      let c = 0
      for (let x = x0; x < x1; x += step) {
        if (data[(y * width + x) * 4] < inkThreshold) c++
      }
      prof[y - y0] = c
    }
    return prof
  }
  const prof = Array.from({ length: Math.max(0, x1 - x0) }).fill(0)
  for (let x = x0; x < x1; x++) {
    let c = 0
    for (let y = y0; y < y1; y += step) {
      if (data[(y * width + x) * 4] < inkThreshold) c++
    }
    prof[x - x0] = c
  }
  return prof
}

// Détecte un treillis (grille) : beaucoup de lignes ET de colonnes « pleines » (couverture
// d'encre ≥ lineCov). `data` doit être la version SANS texte pour être fiable. Conservateur :
// au doute (peu de lignes) → false, ce qui fera garder la région entière en amont.
export function isGridCell(data, width, bbox, opts = {}) {
  const { inkThreshold = 200, step = 3, lineCov = 0.5, minLines = 4 } = opts
  const yProf = computeInkProfile(data, width, bbox, 'y', { inkThreshold, step })
  const xProf = computeInkProfile(data, width, bbox, 'x', { inkThreshold, step })
  const xSamples = Math.max(1, Math.ceil((bbox.x1 - bbox.x0) / step)) // max d'un profil Y (échantillonné en x)
  const ySamples = Math.max(1, Math.ceil((bbox.y1 - bbox.y0) / step)) // max d'un profil X (échantillonné en y)
  const rowLines = yProf.filter((v) => v >= lineCov * xSamples).length
  const colLines = xProf.filter((v) => v >= lineCov * ySamples).length
  return rowLines >= minLines && colLines >= minLines
}

// Étend une bbox le long d'un axe pour englober une seconde bbox adjacente.
function extend(a, b, axis) {
  return axis === 'y'
    ? { x0: a.x0, y0: a.y0, x1: a.x1, y1: b.y1 }
    : { x0: a.x0, y0: a.y0, x1: b.x1, y1: a.y1 }
}

// Découpe `bbox` le long de `axis` aux gouttières, classe chaque cellule (isGridCell),
// puis fusionne deux cellules adjacentes dès que leur frontière n'est PAS « grille|grille ».
// Renvoie des blocs { x0,y0,x1,y1, grid }. `data` = SANS texte.
function mergeAxis(data, width, bbox, axis, opts) {
  const segs = findGutters(computeInkProfile(data, width, bbox, axis, opts), opts)
  const base = axis === 'y' ? bbox.y0 : bbox.x0
  const cells = segs.length <= 1
    ? [bbox]
    : segs.map((s) => axis === 'y'
        ? { x0: bbox.x0, y0: base + s.start, x1: bbox.x1, y1: base + s.end + 1 }
        : { x0: base + s.start, y0: bbox.y0, x1: base + s.end + 1, y1: bbox.y1 })
  let cur = cells[0]
  let curGrid = isGridCell(data, width, cur, opts)
  if (cells.length === 1) return [{ ...cur, grid: curGrid }]
  const blocks = []
  for (let i = 1; i < cells.length; i++) {
    const g = isGridCell(data, width, cells[i], opts)
    // greedy : on garde la coupe quand le bloc courant a déjà une grille ET la cellule suivante
    // en est une ; sinon on attache (une non-grille entre deux grilles s'attache à une voisine,
    // les grilles restent séparées).
    if (curGrid && g) {                 // frontière grille|grille → on garde la coupe
      blocks.push({ ...cur, grid: true })
      cur = cells[i]; curGrid = true
    } else {                            // sinon on dissout la frontière (fusion, rien perdu)
      cur = extend(cur, cells[i], axis)
      curGrid = curGrid || g
    }
  }
  blocks.push({ ...cur, grid: curGrid })
  return blocks
}

// Sépare une région : gouttières Y (bandes pleine largeur), puis X dans chaque bande-grille.
// Une bande non-grille est émise entière (référence), jamais sous-découpée. Bbox pixels absolus.
// NB sur `grid` : le drapeau signifie « ce bloc CONTIENT ≥1 cellule-grille » (par le OR greedy),
// pas « ce bloc est intégralement une grille » — une légende fusionnée à sa grille voisine reste
// `grid:true`. Suffisant ici (rien en aval ne dépend de `kind`) ; un futur consommateur (promotion
// en grille interactive) ne doit PAS supposer `kind` fiable au crop près.
export function splitRegionGuarded(data, width, region, opts = {}) {
  const out = []
  for (const yb of mergeAxis(data, width, region, 'y', opts)) {
    if (!yb.grid) { out.push(yb); continue }
    for (const xb of mergeAxis(data, width, yb, 'x', opts)) out.push(xb)
  }
  return out
}

// ─── Classifieur STRICT du kind final (D+E) ────────────────────────────────
// « Quadrillage + lignes » = assez de lignes régulièrement espacées sur les DEUX axes.
// DÉCOUPLÉ de isGridCell (qui reste la décision de DÉCOUPAGE) : ici on décide le kind
// FINAL d'une cellule / image. Décision STRUCTURELLE (compte de cellules) → robuste à la
// résolution. Calibré sur 11 cas réels étiquetés (Bonnet/Cella/torsades), 2026-07-14.
// `cvMax: 0.4` : la voie régulier+CV (10 ≤ min-axe < 20 lignes) sépare un VRAI chart au pas
// régulier (Cella, cv ≈ 0,00) d'un faux positif photo+texte (page Bonnet émise par le pipeline,
// cv ≈ 0,57 — les lignes de base du texte se comptent comme des rangs sur les données NON masquées) ;
// seuil 0,4 au milieu, large marge des deux côtés. Un vrai diagramme a un pas régulier → CV basse.
const GRID_STRICT = { inkThreshold: 200, step: 3, lineCov: 0.5, strong: 20, regMin: 10, cvMax: 0.4 }

// Centres des « lignes pleines » d'un profil : runs de bins ≥ lineCov*samples, fusionnés,
// centre de chaque run. Une ligne épaisse (plusieurs bins adjacents) compte pour UNE ligne.
function lineCenters(profile, samples, lineCov) {
  const thr = lineCov * samples
  const centers = []
  let start = -1
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] >= thr
    if (on && start < 0) start = i
    else if (!on && start >= 0) { centers.push((start + i - 1) / 2); start = -1 }
  }
  return centers
}

// Coefficient de variation (écart-type / moyenne) des écarts entre centres consécutifs.
// null si trop peu de centres. Un treillis régulier → CV ~0 ; des filets irréguliers → CV élevé.
function spacingCV(centers) {
  if (centers.length < 3) return null
  const gaps = []
  for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1])
  const m = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (m === 0) return null
  const v = gaps.reduce((a, b) => a + (b - m) ** 2, 0) / gaps.length
  return Math.sqrt(v) / m
}

export function classifyGridStrict(data, width, bbox, opts = {}) {
  const o = { ...GRID_STRICT, ...opts }
  const xSamples = Math.max(1, Math.ceil((bbox.x1 - bbox.x0) / o.step)) // max d'un profil Y
  const ySamples = Math.max(1, Math.ceil((bbox.y1 - bbox.y0) / o.step)) // max d'un profil X
  const rowC = lineCenters(computeInkProfile(data, width, bbox, 'y', o), xSamples, o.lineCov) // horizontales
  const colC = lineCenters(computeInkProfile(data, width, bbox, 'x', o), ySamples, o.lineCov) // verticales
  const minAxe = Math.min(rowC.length, colC.length)
  if (minAxe >= o.strong) return true            // treillis dense = grille sans ambiguïté
  if (minAxe < o.regMin) return false            // pas assez de lignes sur un axe
  const cv = spacingCV(rowC.length <= colC.length ? rowC : colC) // régularité de l'axe limitant
  return cv != null && cv <= o.cvMax
}

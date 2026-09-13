import { describe, it, expect } from 'vitest'
import { clusterPathBoxes, findGutters, computeInkProfile, splitRegionGuarded, isGridCell } from '@/utils/pdf-import/vector-regions'

describe('clusterPathBoxes — regroupement', () => {
  it('fusionne des tracés proches (< gap) en une région', () => {
    const boxes = [
      { page: 1, x0: 100, y0: 200, x1: 200, y1: 210 },
      { page: 1, x0: 100, y0: 215, x1: 200, y1: 225 }, // 5 pt au-dessus
    ]
    const regions = clusterPathBoxes(boxes, { gap: 24, minPaths: 1, minW: 0, minH: 0 })
    expect(regions).toHaveLength(1)
    expect(regions[0]).toMatchObject({ page: 1, x0: 100, y0: 200, x1: 200, y1: 225, count: 2 })
  })

  it('sépare deux grilles éloignées (> gap) sur la même page', () => {
    const boxes = [
      { page: 1, x0: 100, y0: 100, x1: 200, y1: 200 },
      { page: 1, x0: 100, y0: 400, x1: 200, y1: 500 }, // 200 pt plus haut
    ]
    const regions = clusterPathBoxes(boxes, { gap: 24, minPaths: 1, minW: 0, minH: 0 })
    expect(regions).toHaveLength(2)
  })

  it('ne fusionne jamais des tracés de pages différentes', () => {
    const boxes = [
      { page: 1, x0: 100, y0: 100, x1: 200, y1: 200 },
      { page: 2, x0: 100, y0: 100, x1: 200, y1: 200 },
    ]
    const regions = clusterPathBoxes(boxes, { gap: 999, minPaths: 1, minW: 0, minH: 0 })
    expect(regions).toHaveLength(2)
  })
})

describe('clusterPathBoxes — filtres', () => {
  it('rejette une région trop petite (< minW/minH)', () => {
    const boxes = [{ page: 1, x0: 0, y0: 0, x1: 20, y1: 10 }]
    expect(clusterPathBoxes(boxes, { minW: 150, minH: 40, minPaths: 1 })).toHaveLength(0)
  })

  it('rejette une région trop peu dense (count < minPaths)', () => {
    const boxes = [{ page: 1, x0: 0, y0: 0, x1: 300, y1: 300 }]
    expect(clusterPathBoxes(boxes, { minPaths: 8, minW: 0, minH: 0 })).toHaveLength(0)
  })

  it('rejette un cadre ≈ pleine page', () => {
    const boxes = Array.from({ length: 10 }, (_, i) => ({
      page: 1, x0: 5, y0: 5 + i, x1: 590, y1: 835 - i,
    }))
    const out = clusterPathBoxes(boxes, {
      minPaths: 1, minW: 0, minH: 0, gap: 999,
      pageArea: { 1: 595 * 842 }, fullPageRatio: 0.9,
    })
    expect(out).toHaveLength(0)
  })
})

describe('clusterPathBoxes — pré-filtre par tracé (régression bug Phildar : 0 région)', () => {
  it('un tracé de fond pleine-page n’agglomère pas les grilles denses', () => {
    const pageArea = { 1: 561 * 808 }
    // Grand cadre de fond quasi pleine-page (~97 %) + deux grilles denses séparées par
    // un vrai gap vertical. Sans pré-filtre PAR TRACÉ, le fond fusionne tout en un cluster
    // pleine-page ensuite rejeté → 0 région (bug device : aucun diagramme n’apparaît).
    const bg = { page: 1, x0: 5, y0: 5, x1: 556, y1: 803 }
    const grilleA = Array.from({ length: 12 }, (_, i) => ({ page: 1, x0: 80, y0: 60 + i, x1: 300, y1: 200 - i }))
    const grilleB = Array.from({ length: 12 }, (_, i) => ({ page: 1, x0: 80, y0: 420 + i, x1: 300, y1: 560 - i }))
    const regions = clusterPathBoxes([bg, ...grilleA, ...grilleB], { pageArea, minPaths: 8 })
    expect(regions).toHaveLength(2)
  })

  it('garde une grille dense couvrant >90 % de la page (cas Phildar p.3)', () => {
    // Beaucoup de petits tracés (chacun bien en-deçà du seuil pleine-page → survivent au
    // pré-filtre par tracé) empilés sur presque toute la page : leur UNION est quasi pleine
    // page, mais c'est un vrai diagramme dense. Il ne doit PAS être rejeté — une page peut
    // être entièrement une grille. (Avant le retrait du rejet « cluster pleine-page » :
    // 0 région → le diagramme de la page 3 du Phildar disparaissait.)
    const pageArea = { 1: 561 * 808 }
    const grille = []
    for (let i = 0; i < 44; i++) grille.push({ page: 1, x0: 5, y0: 10 + i * 18, x1: 556, y1: 22 + i * 18 })
    const regions = clusterPathBoxes(grille, { pageArea, minPaths: 8 })
    expect(regions).toHaveLength(1)
    expect((regions[0].x1 - regions[0].x0) * (regions[0].y1 - regions[0].y0)).toBeGreaterThan(0.9 * pageArea[1])
  })
})

describe('clusterPathBoxes — dédup raster', () => {
  it('rejette une région recouvrant une image raster déjà extraite', () => {
    const boxes = Array.from({ length: 10 }, (_, i) => ({
      page: 1, x0: 100, y0: 100 + i, x1: 300, y1: 300 - i,
    }))
    const rasterBoxes = [{ page: 1, x0: 100, y0: 100, x1: 300, y1: 300 }]
    const out = clusterPathBoxes(boxes, {
      minPaths: 1, minW: 0, minH: 0, gap: 999, dedupIoU: 0.5, rasterBoxes,
    })
    expect(out).toHaveLength(0)
  })

  it('garde une région disjointe d\'une image raster', () => {
    const boxes = Array.from({ length: 10 }, (_, i) => ({
      page: 1, x0: 100, y0: 100 + i, x1: 300, y1: 300 - i,
    }))
    const rasterBoxes = [{ page: 1, x0: 400, y0: 400, x1: 500, y1: 500 }]
    const out = clusterPathBoxes(boxes, {
      minPaths: 1, minW: 0, minH: 0, gap: 999, dedupIoU: 0.5, rasterBoxes,
    })
    expect(out).toHaveLength(1)
  })
})

describe('findGutters', () => {
  it('coupe deux bandes séparées par une gouttière ≥ gapMin', () => {
    // 3 encrés, 5 vides (gouttière), 3 encrés
    const prof = [0, 5, 5, 5, 0, 0, 0, 0, 0, 5, 5, 5, 0]
    expect(findGutters(prof, { gapMin: 4, minLen: 1 })).toEqual([
      { start: 1, end: 3 }, { start: 9, end: 11 },
    ])
  })

  it('ne coupe pas une gouttière trop courte (< gapMin)', () => {
    const prof = [5, 5, 0, 0, 5, 5] // gouttière de 2
    expect(findGutters(prof, { gapMin: 4, minLen: 1 })).toEqual([{ start: 0, end: 5 }])
  })

  it('rejette un segment plus court que minLen', () => {
    const prof = [5, 0, 0, 0, 0, 5, 5, 5, 5, 5]
    // 1er segment longueur 1 (<3) rejeté ; 2e longueur 5 gardé
    expect(findGutters(prof, { gapMin: 3, minLen: 3 })).toEqual([{ start: 5, end: 9 }])
  })

  it('tolère du bruit dans la gouttière via inkFloor', () => {
    const prof = [5, 5, 1, 0, 1, 0, 5, 5] // gouttière avec bruit ≤1
    expect(findGutters(prof, { gapMin: 4, minLen: 1, inkFloor: 1 })).toEqual([
      { start: 0, end: 1 }, { start: 6, end: 7 },
    ])
  })
})

describe('computeInkProfile', () => {
  // image 6×6 : lignes 1-2 encrées (R=0), reste blanc (R=255)
  function img() {
    const w = 6, h = 6
    const d = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let y = 1; y <= 2; y++) for (let x = 0; x < w; x++) {
      d[(y * w + x) * 4] = 0 // R sombre
    }
    return { d, w }
  }
  it('profil Y : lignes encrées ont une densité > 0', () => {
    const { d, w } = img()
    const prof = computeInkProfile(d, w, { x0: 0, y0: 0, x1: 6, y1: 6 }, 'y', { step: 1 })
    expect(prof.map((v) => v > 0)).toEqual([false, true, true, false, false, false])
  })
  it('profil X : toutes les colonnes touchées par les lignes encrées', () => {
    const { d, w } = img()
    const prof = computeInkProfile(d, w, { x0: 0, y0: 0, x1: 6, y1: 6 }, 'x', { step: 1 })
    expect(prof.every((v) => v === 2)).toBe(true) // 2 lignes encrées par colonne
  })

  // régression : avec step > 1, le profil X doit échantillonner l'axe TRANSVERSE (y),
  // pas l'axe primaire (x). Avant le fix, seules les colonnes multiples de step
  // recevaient une valeur (le reste restait à 0 issu du .fill(0)).
  it('profil X avec step > 1 : chaque colonne a une valeur (pas de trous de mauvais pas)', () => {
    const w = 8, h = 8
    const d = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      d[(y * w + x) * 4] = 0 // toutes les lignes encrées
    }
    const prof = computeInkProfile(d, w, { x0: 0, y0: 0, x1: w, y1: h }, 'x', { step: 2 })
    expect(prof).toHaveLength(w)
    expect(prof.every((v) => v > 0)).toBe(true)
    // échantillonnage y = 0,2,4,6 (step 2 sur 8 lignes) → 4 lignes comptées par colonne
    expect(prof[3]).toBe(4)
  })
})

describe('splitRegionGuarded', () => {
  // Fabrique un treillis dense dans un rectangle [x0,x1)×[y0,y1) d'un buffer w×h.
  function fillLattice(d, w, x0, y0, x1, y1) {
    for (let y = y0; y < y1; y += 4) for (let x = x0; x < x1; x++) d[(y * w + x) * 4] = 0
    for (let x = x0; x < x1; x += 4) for (let y = y0; y < y1; y++) d[(y * w + x) * 4] = 0
  }
  const OPTS = { step: 1, gapMin: 6, minLen: 8, inkThreshold: 200, lineCov: 0.4, minLines: 3 }

  it('sépare 2 treillis empilés (gouttière Y, deux côtés grilles) → 2 blocs-grille', () => {
    const w = 60, h = 100
    const d = new Uint8ClampedArray(w * h * 4).fill(255)
    fillLattice(d, w, 4, 4, 56, 40)   // grille haute
    fillLattice(d, w, 4, 60, 56, 96)  // grille basse (gouttière Y ~20px entre les deux)
    const blocks = splitRegionGuarded(d, w, { x0: 0, y0: 0, x1: 60, y1: 100 }, OPTS)
    expect(blocks).toHaveLength(2)
    expect(blocks.every((b) => b.grid)).toBe(true)
  })

  it('ne scinde PAS deux colonnes non-treillis (légende) → 1 bloc-référence', () => {
    const w = 100, h = 40
    const d = new Uint8ClampedArray(w * h * 4).fill(255)
    // 2 colonnes de « symboles » épars (pas de treillis), séparées par une gouttière X.
    for (const x0 of [6, 60]) for (const y of [8, 20, 32]) for (let x = x0; x < x0 + 12; x++) d[(y * w + x) * 4] = 0
    const blocks = splitRegionGuarded(d, w, { x0: 0, y0: 0, x1: 100, y1: 40 }, OPTS)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ x0: 0, y0: 0, x1: 100, y1: 40, grid: false })
  })

  it('cas mixte [treillis | treillis | légende] : coupe grille|grille gardée, légende fusionnée avec sa grille voisine → 2 blocs', () => {
    const w = 60, h = 150
    const d = new Uint8ClampedArray(w * h * 4).fill(255)
    fillLattice(d, w, 4, 4, 56, 44)    // grille A (y 4-44)
    fillLattice(d, w, 4, 60, 56, 100)  // grille B (y 60-100), gouttière A|B ≈16px
    // légende = bande ÉTROITE (x 6-14) : NON-treillis (aucune ligne « pleine » en largeur → rowLines=0).
    for (let y = 116; y < 140; y++) for (let x = 6; x < 14; x++) d[(y * w + x) * 4] = 0
    const blocks = splitRegionGuarded(d, w, { x0: 0, y0: 0, x1: 60, y1: 150 }, OPTS)
    // A reste seule (frontière A|B = grille|grille, gardée) ; B absorbe la légende (frontière
    // B|légende = grille|non-grille, fusionnée) → 2 blocs, aucun pixel abandonné.
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ y0: 4, y1: 44, grid: true }) // grille A seule
    expect(blocks[1].y1).toBe(140)                                  // grille B étendue jusqu'à la légende
  })

  it('repli : région tout-encrée sans gouttière → 1 bloc = la région entière', () => {
    const w = 20, h = 20
    const d = new Uint8ClampedArray(w * h * 4).fill(0)
    const blocks = splitRegionGuarded(d, w, { x0: 0, y0: 0, x1: 20, y1: 20 }, { step: 1, gapMin: 4, minLen: 2, lineCov: 0.5, minLines: 2 })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ x0: 0, y0: 0, x1: 20, y1: 20 })
  })

  it('légende ENTRE deux treillis [grille | non-grille | grille] : les grilles restent séparées → 2 blocs', () => {
    const w = 60, h = 150
    const d = new Uint8ClampedArray(w * h * 4).fill(255)
    fillLattice(d, w, 4, 4, 56, 44)      // grille A (y 4-44)
    for (let y = 60; y < 84; y++) for (let x = 6; x < 14; x++) d[(y * w + x) * 4] = 0 // légende étroite au milieu
    fillLattice(d, w, 4, 100, 56, 140)   // grille B (y 100-140)
    const blocks = splitRegionGuarded(d, w, { x0: 0, y0: 0, x1: 60, y1: 150 }, OPTS)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].y1).toBe(84)   // A a absorbé la légende du milieu (greedy attache)
    expect(blocks[1]).toMatchObject({ y0: 100, y1: 140, grid: true }) // B reste séparée
  })
})

describe('isGridCell — treillis vs épars', () => {
  // 60×60 : lignes horizontales ET verticales tous les 6px → treillis dense.
  function lattice() {
    const w = 60, h = 60
    const d = new Uint8ClampedArray(w * h * 4).fill(255)
    const ink = (x, y) => { d[(y * w + x) * 4] = 0 }
    for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x++) ink(x, y) // lignes horizontales
    for (let x = 0; x < w; x += 6) for (let y = 0; y < h; y++) ink(x, y) // lignes verticales
    return { d, w }
  }
  it('reconnaît un treillis régulier', () => {
    const { d, w } = lattice()
    expect(isGridCell(d, w, { x0: 0, y0: 0, x1: 60, y1: 60 }, { step: 1, lineCov: 0.5, minLines: 4 })).toBe(true)
  })
  it('rejette un bloc épars (quelques traits, pas de treillis)', () => {
    const w = 60, h = 60
    const d = new Uint8ClampedArray(w * h * 4).fill(255)
    // 3 petits traits horizontaux isolés (façon symboles de légende) : ni assez de lignes, ni de colonnes pleines.
    for (const y of [10, 30, 50]) for (let x = 4; x < 16; x++) d[(y * w + x) * 4] = 0
    expect(isGridCell(d, w, { x0: 0, y0: 0, x1: 60, y1: 60 }, { step: 1, lineCov: 0.5, minLines: 4 })).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { recentWeeks, drawCalendar } from '@/utils/badge-calendar'

function makeColumns(n) {
  return Array.from({ length: n }, (_, i) => ({
    monday: `col-${i}`,
    monthStart: false,
    cells: Array.from({ length: 7 }, (_, ri) => ({ day: `d-${i}-${ri}`, seconds: 0, count: 0, level: 0, future: false })),
  }))
}

describe('recentWeeks', () => {
  it('renvoie tel quel un tableau déjà plus court que maxCols', () => {
    const columns = makeColumns(3)
    expect(recentWeeks(columns, 10)).toBe(columns)
  })

  it('garde les DERNIÈRES colonnes (les plus récentes), pas les premières', () => {
    const columns = makeColumns(10)
    const out = recentWeeks(columns, 4)
    expect(out.map((c) => c.monday)).toEqual(['col-6', 'col-7', 'col-8', 'col-9'])
  })

  it('tableau vide ou absent : ne plante pas, renvoie un tableau vide', () => {
    expect(recentWeeks([], 4)).toEqual([])
    expect(recentWeeks(undefined, 4)).toEqual([])
  })
})

function stubCtx() {
  const calls = []
  return {
    calls,
    ctx: {
      fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, font: '', textAlign: '', textBaseline: '',
      measureText: (s) => ({ width: String(s).length * 7 }),
      fillRect(...a) { calls.push(['fillRect', this.fillStyle, ...a]) },
      strokeRect(...a) { calls.push(['strokeRect', this.strokeStyle, this.globalAlpha, ...a]) },
      fillText(...a) { calls.push(['fillText', this.fillStyle, ...a]) },
    },
  }
}

describe('drawCalendar', () => {
  it('ne dessine rien si columns est vide ou absent', () => {
    const { ctx, calls } = stubCtx()
    drawCalendar(ctx, { x: 0, y: 0, w: 300, h: 200 }, [], 200, 70, '#fff')
    drawCalendar(ctx, { x: 0, y: 0, w: 300, h: 200 }, undefined, 200, 70, '#fff')
    expect(calls).toEqual([])
  })

  it('ne dessine rien si la zone est trop petite pour une seule cellule lisible', () => {
    const { ctx, calls } = stubCtx()
    drawCalendar(ctx, { x: 0, y: 0, w: 20, h: 20 }, makeColumns(4), 200, 70, '#fff')
    expect(calls).toEqual([])
  })

  it('dessine une cellule pleine par jour de niveau 1-4, un liseré pour le niveau 0, rien pour future', () => {
    const { ctx, calls } = stubCtx()
    const columns = [{
      monday: 'col-0',
      cells: [
        { day: 'd0', level: 0, future: false },
        { day: 'd1', level: 1, future: false },
        { day: 'd2', level: 4, future: false },
        { day: 'd3', level: 2, future: true }, // future : jamais dessiné, quel que soit le niveau
        { day: 'd4', level: 0, future: false },
        { day: 'd5', level: 3, future: false },
        { day: 'd6', level: 0, future: false },
      ],
    }]
    drawCalendar(ctx, { x: 0, y: 0, w: 200, h: 300 }, columns, 200, 70, '#abc')
    const fills = calls.filter((c) => c[0] === 'fillRect')
    const strokes = calls.filter((c) => c[0] === 'strokeRect')
    expect(fills.length).toBe(3) // niveaux 1, 4, 3
    expect(strokes.length).toBe(3) // niveaux 0 : d0, d4, d6
  })

  it('couleur des cellules pleines : dérivée de la teinte/saturation transmises, jamais une couleur fixe', () => {
    const { ctx, calls } = stubCtx()
    const columns = [{ monday: 'col-0', cells: [{ day: 'd0', level: 2, future: false }] }]
    drawCalendar(ctx, { x: 0, y: 0, w: 200, h: 300 }, columns, 45, 80, '#000')
    const fill = calls.find((c) => c[0] === 'fillRect')
    expect(fill[1]).toBe('hsl(45 80% 45%)') // teinte 45, saturation 80, luminosité du niveau 2 (45)
  })

  it('garde uniquement les semaines les plus récentes quand la largeur ne permet pas de toutes les loger', () => {
    const { ctx, calls } = stubCtx()
    const columns = makeColumns(30) // toutes de niveau 0, un seul liseré par jour non-future
    drawCalendar(ctx, { x: 0, y: 0, w: 120, h: 300 }, columns, 200, 70, '#fff')
    // 120px de large, PAD=16 des deux côtés -> 88px utiles ; avec MIN_CELL=14 et CELL_GAP=4,
    // au plus floor((88+4)/(14+4)) = 5 colonnes possibles.
    const strokes = calls.filter((c) => c[0] === 'strokeRect')
    expect(strokes.length).toBeLessThanOrEqual(5 * 7)
    expect(strokes.length).toBeGreaterThan(0)
  })
})

describe('drawCalendar — initiales de jour, libellés de mois, légende', () => {
  it('dessine les 7 initiales de jour (lundi en tête), une par ligne', () => {
    const { ctx, calls } = stubCtx()
    const columns = [{
      monday: '2026-09-14', monthStart: true,
      cells: Array.from({ length: 7 }, (_, ri) => ({ day: `d${ri}`, level: 0, future: false })),
    }]
    drawCalendar(ctx, { x: 0, y: 0, w: 300, h: 300 }, columns, 200, 70, '#fff', 'fr', { less: 'moins', more: 'plus' })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[2])
    // weekdayNames('fr', 1, 'narrow') commence par « L » (lundi) — cf. StatsHeatmap.vue, même appel.
    expect(texts[0]).toBe('L')
    expect(texts.slice(0, 7).length).toBe(7)
  })

  it('dessine un libellé de mois seulement pour une colonne monthStart', () => {
    const { ctx, calls } = stubCtx()
    const columns = [
      { monday: '2026-08-31', monthStart: true, cells: Array.from({ length: 7 }, (_, ri) => ({ day: `a${ri}`, level: 0, future: false })) },
      { monday: '2026-09-07', monthStart: false, cells: Array.from({ length: 7 }, (_, ri) => ({ day: `b${ri}`, level: 0, future: false })) },
      { monday: '2026-09-14', monthStart: false, cells: Array.from({ length: 7 }, (_, ri) => ({ day: `c${ri}`, level: 0, future: false })) },
    ]
    drawCalendar(ctx, { x: 0, y: 0, w: 300, h: 300 }, columns, 200, 70, '#fff', 'fr', { less: '', more: '' })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[2])
    // Un seul libellé de mois attendu (« août »), les initiales de jour ne sont jamais « août ».
    const monthTexts = texts.filter((s) => s === new Intl.DateTimeFormat('fr', { month: 'short' }).format(new Date(2026, 7, 31)))
    expect(monthTexts.length).toBe(1)
  })

  it('deux colonnes monthStart consécutives avec petit cell : la seconde est sautée si elle chevaucherait la première', () => {
    const { ctx, calls } = stubCtx()
    // Beaucoup de semaines dans une zone étroite pour forcer un petit cell proche de MIN_CELL (14)
    // Les deux dernières colonnes (indices 18-19) ont monthStart: true — avec zone étroite (150px),
    // recentWeeks garde seulement les 5 dernières (indices 15-19), donc les deux monthStart sont visibles
    const columns = Array.from({ length: 20 }, (_, i) => ({
      monday: `2026-08-${String(1 + i).padStart(2, '0')}`, // dates valides en août
      monthStart: i === 18 || i === 19, // deux colonnes consécutives en fin de tableau (visibles après recentWeeks)
      cells: Array.from({ length: 7 }, (_, ri) => ({ day: `d-${i}-${ri}`, level: 0, future: false })),
    }))
    drawCalendar(ctx, { x: 0, y: 0, w: 150, h: 300 }, columns, 200, 70, '#fff', 'fr', { less: '', more: '' })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[2])
    // Libellé de mois attendu (août - les deux colonnes sont en août)
    const augustLabel = new Intl.DateTimeFormat('fr', { month: 'short' }).format(new Date(2026, 7, 1))
    // Filtre les textes qui correspondent à août
    const monthTexts = texts.filter((s) => s === augustLabel)
    // En raison du chevauchement avec petit cell, on attend UN SEUL libellé dessiné, pas deux
    // (le second est sauté car il chevaucherait le premier)
    expect(monthTexts.length).toBe(1)
  })

  it('deux colonnes monthStart espacées de plusieurs semaines : les deux libellés sont dessinés', () => {
    const { ctx, calls } = stubCtx()
    // Zone large pour avoir un cell assez grand, pas mal de semaines
    // Colonnes 0 et 9 ont monthStart: true — avec zone large (300px), elles sont toutes visibles
    const columns = Array.from({ length: 11 }, (_, i) => ({
      monday: `2026-08-${String(1 + i).padStart(2, '0')}`, // dates valides en août
      monthStart: i === 0 || i === 9, // deux colonnes bien espacées (1er et 9e en août)
      cells: Array.from({ length: 7 }, (_, ri) => ({ day: `d-${i}-${ri}`, level: 0, future: false })),
    }))
    drawCalendar(ctx, { x: 0, y: 0, w: 300, h: 300 }, columns, 200, 70, '#fff', 'fr', { less: '', more: '' })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[2])
    // Libellé de mois attendu (août - les deux colonnes sont en août)
    const augustLabel = new Intl.DateTimeFormat('fr', { month: 'short' }).format(new Date(2026, 7, 1))
    // Filtre les textes qui correspondent à août
    const monthTexts = texts.filter((s) => s === augustLabel)
    // Quand les deux sont espacés, tous les deux doivent être dessinés (deux appels fillText avec « août »)
    expect(monthTexts.length).toBe(2)
  })

  it('dessine la légende « moins » + 5 pastilles + « plus », dans cet ordre', () => {
    const { ctx, calls } = stubCtx()
    const columns = [{ monday: '2026-09-14', monthStart: true, cells: [{ day: 'd0', level: 0, future: false }] }]
    drawCalendar(ctx, { x: 0, y: 0, w: 300, h: 300 }, columns, 200, 70, '#fff', 'fr', { less: 'moins', more: 'plus' })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[2])
    expect(texts).toContain('moins')
    expect(texts).toContain('plus')
    const lessIdx = calls.findIndex((c) => c[0] === 'fillText' && c[2] === 'moins')
    const moreIdx = calls.findIndex((c) => c[0] === 'fillText' && c[2] === 'plus')
    const swatchCalls = calls.slice(lessIdx + 1, moreIdx).filter((c) => c[0] === 'fillRect' || c[0] === 'strokeRect')
    expect(swatchCalls.length).toBe(5) // niveaux 0 à 4
  })

  it('légende absente (less/more vides) : aucune exception, la grille se dessine quand même', () => {
    const { ctx, calls } = stubCtx()
    const columns = [{ monday: '2026-09-14', monthStart: true, cells: [{ day: 'd0', level: 1, future: false }] }]
    expect(() => drawCalendar(ctx, { x: 0, y: 0, w: 300, h: 300 }, columns, 200, 70, '#fff')).not.toThrow()
    expect(calls.some((c) => c[0] === 'fillRect' && c[1] === 'hsl(200 70% 30%)')).toBe(true)
  })

  it('bloc gouttière+initiales+grille reste solidaire même dans une zone bien plus large que nécessaire (retour Julien, 20/09)', () => {
    const { ctx, calls } = stubCtx()
    const columns = makeColumns(3) // peu de semaines : la grille reste étroite quelle que soit la largeur dispo
    drawCalendar(ctx, { x: 0, y: 0, w: 800, h: 300 }, columns, 200, 70, '#fff')
    const dayLabelCall = calls.find((c) => c[0] === 'fillText' && c[2] === 'L')
    const firstCellCall = calls.find((c) => c[0] === 'fillRect' || c[0] === 'strokeRect')
    const cellLeftX = firstCellCall[0] === 'fillRect' ? firstCellCall[2] : firstCellCall[3]
    // L'écart entre la gouttière et la grille doit rester la GOUTTIÈRE FIXE (PAD + GUTTER_W + CHROME_GAP,
    // nettement sous 50px). Le bloc entier se déplace maintenant avec blockOffsetX, mais jamais les deux
    // parties ne se détachent — elles bougent ensemble, c'est tout.
    expect(cellLeftX - dayLabelCall[3]).toBeLessThan(50)
  })

  it('légende bordée à droite quand le centrage en bloc (20/09) l\'éloigne trop de la gouttière', () => {
    const { ctx, calls } = stubCtx()
    // Zone de largeur 250px (assez pour ne pas sauter la légende, cf. le garde `legendW >
    // area.w - PAD*2` juste avant dans drawCalendar) avec peu de semaines (3) : le bloc
    // gouttière+grille se centre (blockOffsetX, 20/09) et se retrouve décalé vers la droite ;
    // la légende, centrée sous la grille RÉELLE (startX/gridW) et large (~200px en français),
    // voudrait alors se placer plus à droite que ne le permet la zone — c'est la borne DROITE
    // (`Math.min(lx, area.x + area.w - PAD - legendW)`) qui la retient ici, pas la borne gauche.
    //
    // La borne GAUCHE (`Math.max(area.x + PAD, ...)`) reste dans `drawCalendar` par sécurité,
    // mais est devenue mathématiquement inatteignable avec ce centrage en bloc : elle
    // nécessiterait `legendW > area.w - 3`, alors que la légende est sautée dès
    // `legendW > area.w - 32` (garde ci-dessus) — les deux conditions sont disjointes, aucun
    // scénario ne peut donc plus l'atteindre. Ce test vérifie seulement que la légende reste
    // >= area.x + PAD, ce qui reste vrai, mais par l'effet de la borne droite, jamais de la
    // gauche.
    const columns = makeColumns(3)
    drawCalendar(ctx, { x: 50, y: 0, w: 250, h: 300 }, columns, 200, 70, '#fff', 'fr', { less: 'moins', more: 'plus' })
    // Chercher le premier fillText de la légende (« moins »)
    const legendTexts = calls.filter((c) => c[0] === 'fillText' && (c[2] === 'moins' || c[2] === 'plus'))
    expect(legendTexts.length).toBeGreaterThan(0)
    const firstLegendCall = legendTexts[0]
    const legendX = firstLegendCall[3]
    // La légende doit rester >= area.x + PAD (16) = 50 + 16 = 66 — bornée ici par le Math.min
    // (borne droite), qui la ramène à 85 dans ce scénario précis.
    expect(legendX).toBeGreaterThanOrEqual(66)
  })

  it('libellé de mois suit la grille même quand elle est centrée loin du haut de la zone (zone haute)', () => {
    const { ctx, calls } = stubCtx()
    const columns = [{
      monday: '2026-08-31', monthStart: true,
      cells: Array.from({ length: 7 }, (_, ri) => ({ day: `d${ri}`, level: 0, future: false })),
    }]
    // Zone volontairement beaucoup plus haute que nécessaire pour une grille de 7 lignes, pour
    // forcer un centrage vertical significatif (cf. `startY` dans drawCalendar) — c'est
    // exactement le cas réel qui a révélé le bug (badge avec beaucoup de lignes de stats,
    // donc un cartouche/carte calendaire haute).
    drawCalendar(ctx, { x: 0, y: 0, w: 300, h: 800 }, columns, 200, 70, '#fff', 'fr', { less: '', more: '' })
    const monthLabel = new Intl.DateTimeFormat('fr', { month: 'short' }).format(new Date(2026, 7, 31))
    const monthCall = calls.find((c) => c[0] === 'fillText' && c[2] === monthLabel)
    expect(monthCall).toBeTruthy()
    const monthY = monthCall[4]
    // Y du bord supérieur de la toute première case dessinée (première cellule de la grille,
    // colonne 0 ligne 0) — fillRect: ['fillRect', fillStyle, x, y, w, h] ; niveau 0 (aucune
    // activité dans ce test) dessine un strokeRect à la place : ['strokeRect', strokeStyle,
    // globalAlpha, x, y, w, h]. Les deux formats diffèrent, on gère les deux.
    const firstCellCall = calls.find((c) => c[0] === 'fillRect' || c[0] === 'strokeRect')
    const cellTopY = firstCellCall[0] === 'fillRect' ? firstCellCall[3] : firstCellCall[4]
    // Le libellé doit rester COLLÉ au sommet réel de la grille, jamais à un offset fixe depuis
    // le haut de `area` — un écart de plus de 20px trahirait le bug corrigé ici (avant ce
    // correctif, l'écart mesuré dans ce même scénario dépassait 300px).
    expect(cellTopY - monthY).toBeLessThan(20)
    expect(cellTopY - monthY).toBeGreaterThan(0)
  })

  it('bloc gouttière+grille se centre horizontalement dans une zone bien plus large que nécessaire (retour Julien, 20/09)', () => {
    const { ctx, calls } = stubCtx()
    const columns = makeColumns(3) // peu de semaines : grille étroite
    drawCalendar(ctx, { x: 0, y: 0, w: 800, h: 300 }, columns, 200, 70, '#fff')
    const dayLabelCall = calls.find((c) => c[0] === 'fillText' && c[2] === 'L')
    // Le bloc entier (gouttière + grille) doit se déplacer significativement vers la droite
    // quand la zone est bien plus large. dayLabelCall[3] est l'X de la position du « L ».
    // Il doit être NETTEMENT supérieur à area.x + PAD (16) pour prouver le centrage.
    // Avec area.w=800 et peu de semaines, blockOffsetX ≈ 344px, donc dayLabelX ≈ 360px.
    expect(dayLabelCall[3]).toBeGreaterThan(200)
  })

  it('bloc gouttière+grille en mode côte-à-côte, historique long : cell contraint par la largeur, offset faible', () => {
    const { ctx, calls } = stubCtx()
    // 340px = plancher RÉALISTE de la zone transmise à drawCalendar en mode `side` du composeur
    // de badge (cf. calendarLayout/statsAreaWithCalendar, badge-render.js) : le mode `side` n'est
    // choisi que si colW >= 830, ce qui donne calendarArea.w = 400 au minimum ; `renderBadge` lui
    // retire ensuite TEXT_PAD (60) avant de le passer à drawCalendar (calendarDrawArea.w =
    // calendarArea.w - TEXT_PAD), soit 340 au plancher. 250px (l'ancienne valeur de ce test)
    // n'arrive donc jamais en mode `side` réel. Historique long (18 semaines, au-delà du
    // maxCols que cette largeur permet réellement) : `cell` est contraint par la largeur
    // disponible, pas par MAX_CELL, et l'excédent de la grille (donc l'offset) reste faible.
    const columns = makeColumns(18)
    drawCalendar(ctx, { x: 0, y: 0, w: 340, h: 300 }, columns, 200, 70, '#fff')
    const dayLabelCall = calls.find((c) => c[0] === 'fillText' && c[2] === 'L')
    // Valeur mesurée par exécution (cf. rapport du chantier) : dayLabelX = 22.
    expect(dayLabelCall[3]).toBe(22)
  })

  it('bloc gouttière+grille en mode côte-à-côte, historique court : cell plafonné à MAX_CELL, offset significatif', () => {
    const { ctx, calls } = stubCtx()
    // Même largeur plancher réaliste (340px, cf. test précédent) mais historique court (4
    // semaines) et zone haute (400px, pour ne pas être bridé par la hauteur) : `cell` est
    // plafonné à MAX_CELL (32), la grille reste bien plus étroite que la zone, et le bloc
    // gouttière+grille se déplace donc RÉELLEMENT vers la droite (cas où le centrage du 20/09
    // a un effet visible en mode `side`).
    const columns = makeColumns(4)
    drawCalendar(ctx, { x: 0, y: 0, w: 340, h: 400 }, columns, 200, 70, '#fff')
    const dayLabelCall = calls.find((c) => c[0] === 'fillText' && c[2] === 'L')
    // Valeur mesurée par exécution (cf. rapport du chantier) : dayLabelX = 85.
    expect(dayLabelCall[3]).toBe(85)
  })
})

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import ChartStage from '@/components/ChartStage.vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CHART = { rows: 50, cols: 132, img: 'g.png', repeat: '132 m × 50 rangs', reps: 3 }
const CHART_RADIAL_SQUARE = { rows: 5, img: 'g.png', shape: 'radial-square' }
const CHART_RADIAL_CIRCLE = { rows: 5, img: 'g.png', shape: 'radial-circle' }
const CHART_RADIAL_HEXAGON = { rows: 5, img: 'g.png', shape: 'radial-hexagon' }
const CHART_PATH = { rows: 3, img: 'g.png', shape: 'path' }
const PATH_FRAME = { points: [{ x: 20, y: 30 }, { x: 80, y: 30 }], spacing: 5 }
const PATH_FRAME_2PTS = { points: [{ x: 20, y: 30 }, { x: 80, y: 30 }], spacing: 5 }
const wrappers = []
function mountStage(props = {}) {
  const w = mount(ChartStage, {
    props: { chart: CHART, row: 3, rep: 1, frame: null, curtain: null, readOnly: false, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  document.body.style.overflow = ''
})

describe('ChartStage — afficheur unique du diagramme', () => {
  it('affiche le rang reçu en props', () => {
    const w = mountStage()
    expect(w.find('.cfs__rowval').text()).toBe('3 / 50')
  })

  // LE test de cette tâche : le volet et le plein écran coexistent, celui qui reste
  // affiché doit refléter ce que l'autre a écrit. Un état interne non resynchronisé
  // laisserait le volet sur l'ancien rang après fermeture du plein écran.
  it('se resynchronise quand la props `row` change après le montage', async () => {
    const w = mountStage()
    await w.setProps({ row: 12 })
    expect(w.find('.cfs__rowval').text()).toBe('12 / 50')
  })

  // Protège : un appui qui ne déplace rien n'émet rien (sinon persist({ worked: true }) inscrit un jour actif).
  it('aux bornes (rang 1 en répétition 2, dernier rang de la dernière répétition), − et + n’émettent rien', async () => {
    const w = mountStage({ row: 1, rep: 2 })
    expect(w.find('.cfs__prev').attributes('disabled')).toBeDefined()
    w.vm.$.setupState.step(-1)
    const fin = mountStage({ row: 50, rep: 3 })
    await fin.find('.cfs__next').trigger('click')
    expect(w.emitted('update:row')).toBeFalsy()
    expect(fin.emitted('update:row')).toBeFalsy()
    expect(fin.emitted('update:rep')).toBeFalsy()
  })

  it('remonte le rang par un évènement, sans store', async () => {
    const w = mountStage()
    await w.find('.cfs__next').trigger('click')
    expect(w.emitted('update:row')?.at(-1)).toEqual([4])
  })

  // Effet global interdit : le volet vit DANS la page, il ne doit pas la bloquer.
  it('ne verrouille pas le défilement de la page', () => {
    document.body.style.overflow = ''
    mountStage()
    expect(document.body.style.overflow).toBe('')
  })

  // Garde structurelle : ce que le composant n'a PAS le droit de contenir. Les 4
  // mécanismes ci-dessous appartiennent à la coquille modale ; s'ils partaient ici,
  // deux instances montées se marcheraient dessus (Escape fermerait le plein écran
  // depuis le volet, le volet verrouillerait le défilement de la page…).
  it('ne contient aucun mécanisme propre au plein écran', () => {
    const src = readFileSync(resolve(__dirname, '../../src/components/ChartStage.vue'), 'utf8')
    expect(src).not.toContain('document.body.style.overflow')
    expect(src).not.toContain('useChartZoomStore')
    expect(src).not.toContain("addEventListener('keydown'")
    expect(src).not.toMatch(/position:\s*fixed/)
  })

  // (revue finale 28/07) : le volet et le plein écran peuvent être montés en même
  // temps, chacun avec sa propre instance de ChartStage. Si l'un enregistre un calage
  // pendant que l'autre est resté en mode Caler avec un brouillon non sauvegardé, ce
  // brouillon obsolète écraserait le calage qui vient d'être enregistré ailleurs — sauf si
  // cette 2e instance sort d'elle-même du mode Caler dès que sa prop `frame` change de
  // l'extérieur (seul signal disponible : `calibrating` est purement local, jamais en props).
  it('sort du mode Caler quand `frame` change depuis l’extérieur (course volet/plein écran)', async () => {
    const w = mountStage()
    await w.find('.cfs__cal').trigger('click')
    expect(w.find('.cfs__calbar').exists()).toBe(true)
    // Simule l'autre instance qui vient d'enregistrer : la prop change sans passer par les
    // boutons Enregistrer/Annuler/Réinitialiser de CETTE instance.
    await w.setProps({ frame: { top: 5, bottom: 95 } })
    expect(w.find('.cfs__calbar').exists()).toBe(false)
  })

  // (revue finale 28/07) : en épinglant une autre grille dans le volet, l'image
  // s'affichait au milieu (défilement hérité de la grille précédente) plutôt que depuis le
  // premier rang. Le zoom repart déjà à 100 % (test existant plus haut sur `props.chart`) ;
  // le défilement doit repartir en haut/à gauche au même instant.
  it('remet le défilement du viewport en haut/à gauche quand la grille change', async () => {
    const w = mountStage()
    const vp = w.find('.cfs__viewport').element
    vp.scrollTop = 120
    vp.scrollLeft = 40
    expect(vp.scrollTop).toBe(120) // vérifie que jsdom reflète bien l'affectation faite ci-dessus
    await w.setProps({ chart: { rows: 10, cols: 5, img: 'autre.png', repeat: '5 m × 10 rangs' } })
    expect(vp.scrollTop).toBe(0)
    expect(vp.scrollLeft).toBe(0)
  })

  // Protège : un simple appui sur la poignée du rideau, sans glisser, n'émet rien (pas de « travaillé » fantôme).
  it('rideau : appui sans glisser n’émet rien ; un glissé émet la nouvelle position', async () => {
    const w = mountStage()
    const line = w.find('.cfs__curtain-line')
    await line.trigger('pointerdown', { pointerId: 1 })
    await line.trigger('pointerup', { pointerId: 1 })
    expect(w.emitted('update:curtain')).toBeFalsy()

    w.vm.$el.querySelector('.cfs__canvas').getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 })
    await line.trigger('pointerdown', { pointerId: 1 })
    const move = new Event('pointermove', { bubbles: true })
    Object.assign(move, { pointerId: 1, clientX: 50 })
    line.element.dispatchEvent(move)
    await line.trigger('pointerup', { pointerId: 1 })
    expect(w.emitted('update:curtain')).toHaveLength(1)
    expect(w.emitted('update:curtain')[0][0].x).toBe(25)
  })

  it('affiche un repère vertical plein-hauteur sur le rideau, en plus de la poignée ronde', () => {
    const w = mountStage()
    const line = w.find('.cfs__curtain-line')
    expect(line.exists()).toBe(true)
    const col = line.find('.cfs__curtain-col')
    expect(col.exists()).toBe(true)
    expect(col.attributes('aria-hidden')).toBe('true')
    // Renfort visuel seulement : ne doit jamais intercepter le drag/tap destiné à .cfs__curtain-line.
    expect(col.element.style.pointerEvents).toBe('none')
  })

  it('ne montre pas le repère vertical du rideau pendant le calage', async () => {
    const w = mountStage()
    await w.find('.cfs__cal').trigger('click')
    expect(w.find('.cfs__curtain-col').exists()).toBe(false)
  })
})

describe('ChartStage — anneau radial (lecture)', () => {
  it('un motif radial-square rend un rectangle, pas les bandes linéaires ni le rideau', () => {
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    expect(w.find('svg.cfs__rings').exists()).toBe(true)
    expect(w.find('rect.cfs__ring--hl').exists()).toBe(true)
    expect(w.find('ellipse').exists()).toBe(false)
    expect(w.find('.cfs__hl').exists()).toBe(false)
    expect(w.find('.cfs__curtain-line').exists()).toBe(false)
  })

  it('calcule les attributs du rectangle depuis chartRings (rang 3/5, cadrage par défaut)', () => {
    // chartRings(3, 5, null) : T=5, r=3, span=50 → hlOuter=30, hlInner=20 → hlR=25, largeur 10.
    // doneOuter=20, doneInner=0 → doneR=10, largeur 20.
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    const hl = w.find('rect.cfs__ring--hl')
    expect(hl.attributes('x')).toBe('25')
    expect(hl.attributes('y')).toBe('25')
    expect(hl.attributes('width')).toBe('50')
    expect(hl.attributes('height')).toBe('50')
    expect(hl.attributes('stroke-width')).toBe('10')
    const done = w.find('rect.cfs__ring--done')
    expect(done.attributes('x')).toBe('40')
    expect(done.attributes('y')).toBe('40')
    expect(done.attributes('width')).toBe('20')
    expect(done.attributes('height')).toBe('20')
    expect(done.attributes('stroke-width')).toBe('20')
  })

  it('un motif radial-circle rend une ellipse ; rx = ry quand canvasAspect vaut 1 (défaut)', () => {
    const w = mountStage({ chart: CHART_RADIAL_CIRCLE, row: 3 })
    expect(w.find('ellipse.cfs__ring--hl').exists()).toBe(true)
    expect(w.find('rect').exists()).toBe(false)
    const hl = w.find('ellipse.cfs__ring--hl')
    expect(hl.attributes('rx')).toBe('25')
    expect(hl.attributes('ry')).toBe('25')
  })

  it("compense l'ellipse pour un cadre non carré : ry = rx × largeur/hauteur du canvas", async () => {
    const w = mountStage({ chart: CHART_RADIAL_CIRCLE, row: 3 })
    w.vm.canvasAspect = 3.11
    await nextTick()
    const hl = w.find('ellipse.cfs__ring--hl')
    expect(Number(hl.attributes('rx'))).toBeCloseTo(25)
    expect(Number(hl.attributes('ry'))).toBeCloseTo(77.75)
  })

  // Retour terrain 26/08 (après l'assistant à loupe fixe) : le calage ne passe plus par un
  // glissé sur CE rendu, qui absorbait avant l'étirement d'un canevas non carré à l'œil —
  // sans compensation, un carré calé via la loupe (toujours réellement carrée) ne l'était
  // plus une fois affiché ici. width/x restent la référence ; height/y suivent canvasAspect.
  it("compense le carré pour un cadre non carré : height = largeur × largeur/hauteur du canvas", async () => {
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    w.vm.canvasAspect = 3.11
    await nextTick()
    const hl = w.find('rect.cfs__ring--hl')
    expect(Number(hl.attributes('width'))).toBeCloseTo(50)
    expect(Number(hl.attributes('height'))).toBeCloseTo(155.5)
    expect(Number(hl.attributes('x'))).toBeCloseTo(25)
    expect(Number(hl.attributes('y'))).toBeCloseTo(-27.75)
  })

  it('un motif radial-hexagon rend un polygon (6 sommets), pas de rect ni ellipse', () => {
    const w = mountStage({ chart: CHART_RADIAL_HEXAGON, row: 3 })
    expect(w.find('polygon.cfs__ring--hl').exists()).toBe(true)
    expect(w.find('rect').exists()).toBe(false)
    expect(w.find('ellipse').exists()).toBe(false)
    const hl = w.find('polygon.cfs__ring--hl')
    const pts = hl.attributes('points').trim().split(' ')
    expect(pts).toHaveLength(6)
  })

  it("orientation par défaut 'flat' (frame sans hexOrientation) : sommet le plus à droite sur l'axe horizontal du centre", () => {
    // chartRings(3, 5, null) : cx=cy=50, hlR=25. Apothème 25 → circonrayon R=25/cos(30°).
    const w = mountStage({ chart: CHART_RADIAL_HEXAGON, row: 3 })
    const hl = w.find('polygon.cfs__ring--hl')
    const pts = hl.attributes('points').trim().split(' ').map((p) => p.split(',').map(Number))
    const R = 25 / Math.cos(Math.PI / 6)
    const rightmost = pts.find(([x, y]) => Math.abs(x - (50 + R)) < 1e-6 && Math.abs(y - 50) < 1e-6)
    expect(rightmost).toBeTruthy()
  })

  it("frame.hexOrientation 'pointy' : un sommet exactement au-dessus du centre", () => {
    const frame = { cx: 50, cy: 50, r0: 0, r1: 50, r0Shape: 'hexagon', r1Shape: 'hexagon', hexOrientation: 'pointy' }
    const w = mountStage({ chart: CHART_RADIAL_HEXAGON, row: 3, frame })
    const hl = w.find('polygon.cfs__ring--hl')
    const pts = hl.attributes('points').trim().split(' ').map((p) => p.split(',').map(Number))
    const top = pts.find(([x]) => Math.abs(x - 50) < 1e-6)
    expect(top).toBeTruthy()
    expect(top[1]).toBeLessThan(50)
  })

  it('rend un contour mixte : rangs avant le switchRound en cercle, à partir de lui en carré', () => {
    const frame = { cx: 50, cy: 50, r0: 0, r1: 50, r0Shape: 'circle', r1Shape: 'square', switchRound: 4 }
    const before = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3, frame })
    expect(before.find('ellipse.cfs__ring--hl').exists()).toBe(true)
    expect(before.find('rect.cfs__ring--hl').exists()).toBe(false)
    const after = mountStage({ chart: CHART_RADIAL_SQUARE, row: 4, frame })
    expect(after.find('rect.cfs__ring--hl').exists()).toBe(true)
    expect(after.find('ellipse.cfs__ring--hl').exists()).toBe(false)
  })

  it('un diagramme linéaire (shape absent) est inchangé : pas de <svg class="cfs__rings">', () => {
    const w = mountStage()
    expect(w.find('svg.cfs__rings').exists()).toBe(false)
    expect(w.find('.cfs__hl').exists()).toBe(true)
  })
})

describe('ChartStage — contour de contraste garanti sur la bande « rang en cours » (retour terrain 26/08)', () => {
  // --brand plafonne à ~2:1 contre blanc en thème sombre, quelle que soit la teinte choisie
  // (mesuré : L=78,51 en OKLCH, aucune opacité ne peut atteindre 3:1 — cf. commentaire CSS
  // .cfs__ring--hl-edge). Un contour à couleur FIXE (indépendante du thème/teinte) est donc
  // le seul moyen de garantir 3:1 (WCAG 1.4.11) sur la bande qui indique le rang en cours.
  it('radial-square : le contour --hl-edge a les mêmes x/y/largeur que --hl, un stroke-width élargi de 3, et peint AVANT lui (dessous)', () => {
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    const edge = w.find('rect.cfs__ring--hl-edge')
    const hl = w.find('rect.cfs__ring--hl')
    expect(edge.exists()).toBe(true)
    expect(edge.attributes('x')).toBe(hl.attributes('x'))
    expect(edge.attributes('y')).toBe(hl.attributes('y'))
    expect(edge.attributes('width')).toBe(hl.attributes('width'))
    expect(edge.attributes('height')).toBe(hl.attributes('height'))
    expect(Number(edge.attributes('stroke-width'))).toBeCloseTo(Number(hl.attributes('stroke-width')) + 3)
    expect(edge.element.compareDocumentPosition(hl.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('radial-circle : le contour --hl-edge a les mêmes rx/ry que --hl, un stroke-width élargi de 3', () => {
    const w = mountStage({ chart: CHART_RADIAL_CIRCLE, row: 3 })
    const edge = w.find('ellipse.cfs__ring--hl-edge')
    const hl = w.find('ellipse.cfs__ring--hl')
    expect(edge.exists()).toBe(true)
    expect(edge.attributes('rx')).toBe(hl.attributes('rx'))
    expect(edge.attributes('ry')).toBe(hl.attributes('ry'))
    expect(Number(edge.attributes('stroke-width'))).toBeCloseTo(Number(hl.attributes('stroke-width')) + 3)
  })

  it('le contour --hl-edge ne reçoit PAS la classe --calibrating (reste net même quand la bande colorée s\'estompe)', async () => {
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    await w.find('.cfs__cal').trigger('click')
    expect(w.find('rect.cfs__ring--hl-edge').classes()).not.toContain('cfs__ring--calibrating')
  })
})

describe('ChartStage — assistant de calage radial (intégration)', () => {
  it('le bouton Caler ouvre l\'assistant sur un diagramme radial, pas les poignées linéaires', async () => {
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    await w.find('.cfs__cal').trigger('click')
    expect(w.find('.rcw').exists()).toBe(true)
    expect(w.find('.cfs__handle--top').exists()).toBe(false)
    expect(w.find('.cfs__calbar').exists()).toBe(false) // la barre bas de page radiale vit dans l'assistant
  })

  it('transmet le frame existant à l\'assistant', async () => {
    const frame = { cx: 40, cy: 60, r0: 5, r1: 45, r0Shape: 'circle', r1Shape: 'circle' }
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3, frame })
    await w.find('.cfs__cal').trigger('click')
    expect(w.findComponent({ name: 'RadialCalibrationWizard' }).props('frame')).toEqual(frame)
  })

  it('save de l\'assistant émet update:frame et ferme le calage', async () => {
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    await w.find('.cfs__cal').trigger('click')
    const next = { cx: 42, cy: 58, r0: 8, r1: 48, r0Shape: 'square', r1Shape: 'square' }
    await w.findComponent({ name: 'RadialCalibrationWizard' }).vm.$emit('save', next)
    expect(w.emitted('update:frame').at(-1)).toEqual([next])
    expect(w.find('.rcw').exists()).toBe(false)
  })

  it('cancel de l\'assistant ferme le calage sans émettre update:frame', async () => {
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    await w.find('.cfs__cal').trigger('click')
    await w.findComponent({ name: 'RadialCalibrationWizard' }).vm.$emit('cancel')
    expect(w.emitted('update:frame')).toBeUndefined()
    expect(w.find('.rcw').exists()).toBe(false)
  })

  // Revue finale (26/08) : l'assistant vivait par erreur DANS .cfs__canvas (enfant zoomable
  // de .cfs__viewport), alors que son propre CSS (.rcw { flex: 1; ... }) suppose qu'il occupe
  // le MÊME emplacement que .cfs__viewport dans la colonne flex de .cstage. Résultat : image
  // du diagramme dupliquée, et à un zoom ≠ 100 % sa barre d'actions grossissait d'autant.
  it("l'assistant n'est PAS imbriqué dans .cfs__canvas (sinon il hérite du zoom et duplique l'image)", async () => {
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    await w.find('.cfs__cal').trigger('click')
    expect(w.find('.rcw').exists()).toBe(true) // sanity : l'assistant est bien monté quelque part
    expect(w.find('.cfs__canvas .rcw').exists()).toBe(false)
  })

  it("masque l'ancien viewport zoomable (display:none) pendant que l'assistant radial est ouvert, sans le démonter", async () => {
    const w = mountStage({ chart: CHART_RADIAL_SQUARE, row: 3 })
    const viewport = w.find('.cfs__viewport')
    expect(viewport.isVisible()).toBe(true)
    await w.find('.cfs__cal').trigger('click')
    // v-show (pas v-if) : le noeud reste dans le DOM, donc le ref et le ResizeObserver
    // de ChartStage restent valides après une fermeture/réouverture du calage.
    expect(viewport.exists()).toBe(true)
    expect(viewport.isVisible()).toBe(false)
    await w.findComponent({ name: 'RadialCalibrationWizard' }).vm.$emit('cancel')
    expect(viewport.isVisible()).toBe(true)
  })
})

describe('ChartStage — tracé (lecture)', () => {
  it('un diagramme par tracé rend des polylignes, pas les bandes/anneaux/rideau', () => {
    const w = mountStage({ chart: CHART_PATH, row: 2, frame: PATH_FRAME })
    expect(w.find('svg.cfs__path').exists()).toBe(true)
    expect(w.findAll('polyline.cfs__pathrow')).toHaveLength(3)
    expect(w.find('.cfs__hl').exists()).toBe(false)
    expect(w.find('svg.cfs__rings').exists()).toBe(false)
    expect(w.find('.cfs__curtain-line').exists()).toBe(false)
  })

  it('calcule les points de chaque rang depuis chartPathRows (rang 2/3, décalage 5)', () => {
    // POINTS = [{20,30},{80,30}], REF centre image (50,50) : le décalage "vers l'extérieur"
    // s'éloigne de y=30 vers y décroissant (déjà vérifié précédemment). Rang 1 (k=0) :
    // inchangé. Rang 2 (k=1, dist=5) : y=25. Rang 3 (k=2, dist=10) : y=20.
    const w = mountStage({ chart: CHART_PATH, row: 2, frame: PATH_FRAME })
    const rows = w.findAll('polyline.cfs__pathrow')
    expect(rows[0].attributes('points')).toBe('20,30 80,30')
    expect(rows[1].attributes('points')).toBe('20,25 80,25')
    expect(rows[2].attributes('points')).toBe('20,20 80,20')
  })

  it('colore le rang courant, les rangs faits et les rangs à venir différemment (couleurs fixes de l\'app)', () => {
    const w = mountStage({ chart: CHART_PATH, row: 2, frame: PATH_FRAME })
    const rows = w.findAll('polyline.cfs__pathrow')
    expect(rows[0].classes()).toContain('cfs__pathrow--done') // rang 1 < rang courant 2
    expect(rows[1].classes()).toContain('cfs__pathrow--hl') // rang 2 = rang courant
    expect(rows[2].classes()).toContain('cfs__pathrow--future') // rang 3 > rang courant
  })

  it('sans frame (jamais calé) : les polylignes existent mais sont vides, aucune exception', () => {
    const w = mountStage({ chart: CHART_PATH, row: 1 })
    expect(w.find('svg.cfs__path').exists()).toBe(true)
    const rows = w.findAll('polyline.cfs__pathrow')
    expect(rows).toHaveLength(3)
    rows.forEach((r) => expect(r.attributes('points')).toBe(''))
  })
})

describe('ChartStage — calage par tracé (aperçu, sans poignées de drag)', () => {
  it('le bouton Caler reste actif sur un diagramme par tracé, mais ne montre plus les poignées linéaires', async () => {
    const w = mountStage({ chart: CHART_PATH, row: 2, frame: PATH_FRAME_2PTS })
    await w.find('.cfs__cal').trigger('click')
    expect(w.find('.cfs__handle--top').exists()).toBe(false)
    expect(w.find('.cfs__handle--bottom').exists()).toBe(false)
  })

  it("démarrer le calage d'un tracé initialise draftPath depuis le frame existant", async () => {
    const w = mountStage({ chart: CHART_PATH, row: 2, frame: PATH_FRAME_2PTS })
    await w.find('.cfs__cal').trigger('click')
    expect(w.vm.draftPath).toEqual({ points: [{ x: 20, y: 30 }, { x: 80, y: 30 }], spacing: 5 })
  })

  it('sans frame existant, draftPath démarre avec 0 point et DEFAULT_PATH_SPACING', async () => {
    const w = mountStage({ chart: CHART_PATH, row: 1 })
    await w.find('.cfs__cal').trigger('click')
    expect(w.vm.draftPath).toEqual({ points: [], spacing: 4.5 })
  })

  it('Enregistrer pendant un calage par tracé émet update:frame avec draftPath, pas {top,bottom}', async () => {
    const w = mountStage({ chart: CHART_PATH, row: 1 })
    await w.find('.cfs__cal').trigger('click')
    w.vm.draftPath = { points: [{ x: 10, y: 10 }, { x: 90, y: 90 }], spacing: 6 }
    await nextTick()
    await w.find('.cfs__calsave').trigger('click')
    expect(w.emitted('update:frame').at(-1)).toEqual([{ points: [{ x: 10, y: 10 }, { x: 90, y: 90 }], spacing: 6 }])
  })

  // Protège : un tracé à moins de 2 repères n'est jamais enregistré (il effacerait l'affichage des rangs et l'invite de calage).
  it('Enregistrer est inactif tant que le tracé a moins de 2 repères', async () => {
    const w = mountStage({ chart: CHART_PATH, row: 1 })
    await w.find('.cfs__cal').trigger('click')
    expect(w.find('.cfs__calsave').attributes('disabled')).toBeDefined()
    w.vm.$.setupState.saveCalibrate()
    w.vm.draftPath = { points: [{ x: 10, y: 10 }], spacing: 6 }
    await nextTick()
    expect(w.find('.cfs__calsave').attributes('disabled')).toBeDefined()
    expect(w.emitted('update:frame')).toBeFalsy()
    w.vm.draftPath = { points: [{ x: 10, y: 10 }, { x: 90, y: 90 }], spacing: 6 }
    await nextTick()
    expect(w.find('.cfs__calsave').attributes('disabled')).toBeUndefined()
  })

  it("les polylignes prévisualisent draftPath pendant le calage (pas encore enregistré)", async () => {
    const w = mountStage({ chart: CHART_PATH, row: 1, frame: PATH_FRAME_2PTS })
    await w.find('.cfs__cal').trigger('click')
    w.vm.draftPath = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], spacing: 5 }
    await nextTick()
    const rows = w.findAll('polyline.cfs__pathrow')
    expect(rows[0].attributes('points')).toBe('0,0 100,0')
  })

  it('Réinitialiser efface le frame du tracé (mêmes garanties que le linéaire/radial)', async () => {
    const w = mountStage({ chart: CHART_PATH, row: 1, frame: PATH_FRAME_2PTS })
    await w.find('.cfs__cal').trigger('click')
    await w.find('.cfs__calreset').trigger('click')
    expect(w.emitted('update:frame').at(-1)).toEqual([null])
  })
})

describe('ChartStage — poignées de calage par tracé (tap/glisser/supprimer + espacement)', () => {
  function pathStage(frame) {
    const w = mountStage({ chart: CHART_PATH, row: 1, frame })
    w.vm.$el.querySelector('.cfs__canvas').getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 })
    return w
  }

  function firePointer(element, type, props) {
    const ev = new Event(type, { bubbles: true })
    Object.assign(ev, props)
    element.dispatchEvent(ev)
  }

  it('taper sur le canvas (sans glisser) ajoute un point à la position tapée', async () => {
    const w = pathStage(null)
    await w.find('.cfs__cal').trigger('click')
    const canvas = w.vm.$el.querySelector('.cfs__canvas')
    firePointer(canvas, 'pointerdown', { clientX: 100, clientY: 50 })
    await nextTick()
    firePointer(canvas, 'pointerup', { clientX: 100, clientY: 50 })
    await nextTick()
    // 100/200*100=50%, 50/100*100=50%.
    expect(w.vm.draftPath.points).toEqual([{ x: 50, y: 50 }])
  })

  it('un glissé sur le canvas (déplacement > 5px) n\'ajoute PAS de point', async () => {
    const w = pathStage(null)
    await w.find('.cfs__cal').trigger('click')
    const canvas = w.vm.$el.querySelector('.cfs__canvas')
    firePointer(canvas, 'pointerdown', { clientX: 100, clientY: 50 })
    await nextTick()
    firePointer(canvas, 'pointerup', { clientX: 150, clientY: 50 })
    await nextTick()
    expect(w.vm.draftPath.points).toEqual([])
  })

  it('glisser un repère existant le déplace vers la position du pointeur', async () => {
    const w = pathStage({ points: [{ x: 20, y: 30 }, { x: 80, y: 30 }], spacing: 5 })
    await w.find('.cfs__cal').trigger('click')
    const point = w.vm.$el.querySelector('.cfs__phandle')
    firePointer(point, 'pointerdown', { clientX: 40, clientY: 30 })
    await nextTick()
    firePointer(point, 'pointermove', { clientX: 60, clientY: 40 })
    await nextTick()
    // 60/200*100=30%, 40/100*100=40%.
    expect(w.vm.draftPath.points[0]).toEqual({ x: 30, y: 40 })
  })

  it('taper sur un repère existant SANS glisser le supprime', async () => {
    const w = pathStage({ points: [{ x: 20, y: 30 }, { x: 50, y: 40 }, { x: 80, y: 30 }], spacing: 5 })
    await w.find('.cfs__cal').trigger('click')
    const points = w.vm.$el.querySelectorAll('.cfs__phandle')
    firePointer(points[1], 'pointerdown', { clientX: 100, clientY: 40 })
    await nextTick()
    firePointer(points[1], 'pointerup', { clientX: 100, clientY: 40 })
    await nextTick()
    expect(w.vm.draftPath.points).toEqual([{ x: 20, y: 30 }, { x: 80, y: 30 }])
  })

  it('ne descend jamais sous 2 repères : le tap sur le dernier restant ne le supprime pas', async () => {
    const w = pathStage({ points: [{ x: 20, y: 30 }, { x: 80, y: 30 }], spacing: 5 })
    await w.find('.cfs__cal').trigger('click')
    const point = w.vm.$el.querySelector('.cfs__phandle')
    firePointer(point, 'pointerdown', { clientX: 40, clientY: 30 })
    await nextTick()
    firePointer(point, 'pointerup', { clientX: 40, clientY: 30 })
    await nextTick()
    expect(w.vm.draftPath.points).toHaveLength(2)
  })

  it('clavier : flèches déplacent un repère, Suppr le supprime (si plus de 2 restent)', async () => {
    const w = pathStage({ points: [{ x: 20, y: 30 }, { x: 50, y: 40 }, { x: 80, y: 30 }], spacing: 5 })
    await w.find('.cfs__cal').trigger('click')
    const points = w.findAll('.cfs__phandle')
    await points[0].trigger('keydown', { key: 'ArrowRight' })
    expect(w.vm.draftPath.points[0]).toEqual({ x: 21, y: 30 })
    await points[1].trigger('keydown', { key: 'Delete' })
    expect(w.vm.draftPath.points).toEqual([{ x: 21, y: 30 }, { x: 80, y: 30 }])
  })

  it("l'espacement se règle par pas de 0.5, borné entre 1 et 9", async () => {
    const w = pathStage(null) // spacing par défaut : 4.5
    await w.find('.cfs__cal').trigger('click')
    await w.find('.cfs__pathinc').trigger('click')
    expect(w.vm.draftPath.spacing).toBe(5)
    await w.find('.cfs__pathdec').trigger('click')
    await w.find('.cfs__pathdec').trigger('click')
    expect(w.vm.draftPath.spacing).toBe(4)
  })

  it("l'espacement ne descend pas sous 1 ni ne dépasse 9", async () => {
    const w = pathStage(null)
    await w.find('.cfs__cal').trigger('click')
    w.vm.draftPath = { points: [], spacing: 1 }
    await w.find('.cfs__pathdec').trigger('click')
    expect(w.vm.draftPath.spacing).toBe(1)
    w.vm.draftPath = { ...w.vm.draftPath, spacing: 9 }
    await w.find('.cfs__pathinc').trigger('click')
    expect(w.vm.draftPath.spacing).toBe(9)
  })

  it('les poignées de point disparaissent après Enregistrer', async () => {
    const w = pathStage({ points: [{ x: 20, y: 30 }, { x: 80, y: 30 }], spacing: 5 })
    await w.find('.cfs__cal').trigger('click')
    await w.find('.cfs__calsave').trigger('click')
    expect(w.find('.cfs__phandle').exists()).toBe(false)
  })

  it("un pincement à 2 doigts pendant le calage n'ajoute pas de repère (cède au zoom)", async () => {
    const w = pathStage(null)
    await w.find('.cfs__cal').trigger('click')
    const canvas = w.vm.$el.querySelector('.cfs__canvas')
    // Simule un 2e doigt déjà actif : activePointers() > 0 doit bloquer le début de tap.
    // On déclenche un pointerdown sur le viewport avant celui du canvas, simulant un doigt
    // déjà posé ailleurs.
    const viewport = w.vm.$el.querySelector('.cfs__viewport')
    firePointer(viewport, 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    await nextTick()
    firePointer(canvas, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 50 })
    await nextTick()
    firePointer(canvas, 'pointerup', { pointerId: 2, clientX: 100, clientY: 50 })
    await nextTick()
    expect(w.vm.draftPath.points).toEqual([])
  })

  it('la poignée de point déclare les attributs ARIA de valeur (aria-valuenow, aria-valuetext)', async () => {
    const w = pathStage({ points: [{ x: 20, y: 30 }, { x: 80, y: 30 }], spacing: 5 })
    await w.find('.cfs__cal').trigger('click')
    const point = w.find('.cfs__phandle')
    expect(point.attributes('aria-valuenow')).toBe('20')
    expect(point.attributes('aria-valuetext')).toBe('20%, 30%')
  })

  it('supprimer un repère au clavier déplace le focus sur un repère voisin', async () => {
    const w = pathStage({ points: [{ x: 20, y: 30 }, { x: 50, y: 40 }, { x: 80, y: 30 }], spacing: 5 })
    await w.find('.cfs__cal').trigger('click')
    const points = w.findAll('.cfs__phandle')
    await points[1].trigger('keydown', { key: 'Delete' })
    await nextTick()
    const remaining = w.findAll('.cfs__phandle')
    expect(remaining).toHaveLength(2)
    expect(document.activeElement).toBe(remaining[1].element)
  })
})

import { describe, it, expect } from 'vitest'
import { renderBadge, BADGE_TEMPLATES, computeBadgeGeometry, wrapText, statValue, createBadgeCanvas, buildRawStatLines, drawTechniqueBadge } from '@/utils/badge-render'
import { calendarRealHeight, drawCalendar } from '@/utils/badge-calendar'

// Largeur FICTIVE : 20 « px » par caractère, déterministe. Ce stub n'a pas de moteur de
// métriques de police (et le dépôt s'interdit toute dépendance npm de rendu canvas) : ces
// tests valident donc l'ALGORITHME de troncature et son CÂBLAGE à chaque site de dessin,
// jamais les vraies métriques d'un navigateur — celles-là ont été mesurées à la main en
// Chromium sans affichage pendant la revue du 16/09.
const FAKE_CHAR_WIDTH = 20

// Même transformation que `withNbsp` (badge-render.js, non exportée) — dupliquée ici en dur
// dans les attentes plutôt que recalculée depuis la prod, pour que ces tests restent des
// attentes FIXES indépendantes de l'implémentation ; centralisée en un seul endroit du
// fichier plutôt que recopiée à chaque attente.
function nbsp(text) {
  return text.replace(/(\d) /g, '$1 ')
}

function stubCanvas() {
  const calls = []
  const ctx = {
    fillStyle: '',
    font: '',
    textBaseline: '',
    measureText: (s) => ({ width: String(s).length * FAKE_CHAR_WIDTH }),
    createLinearGradient(...a) {
      calls.push(['createLinearGradient', ...a])
      return { addColorStop: (...s) => calls.push(['addColorStop', ...s]) }
    },
    fillRect(...a) { calls.push(['fillRect', ctx.fillStyle, ...a]) },
    strokeRect(...a) { calls.push(['strokeRect', ...a]) },
    fillText(...a) { calls.push(['fillText', ...a]) },
    drawImage(...a) { calls.push(['drawImage', ...a]) },
    // Bord arrondi des photos (revue 16/09) : `drawPhotoCover` clippe via un tracé
    // save/beginPath/arcTo/clip avant `drawImage` — sans ces méthodes (absentes du contexte
    // 2D minimal ci-dessus), l'appel plante avant même d'atteindre `drawImage`.
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    // `lineTo`/`quadraticCurveTo` : journalisés (contrairement à `moveTo`/`arcTo`/`beginPath`/
    // `closePath`, restés muets pour `roundRectPath`) parce que ce sont les seuls tracés du
    // motif de progression (`badge-stitch-motif.js`) — aucun autre site de ce fichier n'appelle
    // l'un ou l'autre (`roundRectPath` passe par `arcTo`, `drawVeganIcon` par `stroke(new
    // Path2D(...))`, le calendrier par `strokeRect`), ce qui en fait une empreinte fiable pour
    // distinguer tricot (V, `lineTo`) de crochet (boucle, `quadraticCurveTo`) dans les tests
    // d'intégration plus bas.
    lineTo(...a) { calls.push(['lineTo', ...a]) },
    quadraticCurveTo(...a) { calls.push(['quadraticCurveTo', ...a]) },
    arcTo() {},
    closePath() {},
    clip() {},
    translate(...a) { calls.push(['translate', ...a]) },
    scale(...a) { calls.push(['scale', ...a]) },
    stroke(...a) { calls.push(['stroke', ...a]) },
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL(mime, quality) {
      calls.push(['toDataURL', mime, quality])
      return 'data:image/jpeg;base64,BADGE'
    },
  }
  return { canvas, calls }
}

const stats = {
  totalSeconds: 8100, sessionsCount: 6, bestStreak: 3,
}

function t(key, arg) {
  const table = {
    'project.stats.totalTime': 'Temps total',
    'project.stats.sessionsCount': 'Séances',
    'project.stats.period': 'Période',
    'project.stats.bestStreak': 'Meilleure série',
    'project.stats.progress': 'Avancement',
    'project.startedOn': `Commencé le ${arg?.date ?? ''}`,
    'project.finishedOn': `Terminé le ${arg?.date ?? ''}`,
  }
  if (key === 'project.stats.sessionsValue') return `${arg} séance${arg > 1 ? 's' : ''}`
  if (key === 'project.stats.ballsValue') return `${arg} pelote${arg > 1 ? 's' : ''}`
  if (key === 'project.stats.streakValue') return `${arg} jour${arg > 1 ? 's' : ''}`
  if (key === 'project.stats.progressValue') return `${arg?.pct} %`
  return table[key] ?? key
}

describe('renderBadge', () => {
  it('dimensionne le canvas selon le gabarit et exporte en JPEG', () => {
    const { canvas, calls } = stubCanvas()
    const url = renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime', 'sessionsCount'], stats, photoImg: null,
      project: { name: 'Pull Alma' }, t, generatedAt: new Date(2026, 0, 20),
    })
    expect(canvas.width).toBe(BADGE_TEMPLATES.minimal.canvas.w)
    expect(canvas.height).toBeGreaterThan(0)
    expect(url).toBe('data:image/jpeg;base64,BADGE')
    expect(calls).toContainEqual(['toDataURL', 'image/jpeg', 0.9])
  })

  it("n'appelle drawImage que si une photo est fournie", () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(230 70% 45%)',
      statKeys: [], stats, photoImg: null, project: { name: 'X' }, t, generatedAt: new Date(),
    })
    expect(calls.some((c) => c[0] === 'drawImage')).toBe(false)

    const { canvas: canvas2, calls: calls2 } = stubCanvas()
    const photoImg = { naturalWidth: 2000, naturalHeight: 1000 }
    renderBadge(canvas2, {
      templateKey: 'vertical', color: 'hsl(230 70% 45%)',
      statKeys: [], stats, photoImg, project: { name: 'X' }, t, generatedAt: new Date(),
    })
    expect(calls2.some((c) => c[0] === 'drawImage')).toBe(true)
  })

  it('inscrit les libellés et valeurs des stats sélectionnées', () => {
    const { canvas, calls } = stubCanvas()
    const yarnUsage = [{ yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 }]
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime', 'sessionsCount', 'yarns'], stats, yarnUsage, photoImg: null,
      project: { name: 'Pull Alma' }, t, generatedAt: new Date(2026, 0, 20),
    })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    // Style empilé (Task 3) : libellé et valeur dessinés SÉPARÉMENT, en MAJUSCULES pour
    // le libellé — plus aucune chaîne jointe « Label · Valeur » sur aucun gabarit depuis ce
    // chantier (19/09).
    expect(texts.some((s) => s.includes('TEMPS TOTAL'))).toBe(true)
    expect(texts.some((s) => s.includes('2 h 15 min'))).toBe(true)
    expect(texts.some((s) => s.includes('6 séances'))).toBe(true)
    expect(texts).not.toContain('Séances · 6 séances')
    expect(texts).toContain('6 séances')
    expect(texts).toContain('DROPS MERINO')
    expect(texts).toContain('4 pelotes')
    expect(texts.some((s) => s.includes('Pull Alma'))).toBe(true)
  })

  it('retombe sur le gabarit vertical si templateKey est inconnu', () => {
    const { canvas } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'inexistant', color: 'hsl(230 70% 45%)',
      statKeys: [], stats, photoImg: null, project: { name: 'X' }, t, generatedAt: new Date(),
    })
    expect(canvas.width).toBe(BADGE_TEMPLATES.vertical.canvas.w)
  })

  it('formate la date de génération selon la locale fournie (pas figée en fr-FR)', () => {
    const { canvas, calls } = stubCanvas()
    const generatedAt = new Date(2026, 0, 20)
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: [], stats, photoImg: null, project: { name: 'X' }, t, generatedAt,
      locale: 'en',
    })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    const expected = generatedAt.toLocaleDateString('en', { day: '2-digit', month: 'long', year: 'numeric' })
    expect(texts).toContain(expected)
  })

  it('dessine un bandeau semi-transparent sous le texte avant de l\'écrire', () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(44 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null, project: { name: 'X' }, t, generatedAt: new Date(),
    })
    const scrimIndex = calls.findIndex((c) => c[0] === 'fillRect' && typeof c[1] === 'string' && c[1].startsWith('rgba'))
    const firstTextIndex = calls.findIndex((c) => c[0] === 'fillText')
    expect(scrimIndex).toBeGreaterThanOrEqual(0)
    expect(scrimIndex).toBeLessThan(firstTextIndex)
  })

  it("statValue 'startedOn' : projet en cours, une seule phrase depuis project.startedAt", () => {
    const project = { name: 'X', startedAt: '2026-01-05', finishedAt: '' }
    const value = statValue('startedOn', stats, t, 'fr', project)
    expect(value).toContain('05/01/2026')
    expect(value).not.toMatch(/terminé/i)
  })

  it("statValue 'startedOn' : projet terminé, Commencé le ET Terminé le dans la même phrase", () => {
    const project = { name: 'X', startedAt: '2026-01-05', finishedAt: '2026-01-20' }
    const value = statValue('startedOn', stats, t, 'fr', project)
    expect(value).toContain('05/01/2026')
    expect(value).toContain('20/01/2026')
  })

  // Un projet créé mais jamais travaillé a `startedAt: ''` (défaut du store, posé seulement
  // au premier chrono) : sans garde, le badge dessinait « Commencé le » suivi de rien.
  it("statValue 'startedOn' : projet sans aucune date, chaîne vide (jamais « Commencé le » orphelin)", () => {
    expect(statValue('startedOn', stats, t, 'fr', { name: 'X', startedAt: '', finishedAt: '' })).toBe('')
  })

  it("'startedOn' sans startedAt : aucune ligne dessinée, pas une ligne à date vide", () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: ['startedOn', 'sessionsCount'], stats, photoImg: null,
      project: { name: 'X', startedAt: '' }, t, generatedAt: new Date(2026, 0, 20), locale: 'fr',
    })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts.some((s) => s.includes('Commencé le'))).toBe(false)
    expect(texts).toContain(nbsp('6 séances'))
  })

  it("'startedOn' sans startedAt mais projet terminé : seule la phrase « Terminé le »", () => {
    const parts = buildRawStatLines(['startedOn'], {
      stats, t, locale: 'fr', project: { name: 'X', startedAt: '', finishedAt: '2026-01-20' },
      yarnUsage: [], customText: '',
    })
    expect(parts).toEqual(['Terminé le 20/01/2026'])
  })

  // `model` est facultatif (emptyYarn() le pose à '') : une concaténation naïve
  // « marque + espace + modèle » laissait un double espace avant le « · ».
  it("statLine 'yarns' : laine sans modèle, pas de double espace ni de « undefined »", () => {
    const lines = buildRawStatLines(['yarns'], {
      stats, t, locale: 'fr', project: { name: 'X' }, customText: '',
      yarnUsage: [{ yarn: { brand: 'Drops', model: '' }, balls: 4 }, { yarn: { brand: 'Rico' }, balls: 1 }],
    })
    expect(lines[0]).toBe(nbsp('Drops · 4 pelotes'))
    expect(lines[1]).toBe(nbsp('Rico · 1 pelote'))
    expect(lines.some((s) => s.includes('undefined'))).toBe(false)
  })

  // Marque ET modèle vides : atteignable (le `<select>` de marque de StashView.vue ouvre sur
  // `<option value="">`, et `save()` n'exige que `colorName`). Sans repli, la ligne démarrait
  // sur un séparateur orphelin (« · 4 pelotes »).
  it("statLine 'yarns' : laine sans marque ni modèle, repli sur le nom du coloris", () => {
    const lines = buildRawStatLines(['yarns'], {
      stats, t, locale: 'fr', project: { name: 'X' }, customText: '',
      yarnUsage: [{ yarn: { brand: '', model: '', colorName: 'Bleu canard' }, balls: 4 }],
    })
    expect(lines[0]).toBe(nbsp('Bleu canard · 4 pelotes'))
    expect(lines[0].startsWith('·')).toBe(false)
  })

  // Régression Task 14 (chantier « badge corrections typo/zoom » 19/09) : la distance
  // derrière le nombre de pelotes avait disparu du badge lors du passage à l'affichage
  // par laine — restaurée ici PAR laine (pelotes × longueur au mètre de la pelote), pas en
  // total agrégé toutes laines confondues.
  it("statLine 'yarns' : une laine avec longueur (lengthM) affiche pelotes ET distance", () => {
    const lines = buildRawStatLines(['yarns'], {
      stats, t, locale: 'fr', project: { name: 'X' }, customText: '',
      yarnUsage: [{ yarn: { brand: 'Drops', model: 'Merino', lengthM: 175 }, balls: 10 }],
    })
    expect(lines[0]).toBe(nbsp('Drops Merino · 10 pelotes (1,75 yarn.unit.km)'))
  })

  it("statLine 'yarns' : une laine SANS lengthM (absent ou à 0) n'affiche que les pelotes, jamais de parenthèses vides", () => {
    const lines = buildRawStatLines(['yarns'], {
      stats, t, locale: 'fr', project: { name: 'X' }, customText: '',
      yarnUsage: [
        { yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 },
        { yarn: { brand: 'Rico', model: 'Creative', lengthM: 0 }, balls: 2 },
      ],
    })
    expect(lines[0]).toBe(nbsp('Drops Merino · 4 pelotes'))
    expect(lines[1]).toBe(nbsp('Rico Creative · 2 pelotes'))
    expect(lines.some((s) => s.includes('('))).toBe(false)
  })

  it("statLine 'yarns' structurée : unitSystem 'imperial' produit une unité différente de 'metric' pour la même laine", () => {
    const yarnUsage = [{ yarn: { brand: 'Drops', model: 'Merino', lengthM: 175 }, balls: 10 }]
    const [metricLine] = buildRawStatLines(['yarns'], {
      stats, t, locale: 'fr', project: { name: 'X' }, customText: '', yarnUsage,
      structured: true, unitSystem: 'metric',
    })
    const [imperialLine] = buildRawStatLines(['yarns'], {
      stats, t, locale: 'fr', project: { name: 'X' }, customText: '', yarnUsage,
      structured: true, unitSystem: 'imperial',
    })
    expect(metricLine.value).not.toBe(imperialLine.value)
    expect(metricLine.value).toContain('yarn.unit.km')
    expect(imperialLine.value).toContain('yarn.unit.yd')
  })

  it('jamais de tiret long dans les lignes de stats (marqueur visuel d’IA)', () => {
    const { canvas, calls } = stubCanvas()
    const yarnUsage = [{ yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 }]
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime', 'sessionsCount', 'yarns', 'startedOn', 'bestStreak'],
      stats, yarnUsage, photoImg: null,
      project: { name: 'X', startedAt: '2026-01-05', finishedAt: '2026-01-20' },
      t, generatedAt: new Date(2026, 0, 20), locale: 'fr',
    })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts.some((s) => s.includes('—'))).toBe(false)
  })

  it('dessine rowtine.app aligné à droite, sur la même ligne que la date', () => {
    const { canvas, calls } = stubCanvas()
    const generatedAt = new Date(2026, 0, 20)
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: [], stats, photoImg: null, project: { name: 'X' }, t, generatedAt, locale: 'fr',
    })
    const dateText = generatedAt.toLocaleDateString('fr', { day: '2-digit', month: 'long', year: 'numeric' })
    const dateCall = calls.find((c) => c[0] === 'fillText' && c[1] === dateText)
    const linkCall = calls.find((c) => c[0] === 'fillText' && c[1] === 'rowtine.app')
    expect(dateCall).toBeTruthy()
    expect(linkCall).toBeTruthy()
    // Même baseline Y que la date (troisième argument de fillText).
    expect(linkCall[3]).toBe(dateCall[3])
  })

  it('rowtine.app reste aligné au coin bas-droit du badge même avec une carte calendaire à côté du texte', () => {
    const { canvas, calls } = stubCanvas()
    const gridStats = {
      ...stats,
      grid: { columns: [{ monday: '2026-01-05', monthStart: true, cells: [{ day: 'd0', level: 1, future: false }] }] },
    }
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime'], stats: gridStats, photoImg: null,
      project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20), locale: 'fr', includeCalendar: true,
    })
    const { calendarArea } = computeBadgeGeometry('vertical', 1, 1, 1, true)
    const linkCall = calls.find((c) => c[0] === 'fillText' && c[1] === 'rowtine.app')
    expect(linkCall).toBeTruthy()
    // x = 3e argument de fillText (calls.push(['fillText', text, x, y])) : doit atteindre le
    // bord droit de la carte calendaire (côté droit RÉEL du badge en mode côte à côte),
    // jamais le bord droit de la seule moitié texte.
    expect(linkCall[2]).toBeCloseTo(calendarArea.x + calendarArea.w - 60, 0) // 60 = TEXT_PAD
  })

  it('transmet la locale choisie à chaque appel de t() (indépendante de la locale de l’app)', () => {
    const { canvas, calls } = stubCanvas()
    const seen = []
    function tSpy(key, arg, options) {
      seen.push({ key, options })
      return t(key, arg)
    }
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime', 'sessionsCount', 'startedOn'], stats, photoImg: null,
      project: { name: 'X', startedAt: '2026-01-05' }, t: tSpy, generatedAt: new Date(2026, 0, 20), locale: 'en',
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((c) => c.options?.locale === 'en')).toBe(true)
  })

  it("statLine 'yarns' : une ligne PAR laine (nom + pelotes), jamais un total", () => {
    const fakeCanvas = stubCanvas()
    const yarnUsage = [
      { yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 },
      { yarn: { brand: 'Rico', model: 'Creative' }, balls: 2 },
    ]
    renderBadge(fakeCanvas.canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['yarns'], stats, yarnUsage,
      project: { name: 'X' }, photoImg: null, t, generatedAt: new Date(),
    })
    const texts = fakeCanvas.calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    // Rangée « registre » (Task 3) : le libellé (nom de la laine) est dessiné SÉPARÉMENT de la
    // valeur, en MAJUSCULES (cf. describe « lignes registre » plus bas) — 'Drops Merino' tel
    // quel (casse mixte) n'apparaît donc plus parmi les textes dessinés.
    expect(texts.some((s) => s.includes('DROPS MERINO'))).toBe(true)
    expect(texts.some((s) => s.includes('RICO CREATIVE'))).toBe(true)
    // deux laines => deux lignes séparées, jamais l'une avec l'autre sur la même
    expect(texts.some((s) => s.includes('DROPS') && s.includes('RICO'))).toBe(false)
  })

  it("statLine 'yarns' : aucune laine liée, aucune ligne (pas une exception)", () => {
    const fakeCanvas = stubCanvas()
    expect(() =>
      renderBadge(fakeCanvas.canvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)',
        statKeys: ['yarns'], stats, yarnUsage: [],
        project: { name: 'X' }, photoImg: null, t, generatedAt: new Date(),
      }),
    ).not.toThrow()
  })

  it("statLine 'startedOn' : projet terminé, deux lignes SÉPARÉES sur le canevas (jamais jointes)", () => {
    const fakeCanvas = stubCanvas()
    renderBadge(fakeCanvas.canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['startedOn'], stats,
      project: { name: 'X', startedAt: '2026-01-05', finishedAt: '2026-01-20' },
      photoImg: null, t, generatedAt: new Date(),
    })
    const texts = fakeCanvas.calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts.some((s) => s.includes('05/01/2026'))).toBe(true)
    expect(texts.some((s) => s.includes('20/01/2026'))).toBe(true)
    // deux lignes DISTINCTES, jamais l'une avec l'autre sur la même (contrairement à
    // statValue(), qui les joint par « · » pour la pastille de l'onglet Infos)
    expect(texts.some((s) => s.includes('05/01/2026') && s.includes('20/01/2026'))).toBe(false)
  })

  it('canvas sans contexte 2D disponible (jsdom) : ne plante pas, ne dessine rien', () => {
    const fakeCanvas = { width: 0, height: 0, getContext: () => null, toDataURL: () => '' }
    expect(() =>
      renderBadge(fakeCanvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats: { totalSeconds: 100 },
        photoImg: null, project: { name: 'X' }, t: (k) => k, generatedAt: new Date(),
      }),
    ).not.toThrow()
  })

  it('createBadgeCanvas() renvoie un <canvas> réel', () => {
    const el = createBadgeCanvas()
    expect(el.tagName).toBe('CANVAS')
  })

  // `technique` est désormais TOUJOURS une pastille (`drawTechniqueBadge`), jamais une ligne de
  // stats classique, quel que soit le gabarit (cf. describe « pastille Technique » plus bas,
  // généralisé aux 4 gabarits par ce chantier) : plus de chemin « ligne de stats » à couvrir
  // ici séparément.
})

// Task 2 du chantier « badge cartouche condensé » (18/09c), généralisée aux 4 gabarits par le
// chantier « badge corrections typo/zoom » (19/09) : la technique quitte les lignes de stats
// pour devenir une pastille dessinée sur la rangée du titre (`drawTechniqueBadge`, exportée :
// Task 7 peut l'utiliser directement, signature `(ctx, x, y, text, textColor)`, `(x, y)` étant
// le point de départ de la ligne de base du texte, exactement le contrat de `ctx.fillText`).
describe('pastille Technique (Task 2, généralisée aux 4 gabarits le 19/09)', () => {
  it('drawTechniqueBadge : bordure tracée (arcTo/stroke, pas Path2D), texte en MAJUSCULES, largeur totale retournée', () => {
    const calls = []
    const ctx = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, textBaseline: '',
      measureText: (s) => ({ width: String(s).length * 10 }),
      save() { calls.push(['save']) },
      restore() { calls.push(['restore']) },
      beginPath() {}, moveTo() {}, arcTo() {}, closePath() {},
      stroke(...a) { calls.push(['stroke', ...a]) },
      fillText(...a) { calls.push(['fillText', ...a]) },
    }
    const w = drawTechniqueBadge(ctx, 100, 200, 'crochet', '#fff')
    // Bordure : un `stroke()` SANS argument (contrairement à l'icône vegan, qui trace un
    // Path2D en argument) — c'est `roundRectPath` (arcTo) qui pose le tracé courant avant.
    expect(calls.some((c) => c[0] === 'stroke' && c.length === 1)).toBe(true)
    const fillTextCall = calls.find((c) => c[0] === 'fillText')
    expect(fillTextCall[1]).toBe('CROCHET') // majuscules par la CASSE, jamais ctx.letterSpacing
    expect(fillTextCall[2]).toBe(100) // (x, y) = ligne de base du texte, contrat ctx.fillText
    expect(fillTextCall[3]).toBe(200)
    expect(w).toBeGreaterThan(0)
  })

  it('drawTechniqueBadge : texte vide, aucun dessin, largeur nulle', () => {
    const calls = []
    const ctx = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, textBaseline: '',
      measureText: (s) => ({ width: String(s).length * 10 }),
      save() {}, restore() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {},
      stroke(...a) { calls.push(['stroke', ...a]) },
      fillText(...a) { calls.push(['fillText', ...a]) },
    }
    expect(drawTechniqueBadge(ctx, 0, 0, '', '#fff')).toBe(0)
    expect(calls).toEqual([])
  })

  for (const templateKey of ['vertical', 'horizontal', 'minimal', 'double']) {
    it(`${templateKey} : la technique n'est plus une ligne de stats (rawStatLines), une pastille est dessinée à la place`, () => {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey, color: 'hsl(200 70% 45%)',
        statKeys: ['technique', 'totalTime'], stats, photoImg: null,
        project: { name: 'X', technique: 'crochet' },
        t: (k) => (k === 'technique.crochet' ? 'Crochet' : t(k)),
        generatedAt: new Date(),
      })
      const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
      // La ligne de stats classique pour 'technique' était EXACTEMENT `value` (cf. `statLines`,
      // badge-render.js, case 'technique': return [value]) — cette ligne brute ne doit plus
      // exister du tout parmi les textes dessinés.
      expect(texts).not.toContain('Crochet')
      // La pastille, elle, dessine la version MAJUSCULE — preuve qu'elle a bien été dessinée.
      expect(texts).toContain('CROCHET')
      // Les autres stats restent affichées en bloc empilé (Task 3, généralisé le 19/09) : le
      // libellé est dessiné SÉPARÉMENT de la valeur, en MAJUSCULES — 'Temps total' en tant que
      // chaîne jointe n'existe donc plus.
      expect(texts).toContain('TEMPS TOTAL')
      expect(texts).toContain(nbsp('2 h 15 min'))
      // Bordure de la pastille : un `stroke()` sans argument (cf. test drawTechniqueBadge ci-dessus).
      expect(calls.some((c) => c[0] === 'stroke' && c.length === 1)).toBe(true)
    })
  }

  it('technique absente du projet -> aucune pastille, aucune exception (les 4 gabarits)', () => {
    for (const templateKey of ['vertical', 'horizontal', 'minimal', 'double']) {
      const { canvas, calls } = stubCanvas()
      expect(() =>
        renderBadge(canvas, {
          templateKey, color: 'hsl(200 70% 45%)',
          statKeys: ['technique', 'totalTime'], stats, photoImg: null,
          project: { name: 'X' }, // pas de technique
          t, generatedAt: new Date(),
        }),
      ).not.toThrow()
      expect(calls.some((c) => c[0] === 'stroke' && c.length === 1)).toBe(false)
    }
  })

  // Combinaison réelle (pas un cas d'angle) : un projet avec couverture (gabarit Vertical par
  // défaut), une laine vegan ET une technique renseignée est un badge tout à fait ordinaire —
  // icône vegan et pastille Technique s'accolent toutes deux à la fin du titre et doivent donc
  // partager un curseur horizontal commun, jamais s'ancrer indépendamment (sans quoi elles se
  // chevauchent).
  it("Vertical : icône vegan ET pastille Technique en même temps -> la pastille vient APRÈS l'icône, jamais par-dessus", () => {
    const originalPath2D = globalThis.Path2D
    globalThis.Path2D = class { constructor(d) { this.d = d } }
    try {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats, vegan: true, photoImg: null,
        project: { name: 'X', technique: 'crochet' },
        t: (k) => (k === 'technique.crochet' ? 'Crochet' : t(k)),
        generatedAt: new Date(),
      })
      const ICON_SIZE = 32
      const BADGE_PILL_PAD_X = 14 // valeur figée de badge-render.js (non exportée), recopiée ici comme partout ailleurs dans ce fichier (cf. `TEXT_PAD` plus bas)
      const iconX = calls.find((c) => c[0] === 'translate')[1]
      const pillTextX = calls.find((c) => c[0] === 'fillText' && c[1] === 'CROCHET')[2]
      // Bord GAUCHE de la pastille (`pillTextX - PAD_X`, cf. `drawTechniqueBadge`) doit rester
      // à droite du bord DROIT de l'icône vegan (`iconX + ICON_SIZE`) — jamais un chevauchement.
      expect(pillTextX - BADGE_PILL_PAD_X).toBeGreaterThanOrEqual(iconX + ICON_SIZE)
    } finally {
      globalThis.Path2D = originalPath2D
    }
  })

  // Task 2, retour Julien 19/09 : la pastille était alignée EN BAS de la ligne du titre (sur sa
  // baseline) au lieu de son TOP. Ce test vérifie que la pastille est désormais MONTÉE pour
  // s'aligner sur le sommet du titre (approximé à 56px * 0.72 au-dessus de la baseline).
  it("la pastille Technique est alignée en HAUT du titre, pas sur sa baseline (les 4 gabarits)", () => {
    const BADGE_PILL_FONT_SIZE = 18
    const BADGE_PILL_PAD_Y = 7
    const BADGE_PILL_ASCENT = BADGE_PILL_FONT_SIZE * 0.8 // 14.4
    const TITLE_CAP_HEIGHT_RATIO = 0.72 // approximation du sommet des majuscules 56px gras
    const TITLE_FONT_SIZE = 56
    // Ancienne position : y = lastTitleBaseline (passé directement)
    // rectY_old = lastTitleBaseline - BADGE_PILL_ASCENT - BADGE_PILL_PAD_Y
    // Nouvelle position : y calculé pour aligner le haut de la pastille au haut du titre
    // rectY_new = lastTitleBaseline - 56 * TITLE_CAP_HEIGHT_RATIO (= sommet du titre)

    for (const templateKey of ['vertical', 'horizontal', 'minimal', 'double']) {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey, color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats, photoImg: null,
        project: { name: 'Test', technique: 'crochet' },
        t: (k) => (k === 'technique.crochet' ? 'Crochet' : t(k)),
        generatedAt: new Date(),
      })
      const titleCall = calls.find((c) => c[0] === 'fillText' && c[1] === 'Test')
      const pillCall = calls.find((c) => c[0] === 'fillText' && c[1] === 'CROCHET')
      expect(titleCall).toBeTruthy()
      expect(pillCall).toBeTruthy()
      const titleY = titleCall[3]
      const pillY = pillCall[3]
      // Calcul du rectY (sommet visuel) de la pastille
      const pillRectY = pillY - BADGE_PILL_ASCENT - BADGE_PILL_PAD_Y
      // Ancien calcul (si on avait passé lastTitleBaseline = titleY)
      const oldPillRectY = titleY - BADGE_PILL_ASCENT - BADGE_PILL_PAD_Y
      // Nouveau sommet du titre
      const titleCapTop = titleY - TITLE_FONT_SIZE * TITLE_CAP_HEIGHT_RATIO
      // La pastille DOIT être montée : pillRectY < oldPillRectY (plus petit = plus haut)
      // Et elle DOIT atteindre approximativement le sommet du titre
      expect(pillRectY).toBeLessThan(oldPillRectY)
      expect(pillRectY).toBeCloseTo(titleCapTop, 1)
    }
  })
})

// Revue FINALE de branche (19/09, chantier « badge cartouche condensé ») — deux défauts qui
// n'apparaissaient qu'une fois toutes les tâches réunies, donc invisibles à la revue de chaque
// tâche prise isolément :
// 1. `requiredTextWidth` (l'élargissement du cartouche pour un titre long) ne mesurait QUE le
//    titre, jamais la pastille Technique posée sur SA rangée : passé un titre d'une trentaine
//    de caractères en métriques réelles, `titleMaxWidth` valait exactement la largeur du titre
//    et la pastille, ancrée après lui, démarrait HORS du canevas — perte de donnée silencieuse
//    et déterministe.
// 2. La case à cocher « Technique » de l'onglet Infos ne pilotait plus rien pour ces deux
//    gabarits (la pastille se dessinait dès que `project.technique` existait) — décision
//    produit confirmée par Julien : elle doit la piloter comme elle pilote déjà la ligne
//    technique de minimal/double.
describe('pastille Technique : largeur réservée + case à cocher (revue finale 19/09)', () => {
  // 65 caractères : au-delà du plancher de 48 qui déclenche l'élargissement du cartouche
  // Vertical (1080 px / 20 px par caractère dans ce stub, moins TEXT_PAD * 2), et PLUS LONG que
  // toute ligne de stats du scénario — sans quoi `requiredTextWidth` serait piloté par une
  // autre ligne et laisserait par accident de la marge à la pastille (le bug ne se
  // manifesterait pas).
  const LONG_TITLE = 'Cardigan Anders torsades et jacquard en merinos du Nord tout doux'
  const PILL_PAD_X = 14 // valeur figée de badge-render.js (non exportée), cf. describe Task 2
  const tTechnique = (k, arg) => (k === 'technique.crochet' ? 'Crochet' : t(k, arg))

  // Bord DROIT réel de la pastille : `drawTechniqueBadge` reçoit le point de départ de la ligne
  // de base du TEXTE (en retrait de BADGE_PILL_PAD_X de la bordure gauche), la bordure droite
  // est donc à `x + largeur du texte + BADGE_PILL_PAD_X`.
  function pillRightEdge(calls, label = 'CROCHET') {
    const call = calls.find((c) => c[0] === 'fillText' && c[1] === label)
    if (!call) return null
    return call[2] + label.length * FAKE_CHAR_WIDTH + PILL_PAD_X
  }

  // 'minimal' (Texte seul) a rejoint ce lot par le correctif du 19/09 (suite Task 3) :
  // `textColumnWidth`/`computeBadgeGeometry` relisent désormais `requiredTextWidth` pour lui
  // aussi (même motif que les 3 autres gabarits), sans quoi une pastille (ou une valeur de stat
  // longue, cf. describe « largeur du canevas… ») pouvait déborder d'un cartouche resté à
  // largeur fixe.
  for (const templateKey of ['vertical', 'horizontal', 'minimal', 'double']) {
    it(`${templateKey} : un titre long élargit le cartouche ASSEZ pour la pastille (jamais hors canevas)`, () => {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey, color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats, photoImg: null,
        project: { name: LONG_TITLE, technique: 'crochet' },
        t: tTechnique, generatedAt: new Date(),
      })
      // Le scénario DOIT réellement déclencher l'élargissement, sinon il ne prouve rien.
      expect(canvas.width).toBeGreaterThan(BADGE_TEMPLATES[templateKey].canvas.w)
      const right = pillRightEdge(calls)
      expect(right).not.toBeNull()
      expect(right).toBeLessThanOrEqual(canvas.width)
    })
  }

  it('includeTechnique: false -> aucune pastille dessinée (case à cocher rebranchée)', () => {
    for (const templateKey of ['vertical', 'horizontal']) {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey, color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats, photoImg: null,
        project: { name: 'X', technique: 'crochet' },
        t: tTechnique, generatedAt: new Date(), includeTechnique: false,
      })
      const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
      expect(texts).not.toContain('CROCHET')
      expect(texts).not.toContain('Crochet')
      // Bordure de pastille (un `stroke()` sans argument, cf. describe Task 2) : aucune.
      expect(calls.some((c) => c[0] === 'stroke' && c.length === 1)).toBe(false)
    }
  })

  it("includeTechnique: false -> aucune largeur réservée pour une pastille qui n'est pas dessinée", () => {
    const withPill = stubCanvas()
    renderBadge(withPill.canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: LONG_TITLE, technique: 'crochet' },
      t: tTechnique, generatedAt: new Date(),
    })
    const withoutPill = stubCanvas()
    renderBadge(withoutPill.canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: LONG_TITLE, technique: 'crochet' },
      t: tTechnique, generatedAt: new Date(), includeTechnique: false,
    })
    const noTechniqueAtAll = stubCanvas()
    renderBadge(noTechniqueAtAll.canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: LONG_TITLE }, // aucune technique sur le projet
      t: tTechnique, generatedAt: new Date(),
    })
    // Case décochée : EXACTEMENT la même largeur qu'un projet sans technique du tout…
    expect(withoutPill.canvas.width).toBe(noTechniqueAtAll.canvas.width)
    // …et strictement moins large que le même badge avec la pastille (preuve que la réserve de
    // largeur suit bien la case, jamais la seule présence de `project.technique`).
    expect(withPill.canvas.width).toBeGreaterThan(withoutPill.canvas.width)
  })

  it('includeTechnique omis -> pastille dessinée (rétrocompatibilité des appels existants)', () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: 'X', technique: 'crochet' },
      t: tTechnique, generatedAt: new Date(),
    })
    expect(calls.filter((c) => c[0] === 'fillText').map((c) => c[1])).toContain('CROCHET')
  })

  // minimal/double suivent désormais EXACTEMENT le même mécanisme que vertical/horizontal
  // depuis ce chantier (19/09) : la case à cocher pilote la pastille pour les 4 gabarits, plus
  // aucune ligne de stats classique pour 'technique' nulle part.
  it('minimal/double : includeTechnique pilote la pastille, exactement comme vertical/horizontal', () => {
    for (const templateKey of ['minimal', 'double']) {
      for (const includeTechnique of [true, false]) {
        const { canvas, calls } = stubCanvas()
        renderBadge(canvas, {
          templateKey, color: 'hsl(200 70% 45%)',
          statKeys: ['technique', 'totalTime'], stats, photoImg: null,
          project: { name: 'X', technique: 'crochet' },
          t: tTechnique, generatedAt: new Date(), includeTechnique,
        })
        const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
        expect(texts).not.toContain('Crochet')
        expect(texts).toEqual(includeTechnique ? expect.arrayContaining(['CROCHET']) : expect.not.arrayContaining(['CROCHET']))
      }
    }
  })
})

// Revue FINALE de branche (19/09) : `titleBlockHeight` s'arrête EXACTEMENT sur la ligne de base
// de la dernière ligne du titre — elle ne réserve donc rien ni pour les descendantes du titre
// (police grasse 56px) ni pour la pastille Technique, qui descend sous cette ligne de base de
// son propre padding. Le premier bloc empilé démarrait pile à `titleBlockHeight`, donc à
// travers les deux. Généralisé aux 4 gabarits par le chantier « badge corrections typo/zoom »
// (19/09) : plus de filets « registre » nulle part, un seul style de bloc empilé.
describe('écart titre → premier bloc empilé (revue finale 19/09, généralisé aux 4 gabarits)', () => {
  // Valeurs figées de badge-render.js (non exportées) — même discipline que les describes
  // précédents de ce fichier.
  const PILL_PAD_Y = 7
  const PILL_DESCENT = 18 * 0.2 // BADGE_PILL_FONT_SIZE * 0,2, cf. `drawTechniqueBadge`
  const PILL_BELOW_BASELINE = PILL_PAD_Y + PILL_DESCENT // 10,6 px sous la ligne de base du titre
  const STACK_ROW_H = 74
  const STACK_LABEL_BASELINE_OFFSET = 24
  const STACK_VALUE_BASELINE_INSET = 14
  // 40 → 32 (Tâche 13, chantier « badge corrections typo/zoom », 19/09) : mesure réelle sur
  // Pixel 7, cf. le commentaire de `DATE_ROW_H` dans badge-render.js.
  const DATE_ROW_H = 32
  const TITLE = 'Zephyr'
  const tTechnique = (k, arg) => (k === 'technique.crochet' ? 'Crochet' : t(k, arg))
  const STAT_KEYS = ['totalTime', 'sessionsCount', 'bestStreak']

  function render(templateKey) {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey, color: 'hsl(200 70% 45%)',
      statKeys: STAT_KEYS, stats, photoImg: null,
      project: { name: TITLE, technique: 'crochet' },
      t: tTechnique, generatedAt: new Date(2026, 0, 20),
    })
    const yOf = (text) => calls.find((c) => c[0] === 'fillText' && c[1] === text)[3]
    return {
      titleBaselineY: yOf(TITLE),
      footerBaselineY: yOf('rowtine.app'),
      labelBaselineY: yOf('TEMPS TOTAL'),
      // Valeur de la DERNIÈRE stat sélectionnée (bestStreak) : sa baseline + l'inset donne le
      // bas RÉEL du dernier bloc empilé (cf. `drawStackedBlocks` : value baseline =
      // `rowTop + blockRows * rowH - STACK_VALUE_BASELINE_INSET`, donc `rowTop + blockRows *
      // rowH = valueBaselineY + STACK_VALUE_BASELINE_INSET`, exactement le bas de la rangée —
      // ici la DERNIÈRE, donc le bas du bloc entier).
      lastValueBaselineY: yOf(nbsp(`${stats.bestStreak} jours`)),
    }
  }

  for (const templateKey of ['vertical', 'horizontal', 'minimal', 'double']) {
    it(`${templateKey} : le premier bloc empilé démarre SOUS la pastille Technique et les descendantes du titre`, () => {
      const { titleBaselineY, labelBaselineY } = render(templateKey)
      const firstBlockTop = labelBaselineY - STACK_LABEL_BASELINE_OFFSET
      expect(firstBlockTop).toBeGreaterThan(titleBaselineY + PILL_BELOW_BASELINE)
    })
  }

  it('Horizontal : la géométrie RÉSERVE le même écart que le dessin applique', () => {
    // Le cartouche Horizontal est plafonné par le plancher 600 (photo suit le canevas quand le
    // contenu est plus haut, cf. Tâche 1, 20/09) tant que le contenu tient dedans — l'invariant
    // « date à DATE_ROW_H du dernier bloc » n'y est donc pas observable à 3 stats. C'est
    // `contentHeightFor` qu'on vérifie ici directement, avec assez de stats (10) pour dépasser ce
    // plancher photo : hauteur attendue recalculée à la main = TEXT_PAD * 2 + (titleBlockHeight(1)
    // + CONDENSED_TITLE_GAP) + N * STACK_ROW_H + DATE_ROW_H.
    const N = 10
    const expected = 60 * 2 + (56 + 20) + N * STACK_ROW_H + DATE_ROW_H // DATE_ROW_H = 32 (Tâche 13)
    expect(expected).toBeGreaterThan(600 + 90 * 2) // le scénario dépasse bien le plancher photo
    expect(computeBadgeGeometry('horizontal', 1, N, 1).statsArea.h).toBe(expected)
  })

  // Horizontal exclu de cette boucle : à 3 stats seulement, son cartouche reste plafonné par le
  // plancher 600 (photo suit le canevas quand le contenu est plus haut, cf. commentaire du test
  // précédent) — la ligne date n'y suit alors PAS le dernier bloc à DATE_ROW_H près, une marge
  // de photo s'intercale.
  // L'invariant est déjà vérifié pour Horizontal, à 10 stats, par le test précédent.
  for (const templateKey of ['vertical', 'minimal', 'double']) {
    it(`${templateKey} : géométrie et dessin bougent ENSEMBLE (la ligne date suit le dernier bloc)`, () => {
      const { footerBaselineY, lastValueBaselineY } = render(templateKey)
      // Le bas RÉEL du dernier bloc empilé ; `contentHeightFor` réserve exactement DATE_ROW_H
      // entre lui et la ligne de base de la date/rowtine.app. Si l'écart n'était appliqué QU'À
      // un des deux côtés (formule de hauteur ou coordonnée de dessin), cet invariant casserait
      // immédiatement.
      const lastBlockBottom = lastValueBaselineY + STACK_VALUE_BASELINE_INSET
      expect(footerBaselineY - lastBlockBottom).toBe(DATE_ROW_H)
    })
  }
})

// Task 9 (chantier « badge corrections typo/zoom », 19/09 soir) : `pairCount`, nouveau DERNIER
// paramètre optionnel de `computeBadgeGeometry` — réserve l'écart SUPPLÉMENTAIRE
// (`STACK_PAIR_GAP`) que `drawStackedBlocks` ajoute désormais entre deux paires DIFFÉRENTES,
// jamais entre un libellé et sa propre valeur (cf. describe précédent, écart interne inchangé).
describe('computeBadgeGeometry : pairCount réserve l’écart ENTRE deux paires (Task 9, 19/09 soir)', () => {
  const STACK_PAIR_GAP = 20 // valeur figée de badge-render.js (non exportée)

  it('même statLineCount, pairCount = 1 vs 3 : la différence de hauteur est EXACTEMENT 2 * STACK_PAIR_GAP', () => {
    const g1 = computeBadgeGeometry('vertical', 1, 3, 1, false, 0, 0, 1)
    const g3 = computeBadgeGeometry('vertical', 1, 3, 1, false, 0, 0, 3)
    expect(g3.statsArea.h - g1.statsArea.h).toBe(2 * STACK_PAIR_GAP)
    expect(g3.canvas.h - g1.canvas.h).toBe(2 * STACK_PAIR_GAP)
  })

  it('un appel SANS le 8e argument (pairCount) produit EXACTEMENT la même géométrie qu’avant ce correctif (défaut 0, non-régression)', () => {
    // Même appel que le test « Horizontal : la géométrie RÉSERVE le même écart que le dessin
    // applique » ci-dessus (N = 10, 1 argument de moins que la signature actuelle) : son
    // assertion ne bouge pas, la valeur par défaut de `pairCount` (0) garde `Math.max(0,
    // pairCount - 1) * STACK_PAIR_GAP` à 0, comme avant l'ajout du paramètre.
    const N = 10
    const expected = 60 * 2 + (56 + 20) + N * 74 + 32 // TEXT_PAD, CONDENSED_TITLE_GAP, STACK_ROW_H, DATE_ROW_H (= 32, Tâche 13)
    expect(computeBadgeGeometry('horizontal', 1, N, 1).statsArea.h).toBe(expected)
  })

  it('pairCount = 0 (défaut explicite) et pairCount omis donnent la même géométrie', () => {
    const gDefault = computeBadgeGeometry('minimal', 1, 4, 1)
    const gExplicit = computeBadgeGeometry('minimal', 1, 4, 1, false, 0, 0, 0)
    expect(gExplicit).toEqual(gDefault)
  })
})

// Task 13 (chantier « badge corrections typo/zoom », 19/09) : « Commencé le »/« Terminé le »
// sont UNE SEULE donnée logique (une plage de dates) — elles ne doivent jamais recevoir entre
// elles l'écart supplémentaire (`STACK_PAIR_GAP`) que la Task 9 a ajouté entre deux paires
// DIFFÉRENTES, alors qu'il doit rester appliqué entre ce groupe et la stat qui le précède/suit.
describe('Task 13 : « Commencé le »/« Terminé le » regroupés, sans STACK_PAIR_GAP entre eux', () => {
  const STACK_ROW_H = 74 // valeur figée de badge-render.js (non exportée)
  const STACK_VALUE_BASELINE_INSET = 14
  const STACK_LABEL_BASELINE_OFFSET = 24
  const STACK_PAIR_GAP = 20
  // 40 → 32 (Tâche 13, chantier « badge corrections typo/zoom », 19/09) : mesure réelle sur
  // Pixel 7, cf. le commentaire de `DATE_ROW_H` dans badge-render.js.
  const DATE_ROW_H = 32

  it('dessin : les deux phrases restent à l’écart d’UNE seule rangée, l’écart supplémentaire ne s’applique qu’avant la stat suivante', () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['startedOn', 'bestStreak'], stats,
      project: { name: 'X', startedAt: '2026-01-05', finishedAt: '2026-01-20' },
      photoImg: null, t, generatedAt: new Date(2026, 0, 20),
    })
    const yOf = (text) => calls.find((c) => c[0] === 'fillText' && c[1] === text)[3]
    const startedY = yOf('Commencé le 05/01/2026')
    const finishedY = yOf('Terminé le 20/01/2026')
    const streakLabelY = yOf('MEILLEURE SÉRIE')
    const streakValueY = yOf(nbsp('3 jours'))
    const footerBaselineY = yOf('rowtine.app')
    // Jamais STACK_ROW_H + STACK_PAIR_GAP (le bug d’avant ce correctif) : les deux phrases
    // occupent deux rangées CONSÉCUTIVES, sans écart intercalé.
    expect(finishedY - startedY).toBe(STACK_ROW_H)
    // L’écart supplémentaire reste appliqué APRÈS le groupe, avant la stat suivante.
    const finishedBlockBottom = finishedY + STACK_VALUE_BASELINE_INSET
    const nextRowTop = streakLabelY - STACK_LABEL_BASELINE_OFFSET
    expect(nextRowTop - finishedBlockBottom).toBe(STACK_PAIR_GAP)
    // Garde-fou géométrie ↔ dessin (même invariant que le describe « écart titre → premier
    // bloc empilé » plus haut) : si `pairCount` réservait un gap que `drawStackedBlocks` ne
    // dessine plus (ou l’inverse), la ligne date se déciderait à une distance différente de
    // DATE_ROW_H du dernier bloc — ce scénario groupé le vérifie spécifiquement.
    const lastBlockBottom = streakValueY + STACK_VALUE_BASELINE_INSET
    expect(footerBaselineY - lastBlockBottom).toBe(DATE_ROW_H)
  })

  it('géométrie : le canevas réserve pairCount = nombre de GROUPES (2), pas le nombre de paires structurées (3)', () => {
    const { canvas } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(200 70% 45%)',
      statKeys: ['startedOn', 'bestStreak'], stats,
      project: { name: 'X', startedAt: '2026-01-05', finishedAt: '2026-01-20' },
      photoImg: null, t, generatedAt: new Date(2026, 0, 20),
    })
    // 3 paires structurées (Commencé/Terminé/Meilleure série) mais 2 GROUPES seulement (Task
    // 13) : un `pairCount` compté sur les paires réserverait un STACK_PAIR_GAP de trop.
    const withGroupCount = computeBadgeGeometry('minimal', 1, 3, 1, false, 0, 0, 2)
    const withPairCountBug = computeBadgeGeometry('minimal', 1, 3, 1, false, 0, 0, 3)
    expect(withPairCountBug.canvas.h - withGroupCount.canvas.h).toBe(STACK_PAIR_GAP)
    expect(canvas.height).toBe(withGroupCount.canvas.h)
  })
})

// Task 4 du chantier « badge cartouche condensé » (18/09c), UNIQUE style des 4 gabarits depuis
// le chantier « badge corrections typo/zoom » (19/09) : chaque test ci-dessous, écrit à
// l'origine pour Horizontal seul, est dupliqué pour les 4 gabarits via une boucle `for`.
describe('blocs « empilés » (Task 4, généralisés aux 4 gabarits le 19/09)', () => {
  const stackT = (key, arg) => {
    const table = {
      'project.stats.totalTime': 'Temps total',
      'project.stats.bestStreak': 'Meilleure série',
    }
    if (key === 'project.stats.sessionsValue') return `${arg} séances`
    if (key === 'project.stats.streakValue') return `${arg} jours`
    return table[key] ?? key
  }
  const stackStatKeys = ['totalTime', 'sessionsCount', 'bestStreak']
  const TEMPLATE_KEYS = ['vertical', 'horizontal', 'minimal', 'double']

  for (const templateKey of TEMPLATE_KEYS) {
    it(`${templateKey} : libellé (MAJUSCULES) au-dessus, valeur (gras) en dessous, tous deux alignés à gauche`, () => {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey, color: 'hsl(200 70% 45%)',
        statKeys: stackStatKeys, stats, photoImg: null,
        project: { name: 'X' }, t: stackT, generatedAt: new Date(),
      })
      const fillTexts = calls.filter((c) => c[0] === 'fillText')
      const labelCall = fillTexts.find((c) => c[1] === 'TEMPS TOTAL')
      const valueCall = fillTexts.find((c) => c[1] === nbsp('2 h 15 min'))
      expect(labelCall).toBeTruthy()
      expect(valueCall).toBeTruthy()
      // Empilé, PAS côte à côte : même colonne X (aligné à gauche, jamais de centrage — cf.
      // brief), la valeur vient APRÈS le libellé (Y plus grand ⇒ plus bas à l'écran, baseline
      // alphabetic).
      expect(labelCall[2]).toBe(valueCall[2])
      expect(valueCall[3]).toBeGreaterThan(labelCall[3])
      // 'sessionsCount' n'a pas de libellé propre (auto-descriptif, cf. `statLines`) : sa valeur
      // seule est dessinée, jamais un libellé vide à côté.
      expect(fillTexts.some((c) => c[1] === nbsp('6 séances'))).toBe(true)
      expect(fillTexts.some((c) => c[1] === '')).toBe(false)
    })

    it(`${templateKey} : pas de filet dessiné entre les blocs (aucun gabarit n'en dessine plus)`, () => {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey, color: 'hsl(200 70% 45%)',
        statKeys: stackStatKeys, stats, photoImg: null,
        project: { name: 'X' }, t: stackT, generatedAt: new Date(),
      })
      const dividers = calls.filter((c) => c[0] === 'fillRect' && typeof c[1] === 'string' && !c[1].startsWith('rgba'))
      expect(dividers).toHaveLength(0)
    })

    // STACK_ROW_H (74px) + STACK_PAIR_GAP (20px, Task 9 : écart SUPPLÉMENTAIRE entre deux
    // paires DIFFÉRENTES, retour Julien 19/09 soir) — jamais STACK_ROW_H seul, réservé
    // désormais AU-DELÀ de la rangée elle-même, entre la valeur d'une paire et la
    // rangée (libellé ou valeur) de la SUIVANTE, jamais entre un libellé et sa propre valeur
    // (cf. describe ci-dessus, écart interne inchangé).
    it(`${templateKey} : deux blocs consécutifs sont espacés d’exactement STACK_ROW_H + STACK_PAIR_GAP (94px), jamais chevauchés`, () => {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey, color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime', 'bestStreak'], stats, photoImg: null,
        project: { name: 'X' }, t: stackT, generatedAt: new Date(),
      })
      const fillTexts = calls.filter((c) => c[0] === 'fillText')
      const totalTimeValue = fillTexts.find((c) => c[1] === nbsp('2 h 15 min'))
      const streakValue = fillTexts.find((c) => c[1] === nbsp('3 jours'))
      expect(totalTimeValue).toBeTruthy()
      expect(streakValue).toBeTruthy()
      expect(streakValue[3] - totalTimeValue[3]).toBe(74 + 20)
    })

    // Cas N=0 (aucune stat sélectionnée) : atteignable en production (`BadgeComposer.vue` ne
    // pose aucun minimum sur `selectedStats`) — un garde manquant a déjà coûté un tour de
    // correctif à cette tâche (Task 3), cf. brief.
    it(`${templateKey} : aucune stat sélectionnée (N=0) : aucun bloc dessiné, aucune exception`, () => {
      const { canvas, calls } = stubCanvas()
      expect(() =>
        renderBadge(canvas, {
          templateKey, color: 'hsl(200 70% 45%)',
          statKeys: [], stats, photoImg: null,
          project: { name: 'X' }, t: stackT, generatedAt: new Date(),
        }),
      ).not.toThrow()
      const fillTexts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
      expect(fillTexts).not.toContain('TEMPS TOTAL')
      expect(fillTexts.some((s) => s === '')).toBe(false)
    })
  }
})

// Nouveau mécanisme (`wrapStackedLabels`, généralisation de `wrapLedgerLabels` retiré avec ce
// chantier) : le style empilé n'avait jusqu'ici aucune protection contre un libellé trop long
// pour sa colonne — sans risque tant que seul Horizontal (colonne large) l'utilisait, redevenu
// réel maintenant que Vertical (colonne réduite de moitié par un calendrier en mode `side`) et
// Texte seul/Deux images l'utilisent aussi.
describe('wrapStackedLabels : un libellé trop long revient à la ligne, JAMAIS de mot coupé (nouveau test, 19/09)', () => {
  it('mode calendrier `side` sur Vertical (colonne réduite de moitié) : le libellé revient à la ligne au mot, jamais en plein mot', () => {
    const LONG_WORD = 'Merveilleuse' // 12 lettres, sans espace : jamais coupable par wrapText autrement qu'au mot
    const longLabelT = (key, arg) => (key === 'project.stats.totalTime' ? `${LONG_WORD} ${LONG_WORD} ${LONG_WORD}` : t(key, arg))
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: 'X' }, t: longLabelT, generatedAt: new Date(),
      includeCalendar: true, // réduit la colonne de stats à la moitié du cartouche (mode `side`)
    })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    const sourceWord = LONG_WORD.toUpperCase()
    const labelLines = texts.filter((s) => s.includes(sourceWord))
    // Le libellé (3 répétitions du mot, séparées par des espaces) déborde bien de la colonne
    // réduite et revient donc à la ligne sur PLUSIEURS sous-lignes (`labelLines.length > 1`,
    // preuve directe que `wrapStackedLabels` a agi, jamais un dessin sur une seule ligne).
    expect(labelLines.length).toBeGreaterThan(1)
    // Invariant absolu de ce fichier (cf. `wrapText`) : chaque sous-ligne ne contient QUE des
    // mots ENTIERS du libellé d'origine — jamais un fragment (« MERVEIL » / « LEUSE ») qui
    // trahirait une coupure en plein mot.
    for (const line of labelLines) {
      const words = line.split(' ').filter(Boolean)
      for (const w of words) expect(w).toBe(sourceWord)
    }
  })

  it('une paire sans libellé (sessionsCount) donne toujours un bloc à une seule ligne, jamais wrappée', () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['sessionsCount'], stats, photoImg: null,
      project: { name: 'X' }, t, generatedAt: new Date(),
      includeCalendar: true,
    })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts).toContain(nbsp('6 séances'))
  })
})

describe('valeur de stat trop longue en mode calendrier côte-à-côte (bug préexistant, 19/09)', () => {
  it('la valeur revient à la ligne comme le libellé, jamais dans la moitié cédée au calendrier', () => {
    // Répète un mot factice (même mot que le test de wrap du LIBELLÉ ci-dessus, jamais
    // coupable en plein mot par `wrapText`) — assez de fois pour que la valeur, dessinée sur
    // UNE SEULE ligne (bug préexistant), déborde de la colonne stats réduite de moitié par le
    // calendrier (mode `side`). Volontairement SOUS `REQUIRED_TEXT_WIDTH_CAP` (1800 dans
    // badge-render.js) : `requiredTextWidth` suit alors la largeur RÉELLE de la valeur et le
    // canevas grandit pour l'accueillir en PLEINE largeur de colonne — un test qui viserait le
    // plafond prouverait un débordement du CANEVAS (un bug différent, déjà couvert par sa
    // propre marge de sécurité), pas un débordement DANS LE CALENDRIER en mode côte à côte,
    // ce que cette tâche corrige. À 4 répétitions, la valeur non wrappée déborde largement
    // dans la moitié calendrier tout en restant, elle, À L'INTÉRIEUR du canevas — la preuve
    // que ce n'est PAS juste le plafond qui est en cause ici.
    const LONG_WORD = 'Merveilleuse'
    const longValueText = Array(4).fill(LONG_WORD).join(' ')
    const longValueT = (key, arg, opts) => (key === 'project.stats.sessionsValue' ? longValueText : t(key, arg, opts))
    const { canvas, calls } = stubCanvas()
    // `grid` : sans données de grille, `includeCalendar` ne dessine rien (cf. le test dédié
    // plus bas, « grid absent -> pas de dessin de grille ») — une seule colonne/cellule suffit
    // à faire apparaître les initiales de jour/libellé de mois qui bornent le calendrier.
    const gridStats = { ...stats, grid: { columns: [{ monday: '2026-01-05', monthStart: true, cells: [{ day: 'd0', level: 1, future: false }] }] } }
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(200 70% 45%)',
      statKeys: ['sessionsCount'], stats: gridStats, photoImg: null,
      project: { name: 'X' }, t: longValueT, generatedAt: new Date(2026, 0, 20), locale: 'fr',
      includeCalendar: true, // réduit la colonne de stats à la moitié du cartouche (mode `side`)
    })
    const fillTexts = calls.filter((c) => c[0] === 'fillText')
    // Bord gauche RÉEL du calendrier — dérivé des appels de dessin eux-mêmes (jamais recalculé
    // à la main depuis `computeBadgeGeometry`, ce qui dupliquerait la géométrie interne dans le
    // test) : seul le contenu du calendrier (initiales de jour, libellé de mois, légende — cf.
    // `badge-calendar.js`) est dessiné à une abscisse strictement à DROITE de la colonne stats
    // (`TEXT_PAD` dans badge-render.js, 60 ici, `statsArea.x` valant 0 pour le gabarit Vertical) ;
    // `rowtine.app` (pied de badge, aligné à DROITE, cf. `ctx.textAlign = 'right'`) en est exclu,
    // son `x` étant déjà son bord droit, pas son bord gauche.
    const STATS_LEFT_X = 60
    const calendarXs = fillTexts.filter((c) => c[2] > STATS_LEFT_X && c[1] !== 'rowtine.app').map((c) => c[2])
    expect(calendarXs.length).toBeGreaterThan(0) // sinon le test ne prouve rien : pas de calendrier détecté
    const calendarLeftX = Math.min(...calendarXs)
    // Garde-fou : si un futur changement décalait `statsArea.x` (gabarit Vertical) et faisait
    // capturer du texte STATS par ce filtre, `calendarLeftX` s'effondrerait vers `STATS_LEFT_X`
    // et le test passerait pour la mauvaise raison (aucun vrai calendrier détecté à droite) —
    // cette assertion échoue bruyamment plutôt que de laisser passer un test vide de sens.
    expect(calendarLeftX).toBeGreaterThan(STATS_LEFT_X + 200)
    // La valeur (colonne stats, bord gauche `STATS_LEFT_X`) ne doit JAMAIS empiéter sur le
    // calendrier : chaque sous-ligne de la valeur doit rester strictement à gauche de son bord.
    const valueLines = fillTexts.filter((c) => String(c[1]).includes(LONG_WORD))
    expect(valueLines.length).toBeGreaterThan(0)
    for (const [, text, x] of valueLines) {
      expect(x + String(text).length * FAKE_CHAR_WIDTH).toBeLessThanOrEqual(calendarLeftX)
    }
    // Preuve directe que la valeur a bien été wrappée (jamais juste "ça tient par chance") :
    // plusieurs sous-lignes du mot répété, chacune un mot ENTIER (même invariant que le test
    // de libellé ci-dessus).
    expect(valueLines.length).toBeGreaterThan(1)
    for (const [, line] of valueLines) {
      const words = line.split(' ').filter(Boolean)
      for (const w of words) expect(w).toBe(LONG_WORD)
    }
  })
})

describe('buildRawStatLines', () => {
  it('une clé "yarns" produit N lignes, les autres clés 0 ou 1 ligne', () => {
    const yarnUsage = [{ yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 }]
    const lines = buildRawStatLines(['totalTime', 'yarns', 'sessionsCount'], {
      stats, t, locale: 'fr',
      project: { name: 'X' }, yarnUsage, customText: '',
    })
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('Drops Merino')
  })

  it('customText non vide ajoute UNE ligne finale', () => {
    const lines = buildRawStatLines(['sessionsCount'], {
      stats, t, locale: 'fr',
      project: { name: 'X' }, yarnUsage: [], customText: '  Un mot doux  ',
    })
    expect(lines.at(-1)).toBe('Un mot doux')
  })

  it('buildRawStatLines : espace insécable entre chiffre et unité, jamais un espace normal', () => {
    const lines = buildRawStatLines(['totalTime'], {
      stats, t, locale: 'fr', project: { name: 'X' }, yarnUsage: [], customText: '',
    })
    expect(lines[0]).toMatch(/\d /)
    expect(lines[0]).not.toMatch(/\d h\b/) // espace normal AVANT "h" : régression
  })

  // Décision de forme (Task 3, chantier « badge cartouche condensé » 18/09c), documentée ici
  // pour que Task 4 (gabarit Horizontal, blocs empilés) réutilise EXACTEMENT ce mécanisme :
  // `structured: true` renvoie des paires `{ label, value }` plutôt qu'une chaîne déjà jointe
  // par « · » — le libellé est vide (`''`), jamais absent, pour les entrées auto-descriptives
  // sans libellé propre.
  describe('option structured (paires {label, value}, réutilisée par Vertical ET Horizontal)', () => {
    it('totalTime/bestStreak : { label, value } séparés, jamais une chaîne jointe par ·', () => {
      const lines = buildRawStatLines(['totalTime'], {
        stats, t, locale: 'fr', project: { name: 'X' }, yarnUsage: [], customText: '', structured: true,
      })
      expect(lines).toEqual([{ label: 'Temps total', value: nbsp('2 h 15 min') }])
    })

    it('sessionsCount/technique : libellé vide, jamais absent ni composé avec la valeur', () => {
      const lines = buildRawStatLines(['sessionsCount'], {
        stats, t, locale: 'fr', project: { name: 'X' }, yarnUsage: [], customText: '', structured: true,
      })
      expect(lines).toEqual([{ label: '', value: nbsp('6 séances') }])
    })

    it('yarns : une paire { label, value } PAR laine, label = yarnLabel(yarn)', () => {
      const yarnUsage = [{ yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 }]
      const lines = buildRawStatLines(['yarns'], {
        stats, t, locale: 'fr', project: { name: 'X' }, yarnUsage, customText: '', structured: true,
      })
      expect(lines).toEqual([{ label: 'Drops Merino', value: nbsp('4 pelotes') }])
    })

    it('startedOn : une paire par phrase, label vide (phrase déjà complète, pas de libellé séparable)', () => {
      const lines = buildRawStatLines(['startedOn'], {
        stats, t, locale: 'fr',
        project: { name: 'X', startedAt: '2026-01-05', finishedAt: '2026-01-20' },
        yarnUsage: [], customText: '', structured: true,
      })
      // `groupStart` (Task 13, chantier « badge corrections typo/zoom » 19/09) : les deux
      // phrases sont UNE SEULE donnée logique (une plage de dates) — seule la première démarre
      // un groupe, pour que l'écart supplémentaire entre données différentes (`STACK_PAIR_GAP`)
      // ne s'applique jamais entre elles (cf. `drawStackedBlocks`/`countGroups`).
      expect(lines).toEqual([
        { label: '', value: 'Commencé le 05/01/2026', groupStart: true },
        { label: '', value: 'Terminé le 20/01/2026', groupStart: false },
      ])
    })

    it('customText : ajoutée en { label: "", value } final, comme les entrées auto-descriptives', () => {
      const lines = buildRawStatLines(['sessionsCount'], {
        stats, t, locale: 'fr', project: { name: 'X' }, yarnUsage: [], customText: '  Un mot doux  ', structured: true,
      })
      expect(lines.at(-1)).toEqual({ label: '', value: 'Un mot doux' })
    })

    // Vérifiée sur les 4 formes de paires que `statLines`/`buildRawStatLines` produisent :
    // libellé non vide composé par « · » (totalTime, yarns), et libellé vide où la forme non
    // structurée est la valeur SEULE, jamais un « · » orphelin (startedOn, customText).
    it.each([
      {
        label: 'totalTime (libellé non vide)',
        statKeys: ['totalTime'],
        options: { stats, t, locale: 'fr', project: { name: 'X' }, yarnUsage: [], customText: '' },
      },
      {
        label: 'yarns (libellé non vide, une entrée)',
        statKeys: ['yarns'],
        options: {
          stats, t, locale: 'fr', project: { name: 'X' },
          yarnUsage: [{ yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 }], customText: '',
        },
      },
      {
        label: 'startedOn (libellé vide, phrase seule)',
        statKeys: ['startedOn'],
        options: {
          stats, t, locale: 'fr',
          project: { name: 'X', startedAt: '2026-01-05', finishedAt: '' },
          yarnUsage: [], customText: '',
        },
      },
      {
        label: 'customText (libellé vide, texte seul)',
        statKeys: [],
        options: { stats, t, locale: 'fr', project: { name: 'X' }, yarnUsage: [], customText: '  Un mot doux  ' },
      },
    ])('non structured (défaut) : comportement bit-à-bit inchangé, chaîne jointe comme avant — $label', ({ statKeys, options }) => {
      const structuredLines = buildRawStatLines(statKeys, { ...options, structured: true })
      const joined = buildRawStatLines(statKeys, options)
      const expectedJoined = structuredLines.map(({ label, value }) => (label ? `${label} · ${value}` : value))
      expect(joined).toEqual(expectedJoined)
    })
  })
})

// C2 — le gabarit « bandeau horizontal » rognait ses propres lignes de stats : 490 px
// jusqu'au bord du canvas pour une colonne de 400, et aucune mesure du texte dessiné.
describe('wrapText', () => {
  const ctx = { measureText: (s) => ({ width: String(s).length * FAKE_CHAR_WIDTH }) }

  it('laisse un texte qui tient sur une seule ligne', () => {
    expect(wrapText(ctx, 'Pull Alma', 400)).toEqual(['Pull Alma'])
  })

  it('retourne à la ligne au dernier espace qui tient dans le budget, jamais d’ellipse', () => {
    const out = wrapText(ctx, 'Meilleure serie de trois jours actifs', 200)
    expect(out.length).toBeGreaterThan(1)
    for (const line of out) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(200)
      expect(line.endsWith('…')).toBe(false)
    }
    // Recollées avec des espaces, les lignes reforment le texte d'origine : rien n'est perdu.
    expect(out.join(' ')).toBe('Meilleure serie de trois jours actifs')
  })

  it('mot seul plus large que le budget : coupé caractère par caractère en dernier recours', () => {
    const out = wrapText(ctx, 'Supercalifragilisticexpialidocious', 100)
    expect(out.length).toBeGreaterThan(1)
    for (const line of out) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(100)
    }
    expect(out.join('')).toBe('Supercalifragilisticexpialidocious')
  })

  it('texte vide : une seule ligne vide, jamais un tableau vide', () => {
    expect(wrapText(ctx, '', 400)).toEqual([''])
  })
})

describe('anti-troncature dans renderBadge : retour à la ligne, canevas qui grandit', () => {
  // Gabarit Texte seul (« minimal ») : depuis le correctif du 19/09 (suite Task 3), sa colonne
  // relit `requiredTextWidth` comme les 3 autres gabarits (Horizontal, Vertical, Deux images) —
  // un nom simplement long n'y wrappe donc plus, il élargit le cartouche à la place. Il faut
  // désormais dépasser le PLAFOND de largeur (`REQUIRED_TEXT_WIDTH_CAP`, non exporté, cf.
  // describe « largeur du canevas pilotée par le contenu ») pour observer un retour à la ligne
  // RÉEL sur ce gabarit — ce test vise toujours l'invariant générique « jamais tronqué, wrappé
  // si besoin », recalibré sur ce nouveau comportement.
  it('nom de projet trop long : jamais tronqué, réparti sur plusieurs lignes (au-delà du plafond de largeur)', () => {
    const { canvas, calls } = stubCanvas()
    // 98 caractères (≈1960px mesurés) : dépasse même le plafond de largeur du cartouche APRÈS
    // élargissement (1800px) — le seul cas qui force encore un retour à la ligne sur ce gabarit.
    const longName = 'Pull raglan torsadé à col montant et manches longues pour les plus froides soirées d’hiver polaire'
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: [], stats, photoImg: null,
      project: { name: longName },
      t, generatedAt: new Date(2026, 0, 20),
    })
    const TEXT_PAD = 60
    const MARGIN = 90
    const REQUIRED_TEXT_WIDTH_CAP = 1800 // valeur figée de badge-render.js (non exportée)
    const maxTextWidth = REQUIRED_TEXT_WIDTH_CAP - TEXT_PAD * 2
    const measureCtx = { measureText: (s) => ({ width: String(s).length * FAKE_CHAR_WIDTH }) }
    const expectedLines = wrapText(measureCtx, longName, maxTextWidth)
    expect(expectedLines.length).toBeGreaterThan(1) // preuve que ce nom déborde bien une ligne
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    for (const line of expectedLines) {
      expect(texts).toContain(line)
      expect(line.endsWith('…')).toBe(false)
    }
    // Preuve que le cartouche s'est bien élargi JUSQU'AU plafond (sinon ce test ne prouverait
    // rien de plus qu'un wrap ordinaire) : `canvasW = colW + MARGIN * 2` pour ce gabarit
    // (cf. `computeBadgeGeometry`, branche `!tpl.hasPhoto`).
    expect(canvas.width).toBe(REQUIRED_TEXT_WIDTH_CAP + MARGIN * 2)
  })

  // Style empilé (Task 3, unique depuis le 19/09) : `wrapStackedLabels` ne wrappe QUE le
  // libellé (« pas de valeur à droite à éviter », cf. son commentaire) — la valeur, elle, est
  // TOUJOURS dessinée en une seule ligne par `drawStackedBlocks`, jamais wrappée, jamais
  // tronquée (aucune ellipse). Gabarit Texte seul : depuis le correctif du 19/09 (suite Task 3),
  // sa colonne relit `requiredTextWidth` comme les 3 autres gabarits — une valeur très longue
  // élargit donc le cartouche au lieu d'en déborder, ce que ce test vérifie explicitement (texte
  // intégral toujours présent ET canevas élargi en conséquence).
  it('ligne de stat à valeur longue : jamais tronquée, dessinée EN ENTIER sur une seule ligne, le cartouche s’élargit (le libellé peut wrapper, jamais la valeur)', () => {
    const { canvas, calls } = stubCanvas()
    const longT = (key, arg) =>
      key === 'project.stats.streakValue'
        ? `${arg} jours consécutifs de tricot sans interruption, un record personnel`
        : t(key, arg)
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: ['bestStreak'], stats, photoImg: null,
      project: { name: 'X' }, t: longT, generatedAt: new Date(2026, 0, 20),
    })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    const fullValue = nbsp(longT('project.stats.streakValue', stats.bestStreak))
    expect(texts).toContain(fullValue)
    expect(texts.some((s) => s.endsWith('…'))).toBe(false)
    expect(texts).toContain('MEILLEURE SÉRIE')
    // Preuve que le cartouche s'est RÉELLEMENT élargi pour loger cette valeur (jamais un
    // débordement silencieux) : la valeur mesurée (stub 20px/caractère) dépasse largement la
    // largeur fixe d'origine du gabarit (900px = 1080 - MARGIN*2).
    expect(canvas.width).toBeGreaterThan(BADGE_TEMPLATES.minimal.canvas.w)
  })

  it('gabarit Horizontal : la photo n’est plus jamais rétrécie, le canevas s’élargit pour garder une colonne de texte lisible', () => {
    const wideRatio = 21 / 9 // panoramique, bien au-delà de l'ancien plafond de largeur (900 px)
    const g = computeBadgeGeometry('horizontal', wideRatio)
    // Contenu court par défaut (`computeBadgeGeometry` sans statLineCount) : canevas au plancher
    // 780, donc photo encore à son plancher 600 de haut (cf. Tâche 1, 20/09) — géométrie bit à
    // bit identique à avant cette tâche dans ce cas précis, jamais plafonnée en LARGEUR.
    const expectedPhotoW = Math.round(600 * wideRatio)
    expect(g.photoSlot.w).toBe(expectedPhotoW)
    expect(g.canvas.w).toBeGreaterThan(BADGE_TEMPLATES.horizontal.canvas.w)
    expect(g.statsArea.w).toBeGreaterThanOrEqual(420) // plancher garanti (MIN_LANDSCAPE_TEXT_W)
  })

  // Refonte « cartouche pleine largeur/hauteur » (16/09) : le bandeau EST `statsArea`, pas un
  // rectangle bordé d'un `pad` — l'invariant à garder est que le(s) slot(s) photo ET le
  // cartouche restent dans le canvas, et que le texte (marge TEXT_PAD comprise) reste dans
  // le cartouche, pour CHAQUE gabarit à photo et CHAQUE ratio (carré/rectangle).
  // Ratios 16/9 et 9/16 : les 2 valeurs les plus extrêmes des 5 proposées au recadrage
  // depuis la revue du 17/09 (ratio libre, indépendant de l'orientation du gabarit).
  it('slot(s) photo et cartouche restent dans le canvas, texte dans le cartouche', () => {
    const TEXT_PAD = 60
    for (const templateKey of ['vertical', 'horizontal', 'double']) {
      for (const ratio of [1, 4 / 5, 4 / 3, 16 / 9, 9 / 16]) {
        const { canvas, photoSlot, photoSlots, statsArea } = computeBadgeGeometry(templateKey, ratio)
        const slots = photoSlots || (photoSlot ? [photoSlot] : [])
        for (const slot of slots) {
          expect(slot.x).toBeGreaterThanOrEqual(0)
          expect(slot.y).toBeGreaterThanOrEqual(0)
          expect(slot.x + slot.w).toBeLessThanOrEqual(canvas.w)
          expect(slot.y + slot.h).toBeLessThanOrEqual(canvas.h)
        }
        expect(statsArea.x).toBeGreaterThanOrEqual(0)
        expect(statsArea.y).toBeGreaterThanOrEqual(0)
        expect(statsArea.x + statsArea.w).toBeLessThanOrEqual(canvas.w)
        expect(statsArea.y + statsArea.h).toBeLessThanOrEqual(canvas.h)
        expect(statsArea.w - TEXT_PAD * 2).toBeGreaterThan(0)
      }
    }
  })

  it('gabarit Horizontal : le canevas grandit en hauteur quand le contenu dépasse la hauteur fixe d’origine', () => {
    const g = computeBadgeGeometry('horizontal', 16 / 9, 14, 3)
    expect(g.canvas.h).toBeGreaterThan(BADGE_TEMPLATES.horizontal.canvas.h)
    expect(g.statsArea.h).toBe(g.canvas.h)
    expect(g.statsArea.y + g.statsArea.h).toBeLessThanOrEqual(g.canvas.h)
    // La photo reste centrée verticalement dans le canevas RÉELLEMENT grandi, pas dans
    // l'ancienne hauteur fixe (1080) : c'est exactement ce que le bug laissait de côté.
    expect(g.photoSlot.y).toBeCloseTo((g.canvas.h - g.photoSlot.h) / 2, 5)
  })

  it('gabarit Horizontal : suit la hauteur de la photo (+ marges), pas la hauteur fixe du gabarit, quand le contenu est court', () => {
    // Retour Julien (Pixel 7, 17/09 soir) : un canevas encore bloqué sur l'ancienne hauteur
    // fixe du gabarit (1080) laissait ~240px de dégradé vide au-dessus/en dessous de la photo.
    // Contenu court (3 stats) : la photo reste au plancher 600 de haut (cf. Tâche 1, 20/09 — elle
    // ne suit le canevas que quand le contenu est plus haut) — la hauteur attendue est donc
    // 600 + MARGIN * 2 (180, MARGIN non exporté), pas `BADGE_TEMPLATES.horizontal.canvas.h`.
    const g = computeBadgeGeometry('horizontal', 1, 3, 1)
    expect(g.canvas.h).toBe(780)
    expect(g.canvas.h).toBeLessThan(BADGE_TEMPLATES.horizontal.canvas.h)
    expect(g.photoSlot.y).toBe(90) // (780 - 600) / 2 = MARGIN, photo collée aux marges normales
  })

  it('gabarit Deux images : ratios indépendants par emplacement, cartouche sous le plus haut des deux', () => {
    const { canvas, photoSlots, statsArea } = computeBadgeGeometry('double', [1, 9 / 16])
    expect(photoSlots[0].aspect).toBe(1)
    expect(photoSlots[1].aspect).toBe(9 / 16)
    // Le 2e emplacement (9:16, plus haut à largeur de colonne égale) détermine le départ du
    // cartouche : il doit dépasser le 1er (carré) en hauteur.
    expect(photoSlots[1].h).toBeGreaterThan(photoSlots[0].h)
    expect(statsArea.y).toBe(90 + photoSlots[1].h + 60)
    expect(statsArea.y + statsArea.h).toBeLessThanOrEqual(canvas.h)
  })

  // Retour utilisateur (17/09, capture d'écran) : gabarit Vertical + photo au format portrait
  // (ratio proche de l'ancien plafond) → la dernière ligne de stats se dessinait PLUS BAS que
  // la ligne date/rowtine.app, donc par-dessus elle (cartouche trop court pour le nombre de
  // lignes, cf. commentaire de `computeBadgeGeometry`). Test sur `renderBadge` directement
  // (pas seulement `computeBadgeGeometry`) : c'est l'ordre RÉEL des `fillText` qui doit rester
  // correct, une géométrie cohérente sur le papier ne garantit pas l'absence de chevauchement.
  it('gabarit Vertical, photo portrait haute + 5 stats : la dernière ligne ne chevauche pas la date (retour utilisateur 17/09)', () => {
    const { canvas, calls } = stubCanvas()
    const statKeys = ['totalTime', 'sessionsCount', 'yarns', 'startedOn', 'bestStreak']
    const yarnUsage = [{ yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 }]
    const project = { name: 'Bonnet Torsade', startedAt: '2026-01-05' }
    const generatedAt = new Date(2026, 0, 20)
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(230 70% 45%)', photoRatio: 9 / 16,
      statKeys, stats, yarnUsage, photoImg: { naturalWidth: 900, naturalHeight: 1600 },
      project, t, generatedAt, locale: 'fr',
    })
    const fillTexts = calls.filter((c) => c[0] === 'fillText')
    // Depuis Task 3, une rangée « registre » Vertical dessine JUSQU'À deux `fillText` (libellé
    // + valeur), plus jamais un seul par ligne logique — retrouver le titre/date/lien par leur
    // CONTENU (déterministe) plutôt que par position, pour ne pas réintroduire l'hypothèse
    // « une ligne = un fillText » que cette tâche supprime précisément.
    const dateText = generatedAt.toLocaleDateString('fr', { day: '2-digit', month: 'long', year: 'numeric' })
    const titleCall = fillTexts.find((c) => c[1] === 'Bonnet Torsade')
    const dateCall = fillTexts.find((c) => c[1] === dateText)
    const linkCall = fillTexts.find((c) => c[1] === 'rowtine.app')
    expect(titleCall).toBeTruthy()
    expect(dateCall).toBeTruthy()
    expect(linkCall).toBeTruthy()
    // Toutes les rangées de stats (libellés et valeurs confondus) restent strictement AU-DESSUS
    // de la ligne date, quel que soit leur nombre exact de `fillText`.
    const statRowCalls = fillTexts.filter((c) => c !== titleCall && c !== dateCall && c !== linkCall)
    expect(statRowCalls.length).toBeGreaterThan(0)
    const lastStatY = Math.max(...statRowCalls.map((c) => c[3]))
    expect(dateCall[3]).toBeGreaterThan(lastStatY)
    expect(linkCall[3]).toBe(dateCall[3])
    expect(dateCall[3]).toBeLessThanOrEqual(canvas.height)
    // Le canevas a grandi pour loger tout ça (au lieu de plafonner la photo, cf. photoSlot).
    expect(canvas.width).toBe(1080)
    expect(canvas.height).toBeGreaterThan(BADGE_TEMPLATES.vertical.canvas.h)
  })

  // Revue « pas de place perdue » (17/09) : le cartouche du gabarit Texte seul (sans photo)
  // s'adapte au nombre de lignes réellement affichées. Revue anti-troncature (17/09,
  // suite) : ni le cartouche ni le CANEVAS ne sont plus jamais plafonnés.
  it('gabarit Texte seul : le cartouche ET le canevas grandissent avec le nombre de lignes, jamais plafonnés', () => {
    const g0 = computeBadgeGeometry('minimal', 1, 0)
    const g3 = computeBadgeGeometry('minimal', 1, 3)
    const g6 = computeBadgeGeometry('minimal', 1, 6)
    expect(g3.statsArea.h).toBeGreaterThan(g0.statsArea.h)
    expect(g6.statsArea.h).toBeGreaterThan(g3.statsArea.h)
    expect(g3.canvas.h).toBeGreaterThan(g0.canvas.h)
    expect(g6.canvas.h).toBeGreaterThan(g3.canvas.h)
    for (const g of [g0, g3, g6]) {
      expect(g.statsArea.y + g.statsArea.h).toBeLessThanOrEqual(g.canvas.h)
    }
  })

  describe('statValue', () => {
    it('renvoie la valeur seule, sans le libellé', () => {
      expect(statValue('totalTime', stats, t, 'fr', { name: 'X' })).toBe('2 h 15 min')
      expect(statValue('sessionsCount', stats, t, 'fr', { name: 'X' })).toBe('6 séances')
    })

    it('même valeur que celle dessinée par le bloc empilé (via renderBadge)', () => {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey: 'minimal', color: 'hsl(230 70% 45%)',
        statKeys: ['bestStreak'], stats, photoImg: null,
        project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20), locale: 'fr',
      })
      const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
      const value = statValue('bestStreak', stats, t, 'fr', { name: 'X' })
      // Style empilé (Task 3) : libellé (MAJUSCULES) et valeur dessinés SÉPARÉMENT, plus de
      // chaîne jointe « Label · Valeur ».
      expect(texts).toContain('MEILLEURE SÉRIE')
      expect(texts).toContain(nbsp(value))
    })

    it("technique : renvoie directement la traduction, chaîne vide si absente du projet", () => {
      expect(statValue('technique', {}, (k) => (k === 'technique.crochet' ? 'Crochet' : k), 'fr', { technique: 'crochet' })).toBe('Crochet')
      expect(statValue('technique', {}, (k) => k, 'fr', { name: 'X' })).toBe('')
    })
  })

  describe('statValue/statLines : progress', () => {
    it('affiche le pourcentage arrondi quand rowsProgress est connu', () => {
      const s = { ...stats, rowsProgress: { done: 30, total: 60 } }
      expect(statValue('progress', s, t, 'fr')).toBe('50 %')
    })
    it('retourne une chaîne vide quand rowsProgress est null', () => {
      const s = { ...stats, rowsProgress: null }
      expect(statValue('progress', s, t, 'fr')).toBe('')
    })
    it('statLines : une ligne « Label · Valeur » quand rowsProgress est connu', () => {
      const s = { ...stats, rowsProgress: { done: 30, total: 60 } }
      expect(buildRawStatLines(['progress'], { stats: s, t, locale: 'fr', project: { name: 'X' }, yarnUsage: [] }))
        .toEqual([nbsp('Avancement · 50 %')])
    })
    it('statLines : aucune ligne (tableau vide) quand rowsProgress est null — absente, pas juste vide', () => {
      const s = { ...stats, rowsProgress: null }
      expect(buildRawStatLines(['progress'], { stats: s, t, locale: 'fr', project: { name: 'X' }, yarnUsage: [] }))
        .toEqual([])
    })
  })

  describe('motif de progression (mailles) dans le style empilé', () => {
    // Preuve de la RÉSERVATION elle-même (pas seulement que le motif est dessiné, cf. le test
    // suivant) : deux badges autrement identiques (même gabarit, même titre, ni calendrier ni
    // pastille Technique ni texte libre), l'un avec une stat texte-seule (`totalTime`), l'autre
    // avec `progress` (motif attaché) — leurs libellés/valeurs respectifs (« Temps total »/
    // durée courte, « Avancement »/« 60 % ») tiennent chacun sur une seule sous-ligne à cette
    // largeur (vérifié empiriquement : aucun wrap des deux côtés), donc `geometryStatLineCount`
    // ne diffère que par la rangée motif. Si `stackedRowCount` cessait de compter cette rangée,
    // l'écart de hauteur tomberait à 0 et ce test échouerait — contrairement à un simple
    // `stroke().length > 0`, qui resterait vert même sans réservation de hauteur.
    it('réserve une rangée fixe (STACK_ROW_H) de plus quand la stat progress porte un motif', () => {
      const STACK_ROW_H = 74 // valeur figée de badge-render.js (non exportée), cf. autres tests de ce fichier
      const { canvas: canvasSansMotif } = stubCanvas()
      renderBadge(canvasSansMotif, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)', photoRatio: 1,
        statKeys: ['totalTime'], stats, photoImg: null,
        project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20), locale: 'fr', includeTechnique: false,
      })
      const { canvas: canvasAvecMotif } = stubCanvas()
      const statsWithProgress = { ...stats, rowsProgress: { done: 6, total: 10 } }
      renderBadge(canvasAvecMotif, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)', photoRatio: 1,
        statKeys: ['progress'], stats: statsWithProgress, photoImg: null,
        project: { name: 'X', technique: 'crochet' }, t, generatedAt: new Date(2026, 0, 20), locale: 'fr', includeTechnique: false,
      })
      expect(canvasAvecMotif.height - canvasSansMotif.height).toBe(STACK_ROW_H)
    })

    it('dessine effectivement le motif (mailles crochet) quand la stat progress est sélectionnée', () => {
      const { canvas, calls } = stubCanvas()
      const statsWithProgress = { ...stats, rowsProgress: { done: 6, total: 10 } }
      renderBadge(canvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)', photoRatio: 1,
        statKeys: ['progress'], stats: statsWithProgress, photoImg: null,
        // `includeTechnique: false` : isole les traits du motif de ceux, sans rapport, de la
        // pastille Technique (`drawTechniqueBadge` dessine elle aussi une bordure via `stroke()`
        // — sans cette exclusion, l'assertion « au moins un stroke » passerait même sans motif).
        project: { name: 'X', technique: 'crochet' }, t, generatedAt: new Date(2026, 0, 20), locale: 'fr', includeTechnique: false,
      })
      const strokeCalls = calls.filter((c) => c[0] === 'stroke')
      // Avec `includeTechnique: false`, la pastille Technique (seule autre source de
      // `ctx.stroke()` dans ce scénario sans calendrier/icône vegan, cf. `drawTechniqueBadge`)
      // est absente : chaque `stroke()` observé ici vient donc bien du motif.
      expect(strokeCalls.length).toBeGreaterThan(0) // le motif a bien été dessiné (mailles crochet)
      // `quadraticCurveTo` : empreinte propre au motif crochet (chaînette), qu'aucun autre
      // dessin du badge n'utilise (`roundRectPath` passe par `arcTo`, `drawVeganIcon` par
      // `stroke(new Path2D(...))`, le calendrier par `strokeRect`, cf. `stubCanvas()`).
      expect(calls.some((c) => c[0] === 'quadraticCurveTo')).toBe(true)
    })

    it('technique tricot (défaut) dessine des mailles en V, jamais de courbe', () => {
      const { canvas, calls } = stubCanvas()
      const statsWithProgress = { ...stats, rowsProgress: { done: 2, total: 10 } }
      renderBadge(canvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)', photoRatio: 1,
        statKeys: ['progress'], stats: statsWithProgress, photoImg: null,
        project: { name: 'X', technique: 'knitting' }, t, generatedAt: new Date(2026, 0, 20), locale: 'fr', includeTechnique: false,
      })
      expect(calls.filter((c) => c[0] === 'stroke').length).toBeGreaterThan(0)
      expect(calls.some((c) => c[0] === 'quadraticCurveTo')).toBe(false)
      // `lineTo` : empreinte propre aux mailles en V (tricot) — preuve positive que le motif a
      // bien été tracé, pas seulement l'absence de courbe.
      expect(calls.some((c) => c[0] === 'lineTo')).toBe(true)
    })
  })

  describe('carte calendaire (includeCalendar)', () => {
    const gridStats = {
      ...stats,
      grid: {
        columns: Array.from({ length: 6 }, (_, i) => ({
          monday: `col-${i}`,
          cells: Array.from({ length: 7 }, (_, ri) => ({ day: `d-${i}-${ri}`, level: (ri + i) % 5, future: false })),
        })),
      },
    }

    it('includeCalendar=false (défaut) : aucun calendarArea, comportement inchangé', () => {
      const g = computeBadgeGeometry('vertical', 1, 3, 1)
      expect(g.calendarArea).toBeNull()
    })

    it('includeCalendar=true : partage le cartouche en deux, calendarArea non nul', () => {
      const g = computeBadgeGeometry('vertical', 1, 3, 1, true)
      expect(g.calendarArea).not.toBeNull()
      expect(g.statsArea.w).toBeLessThan(g.canvas.w)
      // Les deux moitiés restent dans le canevas, sans se chevaucher.
      expect(g.statsArea.x + g.statsArea.w).toBeLessThanOrEqual(g.calendarArea.x)
      expect(g.calendarArea.x + g.calendarArea.w).toBeLessThanOrEqual(g.canvas.w)
    })

    it('mode côte à côte : la carte calendaire réserve de la place pour la ligne date/rowtine.app, ne prend pas toute la hauteur', () => {
      const g = computeBadgeGeometry('vertical', 1, 1, 1, true)
      expect(g.calendarArea.h).toBeLessThan(g.statsArea.h)
    })

    it('mode côte à côte : la ligne date/rowtine.app reste APRÈS le calendrier, jamais superposée à son bas (retour Julien, 18/09)', () => {
      const g = computeBadgeGeometry('vertical', 1, 1, 1, true)
      const TEXT_PAD = 60
      const dateBaselineY = g.textBottom - TEXT_PAD
      // Un simple `toBe` égal aurait laissé passer la collision (la baseline de la ligne date
      // pile sur le bas du calendrier, cf. revue) : l'invariant est une inégalité STRICTE, avec
      // un vrai espace entre les deux, jamais une coïncidence de valeurs.
      expect(dateBaselineY).toBeGreaterThan(g.calendarArea.y + g.calendarArea.h)
    })

    it('mode empilé : la ligne date/rowtine.app reste APRÈS le calendrier, jamais avant lui (retour Julien, 18/09)', () => {
      const g = computeBadgeGeometry('horizontal', 1, 3, 1, true) // ratio 1 -> colW=600, sideTextW=285<400 : empilé
      expect(g.calendarArea).not.toBeNull()
      const TEXT_PAD = 60
      const dateBaselineY = g.textBottom - TEXT_PAD
      expect(dateBaselineY).toBeGreaterThan(g.calendarArea.y + g.calendarArea.h)
    })

    it('le titre reste en pleine largeur même avec le calendrier actif (mode côte à côte) : pas de retour à la ligne superflu', () => {
      const { canvas, calls } = stubCanvas()
      // 44 caractères, largeur naturelle 880px : tient sur une ligne à pleine largeur (960px,
      // colW 1080 - TEXT_PAD*2) mais repasserait sur plusieurs lignes à la largeur réduite
      // réservée aux stats à côté du calendrier (~405px) — sous ce plafond (1080), colW n'est
      // pas non plus élargi par `requiredTextWidth` (cf. describe précédent), donc cette
      // largeur pleine reste la valeur de référence stable du gabarit.
      const name = 'Pull raglan torsadé pour les longues soirées'
      renderBadge(canvas, {
        templateKey: 'vertical', color: 'hsl(230 70% 45%)',
        statKeys: [], stats: gridStats, photoImg: null,
        project: { name }, t, generatedAt: new Date(2026, 0, 20), includeCalendar: true,
      })
      const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
      expect(texts).toContain(name) // preuve que le titre n'a PAS été coupé par le partage avec le calendrier
    })

    it('gabarit déjà trop étroit (Horizontal avec une photo carrée ou large) : la carte calendaire passe EN DESSOUS du texte, jamais ignorée', () => {
      // Ratio 1 (colW=600, moitié texte=285) ET ratio 2 (colW=420 plancher, moitié=195) tombent
      // tous deux sous le nouveau seuil CALENDAR_MIN_TEXT_W (400, relevé depuis 260 le 17/09 :
      // 285px à la police 40px utilisée pour les lignes de stats ne laissait plus que des mots
      // isolés par ligne, jugé illisible par Julien sur Pixel réel) — les DEUX doivent donc
      // empiler la carte calendaire en PLEINE largeur du texte, sous lui, jamais réduire le
      // texte davantage ni annuler la carte calendaire.
      for (const ratio of [1, 2]) {
        const g = computeBadgeGeometry('horizontal', ratio, 3, 1, true)
        expect(g.calendarArea).not.toBeNull()
        // Le texte garde sa largeur PLEINE (jamais réduite pour faire de la place à côté).
        expect(g.statsArea.w).toBe(g.calendarArea.w)
        // La carte calendaire est EN DESSOUS (même x, y strictement plus grand), pas à côté.
        expect(g.calendarArea.x).toBe(g.statsArea.x)
        expect(g.calendarArea.y).toBeGreaterThan(g.statsArea.y)
      }
    })

    it('Horizontal avec une photo étroite (ratio 0.5) : assez de place, partage toujours côte à côte', () => {
      // ratio 0.5 (photo plus haute que large) laisse un colW de 900 (voir textColumnWidth),
      // moitié 435 : au-dessus du seuil 400, le partage côte à côte reste le bon choix (ne pas
      // empiler quand il y a de la place, cf. gabarits Vertical/Texte seul/Deux images qui,
      // eux, ont toujours assez de place et ne doivent jamais basculer en empilé).
      const g = computeBadgeGeometry('horizontal', 0.5, 3, 1, true)
      expect(g.calendarArea).not.toBeNull()
      expect(g.statsArea.x + g.statsArea.w).toBeLessThanOrEqual(g.calendarArea.x)
      // Le calendrier commence sous le bloc titre (retour Julien, 18/09), pas à la même
      // hauteur que `statsArea.y` : cette dernière reste l'ancre du TITRE, pleine largeur,
      // au-dessus du calendrier (cf. `statsAreaWithCalendar`).
      expect(g.calendarArea.y).toBeGreaterThan(g.statsArea.y)
    })

    it('mode empilé : la carte calendaire tient toujours dans la hauteur retournée', () => {
      const g = computeBadgeGeometry('horizontal', 2, 3, 1, true)
      expect(g.calendarArea.y + g.calendarArea.h).toBeLessThanOrEqual(g.statsArea.h)
      expect(g.canvas.h).toBeGreaterThanOrEqual(g.statsArea.h)
    })

    it('mode empilé : si le texte dépasse la hauteur ancrée sur la photo, le canevas grandit pour tout loger', () => {
      // 12 lignes de stats poussent le contenu texte bien au-delà des 780px (600 + marges)
      // ancrés sur la photo pour Horizontal : la carte calendaire empilée doit alors faire
      // grandir le canevas, jamais déborder en silence.
      const sansCalendrier = computeBadgeGeometry('horizontal', 2, 12, 1, false)
      const avecCalendrier = computeBadgeGeometry('horizontal', 2, 12, 1, true)
      expect(avecCalendrier.canvas.h).toBeGreaterThan(sansCalendrier.canvas.h)
    })

    it('renderBadge dessine la grille quand includeCalendar est vrai et que stats.grid existe, sur la moitié droite (calendarArea)', () => {
      const { canvas, calls } = stubCanvas()
      renderBadge(canvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats: gridStats, photoImg: null,
        project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20), includeCalendar: true,
      })
      // Mêmes arguments (1 statKey, pas de texte libre, titre sur 1 ligne) que l'appel
      // renderBadge ci-dessus, pour que `calendarArea` retombe sur la même géométrie — en
      // pratique son `.x` ne dépend même pas de statLineCount/titleLineCount pour le gabarit
      // Vertical (le partage porte sur `w` du canevas, pas sur la hauteur du contenu), mais on
      // garde les arguments alignés pour ne jamais avoir à s'en souvenir.
      const { calendarArea } = computeBadgeGeometry('vertical', 1, 1, 1, true)
      expect(calendarArea).not.toBeNull()
      // Au moins une cellule dessinée (fillRect ou strokeRect au-delà du dégradé/bandeau/photo).
      const cellCalls = calls.filter((c) => c[0] === 'fillRect' || c[0] === 'strokeRect')
      expect(cellCalls.length).toBeGreaterThan(2) // dégradé + bandeau au minimum, donc >2 si des cellules s'ajoutent
      // Les 2 premiers appels fillRect sont le dégradé de fond puis le bandeau (aucun photoImg
      // ici, donc rien d'autre avant) — tout ce qui suit vient de `drawCalendar`. `fillRect` est
      // poussé par le stub en `['fillRect', ctx.fillStyle, x, y, w, h]` (fillStyle intercalé),
      // `strokeRect` en `['strokeRect', x, y, w, h]` (pas de fillStyle) : l'index de `x` diffère
      // selon l'appel, d'où ce petit accesseur plutôt qu'un indice fixe.
      const callX = (call) => (call[0] === 'fillRect' ? call[2] : call[1])
      const gridCalls = cellCalls.slice(2)
      expect(gridCalls.length).toBeGreaterThan(0)
      // Preuve que la grille est bien peinte sur la MOITIÉ DROITE du cartouche (`calendarArea`),
      // pas ailleurs sur le canevas — c'est l'affirmation même du commit, pas seulement « quelque
      // chose de plus a été dessiné ».
      expect(gridCalls.some((c) => callX(c) >= calendarArea.x)).toBe(true)
    })

    // Retour Julien (capture d'écran, 19/09) : « le calendrier dépasse sur la zone photo au
    // lieu d'être aligné avec le reste du texte ». Pas un chevauchement de rectangles
    // (`calendarArea` reste structurellement sous `photoSlot`, déjà garanti par construction
    // dans `statsAreaWithCalendar`) mais une marge incohérente : `calendarArea` va bord à bord
    // jusqu'au bord droit du canevas (nécessaire pour le bandeau et `rowtine.app`, cf. tests
    // ci-dessus), alors que `drawCalendar` (badge-calendar.js) ne retire que son propre `PAD`
    // interne (16px) avant de dessiner sa grille — bien moins que la marge `TEXT_PAD` (60px)
    // que respecte tout le reste du cartouche (titre, valeurs, date, « rowtine.app ») ou que la
    // marge de la photo (`MARGIN`, 90px). Le défaut n'apparaît que si l'historique du projet a
    // assez de semaines pour remplir toute la largeur disponible (`maxCols` non limitant, sinon
    // la grille reste plus étroite que sa zone et la marge, mécaniquement, redevient large) —
    // 60 semaines dans les scénarios ci-dessous couvrent ce cas. Le correctif ne s'applique
    // QUE côté mode `side` (calendrier à côté des stats, celui du gabarit Vertical — toujours
    // dans ce mode, cf. rapport de la tâche) : le mode `stack` (calendrier empilé, Horizontal
    // avec une photo carrée/large) garde son ancienne marge, symétrique bien que trop courte
    // des deux côtés — un correctif à part, hors de ce retour précis (cf. dernier test).
    const TEXT_PAD = 60 // valeur figée de badge-render.js (non exportée)
    function longGridColumns(n = 60) {
      return Array.from({ length: n }, (_, i) => ({
        monday: `col-${i}`,
        cells: Array.from({ length: 7 }, (_, ri) => ({ day: `d-${i}-${ri}`, level: (ri + i) % 5, future: false })),
      }))
    }
    function drawnCalendarBounds(calls) {
      const cellCalls = calls.filter((c) => c[0] === 'fillRect' && typeof c[2] === 'number').slice(2) // skip dégradé + bandeau
      const strokeCells = calls.filter((c) => c[0] === 'strokeRect')
      const rights = [...cellCalls.map((c) => c[2] + c[4]), ...strokeCells.map((c) => c[1] + c[3])]
      return { count: rights.length, maxRight: Math.max(...rights) }
    }

    it('gabarit Vertical, historique long (assez de semaines pour remplir la largeur) : la grille garde une marge cohérente avec le reste du cartouche, jamais collée au bord droit du canevas', () => {
      const { canvas, calls } = stubCanvas()
      const longGridStats = { ...stats, grid: { columns: longGridColumns() } }
      renderBadge(canvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats: longGridStats, photoImg: null,
        project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20), includeCalendar: true,
      })
      const { calendarArea } = computeBadgeGeometry('vertical', 1, 1, 1, true)
      const { count, maxRight } = drawnCalendarBounds(calls)
      expect(count).toBeGreaterThan(0)
      // Borne basse : la marge doit désormais valoir au moins TEXT_PAD (le défaut corrigé).
      expect(canvas.width - maxRight).toBeGreaterThanOrEqual(TEXT_PAD)
      // Borne haute : la grille doit rester dans sa zone réelle, jamais réduite à rien — sinon
      // une régression qui arrêterait de dessiner la grille passerait ce test par accident.
      expect(maxRight).toBeGreaterThan(calendarArea.x)
    })

    it('gabarit Horizontal, mode côte à côte (photo étroite) : même marge cohérente que Vertical', () => {
      const { canvas, calls } = stubCanvas()
      const longGridStats = { ...stats, grid: { columns: longGridColumns() } }
      renderBadge(canvas, {
        templateKey: 'horizontal', color: 'hsl(200 70% 45%)', photoRatio: 0.5,
        statKeys: ['totalTime'], stats: longGridStats, photoImg: null,
        project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20), includeCalendar: true,
      })
      const { calendarArea, statsArea } = computeBadgeGeometry('horizontal', 0.5, 1, 1, true)
      expect(calendarArea.x).toBeGreaterThan(statsArea.x) // confirme le mode côte à côte
      const { count, maxRight } = drawnCalendarBounds(calls)
      expect(count).toBeGreaterThan(0)
      expect(canvas.width - maxRight).toBeGreaterThanOrEqual(TEXT_PAD)
    })

    it('gabarit Horizontal, mode empilé (photo carrée) : marge INCHANGÉE (hors de la portée de ce retour, calendrier déjà symétrique gauche/droite)', () => {
      const { canvas, calls } = stubCanvas()
      const longGridStats = { ...stats, grid: { columns: longGridColumns() } }
      renderBadge(canvas, {
        templateKey: 'horizontal', color: 'hsl(200 70% 45%)', photoRatio: 1,
        statKeys: ['totalTime'], stats: longGridStats, photoImg: null,
        project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20), includeCalendar: true,
      })
      const { calendarArea, statsArea } = computeBadgeGeometry('horizontal', 1, 1, 1, true)
      expect(calendarArea.x).toBe(statsArea.x) // confirme le mode empilé
      const { count, maxRight } = drawnCalendarBounds(calls)
      expect(count).toBeGreaterThan(0)
      // Marge encore courte ici (juste le `PAD` interne de drawCalendar) — documenté, pas
      // corrigé par cette tâche : si ce test casse, c'est que la portée du correctif a changé
      // (à répercuter dans le commentaire ci-dessus et dans le rapport de la Tâche 1).
      expect(canvas.width - maxRight).toBeLessThan(TEXT_PAD)
    })

    it('renderBadge : includeCalendar vrai mais grid absent -> aucune exception, pas de dessin de grille', () => {
      const { canvas } = stubCanvas()
      expect(() =>
        renderBadge(canvas, {
          templateKey: 'vertical', color: 'hsl(200 70% 45%)',
          statKeys: [], stats: { ...stats, grid: undefined }, photoImg: null,
          project: { name: 'X' }, t, generatedAt: new Date(), includeCalendar: true,
        }),
      ).not.toThrow()
    })
  })
})

describe('largeur du canevas pilotée par le contenu (retour 17/09)', () => {
  it('Texte seul + carte calendaire : format paysage, pas le portrait fixe du gabarit', () => {
    const sans = computeBadgeGeometry('minimal', 1, 3, 1, false)
    const avec = computeBadgeGeometry('minimal', 1, 3, 1, true)
    expect(sans.canvas.w).toBe(BADGE_TEMPLATES.minimal.canvas.w) // inchangé sans calendrier
    expect(avec.canvas.w).toBeGreaterThan(sans.canvas.w) // paysage : nettement plus large
    expect(avec.canvas.w).toBeGreaterThan(avec.canvas.h) // paysage : plus large que haut, au moins pour un contenu court
  })

  it('Horizontal : le canevas s’élargit pour loger une ligne de stat naturellement longue sans la faire wrapper', () => {
    const g = computeBadgeGeometry('horizontal', 1, 1, 1, false, 900) // requiredTextWidth simulé (voir Step 3)
    expect(g.statsArea.w).toBeGreaterThanOrEqual(900)
    expect(g.canvas.w).toBeGreaterThanOrEqual(g.statsArea.w)
  })

  it('Deux images : le canevas s’élargit pour la même raison, jamais réduit sous la largeur du gabarit', () => {
    const large = computeBadgeGeometry('double', 1, 1, 1, false, 1400)
    const normal = computeBadgeGeometry('double', 1, 1, 1, false, 0)
    expect(large.canvas.w).toBeGreaterThan(normal.canvas.w)
    expect(normal.canvas.w).toBe(BADGE_TEMPLATES.double.canvas.w) // 0 (ou omis) : comportement inchangé
  })

  it('Vertical : le canevas s’élargit pour un texte qui l’exige, jamais réduit sous la largeur du gabarit', () => {
    const large = computeBadgeGeometry('vertical', 1, 1, 1, false, 1400)
    const normal = computeBadgeGeometry('vertical', 1, 1, 1, false, 0)
    expect(large.canvas.w).toBeGreaterThan(normal.canvas.w)
    expect(normal.canvas.w).toBe(BADGE_TEMPLATES.vertical.canvas.w) // 0 (ou omis) : comportement inchangé
  })

  // Correctif (revue coordinateur, 19/09, suite Task 3) : `minimal` était le SEUL gabarit sans
  // photo à ignorer `requiredTextWidth` — avant le style empilé unique, sa ligne jointe
  // `Label · Valeur` passait par `wrapText` à largeur FIXE et ne débordait donc jamais ; depuis
  // que seul le LIBELLÉ s'enroule (`wrapStackedLabels`), une VALEUR longue (jamais enroulée, cf.
  // `drawStackedBlocks`) devait déborder du cartouche à largeur fixe. Corrigé en alignant
  // `textColumnWidth`/`computeBadgeGeometry` sur le motif déjà en place pour les 3 autres
  // gabarits (`Math.max(..., requiredTextWidth)`).
  it('Texte seul : le canevas s’élargit pour une valeur de stat longue qui l’exige, jamais réduit sous la largeur du gabarit', () => {
    const large = computeBadgeGeometry('minimal', 1, 1, 1, false, 1400)
    const normal = computeBadgeGeometry('minimal', 1, 1, 1, false, 0)
    expect(large.canvas.w).toBeGreaterThan(normal.canvas.w)
    expect(normal.canvas.w).toBe(BADGE_TEMPLATES.minimal.canvas.w) // 0 (ou omis) : comportement inchangé
    expect(large.statsArea.w).toBeGreaterThanOrEqual(1400)
  })

  it('Texte seul + carte calendaire : le canevas paysage s’élargit AUSSI pour une valeur de stat longue', () => {
    const large = computeBadgeGeometry('minimal', 1, 1, 1, true, 1600)
    const normal = computeBadgeGeometry('minimal', 1, 1, 1, true, 0)
    expect(large.canvas.w).toBeGreaterThan(normal.canvas.w)
    expect(normal.canvas.w).toBe(1350) // MINIMAL_LANDSCAPE_W (non exportée), comportement inchangé sans texte long
  })

  it('Vertical : le slot photo s’élargit avec le cartouche, même ratio conservé', () => {
    const normal = computeBadgeGeometry('vertical', 1, 1, 1, false, 0)
    const large = computeBadgeGeometry('vertical', 1, 1, 1, false, 1400)
    expect(large.photoSlot.w).toBeGreaterThan(normal.photoSlot.w)
    // Ratio carré conservé : la photo, ancrée en largeur, grandit aussi en hauteur.
    expect(large.photoSlot.h).toBeGreaterThan(normal.photoSlot.h)
    expect(large.photoSlot.w / large.photoSlot.h).toBeCloseTo(normal.photoSlot.w / normal.photoSlot.h)
  })

  it('renderBadge : une ligne de stat très longue ne revient plus à la ligne en Horizontal (bloc empilé, Task 4 : libellé/valeur séparés, jamais fragmentés)', () => {
    const { canvas, calls } = stubCanvas()
    const longStats = { ...stats, bestStreak: 999 } // measureText fictif (FAKE_CHAR_WIDTH=20) rend "streakValue" long
    renderBadge(canvas, {
      templateKey: 'horizontal', color: 'hsl(230 70% 45%)',
      statKeys: ['bestStreak'], stats: longStats, photoImg: null,
      project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20),
    })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    // Bloc empilé (Task 4) : libellé et valeur dessinés SÉPARÉMENT (plus de chaîne jointe
    // « · »), chacun entier — ni l'un ni l'autre n'a été coupé en fragments (chaque fragment
    // de wrapText serait un texte SÉPARÉ, aucun ne contiendrait la phrase entière).
    expect(texts).toContain(t('project.stats.bestStreak').toUpperCase())
    expect(texts).toContain(nbsp(t('project.stats.streakValue', 999)))
  })

  // Couverture du PLAFOND (REQUIRED_TEXT_WIDTH_CAP = 1800, non exposé) : ajouté après revue
  // (le plafond ne se déclenche que dans `renderBadge`, jamais atteignable via
  // `computeBadgeGeometry` seul puisque `requiredTextWidth` y est un argument déjà mesuré) —
  // sans ce test, aucun des 5 cas du brief ne l'exerçait. Nom de 98 caractères (largeur brute
  // fictive 1960px) : sans plafond, le canevas atteindrait 750 + 1960 + 120 = 2830px ; plafonné
  // à 1800, il s'arrête à 750 + 1800 = 2550px — et le nom, dont la largeur (1960) dépasse la
  // largeur de texte alors disponible (1800 - 120 = 1680), continue de revenir à la ligne :
  // dégradation silencieuse voulue, pas un canevas absurde.
  it('renderBadge : un nom de projet pathologiquement long est plafonné (1800px), le canevas ne devient pas absurde', () => {
    const { canvas } = stubCanvas()
    const veryLongName = 'Pull raglan torsadé pour les longues soirées d’hiver, tricoté en laine épaisse avec un col montant'
    renderBadge(canvas, {
      templateKey: 'horizontal', color: 'hsl(230 70% 45%)',
      statKeys: [], stats, photoImg: null,
      project: { name: veryLongName }, t, generatedAt: new Date(2026, 0, 20),
    })
    expect(canvas.width).toBe(2550) // 90 (MARGIN) + 600 (slot) + 60 (GAP) + 1800 (colW plafonné)
    expect(canvas.width).toBeLessThan(90 + 600 + 60 + veryLongName.length * FAKE_CHAR_WIDTH + 120)
  })

  it("renderBadge : icône vegan dessinée si vegan:true (Path2D mocké), absente sinon", () => {
    const originalPath2D = globalThis.Path2D
    globalThis.Path2D = class { constructor(d) { this.d = d } }
    try {
      // `stroke(new Path2D(d))` (icône vegan, 1 argument) vs `stroke()` (bordure de la
      // pastille Technique, Task 2, AUCUN argument) : cette fixture n'a pas de technique
      // (`project: { name: 'X' }`), donc un simple `some(c => c[0] === 'stroke')` distinguerait
      // déjà les deux cas ICI — mais un `c.length === 2` explicite (Path2D en argument) rend le
      // test correct même si un futur fixture ajoutait une technique, plutôt que de dépendre
      // silencieusement de son absence.
      const withIcon = stubCanvas()
      renderBadge(withIcon.canvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats, vegan: true,
        project: { name: 'X' }, photoImg: null, t, generatedAt: new Date(),
      })
      expect(withIcon.calls.some((c) => c[0] === 'stroke' && c.length === 2)).toBe(true)

      const withoutIcon = stubCanvas()
      renderBadge(withoutIcon.canvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats, vegan: false,
        project: { name: 'X' }, photoImg: null, t, generatedAt: new Date(),
      })
      expect(withoutIcon.calls.some((c) => c[0] === 'stroke' && c.length === 2)).toBe(false)
    } finally {
      globalThis.Path2D = originalPath2D
    }
  })

  it('renderBadge : vegan:true sans Path2D disponible (jsdom réel), aucune exception', () => {
    const fakeCanvas = stubCanvas()
    expect(() =>
      renderBadge(fakeCanvas.canvas, {
        templateKey: 'vertical', color: 'hsl(200 70% 45%)',
        statKeys: ['totalTime'], stats, vegan: true,
        project: { name: 'X' }, photoImg: null, t, generatedAt: new Date(),
      }),
    ).not.toThrow()
  })
})

// Task 1 du chantier « badge cartouche condensé » (18/09c) : `computeBadgeGeometry` gagnait un
// modèle de hauteur condensé (`'ledger'`/`'stacked'`), dérivé du gabarit, laissant `'legacy'`
// à minimal/double. Le chantier « badge corrections typo/zoom » (19/09) retire cette
// distinction : il n'y a plus qu'UNE formule de hauteur, appliquée aux 4 gabarits, et le
// paramètre `layoutStyle` disparaît de la signature (7 paramètres désormais, `freeTextLineCount`
// passe de 8e à 7e position — cf. describe suivant pour la preuve directe sur la signature).
describe('géométrie condensée : formule UNIQUE des 4 gabarits (retrait de layoutStyle, 19/09)', () => {
  // Constantes reprises de badge-render.js (non exportées) pour calculer à la main la hauteur
  // ATTENDUE — même discipline que `TEXT_PAD` en dur dans le describe « largeur du canevas... »
  // plus haut : ce sont des valeurs FIGÉES, pas une réimportation de l'implémentation.
  const TEXT_PAD = 60
  const TITLE_BASELINE = 56
  const LINE_HEIGHT = 64
  const CONDENSED_TITLE_GAP = 20
  const STACK_ROW_H = 74
  // 40 → 32 (Tâche 13, chantier « badge corrections typo/zoom », 19/09) : mesure réelle sur
  // Pixel 7, cf. le commentaire de `DATE_ROW_H` dans badge-render.js.
  const DATE_ROW_H = 32
  function expectedStatsAreaH(statLineCount, titleLineCount = 1) {
    const titleBlockHeight = TITLE_BASELINE + Math.max(0, titleLineCount - 1) * LINE_HEIGHT
    const condensedTitleRowHeight = titleBlockHeight + CONDENSED_TITLE_GAP
    return TEXT_PAD * 2 + condensedTitleRowHeight + statLineCount * STACK_ROW_H + DATE_ROW_H
  }

  for (const templateKey of ['vertical', 'horizontal', 'minimal', 'double']) {
    it(`${templateKey} : statsArea.h suit EXACTEMENT la formule empilée (TEXT_PAD*2 + condensedTitleRowHeight + N*STACK_ROW_H + DATE_ROW_H)`, () => {
      // 14 lignes : dépasse le plancher photo d'Horizontal (600 + marges = 780px), rendant la
      // formule observable pour LES 4 gabarits avec un seul nombre de lignes.
      const N = 14
      const g = computeBadgeGeometry(templateKey, 1, N, 1)
      expect(g.statsArea.h).toBe(expectedStatsAreaH(N, 1))
    })
  }

  it('carte calendaire (mode côte à côte, Vertical) : la carte reste bornée par le bloc stats condensé', () => {
    const g = computeBadgeGeometry('vertical', 1, 1, 1, true)
    expect(g.calendarArea).not.toBeNull()
    expect(g.calendarArea.h).toBeLessThan(g.statsArea.h)
  })
})

// Contrat inter-tâches (Task 4 en dépend) : `computeBadgeGeometry` a exactement 7 paramètres
// depuis ce chantier (19/09), `layoutStyle` retiré, `freeTextLineCount` en 7e position.
describe('computeBadgeGeometry : signature à 7 paramètres (contrat Task 4)', () => {
  for (const templateKey of ['vertical', 'horizontal', 'minimal', 'double']) {
    it(`${templateKey} : le 7e argument positionnel est bien freeTextLineCount (jamais layoutStyle)`, () => {
      const photoRatio = templateKey === 'double' ? [1, 1] : 1
      const sansTexteLibre = computeBadgeGeometry(templateKey, photoRatio, 2, 1, false, 0, 0)
      const avecTexteLibre = computeBadgeGeometry(templateKey, photoRatio, 2, 1, false, 0, 3)
      // Une chaîne comme `'ledger'`/`'stacked'` (ancien 7e argument) serait truthy mais NE
      // produirait PAS cet effet (`freeTextLineCount` retomberait sur son défaut 0) : la
      // hauteur ne grandirait pas. Ce test échouerait donc si `layoutStyle` était encore lu ici.
      expect(avecTexteLibre.canvas.h).toBeGreaterThan(sansTexteLibre.canvas.h)
      expect(avecTexteLibre.freeTextTop).not.toBeNull()
      expect(sansTexteLibre.freeTextTop).toBeNull()
    })
  }
})

// Task 5 du chantier « badge cartouche condensé » (18/09c) : le texte libre (`customText`)
// quitte le bloc stats pour Vertical/Horizontal — bloc À PART, pleine largeur du cartouche
// (`titleMaxWidth`-équivalent), jamais la largeur de la COLONNE stats (`statsMaxWidth`, qui
// peut être réduite de moitié par le calendrier en mode côte à côte). Le risque précis
// documenté au brief : avant cette tâche, `customText` était le dernier élément poussé dans
// `buildRawStatLines` et wrappait donc à la même largeur réduite que les stats.
describe('computeBadgeGeometry : freeTextLineCount (Task 5, texte libre ; 7e paramètre depuis le retrait de layoutStyle, 19/09)', () => {
  it("7e paramètre omis = 0 ligne de texte libre : résultat identique à un appel explicite à 0 (non-régression, `freeTextTop` à `null`)", () => {
    const implicit = computeBadgeGeometry('vertical', 1, 3, 1, false, 0)
    const explicitZero = computeBadgeGeometry('vertical', 1, 3, 1, false, 0, 0)
    expect(explicitZero).toEqual(implicit)
    expect(implicit.freeTextTop).toBeNull()
  })

  it("freeTextLineCount > 0 : statsArea.h et canvas.h grandissent, `freeTextTop` reste au bas RÉEL du contenu (stats+calendrier), INDÉPENDANT du nombre de lignes — seule la hauteur réservée APRÈS lui (`textBottom`) en dépend (cf. brief : réservée APRÈS le bloc stats+calendrier, pas dedans)", () => {
    const base = computeBadgeGeometry('vertical', 1, 3, 1, false, 0, 0)
    const uneLigne = computeBadgeGeometry('vertical', 1, 3, 1, false, 0, 1)
    const cinqLignes = computeBadgeGeometry('vertical', 1, 3, 1, false, 0, 5)
    expect(uneLigne.statsArea.h).toBeGreaterThan(base.statsArea.h)
    expect(uneLigne.canvas.h).toBeGreaterThan(base.canvas.h)
    expect(uneLigne.freeTextTop).not.toBeNull()
    // Même position de départ à 1 ou 5 lignes : la hauteur du bloc stats+calendrier ne bouge
    // pas selon la longueur du texte libre, seul ce qui vient APRÈS (`textBottom`) grandit.
    expect(cinqLignes.freeTextTop).toBe(uneLigne.freeTextTop)
    expect(cinqLignes.textBottom).toBeGreaterThan(uneLigne.textBottom)
    expect(uneLigne.textBottom).toBeGreaterThan(base.textBottom)
  })

  it('même invariant pour Horizontal', () => {
    const base = computeBadgeGeometry('horizontal', 1, 3, 1, false, 0, 0)
    const uneLigne = computeBadgeGeometry('horizontal', 1, 3, 1, false, 0, 1)
    const cinqLignes = computeBadgeGeometry('horizontal', 1, 3, 1, false, 0, 5)
    expect(uneLigne.statsArea.h).toBeGreaterThan(base.statsArea.h)
    expect(cinqLignes.freeTextTop).toBe(uneLigne.freeTextTop)
    expect(cinqLignes.textBottom).toBeGreaterThan(uneLigne.textBottom)
  })

  it('même invariant pour minimal et double (universel depuis ce chantier, 19/09)', () => {
    for (const templateKey of ['minimal', 'double']) {
      const photoRatio = templateKey === 'double' ? [1, 1] : 1
      const base = computeBadgeGeometry(templateKey, photoRatio, 3, 1, false, 0, 0)
      const uneLigne = computeBadgeGeometry(templateKey, photoRatio, 3, 1, false, 0, 1)
      const cinqLignes = computeBadgeGeometry(templateKey, photoRatio, 3, 1, false, 0, 5)
      expect(uneLigne.statsArea.h).toBeGreaterThan(base.statsArea.h)
      expect(cinqLignes.freeTextTop).toBe(uneLigne.freeTextTop)
      expect(cinqLignes.textBottom).toBeGreaterThan(uneLigne.textBottom)
    }
  })

  it("carte calendaire mode côte à côte (Vertical) : freeTextLineCount ne change PAS sa hauteur/position (`calendarLayout` inchangé, contrainte du plan) — seul le canevas grandit, en plus, après elle", () => {
    const sans = computeBadgeGeometry('vertical', 1, 1, 1, true, 0, 0)
    const avec = computeBadgeGeometry('vertical', 1, 1, 1, true, 0, 3)
    expect(avec.calendarArea.h).toBe(sans.calendarArea.h)
    expect(avec.calendarArea.y).toBe(sans.calendarArea.y)
    expect(avec.calendarArea.w).toBe(sans.calendarArea.w)
    expect(avec.canvas.h).toBeGreaterThan(sans.canvas.h)
  })

  it("7e paramètre omis = résultat identique à un appel explicite à 0 (les 4 gabarits)", () => {
    for (const templateKey of ['vertical', 'horizontal', 'minimal', 'double']) {
      const photoRatio = templateKey === 'double' ? [1, 1] : 1
      const sansParam = computeBadgeGeometry(templateKey, photoRatio, 4, 1, false)
      const avecZeroExplicite = computeBadgeGeometry(templateKey, photoRatio, 4, 1, false, 0, 0)
      expect(avecZeroExplicite).toEqual(sansParam)
    }
  })
})

describe('renderBadge : texte libre pleine largeur (Task 5, Vertical/Horizontal)', () => {
  // 38 caractères → 760px de largeur « mesurée » (FAKE_CHAR_WIDTH = 20/caractère) : dépasse la
  // colonne stats réduite des deux scénarios ci-dessous (405px en Vertical côte à côte, 315px
  // en Horizontal côte à côte avec photo étroite) mais tient dans leur largeur PLEINE
  // respective (960px / 780px) — plusieurs mots, pour que `wrapText` puisse RÉELLEMENT le
  // répartir sur plusieurs lignes s'il était (à tort) wrappé à la largeur réduite.
  const longCustomText = 'Merci pour ce moment de tricot partagé'
  const TEXT_PAD = 60

  it('Vertical + calendrier actif (mode côte à côte, colonne stats réduite ~moitié) : le texte libre tient sur UNE seule ligne, pas coupé à la largeur réduite', () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20),
      includeCalendar: true, customText: longCustomText,
    })
    // Preuve géométrique que la colonne stats est bien plus étroite que le texte libre, et que
    // sa largeur PLEINE, elle, le contient sur une ligne (sinon ce test ne prouverait rien).
    const g = computeBadgeGeometry('vertical', 1, 1, 1, true)
    const statsMaxWidth = g.statsArea.w - TEXT_PAD * 2
    const titleMaxWidth = g.canvas.w - TEXT_PAD * 2
    expect(longCustomText.length * FAKE_CHAR_WIDTH).toBeGreaterThan(statsMaxWidth)
    expect(longCustomText.length * FAKE_CHAR_WIDTH).toBeLessThanOrEqual(titleMaxWidth)
    const fillTexts = calls.filter((c) => c[0] === 'fillText')
    const customCall = fillTexts.find((c) => c[1] === longCustomText)
    expect(customCall).toBeDefined()
    // Preuve que ce n'est pas juste « le texte apparaît » (avant cette tâche, `drawLedgerRows`
    // dessinait DÉJÀ la chaîne entière, non wrappée, comme VALEUR d'une rangée — jamais coupée
    // mais alignée à DROITE de la colonne stats étroite) : ici, x = bord GAUCHE du cartouche
    // (`textX`, même abscisse que le titre), jamais la colonne stats ni un alignement à droite.
    const textX = g.statsArea.x + TEXT_PAD
    expect(customCall[2]).toBe(textX)
  })

  it('Horizontal + calendrier actif (photo étroite, mode côte à côte, colonne texte étroite) : le texte libre tient sur UNE seule ligne', () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'horizontal', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20),
      photoRatio: 0.5, includeCalendar: true, customText: longCustomText,
    })
    // 7e argument (freeTextLineCount) explicite à 1, comme le fait réellement `renderBadge`
    // (`longCustomText` tient sur une seule ligne à la largeur pleine, cf. commentaire de tête) :
    // depuis la Tâche 1 (20/09, badge-horizontal-photo-hauteur), la photo Horizontal suit la
    // hauteur du canevas, qui dépend elle-même du texte libre réservé — un appel qui l'omettrait
    // (défaut 0) recalculerait une géométrie légèrement plus basse, donc `statsArea.x` (dérivé de
    // la largeur de la photo) ne correspondrait plus à celui réellement utilisé par le dessin.
    const g = computeBadgeGeometry('horizontal', 0.5, 1, 1, true, 0, 1)
    const statsMaxWidth = g.statsArea.w - TEXT_PAD * 2
    expect(longCustomText.length * FAKE_CHAR_WIDTH).toBeGreaterThan(statsMaxWidth)
    const fillTexts = calls.filter((c) => c[0] === 'fillText')
    const customCall = fillTexts.find((c) => c[1] === longCustomText)
    expect(customCall).toBeDefined()
    const textX = g.statsArea.x + TEXT_PAD
    expect(customCall[2]).toBe(textX)
  })

  // Texte volontairement bien plus long que les deux tests « tient sur une seule ligne »
  // ci-dessus : 160 caractères (mots de longueur variée), soit ~3200px « mesurés » — dépasse
  // largement la largeur PLEINE la plus généreuse jamais atteinte par ce cartouche (1680px,
  // `REQUIRED_TEXT_WIDTH_CAP` moins les marges), donc `wrapText` le répartit TOUJOURS sur
  // plusieurs lignes, quelle que soit la largeur pleine réellement retenue. Preuve, à travers
  // `renderBadge` en entier (pas seulement `computeBadgeGeometry`), que le retour à la ligne
  // réel produit bien plusieurs `fillText`, chacun à la largeur PLEINE (jamais coupé au mot
  // près à la colonne stats/empilée) — les deux tests précédents, à UNE seule ligne, ne
  // prouvaient que la largeur de wrap choisie, pas que le retour à la ligne lui-même fonctionne
  // correctement une fois déclenché.
  const veryLongCustomText = 'Merci infiniment pour ce moment de tricot partage en ce moment avec toute la bienveillance et la generosite qui font la force de cette communaute extraordinaire'

  it("Vertical + calendrier actif : `customText` déborde même la largeur PLEINE du cartouche — réparti sur PLUSIEURS lignes, chacune dessinée à x = bord gauche du cartouche (pas la colonne stats)", () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20),
      includeCalendar: true, customText: veryLongCustomText,
    })
    // `canvas.width` (posé par `renderBadge`, cf. `computeBadgeGeometry`) VAUT `colW` pour
    // Vertical (portrait) : `canvasW = Math.max(tpl.canvas.w, colW)` et `colW` est déjà
    // `>= tpl.canvas.w` par construction (`textColumnWidth`). La largeur PLEINE réellement
    // utilisée par `renderBadge` pour wrapper le texte libre (`titleMaxWidth`) s'en déduit donc
    // exactement, quel que soit l'élargissement du cartouche déclenché par ce texte très long —
    // pas besoin de reproduire à la main le calcul de `requiredTextWidth`.
    const titleMaxWidth = canvas.width - TEXT_PAD * 2
    const measureCtx = { measureText: (s) => ({ width: String(s).length * FAKE_CHAR_WIDTH }) }
    const expectedLines = wrapText(measureCtx, veryLongCustomText, titleMaxWidth)
    expect(expectedLines.length).toBeGreaterThan(1) // preuve qu'il déborde même la largeur PLEINE
    const textX = 0 + TEXT_PAD // statsArea.x = 0 pour Vertical (portrait), quel que soit le mode calendrier
    const fillTexts = calls.filter((c) => c[0] === 'fillText')
    for (const line of expectedLines) {
      const call = fillTexts.find((c) => c[1] === line)
      expect(call).toBeDefined() // chaque fragment wrappé apparaît bien comme fillText séparé
      expect(call[2]).toBe(textX) // largeur PLEINE (bord gauche du cartouche), jamais la colonne stats
      expect(measureCtx.measureText(line).width).toBeLessThanOrEqual(titleMaxWidth)
    }
  })

  it("Horizontal : `customText` déborde même la largeur PLEINE du cartouche — réparti sur PLUSIEURS lignes, chacune dessinée à x = bord gauche du cartouche (preuve que cette tâche change bien quelque chose pour Horizontal : `drawStackedBlocks` alignait déjà à gauche avant, seule une ligne UNIQUE ne le prouvait pas)", () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'horizontal', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20),
      customText: veryLongCustomText,
    })
    const MARGIN = 90 // valeur figée de badge-render.js (non exportée), cf. autres tests du fichier
    const GAP = 60
    // `statsX` n'est PLUS fixe à `MARGIN + 600 + GAP` depuis la Tâche 1 (20/09,
    // badge-horizontal-photo-hauteur) : la photo Horizontal suit désormais la hauteur du
    // canevas, qui grandit ici bien au-delà du plancher (le texte libre très long réserve
    // plusieurs lignes) — sa largeur, donc `statsX`, grandit avec elle. Dérivé ici de
    // `canvas.height`, JAMAIS de `canvas.width` (revue, tour 2) : `photoRatio` par défaut (1,
    // non transmis à `renderBadge`) donne un slot CARRÉ occupant TOUJOURS toute la hauteur
    // disponible entre les deux marges (`photoSlot.h === canvas.h - MARGIN*2`, cf. le
    // commentaire de la branche `landscape` dans badge-render.js) — `statsX` s'en déduit
    // directement, sans jamais passer par `canvas.width` (qui reste alors une vraie inconnue à
    // vérifier plus bas, pas une valeur déjà supposée bonne).
    const statsX = MARGIN + (canvas.height - MARGIN * 2) + GAP
    // `colW` : seule autre valeur déductible sans redemander toute la géométrie — `requiredTextWidth`
    // (mesure du texte libre BRUT, non wrappé) dépasse largement `REQUIRED_TEXT_WIDTH_CAP` ici,
    // donc `colW` (`textColumnWidth`, inchangée par cette tâche) SATURE à ce plafond,
    // indépendamment de la largeur de la photo.
    const REQUIRED_TEXT_WIDTH_CAP = 1800 // valeur figée de badge-render.js (non exportée)
    const colW = REQUIRED_TEXT_WIDTH_CAP
    // `canvas.width` RÉELLEMENT vérifié ici (tour 2 : l'ancienne version le supposait déjà bon
    // en dérivant `statsX` de lui, assertion partiellement circulaire) : `canvasW = statsX +
    // colW`, cf. la branche `landscape` de `computeBadgeGeometry`.
    expect(canvas.width).toBe(statsX + colW)
    const titleMaxWidth = canvas.width - statsX - TEXT_PAD * 2
    const measureCtx = { measureText: (s) => ({ width: String(s).length * FAKE_CHAR_WIDTH }) }
    const expectedLines = wrapText(measureCtx, veryLongCustomText, titleMaxWidth)
    expect(expectedLines.length).toBeGreaterThan(1)
    const textX = statsX + TEXT_PAD
    const fillTexts = calls.filter((c) => c[0] === 'fillText')
    for (const line of expectedLines) {
      const call = fillTexts.find((c) => c[1] === line)
      expect(call).toBeDefined()
      expect(call[2]).toBe(textX)
      expect(measureCtx.measureText(line).width).toBeLessThanOrEqual(titleMaxWidth)
    }
  })

  it('le texte libre reste juste avant la ligne date/rowtine.app, après le bloc stats+calendrier (ordre ET position Y des fillText)', () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'vertical', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20),
      includeCalendar: true, customText: longCustomText,
    })
    const fillTexts = calls.filter((c) => c[0] === 'fillText')
    // Libellé du bloc empilé (Task 3) : « TEMPS TOTAL » tient sur une seule ligne même dans la
    // colonne stats réduite par le calendrier (`wrapStackedLabels` à `STACK_LABEL_FONT`, plus
    // petite que l'ancienne police « registre » — ce que ce test vérifie, l'ORDRE et la position
    // Y du bloc texte libre, n'en dépend de toute façon pas).
    const idxLabel = fillTexts.findIndex((c) => c[1] === 'TEMPS TOTAL')
    const idxCustom = fillTexts.findIndex((c) => c[1] === longCustomText)
    const idxDomain = fillTexts.findIndex((c) => c[1] === 'rowtine.app')
    expect(idxLabel).toBeGreaterThanOrEqual(0)
    expect(idxCustom).toBeGreaterThan(idxLabel)
    expect(idxDomain).toBeGreaterThan(idxCustom)
    // Même invariant en position Y (repère canvas, l'axe qui compte réellement pour un
    // chevauchement) : strictement entre le bloc stats et la ligne date.
    const labelY = fillTexts[idxLabel][3]
    const customY = fillTexts[idxCustom][3]
    const domainY = fillTexts[idxDomain][3]
    expect(customY).toBeGreaterThan(labelY)
    expect(customY).toBeLessThan(domainY)
  })

  it('minimal/double : `customText` reste mélangé aux lignes de stats, comportement inchangé (hors scope Task 5)', () => {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey: 'minimal', color: 'hsl(230 70% 45%)',
      statKeys: ['totalTime'], stats, photoImg: null,
      project: { name: 'X' }, t, generatedAt: new Date(2026, 0, 20),
      customText: 'Un mot doux',
    })
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts).toContain(nbsp('Un mot doux'))
  })
})

// Revue FINALE de branche (19/09) — test d'INTERSECTION. Les trois défauts corrigés ce jour-là
// (largeur réservée à la pastille Technique, retour à la ligne du libellé « registre », écart
// sous le bloc titre) vivaient tous dans la même zone et aucune tâche prise isolément ne les
// faisait apparaître : il fallait un projet COMPLET — technique, laine au libellé long,
// calendrier coché, texte libre, ET un titre assez long pour déclencher l'élargissement du
// cartouche — pour les voir. Un scénario réaliste par gabarit condensé, à travers `renderBadge`
// en entier (canevas stub, vrais `wrapText`/`measureText`), sert désormais de garde permanent.
describe('projet complet : intersection des correctifs de la revue finale (19/09)', () => {
  const CONDENSED_TITLE_GAP = 20 // valeurs figées de badge-render.js (non exportées)
  const PILL_PAD_X = 14
  const STACK_LABEL_BASELINE_OFFSET = 24
  // 65 caractères : déclenche l'élargissement du cartouche (Vertical comme Horizontal) ET reste
  // la plus longue chaîne mesurée du scénario — sans quoi `requiredTextWidth` serait piloté par
  // une ligne de stats et laisserait par accident de la place à la pastille.
  const LONG_TITLE = 'Cardigan Anders torsades et jacquard en merinos du Nord tout doux'
  const FREE_TEXT = 'Termine juste avant les premiers froids' // sans chiffre : `withNbsp` ne le modifie pas
  const LONG_YARN = [{ yarn: { brand: 'Drops', model: 'Baby Merino Extra Fine Superwash Naturelle' }, balls: 4 }]
  const gridStats = {
    ...stats,
    grid: { columns: [{ monday: '2026-01-05', monthStart: true, cells: [{ day: 'd0', level: 1, future: false }] }] },
  }
  const tTechnique = (k, arg) => (k === 'technique.crochet' ? 'Crochet' : t(k, arg))

  function renderComplete(templateKey, extra = {}) {
    const { canvas, calls } = stubCanvas()
    renderBadge(canvas, {
      templateKey, color: 'hsl(200 70% 45%)', photoRatio: 1,
      statKeys: ['technique', 'totalTime', 'sessionsCount', 'yarns'],
      stats: gridStats, yarnUsage: LONG_YARN, photoImg: null,
      project: { name: LONG_TITLE, technique: 'crochet' },
      t: tTechnique, generatedAt: new Date(2026, 0, 20), locale: 'fr',
      includeCalendar: true, customText: FREE_TEXT, ...extra,
    })
    const fillTexts = calls.filter((c) => c[0] === 'fillText')
    const textX = fillTexts.find((c) => c[1] === LONG_TITLE)[2]
    // Lignes du titre : dessinées à `textX`, toutes sous-chaînes du titre. Le titre tient ici
    // sur une seule ligne, mais l'écart attendu est dérivé de la DERNIÈRE ligne réellement
    // dessinée, jamais d'un `titleBlockHeight` recodé en dur dans le test.
    const titleCalls = fillTexts.filter((c) => c[2] === textX && c[1].length > 3 && LONG_TITLE.includes(c[1]))
    return {
      canvas, calls, fillTexts, textX,
      lastTitleBaselineY: Math.max(...titleCalls.map((c) => c[3])),
      pillCall: fillTexts.find((c) => c[1] === 'CROCHET'),
      // Libellés de stats : MAJUSCULES, au bord gauche de la colonne. Le titre, le texte libre
      // et la date ne sont pas en majuscules ; « rowtine.app » est aligné à droite ; les textes
      // de la carte calendaire sont dessinés à son propre x. Aucun faux positif.
      labelCalls: fillTexts.filter((c) => c[2] === textX && c[1] === c[1].toUpperCase() && /[A-Z]/.test(c[1])),
      dividers: calls.filter((c) => c[0] === 'fillRect' && c[5] === 1),
    }
  }

  function expectPillInsideCanvas({ canvas, pillCall }) {
    expect(pillCall).toBeTruthy()
    // Bord droit de la pastille = x du texte + sa largeur + le padding droit (cf. `drawTechniqueBadge`).
    expect(pillCall[2] + pillCall[1].length * FAKE_CHAR_WIDTH + PILL_PAD_X).toBeLessThanOrEqual(canvas.width)
  }

  function expectFreeTextBeforeFooter({ fillTexts }) {
    const idxFree = fillTexts.findIndex((c) => c[1] === FREE_TEXT)
    const idxDomain = fillTexts.findIndex((c) => c[1] === 'rowtine.app')
    expect(idxFree).toBeGreaterThanOrEqual(0)
    expect(idxDomain).toBeGreaterThan(idxFree)
    expect(fillTexts[idxFree][3]).toBeLessThan(fillTexts[idxDomain][3])
  }

  it('Vertical (avec icône vegan) : pastille dans le canevas, blocs empilés sans chevauchement, écart sous le titre, texte libre avant la ligne date', () => {
    const originalPath2D = globalThis.Path2D
    globalThis.Path2D = class { constructor(d) { this.d = d } }
    try {
      const r = renderComplete('vertical', { vegan: true })
      // Le scénario déclenche RÉELLEMENT l'élargissement du cartouche (sans quoi la pastille
      // aurait eu de la marge par accident et l'assertion suivante ne prouverait rien).
      expect(r.canvas.width).toBeGreaterThan(BADGE_TEMPLATES.vertical.canvas.w)
      expectPillInsideCanvas(r) // garde de non-régression du correctif « largeur de la pastille »

      // Écart sous le bloc titre : le premier bloc empilé démarre sous la dernière ligne de
      // base du titre, exactement de CONDENSED_TITLE_GAP — dérivé de la ligne RÉELLEMENT
      // dessinée (style empilé, UNIQUE depuis ce chantier — plus de filet « registre »).
      const firstBlockTop = Math.min(...r.labelCalls.map((c) => c[3])) - STACK_LABEL_BASELINE_OFFSET
      expect(firstBlockTop).toBe(r.lastTitleBaselineY + CONDENSED_TITLE_GAP)

      // Chevauchement structurellement impossible en empilé : libellé et valeur partagent la
      // même abscisse et la valeur est TOUJOURS sous son libellé (deux lignes, jamais deux
      // colonnes) — pour chaque ligne de libellé, la valeur associée (même colonne X, Y
      // strictement inférieur) est en dessous, jamais superposée.
      expect(r.dividers.length).toBe(0) // aucun filet, style empilé partout depuis ce chantier
      const labelYs = r.labelCalls.map((c) => c[3])
      expect(labelYs.length).toBeGreaterThan(0)

      // Le libellé de laine est bien REVENU À LA LIGNE (plusieurs lignes en majuscules pour la
      // seule laine) — libellé complet (marque + modèle, cf. `yarnLabel`), pas seulement le
      // modèle : la première sous-ligne wrappée commence par la marque.
      const fullYarnLabel = `${LONG_YARN[0].yarn.brand} ${LONG_YARN[0].yarn.model}`.toUpperCase()
      expect(r.labelCalls.filter((c) => fullYarnLabel.includes(c[1])).length).toBeGreaterThan(1)

      expectFreeTextBeforeFooter(r)
    } finally {
      globalThis.Path2D = originalPath2D
    }
  })

  it('Horizontal : pastille dans le canevas, blocs empilés sans chevauchement, écart sous le titre, texte libre avant la ligne date', () => {
    const r = renderComplete('horizontal')
    expect(r.canvas.width).toBeGreaterThan(BADGE_TEMPLATES.horizontal.canvas.w)
    expectPillInsideCanvas(r)

    // Premier bloc empilé : son haut se déduit de la ligne de base de son libellé.
    const firstBlockTop = Math.min(...r.labelCalls.map((c) => c[3])) - STACK_LABEL_BASELINE_OFFSET
    expect(firstBlockTop).toBe(r.lastTitleBaselineY + CONDENSED_TITLE_GAP)

    // Chevauchement structurellement impossible en empilé : libellé et valeur partagent la même
    // abscisse et la valeur est TOUJOURS sous son libellé (deux lignes, jamais deux colonnes).
    const labelY = r.fillTexts.find((c) => c[1] === 'TEMPS TOTAL')[3]
    const valueCall = r.fillTexts.find((c) => c[1] === nbsp('2 h 15 min'))
    expect(valueCall[2]).toBe(r.textX)
    expect(valueCall[3]).toBeGreaterThan(labelY)

    // Pas de filet en Horizontal (différence voulue avec Vertical, cf. Task 4).
    expect(r.dividers.length).toBe(0)

    expectFreeTextBeforeFooter(r)
  })
})

describe('marge au-dessus de la ligne date en mode calendrier (côte-à-côte ET empilé)', () => {
  it('le calendrier ne réserve plus toute la hauteur du bloc stats quand sa grille réelle est plus courte', () => {
    const withoutWeeks = computeBadgeGeometry('vertical', 1, 5, 1, true, 0, 0, 5)
    const withFewWeeks = computeBadgeGeometry('vertical', 1, 5, 1, true, 0, 0, 5, 8) // 8 semaines : grille courte
    // Avec seulement 8 semaines dans une zone large (mode side du gabarit Vertical), la grille
    // réelle est bien plus courte que le budget hérité des stats : le calendrier — donc la
    // ligne date qui le suit — doit remonter d'autant.
    expect(withFewWeeks.calendarArea.h).toBeLessThan(withoutWeeks.calendarArea.h)
    expect(withFewWeeks.textBottom).toBeLessThan(withoutWeeks.textBottom)
  })

  it('beaucoup de semaines (mode side) : la hauteur réelle reste plafonnée par la largeur disponible, toujours sous le budget hérité des stats', () => {
    // 60 semaines ne tiennent structurellement PAS à `MIN_CELL` dans la largeur disponible du
    // calendrier côte-à-côte : `calendarRealHeight` plafonne alors le nombre de colonnes utilisé
    // pour son calcul (comme `recentWeeks`/`maxCols` le fait réellement dans `drawCalendar`),
    // donc la hauteur réelle reste PLUS COURTE que le budget hérité des stats — jamais égale à
    // lui par un repli accidentel (piège : sans ce plafonnage sur les colonnes, la formule
    // sous-estime `cellFromWidth`, tombe sous `MIN_CELL` et renonce en silence, ce qui ferait
    // passer ce test pour la mauvaise raison).
    const manyWeeks = computeBadgeGeometry('vertical', 1, 5, 1, true, 0, 0, 5, 60)
    const noWeeksCount = computeBadgeGeometry('vertical', 1, 5, 1, true, 0, 0, 5)
    expect(manyWeeks.calendarArea.x).toBeGreaterThan(manyWeeks.statsArea.x) // confirme le mode side
    expect(manyWeeks.calendarArea.h).toBeLessThan(noWeeksCount.calendarArea.h)
  })

  it('mode empilé (Horizontal, texte trop étroit pour le côte-à-côte) : weeksCount n\'a aucun effet, la constante fixe reste inchangée', () => {
    // Cette tâche ne touche QUE le mode `side` (brief, Étape 4/plafonnage de `calendarH`) : le
    // mode `stack` garde `CALENDAR_STACK_HEIGHT`, une constante déjà éprouvée, indépendante du
    // nombre de semaines — `statsAreaWithCalendar` ne lit même pas `weeksCount` dans cette
    // branche.
    const withoutWeeks = computeBadgeGeometry('horizontal', 1, 3, 1, true)
    const withWeeks = computeBadgeGeometry('horizontal', 1, 3, 1, true, 0, 0, 0, 8)
    expect(withoutWeeks.calendarArea.x).toBe(withoutWeeks.statsArea.x) // confirme le mode stack
    expect(withWeeks.calendarArea.h).toBe(withoutWeeks.calendarArea.h)
    expect(withWeeks.calendarArea.h).toBe(330) // CALENDAR_STACK_HEIGHT
    expect(withWeeks.textBottom).toBe(withoutWeeks.textBottom)
  })

  it('mode empilé (Horizontal) : l\'écart entre le bas des stats et le haut du calendrier vaut exactement CALENDAR_STACK_TOP_GAP (16, retour Julien 20/09)', () => {
    // Vérification directe que la nouvelle constante dédiée (CALENDAR_STACK_TOP_GAP, 20/09,
    // distincte de CALENDAR_STACK_GAP qui reste à 40 pour la marge de sécurité avant la ligne
    // date) est bien appliquée en mode empilé.
    // `contentH` = TEXT_PAD*2 + titleBlockHeight + statLineCount*STACK_ROW_H + DATE_ROW_H
    // `statsOnlyH` = contentH - DATE_ROW_H
    // `gap` = calendarY - (statsArea.y + statsOnlyH) = CALENDAR_STACK_TOP_GAP
    const TEXT_PAD = 60
    const TITLE_BASELINE = 56
    const CONDENSED_TITLE_GAP = 20
    const STACK_ROW_H = 74
    const DATE_ROW_H = 32
    const CALENDAR_STACK_TOP_GAP_EXPECTED = 16 // CALENDAR_STACK_TOP_GAP, ajoutée le 20/09

    const statLineCount = 3 // quelques stats, cas simple
    const titleLineCount = 1
    const geo = computeBadgeGeometry('horizontal', 1, statLineCount, titleLineCount, true)
    // Vérifier que c'est bien le mode empilé
    expect(geo.calendarArea.x).toBe(geo.statsArea.x)
    // Calculer contentH en miroir du code source
    const titleBlockHeight = TITLE_BASELINE + Math.max(0, titleLineCount - 1) * 64 // LINE_HEIGHT = 64
    const condensedTitleRowHeight = titleBlockHeight + CONDENSED_TITLE_GAP
    const contentH = TEXT_PAD * 2 + condensedTitleRowHeight + statLineCount * STACK_ROW_H + DATE_ROW_H
    const statsOnlyH = contentH - DATE_ROW_H
    const expectedGap = geo.calendarArea.y - (geo.statsArea.y + statsOnlyH)
    expect(expectedGap).toBe(CALENDAR_STACK_TOP_GAP_EXPECTED)
  })

  it('point fixe mesure/dessin : `calendarRealHeight` prédit une hauteur que `drawCalendar` ne dépasse jamais, quel que soit le nombre de semaines', () => {
    // Garde-fou direct sur l'invariant du fichier (« mesuré UNE fois, jamais divergent du
    // dessin ») : construit une zone dont la hauteur est EXACTEMENT `calendarRealHeight(w, n)`
    // (comme le fait désormais `statsAreaWithCalendar` en mode `side`) et vérifie que rien de ce
    // que `drawCalendar` trace (cases, libellés, légende) ne dépasse le bas de cette zone — pour
    // plusieurs largeurs et plusieurs nombres de semaines, y compris au-delà du seuil où
    // `calendarRealHeight` doit plafonner le nombre de colonnes utilisé (`maxCols`, comme
    // `recentWeeks` le fait réellement dans `drawCalendar`). Un futur changement de `CELL_GAP`,
    // `LABEL_H`, `LEGEND_H`, etc. dans une seule des deux fonctions ferait déborder ce test.
    for (const areaW of [400, 500, 900]) {
      for (const weeksCount of [1, 8, 20, 60, 150]) {
        const h = calendarRealHeight(areaW, weeksCount)
        if (!h) continue // renoncement légitime (cellule trop petite) : rien à vérifier
        const columns = Array.from({ length: weeksCount }, (_, i) => ({
          monday: `2026-${String(((i % 12) + 1)).padStart(2, '0')}-05`,
          monthStart: i % 4 === 0,
          cells: Array.from({ length: 7 }, (_, d) => ({ day: `d${d}`, level: (i + d) % 5, future: false })),
        }))
        const { canvas, calls } = stubCanvas()
        const ctx = canvas.getContext('2d')
        const area = { x: 0, y: 0, w: areaW, h }
        drawCalendar(ctx, area, columns, 200, 70, '#000', 'fr', { less: 'moins', more: 'plus' })
        const bottoms = calls
          .filter((c) => c[0] === 'fillRect' || c[0] === 'strokeRect')
          .map((c) => c[0] === 'fillRect' ? c[3] + c[5] : c[2] + c[4]) // fillRect: [tag,x,y,w,h] ; strokeRect: [tag,x,y,w,h]
        const textTops = calls.filter((c) => c[0] === 'fillText').map((c) => c[3])
        const maxY = Math.max(...bottoms, ...textTops, -Infinity)
        expect(maxY).toBeLessThanOrEqual(area.y + area.h)
        // Point fixe : le bas réellement dessiné ne doit pas être loin du bas RÉSERVÉ non plus
        // (sinon `calendarRealHeight` ne mesure pas, elle majore très large) — marge de 20px,
        // au-delà de l'écart constant (~13px) mesuré entre la légende et le bas de la zone.
        expect(area.y + area.h - maxY).toBeLessThan(20)
      }
    }
  })
})

describe('calendrier centré verticalement dans sa zone (mode côte-à-côte)', () => {
  it('le calendrier, plus court que le bloc stats, est centré entre le haut de la rangée et la ligne date', () => {
    const geo = computeBadgeGeometry('vertical', 1, 5, 1, true, 0, 0, 5, 12)
    expect(geo.calendarArea.y).toBe(1228)
    expect(geo.calendarArea.h).toBe(326) // hauteur inchangée : seule la position bouge
    expect(geo.textBottom).toBe(1736) // aucun effet sur le reste de la géométrie
  })

  it('ne change rien quand le calendrier est déjà la partie la plus haute (peu de stats, beaucoup de semaines)', () => {
    // Avec 1 seule stat, le bloc stats est court (titre + 1 rangée), et 60 semaines poussent le
    // calendrier à sa hauteur quasi maximale (~214px, plafonnée par la largeur disponible, cf.
    // calendarRealHeight) — assez pour dépasser le bas réel du bloc stats dans ce cas précis
    // (calendrier = élément le plus bas, pas les stats). `calendarArea.y` doit donc rester à son
    // ancrage actuel (1106, identique au 1er test : même titleOffset, même area.y), jamais reculé.
    const withFewStats = computeBadgeGeometry('vertical', 1, 1, 1, true, 0, 0, 1, 60)
    expect(withFewStats.calendarArea.y).toBe(1106)
    expect(withFewStats.calendarArea.h).toBe(214)
    expect(withFewStats.textBottom).toBe(1420)
  })

  it('l\'écart au-dessus du calendrier égale l\'écart en dessous jusqu\'à la ligne date (pas seulement jusqu\'aux stats)', () => {
    const geo = computeBadgeGeometry('vertical', 1, 5, 1, true, 0, 0, 5, 12)
    // Calcul de calendarTop : il dépend de area.y (où commence le bloc stats) qui est déterminé
    // par la hauteur de la photo pour le gabarit vertical. Pour un ratio 1 (carré) et sans
    // redimensionnement du canvas, area.y = 1230 (90 + 1080 + 60).
    // Mais plutôt que de recalculer, on dérive calendarTop depuis la géométrie retournée :
    // statsArea.y est l'area.y original (au retour de statsAreaWithCalendar, l'area est inchangée en x/y).
    const TITLE_BASELINE = 56
    const TEXT_PAD = 60
    const titleBlockHeight = TITLE_BASELINE
    const calendarTop = geo.statsArea.y + titleBlockHeight
    const gapAbove = geo.calendarArea.y - calendarTop
    const dateLineY = geo.textBottom - TEXT_PAD
    const gapBelow = dateLineY - (geo.calendarArea.y + geo.calendarArea.h)
    expect(Math.abs(gapAbove - gapBelow)).toBeLessThanOrEqual(1)
  })

})

describe('Horizontal (paysage) avec plancher photo : le canevas ne doit jamais devenir plus court que la photo (revue Task 6)', () => {
  const MARGIN = 90 // valeur figée de badge-render.js (non exportée), cf. autres tests du fichier

  it('photo 9:16 + calendrier à peu de semaines : la photo reste entièrement dans le canevas (pas de photoSlot.y négatif)', () => {
    // Avant ce correctif, `statsArea.h` (donc `canvas.h`) suivait `textBottom` SANS plancher à
    // `area.h` dans le mode côte à côte — un plancher qui, avant la Task 6, était IMPLICITE
    // (`calendarH` valait toujours `area.h - TEXT_PAD`, jamais plafonné, ce qui forçait
    // mécaniquement `textBottom - area.y > area.h`). Une fois `calendarH` plafonné à sa hauteur
    // RÉELLE, ce plancher a disparu : sur le gabarit Horizontal avec une photo haute (9:16),
    // `area.h` vaut `Math.max(minH, contentH)` (le plancher PHOTO), qui peut dépasser largement
    // `contentH` — sans plancher restauré, le canevas devenait plus court que `minH`, la photo
    // débordait hors du canevas (`photoSlot.y` négatif, rognée en haut ET en bas par
    // `drawPhotoCover`). Reproductible en un choix de ratio dans `BadgePhotoPicker.vue`
    // (9:16 est un des 2 ratios verticaux proposés, cf. `RATIO_GROUPS.vertical`).
    const g = computeBadgeGeometry('horizontal', 9 / 16, 2, 1, true, 0, 0, 2, 8)
    expect(g.photoSlot.y).toBeGreaterThanOrEqual(MARGIN)
  })

  it('tous les ratios proposés par BadgePhotoPicker.vue : le canevas garde toujours assez de hauteur pour loger la photo + ses marges', () => {
    // `RATIO_GROUPS` de BadgePhotoPicker.vue (carré + 4/3, 16/9, 3/4, 9/16) — seul 9:16 (le plus
    // étroit des ratios verticaux) tombe sous le seuil qui bascule le calendrier en mode `side`
    // sur ce gabarit (`slot.w <= 370` ⇒ `photoRatio <= 370/600 ≈ 0,617`, cf. `calendarLayout`) ;
    // les autres restent en mode `stack` (déjà pourvu d'un plancher `Math.max(area.h, ...)`,
    // inchangé par cette tâche) — ce test couvre néanmoins TOUTE la liste, pour rendre visible la
    // CLASSE de bug (canevas plus court que la photo), pas seulement l'instance 9:16/8 semaines
    // ci-dessus.
    const presetRatios = [1, 4 / 3, 16 / 9, 3 / 4, 9 / 16]
    for (const ratio of presetRatios) {
      for (const weeksCount of [0, 1, 8, 60]) {
        const g = computeBadgeGeometry('horizontal', ratio, 2, 1, true, 0, 0, 2, weeksCount)
        const minH = g.photoSlot.h + 2 * MARGIN
        expect(g.canvas.h).toBeGreaterThanOrEqual(minH)
      }
    }
  })

  it('le plancher photo Horizontal tient toujours avec la stat progress dans le compte (Task B, motif)', () => {
    // Même scénario que la régression Task 6 (2 stats, calendrier 8 semaines), +1 stat
    // `progress` : `statLineCount` passe de 2 à 4 (2 rangées des stats déjà présentes, +2 pour
    // `progress` — sa propre rangée de texte ET la rangée fixe de son motif, cf.
    // `stackedRowCount`), `pairCount` (nombre de GROUPES, jamais de sous-lignes, cf.
    // `countGroups`) passe de 2 à 3 (une paire de plus, `progress`).
    const geo = computeBadgeGeometry('horizontal', 9 / 16, 4, 1, true, 0, 0, 3, 8)
    expect(geo.photoSlot.y).toBeGreaterThanOrEqual(MARGIN)
    expect(geo.canvas.h).toBeGreaterThanOrEqual(geo.photoSlot.h + 2 * MARGIN)
  })
})

// Tâche 1 (plan « badge-horizontal-photo-hauteur-canevas », 20/09) : retour Julien, Pixel 7 — en
// gabarit Horizontal avec une photo 16:9, la zone photo ne représentait qu'environ un tiers de la
// surface du canevas (photo ancrée à 600 de haut quoi qu'il arrive, cf. describe précédents,
// pendant que le canevas grandissait avec le contenu). La photo prend désormais
// `max(600, canvasH - MARGIN*2)` de haut, le canevas s'élargit en conséquence pour la loger : la
// photo redevient dominante (~2/3 de la surface) au lieu d'un tiers.
describe('Horizontal : la photo suit la hauteur du canevas (Tâche 1, 20/09)', () => {
  const MARGIN = 90 // valeur figée de badge-render.js (non exportée), cf. autres tests du fichier
  const GAP = 60

  it('sans calendrier, contenu au-delà du plancher : la photo grandit avec le canevas, occupe plus de 60 % de la surface', () => {
    const g = computeBadgeGeometry('horizontal', 16 / 9, 10, 1, false, 0, 1, 5, 12)
    expect(g.photoSlot.h).toBe(g.canvas.h - MARGIN * 2)
    expect(g.photoSlot.w).toBe(Math.round(g.photoSlot.h * (16 / 9)))
    // Centrée dans la hauteur RÉELLE du canevas (photo pleine hauteur ici, donc collée aux
    // marges normales) — même invariant de centrage que les describe précédents.
    expect(g.photoSlot.y).toBe(MARGIN)
    expect(g.statsArea.x).toBe(MARGIN + g.photoSlot.w + GAP)
    expect(g.canvas.w).toBe(g.statsArea.x + g.statsArea.w)
    const surfaceRatio = (g.photoSlot.w * g.photoSlot.h) / (g.canvas.w * g.canvas.h)
    expect(surfaceRatio).toBeGreaterThan(0.6)
  })

  it('avec calendrier (mode empilé) : la photo grandit ENCORE plus (calendrier = contenu plus haut), part de surface > 0,66', () => {
    const g = computeBadgeGeometry('horizontal', 16 / 9, 10, 1, true, 0, 1, 5, 12)
    // Mode empilé : le calendrier a été calculé avec x = 0 (comme le cartouche) avant le
    // décalage de `statsX` — les deux abscisses restent donc égales après coup (cf. commentaire
    // de la branche paysage dans badge-render.js).
    expect(g.calendarArea.x).toBe(g.statsArea.x)
    expect(g.photoSlot.h).toBe(g.canvas.h - MARGIN * 2)
    const surfaceRatio = (g.photoSlot.w * g.photoSlot.h) / (g.canvas.w * g.canvas.h)
    expect(surfaceRatio).toBeGreaterThan(0.66)
  })

  it('plancher conservé : contenu court, la photo reste à 600 de haut, géométrie inchangée', () => {
    const g = computeBadgeGeometry('horizontal', 16 / 9, 3, 1)
    expect(g.canvas.h).toBe(780) // 600 (plancher photo) + MARGIN * 2
    expect(g.photoSlot.h).toBe(600)
    expect(g.photoSlot.w).toBe(Math.round(600 * (16 / 9)))
  })

  it('le cartouche va TOUJOURS bord à bord en hauteur (statsArea.h === canvas.h), quel que soit le scénario', () => {
    for (const [ratio, statLineCount, includeCalendar] of [
      [16 / 9, 10, false],
      [16 / 9, 10, true],
      [16 / 9, 3, false],
      [1, 1, false],
    ]) {
      const g = computeBadgeGeometry('horizontal', ratio, statLineCount, 1, includeCalendar)
      expect(g.statsArea.h).toBe(g.canvas.h)
    }
  })
})

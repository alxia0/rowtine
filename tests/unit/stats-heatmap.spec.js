// @vitest-environment jsdom
// Unitaire — le composant grille. Les tests portent sur ce que la grille REND, pas sur un
// instantané : une case doit changer de NIVEAU quand la donnée change (test par mutation).
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'
import StatsHeatmap from '@/components/StatsHeatmap.vue'
import { buildWindow, buildGrid, sessionsByDay, sessionsByDayAndProject, monthGroups, HEAT_COLORS } from '@/utils/stats-grid'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

const REF = new Date(2026, 6, 15, 10, 0, 0)

// Libellés attendus, rendus par les clés que le composant appelle (pas de texte en dur).
const nSessions = (n) => tk('stats.heatmap.sessions', { n }, n)
const ligne = (name, duration) => tk('stats.heatmap.projectLine', { name, duration })

function sess(ymd, durationSec, projectId = 1) {
  const [y, m, d] = ymd.split('-').map(Number)
  return { projectId, sectionId: null, date: new Date(y, m - 1, d, 12).toISOString(), durationSec, rowsDone: 0 }
}

// ÉVO C — reproduit ICI, pour un composant testé ISOLÉMENT, la résolution que StatsView.vue
// applique en vrai (voir son commentaire `dayProjects` : identifiants -> texte affichable).
// `projects` ne porte que ce dont la résolution a besoin ; un projectId absent de la liste
// devient une ligne ORPHELINE, exactement comme une séance dont le projet a été supprimé.
function dayProjectsFrom(sessions, projects = []) {
  const raw = sessionsByDayAndProject(sessions)
  const out = {}
  for (const [day, byProject] of raw) {
    out[day] = [...byProject.entries()].map(([projectId, { seconds, count }]) => {
      const project = projects.find((p) => p.id === projectId)
      return { projectId, name: project?.name || '', orphan: !project, seconds, count }
    })
  }
  return out
}

function monter(sessions, period = 'quarter', extraProps = {}) {
  const firstDay = extraProps.firstDay ?? 1
  const win = buildWindow(REF, period, firstDay)
  const grid = buildGrid(win, sessionsByDay(sessions))
  return mount(StatsHeatmap, { global: { plugins: [i18n] }, props: { grid, locale: 'fr', ...extraProps } })
}

// Locale ÉPINGLÉE : sans cela, l'instance suit detectDeviceLocale() et les phrases rendues par
// t() (aria-label, légende, info-bulle) dépendraient de la machine qui lance la suite — comme
// tests/unit/StatsView.spec.js le fait déjà pour l'écran parent.
beforeEach(() => {
  i18n.global.locale.value = 'fr'
})

describe('StatsHeatmap', () => {
  it('rend 7 lignes et une colonne par semaine de la fenêtre', () => {
    const w = monter([])
    expect(w.findAll('.hm__col')).toHaveLength(13)
    expect(w.findAll('.hm__col')[0].findAll('.hm__cell')).toHaveLength(7)
  })

  it('MUTATION : la même case change de niveau quand la donnée change', () => {
    const vide = monter([])
    const cel = (w) => w.find('[data-day="2026-07-13"]')
    expect(cel(vide).attributes('data-level')).toBe('0')
    expect(cel(monter([sess('2026-07-13', 600)])).attributes('data-level')).toBe('1')
    expect(cel(monter([sess('2026-07-13', 2400)])).attributes('data-level')).toBe('2')
    expect(cel(monter([sess('2026-07-13', 5400)])).attributes('data-level')).toBe('3')
    expect(cel(monter([sess('2026-07-13', 9000)])).attributes('data-level')).toBe('4')
  })

  it('les jours À VENIR sont rendus absents — ni fond, ni liseré, ni niveau', () => {
    const w = monter([])
    const demain = w.find('[data-day="2026-07-16"]')
    expect(demain.classes()).toContain('hm__cell--future')
    expect(demain.attributes('data-level')).toBeUndefined()
    // Et surtout : un jour à venir n'est PAS un jour sans tricot.
    expect(demain.classes()).not.toContain('hm__cell--l0')
  })

  it('chaque case porte sa phrase en attribut d’accessibilité — jamais la seule couleur', () => {
    const w = monter([sess('2026-07-13', 8100)]) // 2 h 15
    const c = w.find('[data-day="2026-07-13"]')
    expect(c.attributes('aria-label')).toContain('2:15:00')
    expect(c.attributes('aria-label')).toContain(nSessions(1))
  })

  it('deux séances le même jour : la case porte la forme PLURIELLE (« 2 séances »), pas « 1 séance » répété', () => {
    // sessionsByDay additionne les comptes par jour (stats-grid.js) : cell.count = 2. Le point
    // d'appel réel (StatsHeatmap.vue:57) passe le compte en 3ᵉ argument — c'est ce chemin (n≥2,
    // atteignable en passant par le composant) que la revue avait laissé sans test.
    const w = monter([sess('2026-07-13', 600), sess('2026-07-13', 900)])
    const c = w.find('[data-day="2026-07-13"]')
    expect(c.attributes('aria-label')).toContain(nSessions(2))
    expect(c.attributes('aria-label')).not.toContain(nSessions(1))
  })

  it("n=0 pour stats.heatmap.sessions, dans les quatre langues (pas atteignable via le composant : la case vide passe par cellEmpty, jamais par 'sessions')", () => {
    const attendu = { fr: 'pas de session', en: 'no sessions', es: 'sin sesiones', de: 'keine Sitzung' }
    for (const [loc, texte] of Object.entries(attendu)) {
      i18n.global.locale.value = loc
      expect(i18n.global.t('stats.heatmap.sessions', { n: 0 }, 0)).toBe(texte)
    }
  })

  it('un jour vide porte une phrase qui le dit, pas un silence', () => {
    const w = monter([])
    expect(w.find('[data-day="2026-07-13"]').attributes('aria-label')).toContain('rien de tricoté')
  })

  // Revue finale (11/08) — une séance à RANGS SEULS (saveManualSession, ProjectDetailView.vue)
  // porte durationSec: 0 : le niveau reste 0 (« rien » EN TEMPS, §5, correct), mais dire
  // « rien de tricoté » tout court serait FAUX — une séance existe réellement. La case doit dire
  // les deux faits à la fois, sans jamais confondre ce jour avec un jour VRAIMENT vide.
  it('une séance à RANGS SEULS (durée 0) : la case dit la vérité — niveau 0, mais PAS « rien de tricoté » tout court', () => {
    const w = monter([sess('2026-07-13', 0)])
    const c = w.find('[data-day="2026-07-13"]')
    expect(c.attributes('data-level')).toBe('0') // niveau correct : rien EN TEMPS
    expect(c.attributes('aria-label')).toContain(nSessions(1)) // mais PAS silencieux sur la séance
    expect(c.attributes('aria-label')).not.toBe('dimanche 13 juillet 2026 — rien de tricoté')
  })

  it('un jour VRAIMENT vide (aucune séance) garde sa phrase inchangée — pas confondu avec un jour à rangs seuls', () => {
    const w = monter([])
    const c = w.find('[data-day="2026-07-13"]')
    expect(c.attributes('aria-label')).toContain('rien de tricoté')
    expect(c.attributes('aria-label')).not.toMatch(/session/)
  })

  it('appuyer sur une case affiche sa phrase à l’écran', async () => {
    const w = monter([sess('2026-07-13', 8100)])
    await w.find('[data-day="2026-07-13"]').trigger('click')
    expect(w.find('.hm__tip').text()).toContain('2:15:00')
  })

  it('la légende porte CINQ cases colorées et deux mots, aucun caractère graphique', () => {
    const w = monter([])
    const cases = w.findAll('.hm__legend .hm__swatch')
    expect(cases).toHaveLength(5)
    expect(cases[4].attributes('aria-label')).toBe(tk('stats.heatmap.level4'))
    expect(w.find('.hm__legend').text()).toContain(tk('stats.heatmap.less'))
    expect(w.find('.hm__legend').text()).toContain(tk('stats.heatmap.more'))
  })

  it('les huit couleurs de l’échelle sont EXACTEMENT celles de la spec', () => {
    // Constantes de la grille, pas jetons de thème : tout ajustement doit repasser par le
    // validateur ordinal (teinte unique, luminosité monotone, écart ≥ 0,06, palier 1 détaché).
    expect(HEAT_COLORS.light).toEqual([null, '#d8a179', '#c07a52', '#ac5e38', '#963f1e'])
    expect(HEAT_COLORS.dark).toEqual([null, '#624b26', '#8e6d30', '#bb8f3d', '#e8ad4c'])
  })

  it('sans prop heatColors, retombe sur HEAT_COLORS (teinte par défaut, rendu inchangé)', () => {
    const w = monter([])
    const style = w.find('.hm').attributes('style')
    expect(style).toContain('--heat-l1: #d8a179')
    expect(style).toContain('--heat-d4: #e8ad4c')
  })

  it('retour terrain 26/08 : la prop heatColors pilote les variables CSS du calendrier (teinte d’accent choisie)', () => {
    const heatColors = { light: [null, '#111111', '#222222', '#333333', '#444444'], dark: [null, '#555555', '#666666', '#777777', '#888888'] }
    const w = monter([], 'quarter', { heatColors })
    const style = w.find('.hm').attributes('style')
    expect(style).toContain('--heat-l1: #111111')
    expect(style).toContain('--heat-d4: #888888')
  })

  it('au-delà de 13 semaines, la bande défile ; en deçà, non', () => {
    expect(monter([], 'quarter').find('.hm__scroll').classes()).not.toContain('hm__scroll--scrolls')
    expect(monter([], 'semester').find('.hm__scroll').classes()).toContain('hm__scroll--scrolls')
    expect(monter([], 'year').find('.hm__scroll').classes()).toContain('hm__scroll--scrolls')
  })

  it('une étiquette de mois est posée sur la PREMIÈRE colonne de chaque mois', () => {
    const w = monter([], 'quarter') // 20/04 → 13/07 : avril, mai, juin, juillet
    expect(w.findAll('.hm__month').filter((e) => e.text().trim()).length).toBe(4)
  })

  it('MUTATION : la bande se réancre à droite quand la FENÊTRE change, pas seulement au montage', async () => {
    // StatsView ne pose aucun `:key` sur <StatsHeatmap> : passer de Trimestre à Semestre ne
    // démonte pas le composant, `onMounted` ne se rejoue donc PAS. Sans un watcher sur `grid`,
    // la bande resterait au bord GAUCHE où le 1er montage (Trimestre, non scrollable) l'avait
    // laissée — la semaine en cours resterait hors champ après le changement de fenêtre.
    const w = monter([], 'quarter') // Trimestre : 13 colonnes, PAS scrollable
    const scroller = w.find('.hm__scroll').element
    // On laisse d'abord le réancrage du 1er montage (onMounted → nextTick) aboutir : sinon sa
    // continuation, encore EN SUSPENS, ne fait qu'attendre son propre `nextTick` et lirait
    // `scrollWidth` APRÈS le `defineProperty` ci-dessous — le test « réussirait » alors même
    // sans watcher, en confondant la queue du montage avec celle d'un changement de fenêtre
    // (défaut réellement rencontré en écrivant ce test : sans ce `flushPromises`, il passait
    // encore après avoir retiré le `watch`).
    await flushPromises()
    // jsdom ne calcule aucune disposition réelle (scrollWidth vaut toujours 0 par défaut) : on
    // simule une bande plus large que la fenêtre visible, comme un Semestre le serait pour de
    // vrai (26 colonnes de 20 px + 2 px d'écart, largement au-delà d'un écran de téléphone) —
    // APRÈS que le montage a fini de lire l'ancienne valeur.
    Object.defineProperty(scroller, 'scrollWidth', { value: 2000, configurable: true })
    scroller.scrollLeft = 0

    // Semestre : un NOUVEL objet grid (buildGrid en construit un neuf à chaque appel), sur le
    // MÊME composant monté — exactement ce que fait StatsView quand on change de fenêtre.
    const win2 = buildWindow(REF, 'semester')
    await w.setProps({ grid: buildGrid(win2, sessionsByDay([])) })
    await flushPromises() // le réancrage attend un nextTick À L'INTÉRIEUR du composant

    expect(scroller.scrollLeft).toBe(2000)
  })
})

// ÉVO E (11/08) — la gouttière (initiales des jours) suit le premier jour choisi, dans les
// 4 langues. Sans elle, une grille commençant un dimanche (buildWindow/buildGrid, StatsView)
// afficherait toujours « L M M J V S D » en tête, en CONTRADICTION avec ses propres lignes —
// exactement la classe de défaut (deux axes de temps opposés) que la séparation en onglets a
// déjà réglée une fois sur cet écran.
describe('StatsHeatmap — la gouttière suit le premier jour choisi (ÉVO E)', () => {
  it('non-régression : sans firstDay explicite (ou firstDay=1), la gouttière reste "L M M J V S D"', () => {
    const w = monter([])
    expect(w.findAll('.hm__day').map((d) => d.text())).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D'])
  })

  it('firstDay=0 (dimanche) : la gouttière devient "D L M M J V S" — dimanche en tête', () => {
    const w = monter([], 'quarter', { firstDay: 0 })
    expect(w.findAll('.hm__day').map((d) => d.text())).toEqual(['D', 'L', 'M', 'M', 'J', 'V', 'S'])
  })

  it('firstDay=0, dans les QUATRE langues — la rotation suit Intl, aucune traduction manuelle à maintenir', () => {
    const attendu = {
      fr: ['D', 'L', 'M', 'M', 'J', 'V', 'S'],
      en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
      es: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
      de: ['S', 'M', 'D', 'M', 'D', 'F', 'S'],
    }
    for (const [loc, texte] of Object.entries(attendu)) {
      const w = monter([], 'quarter', { firstDay: 0, locale: loc })
      expect(w.findAll('.hm__day').map((d) => d.text())).toEqual(texte)
    }
  })
})

// ÉVO A (11/08) — encadrer les colonnes d'un même mois par un rectangle.
describe('StatsHeatmap — rectangles par mois (ÉVO A)', () => {
  it('un rectangle par mois touché par la fenêtre, NI PLUS NI MOINS', () => {
    const w = monter([], 'quarter') // 20/04 → 13/07 : 4 mois touchés (avril, mai, juin, juillet)
    expect(w.findAll('.hm__month-frame')).toHaveLength(4)
  })

  it('la largeur/position d’un rectangle suit le nombre RÉEL de colonnes du mois — pas un mois complet', () => {
    const w = monter([], 'quarter')
    const grid = buildGrid(buildWindow(REF, 'quarter'), sessionsByDay([]))
    const groupes = monthGroups(grid)
    const frames = w.findAll('.hm__month-frame')
    expect(frames).toHaveLength(groupes.length)
    // Avril (bord GAUCHE de la fenêtre, PARTIEL) : 2 colonnes seulement, à gauche = 0.
    expect(groupes[0]).toMatchObject({ startIndex: 0, count: 2 })
    expect(frames[0].element.style.left).toBe('0px')
    expect(frames[0].element.style.width).toBe((2 * 20 + 1 * 2) + 'px') // 2 cases + 1 écart = 42 px
    // Juin (entièrement DANS la fenêtre, complet) : 5 colonnes, nettement plus large qu'avril —
    // c'est ce qui évite de faire croire qu'un mois partiel a été observé en entier.
    expect(groupes[2]).toMatchObject({ startIndex: 6, count: 5 })
    expect(frames[2].element.style.width).toBe((5 * 20 + 4 * 2) + 'px') // 108 px, > 42 px
  })

  it('MUTATION : changer de fenêtre change le NOMBRE de rectangles, pas seulement leur position', async () => {
    const w = monter([], 'quarter') // 4 mois touchés
    expect(w.findAll('.hm__month-frame')).toHaveLength(4)
    const win2 = buildWindow(REF, 'month') // 15/06 → 15/07 : seulement juin + juillet
    await w.setProps({ grid: buildGrid(win2, sessionsByDay([])) })
    expect(w.findAll('.hm__month-frame')).toHaveLength(2)
  })

  it('les rectangles sont des éléments À PART, jamais posés sur les cases elles-mêmes', () => {
    // jsdom ne calcule aucune disposition réelle (pas de vraie mesure de pixels possible ici,
    // cf. taille mesurée SUR APPAREIL dans le rapport) : la preuve testable au niveau du
    // composant est structurelle — les rectangles sont des `<div>` À PART dans `.hm__cols`,
    // jamais une classe/un style ajouté À `.hm__cell` (qui aurait pu en changer la boîte). Le
    // nombre de cases réelles reste 13 colonnes × 7 = 91, quel que soit le nombre de rectangles.
    const w = monter([])
    expect(w.findAll('.hm__cell')).toHaveLength(13 * 7)
    w.findAll('.hm__cell').forEach((c) => expect(c.classes()).not.toContain('hm__month-frame'))
    w.findAll('.hm__month-frame').forEach((f) => expect(f.classes()).not.toContain('hm__cell'))
  })
})

// ÉVO B (11/08) — mettre en évidence la case sélectionnée.
describe('StatsHeatmap — case sélectionnée (ÉVO B)', () => {
  it('appuyer sur une case la marque comme sélectionnée — classe ET aria-current, les AUTRES non', async () => {
    const w = monter([sess('2026-07-13', 3600), sess('2026-07-14', 1800)])
    const c13 = w.find('[data-day="2026-07-13"]')
    const c14 = w.find('[data-day="2026-07-14"]')
    await c13.trigger('click')
    expect(c13.classes()).toContain('hm__cell--selected')
    expect(c13.attributes('aria-current')).toBe('date')
    expect(c14.classes()).not.toContain('hm__cell--selected')
    expect(c14.attributes('aria-current')).toBeUndefined()
  })

  it('MUTATION : cliquer une AUTRE case déplace la marque — l’ancienne la perd, la nouvelle la gagne', async () => {
    const w = monter([sess('2026-07-13', 3600), sess('2026-07-14', 1800)])
    const c13 = w.find('[data-day="2026-07-13"]')
    const c14 = w.find('[data-day="2026-07-14"]')
    await c13.trigger('click')
    expect(c13.classes()).toContain('hm__cell--selected')
    await c14.trigger('click')
    expect(c13.classes()).not.toContain('hm__cell--selected')
    expect(c14.classes()).toContain('hm__cell--selected')
  })

  it('appuyer une SECONDE fois sur la MÊME case la désélectionne', async () => {
    const w = monter([sess('2026-07-13', 3600)])
    const c13 = w.find('[data-day="2026-07-13"]')
    await c13.trigger('click')
    expect(c13.classes()).toContain('hm__cell--selected')
    expect(w.find('.hm__tip').exists()).toBe(true)
    await c13.trigger('click')
    expect(c13.classes()).not.toContain('hm__cell--selected')
    expect(c13.attributes('aria-current')).toBeUndefined()
    expect(w.find('.hm__tip').exists()).toBe(false)
  })

  it('changer de FENÊTRE efface la sélection SI le jour n’y est plus — jamais de phrase orpheline sans case correspondante', async () => {
    // 2026-05-04 (lundi) est DANS la fenêtre Trimestre (20/04 → 15/07) mais HORS de la fenêtre
    // Mois (15/06 → 15/07, 5 semaines) : c'est le vrai cas visé, pas un jour proche de REF qui
    // resterait dans les deux (ce qui ne prouverait rien).
    const w = monter([sess('2026-05-04', 3600)], 'quarter')
    await w.find('[data-day="2026-05-04"]').trigger('click')
    expect(w.find('.hm__tip').exists()).toBe(true)
    const win2 = buildWindow(REF, 'month')
    await w.setProps({ grid: buildGrid(win2, sessionsByDay([])) })
    await flushPromises()
    expect(w.find('.hm__tip').exists()).toBe(false)
    expect(w.find('.hm__cell--selected').exists()).toBe(false)
  })

  it('changer seulement le FILTRE (même fenêtre) ne désélectionne PAS — la sélection SURVIT pour se rafraîchir', async () => {
    // Contre-cas du test précédent : ici le jour RESTE dans la fenêtre (même `win`), seul
    // `byDay` change (ce qu'un changement de filtre technique ferait dans StatsView) — c'est
    // exactement ce qui distingue les deux mécanismes (cf. commentaire du composant).
    const win = buildWindow(REF, 'quarter')
    const w = monter([sess('2026-07-13', 3600)], 'quarter')
    await w.find('[data-day="2026-07-13"]').trigger('click')
    expect(w.find('.hm__tip').text()).toContain('1:00:00')
    // Nouveau grid, MÊME fenêtre, données différentes (comme un filtre qui retirerait la
    // séance) : le jour existe toujours, avec un temps différent (ici 0).
    await w.setProps({ grid: buildGrid(win, sessionsByDay([])) })
    await flushPromises()
    expect(w.find('.hm__cell--selected').exists()).toBe(true)
    expect(w.find('.hm__tip').exists()).toBe(true)
    expect(w.find('.hm__tip').text()).not.toContain('1:00:00') // la phrase s'est RAFRAÎCHIE
  })
})

// ÉVO C (11/08) — la liste des projets du jour sélectionné.
describe('StatsHeatmap — liste des projets du jour (ÉVO C)', () => {
  const PROJECTS = [
    { id: 1, name: 'Twist Loop Top' },
    { id: 2, name: 'Écharpe' },
  ]

  it('sélectionner un jour à deux projets affiche DEUX lignes, chacune avec son propre temps', async () => {
    const sessions = [sess('2026-07-13', 3600, 1), sess('2026-07-13', 600, 2)]
    const w = monter(sessions, 'quarter', { dayProjects: dayProjectsFrom(sessions, PROJECTS) })
    await w.find('[data-day="2026-07-13"]').trigger('click')
    const lignes = w.findAll('.hm__day-project')
    expect(lignes).toHaveLength(2)
    expect(lignes[0].text()).toBe(ligne('Twist Loop Top', '1:00:00')) // temps décroissant : le + gros en premier
    expect(lignes[1].text()).toBe(ligne('Écharpe', '10:00'))
  })

  it('RECOUPEMENT : la somme des temps des lignes vaut le temps total affiché sous la grille', async () => {
    const sessions = [sess('2026-07-13', 3600, 1), sess('2026-07-13', 600, 2), sess('2026-07-13', 300, 1)]
    const w = monter(sessions, 'quarter', { dayProjects: dayProjectsFrom(sessions, PROJECTS) })
    await w.find('[data-day="2026-07-13"]').trigger('click')
    // Total du jour (tip) = 3600 + 600 + 300 = 4500 s = 1:15:00.
    expect(w.find('.hm__tip').text()).toContain('1:15:00')
    // Twist Loop Top cumule ses DEUX séances (3600 + 300 = 3900 = 1:05:00) ; Écharpe garde 600
    // (10:00 — fmtDuration omet l'heure quand elle est nulle, cf. mémoire du lot : format
    // M:SS ET H:MM:SS coexistent, la somme doit donc lire les DEUX formes).
    const total = w.findAll('.hm__day-project').reduce((acc, li) => {
      const parts = li.text().split('—')[1].trim().split(':').map(Number)
      const secs = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
      return acc + secs
    }, 0)
    expect(total).toBe(4500)
    expect(w.findAll('.hm__day-project').map((li) => li.text())).toContain(ligne('Twist Loop Top', '1:05:00'))
  })

  it('un projet SUPPRIMÉ (séance orpheline) affiche un libellé honnête, jamais un nom vide ou "undefined"', async () => {
    const sessions = [sess('2026-07-13', 1200, 99)] // projet 99 : absent de PROJECTS
    const w = monter(sessions, 'quarter', { dayProjects: dayProjectsFrom(sessions, PROJECTS) })
    await w.find('[data-day="2026-07-13"]').trigger('click')
    const texte = w.find('.hm__day-project').text()
    expect(texte).toBe(ligne(tk('stats.heatmap.projectDeleted'), '20:00'))
    expect(texte).not.toContain('undefined')
    expect(texte.trim()).not.toBe('—' + ' 20:00') // pas de tiret nu en guise de nom
  })

  it('une séance à RANGS SEULS (durée 0) dit la vérité — jamais « 0:00 » comme si c’était mesuré', async () => {
    const sessions = [sess('2026-07-13', 0, 1)]
    const w = monter(sessions, 'quarter', { dayProjects: dayProjectsFrom(sessions, PROJECTS) })
    await w.find('[data-day="2026-07-13"]').trigger('click')
    const texte = w.find('.hm__day-project').text()
    expect(texte).toBe(tk('stats.heatmap.projectLineNoTime', { name: 'Twist Loop Top' }))
    expect(texte).not.toContain('0:00')
  })

  it('MUTATION : le filtre technique agit EN AMONT — sans entrée pour ce jour, aucune liste ne s’affiche', async () => {
    // dayProjects VIDE pour ce jour (comme le rendrait StatsView si le filtre technique exclut
    // toutes les séances de ce jour) : la case existe et se sélectionne, mais aucun <li>.
    const sessions = [sess('2026-07-13', 3600, 1)]
    const w = monter(sessions, 'quarter', { dayProjects: {} })
    await w.find('[data-day="2026-07-13"]').trigger('click')
    expect(w.find('.hm__tip').exists()).toBe(true) // la phrase, elle, vient de `grid` — inchangée
    expect(w.findAll('.hm__day-project')).toHaveLength(0)
  })

  it('beaucoup de projets le même jour : TOUS sont rendus, aucune troncature côté JS (le défilement est du CSS)', async () => {
    const many = Array.from({ length: 8 }, (_, i) => sess('2026-07-13', 60 * (i + 1), i + 1))
    const projects = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Projet ${i + 1}` }))
    const w = monter(many, 'quarter', { dayProjects: dayProjectsFrom(many, projects) })
    await w.find('[data-day="2026-07-13"]').trigger('click')
    expect(w.findAll('.hm__day-project')).toHaveLength(8)
  })
})

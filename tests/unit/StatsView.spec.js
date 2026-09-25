// @vitest-environment jsdom
// Front (composant) — écran de statistiques de temps tricoté (grille calendaire du temps,
// 10-11/08). Le sélecteur ne choisit plus une granularité de barre mais
// une FENÊTRE D'OBSERVATION à laquelle tout l'écran se soumet (§4) : ce fichier remplace
// entièrement l'ancien modèle (semaine/mois/année choisis directement).
//
// Le temps système est FIGÉ (fake Date seule, pas les timers → flushPromises marche) au mercredi
// 15/07/2026 10:00. La fenêtre par défaut (Trimestre, 13 semaines) part donc du lundi 20/04/2026
// et se termine le 15/07/2026 (aujourd'hui inclus).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@/i18n'
import StatsView from '@/views/StatsView.vue'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { useSettingsStore } from '@/stores/settings'
import EmptyStateArt from '@/components/EmptyStateArt.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 6, 15, 10, 0, 0)) // mercredi 15/07/2026 → semaine du lundi 13/07
  // Locale ÉPINGLÉE : sans cela, l'instance suit detectDeviceLocale() et le format des dates
  // comme les libellés dépendraient de la machine qui lance la suite.
  i18n.global.locale.value = 'en'
})
afterEach(() => vi.useRealTimers())

// Sessions PASSÉES, toutes dans la fenêtre « Trimestre » par défaut (20/04 → 15/07) :
// 01/07 → semaine du 29/06 ; 22/06 → semaine du 22/06.
const PAST = [
  { projectId: 1, sectionId: 1, date: '2026-07-01T10:00:00', durationSec: 1800, rowsDone: 20 },
  { projectId: 1, sectionId: 1, date: '2026-06-22T10:00:00', durationSec: 600, rowsDone: 10 },
]
// Session d'AUJOURD'HUI (== maintenant figé) : garantit une fenêtre non vide.
function todaySession() {
  return { projectId: 1, sectionId: 1, date: new Date().toISOString(), durationSec: 3600, rowsDone: 30 }
}
function withToday() {
  return [todaySession(), ...PAST]
}

function mountStats(sessions, projects, { weekStart } = {}) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  // Configurer le mock AVANT le montage : onMounted() appelle allSessions() de façon synchrone
  // pendant mount(), donc un mock posé après serait ignoré (résout undefined).
  useSessionsStore(pinia).allSessions.mockResolvedValue(sessions)
  // `createTestingPinia` stubbe les actions par défaut : appeler `projectsStore.load()` ne
  // remplirait rien. Pour semer des projets (tuiles « projet le plus travaillé », « terminés »,
  // « en cours »), on écrit directement dans l'état.
  if (projects) useProjectsStore(pinia).projects = projects
  // ÉVO E (11/08) — premier jour de la semaine. Non fourni → le store garde son défaut (1,
  // lundi) : les ~50 tests existants de ce fichier n'ont RIEN à changer.
  if (weekStart !== undefined) {
    const settings = useSettingsStore(pinia)
    settings.weekStart = weekStart
    settings.loaded = true
  }
  return mount(StatsView, {
    global: { plugins: [pinia, i18n], stubs: { AppHeader: true } },
  })
}

async function mountAndLoad(sessions, projects, opts) {
  const w = mountStats(sessions, projects, opts)
  await flushPromises()
  return w
}

// Bascule vers l'onglet « Rythme » (tâche D, 11/08) : les barres de période et les sept barres
// par jour de semaine y ont déménagé, l'onglet « Calendrier » (grille + neuf tuiles) restant
// celui par défaut. AU CLIC, jamais au balayage — cf. StatsView.vue.
async function verRythme(w) {
  await w.findAll('.tabs .tab')[1].trigger('click')
}

describe('StatsView — la fenêtre gouverne tout l’écran', () => {
  it('quatre choix de fenêtre, Trimestre actif par défaut, ce sont de vrais boutons accessibles', async () => {
    const w = await mountAndLoad(withToday())
    // Scopé au PREMIER groupe `.toggle` (sélecteur de période) : depuis l'ajout du filtre
    // technique, un SECOND groupe `.toggle`/`.toggle__opt` est apparu juste en dessous — un sélecteur
    // non qualifié compterait 4 + 3 = 7 boutons.
    const opts = w.findAll('.toggle')[0].findAll('.toggle__opt')
    expect(opts).toHaveLength(4)
    expect(opts.find((o) => o.classes('toggle__opt--on')).text()).toBe('Quarter')
    // Garde d'accessibilité de l'ancien fichier (sélecteur à 3 boutons) : de vrais <button>,
    // pas des <div> cliquables au clavier inaccessible.
    opts.forEach((o) => expect(o.element.tagName).toBe('BUTTON'))
  })

  it('la plage exacte est écrite sous le sélecteur — le libellé arrondit, le sous-titre dit vrai', async () => {
    // REF figée au mercredi 15/07/2026 → trimestre = 13 semaines depuis le lundi 20/04.
    const w = await mountAndLoad(withToday())
    expect(w.find('.range').text()).toContain('4/20/2026')
    expect(w.find('.range').text()).toContain('7/15/2026')
  })

  it('changer de fenêtre change la plage', async () => {
    const w = await mountAndLoad(withToday())
    // Scopé au premier groupe `.toggle` (période) — cf. commentaire du test précédent.
    await w.findAll('.toggle')[0].findAll('.toggle__opt')[0].trigger('click') // Mois = 5 semaines → 15/06
    expect(w.find('.range').text()).toContain('6/15/2026')
  })

  it('le total porte SUR LA PÉRIODE, pas sur la semaine en cours', async () => {
    // PAST contient 1800 s le 01/07 et 600 s le 22/06 ; todaySession() 3600 s aujourd'hui.
    // Trimestre (depuis le 20/04) : les trois sont dedans → 6000 s = 1:40:00.
    const w = await mountAndLoad(withToday())
    expect(w.find('.current__value').text()).toBe('1:40:00')
  })

  it('SEMAINE EN COURS VIDE : le total ne vaut PAS celui de la semaine précédente', async () => {
    // Le test qui gardait le défaut d'origine, transposé au nouveau modèle. Sans séance
    // aujourd'hui, le total reste la somme de la FENÊTRE — 1800 + 600 = 2400 s.
    // fmtDuration(2400) = '40:00' (pas de zéro d'heures écrit quand h === 0 — vérifié
    // fmtDuration, src/stores/activeSession.js:131 — à distinguer de '1:40:00' plus haut, où
    // l'heure existe).
    const w = await mountAndLoad(PAST)
    expect(w.find('.current__value').text()).toBe('40:00')
  })

  it('le plafond de douze barres a sauté : une année de 53 semaines montre TOUS ses mois', async () => {
    const étalées = []
    // Jour 15 (pas 10, comme prévu à l'origine) : avec la référence figée au 15/07/2026,
    // la fenêtre Année va du 14/07/2025 au 15/07/2026 inclus. Vérifié à la main (node) : au
    // jour 10, juillet 2025 (le 10, avant la borne du 14) est exclu et août 2026 aussi (après
    // la fin) → seuls 12 mois distincts tombent dans la fenêtre, ce qui ne distingue plus le
    // nouveau modèle de l'ancien plafond de 12 et fait échouer l'assertion `toBeGreaterThan`.
    // Au jour 15, juillet 2025 (15/07, sur la borne de début) ET juillet 2026 (15/07, sur la
    // borne de fin) tombent tous les deux dedans → 13 mois distincts, au-delà de l'ancien
    // plafond.
    for (let m = 0; m < 14; m++) {
      const d = new Date(2025, 6 + m, 15, 12)
      étalées.push({ projectId: 1, sectionId: 1, date: d.toISOString(), durationSec: 600, rowsDone: 0 })
    }
    const w = await mountAndLoad(étalées)
    // Scopé au premier groupe `.toggle` (période) — cf. commentaire plus haut (second
    // groupe `.toggle` du filtre technique).
    await w.findAll('.toggle')[0].findAll('.toggle__opt')[3].trigger('click') // Année
    // Depuis la tâche D (11/08), les barres de période vivent dans l'onglet « Rythme ».
    await verRythme(w)
    // Scopé à `#stats-panel-rhythm > .bars` (les barres de PÉRIODE) : les
    // sept barres par jour de semaine réutilisent DÉLIBÉRÉMENT les mêmes classes `.bars`/`.bar`
    // (§6, « aucun CSS nouveau ») mais vivent dans `.wd`, un descendant plus profond — sans
    // ce scope, un `.bar` non scopé compterait toujours >12 (12 barres de période + 7 de
    // semaine) même si le plafond de 12 était réintroduit par erreur, ce qui désarmerait ce test.
    expect(w.findAll('#stats-panel-rhythm > .bars > .bar').length).toBeGreaterThan(12)
  })

  it('état vide : aucune session enregistrée → message et pas de barres ni total', async () => {
    const w = await mountAndLoad([])
    expect(w.findAll('.bar').length).toBe(0)
    expect(w.find('.current__value').exists()).toBe(false)
    expect(w.text()).toContain('No activity recorded yet.')
  })

  it('état vide : illustration + texte qui dit quoi faire (cocher un rang, avancer un compteur de projet, ou lancer le chrono sur un patron)', async () => {
    const w = await mountAndLoad([])
    expect(w.findComponent(EmptyStateArt).exists()).toBe(true)
    expect(w.text()).toContain('Check off a row, move a project counter forward, or start the timer while following a pattern: your progress will show up here.')
  })

  it('état NON vide (vraies sessions) : pas d’illustration ni de texte guidant', async () => {
    // withToday() : 3 vraies sessions réparties sur 3 semaines distinctes, toutes dans la
    // fenêtre par défaut (Trimestre) — preuve que cet état a réellement des données.
    const w = await mountAndLoad(withToday())
    expect(w.findComponent(EmptyStateArt).exists()).toBe(false)
    expect(w.text()).not.toContain('start the timer while following a pattern')
    // Scopé aux barres de PÉRIODE, cf. commentaire du test « plafond de douze barres » ci-dessus.
    await verRythme(w)
    expect(w.findAll('#stats-panel-rhythm > .bars > .bar').length).toBe(3)
  })

  it('état vide, en français : le texte guidant est bien traduit (pas la clé EN épinglée par défaut)', async () => {
    // Locale ré-épinglée en 'fr' pour CE test seul : preuve que le composant suit vraiment la
    // locale de l'instance, pas une valeur écrite en dur dans le composant.
    i18n.global.locale.value = 'fr'
    const w = await mountAndLoad([])
    expect(w.text()).toContain(tk('stats.emptyHint'))
  })
})

describe('StatsView — barres par jour de semaine et tuiles', () => {
  it('libellé de semaine : jour et mois au format de la langue active (07.09. en allemand)', async () => {
    i18n.global.locale.value = 'de'
    const w = await mountAndLoad(withToday())
    await verRythme(w)
    const labels = w.findAll('#stats-panel-rhythm > .bars > .bar .bar__label').map((l) => l.text())
    expect(labels).toContain(tk('stats.weekOf', { date: '29.06.' }))
  })

  it('sept barres, lundi en premier', async () => {
    const w = await mountAndLoad(withToday())
    await verRythme(w)
    const barres = w.findAll('.wd .bar')
    expect(barres).toHaveLength(7)
    expect(barres[0].find('.bar__label').text()).toMatch(/^Mon/i)
  })

  it('une SEULE phrase porte le fait d’historique sous les barres', async () => {
    const w = await mountAndLoad(withToday())
    await verRythme(w)
    expect(w.findAll('.wd__alltime')).toHaveLength(1)
  })

  // Revue du 11/08 — la phrase rendait le jour ABRÉGÉ (« …est le mer.. » avec les deux
  // points de l'abréviation ET celui de fin de phrase), alors que les §6/§12.3 écrivent le
  // mot ENTIER (« …est le dimanche. »). Cause : `weekdayNames` (abrégé) servait les DEUX besoins.
  // Ce test pin les DEUX moitiés : la phrase en entier, ET les 7 barres toujours abrégées — sinon
  // le correctif « facile » (tout passer en 'long') passerait ici en élargissant les barres, ce
  // que jsdom ne signalerait jamais autrement.
  it('la phrase d’historique nomme le jour EN TOUTES LETTRES ; les sept barres restent ABRÉGÉES', async () => {
    i18n.global.locale.value = 'fr'
    const dimanches = [
      { projectId: 1, sectionId: 1, date: '2026-06-21T10:00:00', durationSec: 7200, rowsDone: 0 }, // dimanche
      { projectId: 1, sectionId: 1, date: '2026-06-15T10:00:00', durationSec: 600, rowsDone: 0 }, // lundi
    ]
    const w = await mountAndLoad(dimanches)
    await verRythme(w)
    expect(w.find('.wd__alltime').text()).toContain('dimanche')
    expect(w.find('.wd__alltime').text()).not.toContain('dim.')
    // La 7ᵉ barre (index 6, lundi en premier) est celle du dimanche : toujours abrégée.
    expect(w.findAll('.wd .bar__label').at(6).text()).toBe('dim.')
  })

  // Revue du 11/08 — Mineur 7 : une barre à ZÉRO dessinait un moignon coloré de 2 % (le
  // plancher de visibilité, voulu pour les PETITES valeurs non nulles) tout en affichant « — »
  // à côté — deux signaux contraires sur la même barre. DEUX sites indépendants dessinent une
  // largeur de barre (`barPct` pour les barres de PÉRIODE, une expression jumelle pour les SEPT
  // BARRES PAR JOUR DE SEMAINE) : les deux sont exercés ici, pas un seul.
  it('une barre à ZÉRO ne peint RIEN — ni les barres de PÉRIODE, ni les barres par JOUR DE SEMAINE', async () => {
    // Une séance à RANGS SEULS (durée 0) le lundi 06/07 : la semaine correspondante EXISTE dans
    // les barres de période (aggregateByPeriod la matérialise, une séance y a bien eu lieu) mais
    // sa durée reste nulle — exactement le cas que `barPct` doit peindre à 0 %, pas 2 %.
    const semaineRangsSeuls = { projectId: 1, sectionId: 1, date: '2026-07-06T10:00:00', durationSec: 0, rowsDone: 20 }
    const w = await mountAndLoad([todaySession(), semaineRangsSeuls, ...PAST])
    await verRythme(w)
    // Les barres de PÉRIODE affichent `fmtDuration(row.seconds)` (pas de tiret ici, à la
    // différence des tuiles) : fmtDuration(0) rend '0:00', c'est ce texte qui repère la barre.
    const barrePeriode = w.findAll('#stats-panel-rhythm > .bars > .bar').find((b) => b.find('.bar__value').text() === '0:00')
    expect(barrePeriode).toBeTruthy()
    expect(barrePeriode.find('.bar__fill').attributes('style')).toContain('width: 0%')
    // Barre par jour de semaine à zéro : dans la fenêtre par défaut (Trimestre), plusieurs jours
    // de semaine n'ont aucune séance du tout (PAST ne couvre que lundi et mercredi).
    const barreJour = w.findAll('.wd .bar').find((b) => b.find('.bar__value').text() === '—')
    expect(barreJour).toBeTruthy()
    expect(barreJour.find('.bar__fill').attributes('style')).toContain('width: 0%')
  })

  // ÉVO E (11/08) — les libellés des sept barres suivent le premier jour choisi dans les
  // Réglages, dans les 4 langues. Sans cette rotation, la gouttière de la grille (onglet
  // Calendrier) et ces libellés (onglet Rythme) désigneraient un ordre de jours différent pour
  // la MÊME fenêtre — la classe de défaut (deux axes de temps opposés) déjà réglée une fois par
  // la séparation en onglets.
  it('non-régression : sans réglage explicite, les sept barres restent "lundi en premier"', async () => {
    const w = await mountAndLoad(withToday())
    await verRythme(w)
    expect(w.findAll('.wd .bar__label').at(0).text()).toMatch(/^Mon/i)
    expect(w.findAll('.wd .bar__label').at(6).text()).toMatch(/^Sun/i)
  })

  it('réglage DIMANCHE : les sept barres deviennent "dimanche en premier" — même écran, ordre inversé', async () => {
    const w = await mountAndLoad(withToday(), undefined, { weekStart: 0 })
    await verRythme(w)
    expect(w.findAll('.wd .bar__label').at(0).text()).toMatch(/^Sun/i)
    expect(w.findAll('.wd .bar__label').at(6).text()).toMatch(/^Sat/i)
  })

  it('réglage DIMANCHE, 4 langues — la phrase d’historique reste juste EN TOUTES LETTRES quel que soit le premier jour', async () => {
    const attendu = { fr: 'dimanche', en: 'Sunday', es: 'domingo', de: 'Sonntag' }
    const dimanches = [
      { projectId: 1, sectionId: 1, date: '2026-06-21T10:00:00', durationSec: 7200, rowsDone: 0 }, // dimanche, record
      { projectId: 1, sectionId: 1, date: '2026-06-15T10:00:00', durationSec: 600, rowsDone: 0 }, // lundi
    ]
    for (const [loc, mot] of Object.entries(attendu)) {
      i18n.global.locale.value = loc
      const w = await mountAndLoad(dimanches, undefined, { weekStart: 0 })
      await verRythme(w)
      expect(w.find('.wd__alltime').text()).toContain(mot)
    }
    i18n.global.locale.value = 'en' // remise à l'état attendu par le reste du fichier
  })

  it('neuf tuiles', async () => {
    const w = await mountAndLoad(withToday())
    expect(w.findAll('.stat')).toHaveLength(9)
  })

  it('FENÊTRE VIDE : les tuiles affichent « — », jamais « 0 h »', async () => {
    // Des séances existent (donc pas d'état vide global), mais aucune dans la fenêtre
    // Trimestre (20/04 → 15/07/2026) : 2020 est largement hors fenêtre.
    const vieilles = [{ projectId: 1, sectionId: 1, date: '2020-01-05T10:00:00', durationSec: 3600, rowsDone: 0 }]
    const w = await mountAndLoad(vieilles)
    // Une ignorance ne doit pas se présenter comme un zéro mesuré.
    expect(w.find('[data-stat="total"]').text()).toContain('—')
    // fmtDuration(0) vaut '0:00' (pas de préfixe d'heures quand h === 0, cf. mémoire du lot :
    // '0:00:00' ne serait JAMAIS produit par ce formateur — cette assertion ne mordrait sur rien).
    expect(w.find('[data-stat="total"]').text()).not.toContain('0:00')
    expect(w.find('[data-stat="topProject"]').text()).toContain('—')
    // Mais la grille reste affichée, entièrement en niveau 0.
    expect(w.findAll('.hm__cell--l0').length).toBeGreaterThan(0)
  })

  it('FENÊTRE VIDE, en français : la tuile « série en cours » affiche la forme ZÉRO (pas le pluriel « 0 jours »)', async () => {
    // Même fixture que le test précédent (serieEnCours = 0 dans la fenêtre Trimestre par défaut).
    // Cette tuile n'a AUCUNE garde par tiret : elle affiche toujours stats.tiles.days, même à 0 —
    // c'est le seul endroit où la forme ZÉRO (distincte du singulier « 1 jour » et du pluriel
    // « 2 jours ») se voit vraiment.
    i18n.global.locale.value = 'fr'
    const vieilles = [{ projectId: 1, sectionId: 1, date: '2020-01-05T10:00:00', durationSec: 3600, rowsDone: 0 }]
    const w = await mountAndLoad(vieilles)
    expect(w.find('[data-stat="streak"] .stat__v').text()).toBe('0 jour')
  })

  // Revue du 11/08 — le constat exact qui a survécu depuis : une séance à RANGS
  // SEULS (`saveManualSession`, ProjectDetailView.vue) s'enregistre avec `durationSec: 0`. AVANT
  // correctif, la série (`streak`, via `daySet` = clés de `byDay`, alimenté quelle que soit la
  // durée) comptait ce jour tandis que « jours actifs » (qui testait `seconds > 0`) l'excluait —
  // deux tuiles disant deux choses contraires sur le MÊME jour. Ce test mord sur les DEUX à la
  // fois : il aurait été rouge sur `activeDays` avant le correctif de stats-grid.js.
  it('une séance à RANGS SEULS (durée 0) : « jours actifs » et « série en cours » s’ACCORDENT, et la moyenne ne ment pas', async () => {
    const rangsSeuls = [{ projectId: 1, sectionId: 1, date: new Date().toISOString(), durationSec: 0, rowsDone: 30 }]
    const w = await mountAndLoad(rangsSeuls)
    expect(w.find('[data-stat="activeDays"] .stat__v').text()).toMatch(/^1 of \d+$/)
    expect(w.find('[data-stat="streak"] .stat__v').text()).toBe('1 day')
    // Aucune durée n'a été mesurée cette fenêtre : la moyenne ne peut PAS afficher « 0:00 »,
    // qui se lirait comme un temps mesuré plutôt que comme une ignorance (§7).
    expect(w.find('[data-stat="average"] .stat__v').text()).toBe('—')
  })

  it('AUCUNE séance du tout : l’état vide de l’écran, aucune grille', async () => {
    const w = await mountAndLoad([])
    expect(w.findComponent(EmptyStateArt).exists()).toBe(true)
    expect(w.find('.hm').exists()).toBe(false)
  })

  it('la tuile « plus longue série » montre les DEUX nombres côte à côte', async () => {
    // C'est ce qui rend visible la différence de portée entre fenêtre et historique.
    const w = await mountAndLoad(withToday())
    const texte = w.find('[data-stat="longest"]').text()
    expect(texte).toMatch(/record/i)
  })

  it('la tuile « projets terminés » déclare le reliquat sans date', async () => {
    // Deux projets 'done' : l'un daté dans la fenêtre Trimestre (20/04 → 15/07/2026), l'autre
    // sans date — le reliquat que la tuile doit déclarer plutôt que taire.
    const projects = [
      { id: 1, status: 'done', finishedAt: '2026-06-01' },
      { id: 2, status: 'done', finishedAt: '' },
    ]
    const w = await mountAndLoad(withToday(), projects)
    expect(w.find('[data-stat="finished"]').text()).toMatch(/without an end date/i)
  })
})

describe('StatsView — le filtre tricot / crochet gouverne tout l’écran', () => {
  // Deux projets de techniques DIFFÉRENTES, une séance chacun, dans la fenêtre Trimestre par
  // défaut (20/04 → 15/07/2026).
  const PROJECTS_MIXTES = [
    { id: 1, name: 'Pull', technique: 'knitting' },
    { id: 2, name: 'Écharpe', technique: 'crochet' },
  ]
  const SESSIONS_MIXTES = [
    { projectId: 1, sectionId: 1, date: '2026-07-13T10:00:00', durationSec: 3600, rowsDone: 0 },
    { projectId: 2, sectionId: 1, date: '2026-07-14T10:00:00', durationSec: 600, rowsDone: 0 },
  ]

  it('trois choix, Tout actif par défaut, un second groupe de vrais boutons accessibles', async () => {
    const w = await mountAndLoad(SESSIONS_MIXTES, PROJECTS_MIXTES)
    const opts = w.findAll('.toggle')[1].findAll('.toggle__opt')
    expect(opts).toHaveLength(3)
    expect(opts.find((o) => o.classes('toggle__opt--on')).text()).toBe('All')
    opts.forEach((o) => expect(o.element.tagName).toBe('BUTTON'))
  })

  it('le filtre gouverne le HAUT et le BAS de l’écran, pas seulement la grille', async () => {
    const w = await mountAndLoad(SESSIONS_MIXTES, PROJECTS_MIXTES)
    const totalTout = w.find('[data-stat="total"]').text()
    await w.findAll('.toggle')[1].findAll('.toggle__opt')[2].trigger('click') // Crochet
    expect(w.find('[data-stat="total"]').text()).not.toBe(totalTout) // la tuile de total suit (byDay)
    // Seule la séance du projet 2 (crochet, 600 s le 14/07) reste : le total tombe à 10:00.
    expect(w.find('[data-stat="total"]').text()).toContain('10:00')
    expect(w.findAll('.hm__cell--l0').length).toBeGreaterThan(0) // la grille suit (quasi tout à 0, byDay)
    // La tuile « projet le plus travaillé » suit aussi (topProject) : « Tout » désignait Pull
    // (3 600 s, le plus travaillé des deux), le filtre Crochet ne laisse plus qu'Écharpe.
    expect(w.find('[data-stat="topProject"]').text()).toContain('Écharpe')
    expect(w.find('[data-stat="topProject"]').text()).not.toContain('Pull')
    // Le filtre technique (un `ref()` distinct de l'onglet actif) suit le changement d'onglet :
    // les barres de l'onglet « Rythme » restent filtrées sur Crochet.
    await verRythme(w)
    // Les barres de PÉRIODE suivent (displayRows) : les deux séances tombent dans la même semaine
    // (lundi 13/07) ; sous « Tout » la barre vaudrait 1:10:00, sous « Crochet » seule la séance
    // d'Écharpe (600 s) reste. Scopé à `#stats-panel-rhythm > .bars`, cf. tests plus haut.
    expect(w.find('#stats-panel-rhythm > .bars > .bar .bar__value').text()).toBe('10:00')
    // Les barres par JOUR DE SEMAINE suivent aussi (byDay) : le lundi (index 0) portait la
    // séance de Pull (tricot) — sans elle, sa barre retombe à « — ».
    expect(w.findAll('.wd .bar')[0].find('.bar__value').text()).toBe('—')
  })

  it('hasAnyActivity reste branché sur la base BRUTE : un filtre Crochet sans AUCUNE séance de crochet ne bascule PAS dans l’état vide de l’écran', async () => {
    // Une seule séance, sur un projet TRICOT — mais un second projet de CROCHET existe (SANS
    // séance), sinon le sélecteur technique (11/08) n'existerait même pas et ce test ne
    // pourrait plus reproduire le cas : après avoir choisi « Crochet », `filtered` est VIDE, mais
    // des séances EXISTENT (juste pas de cette technique) — l'écran doit montrer une fenêtre
    // vide (grille en niveau 0, tuiles à « — »), pas son état vide global. C'est exactement
    // l'avertissement laissé précédemment (élargi depuis) : `hasAnyActivity` ne doit JAMAIS
    // lire `filtered.value`.
    const SESSION_TRICOT_SEULE = [
      { projectId: 1, sectionId: 1, date: '2026-07-13T10:00:00', durationSec: 3600, rowsDone: 0 },
    ]
    const PROJETS_TRICOT_ET_CROCHET_SANS_SEANCE = [
      { id: 1, name: 'Pull', technique: 'knitting' },
      { id: 2, name: 'Écharpe', technique: 'crochet' },
    ]
    const w = await mountAndLoad(SESSION_TRICOT_SEULE, PROJETS_TRICOT_ET_CROCHET_SANS_SEANCE)
    await w.findAll('.toggle')[1].findAll('.toggle__opt')[2].trigger('click') // Crochet
    expect(w.findComponent(EmptyStateArt).exists()).toBe(false)
    expect(w.find('.hm').exists()).toBe(true) // la grille reste affichée, en niveau 0
    expect(w.find('[data-stat="total"]').text()).toContain('—')
    expect(w.find('[data-stat="topProject"]').text()).toContain('—')
  })

  it('le filtre n’est PAS persisté : il revient à « Tout » en remontant l’écran', async () => {
    const w = await mountAndLoad(SESSIONS_MIXTES, PROJECTS_MIXTES)
    await w.findAll('.toggle')[1].findAll('.toggle__opt')[2].trigger('click') // Crochet
    expect(w.findAll('.toggle')[1].findAll('.toggle__opt').find((o) => o.classes('toggle__opt--on')).text()).toBe(tk('technique.crochet'))
    w.unmount() // quitter l'écran : le filtre vit dans un `ref()` LOCAL au composant, pas dans
    // un store ni le localStorage — le détruire doit l'effacer.
    // Un nouveau montage (= revenir sur l'écran) : le filtre repart à « Tout ».
    const w2 = await mountAndLoad(SESSIONS_MIXTES, PROJECTS_MIXTES)
    const opts = w2.findAll('.toggle')[1].findAll('.toggle__opt')
    expect(opts.find((o) => o.classes('toggle__opt--on')).text()).toBe('All')
  })

  // Suite à la revue du 11/08 : le §8 énumère explicitement les NEUF tuiles,
  // pas sept — « terminés » et « en cours » doivent donc suivre le filtre elles aussi. Un projet
  // tricot ET un projet crochet, chacun marqué terminé DANS la fenêtre par défaut (Trimestre,
  // 20/04 → 15/07/2026), plus un projet en cours de chaque technique.
  const PROJETS_TERMINES_ET_WIP = [
    { id: 1, name: 'Pull', technique: 'knitting', status: 'done', finishedAt: '2026-06-01' },
    { id: 2, name: 'Écharpe', technique: 'crochet', status: 'done', finishedAt: '2026-06-02' },
    { id: 3, name: 'Bonnet', technique: 'knitting', status: 'wip' },
    { id: 4, name: 'Chaussette', technique: 'crochet', status: 'wip' },
  ]

  it('la tuile « projets terminés » suit le filtre — DEUX au total, UN seul sous « Crochet »', async () => {
    // Séance quelconque pour ne pas tomber dans l'état vide global de l'écran (`hasAnyActivity`) ;
    // la tuile « terminés » ne dépend pas des séances, seulement de `projectsStore.projects`.
    const w = await mountAndLoad(withToday(), PROJETS_TERMINES_ET_WIP)
    expect(w.find('[data-stat="finished"] .stat__v').text()).toBe('2') // Tout : Pull + Écharpe
    await w.findAll('.toggle')[1].findAll('.toggle__opt')[2].trigger('click') // Crochet
    expect(w.find('[data-stat="finished"] .stat__v').text()).toBe('1') // Écharpe seule
  })

  it('la tuile « projets en cours » suit le filtre — DEUX au total, UN seul sous « Crochet »', async () => {
    const w = await mountAndLoad(withToday(), PROJETS_TERMINES_ET_WIP)
    expect(w.find('[data-stat="wip"] .stat__v').text()).toBe('2') // Tout : Bonnet + Chaussette
    await w.findAll('.toggle')[1].findAll('.toggle__opt')[2].trigger('click') // Crochet
    expect(w.find('[data-stat="wip"] .stat__v').text()).toBe('1') // Chaussette seule
  })

  it('le reliquat « sans date de fin » suit le filtre — il ne mélange plus deux périmètres dans la même phrase', async () => {
    // Sous « Tout », deux projets terminés SANS date (Pull tricot, Poncho crochet) : reliquat 2.
    // Sous « Crochet », seul le reliquat crochet (Poncho) doit rester compté — pas Pull, qui est
    // tricot.
    const PROJETS_RELIQUAT = [
      { id: 1, name: 'Pull', technique: 'knitting', status: 'done', finishedAt: '' },
      { id: 2, name: 'Écharpe', technique: 'crochet', status: 'done', finishedAt: '2026-06-02' },
      { id: 3, name: 'Poncho', technique: 'crochet', status: 'done', finishedAt: '' },
    ]
    const w = await mountAndLoad(withToday(), PROJETS_RELIQUAT)
    expect(w.find('[data-stat="finished"] .stat__sub').text()).toBe('2 without an end date')
    await w.findAll('.toggle')[1].findAll('.toggle__opt')[2].trigger('click') // Crochet
    // Écharpe (datée, dans la fenêtre) est comptée ; Poncho (sans date) reste le SEUL reliquat.
    expect(w.find('[data-stat="finished"] .stat__v').text()).toBe('1')
    expect(w.find('[data-stat="finished"] .stat__sub').text()).toBe('1 without an end date')
  })
})

// ÉVO D (11/08) — le sélecteur tricot/crochet ne s'affiche que si la bibliothèque ENTIÈRE
// contient les deux techniques. Comptage sur TOUTE la bibliothèque (jamais la fenêtre ni une
// liste déjà filtrée) : le sélecteur ne doit JAMAIS bouger au fil d'une période ou d'un onglet.
describe('StatsView — ÉVO D : le sélecteur technique n’existe que si la bibliothèque contient les deux techniques', () => {
  const PROJETS_MIXTES = [
    { id: 1, name: 'Pull', technique: 'knitting' },
    { id: 2, name: 'Écharpe', technique: 'crochet' },
  ]
  const SESSIONS_MIXTES = [
    { projectId: 1, sectionId: 1, date: '2026-07-13T10:00:00', durationSec: 3600, rowsDone: 0 },
    { projectId: 2, sectionId: 1, date: '2026-07-14T10:00:00', durationSec: 600, rowsDone: 0 },
  ]

  it('bibliothèque 100% tricot → le second groupe .toggle n’existe pas du tout', async () => {
    const w = await mountAndLoad([SESSIONS_MIXTES[0]], [{ id: 1, name: 'Pull', technique: 'knitting' }])
    expect(w.findAll('.toggle')).toHaveLength(1)
  })

  it('bibliothèque 100% crochet → le second groupe .toggle n’existe pas non plus', async () => {
    const w = await mountAndLoad(
      [{ ...SESSIONS_MIXTES[1], projectId: 1 }],
      [{ id: 1, name: 'Écharpe', technique: 'crochet' }],
    )
    expect(w.findAll('.toggle')).toHaveLength(1)
  })

  it('un projet SANS technique (fiche ancienne) compte comme tricot : seul + un crochet → affiché', async () => {
    const w = await mountAndLoad(SESSIONS_MIXTES, [{ id: 1, name: 'Pull' }, { id: 2, name: 'Écharpe', technique: 'crochet' }])
    expect(w.findAll('.toggle')).toHaveLength(2)
  })

  it('bibliothèque VIDE (aucun projet) → pas de second groupe', async () => {
    const w = await mountAndLoad(withToday(), [])
    expect(w.findAll('.toggle')).toHaveLength(1)
  })

  it('ne bouge PAS au changement de fenêtre ni d’onglet, sur la MÊME bibliothèque mixte', async () => {
    const w = await mountAndLoad(SESSIONS_MIXTES, PROJETS_MIXTES)
    expect(w.findAll('.toggle')).toHaveLength(2)
    for (let i = 0; i < 4; i++) {
      await w.findAll('.toggle')[0].findAll('.toggle__opt')[i].trigger('click')
      expect(w.findAll('.toggle')).toHaveLength(2)
    }
    await verRythme(w)
    expect(w.findAll('.toggle')).toHaveLength(2)
    await w.findAll('.tabs .tab')[0].trigger('click') // retour Calendrier
    expect(w.findAll('.toggle')).toHaveLength(2)
  })

  // Le cas signalé par le propriétaire : filtrer sur Crochet, puis perdre le DERNIER projet de
  // crochet de la bibliothèque (suppression, ou tout événement qui recompose la liste pendant
  // la même visite). Sans indirection, `technique.value` resterait à 'crochet' EN MÉMOIRE alors
  // que le sélecteur qui permettrait de le changer aurait disparu — un filtre actif invisible,
  // un écran qui semble vide sans raison visible. La garde anti-vacuité : on ne se contente PAS
  // de vérifier que le sélecteur est absent, on vérifie que la DONNÉE affichée est bien celle
  // de « Tout », pas celle (différente) du filtre Crochet resté actif en coulisse.
  it('filtrer sur Crochet puis perdre le dernier projet de crochet : le sélecteur disparaît ET la donnée retombe sur « Tout », jamais un filtre actif invisible', async () => {
    const pinia = createTestingPinia({ createSpy: vi.fn })
    useSessionsStore(pinia).allSessions.mockResolvedValue(SESSIONS_MIXTES)
    const projectsStore = useProjectsStore(pinia)
    projectsStore.projects = PROJETS_MIXTES
    const w = mount(StatsView, { global: { plugins: [pinia, i18n], stubs: { AppHeader: true } } })
    await flushPromises()

    const totalTout = w.find('[data-stat="total"]').text()
    await w.findAll('.toggle')[1].findAll('.toggle__opt')[2].trigger('click') // Crochet
    const totalCrochet = w.find('[data-stat="total"]').text()
    expect(totalCrochet).not.toBe(totalTout) // le filtre a bien agi avant de disparaître

    projectsStore.projects = [{ id: 1, name: 'Pull', technique: 'knitting' }] // plus aucun crochet
    await flushPromises()

    expect(w.findAll('.toggle')).toHaveLength(1) // le sélecteur a disparu
    // ET la donnée affichée est celle de « Tout » (la même qu'au premier montage), pas celle du
    // filtre Crochet fantôme ni une fenêtre vide inexpliquée.
    expect(w.find('[data-stat="total"]').text()).toBe(totalTout)
  })
})

// ÉVO C (11/08) — la liste des projets du jour sélectionné, câblée en VRAI depuis l'écran
// (store des projets + filtre technique), pas isolée comme dans tests/unit/stats-heatmap.spec.js.
describe('StatsView — la liste des projets du jour sélectionné suit le store ET le filtre (ÉVO C)', () => {
  const PROJETS_MEME_JOUR = [
    { id: 1, name: 'Pull', technique: 'knitting' },
    { id: 2, name: 'Écharpe', technique: 'crochet' },
  ]
  // Les DEUX séances tombent le MÊME jour (lundi 13/07, dans la fenêtre Trimestre par défaut).
  const SESSIONS_MEME_JOUR = [
    { projectId: 1, sectionId: 1, date: '2026-07-13T09:00:00', durationSec: 3600, rowsDone: 0 },
    { projectId: 2, sectionId: 1, date: '2026-07-13T14:00:00', durationSec: 600, rowsDone: 0 },
  ]

  it('sélectionner la case du jour affiche les DEUX projets, résolus depuis le store réel', async () => {
    const w = await mountAndLoad(SESSIONS_MEME_JOUR, PROJETS_MEME_JOUR)
    await w.find('[data-day="2026-07-13"]').trigger('click')
    const lignes = w.findAll('.hm__day-project').map((li) => li.text())
    expect(lignes).toContain(tk('stats.heatmap.projectLine', { name: 'Pull', duration: '1:00:00' }))
    expect(lignes).toContain(tk('stats.heatmap.projectLine', { name: 'Écharpe', duration: '10:00' }))
  })

  it('le filtre technique s’applique À LA LISTE — sous « Crochet », Pull disparaît de ce jour-là', async () => {
    const w = await mountAndLoad(SESSIONS_MEME_JOUR, PROJETS_MEME_JOUR)
    await w.find('[data-day="2026-07-13"]').trigger('click')
    expect(w.findAll('.hm__day-project')).toHaveLength(2)
    await w.findAll('.toggle')[1].findAll('.toggle__opt')[2].trigger('click') // Crochet
    const lignes = w.findAll('.hm__day-project').map((li) => li.text())
    expect(lignes).toEqual([tk('stats.heatmap.projectLine', { name: 'Écharpe', duration: '10:00' })]) // Pull (tricot) a disparu, pas juste masqué
  })
})

describe('StatsView — pluriels des tuiles chiffrées (correctifs finaux)', () => {
  // Appel direct à l'instance i18n, avec le 3ᵉ argument (compte) explicite — fidèle au vrai point
  // d'appel dans StatsView.vue après correctif. n=1 est le cas qui était FAUX avant correctif
  // (« 1 jours ») ; n=2 seul ne l'aurait jamais révélé.
  const ATTENDU_DAYS = {
    fr: { 1: '1 jour', 2: '2 jours' },
    en: { 1: '1 day', 2: '2 days' },
    es: { 1: '1 día', 2: '2 días' },
    de: { 1: '1 Tag', 2: '2 Tage' },
  }
  const ATTENDU_RECORD = {
    fr: { 1: 'record : 1 jour', 2: 'record : 2 jours' },
    en: { 1: 'record: 1 day', 2: 'record: 2 days' },
    es: { 1: 'récord: 1 día', 2: 'récord: 2 días' },
    de: { 1: 'Rekord: 1 Tag', 2: 'Rekord: 2 Tage' },
  }

  Object.keys(ATTENDU_DAYS).forEach((loc) => {
    it(`stats.tiles.days s'accorde en ${loc} — n=1 (défaut vu souvent) et n=2`, () => {
      i18n.global.locale.value = loc
      expect(i18n.global.t('stats.tiles.days', { n: 1 }, 1)).toBe(ATTENDU_DAYS[loc][1])
      expect(i18n.global.t('stats.tiles.days', { n: 2 }, 2)).toBe(ATTENDU_DAYS[loc][2])
    })

    it(`stats.tiles.record s'accorde en ${loc} — n=1 et n=2`, () => {
      i18n.global.locale.value = loc
      expect(i18n.global.t('stats.tiles.record', { n: 1 }, 1)).toBe(ATTENDU_RECORD[loc][1])
      expect(i18n.global.t('stats.tiles.record', { n: 2 }, 2)).toBe(ATTENDU_RECORD[loc][2])
    })
  })

  it('stats.tiles.activeDaysValue (français) — sans mot d\'unité, tient sur une ligne', () => {
    i18n.global.locale.value = 'fr'
    expect(i18n.global.t('stats.tiles.activeDaysValue', { active: 1, elapsed: 10 })).toBe('1 sur 10')
    expect(i18n.global.t('stats.tiles.activeDaysValue', { active: 2, elapsed: 10 })).toBe('2 sur 10')
  })
})

// Décision du propriétaire (11/08) : la grille (ancien → aujourd'hui) et les barres de période
// (récent → ancien) portaient deux axes de temps OPPOSÉS à quatre lignes d'écart — séparées en
// deux onglets, la contradiction disparaît sans qu'aucun tri existant soit inversé.
describe('StatsView — deux onglets, Calendrier par défaut (tâche D, 11/08)', () => {
  it('Calendrier est affiché par défaut ; Rythme ne l’est pas', async () => {
    const w = await mountAndLoad(withToday())
    expect(w.find('#stats-panel-calendar').exists()).toBe(true)
    expect(w.find('#stats-panel-rhythm').exists()).toBe(false)
    const tabs = w.findAll('.tabs .tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(tabs[1].attributes('aria-selected')).toBe('false')
    // De vrais boutons accessibles, comme les deux groupes `.toggle` (garde reprise d'un
    // test précédent) : role="tab" seul ne suffit pas à rendre un <div> navigable au clavier.
    tabs.forEach((tb) => expect(tb.element.tagName).toBe('BUTTON'))
  })

  it('cliquer sur « Rythme » affiche les barres et masque la grille et les neuf tuiles', async () => {
    const w = await mountAndLoad(withToday())
    await verRythme(w)
    expect(w.find('#stats-panel-rhythm').exists()).toBe(true)
    expect(w.find('#stats-panel-calendar').exists()).toBe(false)
    expect(w.find('.hm').exists()).toBe(false)
    expect(w.findAll('.stat').length).toBe(0)
    expect(w.findAll('.tabs .tab')[1].attributes('aria-selected')).toBe('true')
  })

  // ⛔⛔ LE PIÈGE À NE PAS ROUVRIR (lot « galeries zoomables », 09/08) : à la différence des
  // onglets de la fiche projet (ProjectDetailView.vue, onTabTouchStart), CEUX-CI ne doivent
  // JAMAIS réagir au balayage — la grille défile aussi horizontalement en Semestre/Année, un
  // geste ici servirait deux fonctions à la fois. Mutation-t-il vraiment ? Un balayage franc et
  // large (280 px, vers la gauche) sur la barre d'onglets ne doit RIEN faire : ce test serait
  // rouge si un jour quelqu'un recopiait le geste de la fiche projet ici.
  it('un balayage horizontal sur la barre d’onglets NE change RIEN — clic UNIQUEMENT', async () => {
    const w = await mountAndLoad(withToday())
    expect(w.find('#stats-panel-calendar').exists()).toBe(true)
    const tabs = w.find('.tabs')
    await tabs.trigger('touchstart', { touches: [{ clientX: 300, clientY: 100 }] })
    await tabs.trigger('touchend', { changedTouches: [{ clientX: 20, clientY: 100 }] })
    expect(w.find('#stats-panel-calendar').exists()).toBe(true)
    expect(w.find('#stats-panel-rhythm').exists()).toBe(false)
  })

  // Le composant grille se DÉMONTE/REMONTE (v-if) en quittant/revenant sur l'onglet Calendrier —
  // choix documenté dans StatsView.vue. Ce test PROUVE pourquoi, avec un stub de `scrollWidth`
  // FIDÈLE à un vrai navigateur (un élément masqué par `display:none`, ou un de ses ancêtres,
  // rend un `scrollWidth` de 0 — jsdom, lui, rend toujours 0 sans même regarder l'affichage, ce
  // qui ne distinguerait jamais les deux choix). La fenêtre change PENDANT l'onglet Rythme (donc
  // SANS que StatsHeatmap soit monté pour observer le changement via son `watch`), puis on
  // revient sur Calendrier : seul un `onMounted` FRAIS (remontage, donc AUCUN ancêtre caché) peut
  // ancrer correctement la bande à droite.
  it('MUTATION : fenêtre changée pendant l’onglet Rythme, puis retour sur Calendrier — la grille est ancrée à droite', async () => {
    const w = await mountAndLoad(withToday())
    try {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get() {
          for (let el = this; el; el = el.parentElement) {
            if (el.style?.display === 'none') return 0
          }
          return 1234
        },
      })
      await verRythme(w)
      await w.findAll('.toggle')[0].findAll('.toggle__opt')[2].trigger('click') // Semestre (scrollable)
      await w.findAll('.tabs .tab')[0].trigger('click') // retour sur Calendrier
      await flushPromises()
      expect(w.find('.hm__scroll').element.scrollLeft).toBe(1234)
    } finally {
      delete HTMLElement.prototype.scrollWidth
    }
  })
})

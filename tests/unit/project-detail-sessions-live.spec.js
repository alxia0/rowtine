// L'onglet Séances montre la séance qui VIT (lot « séances live », 30/08) : ligne cible
// étendue du temps en cours, ligne virtuelle quand l'épisode n'a encore rien commis,
// badge muet en marche / « en pause », tuiles récap qui racontent la journée en cours
// sans jamais compter la même seconde deux fois. Le chrono journalisant (Tasks 1-2) a
// déjà ses bancs ; ici on éprouve le RENDU de la fiche projet montée sur l'onglet
// Sessions — mêmes conventions que project-detail-chrono.spec.js (pinia partagée,
// horloge truquée, ancrages sur des faits observables jamais des délais en dur).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import { buildFreePattern } from '@/constants/free-pattern'
import { SESSION_NO_SECTION } from '@/constants/session'
import { useActiveSessionStore } from '@/stores/activeSession'
import ProjectDetailView from '@/views/ProjectDetailView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const T0 = 1_700_000_000_000
const atTime = (ms) => Date.now.mockReturnValue(ms)

const FREE = buildFreePattern({ name: 'Patron libre', sectionTitle: 'Mon tricot', stepText: 'Note' })

// Monte la fiche DIRECTEMENT sur l'onglet Séances, avec des lignes semées au journal.
// Pinia PARTAGÉE entre le montage et le test (même motif que project-detail-chrono.spec.js) :
// la vue et les assertions voient le même store activeSession.
async function mountSessions(projectPatch = {}, seeds = []) {
  await db.patterns.clear()
  await db.projects.clear()
  await db.sessions.clear()
  await db.settings.clear()
  const pid = await db.patterns.add(FREE)
  const prj = await db.projects.add({
    name: 'Mon ouvrage', patternId: pid, status: 'wip', readerState: {}, ...projectPatch,
  })
  for (const s of seeds) await db.sessions.add({ projectId: prj, sectionId: SESSION_NO_SECTION, rowsDone: 0, ...s })
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/project/:id', name: 'project', component: ProjectDetailView },
      { path: '/project/:id/read', name: 'project-read', component: { template: '<div/>' } },
    ],
  })
  router.push(`/project/${prj}?tab=sessions`)
  await router.isReady()
  const w = mount(ProjectDetailView, { global: { plugins: [router, i18n, pinia] } })
  await vi.waitFor(() => expect(w.find('#panel-sessions').exists()).toBe(true))
  return { w, projectId: prj }
}

// Démarre par la pastille, attend le fait observable « en marche » (aria-label Pause),
// puis fait courir `sec` secondes sur l'horloge truquée et attend le temps rendu — copie
// du protocole de project-detail-chrono.spec.js (ancrage AVANT atTime, sinon runningSince
// === Date.now et le temps reste bloqué à 0 ; le rendu dépend du setInterval RÉEL du store).
async function startAndRun(w, sec = 5) {
  await w.find('.chrono-dock .chrono-fab__body').trigger('click')
  await vi.waitFor(
    () => expect(w.find('.chrono-dock .chrono-fab__body').attributes('aria-label')).toBe(fr.session.pause),
    { timeout: 10000 },
  )
  atTime(T0 + sec * 1000)
  await vi.waitFor(
    () => expect(w.find('.chrono-dock .chrono-fab').text()).toContain(`0:0${sec}`),
    { timeout: 10000 },
  )
}

// Ligne chrono semée : dernier contact il y a une minute (T0 − 60 s) → la reprise
// L'ADOPTERA comme cible de fusion (fenêtre des 2 h, chrono-episode.js). Non manuelle,
// sinon lastChronoSession l'ignore et l'épisode splitterait en ligne virtuelle.
const seedTarget = (durationSec = 30) => ({
  date: new Date(T0 - 60_000).toISOString(),
  lastWriteAt: new Date(T0 - 60_000).toISOString(),
  durationSec,
})

// Les tuiles récap, dans l'ordre du template : [compteur, total].
const recapTiles = (w) => w.findAll('.ses-recap .rtile__v')

describe('ProjectDetailView — onglet Séances : la ligne cible étendue', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('30 s commises + 5 s en cours → la ligne cible affiche 0:35 (et pas 0:30 ni 0:40)', async () => {
    const { w } = await mountSessions({}, [seedTarget(30)])
    await startAndRun(w, 5)
    // L'adoption par play() est asynchrone (requête d'écart en file) : on ancre sur le
    // rendu ÉTENDU lui-même, pas sur un état interne du store.
    await vi.waitFor(() =>
      expect(w.find('.ses-row--live .ses-row__meta').text()).toContain('0:35'),
      { timeout: 10000 },
    )
    // La cible est dans la liste chargée : PAS de ligne virtuelle par-dessus.
    expect(w.find('.ses-row--virtual').exists()).toBe(false)
    // Récap cohérent SANS double comptage : la ligne étendue et le total disent le même
    // 0:35 (le chunk compté une fois — l'ajouter au total ET à la ligne déjà étendue
    // écrirait 0:40, le retirer de l'un des deux écrirait 0:30).
    expect(recapTiles(w)[0].text()).toBe('1')
    expect(recapTiles(w)[1].text()).toBe('0:35')
    await useActiveSessionStore().pause() // coupe le setInterval réel, sinon il fuit d'un test à l'autre
  })
})

describe('ProjectDetailView — onglet Séances : le badge d’état', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('muet en marche (le temps qui défile est le signal), « en pause » dès la pause', async () => {
    const { w } = await mountSessions({}, [seedTarget(30)])
    await startAndRun(w, 5)
    await vi.waitFor(() => expect(w.find('.ses-row--live .ses-live').exists()).toBe(true), { timeout: 10000 })
    const running = w.find('.ses-row--live .ses-live')
    // En marche : AUCUN texte superflu — seul l'aria-label porte l'état pour le lecteur
    // d'écran (même motif que la tuile étoiles : role="img" + nom accessible).
    expect(running.text()).toBe('')
    expect(running.attributes('aria-label')).toBe(fr.session.liveRunning)
    // Pause (le geste de la pastille) : le badge parle, la ligne ne bouge plus.
    await w.find('.chrono-dock .chrono-fab__body').trigger('click')
    await vi.waitFor(() =>
      expect(w.find('.ses-row--live .ses-live').text()).toBe(fr.session.livePaused),
    )
    const paused = w.find('.ses-row--live .ses-live')
    expect(paused.attributes('aria-label')).toBe(fr.session.livePaused)
    // La pause vient de commettre les 5 s : la ligne garde 0:35, en continu (l'extension
    // vivante et la durée écrite se relaient le même chiffre, jamais un saut).
    expect(w.find('.ses-row--live .ses-row__meta').text()).toContain('0:35')
    await useActiveSessionStore().pause()
  })
})

describe('ProjectDetailView — onglet Séances : la ligne virtuelle', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('EN TÊTE dès le démarrage, sans boutons d’action ; le texte « vide » se tait', async () => {
    // Ligne MANUELLE datée de demain : le tri de la liste (date desc) la mettra en tête
    // — la virtuelle doit passer devant quand même, « en tête » veut dire AVANT TOUT.
    // Manuelle de surcroît : aucune adoption possible, l'épisode reste sans cible.
    const demain = { manual: true, durationSec: 600, date: new Date(T0 + 86_400_000).toISOString() }
    const { w } = await mountSessions({}, [demain])
    await startAndRun(w, 5)
    const rows = w.findAll('.ses-row')
    expect(rows.length).toBe(2)
    expect(rows[0].classes()).toContain('ses-row--virtual')
    expect(rows[1].classes()).not.toContain('ses-row--virtual')
    // Elle vit du temps en cours (non commis) : 5 s courues → 0:05.
    expect(rows[0].find('.ses-row__meta').text()).toBe('0:05')
    // AUCUN bouton : pas d'id, rien dans la base ne la porte — édition et suppression
    // ne s'y appliquent pas (la première pause la changera en ligne vraie).
    expect(rows[0].find('.ses-row__acts').exists()).toBe(false)
    expect(rows[0].findAll('button').length).toBe(0)
    // La liste n'est pas « vide » à l'écran : le texte d'attente se tait.
    expect(w.find('.sessions-tab .muted').exists()).toBe(false)
    // Récap : la virtuelle compte comme une séance de plus, et son temps court dans le
    // total (600 + 5) — sans double comptage du chunk.
    expect(recapTiles(w)[0].text()).toBe('2')
    expect(recapTiles(w)[1].text()).toBe('10:05')
    await useActiveSessionStore().pause()
  })

  it('cible supprimée à la main pendant l’épisode → repli sur la virtuelle, sans crash', async () => {
    const { w, projectId } = await mountSessions({}, [seedTarget(30)])
    await startAndRun(w, 5)
    await vi.waitFor(() => expect(w.find('.ses-row--live').exists()).toBe(true), { timeout: 10000 })
    // Suppression de la cible par le geste ordinaire de la ligne…
    await w.find('.ses-row--live .ses-row__del').trigger('click')
    // …la liste rechargée ne la porte plus : mergeIntoId pointe dans le vide, l'écran
    // REPLIE sur la virtuelle — le temps en cours ne disparaît pas avec la ligne.
    await vi.waitFor(() => expect(w.find('.ses-row--virtual').exists()).toBe(true), { timeout: 10000 })
    expect(w.find('.ses-row--live').exists()).toBe(false)
    expect(w.find('.ses-row--virtual .ses-row__meta').text()).toBe('0:05')
    // Le repli est purement VISUEL : rien de recréé en base par le seul affichage (c'est
    // la prochaine pause qui rouvrira une ligne — commitChunk détecte la cible morte).
    expect(await db.sessions.where('projectId').equals(projectId).count()).toBe(0)
    expect(recapTiles(w)[0].text()).toBe('1') // 0 ligne + la virtuelle
    // Zéro ligne en base mais la liste n'est PAS « vide » à l'écran : le texte
    // d'attente doit se taire tant que la virtuelle occupe la liste.
    expect(w.find('.sessions-tab .muted').exists()).toBe(false)
    await useActiveSessionStore().pause()
  })
})

describe('ProjectDetailView — onglet Séances : tuiles récap sans séance vivante', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('sans chrono : compteur et total aux seules lignes écrites, aucun badge ni virtuelle', async () => {
    const { w } = await mountSessions({}, [
      seedTarget(30),
      { manual: true, durationSec: 600, date: new Date(T0 - 3_600_000).toISOString() },
    ])
    // Le panneau se rend AVANT que loadForProject n'ait rendu la liste (sous la charge de
    // la suite complète, le tour Dexie peut traîner) : on ancre sur les lignes rendues,
    // jamais sur le seul panneau — sinon ces assertions lisent une liste encore vide.
    await vi.waitFor(() => expect(w.findAll('.ses-row').length).toBe(2))
    expect(w.find('.ses-row--virtual').exists()).toBe(false)
    expect(w.find('.ses-row--live').exists()).toBe(false)
    expect(w.find('.ses-live').exists()).toBe(false)
    expect(recapTiles(w)[0].text()).toBe('2')
    expect(recapTiles(w)[1].text()).toBe('10:30')
  })

  it('rien du tout : compteur 0, total 0:00, texte « vide »', async () => {
    const { w } = await mountSessions()
    expect(recapTiles(w)[0].text()).toBe('0')
    expect(recapTiles(w)[1].text()).toBe('0:00')
    expect(w.find('.ses-row--virtual').exists()).toBe(false)
    expect(w.find('.sessions-tab .muted').text()).toBe(fr.session.empty)
  })
})

describe('ProjectDetailView — onglet Séances : chrono d’un AUTRE projet', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('rien de tout ça : cette liste reste aux temps écrits, sans badge ni virtuelle', async () => {
    await db.patterns.clear()
    await db.projects.clear()
    await db.sessions.clear()
    await db.settings.clear()
    const pid = await db.patterns.add(FREE)
    const autre = await db.projects.add({ name: 'Un autre ouvrage', patternId: pid, status: 'wip', readerState: {} })
    const mien = await db.projects.add({ name: 'Mon ouvrage', patternId: pid, status: 'wip', readerState: {} })
    await db.sessions.add({
      projectId: mien, sectionId: SESSION_NO_SECTION, rowsDone: 0, ...seedTarget(30),
    })
    // Une séance tourne sur l'AUTRE projet (état que le garde du routeur rend quasi
    // inatteignable — le banc le fabrique quand même, comme un résidu persisté au
    // démarrage de l'app) : son temps n'a rien à faire sur CETTE fiche.
    const pinia = createPinia()
    setActivePinia(pinia)
    const active = useActiveSessionStore()
    await active.openFor(autre, SESSION_NO_SECTION, 0)
    await active.play()
    atTime(T0 + 5000)

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/project/:id', name: 'project', component: ProjectDetailView },
        { path: '/project/:id/read', name: 'project-read', component: { template: '<div/>' } },
      ],
    })
    router.push(`/project/${mien}?tab=sessions`)
    await router.isReady()
    const w = mount(ProjectDetailView, { global: { plugins: [router, i18n, pinia] } })
    await vi.waitFor(() => expect(w.find('#panel-sessions').exists()).toBe(true))
    // Même ancrage que les bancs « sans chrono » : la liste de CE projet doit être rendue
    // avant de juger (le panneau s'affiche avant le tour Dexie de loadForProject).
    await vi.waitFor(() => expect(w.find('.ses-row__meta').text()).toContain('0:30'))

    expect(w.find('.ses-row--virtual').exists()).toBe(false)
    expect(w.find('.ses-row--live').exists()).toBe(false)
    expect(w.find('.ses-live').exists()).toBe(false)
    // 30 s écrits, PAS 0:35 : le chrono de l'autre n'étend rien ici.
    expect(w.find('.ses-row__meta').text()).toContain('0:30')
    expect(recapTiles(w)[0].text()).toBe('1')
    expect(recapTiles(w)[1].text()).toBe('0:30')
    await useActiveSessionStore().pause() // coupe le setInterval réel du chrono de l'autre
  })
})

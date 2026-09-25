// @vitest-environment jsdom
// Composant : la visite guidée DANS le lecteur (lot du 23/09/2026) : `?tour=1` sur le
// lecteur d'un projet ouvre trois bulles par-dessus. La visite ne fait que montrer : elle
// n'écrit RIEN, ni dans le projet (progression, `lastWorkedAt`), ni au journal des séances,
// ni dans le chrono. Le chrono, qu'une ouverture ordinaire du lecteur ouvre aussitôt, est
// différé à la fin de la visite ; à cette fin, `tour` quitte l'URL (un retour arrière ou un
// rechargement ne la relance pas) et le lecteur reste ouvert.
// vue-router mocké ; base Dexie réelle (même approche que reader-view.spec.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting } from '@/db/db'
import i18n from '@/i18n'
import { useActiveSessionStore } from '@/stores/activeSession'
import { SESSION_NO_SECTION } from '@/constants/session'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeQueueStore } from '@/stores/notice-queue'

const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import ReaderView from '@/views/ReaderView.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

// Patron réduit aux trois zones de la visite : des tailles, une section de rangs à cocher,
// une section diagramme.
const READER = {
  sizeLabels: ['S', 'M', 'L'],
  easeHint: 'Choisis bien ta taille.',
  sections: [
    { id: 'bordure', title: 'Bordure', steps: [{ t: 'Monter 96 m.' }, { t: 'Côtes 2/2.' }] },
    {
      id: 'torsades',
      title: 'Torsades',
      chart: { rows: 4, img: '/patterns/twist-chart.png' },
      steps: [{ chart: true }],
    },
  ],
}

async function seed({ query = { tour: '1' }, name = 'project-read' } = {}) {
  const patternId = await db.patterns.add({ name: 'Bonnet', type: 'knitting', reader: READER })
  const projectId = await db.projects.add({ name: 'Bonnet d’hiver', technique: 'knitting', patternId })
  const id = name === 'project-read' ? projectId : patternId
  nav.route = { name, params: { id: String(id) }, query }
  return { patternId, projectId }
}

const wrappers = []
function mountReader(pinia) {
  const w = mount(ReaderView, { global: { plugins: [pinia, i18n] }, attachTo: document.body })
  wrappers.push(w)
  return w
}
async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

const T0 = 1_700_000_000_000
let pinia
beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  i18n.global.locale.value = 'fr'
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  // jsdom n'implémente pas scrollBy (avertissement « Not implemented ») : la visite
  // l'appelle pour recadrer chaque cible.
  window.scrollBy = vi.fn()
})
afterEach(async () => {
  while (wrappers.length) wrappers.pop().unmount()
  // Coupe l'intervalle réel du chrono (motif de reader-view.spec.js).
  await useActiveSessionStore().pause()
  vi.restoreAllMocks()
})

describe('ReaderView, visite guidée (?tour=1)', () => {
  it('trois bulles sur la taille, les étapes et le diagramme, sans rien écrire, puis tour retiré de l URL', async () => {
    const { projectId } = await seed({ query: { tour: '1', section: 'bordure' } })
    // PRÉCONDITION qui rend « aucune écriture » falsifiable : un chrono TOURNE sur un autre
    // projet. Une ouverture ordinaire du lecteur le fermerait en commettant son temps au
    // journal (une ligne db.sessions) et prendrait le réglage activeSession pour ce projet.
    const autreId = await db.projects.add({ name: 'Autre', technique: 'knitting' })
    const active = useActiveSessionStore()
    vi.spyOn(Date, 'now').mockReturnValue(T0)
    await active.openFor(autreId, SESSION_NO_SECTION, 0)
    await active.play()
    Date.now.mockReturnValue(T0 + 5000)
    const avant = await db.projects.get(projectId)

    const w = mountReader(pinia)
    await settle()

    const bulle = () => w.find('[role="dialog"]')
    expect(bulle().exists()).toBe(true)
    expect(w.find('.tour__title').text()).toBe(tk('tour.size.title'))
    expect(w.findAll('.tour__dot')).toHaveLength(3)

    await w.find('[data-test="tour-next"]').trigger('click')
    await settle()
    expect(w.find('.tour__title').text()).toBe(tk('tour.steps.title'))
    await w.find('[data-test="tour-next"]').trigger('click')
    await settle()
    expect(w.find('.tour__title').text()).toBe(tk('tour.chart.title'))

    // Pendant toute la visite : rien d'écrit nulle part.
    expect(await db.sessions.count()).toBe(0)
    expect((await getSetting('activeSession')).projectId).toBe(autreId)
    expect(active.projectId).toBe(autreId)
    expect(active.running).toBe(true)
    expect(await db.projects.get(projectId)).toEqual(avant)

    await w.find('[data-test="tour-next"]').trigger('click')
    await settle()

    // Fin : la visite se ferme, le lecteur reste ouvert, `tour` quitte l'URL (les autres
    // paramètres restent) et le chrono est ouvert comme à une ouverture ordinaire.
    expect(bulle().exists()).toBe(false)
    expect(w.find('.szcard').exists()).toBe(true)
    expect(nav.router.replace).toHaveBeenCalledWith({ query: { section: 'bordure' } })
    expect(active.projectId).toBe(projectId)
    // Le projet de la visite n'a toujours ni progression ni date de travail.
    const apres = await db.projects.get(projectId)
    expect(apres.readerState).toBeUndefined()
    expect(apres.lastWorkedAt).toBeUndefined()
  })

  it('pendant la visite, le diagramme montre un rang avancé avec des rangs faits grisés, sans l écrire', async () => {
    // Retour device du 23/09/2026 : au rang 1 d'un projet neuf, la bulle 3 parlait de rangs
    // grisés que le diagramme ne montrait pas. La visite affiche donc un rang d'exemple
    // (un quart de la grille, 2 sur 4 ici) le temps qu'elle dure, sans toucher st.chartRows.
    const { projectId } = await seed()
    const avant = await db.projects.get(projectId)
    const w = mountReader(pinia)
    await settle()

    expect(w.find('.chart__val').text()).toBe('2 / 4')
    expect(w.findAll('.chart__done').length).toBeGreaterThan(0)

    await w.find('[data-test="tour-skip"]').trigger('click')
    await settle()

    // Fin de visite : le vrai rang du projet revient, rien n'a été écrit.
    expect(w.find('.chart__val').text()).toBe('1 / 4')
    expect((await db.projects.get(projectId)).readerState).toEqual(avant.readerState)
  })

  it('Passer ferme la visite tout de suite et ouvre le chrono', async () => {
    const { projectId } = await seed()
    const active = useActiveSessionStore()
    const w = mountReader(pinia)
    await settle()
    expect(active.isActive).toBe(false)

    await w.find('[data-test="tour-skip"]').trigger('click')
    await settle()

    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(nav.router.replace).toHaveBeenCalledWith({ query: {} })
    expect(active.projectId).toBe(projectId)
  })

  // Revue finale (lot du 23/09/2026, constat mineur n°5) : lancée depuis les Réglages ou le
  // Guide, la visite s'ouvre après une NAVIGATION — le bouton qui l'a déclenchée est démonté,
  // `useDialogFocusReturn` (ReaderTour.vue) n'a donc personne à qui rendre le focus, qui
  // retombe sur <body> sans repère clavier. Simulé ici en focalisant un bouton DÉTACHÉ du DOM
  // avant le montage (même effet qu'un déclencheur d'une autre page, déjà démonté) : le filet
  // de `finishTour` (ReaderView.vue) doit alors poser le focus sur le bouton retour de
  // l'en-tête, pas le laisser sur <body>.
  it('fin de visite lancée depuis ailleurs (déclencheur démonté) : le focus se pose sur le bouton retour, pas sur body', async () => {
    await seed()
    const dehors = document.createElement('button')
    dehors.focus() // jamais attaché au document : `.isConnected` vaut faux, comme un bouton démonté par la navigation
    expect(dehors.isConnected).toBe(false)

    const w = mountReader(pinia)
    await settle()
    // PRÉCONDITION : `dehors` a bien capturé le focus qu'aurait le déclencheur d'ouverture —
    // `ReaderTour` reprend ensuite la main sur le bouton « Suivant », comme à chaque étape.
    expect(document.activeElement).toBe(w.find('[data-test="tour-next"]').element)

    await w.find('[data-test="tour-skip"]').trigger('click')
    await settle()

    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(w.find('.rhdr__back').element)
  })

  it('passe par la file des messages : un message plus urgent la fait attendre', async () => {
    await seed()
    const file = useNoticeQueueStore()
    // Un rapport de synchro (rang 4) occupe l'écran à l'ouverture du lecteur.
    file.request(NOTICE.SYNC_REPORT)
    const w = mountReader(pinia)
    await settle()
    expect(file.requesters).toContain(NOTICE.READER_TOUR)
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    file.withdraw(NOTICE.SYNC_REPORT)
    await settle()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })

  it('sans ?tour=1, pas de visite et le chrono s ouvre au montage (comportement inchangé)', async () => {
    const { projectId } = await seed({ query: {} })
    const active = useActiveSessionStore()
    const w = mountReader(pinia)
    await settle()
    expect(w.find('[data-test="reader-tour"]').exists()).toBe(false)
    expect(active.projectId).toBe(projectId)
  })

  it('l aperçu bibliothèque ignore ?tour=1', async () => {
    await seed({ name: 'pattern-read' })
    const w = mountReader(pinia)
    await settle()
    expect(w.find('.rhdr__title').exists()).toBe(true)
    expect(w.find('[data-test="reader-tour"]').exists()).toBe(false)
  })
})

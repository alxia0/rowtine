// @vitest-environment jsdom
// Unitaire — PLACEMENT de l'astuce de balayage (décision produit du 19/08/2026, prise en
// cours de chantier, après revue) : « l'astuce de balayage de l'écran ne doit
// apparaître que la première fois qu'on ouvre un projet, qu'on va dans la bibliothèque de
// patrons ou qu'on va dans le stock de laine, elle n'a rien à voir avec l'étape d'import
// d'un patron ». Ce fichier portait auparavant sur la cession de l'astuce devant le bandeau
// d'avertissement d'import (prop `suppressed`) : cette prop disparaît (elle ne
// pouvait plus jamais valoir `true`, l'astuce ayant quitté le seul écran qui la lui passait)
// et, avec elle, les tests qui ne portaient QUE sur son effet. Restent, inchangés dans leur
// fond, les tests sur la FILE des messages (queue) : elle ne dépendait jamais de
// `suppressed`, seulement de `useNoticeSlot`/`useNoticeQueueStore`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'
import FirstDetailTip from '@/components/FirstDetailTip.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useNoticeQueueStore } from '@/stores/notice-queue'
import { NOTICE } from '@/constants/notice-queue'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()

// Les 4 tests de placement montent les VRAIES vues (Bibliothèque, Stock, fiche projet,
// fiche patron) : vue-router mocké, comme le fait déjà `first-detail-tip-wiring.spec.js`.
const nav = vi.hoisted(() => ({
  route: { name: '', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import LibraryView from '@/views/LibraryView.vue'
import StashView from '@/views/StashView.vue'
import PatternView from '@/views/PatternView.vue'
import ProjectDetailView from '@/views/ProjectDetailView.vue'

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.route = { name: '', params: {}, query: {} }
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

// Sans paramètre, à dessein : le composant n'a plus de props depuis que `suppressed` a
// disparu. Le `props` que cette fonction acceptait n'était plus renseigné par
// aucun de ses appels — dernière trace de la prop retirée.
async function monter() {
  const w = mount(FirstDetailTip, { global: { plugins: [i18n] } })
  await flushPromises()
  return w
}

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
}

async function seedPatternRecord(overrides = {}) {
  return db.patterns.add({ name: 'Patron test', type: 'knitting', sizes: [], ...overrides })
}
async function seedProjectRecord(overrides = {}) {
  const patternId = await seedPatternRecord()
  return db.projects.add({ name: 'Projet test', technique: 'knitting', patternId, ...overrides })
}

describe('astuce de balayage : la file des messages (comportement inchangé par ce lot)', () => {
  it('G5 bis — retenue par un message PLUS FORT, elle n est pas marquée vue non plus', async () => {
    // Cas indépendant de tout écran précis : l'astuce est parfaitement candidate, aucune
    // liste ne la retient — c'est la FILE qui la fait attendre. Elle ne doit pas se
    // brûler dans ce cas-là. C'est la troisième paire de `notice-queue-paires.spec.js`
    // (porte du dossier × astuce), documentée là-bas mais testée ici, au plus près du
    // composant qu'elle concerne.
    const s = useSettingsStore()
    await s.load()
    expect(s.swipeHintSeen).toBe(false)

    const q = useNoticeQueueStore()
    q.request(NOTICE.FOLDER_GATE)

    const w = await monter()

    // PRÉCONDITION : l'écran est RÉELLEMENT pris par un rang plus fort, et l'astuce est
    // bien demandeuse. Sans ces deux assertions, le test passerait à vide.
    expect(q.active).toBe(NOTICE.FOLDER_GATE)
    expect(q.requesters).toContain(NOTICE.SWIPE_HINT)

    expect(w.findComponent(ConfirmDialog).props('open')).toBe(false)
    expect(await getSetting('swipeHintSeen')).toBeUndefined()

    // Et elle prend la parole — puis se marque vue — dès que le plus fort se retire.
    q.withdraw(NOTICE.FOLDER_GATE)
    await flushPromises()
    expect(w.findComponent(ConfirmDialog).props('open')).toBe(true)
    expect(await getSetting('swipeHintSeen')).toBe(true)
  })

  it('G5 ter — démontée pendant qu elle attend, elle n est pas marquée vue', async () => {
    // La course trouvée à la revue du plan : une navigation qui coïncide avec
    // le retrait du message plus fort pouvait faire passer `hasSlot` à vrai PENDANT le
    // démontage. Le drapeau était alors écrit sur une astuce jamais peinte. Ce test
    // constate le RÉSULTAT (rien n'est écrit en base, la file oublie le demandeur) — il ne
    // construit pas la situation où un job de `watch` serait déjà planifié avant le
    // démontage, et ne peut donc pas, à lui seul, distinguer PAR QUEL mécanisme cela tient
    // (cf. le commentaire de FirstDetailTip.vue, corrigé sur ce point à la revue du 19/08).
    const s = useSettingsStore()
    await s.load()
    const q = useNoticeQueueStore()
    q.request(NOTICE.FOLDER_GATE)

    const w = await monter()
    // PRÉCONDITION : elle attend vraiment son tour.
    expect(q.requesters).toContain(NOTICE.SWIPE_HINT)
    expect(w.findComponent(ConfirmDialog).props('open')).toBe(false)

    w.unmount()
    q.withdraw(NOTICE.FOLDER_GATE)
    await flushPromises()

    expect(await getSetting('swipeHintSeen')).toBeUndefined()
    expect(q.requesters).not.toContain(NOTICE.SWIPE_HINT)
  })

  it('compétition nommée : un message plus fort a la parole, désigné par son nom, l astuce cède', async () => {
    // Détecteur de mutation nommé (ajouté au-delà du plan initial) : câbler
    // NOTICE.SWIPE_HINT avec un identifiant VALIDE mais FAUX (ex. IMPORT_CAVEAT à la
    // place) doit rougir CE test. On vérifie donc le VAINQUEUR PAR SON NOM, pas seulement
    // `open === false` — un faux-câblage vers un autre identifiant du registre resterait
    // sinon indétectable : deux constantes valides produisent toutes deux
    // `active !== SWIPE_HINT`.
    // Désormais, `importCaveat` EST câblé (LibraryView) : cette paire est désormais
    // réelle pour de vrai, prouvée bout en bout (mêmes composants, mêmes conditions
    // réelles) dans `tests/unit/library-import-caveat.spec.js`. Ce test-ci reste utile tel
    // quel — c'est un détecteur de mutation ciblé sur `useNoticeSlot`/`NOTICE_RANKS`
    // uniquement, sans dépendre du montage de LibraryView.
    const s = useSettingsStore()
    await s.load()
    const q = useNoticeQueueStore()
    q.request(NOTICE.IMPORT_CAVEAT)

    const w = await monter()

    // PRÉCONDITION NOMMÉE : les deux sont bien demandeurs en même temps, et c'est
    // IMPORT_CAVEAT qui a la parole — sans ces deux assertions, le test passerait à
    // vide si l'astuce n'était jamais devenue candidate.
    expect(q.requesters).toContain(NOTICE.IMPORT_CAVEAT)
    expect(q.requesters).toContain(NOTICE.SWIPE_HINT)
    expect(q.active).toBe(NOTICE.IMPORT_CAVEAT)

    expect(w.findComponent(ConfirmDialog).props('open')).toBe(false)
  })
})

describe('astuce de balayage : placement sur les listes, pas sur la fiche patron (décision produit, 19/08)', () => {
  it('écran Bibliothèque : l astuce s affiche', async () => {
    const s = useSettingsStore()
    await s.load()
    // PRÉCONDITION : l'astuce n'a jamais été vue. Sans elle, l'affichage s'expliquerait
    // par autre chose qu'un vrai montage sur cet écran.
    expect(s.swipeHintSeen).toBe(false)

    nav.route = { name: 'library', params: {}, query: {} }
    const w = mount(LibraryView, { global: { plugins: [i18n] } })
    await settle()

    expect(w.findComponent(FirstDetailTip).exists()).toBe(true)
    expect(w.findComponent(FirstDetailTip).findComponent(ConfirmDialog).props('open')).toBe(true)
  })

  it('écran Stock : l astuce s affiche, sans qu aucune fiche laine ne soit ouverte', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.swipeHintSeen).toBe(false)

    nav.route = { name: 'stash', params: {}, query: {} }
    const w = mount(StashView, { global: { plugins: [i18n] } })
    await settle()

    // La laine a désormais son propre écran routé (stash-item, cf. YarnDetailView.vue) :
    // monter StashView seul suffit à garantir qu'aucune fiche n'est ouverte, plus besoin
    // de vérifier l'état d'un tiroir qui n'existe plus.
    expect(w.findComponent(FirstDetailTip).exists()).toBe(true)
    expect(w.findComponent(FirstDetailTip).findComponent(ConfirmDialog).props('open')).toBe(true)
  })

  it('ouverture d un projet : comportement conservé, l astuce s affiche', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.swipeHintSeen).toBe(false)

    const id = await seedProjectRecord()
    nav.route = { name: 'project', params: { id: String(id) }, query: {} }
    const w = mount(ProjectDetailView, { global: { plugins: [i18n] } })
    await settle()

    expect(w.findComponent(FirstDetailTip).exists()).toBe(true)
    expect(w.findComponent(FirstDetailTip).findComponent(ConfirmDialog).props('open')).toBe(true)
  })

  it('fiche d un patron : l astuce NE s affiche PAS (cœur de la décision produit)', async () => {
    const s = useSettingsStore()
    await s.load()
    // PRÉCONDITION : le drapeau n'est PAS posé — sinon l'absence s'expliquerait par le
    // drapeau, pas par la décision produit, et ce test ne prouverait rien.
    expect(s.swipeHintSeen).toBe(false)

    const id = await seedPatternRecord()
    nav.route = { name: 'pattern', params: { id: String(id) }, query: {} }
    const w = mount(PatternView, { global: { plugins: [i18n] } })
    await settle()

    expect(w.findComponent(FirstDetailTip).exists()).toBe(false)
  })
})

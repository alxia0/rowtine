// reader-view.spec.js — dégradation ReaderView pour readers simples
// Vérifie qu'un reader sans tailles ni aide-mémoire ne génère pas d'erreur
// et que les étapes s'affichent correctement.
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { useActiveSessionStore } from '@/stores/activeSession'
import { SESSION_NO_SECTION } from '@/constants/session'

// Même approche que ReaderView.spec.js : mock vue-router pour éviter
// la complexité du vrai routeur et les leaks async.
const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import ReaderView from '@/views/ReaderView.vue'

// Reader simple : aucune taille, aucun aide-mémoire (reference absent)
const SIMPLE_READER = {
  sizeLabels: [],
  sections: [
    {
      id: 'a',
      icon: '🧶',
      title: 'Section A',
      steps: [{ t: 'Rang un' }],
    },
  ],
}

async function seedSimpleProject() {
  const patternId = await db.patterns.add({ name: 'Libre', type: 'knitting', reader: SIMPLE_READER })
  const projectId = await db.projects.add({ name: 'P', technique: 'knitting', patternId })
  nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
  return { patternId, projectId }
}

const wrappers = []
// `pinia` optionnel : par défaut un magasin neuf (comportement historique). Les tests qui doivent
// PRÉPARER un état AVANT le montage (ex. un chrono déjà actif) doivent créer leur propre pinia,
// le passer ici, ET l'utiliser pour leurs propres `useXStore()` — sinon leurs vérifications
// portent sur un magasin différent de celui que le composant utilise réellement (piège vécu en
// écrivant ce fichier : un magasin créé puis jamais repassé au montage rend les préconditions et
// assertions muettes, silencieusement, sans faire rougir le test).
function mountReader(pinia = createPinia()) {
  const w = mount(ReaderView, { global: { plugins: [pinia, i18n] } })
  wrappers.push(w)
  return w
}

// Laisse l'onMounted async se vider (même stratégie que ReaderView.spec.js — la
// synchro MD ciblée à l'ouverture, Lot N3, ajoute des allers-retours IndexedDB
// supplémentaires qu'un seul micro-tick ne suffit pas toujours à vider).
async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('ReaderView — reader simple (sans tailles ni aide-mémoire)', () => {
  it("n'affiche ni carte de taille ni aide-mémoire, mais montre les étapes", async () => {
    await seedSimpleProject()
    const w = mountReader()
    await settle()
    expect(w.find('.szcard').exists()).toBe(false)
    expect(w.find('.amblock').exists()).toBe(false)
    expect(w.text()).toContain('Rang un')
    expect(w.find('.fab--ref').exists()).toBe(false)
  })
})

// Garde-fou central de la gestion du chrono hors lecteur (17/08/2026), moitié Lecteur : le magasin
// actif ne détient qu'UN SEUL couple (projectId, sectionId), partagé avec le bloc chrono de la
// fiche projet (ProjectDetailView). Si ce couple divergeait, changer d'écran fermerait et
// encaisserait la séance de l'autre — chrono remis à zéro sous les yeux de l'utilisatrice, et
// deux lignes de séance pour un seul tricot. Ce test est mot pour mot celui décrit par le
// tableau de preuves attendu.
describe('ReaderView — chrono en contexte projet', () => {
  it('ouvre le chrono sur la sentinelle de section partagée avec la fiche projet', async () => {
    const { projectId } = await seedSimpleProject()
    mountReader()
    await settle()
    const active = useActiveSessionStore()
    expect(active.isActive).toBe(true)
    expect(active.projectId).toBe(projectId)
    expect(active.sectionId).toBe(SESSION_NO_SECTION)
  })
})

// Lot « chrono unifié » (2026-08-30) : le lecteur ne ferme PLUS la séance en sortie
// d'écran — défaut connu (« aller voir le patron ferme la séance »). La fermeture vit
// désormais dans le garde « sortie de bulle » du routeur, testé à part
// (router-chrono-bubble.spec.js — le routeur est mocké ici). Ce qui reste à CE niveau :
// le lecteur lui-même ne déclenche aucune écriture en sortant, et le geste EXPLICITE
// « masquer le chrono » (chevron de la pastille) continue de clore la séance — seul chemin hors garde.
describe('ReaderView — sortie d’écran et geste de masquage (lot « chrono unifié » + spec 08/09)', () => {
  const T0 = 1_700_000_000_000

  afterEach(async () => {
    vi.restoreAllMocks()
    // Coupe l'intervalle réel du chrono, sinon il fuit sur les tests suivants (motif du lot
    // « chrono hors lecteur », cf. project-detail-chrono.spec.js).
    await useActiveSessionStore().pause()
  })

  // Non-régression du défaut connu : le bouton Retour du lecteur (et le retour matériel,
  // même chemin de démontage) ne ferme ni n'enregistre plus la séance — elle poursuit,
  // c'est le garde du routeur qui décidera en sortant du projet. La séance est ouverte PAR
  // CET ÉCRAN (montage vierge, lancement au FAB) : c'est le cas que l'ancien code fermait
  // systématiquement en sortie — une séance pré-ouverte avant montage était déjà épargnée
  // (« adoption », 17/08), elle ne distingue donc plus rien aujourd'hui.
  it('quitter le lecteur (unmount) ne ferme plus la séance ni n’écrit au journal', async () => {
    const { projectId } = await seedSimpleProject()
    // Pinia créé et activé EXPLICITEMENT ici, puis repassé à mountReader() ci-dessous : c'est le
    // même magasin qui doit servir à préparer l'état AVANT montage et à le vérifier après —
    // `mountReader()` sans argument créerait un second pinia distinct pour le composant, rendant
    // la précondition invisible du composant et les assertions ci-dessous aveugles à son
    // comportement réel (piège vécu en écrivant ce test).
    const pinia = createPinia()
    setActivePinia(pinia)
    const active = useActiveSessionStore()
    // Précondition : AUCUNE séance ouverte — c'est le lecteur qui va ouvrir la sienne.
    expect(active.isActive).toBe(false)
    vi.spyOn(Date, 'now').mockReturnValue(T0)

    const w = mountReader(pinia)
    await settle()
    expect(active.isActive).toBe(true) // ouverte par le montage du lecteur
    expect(active.projectId).toBe(projectId)

    // Lancement par le geste réel (le CORPS de la pastille — la capsule porte aussi le
    // chevron depuis la spec 08/09, seul le corps lance/pause) puis temps écoulé.
    await w.find('.chrono-fab__body').trigger('click')
    expect(active.running).toBe(true)
    Date.now.mockReturnValue(T0 + 5000)

    w.unmount()
    // Preuve d'ABSENCE d'écriture : aucun fait observable à attendre, on draine généreusement
    // plutôt qu'un compte ajusté au plus juste (motif imposé, cf. project-detail-chrono.spec.js
    // « quitter l'écran n'enregistre pas la séance »).
    for (let i = 0; i < 20; i += 1) await flushPromises()

    expect(await db.sessions.where('projectId').equals(projectId).count()).toBe(0)
    expect(active.isActive).toBe(true)
    expect(active.projectId).toBe(projectId)
    expect(active.running).toBe(true)
  })

  // Geste explicite (chevron de la pastille → mini-menu « Masquer le chrono », spec 08/09
  // qui remplace le bouton œil), distinct d'une sortie d'écran : il doit fermer la séance
  // quoiqu'il arrive — masquer ne doit jamais laisser tourner un comptage invisible. Le
  // test prépare une séance ouverte AVANT le montage (l'ancienne « adoptée ») : le masquage
  // la ferme tout de même, seule une SORTIE d'écran l'aurait épargnée.
  it('masquer le chrono (chevron → menu) FERME la séance, même ouverte avant l’arrivée sur cet écran', async () => {
    const { projectId } = await seedSimpleProject()
    const pinia = createPinia()
    setActivePinia(pinia)
    const active = useActiveSessionStore()
    vi.spyOn(Date, 'now').mockReturnValue(T0)
    await active.openFor(projectId, SESSION_NO_SECTION, 0)
    await active.play()
    Date.now.mockReturnValue(T0 + 5000)

    const w = mountReader(pinia)
    await settle()
    expect(active.isActive).toBe(true)

    await w.find('.chrono-fab__chev').trigger('click')
    await w.find('.chrono-fab__menu-item').trigger('click')
    await vi.waitFor(async () => {
      const rows = await db.sessions.where('projectId').equals(projectId).toArray()
      expect(rows.length).toBe(1)
      expect(rows[0].durationSec).toBe(5)
    })
    expect(active.isActive).toBe(false)
  })
})

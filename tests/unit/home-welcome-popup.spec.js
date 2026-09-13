// Unitaire — la pop-up de bienvenue de l'accueil (lot 10/08/2026).
//
// Elle REMPLACE l'astuce « Le sais-tu ? », qui arrivait au pire moment : on expliquait
// comment REVENIR à quelqu'un qui n'était encore allé nulle part. L'astuce part dans
// FirstDetailTip.vue ; l'accueil ne doit plus jamais l'afficher.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db, setSetting } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'
import { useNoticeQueueStore } from '@/stores/notice-queue'
import { NOTICE } from '@/constants/notice-queue'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'

const nav = vi.hoisted(() => ({
  route: { name: 'home', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import HomeView from '@/views/HomeView.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const wrappers = []
// ⚠️ UNE SEULE Pinia pour tous les montages d'un même test — c'est ce qui fait qu'un
// second montage est bien la MÊME session. Une `createPinia()` posée dans `doMount()`
// donnerait un store neuf à chaque appel, et le test « ne revient pas dans la même
// session » passerait au vert sans rien prouver.
let pinia
function doMount() {
  const w = mount(HomeView, { global: { plugins: [pinia, i18n] }, attachTo: document.body })
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

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe("la pop-up de bienvenue de l'accueil", () => {
  it('apparaît quand le drapeau est posé, avec le texte de bienvenue', async () => {
    await setSetting('onboarded', true)
    await setSetting('welcomeDue', true)
    const w = doMount()
    await settle()
    const dlg = w.findComponent(ConfirmDialog)
    expect(dlg.exists()).toBe(true)
    expect(dlg.props('open')).toBe(true)
    expect(dlg.props('title')).toBe(fr.onboarding.welcomeTitle)
    expect(dlg.props('message')).toBe(fr.onboarding.welcomeBody)
    // Correctif « bienvenue centrée » (10/08/2026) : au milieu de l'écran, pas en feuille
    // du bas — demande explicite du porteur du projet, mesurée collée en bas sur tablette.
    expect(dlg.props('centered')).toBe(true)
  })

  it("n'apparaît PAS sur une installation déjà en service", async () => {
    // Ni `welcomeDue`, ni rien d'autre : l'état d'une base d'avant ce lot.
    await setSetting('onboarded', true)
    await setSetting('swipeHintSeen', true)
    const w = doMount()
    await settle()
    const dlg = w.findComponent(ConfirmDialog)
    expect(dlg.exists() && dlg.props('open')).toBeFalsy()
  })

  it("n'affiche JAMAIS l'astuce de navigation, même quand elle n'a pas été vue", async () => {
    // `swipeHintSeen` absent = astuce jamais vue. Avant ce lot, l'accueil l'aurait montrée.
    await setSetting('onboarded', true)
    const w = doMount()
    await settle()
    expect(w.html()).not.toContain(fr.onboarding.tipTitle)
  })

  it('efface le drapeau EN BASE quand elle est acquittée, avant de se fermer', async () => {
    await setSetting('onboarded', true)
    await setSetting('welcomeDue', true)
    const w = doMount()
    await settle()
    await w.findComponent(ConfirmDialog).vm.$emit('confirm')
    await settle()

    // Le point qui a déjà coûté cher sur `swipeHintSeen` : l'écriture doit être ATTENDUE.
    // On relit la base, pas le store — c'est la base qui décide au prochain démarrage.
    const { getSetting } = await import('@/db/db')
    expect(await getSetting('welcomeDue')).toBe(false)
    expect(w.findComponent(ConfirmDialog).props('open')).toBe(false)
  })

  // LE TEST QUI COMPTE LE PLUS de ce correctif (lot « ordre des pop-ups », 10/08/2026) :
  // `HomeView` est monté DERRIÈRE la porte du dossier (frère de `<RouterView/>` dans
  // App.vue) — au premier lancement, son `onMounted` a déjà lu `welcomeDue` à `false`
  // avant que la porte n'ait posé le drapeau, et aucune navigation n'a lieu quand la porte
  // se referme : `HomeView` n'est donc JAMAIS remonté. Sans un `watch` réactif sur
  // `settings.welcomeDue`, la bienvenue ne s'afficherait donc JAMAIS au premier lancement.
  // Mutation : retirer le `watch` de HomeView.vue fait rougir ce test (et lui seul, parmi
  // ceux de ce fichier — les autres posent `welcomeDue` AVANT le montage, ce que `onMounted`
  // suffit à couvrir).
  it("ouvre la bienvenue quand welcomeDue passe à vrai EN COURS DE SESSION, sans remonter le composant", async () => {
    await setSetting('onboarded', true) // `welcomeDue` absent : rien à voir au montage
    const w = doMount()
    await settle()
    expect(w.findComponent(ConfirmDialog).props('open')).toBeFalsy()

    // Simule exactement ce que fait la porte du dossier après une désignation réussie
    // (OnboardingFolderPrompt.vue::onChooseNow) — sur LA MÊME instance de store que celle
    // que le composant monté ci-dessus a résolue (même Pinia active), sans remonter `w`.
    const settingsStore = useSettingsStore()
    await settingsStore.setWelcomeDue()
    await settle()

    const dlg = w.findComponent(ConfirmDialog)
    expect(dlg.props('open')).toBe(true)
    expect(dlg.props('title')).toBe(fr.onboarding.welcomeTitle)
  })

  it("ne revient pas quand on repasse par l'accueil dans la même session", async () => {
    // Naviguer ailleurs puis revenir remonte HomeView sans relancer l'app : le store est
    // toujours en mémoire. Si l'acquittement n'avait mis à jour que la base et pas le
    // store, la bienvenue reviendrait à chaque retour sur l'accueil.
    await setSetting('onboarded', true)
    await setSetting('welcomeDue', true)
    const w1 = doMount()
    await settle()
    await w1.findComponent(ConfirmDialog).vm.$emit('confirm')
    await settle()

    const w2 = doMount() // même Pinia : c'est bien la MÊME session
    await settle()
    expect(w2.findComponent(ConfirmDialog).props('open')).toBe(false)
  })

  // TEST DE COMPÉTITION NOMMÉE (file des messages — exigence transmise en amont) :
  // monte réellement `HomeView`, met un message PLUS FORT en demande (la porte
  // du dossier, rang 2, contre le rang 5 de la bienvenue), et vérifie PAR SON NOM qui a la
  // parole. C'est l'incident du 10/08 rejoué à travers le composant assemblé, pas
  // seulement le magasin : un identifiant mal câblé sur `:open` (ex. laissé sur
  // `showWelcome` au lieu de `welcomeHasSlot`) passerait inaperçu de tous les autres tests
  // de ce fichier, qui ne posent jamais de concurrent.
  it("cède la parole à la porte du dossier tant qu'elle est à l'écran, malgré welcomeDue", async () => {
    await setSetting('onboarded', true)
    await setSetting('welcomeDue', true)

    const queue = useNoticeQueueStore()
    queue.request(NOTICE.FOLDER_GATE) // simule la porte encore à l'écran (10/08)

    const w = doMount()
    await settle()

    // PRÉCONDITION : la bienvenue est bien demandeur (sa condition propre `welcomeDue` est
    // vraie) EN MÊME TEMPS que la porte. Sans cette assertion, un `open` à `false` pourrait
    // aussi bien venir d'une bienvenue jamais câblée sur la file que d'une bienvenue qui a
    // cédé la place — les deux ont le même symptôme, seule cette ligne les distingue.
    expect(queue.requesters).toContain(NOTICE.WELCOME)
    expect(queue.requesters).toContain(NOTICE.FOLDER_GATE)
    expect(queue.active).toBe(NOTICE.FOLDER_GATE)

    expect(w.findComponent(ConfirmDialog).props('open')).toBe(false)

    // La porte se retire : la bienvenue, jamais perdue, prend la parole à son tour.
    queue.withdraw(NOTICE.FOLDER_GATE)
    await settle()
    const dlg = w.findComponent(ConfirmDialog)
    expect(dlg.props('open')).toBe(true)
    expect(dlg.props('title')).toBe(fr.onboarding.welcomeTitle)
  })

  // ─── Le second contenu de la même fenêtre : « tes données sont de retour »
  // (06/09/2026). Une restauration réussie via la porte efface `welcomeDue`
  // (restore-service.js, revue du 10/08) et arme `restoredDue` à sa place : sans ce
  // second contenu, l'utilisatrice qui vient de retrouver son travail n'avait PLUS
  // AUCUN message — la bienvenue du semis mentant, elle avait été supprimée à juste
  // titre, mais rien ne prenait le relais. ───────────────────────────────────────────
  it('affiche le message « données de retour » quand restoredDue est armé, pas la bienvenue du semis', async () => {
    await setSetting('onboarded', true)
    await setSetting('restoredDue', true)
    const w = doMount()
    await settle()
    const dlg = w.findComponent(ConfirmDialog)
    expect(dlg.exists()).toBe(true)
    expect(dlg.props('open')).toBe(true)
    expect(dlg.props('title')).toBe(fr.restore.welcomeTitle)
    expect(dlg.props('message')).toBe(fr.restore.welcomeBody)
    // La disjonction est LE point du test : le contenu du semis ne doit pas fuiter
    // quand c'est la restauration qui a armé l'affichage (il décrirait des exemples
    // que la restauration vient précisément d'écraser).
    expect(dlg.props('title')).not.toBe(fr.onboarding.welcomeTitle)
    expect(dlg.props('message')).not.toBe(fr.onboarding.welcomeBody)
  })

  it("ouvre le message « données de retour » quand restoredDue passe à vrai EN COURS DE SESSION, sans remonter le composant", async () => {
    // Même mécanique que le test `welcomeDue` en cours de session plus haut : au
    // premier lancement, HomeView est monté DERRIÈRE la porte au moment où
    // `runRestore` écrit le drapeau — c'est `reloadStores()` → `settingsStore.load()`
    // qui le fait basculer, sans aucune navigation ni remontée du composant. Le
    // `watch` doit donc couvrir LES DEUX drapeaux.
    await setSetting('onboarded', true) // rien d'armé au montage
    const w = doMount()
    await settle()
    expect(w.findComponent(ConfirmDialog).props('open')).toBeFalsy()

    // Simule ce que fait `reloadStores()` quand la restauration de la porte réussit :
    // le store des réglages relit la base et voit `restoredDue` à `true` — sur LA
    // MÊME instance que celle résolue par le composant monté (même Pinia active).
    const settingsStore = useSettingsStore()
    await settingsStore.setRestoredDue()
    await settle()

    const dlg = w.findComponent(ConfirmDialog)
    expect(dlg.props('open')).toBe(true)
    expect(dlg.props('title')).toBe(fr.restore.welcomeTitle)
  })

  it("l'acquittement efface les DEUX drapeaux EN BASE (restoredDue ET welcomeDue)", async () => {
    await setSetting('onboarded', true)
    // Les DEUX posés : l'affichage est armé deux fois, l'acquittement doit tout
    // éteindre. Un drapeau orphelin laissé à `true` en base réafficherait la pop-up
    // au démarrage suivant — le piège déjà payé sur `swipeHintSeen` (cf.
    // `dismissWelcome` dans HomeView.vue, écritures ATTENDUES).
    await setSetting('welcomeDue', true)
    await setSetting('restoredDue', true)
    const w = doMount()
    await settle()
    const dlg = w.findComponent(ConfirmDialog)
    expect(dlg.props('open')).toBe(true)

    await dlg.vm.$emit('confirm')
    await settle()

    // On relit la base, pas le store — c'est la base qui décide au prochain démarrage.
    const { getSetting } = await import('@/db/db')
    expect(await getSetting('welcomeDue')).toBe(false)
    expect(await getSetting('restoredDue')).toBe(false)
    expect(w.findComponent(ConfirmDialog).props('open')).toBe(false)
  })
})

// @vitest-environment jsdom
// Unitaire — HomeView : la pop-up de BIENVENUE survit à un vrai relancement de l'app.
//
// Ce fichier testait l'astuce « balaie pour revenir » (P3) ; ce lot (10/08/2026) la
// retire de l'accueil au profit d'une pop-up de bienvenue — cf. `home-welcome-popup.spec.js`
// pour l'essentiel de sa preuve (apparition, texte exact, non-affichage de l'astuce,
// acquittement qui efface le drapeau en base, non-réapparition dans LA MÊME session Pinia).
//
// Ce fichier-ci garde une preuve que l'autre ne fait PAS : une instance vraiment FRAÎCHE —
// nouvelle Pinia (donc nouveau store settings) ET nouveau montage de HomeView, comme un
// relancement réel de l'application (pas une navigation SPA, qui garde le store Pinia en
// mémoire et ne re-déclenche jamais la relecture Dexie). Sans une vraie persistance en base,
// la pop-up réapparaîtrait ici à tort après l'acquittement.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting, setSetting } from '@/db/db'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRouter: () => nav.router }))

// Depuis le lot « visite guidée » (23/09/2026), confirmer la bienvenue du semis enchaîne
// sur `startTour()` (cf. tests/unit/home-welcome-starts-tour.spec.js, qui couvre CE
// comportement en détail, mocké de la même façon). Ce fichier-ci ne teste QUE la
// persistance du drapeau à travers un vrai relancement — `ensureTourProject` (recherche/
// recréation réelle du projet d'exemple, plusieurs écritures Dexie) n'a rien à y faire, et
// l'exécuter pour de vrai ici n'ajouterait que de la charge asynchrone non pertinente à la
// preuve recherchée.
vi.mock('@/utils/tour-sample', () => ({ ensureTourProject: vi.fn().mockResolvedValue({ id: 1, created: false }) }))

import HomeView from '@/views/HomeView.vue'

function mountHome() {
  return mount(HomeView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { ProjectCard: true, StitchProgress: true },
    },
  })
}

function findDialog(w) {
  return w.find('[role="dialog"]')
}
async function waitForDialog(w) {
  await vi.waitFor(() => expect(findDialog(w).exists()).toBe(true), { timeout: 10000 })
}
async function waitForNoDialog(w) {
  await vi.waitFor(() => expect(findDialog(w).exists()).toBe(false), { timeout: 10000 })
}
function startButton(w) {
  return w.findAll('button').find((b) => b.text() === fr.onboarding.welcomeStart)
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.settings.put({ key: 'onboarded', value: true })
})

describe("HomeView — la bienvenue survit à un vrai relancement de l'app", () => {
  // 🚩 LE TEST QUI COMPTE LE PLUS : reproduit un vrai « 2e lancement » — nouvelle instance de
  // Pinia (donc nouveau store settings, comme au prochain démarrage de l'app) + un composant
  // HomeView RE-MONTÉ de zéro. Si la persistance n'existait pas (drapeau seulement en mémoire
  // dans l'ancienne instance jetée), cette pop-up réapparaîtrait ici à tort.
  it('après acquittement, une nouvelle instance (nouvelle Pinia, nouveau montage) ne la revoit pas', async () => {
    await setSetting('welcomeDue', true)

    const w1 = mountHome()
    await waitForDialog(w1)
    await startButton(w1).trigger('click')
    await waitForNoDialog(w1)
    // Preuve de persistance : lu DIRECTEMENT dans Dexie (pas depuis le store en mémoire du
    // composant), donc ce serait rouge si le drapeau n'était qu'un ref sans écriture DB.
    await vi.waitFor(async () => expect(await getSetting('welcomeDue')).toBe(false), { timeout: 10000 })
    w1.unmount()

    // Nouveau « lancement » : nouvelle instance Pinia, nouveau composant, RIEN de partagé en
    // mémoire avec w1 — seule la base Dexie (déjà écrite ci-dessus) survit, comme un vrai reload.
    setActivePinia(createPinia())
    const w2 = mountHome()
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50)) // laisse onMounted(w2) se dérouler avant d'affirmer une absence
    expect(findDialog(w2).exists()).toBe(false)
    w2.unmount()
  })
})

// @vitest-environment jsdom
// Composant — App.vue, retour Android vs pop-up sélecteur de couleur (deuxième revue,
// Important). Avant ce correctif, le handler `backButton` ne consultait que chartZoom et
// lightbox : avec le pop-up ColorPickerDialog ouvert (StashView), Back naviguait hors de
// /stash et jetait le formulaire de laine en cours de saisie — régression vs l'ancien
// <input type=color> natif, dont le Back système fermait proprement le dialogue système.
// Même harnais de mocks que App.sync-wiring.spec.js (router, backup-service, restore,
// run-patron-md-sync, @capacitor/app, db) : mounter App.vue sans ces mocks échoue sur des
// dépendances non liées à ce test.
//
// Correctif de revue, étape 3 : le bandeau de décision (`BackupDecisionPrompt`)
// doit désormais passer AVANT tout dans cette même chaîne de précédence — sans quoi le
// retour Android/le balayage de bord navigueraient DERRIÈRE l'overlay bloquant. Les
// mocks `backupDecision`/`restoreServiceMock` ci-dessous permettent de faire apparaître
// le bandeau (comme App.restore-offer.spec.js) et de contrôler `canRestore` (comme
// backup-decision-prompt.spec.js) pour exercer les DEUX cas : nominal (avale, aucune
// sortie) et bloqué (le retour équivaut à « Plus tard »).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { useColorPickerStore } from '@/stores/color-picker'
import { useChartZoomStore } from '@/stores/chart-zoom'
import { useLightboxStore } from '@/stores/lightbox'
import { useFolderChangeStore } from '@/stores/folder-change'

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => routerMock,
  RouterView: { template: '<div />' },
}))

const backupService = vi.hoisted(() => ({
  getBackupStorage: vi.fn(),
  getBackupPermissionOk: vi.fn(),
  runBackup: vi.fn(),
}))
vi.mock('@/backup/backup-service', () => backupService)

const restore = vi.hoisted(() => ({ hasBackup: vi.fn() }))
vi.mock('@/backup/restore', () => restore)

const backupDecision = vi.hoisted(() => ({
  hasBackupDecision: vi.fn(),
  recordBackupDecision: vi.fn(),
}))
vi.mock('@/backup/backup-decision', () => backupDecision)

// `isDbRestorable` seule est interceptée (même motif que restore-service.runRestore
// dans App.restore-offer.spec.js) : `shouldOfferRestore` reste la VRAIE fonction, et
// `runRestore` (non exercée par ces tests, aucun bouton n'y est cliqué) aussi.
const restoreServiceMock = vi.hoisted(() => ({ isDbRestorable: vi.fn() }))
vi.mock('@/backup/restore-service', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, isDbRestorable: restoreServiceMock.isDbRestorable }
})

const runPatronMdSync = vi.hoisted(() => vi.fn())
vi.mock('@/backup/run-patron-md-sync', () => ({ runPatronMdSync }))

// Capacitor App mocké : capture le handler `backButton` pour pouvoir le déclencher depuis
// le test, comme `resume` le fait déjà dans App.sync-wiring.spec.js.
const capacitorApp = vi.hoisted(() => ({
  addListener: vi.fn(),
  exitApp: vi.fn(),
}))
vi.mock('@capacitor/app', () => ({ App: capacitorApp }))

import App from '@/App.vue'

// Isolation (découvert en écrivant le test de balayage de bord
// ci-dessous) : `useSwipeBack` attache ses écouteurs sur `window`, retiré seulement
// à `onBeforeUnmount`. TOUS les appels doivent donc être démontés (`w.unmount()`) en
// fin de test — sinon un geste tactile simulé dans un test ultérieur atteint AUSSI
// les instances `App` laissées montées par les tests précédents (même `routerMock`
// partagé), et fausse le compte d'appels de `routerMock.back`.
function mountApp() {
  return mount(App, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        SnackBar: true,
        PhotoLightbox: true,
        ChartFullscreen: true,
        PhotoCropper: true,
        OnboardingFolderPrompt: true,
        SyncReportDialog: true,
      },
    },
  })
}

// Attend que la chaîne asynchrone de `onMounted` (patternsStore.ensureFreePattern, etc.)
// soit intégralement retombée avant de rendre la main au test : `runPatronMdSync` est le
// tout dernier appel de cette chaîne (cf. App.vue). Sans cette attente explicite, le
// montage suivant (test suivant, `beforeEach`) peut vider la base pendant que ce montage-ci
// est encore en train d'y lire/écrire (fake-indexeddb partagée) → rejet non géré.
async function getBackButtonHandler() {
  await vi.waitFor(() => expect(runPatronMdSync).toHaveBeenCalled(), { timeout: 10000 })
  await vi.waitFor(() => expect(capacitorApp.addListener).toHaveBeenCalledWith('backButton', expect.any(Function)), { timeout: 10000 })
  return capacitorApp.addListener.mock.calls.find(([evt]) => evt === 'backButton')[1]
}

const PROMPT = '[data-test="backup-decision-prompt"]'

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  routerMock.back.mockClear()
  routerMock.push.mockClear()
  backupService.getBackupStorage.mockResolvedValue(null)
  backupService.getBackupPermissionOk.mockResolvedValue(false)
  restore.hasBackup.mockResolvedValue(false)
  backupDecision.hasBackupDecision.mockResolvedValue(true) // pas de bandeau par défaut
  backupDecision.recordBackupDecision.mockResolvedValue(true)
  restoreServiceMock.isDbRestorable.mockResolvedValue(true)
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

// Comme App.restore-offer.spec.js : quand le bandeau est offert, App.vue SAUTE
// `runPatronMdSync()` (garde anti-course, cf. `maybeOfferRestore`) — le marqueur de
// fin de chaîne `getBackButtonHandler()` (ci-dessus) ne se déclenche donc JAMAIS
// dans ce cas. On attend plutôt l'apparition du bandeau lui-même, comme le fait déjà
// App.restore-offer.spec.js pour les mêmes raisons.
async function getBackButtonHandlerWithPrompt(wrapper) {
  await vi.waitFor(() => expect(wrapper.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
  await flushPromises() // laisse `isDbRestorable()` (sonde interne de BackupDecisionPrompt) retomber
  await vi.waitFor(
    () => expect(capacitorApp.addListener).toHaveBeenCalledWith('backButton', expect.any(Function)),
    { timeout: 10000 },
  )
  return capacitorApp.addListener.mock.calls.find(([evt]) => evt === 'backButton')[1]
}

describe('App — retour Android ferme le pop-up couleur avant de quitter l’écran', () => {
  it('pop-up couleur ouvert : Back le ferme, ne navigue pas', async () => {
    const w = mountApp()
    await flushPromises()
    const onBackButton = await getBackButtonHandler()

    const colorPicker = useColorPickerStore()
    colorPicker.open = true

    onBackButton({ canGoBack: true })

    expect(colorPicker.open).toBe(false)
    expect(routerMock.back).not.toHaveBeenCalled()
    expect(capacitorApp.exitApp).not.toHaveBeenCalled()
    w.unmount() // cf. note d'isolation ci-dessus
  })

  it('rien d’ouvert : Back retombe sur le comportement normal (retour écran)', async () => {
    const w = mountApp()
    await flushPromises()
    const onBackButton = await getBackButtonHandler()

    window.history.replaceState({ back: '/' }, '')
    onBackButton({ canGoBack: true })

    expect(routerMock.back).toHaveBeenCalledOnce()
    w.unmount()
  })

  it('plein écran diagramme ET pop-up couleur ouverts : le plein écran garde la priorité (ordre existant préservé)', async () => {
    const w = mountApp()
    await flushPromises()
    const onBackButton = await getBackButtonHandler()

    const chartZoom = useChartZoomStore()
    const colorPicker = useColorPickerStore()
    chartZoom.show({ chart: { rows: 1, img: 'x.png' }, row: 1, rep: 1, frame: null, readOnly: false })
    colorPicker.open = true

    onBackButton({ canGoBack: true })

    expect(chartZoom.open).toBe(false) // fermé en premier
    expect(colorPicker.open).toBe(true) // pas touché ce coup-ci
    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })
})

// Garde-fou : le store lightbox n'est pas cassé par cet ajout (précédence inchangée).
describe('App — précédence lightbox toujours honorée', () => {
  it('visionneuse photo ouverte : Back la ferme, ne navigue pas', async () => {
    const w = mountApp()
    await flushPromises()
    const onBackButton = await getBackButtonHandler()

    const lightbox = useLightboxStore()
    lightbox.show(['a.png'])

    onBackButton({ canGoBack: true })

    expect(lightbox.open).toBe(false)
    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })
})

// Correctif de revue, étape 3 : le bandeau de décision passe AVANT
// tout le reste de la chaîne de précédence ci-dessus — sans quoi le retour Android
// navigue DERRIÈRE l'overlay bloquant, laissant l'utilisatrice sur un écran qu'elle
// n'a pas demandé pendant que le bandeau reste affiché par-dessus.
function showBandeau() {
  backupService.getBackupStorage.mockResolvedValue({})
  backupService.getBackupPermissionOk.mockResolvedValue(true)
  restore.hasBackup.mockResolvedValue(true)
  backupDecision.hasBackupDecision.mockResolvedValue(false)
}

describe('App — le bandeau de décision passe AVANT tout dans la chaîne de retour', () => {
  it('cas NOMINAL (canRestore vrai) : Back est AVALÉ, ne ferme rien, ne navigue pas, ne quitte pas', async () => {
    showBandeau()
    restoreServiceMock.isDbRestorable.mockResolvedValue(true)
    const w = mountApp()
    const onBackButton = await getBackButtonHandlerWithPrompt(w)

    // Un autre pop-up ouvert en même temps ne doit RIEN changer : le bandeau prime
    // sur TOUTE la chaîne, pas seulement sur le retour écran par défaut.
    const colorPicker = useColorPickerStore()
    colorPicker.open = true

    onBackButton({ canGoBack: true })
    await flushPromises()

    expect(w.find(PROMPT).exists()).toBe(true) // toujours affiché : rien ne l'a fermé
    expect(colorPicker.open).toBe(true) // pas touché : la chaîne normale n'a jamais été atteinte
    expect(routerMock.back).not.toHaveBeenCalled()
    expect(capacitorApp.exitApp).not.toHaveBeenCalled()
    w.unmount()
  })

  it('cas BLOQUÉ (canRestore faux) : Back équivaut à « Plus tard », referme le bandeau, ne navigue pas', async () => {
    showBandeau()
    restoreServiceMock.isDbRestorable.mockResolvedValue(false)
    const w = mountApp()
    const onBackButton = await getBackButtonHandlerWithPrompt(w)
    expect(w.find('[data-test="later"]').exists()).toBe(true) // la sortie existe bien

    onBackButton({ canGoBack: true })
    await flushPromises()

    expect(w.find(PROMPT).exists()).toBe(false) // équivaut à « Plus tard » : le bandeau se ferme
    expect(routerMock.back).not.toHaveBeenCalled() // mais ne navigue PAS derrière lui pour autant
    expect(capacitorApp.exitApp).not.toHaveBeenCalled()
    w.unmount()
  })

  // Le balayage de bord (useSwipeBack) appelle directement `onBack()` — le MÊME
  // point d'entrée que le retour Android passe par `interceptBackupPrompt()`
  // (cf. App.vue). Vérifié ici avec un vrai geste tactile simulé (touchstart près du
  // bord gauche puis touchend suffisamment à droite), pas seulement affirmé en
  // commentaire : useSwipeBack écoute sur `window` SANS aucune condition, c'est
  // justement ce qui a motivé la vérification explicite de ce chemin.
  it('cas NOMINAL : le balayage de bord (useSwipeBack) est également avalé, pas seulement le bouton retour natif', async () => {
    showBandeau()
    restoreServiceMock.isDbRestorable.mockResolvedValue(true)
    const w = mountApp()
    await getBackButtonHandlerWithPrompt(w) // attend que la chaîne asynchrone soit stable

    function touchEvent(type, x, y) {
      const ev = new Event(type)
      Object.defineProperty(ev, 'touches', { value: [{ clientX: x, clientY: y }] })
      Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
      return ev
    }
    window.dispatchEvent(touchEvent('touchstart', 10, 200)) // près du bord gauche (edge par défaut : 28px)
    window.dispatchEvent(touchEvent('touchend', 140, 200)) // ≥ minDistanceX (70px), quasi horizontal
    await flushPromises()

    expect(w.find(PROMPT).exists()).toBe(true) // toujours affiché
    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })
})

// ─── LA PORTE EN MODE CHANGE (décision produit du 05/09/2026) ──────────
//
// La porte ouverte depuis les Réglages (`openForChange`) doit être FERMÉE par le retour
// — les DEUX chaînes (`onBack`/balayage de bord ET `backButton` natif) — au lieu de
// quitter l'app, comportement réservé au premier lancement (garde anti-mur du 09/08).
//
// Le substitut ci-dessous expose EXACTEMENT le contrat du vrai composant
// (`visible`, `mode`, `closeFromBack`, `openForChange` via expose — même forme que le
// substitut d'App.folder-gate-swipe-exit.spec.js) et note chaque geste dans une sonde
// que les tests lisent : on vérifie le CÂBLAGE côté App.vue/util ; la logique interne
// de la porte (quand poser `concluded`, quoi faire d'une annulation…) est couverte par
// tests/unit/onboarding-folder-prompt.spec.js, et l'util seul par
// tests/unit/App.folder-gate-back.spec.js.
const gateProbe = { visible: false, mode: 'onboarding', closedFromBack: 0, openedForChange: 0 }

const resetGateProbe = () => {
  gateProbe.visible = false
  gateProbe.mode = 'onboarding'
  gateProbe.closedFromBack = 0
  gateProbe.openedForChange = 0
}

const FolderGateStub = defineComponent({
  name: 'FolderGateStub',
  emits: ['closed'],
  setup(_, { expose }) {
    expose({
      get visible() {
        return gateProbe.visible
      },
      get mode() {
        return gateProbe.mode
      },
      closeFromBack() {
        gateProbe.closedFromBack += 1
        gateProbe.visible = false
      },
      openForChange() {
        gateProbe.openedForChange += 1
      },
    })
    return () => null
  },
})

// Même harnais que mountApp ci-dessus, mais avec la porte substituée PILOTABLE au lieu
// du stub muet : c'est l'instance substituée que `folderGateRef` tient, donc celle que
// la chaîne de retour et le pont Réglages → porte interrogent.
function mountAppWithGate() {
  return mount(App, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        SnackBar: true,
        PhotoLightbox: true,
        ChartFullscreen: true,
        PhotoCropper: true,
        OnboardingFolderPrompt: FolderGateStub,
        SyncReportDialog: true,
      },
    },
  })
}

describe('App — la porte en mode change : le retour FERME, ne quitte pas', () => {
  beforeEach(() => {
    resetGateProbe()
  })

  it('backButton natif, porte visible en mode change : closeFromBack appelé, exitApp NON, aucune navigation', async () => {
    gateProbe.visible = true
    gateProbe.mode = 'change'
    const w = mountAppWithGate()
    const onBackButton = await getBackButtonHandler()

    onBackButton({ canGoBack: true })
    await flushPromises()

    expect(gateProbe.closedFromBack).toBe(1)
    expect(capacitorApp.exitApp).not.toHaveBeenCalled()
    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })

  // Les DEUX chaînes de retour passent par `folderGateHandlesBack` : le balayage de
  // bord (actif SUR APPAREIL, cf. App.folder-gate-swipe-exit.spec.js) doit fermer la
  // porte aussi — sinon un geste sur deux quitterait encore l'app en mode change.
  it('balayage de bord, porte visible en mode change : closeFromBack aussi (les deux chaînes sont corrigées)', async () => {
    gateProbe.visible = true
    gateProbe.mode = 'change'
    const w = mountAppWithGate()
    await getBackButtonHandler() // attend que la chaîne asynchrone soit stable

    function touchEvent(type, x, y) {
      const ev = new Event(type)
      Object.defineProperty(ev, 'touches', { value: [{ clientX: x, clientY: y }] })
      Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
      return ev
    }
    window.dispatchEvent(touchEvent('touchstart', 10, 200)) // près du bord gauche
    window.dispatchEvent(touchEvent('touchend', 140, 200)) // ≥ minDistanceX, quasi horizontal
    await flushPromises()

    expect(gateProbe.closedFromBack).toBe(1)
    expect(capacitorApp.exitApp).not.toHaveBeenCalled()
    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })

  // LA GARDE ANTI-MUR du 09/08 : en mode PREMIER LANCEMENT, le retour quitte
  // TOUJOURS l'app — jamais une refermeture qui laisserait l'app aller plus loin
  // sans dossier. Ce comportement ne doit pas bouger avec l'ajout du mode change.
  it('premier lancement (mode onboarding) : le retour quitte TOUJOURS l\'app, comme avant', async () => {
    gateProbe.visible = true
    gateProbe.mode = 'onboarding'
    const w = mountAppWithGate()
    const onBackButton = await getBackButtonHandler()

    onBackButton({ canGoBack: true })
    await flushPromises()

    expect(capacitorApp.exitApp).toHaveBeenCalled()
    expect(gateProbe.closedFromBack).toBe(0)
    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })
})

describe('App — le pont Réglages → porte', () => {
  beforeEach(() => {
    resetGateProbe()
  })

  it('requestChange() (bouton des Réglages) ouvre la porte en mode change', async () => {
    const w = mountAppWithGate()
    await getBackButtonHandler() // chaîne de montage stable, watch d'App.vue posé

    useFolderChangeStore().requestChange()
    await flushPromises()

    expect(gateProbe.openedForChange).toBe(1)
    w.unmount()
  })

  it('la demande est CONSOMMÉE : un second requestChange() re-déclenche l\'ouverture', async () => {
    const w = mountAppWithGate()
    await getBackButtonHandler()

    const store = useFolderChangeStore()
    store.requestChange()
    await flushPromises()
    expect(store.requested).toBe(false) // consommée par le watch d'App.vue

    store.requestChange()
    await flushPromises()
    expect(gateProbe.openedForChange).toBe(2)
    w.unmount()
  })
})

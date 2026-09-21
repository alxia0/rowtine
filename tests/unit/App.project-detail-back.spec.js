// Composant — App.vue, câblage de `currentViewRef` dans la chaîne de retour (Task 3, lot
// intents 20/09 : « au swipe, je veux revenir à la fiche stats du projet ouvert »).
// Même harnais de mocks que App.back-precedence.spec.js (router, backup-service, restore,
// backup-decision, restore-service, run-patron-md-sync, @capacitor/app, db) : mounter App.vue
// sans ces mocks échoue sur des dépendances non liées à ce test.
//
// Différence clé avec App.back-precedence.spec.js : ce fichier a besoin que `RouterView` rende
// RÉELLEMENT son slot par défaut avec un composant contrôlable (le stub ci-dessous, qui expose
// `handleBackPressed()`), pas d'un stub muet — c'est le seul moyen de vérifier que
// `currentViewRef.value?.handleBackPressed?.()` est bien lu par `onBack()`/le handler
// `backButton`. Position de précédence : en DERNIER recours, APRÈS les pop-up
// chartZoom/lightbox/colorPicker/projectConsumption — ceux-ci restent prioritaires (un
// dialogue « combien de pelotes ? » ouvert depuis un onglet non par défaut doit continuer à se
// fermer au retour, pas être masqué par l'interception de l'onglet).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { useLightboxStore } from '@/stores/lightbox'

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))

// Vue routée stub, pilotable depuis chaque test via `backHandled.value` : même motif que
// `gateProbe`/`FolderGateStub` dans App.back-precedence.spec.js, mais ici c'est directement le
// composant que `<component :is="Component" ref="currentViewRef">` monte (via le slot par
// défaut de `RouterView`, rendu réellement ci-dessous — pas un stub muet).
const backHandled = vi.hoisted(() => ({ value: false }))
const stubViewComponent = vi.hoisted(() => ({
  name: 'StubRoutedView',
  template: '<div />',
  methods: { handleBackPressed: () => backHandled.value },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => routerMock,
  RouterView: {
    props: ['component'],
    setup(props, { slots }) {
      return () => slots.default?.({ Component: stubViewComponent })
    },
  },
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

const restoreServiceMock = vi.hoisted(() => ({ isDbRestorable: vi.fn() }))
vi.mock('@/backup/restore-service', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, isDbRestorable: restoreServiceMock.isDbRestorable }
})

const runPatronMdSync = vi.hoisted(() => vi.fn())
vi.mock('@/backup/run-patron-md-sync', () => ({ runPatronMdSync }))

const capacitorApp = vi.hoisted(() => ({
  addListener: vi.fn(),
  exitApp: vi.fn(),
}))
vi.mock('@capacitor/app', () => ({ App: capacitorApp }))

import App from '@/App.vue'

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

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  routerMock.back.mockClear()
  routerMock.push.mockClear()
  backHandled.value = false
  backupService.getBackupStorage.mockResolvedValue(null)
  backupService.getBackupPermissionOk.mockResolvedValue(false)
  restore.hasBackup.mockResolvedValue(false)
  backupDecision.hasBackupDecision.mockResolvedValue(true) // pas de bandeau par défaut
  backupDecision.recordBackupDecision.mockResolvedValue(true)
  restoreServiceMock.isDbRestorable.mockResolvedValue(true)
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

async function getBackButtonHandler() {
  await vi.waitFor(() => expect(runPatronMdSync).toHaveBeenCalled(), { timeout: 10000 })
  await vi.waitFor(() => expect(capacitorApp.addListener).toHaveBeenCalledWith('backButton', expect.any(Function)), { timeout: 10000 })
  return capacitorApp.addListener.mock.calls.find(([evt]) => evt === 'backButton')[1]
}

describe('App — la vue routée courante intercepte le retour (currentViewRef)', () => {
  it('déclenche smartBack() quand la vue routée n’avale pas le retour', async () => {
    backHandled.value = false
    const w = mountApp()
    await flushPromises()
    const onBackButton = await getBackButtonHandler()

    // smartBack() (useSmartBack.js) n'appelle router.back() que si l'historique porte une
    // entrée « back » — même préalable que App.back-precedence.spec.js pour ce cas nominal.
    window.history.replaceState({ back: '/' }, '')
    onBackButton({ canGoBack: true })
    await flushPromises()

    expect(routerMock.back).toHaveBeenCalled()
    w.unmount()
  })

  it('avale le retour sans naviguer quand la vue routée le prend en charge', async () => {
    backHandled.value = true
    const w = mountApp()
    await flushPromises()
    const onBackButton = await getBackButtonHandler()

    onBackButton({ canGoBack: true })
    await flushPromises()

    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })

  // Garde-fou de précédence : un pop-up bloquant (ici la visionneuse photo, ouvrable depuis
  // l'onglet Photos — non par défaut) doit continuer à se FERMER au retour, même quand la vue
  // routée avalerait elle aussi le geste. Si `currentViewRef` était consulté AVANT les pop-up
  // (erreur de précédence possible sur ce type de chaînage), ce test échouerait : la
  // visionneuse resterait ouverte et rien ne serait appelé.
  it('un pop-up ouvert (lightbox) garde la priorité sur l’interception de la vue routée', async () => {
    backHandled.value = true
    const w = mountApp()
    await flushPromises()
    const onBackButton = await getBackButtonHandler()

    const lightbox = useLightboxStore()
    lightbox.show(['a.png'])

    onBackButton({ canGoBack: true })
    await flushPromises()

    expect(lightbox.open).toBe(false)
    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })

  // Le balayage de bord (useSwipeBack) appelle directement `onBack()` — Julien a demandé ce
  // correctif explicitement « au swipe » (cf. intent source). Vérifié ici avec un vrai geste
  // tactile simulé, pas seulement via le bouton retour natif — même motif que
  // App.back-precedence.spec.js, qui teste les deux chaînes séparément car elles ne
  // s'appellent pas l'une l'autre.
  it('le balayage de bord (useSwipeBack) avale aussi le retour, pas seulement le bouton natif', async () => {
    backHandled.value = true
    const w = mountApp()
    await flushPromises()
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

    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })

  // Même garde-fou de précédence que le test bouton natif ci-dessus (« un pop-up ouvert
  // (lightbox) garde la priorité… »), mais déclenché via le balayage de bord (`onBack()`,
  // useSwipeBack) plutôt que le handler `backButton` : les deux chaînes sont codées
  // différemment (`else if (!currentViewRef.value?.handleBackPressed?.()) smartBack()` ici,
  // contre `else if (currentViewRef.value?.handleBackPressed?.()) return` côté natif) et
  // pourraient diverger sans qu'un test commun aux deux ne le remarque — revue finale,
  // finding 5.
  it('un pop-up ouvert (lightbox) garde la priorité sur l’interception de la vue routée, aussi au balayage de bord', async () => {
    backHandled.value = true
    const w = mountApp()
    await flushPromises()
    await getBackButtonHandler() // attend que la chaîne asynchrone soit stable

    const lightbox = useLightboxStore()
    lightbox.show(['a.png'])
    // Garde le test discriminant (cf. commit « Badge : rend le test du tiroir déplié
    // discriminant, il était vacant », même piège) : sans cette assertion, un `show()` sans
    // effet ferait passer le test pour de mauvaises raisons — `lightbox.open` resterait déjà
    // à `false` avant même le geste de retour.
    expect(lightbox.open).toBe(true)

    function touchEvent(type, x, y) {
      const ev = new Event(type)
      Object.defineProperty(ev, 'touches', { value: [{ clientX: x, clientY: y }] })
      Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
      return ev
    }
    window.dispatchEvent(touchEvent('touchstart', 10, 200)) // près du bord gauche
    window.dispatchEvent(touchEvent('touchend', 140, 200)) // ≥ minDistanceX, quasi horizontal
    await flushPromises()

    expect(lightbox.open).toBe(false)
    expect(routerMock.back).not.toHaveBeenCalled()
    w.unmount()
  })
})

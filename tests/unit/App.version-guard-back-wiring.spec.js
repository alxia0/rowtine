// Composant — App.vue, garde-fou de version sur le retour Android et balayage de
// bord. La fonction pure `versionGuardHandlesBack` est testée isolément dans
// tests/unit/App.version-guard-back.spec.js, et la précédence d'autres couches
// (bandeau de restauration, porte, popups) est testée dans tests/unit/App.back-precedence.spec.js.
// Ce test isole le câblage du garde-fou lui-même dans le composant : les deux chaînes
// de retour (onBack/balayage de bord ET backButton natif) doivent avaler le geste
// quand le garde-fou est affiché, sans appeler aucune autre fonction.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { useColorPickerStore } from '@/stores/color-picker'
import { versionGuardState } from '@/db/version-guard'

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

async function getBackButtonHandler() {
  await vi.waitFor(() => expect(runPatronMdSync).toHaveBeenCalled(), { timeout: 10000 })
  await vi.waitFor(() => expect(capacitorApp.addListener).toHaveBeenCalledWith('backButton', expect.any(Function)), { timeout: 10000 })
  return capacitorApp.addListener.mock.calls.find(([evt]) => evt === 'backButton')[1]
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  routerMock.back.mockClear()
  routerMock.push.mockClear()
  backupService.getBackupStorage.mockResolvedValue(null)
  backupService.getBackupPermissionOk.mockResolvedValue(false)
  restore.hasBackup.mockResolvedValue(false)
  backupDecision.hasBackupDecision.mockResolvedValue(true)
  backupDecision.recordBackupDecision.mockResolvedValue(true)
  restoreServiceMock.isDbRestorable.mockResolvedValue(true)
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('App — le garde-fou de version prime sur TOUTE la chaîne de retour', () => {
  afterEach(() => {
    versionGuardState.triggered = false
  })

  it('backButton natif, garde-fou affiché : le geste est avalé, aucune sortie, aucune navigation', async () => {
    const w = mountApp()
    await flushPromises()
    const onBackButton = await getBackButtonHandler()
    versionGuardState.triggered = true

    // Un autre pop-up ouvert en même temps ne doit RIEN changer : le garde-fou
    // prime sur toute la chaîne, avant même le bandeau de restauration/la porte.
    const colorPicker = useColorPickerStore()
    colorPicker.open = true

    onBackButton({ canGoBack: true })
    await flushPromises()

    expect(colorPicker.open).toBe(true) // pas touché : la chaîne normale n'a jamais été atteinte
    expect(routerMock.back).not.toHaveBeenCalled()
    expect(capacitorApp.exitApp).not.toHaveBeenCalled()
    w.unmount()
  })

  it('balayage de bord (useSwipeBack), garde-fou affiché : également avalé, pas seulement le bouton natif', async () => {
    const w = mountApp()
    await flushPromises()
    await getBackButtonHandler() // attend que la chaîne asynchrone soit stable
    versionGuardState.triggered = true

    // Sans cet état d'historique, smartBack() part sur router.push(fallback) et non
    // router.back() : l'assertion ci-dessous resterait vraie même la garde retirée.
    window.history.replaceState({ back: '/' }, '')

    function touchEvent(type, x, y) {
      const ev = new Event(type)
      Object.defineProperty(ev, 'touches', { value: [{ clientX: x, clientY: y }] })
      Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
      return ev
    }
    window.dispatchEvent(touchEvent('touchstart', 10, 200))
    window.dispatchEvent(touchEvent('touchend', 140, 200))
    await flushPromises()

    expect(routerMock.back).not.toHaveBeenCalled()
    expect(capacitorApp.exitApp).not.toHaveBeenCalled()
    w.unmount()
  })

  it('garde-fou NON affiché : le retour retombe sur le comportement normal (pas de faux positif)', async () => {
    const w = mountApp()
    await flushPromises()
    const onBackButton = await getBackButtonHandler()
    versionGuardState.triggered = false

    window.history.replaceState({ back: '/' }, '')
    onBackButton({ canGoBack: true })

    expect(routerMock.back).toHaveBeenCalledOnce()
    w.unmount()
  })
})

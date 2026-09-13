// Composant — App.vue, câblage de la synchro MD aux frontières.
// On vérifie : (1) au lancement, `runPatronMdSync` est appelé quand AUCUNE
// restauration n'a été proposée sur ce lancement ; (2) il n'est PAS appelé quand
// une restauration a été proposée (garde anti-course, §4) ; (3) le
// listener `resume` de @capacitor/app est enregistré et appelle `runPatronMdSync`.
// `run-patron-md-sync.js` est mocké : ce test couvre le câblage, pas la logique
// interne de la synchro (déjà couverte par run-patron-md-sync.spec.js et
// patron-md-sync.spec.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  RouterView: { template: '<div />' },
}))

const backupService = vi.hoisted(() => ({
  getBackupStorage: vi.fn(),
  getBackupPermissionOk: vi.fn(),
}))
vi.mock('@/backup/backup-service', () => backupService)

const restore = vi.hoisted(() => ({ hasBackup: vi.fn() }))
vi.mock('@/backup/restore', () => restore)

const runPatronMdSync = vi.hoisted(() => vi.fn())
vi.mock('@/backup/run-patron-md-sync', () => ({ runPatronMdSync }))

// Capacitor App mocké : capture le handler `resume` pour pouvoir le déclencher
// depuis le test, comme `backButton`/`pause` le font déjà pour leurs propres tests.
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
        PhotoCropper: true,
        OnboardingFolderPrompt: true,
      },
    },
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('App — câblage synchro MD (lancement + resume)', () => {
  it("lance runPatronMdSync au montage quand aucune restauration n'est proposée", async () => {
    backupService.getBackupStorage.mockResolvedValue(null) // pas de stockage → pas d'offre de restauration
    backupService.getBackupPermissionOk.mockResolvedValue(false)
    restore.hasBackup.mockResolvedValue(false)

    mountApp()

    await vi.waitFor(() => expect(runPatronMdSync).toHaveBeenCalledTimes(1), { timeout: 10000 })
  })

  it('ne lance PAS runPatronMdSync au montage quand une restauration vient d’être proposée', async () => {
    backupService.getBackupStorage.mockResolvedValue({}) // stockage détecté
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true) // + base vide + non onboardé (Pinia frais) → offre déclenchée

    mountApp()

    // On attend que la garde de permission ait bien été consultée (preuve que
    // `maybeOfferRestore` a tourné jusqu'au bout), puis on vérifie l'absence d'appel.
    await vi.waitFor(() => expect(backupService.getBackupPermissionOk).toHaveBeenCalled(), { timeout: 10000 })
    await flushPromises()

    expect(runPatronMdSync).not.toHaveBeenCalled()
  })

  it("enregistre un listener 'resume' qui appelle runPatronMdSync", async () => {
    backupService.getBackupStorage.mockResolvedValue(null)
    backupService.getBackupPermissionOk.mockResolvedValue(false)
    restore.hasBackup.mockResolvedValue(false)

    mountApp()
    await flushPromises()

    await vi.waitFor(
      () => expect(capacitorApp.addListener).toHaveBeenCalledWith('resume', expect.any(Function)),
      { timeout: 10000 },
    )
    runPatronMdSync.mockClear() // ignore l'appel du lancement, on isole celui du resume

    const resumeCall = capacitorApp.addListener.mock.calls.find(([evt]) => evt === 'resume')
    resumeCall[1]()

    expect(runPatronMdSync).toHaveBeenCalledTimes(1)
  })
})

// Composant — App.vue, le balayage de bord quitte l'app quand la porte du dossier est
// visible (correctif de revue, 09/08/2026). Le code initial de la tache 3 faisait passer
// `null` a la place du plugin @capacitor/app sur ce chemin (`onBack`), en le qualifiant a
// tort de « web/dev » : `onBack` sert AUSSI le balayage de bord, ACTIF SUR APPAREIL —
// `useSwipeBack` (src/composables/useSwipeBack.js) ecoute `touchstart`/`touchend` sur
// `window` SANS AUCUNE garde `Capacitor.isNativePlatform()`. Sans ce correctif, un
// balayage depuis le bord alors que la porte est affichee est AVALE sans le moindre
// effet visible : une app qui ne reagit pas a un geste passe pour figee.
//
// Meme motif de verification que App.back-precedence.spec.js (« le balayage de bord est
// egalement avale ») : un VRAI geste tactile simule (touchstart pres du bord gauche puis
// touchend suffisamment a droite), pas seulement une assertion sur `onBack()` invoque
// directement. Verifie par mutation (cf. rapport de tache) : remettre `null` a la place
// de `capacitorApp` dans `onBack` fait rougir ce test.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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

// Meme mock que App.back-precedence.spec.js / App.sync-wiring.spec.js : capture
// l'objet `App` reel pour verifier lequel des DEUX chemins de retour appelle `exitApp`.
const capacitorApp = vi.hoisted(() => ({
  addListener: vi.fn(),
  exitApp: vi.fn(),
}))
vi.mock('@capacitor/app', () => ({ App: capacitorApp }))

// Substitut de la porte : le VRAI OnboardingFolderPrompt exige tout un autre bloc de
// mocks (saf-folder, designate-folder, restore-on-designate) hors du perimetre de ce
// fichier, deja couverts par tests/unit/onboarding-folder-prompt.spec.js. Ce substitut
// expose `visible` EXACTEMENT comme le vrai composant (`defineExpose({ visible })`) —
// c'est ce contrat-la que ce test verifie cote App.vue, pas la logique interne de la
// porte (qui decide, elle, QUAND devenir visible).
vi.mock('@/components/OnboardingFolderPrompt.vue', () => ({
  default: {
    name: 'OnboardingFolderPromptVisibleStub',
    emits: ['closed'],
    data() {
      return { visible: true }
    },
    expose: ['visible'],
    template: '<div />',
  },
}))

import App from '@/App.vue'

function mountApp() {
  return mount(App, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { SnackBar: true, PhotoLightbox: true, PhotoCropper: true },
    },
  })
}

function touchEvent(type, x, y) {
  const ev = new Event(type)
  Object.defineProperty(ev, 'touches', { value: [{ clientX: x, clientY: y }] })
  Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
  return ev
}

function swipeFromEdge() {
  window.dispatchEvent(touchEvent('touchstart', 10, 200)) // pres du bord gauche (edge par defaut : 28px)
  window.dispatchEvent(touchEvent('touchend', 140, 200)) // >= minDistanceX (70px), quasi horizontal
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  backupService.getBackupStorage.mockResolvedValue(null)
  backupService.getBackupPermissionOk.mockResolvedValue(false)
  restore.hasBackup.mockResolvedValue(false)
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('App — le balayage de bord quitte l\'app quand la porte du dossier est visible', () => {
  it('porte visible : un balayage depuis le bord appelle exitApp (pas seulement le bouton retour natif)', async () => {
    const w = mountApp()

    // Attend que l'import dynamique de @capacitor/app ait resolu (`capacitorApp`
    // capture dans App.vue) : sans cette attente, le balayage tomberait sur un
    // `capacitorApp` encore `null` pour une raison transitoire (import pas fini) et
    // non pour le bug reel qu'on verifie ici.
    await vi.waitFor(
      () => expect(capacitorApp.addListener).toHaveBeenCalledWith('backButton', expect.any(Function)),
      { timeout: 10000 },
    )

    swipeFromEdge()

    expect(capacitorApp.exitApp).toHaveBeenCalled()
    w.unmount()
  })
})

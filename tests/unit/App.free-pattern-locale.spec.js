// @vitest-environment jsdom
// Composant — App.vue, le patron libre naît dans la langue CHOISIE à l'accueil, jamais
// seulement DEVINÉE de l'appareil (correctif task C4-fix2, 31/07, trouvé en revue).
//
// Bug réel, pas un cas limite : `ensureFreePattern` est idempotent (crée une seule fois).
// App.vue l'appelait au montage, AVANT la fin de l'onboarding, avec la langue seulement
// devinée — l'appel ultérieur d'OnboardingView.seedExamples(), avec la langue VALIDÉE au
// menu déroulant, devenait alors un no-op silencieux : le gabarit « patron libre » (nom,
// titre de section, texte d'étape) restait figé dans la langue devinée alors que tout le
// reste de l'app basculait dans la langue choisie. C'est le chemin du tout PREMIER
// lancement lui-même, déterministe dès que la langue devinée diffère du choix.
//
// @/constants/demo est mocké pour produire un `freePattern.name` DISTINCT par langue passée
// en argument : au moment de ce lot, une seule langue réelle (fr) est câblée
// (src/constants/demo/index.js, tâche C5 à venir) — ce mock isole le test du contenu
// multilingue réel et exerce directement le SÉQUENCEMENT (qui appelle quoi, dans quel
// ordre), indépendamment de ce qui est déjà traduit.
//
// Même harnais que tests/unit/App.restore-offer.spec.js (router, backup-service, restore,
// base Dexie réelle via fake-indexeddb) + mock de run-patron-md-sync (repère de fin de
// chaîne onMounted, comme App.back-precedence.spec.js) pour attendre un montage réellement
// stabilisé avant d'agir.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'
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

// `freePattern.name` porte la locale demandée EN CLAIR : suffit à prouver QUELLE langue a
// gagné, sans dépendre du contenu multilingue réel (pas encore câblé au-delà du français).
vi.mock('@/constants/demo', () => ({
  DEMO_PATTERN_DEMO_ID: 'bonnet',
  loadDemoContent: (locale) =>
    Promise.resolve({
      patterns: [],
      projects: { idea: {}, fallbackKnitting: '', fallbackCrochet: '', fallbackNotes: '' },
      freePattern: { name: `Patron libre (${locale})`, sectionTitle: 'x', stepText: 'y' },
    }),
}))

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

// Attend que la chaîne asynchrone de `onMounted` soit intégralement retombée (même repère
// que App.back-precedence.spec.js : `runPatronMdSync` est le tout dernier appel).
async function waitAppSettled() {
  await vi.waitFor(() => expect(runPatronMdSync).toHaveBeenCalled(), { timeout: 10000 })
  await flushPromises()
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

describe('App — le patron libre naît dans la langue CHOISIE, pas seulement devinée', () => {
  it("1er lancement (onboarding pas encore fait) : App.vue NE crée PAS le patron libre au montage", async () => {
    // Base vide, rien de persisté : `onboarded` reste à son défaut (false). C'est
    // exactement l'état d'une utilisatrice qui vient de lancer l'app pour la 1re fois,
    // AVANT d'avoir validé l'écran d'accueil.
    mountApp()
    await waitAppSettled()

    expect(await db.patterns.count()).toBe(0)
  })

  it("langue devinée ≠ langue choisie : le patron libre créé à la fin de l'onboarding porte la langue CHOISIE", async () => {
    mountApp()
    await waitAppSettled()
    // Aucun patron créé pendant que l'app était encore montée « pré-onboarding » (repris
    // du test précédent, pour que CE test rougisse À LUI SEUL si le séquencement régresse).
    expect(await db.patterns.count()).toBe(0)

    // Simule la fin de l'onboarding : l'utilisatrice a choisi 'de' dans le menu déroulant —
    // c'est l'appel exact que fait OnboardingView.seedExamples().
    const patternsStore = usePatternsStore()
    await patternsStore.ensureFreePattern('de')

    const builtin = (await db.patterns.toArray()).find((p) => p.builtin)
    expect(builtin?.name).toBe('Patron libre (de)')
  })

  it("2e ouverture (déjà onboardée, patron déjà créé) : App.vue ne le recrée ni ne le renomme", async () => {
    // État d'une utilisatrice de retour : onboarding fait, langue PERSISTÉE différente de
    // la langue du patron déjà créé (simule un changement de langue dans les Réglages
    // APRÈS l'onboarding — qui ne doit PAS rétroactivement renommer le patron libre,
    // cf. commentaire de ensureFreePattern dans stores/patterns.js : « les libellés du
    // patron libre sont figés à la création… et n'en changent plus ensuite »).
    await db.settings.put({ key: 'onboarded', value: true })
    await db.settings.put({ key: 'locale', value: 'de' })
    const existingId = await db.patterns.add({
      name: 'Patron libre (fr)',
      type: 'knitting',
      category: 'other',
      builtin: true,
      sections: [],
      reader: { sizeLabels: [], sections: [] },
    })

    mountApp()
    await waitAppSettled()

    const all = await db.patterns.toArray()
    expect(all).toHaveLength(1) // pas de doublon créé
    expect(all[0].id).toBe(existingId) // même patron, pas recréé
    expect(all[0].name).toBe('Patron libre (fr)') // pas renommé malgré locale='de'
  })
})

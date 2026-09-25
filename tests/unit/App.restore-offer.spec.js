// @vitest-environment jsdom
// App.vue, bandeau de décision au lancement : `maybeOfferRestore` n'affiche le bandeau que si
// un dossier SAF est désigné (`getBackupPermissionOk`) ET que `backupPauseReason` donne une
// raison (le même prédicat qui arrête les écritures). On teste le CÂBLAGE d'App.vue ; les
// comportements propres de `BackupDecisionPrompt` (non stubbé ici) sont couverts par
// backup-decision-prompt.spec.js. vue-router mocké, enfants lourds stubbés, Dexie réelle
// (fake-indexeddb) pour les stores.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { versionGuardState } from '@/db/version-guard'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeQueueStore } from '@/stores/notice-queue'
import { useSyncReportStore } from '@/stores/sync-report'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  RouterView: { template: '<div />' },
}))

// Garde de permission SAF : c'est CETTE garde qu'App.vue doit utiliser. `runBackup` (bouton
// « Repartir de zéro » du bandeau) est mocké pour ne jamais toucher le plugin natif.
const backupService = vi.hoisted(() => ({
  getBackupStorage: vi.fn(),
  getBackupPermissionOk: vi.fn(),
  runBackup: vi.fn(),
}))
vi.mock('@/backup/backup-service', () => backupService)

const restore = vi.hoisted(() => ({ hasBackup: vi.fn() }))
vi.mock('@/backup/restore', () => restore)

// Consommée par App.vue (`maybeOfferRestore`) ET par `BackupDecisionPrompt`.
const backupDecision = vi.hoisted(() => ({
  hasBackupDecision: vi.fn(),
  recordBackupDecision: vi.fn(),
}))
vi.mock('@/backup/backup-decision', () => backupDecision)

// `backupPauseReason` reste RÉELLE (la chaîne entière doit mordre) et consulte la fiche
// d'identité du dossier. `'absent'` par défaut = aucune suspension de ce chef, pour que les
// tests gardent le seul critère « une décision a-t-elle été prise ? ». Sans ce mock, le vrai
// `readManifest` échouerait sur le stockage factice `{}` et retomberait sur « un autre
// appareil » : le bandeau s'afficherait même là où il ne doit pas.
const manifest = vi.hoisted(() => ({ readManifest: vi.fn(async () => ({ state: 'absent' })) }))
vi.mock('@/backup/backup-manifest', () => manifest)

// Seul `runRestore` est intercepté : `shouldOfferRestore` reste la vraie fonction, c'est elle
// qui doit rougir si elle cessait de tenir compte de la raison de pause.
const restoreServiceMock = vi.hoisted(() => ({ runRestore: vi.fn() }))
vi.mock('@/backup/restore-service', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, runRestore: restoreServiceMock.runRestore }
})

// `OnboardingFolderPrompt` réel exige tout un autre bloc de mocks (couvert par
// onboarding-folder-prompt.spec.js) : un substitut minimal émet `closed` sur commande, pour
// tester seulement le câblage d'App.vue sur cet événement.
vi.mock('@/components/OnboardingFolderPrompt.vue', () => ({
  default: {
    name: 'OnboardingFolderPromptStub',
    emits: ['closed'],
    template: '<button data-test="close-onboarding" @click="$emit(\'closed\')" />',
  },
}))

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

// Variante SANS stub sur OnboardingFolderPrompt : laisse passer le substitut `vi.mock` ci-dessus.
function mountAppWithOnboarding() {
  return mount(App, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { SnackBar: true, PhotoLightbox: true, PhotoCropper: true },
    },
  })
}

const PROMPT = '[data-test="backup-decision-prompt"]'

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  restoreServiceMock.runRestore.mockReset().mockResolvedValue({ ok: true, decided: true })
  backupDecision.hasBackupDecision.mockReset().mockResolvedValue(false)
  backupDecision.recordBackupDecision.mockReset().mockResolvedValue(true)
  backupService.runBackup.mockReset().mockResolvedValue({ ok: true })
  // `mockReset()`, pas seulement `vi.clearAllMocks()` (qui vide les appels, pas les
  // implémentations) : sinon une surcharge de `readManifest` fuirait vers les tests suivants.
  manifest.readManifest.mockReset().mockResolvedValue({ state: 'absent' })
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

// `versionGuardState` est un singleton de MODULE, pas un store Pinia : recréer Pinia ne le
// réinitialise pas, et le bloc « file des messages » le passe à `true`.
afterEach(() => {
  versionGuardState.triggered = false
})

describe('App — bandeau de décision au lancement', () => {
  it('affiche le bandeau quand un dossier SAF est désigné, une sauvegarde présente, aucune décision prise', async () => {
    backupService.getBackupStorage.mockResolvedValue({}) // stockage natif détecté (SAF)
    backupService.getBackupPermissionOk.mockResolvedValue(true) // dossier SAF désigné
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(false)

    const w = mountApp()

    // La chaîne d'onMounted (stores + IndexedDB réelle via fake-indexeddb) enchaîne
    // de nombreux await ; un seul flushPromises() ne suffit pas toujours à la
    // dérouler entièrement → on attend la condition plutôt qu'un nombre de ticks fixe.
    await vi.waitFor(() => expect(w.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
    expect(w.text()).toContain(i18n.global.t('saf.backupPaused'))
    expect(backupService.getBackupPermissionOk).toHaveBeenCalled()
  })

  it("ne s'affiche pas quand aucun dossier SAF n'est désigné", async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(false)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(false)

    const w = mountApp()

    // On attend que la chaîne d'onMounted ait bien atteint la garde de permission
    // (preuve que maybeOfferRestore s'est exécuté), puis on vérifie qu'elle n'a pas offert.
    await vi.waitFor(() => expect(backupService.getBackupPermissionOk).toHaveBeenCalled(), { timeout: 10000 })
    await flushPromises()

    expect(w.find(PROMPT).exists()).toBe(false)
  })

  it("ne s'affiche pas quand une décision a déjà été prise pour ce dossier", async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(true)

    const w = mountApp()

    await vi.waitFor(() => expect(backupDecision.hasBackupDecision).toHaveBeenCalled(), { timeout: 10000 })
    await flushPromises()

    expect(w.find(PROMPT).exists()).toBe(false)
  })

  // La raison « autre appareil » doit ATTEINDRE le bandeau (sinon écritures arrêtées, aucun
  // bandeau, aucune issue). `hasBackupDecision` vaut `true` : c'est ce qui rend le test capable
  // d'échouer, l'ancien critère « aucune décision » conclurait à l'absence de bandeau.
  it("s'affiche quand la décision est prise mais qu'un AUTRE appareil a écrit dans le dossier", async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(true)
    manifest.readManifest.mockResolvedValue({ state: 'ok', manifest: { appareil: 'ancien-telephone' } })

    const w = mountApp()

    await vi.waitFor(() => expect(w.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
  })

  // La raison doit ARRIVER jusqu'au bandeau (`:pause-reason`), pas seulement décider de son
  // affichage : sinon il annoncerait « restaure d'abord », faux pour un conflit à deux appareils.
  // Comparé à `element.textContent`, jamais à `w.html()` (l'embellisseur de @vue/test-utils
  // réinsère des retours à la ligne), et en égalité COMPLÈTE : la phrase affichée juste en
  // dessous contient aussi « autre appareil ».
  it("la RAISON « autre appareil » atteint le bandeau : c'est ce qu'il affiche, et il offre une sortie", async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(true)
    manifest.readManifest.mockResolvedValue({ state: 'ok', manifest: { appareil: 'ancien-telephone' } })

    const w = mountApp()

    await vi.waitFor(() => expect(w.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
    await flushPromises()

    expect(w.find('#bdp-body').element.textContent.trim()).toBe(i18n.global.t('saf.otherDeviceBlocked'))
    // La base est vide ici (`db.tables.clear()` en `beforeEach`) : « Restaurer » POURRAIT
    // aboutir, donc `!canRestore` n'offre AUCUNE sortie — seule la raison transmise peut
    // faire apparaître « Plus tard ». C'est ce qui rend cette assertion capable d'échouer.
    expect(w.find('[data-test="later"]').exists()).toBe(true)
  })

  // Le bandeau se propose MÊME quand la base contient du travail réel : le contenu de la base
  // n'est plus un critère de `shouldOfferRestore`.
  it("s'affiche même quand la base contient du travail réel (ce n'est plus un critère)", async () => {
    await db.projects.add({ name: 'Un ouvrage bien réel', photos: [] })
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(false)

    const w = mountApp()

    await vi.waitFor(() => expect(w.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
  })

  // La progression vit DANS le panneau du bandeau : `BackupDecisionPrompt` (réel) monte
  // `<SyncProgressLine owner="app" />` et appelle `beginSyncProgress('read', 'app')` ; c'est
  // l'accord entre les deux chaînes `'app'` qui est le risque, invisible en isolation. On
  // cherche DANS l'élément du bandeau (`PROMPT`), pas dans tout le wrapper : `exists()` sur
  // le wrapper prouverait seulement une présence quelque part dans le document.
  it("le bouton « Restaurer » du bandeau affiche la progression DANS SON PANNEAU (owner \"app\"), la retire après, et referme le bandeau", async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(false)

    let seenDuringOperation = false
    let wrapper
    restoreServiceMock.runRestore.mockImplementation(async ({ onProgress }) => {
      onProgress({ phase: 'read', done: 1, total: 3 })
      await wrapper.vm.$nextTick()
      seenDuringOperation = wrapper.find(PROMPT).find('[data-test="sync-progress"]').exists()
      return { ok: true, decided: true }
    })

    wrapper = mountApp()
    await vi.waitFor(() => expect(wrapper.find(PROMPT).exists()).toBe(true), { timeout: 10000 })

    await wrapper.find('[data-test="prompt-restore"]').trigger('click')
    await flushPromises()

    expect(seenDuringOperation).toBe(true)
    expect(wrapper.find('[data-test="sync-progress"]').exists()).toBe(false)
    // Décidé avec succès : le bandeau n'a plus lieu d'être, il se referme — et
    // emporte donc la ligne de progression avec lui, qu'elle ait été DANS son
    // panneau (désormais) ou ailleurs.
    expect(wrapper.find(PROMPT).exists()).toBe(false)
  })

  // `maybeOfferRestore()` ne tourne qu'une fois au montage, AVANT que l'utilisatrice ait pu
  // désigner un dossier depuis `OnboardingFolderPrompt` : le signal `closed` doit le relancer,
  // sinon rien ne proposerait la décision avant le lancement suivant.
  //
  // Piège de harnais : l'`onMounted` d'App.vue enchaîne de nombreux `await` réels (stores,
  // IndexedDB) avant `maybeOfferRestore()`, et un seul `flushPromises()` ne les draine pas.
  // L'évaluation initiale, encore en vol, retomberait sur les mocks réécrits par le test et
  // ferait apparaître le bandeau pour la mauvaise raison (tests verts sans `@closed`). On
  // attend donc le premier appel à `getBackupStorage` (appelé seulement par
  // `maybeOfferRestore()` sur ce chemin), puis on laisse retomber sa continuation.
  async function waitForInitialMaybeOfferRestoreToSettle() {
    await vi.waitFor(() => expect(backupService.getBackupStorage).toHaveBeenCalledTimes(1), { timeout: 10000 })
    await flushPromises()
  }

  describe('ré-évaluation après la fermeture de l\'invite de dossier (étape 4)', () => {
    it("le bandeau apparaît APRÈS la fermeture de l'invite, si un dossier avec sauvegarde existe désormais et qu'aucune décision n'a été prise", async () => {
      // Premier appel (montage) : aucun dossier encore désigné.
      backupService.getBackupStorage.mockResolvedValue(null)

      const w = mountAppWithOnboarding()
      // Attente RÉELLE que l'évaluation initiale soit retombée (piège ci-dessus).
      await waitForInitialMaybeOfferRestoreToSettle()
      expect(w.find(PROMPT).exists()).toBe(false)

      // Dossier PLEIN désigné depuis l'invite, restauration refusée : aucune décision posée.
      backupService.getBackupStorage.mockResolvedValue({})
      backupService.getBackupPermissionOk.mockResolvedValue(true)
      restore.hasBackup.mockResolvedValue(true)
      backupDecision.hasBackupDecision.mockResolvedValue(false)

      await w.find('[data-test="close-onboarding"]').trigger('click')

      // Preuve DIRECTE du câblage : `maybeOfferRestore()` est RE-appelé (2e `getBackupStorage`).
      await vi.waitFor(() => expect(backupService.getBackupStorage).toHaveBeenCalledTimes(2), { timeout: 10000 })
      await vi.waitFor(() => expect(w.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
    })

    it("le bandeau reste absent si, à la fermeture de l'invite, aucun dossier n'a finalement été désigné", async () => {
      backupService.getBackupStorage.mockResolvedValue(null)

      const w = mountAppWithOnboarding()
      await waitForInitialMaybeOfferRestoreToSettle()

      // « Plus tard » : rien n'a changé, `getBackupStorage` reste sans stockage.
      await w.find('[data-test="close-onboarding"]').trigger('click')

      // Preuve du câblage, indépendante de l'issue (absente de toute façon) : sans ce 2e appel
      // attendu, le test resterait vert même sans `@closed` dans le gabarit.
      await vi.waitFor(() => expect(backupService.getBackupStorage).toHaveBeenCalledTimes(2), { timeout: 10000 })
      await flushPromises()

      expect(w.find(PROMPT).exists()).toBe(false)
    })

    it("ne fait pas réapparaître un bandeau déjà résolu (décision déjà prise pour ce dossier)", async () => {
      backupService.getBackupStorage.mockResolvedValue({})
      backupService.getBackupPermissionOk.mockResolvedValue(true)
      restore.hasBackup.mockResolvedValue(true)
      backupDecision.hasBackupDecision.mockResolvedValue(true) // décision déjà prise

      const w = mountAppWithOnboarding()
      await waitForInitialMaybeOfferRestoreToSettle()
      expect(w.find(PROMPT).exists()).toBe(false)

      await w.find('[data-test="close-onboarding"]').trigger('click')

      // Idem : la RE-évaluation doit avoir eu lieu, même si l'issue ne change pas.
      await vi.waitFor(() => expect(backupService.getBackupStorage).toHaveBeenCalledTimes(2), { timeout: 10000 })
      await flushPromises()

      expect(w.find(PROMPT).exists()).toBe(false)
    })
  })
})

// Le bon message gagne, identifié par son NOTICE, pas seulement « un dialogue s'affiche » :
// chaque `useNoticeSlot(id, wants)` demande et vérifie avec le MÊME `id`, donc un identifiant
// mal câblé mais seul en lice passe inaperçu. Seule une vraie compétition de rang le révèle.
// Deux blocs : versionGuard (rang 1) contre backupDecision (rang 3), puis backupDecision
// contre syncReport (rang 4), car le premier ne prouve que l'identifiant de versionGuard.
describe('App — la file des messages nomme le bon vainqueur (pas seulement « un dialogue s’affiche »)', () => {
  it('garde-fou de version ET bandeau de décision demandeurs ensemble : le garde-fou (rang 1) a la parole', async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(false)
    versionGuardState.triggered = true

    const w = mountApp()
    // `getBackupPermissionOk` est le DERNIER appel de `maybeOfferRestore()` avant qu'il n'écrive
    // `showBackupDecisionPrompt` : l'attendre puis vider les promesses prouve que l'évaluation
    // est terminée (`waitForInitialMaybeOfferRestoreToSettle` attend, lui, l'absence du bandeau).
    await vi.waitFor(() => expect(backupService.getBackupPermissionOk).toHaveBeenCalled(), { timeout: 10000 })
    await flushPromises()

    // PRÉCONDITION : les deux sont demandeurs EN MÊME TEMPS sur ce montage réel.
    const queue = useNoticeQueueStore()
    expect(queue.requesters).toEqual(expect.arrayContaining([NOTICE.VERSION_GUARD, NOTICE.BACKUP_DECISION]))

    // Le VAINQUEUR est NOMMÉ : le garde-fou (`ConfirmDialog`), et lui seul.
    expect(queue.active).toBe(NOTICE.VERSION_GUARD)
    expect(w.find('[data-test="confirm-ok"]').exists()).toBe(true)
    expect(w.find(PROMPT).exists()).toBe(false)
  })

  it('bandeau de décision ET rapport de synchro demandeurs ensemble : le bandeau (rang 3) a la parole', async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(false)

    const w = mountApp()
    await vi.waitFor(() => expect(w.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
    await flushPromises()

    // Le rapport de synchro (SyncReportDialog, monté par App.vue et non stubbé dans ce
    // fichier) devient à son tour demandeur : un rapport « à signaler » suffit (une seule
    // erreur, cf. classifySyncReport).
    useSyncReportStore().setReport({ errors: ['échec de fusion (fixture)'] })
    await flushPromises()

    // PRÉCONDITION : les deux sont bien demandeurs EN MÊME TEMPS.
    const queue = useNoticeQueueStore()
    expect(queue.requesters).toEqual(expect.arrayContaining([NOTICE.BACKUP_DECISION, NOTICE.SYNC_REPORT]))

    // Le VAINQUEUR est NOMMÉ : le bandeau (rang 3) continue de parler, le rapport (rang 4)
    // attend son tour — il ne s'affiche PAS tant que le bandeau est là.
    expect(queue.active).toBe(NOTICE.BACKUP_DECISION)
    expect(w.find(PROMPT).exists()).toBe(true)
    expect(w.find('[role="dialog"][aria-labelledby="srd-title"]').exists()).toBe(false)
  })
})

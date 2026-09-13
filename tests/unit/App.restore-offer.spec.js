// Composant — App.vue, proposition de la décision au lancement (revue, finding 1 ;
// SAF seul backend depuis lors ; avenant du 04/08/2026, étape 5 ; travaux du
// 06/08/2026) : `maybeOfferRestore` doit gater sur
// `getBackupPermissionOk` (dossier SAF désigné) ET sur `backupPauseReason` — le prédicat
// UNIQUE qui gouverne aussi l'arrêt des écritures. Il répond `'no-decision'` tant
// qu'aucune décision n'est prise pour ce dossier, ce qui est le critère que la plupart
// des tests ci-dessous pilotent encore via `hasBackupDecision`. `!onboarded` avait été
// retiré du critère par l'avenant (cf. `shouldOfferRestore`).
// vue-router mocké (RouterView stubbé) ; enfants lourds stubbés ; base Dexie réelle
// (fake-indexeddb) pour les stores Pinia — cf. tests/unit/ProjectDetailView.spec.js.
// `BackupDecisionPrompt` n'est PAS stubbé : ses comportements propres (buttons,
// messages, no-close) sont couverts en isolation dans
// tests/unit/backup-decision-prompt.spec.js — ici, on teste le WIRING (App.vue
// affiche/masque le bon composant selon le bon critère, et gate `runPatronMdSync`
// dessus).
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

// Garde de permission SAF (backup-service) — c'est CETTE garde que App.vue doit
// utiliser. `runBackup` est consommé par `BackupDecisionPrompt` (bouton « Repartir
// de zéro », non stubbé dans ce fichier) — mocké ici pour ne jamais toucher le
// plugin natif SAF réel.
const backupService = vi.hoisted(() => ({
  getBackupStorage: vi.fn(),
  getBackupPermissionOk: vi.fn(),
  runBackup: vi.fn(),
}))
vi.mock('@/backup/backup-service', () => backupService)

const restore = vi.hoisted(() => ({ hasBackup: vi.fn() }))
vi.mock('@/backup/restore', () => restore)

// Décision (avenant 04/08/2026) : consommée par App.vue (`maybeOfferRestore`) ET
// par `BackupDecisionPrompt` (bouton « Repartir de zéro », `recordBackupDecision`).
const backupDecision = vi.hoisted(() => ({
  hasBackupDecision: vi.fn(),
  recordBackupDecision: vi.fn(),
}))
vi.mock('@/backup/backup-decision', () => backupDecision)

// Fiche d'identité (travaux du 06/08/2026). App.vue n'interroge plus la décision
// directement : il demande à `backupPauseReason` (backup-pause.js, laissée RÉELLE ici,
// comme `shouldOfferRestore` — c'est la chaîne entière qui doit mordre) POURQUOI la
// sauvegarde est en pause, et ce prédicat consulte la fiche déposée dans le dossier.
// `'absent'` par défaut = sauvegarde écrite avant ces travaux, donc aucune suspension de ce
// chef : les tests ci-dessous gardent ainsi exactement le critère qu'ils décrivent
// (« une décision a-t-elle été prise ? »). Le mock est indispensable : sans lui, le vrai
// `readManifest` interrogerait le stockage factice `{}`, échouerait, et retomberait
// prudemment sur « un autre appareil » — le bandeau s'afficherait alors même dans les
// tests qui prouvent qu'il ne doit PAS s'afficher.
const manifest = vi.hoisted(() => ({ readManifest: vi.fn(async () => ({ state: 'absent' })) }))
vi.mock('@/backup/backup-manifest', () => manifest)

// `runRestore` seul est intercepté (première revue, finding 3) : `shouldOfferRestore`
// reste la VRAIE fonction (comme avant ce mock) — c'est elle qui doit rougir sous la
// contre-épreuve (remplacer son corps par `!!granted`, c'est-à-dire cesser de tenir
// compte de la raison de pause : les tests « ne s'affiche pas » ci-dessous passent alors
// au rouge). Depuis le 06/08, `backupPauseReason` est réelle elle aussi, pour la même
// raison : la chaîne entière doit mordre, pas seulement son dernier maillon.
const restoreServiceMock = vi.hoisted(() => ({ runRestore: vi.fn() }))
vi.mock('@/backup/restore-service', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, runRestore: restoreServiceMock.runRestore }
})

// Étape 4 : `OnboardingFolderPrompt` réel exige tout un autre bloc de
// mocks (saf-folder, designate-folder, restore-on-designate) hors du périmètre de
// CE fichier (déjà couverts en isolation par tests/unit/onboarding-folder-prompt.spec.js,
// contrat `closed` compris). Pour tester ICI seulement le WIRING d'App.vue sur cet
// événement — pas la logique interne du composant — on le remplace par un
// substitut minimal qui expose un bouton émettant `closed` sur commande.
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

// Étape 4 : variante SANS stub sur OnboardingFolderPrompt — laisse passer le
// substitut `vi.mock` ci-dessus, seul composant qui nous intéresse pour ces tests.
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
  // ⚠️ `mockReset()`, pas seulement `vi.clearAllMocks()` (qui vide les APPELS, pas les
  // implémentations) : `readManifest` était le seul mock hoisté de ce fichier à ne pas
  // être réinitialisé ici. Toute surcharge posée par un test fuirait vers les suivants et
  // ferait apparaître le rouge au mauvais endroit — le motif « défaut de fixture » que ce
  // lot a déjà produit huit fois.
  manifest.readManifest.mockReset().mockResolvedValue({ state: 'absent' })
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

// `versionGuardState` (src/db/version-guard.js) est un singleton de MODULE, pas un store
// Pinia — recréer Pinia dans `beforeEach` ne le réinitialise pas. Nécessaire dès qu'un
// test de ce fichier (bloc « file des messages » ci-dessous) le fait passer à `true` :
// sans ce nettoyage, il resterait vrai pour tous les tests suivants de CE fichier
// (isolation entre fichiers déjà assurée par Vitest, pas entre tests d'un même fichier).
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

  // Travaux du 06/08 : LA raison ajoutée par ces travaux doit ATTEINDRE le bandeau.
  // C'est le quatrième site du critère — la transmission par App.vue — et le seul qui
  // n'avait aucune garde : sans ce test, App.vue peut cesser de transmettre
  // `'other-device'` (écritures arrêtées, aucun bandeau, aucune issue) sans qu'AUCUN des
  // 4205 tests ne rougisse. Vérifié par mutation. Noter que `hasBackupDecision` vaut
  // `true` ici : c'est ce qui rend le test capable d'échouer, puisque l'ancien critère
  // (« aucune décision ») conclurait à l'absence de bandeau.
  it("s'affiche quand la décision est prise mais qu'un AUTRE appareil a écrit dans le dossier", async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(true)
    manifest.readManifest.mockResolvedValue({ state: 'ok', manifest: { appareil: 'ancien-telephone' } })

    const w = mountApp()

    await vi.waitFor(() => expect(w.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
  })

  // La raison ne doit pas seulement DÉCIDER de l'affichage, elle doit ARRIVER
  // jusqu'au bandeau (propriété `pause-reason`). Le test ci-dessus n'en prouve rien : le
  // bandeau s'afficherait à l'identique en annonçant « restaure d'abord » — le message
  // exactement faux, puisque restaurer ne réglerait pas un conflit à deux appareils.
  // Vérifié par mutation : retirer `:pause-reason` du gabarit d'App.vue fait rougir ce
  // test (le corps retombe alors sur `saf.backupPaused`), et lui seul.
  //
  // ⚠️ Comparé à `element.textContent`, jamais à `w.html()` : l'embellisseur de
  // @vue/test-utils réinsère des retours à la ligne dans les nœuds de texte longs, ce qui
  // tue silencieusement une assertion écrite contre le HTML (mesuré sur ce lot).
  // Et égalité COMPLÈTE, pas `toContain('autre appareil')` : la phrase d'origine affichée
  // juste en dessous contient elle aussi ces deux mots.
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

  // Le point central de l'avenant (§A.4 point 2) : le bandeau se propose MÊME
  // quand la base contient du travail réel — c'est celle qui a le plus à perdre à
  // ne rien sauvegarder. `empty`/le contenu de la base n'est plus un critère de
  // `shouldOfferRestore` du tout (cf. restore-service.js).
  it("s'affiche même quand la base contient du travail réel (ce n'est plus un critère)", async () => {
    await db.projects.add({ name: 'Un ouvrage bien réel', photos: [] })
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(false)

    const w = mountApp()

    await vi.waitFor(() => expect(w.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
  })

  // Câblage de la progression (première revue, finding 3 ; déplacée DANS le panneau
  // du bandeau à l'étape 2 — cf. BackupDecisionPrompt.vue, qui monte
  // désormais lui-même `<SyncProgressLine owner="app" />` sous ses boutons, App.vue
  // ne la monte plus du tout). Ce test exerce le VRAI template de
  // `BackupDecisionPrompt` (non stubbé) contre le VRAI appel
  // `beginSyncProgress('read', 'app')` qu'il fait lui-même — les deux chaînes `'app'`
  // doivent s'accorder pour que la barre apparaisse. Un test qui ne regarderait que
  // l'un des deux composants en isolation ne suffit PAS : c'est l'accord entre les
  // deux qui est le risque.
  //
  // Étape 2, garde contre l'assertion à vide (leçon déjà consignée sur ce projet :
  // « toBeVisible() est vrai hors du cadre photographié ») : `exists()` seul sur
  // `wrapper` prouverait la présence de la ligne QUELQUE PART dans le document, pas
  // qu'elle est dans le panneau du bandeau (recouverte par l'overlay, sous la ligne
  // de flottaison si elle était restée à la racine d'App.vue). On cherche donc
  // DANS l'élément du bandeau (`PROMPT`), jamais dans `wrapper` en entier.
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

  // Étape 4 (IMPORTANT) : `maybeOfferRestore()` ne tourne qu'UNE fois,
  // dans `onMounted`, AVANT que l'utilisatrice n'ait eu l'occasion de désigner un
  // dossier depuis `OnboardingFolderPrompt`. Si elle désigne un dossier PLEIN puis
  // refuse la restauration offerte à la désignation, aucune décision n'est posée —
  // sans le signal `closed`, rien ne le dirait avant le LANCEMENT SUIVANT.
  //
  // CAUSE RACINE (étape 2, à ne pas oublier au prochain test ajouté ici) :
  // l'`onMounted` d'App.vue enchaîne de nombreux `await` RÉELS (stores Pinia +
  // IndexedDB via fake-indexeddb : `patternsStore.load()`, `settingsStore.load()`,
  // `projectsStore.load()`, `requestPersistentStorage()`, `estimateStorage()`, …)
  // AVANT d'atteindre `maybeOfferRestore()`. Un seul `flushPromises()` (un unique
  // tick macrotâche) ne draine PAS cette chaîne : l'évaluation INITIALE de
  // `maybeOfferRestore()` reste encore en vol au moment où le corps du test
  // réécrivait les mocks. Elle retombait alors sur les NOUVEAUX mocks — le
  // bandeau apparaissait donc à cause de CETTE évaluation-là, pas de celle
  // déclenchée par le clic sur « Plus tard »/« Désigner maintenant ». Conséquence
  // mesurée deux fois en revue : retirer `@closed="..."` du gabarit
  // d'App.vue, ou retirer la ligne `trigger('click')` du test central, laissait
  // les 3 tests de ce bloc verts quand même.
  //
  // Le mécanisme lui-même est CORRECT (vérifié en laissant retomber l'évaluation
  // initiale avant de réécrire les mocks) — ne pas le changer. Le correctif est
  // ici, dans le test : `getBackupStorage` n'est appelé QUE depuis
  // `maybeOfferRestore()` sur ce chemin (`runPatronMdSync()` s'arrête avant, faute
  // de plateforme native en test) — attendre RÉELLEMENT son premier appel (pas un
  // `flushPromises()`) est donc la preuve que l'évaluation initiale a atteint son
  // seul point d'await observable, et `flushPromises()` juste après laisse
  // retomber sa continuation synchrone (`if (!storage) return false`).
  async function waitForInitialMaybeOfferRestoreToSettle() {
    await vi.waitFor(() => expect(backupService.getBackupStorage).toHaveBeenCalledTimes(1), { timeout: 10000 })
    await flushPromises()
  }

  describe('ré-évaluation après la fermeture de l\'invite de dossier (étape 4)', () => {
    it("le bandeau apparaît APRÈS la fermeture de l'invite, si un dossier avec sauvegarde existe désormais et qu'aucune décision n'a été prise", async () => {
      // État au tout premier appel de `maybeOfferRestore()` (onMounted) : aucun
      // dossier encore désigné — c'est justement pour ça que l'invite d'accueil
      // serait affichée sur un vrai appareil.
      backupService.getBackupStorage.mockResolvedValue(null)

      const w = mountAppWithOnboarding()
      // Attente RÉELLE que l'évaluation INITIALE soit retombée — cf. cause racine
      // ci-dessus. Sans elle, les mocks ci-dessous seraient réécrits PENDANT que
      // cette première évaluation est encore en vol.
      await waitForInitialMaybeOfferRestoreToSettle()
      expect(w.find(PROMPT).exists()).toBe(false)

      // Elle vient de désigner un dossier PLEIN depuis l'invite d'accueil et a
      // refusé le `window.confirm` de restauration (`maybeRestoreAfterDesignation`,
      // chemin 2 de la spec) : aucune décision posée, mais le dossier existe
      // désormais bel et bien.
      backupService.getBackupStorage.mockResolvedValue({})
      backupService.getBackupPermissionOk.mockResolvedValue(true)
      restore.hasBackup.mockResolvedValue(true)
      backupDecision.hasBackupDecision.mockResolvedValue(false)

      await w.find('[data-test="close-onboarding"]').trigger('click')

      // Preuve DIRECTE du câblage (pas seulement de l'issue) : `maybeOfferRestore()`
      // doit avoir été RE-appelé (2e appel à `getBackupStorage`) suite au clic —
      // sans quoi cette assertion resterait bloquée jusqu'au timeout, alors que
      // l'ancienne version du test restait verte même sans ce second appel.
      await vi.waitFor(() => expect(backupService.getBackupStorage).toHaveBeenCalledTimes(2), { timeout: 10000 })
      await vi.waitFor(() => expect(w.find(PROMPT).exists()).toBe(true), { timeout: 10000 })
    })

    it("le bandeau reste absent si, à la fermeture de l'invite, aucun dossier n'a finalement été désigné", async () => {
      backupService.getBackupStorage.mockResolvedValue(null)

      const w = mountAppWithOnboarding()
      await waitForInitialMaybeOfferRestoreToSettle()

      // « Plus tard » : rien n'a changé, `getBackupStorage` reste sans stockage.
      await w.find('[data-test="close-onboarding"]').trigger('click')

      // Preuve du câblage, INDÉPENDANTE de l'issue (qui serait « absent » de toute
      // façon, mock ou pas) : le clic doit bien RE-déclencher `maybeOfferRestore()`
      // (2e appel) — sans elle, ce test resterait vert même si `@closed` disparaissait
      // du gabarit d'App.vue.
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

      // Idem : preuve du câblage, indépendante de l'issue (décision déjà prise →
      // le bandeau reste absent, mais la RE-évaluation doit bien avoir eu lieu).
      await vi.waitFor(() => expect(backupService.getBackupStorage).toHaveBeenCalledTimes(2), { timeout: 10000 })
      await flushPromises()

      expect(w.find(PROMPT).exists()).toBe(false)
    })
  })
})

// Revue (défaut Important, 19/08/2026) : les tests de câblage existants
// vérifient TOUS « un dialogue s'affiche », jamais « CELUI QUI DOIT s'afficher, identifié
// par son identifiant NOTICE ». Le réviseur l'a démontré par mutation réelle — remplacer
// `NOTICE.VERSION_GUARD` par `NOTICE.SWIPE_HINT` (identifiant valide, mais faux) dans
// App.vue laisse les 7 fichiers de tests existants entièrement verts, parce qu'aucun ne
// fait concourir deux VRAIS demandeurs sur un montage réel d'App.vue en nommant le
// vainqueur attendu. Chaque `useNoticeSlot(id, wants)` utilise le MÊME `id` pour demander
// ET pour vérifier qui a la parole (`queue.active === id`) : un identifiant mal câblé mais
// SEUL en lice reste donc invisible à toute assertion qui se contente de compter les
// dialogues — il ne se révèle que par une VRAIE compétition de rang, comme la paire 1 de
// `tests/unit/notice-queue-paires.spec.js`, ici rejouée sur un montage réel d'App.vue.
//
// Deux blocs, un par identifiant du niveau application touché par cette relecture :
//   - versionGuard (rang 1) contre backupDecision (rang 3, déjà monté par ce fichier) ;
//   - backupDecision (rang 3) contre syncReport (rang 4, monté par App.vue mais jamais
//     sollicité par les tests de ce fichier) — nécessaire car le premier bloc, à lui seul,
//     ne prouve QUE l'identifiant de versionGuard : si c'est backupDecision qui était mal
//     câblé (ex. vers un rang plus FAIBLE que 1), il perdrait quand même contre versionGuard,
//     pour la mauvaise raison, et le test resterait vert.
describe('App — la file des messages nomme le bon vainqueur (pas seulement « un dialogue s’affiche »)', () => {
  it('garde-fou de version ET bandeau de décision demandeurs ensemble : le garde-fou (rang 1) a la parole', async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    restore.hasBackup.mockResolvedValue(true)
    backupDecision.hasBackupDecision.mockResolvedValue(false)
    versionGuardState.triggered = true

    const w = mountApp()
    // Marqueur du DERNIER appel de la chaîne `maybeOfferRestore()` avant qu'elle n'écrive
    // `showBackupDecisionPrompt.value` (cf. App.vue) : attendre CET appel, puis laisser
    // retomber sa continuation synchrone, est la preuve que l'évaluation a atteint son terme
    // — pas seulement démarré (même motif que `waitForInitialMaybeOfferRestoreToSettle`
    // plus haut dans ce fichier, qui ne peut pas servir ici car il attend l'ABSENCE du
    // bandeau).
    await vi.waitFor(() => expect(backupService.getBackupPermissionOk).toHaveBeenCalled(), { timeout: 10000 })
    await flushPromises()

    // PRÉCONDITION : les deux sont bien demandeurs EN MÊME TEMPS sur ce montage réel — pas
    // juste « le garde-fou est déclenché » d'un côté et « le bandeau est prêt » de l'autre.
    const queue = useNoticeQueueStore()
    expect(queue.requesters).toEqual(expect.arrayContaining([NOTICE.VERSION_GUARD, NOTICE.BACKUP_DECISION]))

    // Le VAINQUEUR est NOMMÉ, pas seulement « un dialogue est là » : c'est le garde-fou
    // (`ConfirmDialog`, data-test="confirm-ok"), et lui SEUL — le bandeau ne s'affiche pas.
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

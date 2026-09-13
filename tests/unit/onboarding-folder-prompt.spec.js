// Unitaire — LA PORTE du dossier (lot « premier lancement simplifié », 09/08/2026).
// Remplace l'ancienne invite non bloquante : plus de « Plus tard », plus d'Échap.
// Elle n'apparaît qu'APRÈS l'écran de bienvenue (`onboarded` persisté) — avant ce lot
// elle s'affichait PAR-DESSUS, avant qu'on ait vu ce qu'est l'app.
//
// CORRECTIF (revue, 09/08) : le composant est monté UNE SEULE FOIS par App.vue, jamais
// remonté quand l'écran de bienvenue se termine (navigation interne). Le bloc « la porte
// apparaît sans remontage » ci-dessous prouve que `settingsStore.onboarded` passant de
// faux à vrai EN COURS DE SESSION rouvre l'évaluation — sans quoi le tout premier
// lancement se déroulait entièrement sans jamais voir la porte.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { useSettingsStore } from '@/stores/settings'

const {
  isNativePlatform, safFolder, designate, dbApi,
  backupService, restoreApi, restoreService, backupDecision,
} = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  safFolder: { hasFolder: vi.fn(), folderKey: vi.fn() },
  designate: { designateFolder: vi.fn() },
  dbApi: { getSetting: vi.fn(), setSetting: vi.fn() },
  backupService: { getBackupStorage: vi.fn(), runBackup: vi.fn() },
  restoreApi: { hasBackup: vi.fn() },
  restoreService: { runRestore: vi.fn(), shouldRestoreFromFolder: vi.fn(), isDbRestorable: vi.fn() },
  backupDecision: { clearBackupDecision: vi.fn(), recordBackupDecision: vi.fn() },
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform } }))
vi.mock('@/backup/saf-folder', () => safFolder)
vi.mock('@/backup/designate-folder', () => designate)
vi.mock('@/db/db', () => dbApi)
vi.mock('@/backup/backup-service', () => backupService)
vi.mock('@/backup/restore', () => restoreApi)
vi.mock('@/backup/restore-service', () => restoreService)
vi.mock('@/backup/backup-decision', () => backupDecision)

import OnboardingFolderPrompt from '@/components/OnboardingFolderPrompt.vue'
import RestoreErrorDialog from '@/components/RestoreErrorDialog.vue'
// Drapeau « dossier propre » (restore-guard.js) : module RÉEL (pur, sans
// dépendance, jamais mocké ici) — les assertions du bloc « écrasement du refus »
// portent sur son état de session, posé par `onRestoreDiscard` lui-même.
import { clearFolderClean, isFolderCleanSinceRestore } from '@/backup/restore-guard'
import { useNoticeQueueStore } from '@/stores/notice-queue'
import { useFolderChangeStore } from '@/stores/folder-change'
import { useSnackbarStore } from '@/stores/snackbar'
import { NOTICE } from '@/constants/notice-queue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
let wrapper
// Pinia RECRÉÉE à chaque test (beforeEach) — le composant appelle `useSettingsStore()` au
// setup, il lui faut donc un Pinia actif dès le montage. Un seul Pinia créé ET activé,
// puis passé tel quel au montage (cf. tests/unit/onboarding-view-onboarded-guard.spec.js) :
// sinon le composant résoudrait un store DIFFÉRENT de celui que les tests manipulent, et
// resterait vert (ou rouge) pour une mauvaise raison.
let pinia
let settingsStore
const mountIt = () => {
  wrapper = mount(OnboardingFolderPrompt, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
  return wrapper
}

// La porte lit DEUX réglages : `onboarded` (l'écran de bienvenue est-il passé ?) et rien
// d'autre. Ce helper évite qu'un `mockResolvedValue` global fasse répondre la même chose
// aux deux — le piège classique quand un composant lit plusieurs clés.
const settings = (map) => dbApi.getSetting.mockImplementation(async (k) => map[k])

beforeEach(() => {
  isNativePlatform.mockReset().mockReturnValue(true)
  safFolder.hasFolder.mockReset().mockResolvedValue(false)
  // Identité SAF par défaut : une URI stable — les tests du mode change
  // la réécrivent (Once) pour simuler un changement de dossier. `evaluate()` ne lit
  // pas `folderKey`, ce défaut est donc sans effet sur les tests du premier lancement.
  safFolder.folderKey.mockReset().mockResolvedValue('content://dossier-actuel')
  designate.designateFolder.mockReset()
  dbApi.getSetting.mockReset()
  dbApi.setSetting.mockReset().mockResolvedValue(undefined)
  settings({ onboarded: true })
  backupService.getBackupStorage.mockReset().mockResolvedValue(null)
  backupService.runBackup.mockReset().mockResolvedValue({ ok: true })
  restoreApi.hasBackup.mockResolvedValue(false)
  restoreService.runRestore.mockReset().mockResolvedValue({ ok: true })
  restoreService.isDbRestorable.mockReset().mockResolvedValue(false)
  restoreService.shouldRestoreFromFolder.mockReset()
    .mockImplementation(({ empty, hasBackup }) => !!empty && !!hasBackup)
  backupDecision.clearBackupDecision.mockReset().mockResolvedValue(undefined)
  backupDecision.recordBackupDecision.mockReset().mockResolvedValue(true)
  // Drapeau « dossier propre » : état de module mémoire — remis à zéro avant
  // CHAQUE test, sinon un `markFolderClean()` fuirait du test précédent dans le
  // suivant (même précaution que backup-restore-service.spec.js).
  clearFolderClean()
  pinia = createPinia()
  setActivePinia(pinia)
  // Le verrou de défilement s'écrit sur `document.body`, partagé par tout le fichier : sans
  // cette remise à zéro, un test hériterait de l'état laissé par le précédent.
  document.body.style.overflow = ''
  settingsStore = useSettingsStore() // `onboarded` par defaut a `false` — jamais chargé (`.load()` non appelé) sauf test dédié
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('quand la porte s\'affiche', () => {
  it('s\'affiche : natif, onboarding fini, aucun dossier', async () => {
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })

  it('PAS avant la fin de l\'écran de bienvenue', async () => {
    settings({ onboarded: false })
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('PAS si un dossier est déjà désigné (les 3 appareils d\'aujourd\'hui)', async () => {
    safFolder.hasFolder.mockResolvedValue(true)
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('PAS hors plateforme native (web, dev, e2e)', async () => {
    isNativePlatform.mockReturnValue(false)
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  // `safOnboardingSeen` gouvernait l'ancienne invite. La porte ne le lit plus : une
  // utilisatrice ayant répondu « Plus tard » AVANT ce lot doit voir la porte.
  it('ignore l\'ancien réglage safOnboardingSeen', async () => {
    settings({ onboarded: true, safOnboardingSeen: true })
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })
})

describe('aucune échappatoire', () => {
  it('n\'a pas de bouton « Plus tard »', async () => {
    const w = mountIt()
    await flushPromises()
    expect(w.find('[data-test="later"]').exists()).toBe(false)
  })

  it('Échap ne la ferme pas', async () => {
    const w = mountIt()
    await flushPromises()
    await w.find('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })
})

describe('désignation', () => {
  // La modale maison (LocalRestoreOffer) a remplacé le `window.confirm` natif :
  // après une désignation qui découvre des données, l'offre s'affiche et attend
  // un geste — « Restaurer » enchaîne runRestore (l'ancien OK) ; le refus, bouton
  // « Perdre les données », passe par la confirmation DE LA MODALE puis
  // fait exécuter l'écrasement par la porte. Dans les DEUX cas la porte finit fermée.
  it('appelle designateFolder, efface la décision, propose la récupération, émet closed', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    backupService.getBackupStorage.mockResolvedValue({})
    restoreApi.hasBackup.mockResolvedValue(true)
    restoreService.isDbRestorable.mockResolvedValue(true)

    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()

    // L'offre de restauration locale est À L'ÉCRAN, en attente d'un geste.
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(true)
    expect(w.emitted('closed')).toBeFalsy()

    await w.find('[data-test="local-restore-accept"]').trigger('click')
    await flushPromises()

    expect(designate.designateFolder).toHaveBeenCalled()
    expect(backupDecision.clearBackupDecision).toHaveBeenCalled()
    expect(restoreService.runRestore).toHaveBeenCalled()
    expect(w.emitted('closed')).toBeTruthy()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  // Décision produit du 05/09 : le refus n'est plus un « Plus tard » qui
  // ne fait rien, mais « Perdre les données » — confirmé dans la modale, puis
  // exécuté par la porte comme « Repartir de zéro » : runBackup EN ÉCRASEMENT (la
  // seule porte de la garde anti-écrasement) PUIS recordBackupDecision — c'est ce
  // qui écarte l'offre DÉFINITIVEMENT (poser la décision sans écraser laisserait la
  // pause rouvrir le bandeau, cf. backup-pause.js).
  it('refus confirmé (« Perdre les données ») : écrase le dossier, pose la décision, referme la porte — APRÈS l\'opération', async () => {
    designationDossierPlein()
    // Écriture tenue OUVERTE (promesse contrôlée) : chaque assertion observe un
    // instant PRÉCIS de l'ordre — l'offre refermée pendant l'écriture, la porte
    // encore retenue, la décision posée après une écriture réussie.
    let resolveBackup
    backupService.runBackup.mockReturnValue(new Promise((r) => { resolveBackup = r }))

    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(true)

    // Le bouton n'émet pas directement : la modale demande une confirmation
    // (ConfirmDialog maison), et rien n'est lancé tant qu'elle n'est pas assumée.
    await w.find('[data-test="local-restore-decline"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="confirm-ok"]').exists()).toBe(true)
    expect(backupService.runBackup).not.toHaveBeenCalled()

    await w.find('[data-test="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(backupService.runBackup).toHaveBeenCalledWith(
      expect.objectContaining({ overwriteBackup: true }),
    )
    // L'offre est refermée PENDANT l'écriture (la progression de la porte est l'écran)…
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(false)
    // …mais la porte est encore retenue par la promesse : pas de `closed` avant la fin.
    expect(w.emitted('closed')).toBeFalsy()

    resolveBackup({ ok: true })
    await flushPromises()
    // Décision posée APRÈS une écriture réussie, jamais avant ni sur échec.
    expect(backupDecision.recordBackupDecision).toHaveBeenCalledTimes(1)
    expect(w.emitted('closed')).toBeTruthy()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    // Vocabulaire DÉDIÉ au refus (décision produit du 05/09 : dans ce flux, jamais
    // « sauvegarde », on parle d'enregistrement des données de Rowtine) — PAS
    // saf.syncDone, qui reste le message de « Repartir de zéro ».
    expect(useSnackbarStore().message).toBe(i18n.global.t('restore.discardDone'))
  })

  it('refus : la confirmation annulée ne détruit rien et rouvre pas la porte', async () => {
    designationDossierPlein()
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="local-restore-decline"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="confirm-cancel"]').trigger('click')
    await flushPromises()
    // Annuler : aucune écriture, aucune décision, et l'offre reste le message.
    expect(backupService.runBackup).not.toHaveBeenCalled()
    expect(backupDecision.recordBackupDecision).not.toHaveBeenCalled()
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(true)
    expect(w.emitted('closed')).toBeFalsy()
  })

  // RETOMBÉE SUR ÉCHEC (permission perdue, E/S) : aucune décision posée — la porte
  // se referme quand même et App ré-évalue l'offre à la fermeture
  // (`onOnboardingFolderPromptClosed`) : le bandeau « Des données t'attendent »
  // revient avec des boutons agissants. Ce dernier maillon est prouvé côté App.vue
  // (tests/unit/App.restore-offer.spec.js, bloc « ré-évaluation après la fermeture
  // de l'invite ») : ici on prouve les DEUX préconditions — pas de décision, porte
  // refermée.
  it('échec de l\'écrasement du refus : aucune décision posée, la porte se ferme quand même', async () => {
    designationDossierPlein()
    backupService.runBackup.mockResolvedValue({ ok: false, skipped: 'permission' })

    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="local-restore-decline"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="confirm-ok"]').trigger('click')
    await flushPromises()

    expect(backupDecision.recordBackupDecision).not.toHaveBeenCalled()
    expect(w.emitted('closed')).toBeTruthy()
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(false)
    // L'échec est DIT, avec le même message que « Repartir de zéro ».
    expect(useSnackbarStore().message).toBe(i18n.global.t('saf.syncFailedPermission'))
  })

  // ─── Drapeau « dossier propre » après l'écrasement du refus ──────
  //
  // CE QUE CE DRAPEAU FERME ICI. L'écrasement réussi met le dossier et la base en
  // image l'un de l'autre — la MÊME situation que la fin d'une restauration réussie,
  // où restore-service.js pose déjà `markFolderClean()` pour tuer le passage auto
  // (~255 s de requêtes SAF mesurées sur Nexus 7 dans le scénario symétrique). Le tir
  // d'auto-backup que `recordBackupDecision` arme relirait sinon un dossier identique
  // pour rien. Le skip lui-même (callRunBackup consulte le drapeau) est prouvé dans
  // tests/unit/auto-backup.spec.js ; ce fichier prouve que le refus POSÉ le drapeau,
  // aux MÊMES conditions que la restauration.
  it('écrasement réussi du refus : pose le drapeau « dossier propre », APRÈS la décision', async () => {
    designationDossierPlein()
    // Comme le VRAI `recordBackupDecision` (son `setSetting` passe par le hook Dexie
    // de db.js, qui efface le drapeau à toute mutation) : simuler cet effacement
    // rend l'ORDRE observable — posé AVANT la décision, le drapeau serait effacé
    // aussitôt et le tir auto relirait tout le dossier (le bug visé, intact).
    backupDecision.recordBackupDecision.mockImplementation(async () => {
      clearFolderClean()
      return true
    })

    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="local-restore-decline"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="confirm-ok"]').trigger('click')
    await flushPromises()

    expect(backupDecision.recordBackupDecision).toHaveBeenCalledTimes(1)
    // Survit à l'effacement simulé par la décision : il a donc été posé APRÈS elle
    // (placement exact de restore-service.js) — le tir auto post-refus se taira.
    expect(isFolderCleanSinceRestore()).toBe(true)
  })

  // Seul un écrasement allé au bout met dossier et base en miroir : un échec
  // (permission perdue, E/S) laisse le dossier POTENTIELLEMENT divergent — le
  // drapeau y est interdit, les passages automatiques restent nécessaires.
  it('échec de l\'écrasement du refus : le drapeau « dossier propre » n\'est PAS posé', async () => {
    designationDossierPlein()
    backupService.runBackup.mockResolvedValue({ ok: false, skipped: 'permission' })

    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="local-restore-decline"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="confirm-ok"]').trigger('click')
    await flushPromises()

    expect(backupDecision.recordBackupDecision).not.toHaveBeenCalled()
    expect(isFolderCleanSinceRestore()).toBe(false)
  })

  it('persiste le chemin affiché (safFolderLabel)', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(dbApi.setSetting).toHaveBeenCalledWith('safFolderLabel', 'Documents/Rowtine')
  })

  it('libellé absent : n\'écrit PAS safFolderLabel (plutôt que d\'écrire null)', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: null })
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    const calls = dbApi.setSetting.mock.calls.filter(([k]) => k === 'safFolderLabel')
    expect(calls).toEqual([])
  })

  it('sélecteur annulé : la porte RESTE, bouton réactivé, aucun closed', async () => {
    designate.designateFolder.mockResolvedValue({ granted: false, label: null })
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.find('[data-test="choose-now"]').attributes('disabled')).toBeUndefined()
    expect(w.emitted('closed')).toBeFalsy()
  })

  // Avant ce lot, ce rejet partait dans le vide : promesse rejetée silencieuse.
  it('désignation qui rejette : message affiché, bouton réactivé, porte intacte', async () => {
    designate.designateFolder.mockRejectedValue(new Error('création du dossier Rowtine impossible'))
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="designate-error"]').exists()).toBe(true)
    expect(w.find('[data-test="choose-now"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.emitted('closed')).toBeFalsy()
  })

  it('un second essai efface le message d\'erreur précédent', async () => {
    designate.designateFolder.mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ granted: false, label: null })
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="designate-error"]').exists()).toBe(true)
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="designate-error"]').exists()).toBe(false)
  })

  // Ce test mocke `isDbRestorable` à `true` : il ne prouve donc PAS qu'une base semée
  // (exemples de l'écran de bienvenue) est réellement restaurable — ça, c'est
  // tests/unit/onboarding-seed-wiring.spec.js:89 qui le prouve, sur une vraie base
  // semée, sans prédicat stubé. Ce qui est prouvé ICI : le composant CONSULTE
  // `isDbRestorable` au bon moment et OBÉIT à son verdict (propose la récupération
  // quand il répond vrai). Le défaut du 04/08/2026 — la récupération jamais
  // proposée après le semis — se corrige dans `isDbRestorable`, pas ici ; garder ce
  // test sur le seul câblage évite de laisser croire que la garde vit dans ce fichier.
  it('consulte isDbRestorable et obéit à son verdict : vrai ⇒ récupération proposée', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    backupService.getBackupStorage.mockResolvedValue({})
    restoreApi.hasBackup.mockResolvedValue(true)
    restoreService.isDbRestorable.mockResolvedValue(true) // base « semis seul » = restaurable

    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()

    // « Proposée » = la modale maison est à l'écran, en attendant le geste.
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(true)

    await w.find('[data-test="local-restore-accept"]').trigger('click')
    await flushPromises()

    expect(restoreService.runRestore).toHaveBeenCalled()
  })

  // `maybeRestoreAfterDesignation` ne lève jamais (filet interne), mais si un jour elle
  // le faisait, la porte ne doit pas rester fermée sur un dossier pourtant désigné.
  it('échec de la récupération : la porte se ferme quand même', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    backupService.getBackupStorage.mockRejectedValue(new Error('E/S'))
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.emitted('closed')).toBeTruthy()
  })

  it('setSetting qui lève : la porte se ferme quand même', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    dbApi.setSetting.mockRejectedValue(new Error('base illisible'))
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.emitted('closed')).toBeTruthy()
  })

  // CORRECTIF (lot « ordre des pop-ups », 10/08/2026) : deux pop-ups contradictoires
  // s'affichaient en même temps au premier lancement (cette porte ET la bienvenue de
  // l'accueil). C'est désormais ICI que `welcomeDue` se pose, pas dans `completeOnboarding()`
  // — cf. tests/unit/settings-welcome-due.spec.js.
  it('pose welcomeDue à vrai après une désignation réussie, AVANT la récupération éventuelle', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    backupService.getBackupStorage.mockResolvedValue({})
    restoreApi.hasBackup.mockResolvedValue(true)
    restoreService.isDbRestorable.mockResolvedValue(true)

    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="local-restore-accept"]').trigger('click')
    await flushPromises()

    expect(settingsStore.welcomeDue).toBe(true)
    const welcomeDueCallIndex = dbApi.setSetting.mock.calls.findIndex(([k, v]) => k === 'welcomeDue' && v === true)
    expect(welcomeDueCallIndex).toBeGreaterThanOrEqual(0)
    // ORDRE, pas seulement présence : posé AVANT `runRestore` (qui peut réécrire toute la
    // base, réglages compris) — jamais après. Une utilisatrice qui retrouve ses données
    // depuis une sauvegarde ne doit jamais voir « Tout est en place pour commencer ».
    expect(restoreService.runRestore).toHaveBeenCalled()
    const welcomeDueCallOrder = dbApi.setSetting.mock.invocationCallOrder[welcomeDueCallIndex]
    const restoreCallOrder = restoreService.runRestore.mock.invocationCallOrder[0]
    expect(welcomeDueCallOrder).toBeLessThan(restoreCallOrder)

    // Même garantie pour `importCaveatDue` (lot du 19/08/2026) : posé dans le MÊME bloc de
    // code, au bloc `try` séparé qui suit celui de `welcomeDue` — cf. le commentaire à cet
    // appel dans OnboardingFolderPrompt.vue.
    expect(settingsStore.importCaveatDue).toBe(true)
    const importCaveatDueCallIndex = dbApi.setSetting.mock.calls
      .findIndex(([k, v]) => k === 'importCaveatDue' && v === true)
    expect(importCaveatDueCallIndex).toBeGreaterThanOrEqual(0)
    const importCaveatDueCallOrder = dbApi.setSetting.mock.invocationCallOrder[importCaveatDueCallIndex]
    expect(importCaveatDueCallOrder).toBeLessThan(restoreCallOrder)
  })

  it('sélecteur annulé : ne pose PAS welcomeDue', async () => {
    designate.designateFolder.mockResolvedValue({ granted: false, label: null })
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(settingsStore.welcomeDue).toBe(false)
    expect(dbApi.setSetting.mock.calls.some(([k]) => k === 'welcomeDue')).toBe(false)
  })

  it('double appui : une seule désignation', async () => {
    let resolve
    designate.designateFolder.mockReturnValue(new Promise((r) => { resolve = r }))
    const w = mountIt()
    await flushPromises()
    const btn = w.find('[data-test="choose-now"]')
    await btn.trigger('click')
    await btn.trigger('click')
    expect(designate.designateFolder).toHaveBeenCalledTimes(1)
    resolve({ granted: false, label: null })
    await flushPromises()
  })
})

// Popup dossier pendant restauration : une fois le dossier désigné,
// la progression de restauration se peignait DANS le panneau de la porte pendant que
// le panneau continuait de demander un dossier (« Bienvenue ! … Choisis-en un » + le
// bouton, désactivé) — deux messages contradictoires lisibles en même temps. La règle
// des superpositions : la surface qui déclenche une opération de dossier RETIRE son
// invitation pendant l'opération (elle est périmée dès la désignation) ; le panneau ne
// montre alors que la ligne de progression, seule — ses libellés « Lecture… » /
// « Écriture… », dérivés de la phase réelle, SONT le message. La modale LocalRestoreOffer
// (z-index supérieur) reste, elle, le message tant qu'elle est ouverte.
describe('pendant l\'opération de dossier, la porte cesse de demander un dossier', () => {
  it('le panneau ne montre plus que la progression, avant même le geste dans l\'offre, et jusqu\'à la fermeture', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Dossier' })
    backupService.getBackupStorage.mockResolvedValue({})
    restoreApi.hasBackup.mockResolvedValue(true)
    restoreService.isDbRestorable.mockResolvedValue(true)
    // Restauration tenue OUVERTE (promesse contrôlée) : chaque assertion ci-dessous
    // observe l'écran PENDANT l'opération, jamais après son terme.
    let resolveRestore
    restoreService.runRestore.mockReturnValue(new Promise((r) => { resolveRestore = r }))

    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()

    // Le SCAN est déjà une opération : avant même le geste dans l'offre, le panneau
    // ne demande plus de dossier — ni titre, ni corps, ni bouton — et la progression
    // y est rendue. L'offre, au-dessus, est bien là : c'est elle le message en attente.
    expect(w.find('[data-test="choose-now"]').exists()).toBe(false)
    expect(w.find('.ofp__title').exists()).toBe(false)
    expect(w.find('.ofp__body').exists()).toBe(false)
    expect(w.find('[data-test="sync-progress"]').exists()).toBe(true)
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(true)

    // « Restaurer » referme l'offre mais pas l'opération : le panneau reste sur la
    // progression seule, l'invitation ne revient pas.
    await w.find('[data-test="local-restore-accept"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(false)
    expect(w.find('[data-test="choose-now"]').exists()).toBe(false)
    expect(w.find('.ofp__title').exists()).toBe(false)
    expect(w.find('[data-test="sync-progress"]').exists()).toBe(true)

    // Fin de l'opération : la porte conclut et disparaît — un seul message à tout
    // instant, du clic à la fermeture.
    resolveRestore({ ok: true })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(w.emitted('closed')).toBeTruthy()
  })

  // Pendant l'opération, les id `ofp-title`/`ofp-body` disparaissent du panneau :
  // l'overlay ne doit plus les référencer — des aria pendantes vers rien.
  it('l\'overlay ne porte plus aria-labelledby/aria-describedby pendant l\'opération', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Dossier' })
    backupService.getBackupStorage.mockResolvedValue({})
    restoreApi.hasBackup.mockResolvedValue(true)
    restoreService.isDbRestorable.mockResolvedValue(true)

    const w = mountIt()
    await flushPromises()
    // Hors opération, l'overlay nomme bien son titre et son corps (précondition :
    // le retrait est conditionnel, pas une disparition permanente).
    expect(w.find('.ofp-overlay').attributes('aria-labelledby')).toBe('ofp-title')
    expect(w.find('.ofp-overlay').attributes('aria-describedby')).toBe('ofp-body')

    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()

    expect(w.find('.ofp-overlay').attributes('aria-labelledby')).toBeUndefined()
    expect(w.find('.ofp-overlay').attributes('aria-describedby')).toBeUndefined()
  })
})

// ─── Décision produit du 05/09/2026 : LE MODE CHANGE ────────────────────
// La porte ouverte depuis les Réglages (`openForChange`, via le pont
// stores/folder-change.js) : sans les gardes du premier lancement, annulation qui
// referme sans conclure, acquittement préservé si le dossier ré-désigné est le MÊME,
// drapeaux d'installation intacts. Les textes du premier lancement (« Bienvenue ! »)
// y sont remplacés par les textes dédiés `safOnboarding.changeTitle`/`changeBody`.
describe('mode change : la porte ouverte depuis les Réglages', () => {
  beforeEach(() => {
    // Dans tout ce bloc, un dossier est DÉSIGNÉ (c'est la situation des Réglages) :
    // la porte ne s'ouvre donc JAMAIS d'elle-même au montage — chaque test l'ouvre
    // explicitement via `openForChange()`.
    safFolder.hasFolder.mockResolvedValue(true)
  })

  const ouvreEnModeChange = async (w) => {
    w.vm.openForChange()
    await flushPromises()
  }

  it('openForChange ouvre SANS les gardes : porte visible, textes du mode change', async () => {
    const w = mountIt() // hasFolder vrai + accueil fini : rien ne s'ouvre au montage
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    await ouvreEnModeChange(w)

    expect(w.find('[role="dialog"]').exists()).toBe(true)
    // Titre et corps dédiés — les textes du premier lancement mentiraient ici.
    expect(w.find('.ofp__title').text()).toBe(fr.safOnboarding.changeTitle)
    expect(w.find('.ofp__body').text()).toBe(fr.safOnboarding.changeBody)
  })

  it('s\'ouvre même APRÈS une désignation déjà conclue (openForChange ignore concluded)', async () => {
    safFolder.hasFolder.mockResolvedValue(false) // premier lancement : la porte s'ouvre d'elle-même
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false) // hide() a posé `concluded`

    safFolder.hasFolder.mockResolvedValue(true) // retour des Réglages, dossier en place
    await ouvreEnModeChange(w)
    expect(w.find('[role="dialog"]').exists()).toBe(true) // le geste explicite passe les gardes
  })

  it('sélecteur annulé : REFERME la porte, sans message, sans closed', async () => {
    const w = mountIt()
    await flushPromises()
    await ouvreEnModeChange(w)
    designate.designateFolder.mockResolvedValue({ granted: false, label: null })

    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()

    // Annuler n'est pas une erreur : on est refermé, proprement.
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(w.find('[data-test="designate-error"]').exists()).toBe(false)
    expect(w.emitted('closed')).toBeFalsy()
  })

  // 06/09/2026, demande produit : un bouton Annuler VISIBLE pour abandonner le
  // changement — le même geste que l'annulation du sélecteur, mais sans dépendre
  // du bouton retour du téléphone (cf. `closeFromBack`).
  it('bouton Annuler : referme la porte sans conclure, Réglages prévenus', async () => {
    const w = mountIt()
    await flushPromises()
    await ouvreEnModeChange(w)
    expect(w.find('[data-test="change-cancel"]').exists()).toBe(true)

    await w.find('[data-test="change-cancel"]').trigger('click')
    await flushPromises()

    // Le MÊME chemin que l'annulation du sélecteur : refermée, sans message,
    // sans `closed` (rien n'a changé, App n'a rien à relire), et le compteur du
    // pont a bougé (les Réglages rechargent leur état même après une annulation).
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(w.find('[data-test="designate-error"]').exists()).toBe(false)
    expect(w.emitted('closed')).toBeFalsy()
    expect(useFolderChangeStore().closeCount).toBe(1)
    expect(backupDecision.clearBackupDecision).not.toHaveBeenCalled()
  })

  it('premier lancement : PAS de bouton Annuler (la porte reste sans issue, décision du 09/08)', async () => {
    safFolder.hasFolder.mockResolvedValue(false)
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.find('[data-test="change-cancel"]').exists()).toBe(false)
  })

  it('annulation ne pose PAS concluded : la porte se rallume si la permission saute ensuite', async () => {
    const w = mountIt()
    await flushPromises()
    await ouvreEnModeChange(w)
    designate.designateFolder.mockResolvedValue({ granted: false, label: null })
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    // La permission saute en cours de session : le watch de l'accueil re-déclenche
    // `evaluate()` (onboarded repasse par faux puis vrai, comme un rechargement du
    // store). Sans `concluded`, la porte doit se rallumer — c'est toute la
    // différence avec une fermeture qui conclut.
    safFolder.hasFolder.mockResolvedValue(false)
    settingsStore.onboarded = false
    await flushPromises()
    settingsStore.onboarded = true
    await flushPromises()

    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })

  it('ré-désignation du MÊME dossier : décision PRÉSERVÉE, fermeture normale qui conclut', async () => {
    // Même URI avant et après la désignation : c'est le même dossier.
    safFolder.folderKey.mockResolvedValue('content://memes-donnees')
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    const w = mountIt()
    await flushPromises()
    await ouvreEnModeChange(w)
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()

    // L'acquittement d'un dossier inchangé reste valable : l'effacer poserait une
    // pause « aucune décision » surprise et un bandeau bloquant pour rien, et
    // « Restaurer » y refuserait (garde not-empty). Décision documentée dans
    // OnboardingFolderPrompt.vue (lecture de `folderKey()` avant/après).
    expect(backupDecision.clearBackupDecision).not.toHaveBeenCalled()
    expect(w.emitted('closed')).toBeTruthy()
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    // Fermeture qui conclut : une désignation A réussi — la porte ne se rallume plus.
    settingsStore.onboarded = false
    await flushPromises()
    settingsStore.onboarded = true
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('dossier DIFFÉRENT : décision effacée, drapeaux d\'installation intacts', async () => {
    // Première lecture (avant désignation) : l'ancien dossier. Les suivantes : le nouveau.
    safFolder.folderKey.mockResolvedValueOnce('content://ancien').mockResolvedValue('content://nouveau')
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Autre/Rowtine' })
    const w = mountIt()
    await flushPromises()
    await ouvreEnModeChange(w)
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()

    expect(backupDecision.clearBackupDecision).toHaveBeenCalledTimes(1)
    expect(w.emitted('closed')).toBeTruthy()
    // ⚠️ En mode change, AUCUN drapeau d'installation : l'installation existe déjà,
    // welcomeDue/importCaveatDue ont été consommés ou pendent de leur acquittement —
    // ne rien poser n'efface rien (cf. le garde `mode === 'onboarding'`).
    expect(settingsStore.welcomeDue).toBe(false)
    expect(settingsStore.importCaveatDue).toBe(false)
    expect(dbApi.setSetting.mock.calls.some(([k]) => k === 'welcomeDue')).toBe(false)
    expect(dbApi.setSetting.mock.calls.some(([k]) => k === 'importCaveatDue')).toBe(false)
  })

  it('dossier différent PLEIN : l\'offre de restauration locale reste le message, puis la porte conclut', async () => {
    safFolder.folderKey.mockResolvedValueOnce('content://ancien').mockResolvedValue('content://nouveau')
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Sauvegardes/Rowtine' })
    backupService.getBackupStorage.mockResolvedValue({})
    restoreApi.hasBackup.mockResolvedValue(true)
    restoreService.isDbRestorable.mockResolvedValue(true)
    const w = mountIt()
    await flushPromises()
    await ouvreEnModeChange(w)
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()

    // Le flux d'origine est intact : base vide + sauvegarde trouvée ⇒ l'offre
    // (LocalRestoreOffer) s'affiche et retient la porte, closed pas encore émis.
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(true)
    expect(w.emitted('closed')).toBeFalsy()

    await w.find('[data-test="local-restore-accept"]').trigger('click')
    await flushPromises()
    expect(restoreService.runRestore).toHaveBeenCalled()
    expect(w.emitted('closed')).toBeTruthy()
  })

  it('closeFromBack referme sans conclure, sauf pendant une opération de dossier', async () => {
    safFolder.folderKey.mockResolvedValueOnce('content://ancien').mockResolvedValue('content://nouveau')
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Sauvegardes/Rowtine' })
    backupService.getBackupStorage.mockResolvedValue({})
    restoreApi.hasBackup.mockResolvedValue(true)
    restoreService.isDbRestorable.mockResolvedValue(true)
    const w = mountIt()
    await flushPromises()
    await ouvreEnModeChange(w)

    // Hors opération : le retour referme la porte, sans message ni closed.
    w.vm.closeFromBack()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(w.emitted('closed')).toBeFalsy()

    // On rouvre, et cette fois une offre de restauration attend un geste : le retour
    // ne doit PAS refermer la porte sous le flux (l'attente de la promesse retient
    // l'écran) — le geste est avalé sans effet, comme avant la correction A3.
    await ouvreEnModeChange(w)
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(true)
    w.vm.closeFromBack()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })

  it('closeFromBack hors mode change : ne referme PAS la porte du premier lancement', async () => {
    safFolder.hasFolder.mockResolvedValue(false) // porte du premier lancement, auto-ouverte
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)

    // En production, folderGateHandlesBack n'appelle closeFromBack qu'en mode change ;
    // la porte se défend quand même si on l'appelle ailleurs — la sortie du premier
    // lancement reste le retour qui QUITTE l'app, jamais une refermeture silencieuse.
    w.vm.closeFromBack()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })
})

// CORRECTIF (revue, 09/08) : `OnboardingFolderPrompt` est monté UNE SEULE FOIS par
// App.vue, en frère de `<RouterView/>` — il n'est jamais démonté/remonté quand l'écran de
// bienvenue se termine (navigation interne). Un `onMounted` seul ne voit `onboarded` qu'à
// l'instant du lancement : sur un appareil vierge, l'accueil n'est pas encore fini à cet
// instant, donc la porte ne s'affichait JAMAIS au tout premier lancement — seulement au
// redémarrage suivant. Les tests ci-dessus, qui montent tous avec `onboarded` déjà vrai,
// ne pouvaient pas voir ce défaut : ils simulent un second lancement, jamais le premier.
describe('la porte apparaît sans remontage, quand l\'accueil se termine en cours de session', () => {
  it('onboarded passe de faux à vrai APRÈS le montage : la porte apparaît (sans remonter le composant)', async () => {
    settings({ onboarded: false }) // au montage : l'accueil n'est pas encore fini
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    // `completeOnboarding()` (src/stores/settings.js:77) passe `onboarded` à `true` de
    // façon réactive, avant même d'avoir fini de persister — on simule cette même
    // mutation directement sur le store, SANS jamais remonter le composant.
    settingsStore.onboarded = true
    await flushPromises()

    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })

  it('ne rallume jamais la porte après une désignation réussie, même si onboarded change ensuite', async () => {
    settings({ onboarded: true }) // porte visible dès le montage
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    const w = mountIt()
    await flushPromises()
    await w.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false) // désignation réussie : porte fermée

    // Le store finit de charger (ou se met à jour) APRÈS la désignation — ne doit
    // jamais rouvrir une porte qui a déjà rempli son rôle pour cette session.
    settingsStore.onboarded = true
    await flushPromises()

    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('getSetting("onboarded") qui rejette au montage : la porte reste éteinte, le montage ne casse pas', async () => {
    dbApi.getSetting.mockReset().mockRejectedValue(new Error('base illisible'))
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  // Deuxième point d'entrée d'`evaluate()` : le `watch` sur `settingsStore.onboarded`
  // appelle `evaluate(true)` en tir-et-oublie (pas d'`await` côté appelant). Un rejet de
  // `hasFolder()` ici (plugin natif en échec, permission perdue, E/S) doit être avalé au
  // même titre que le `getSetting` du montage — sinon promesse rejetée non gérée.
  it('hasFolder() qui rejette pendant l\'évaluation déclenchée par le watch : la porte reste éteinte, aucun rejet non géré', async () => {
    settings({ onboarded: false }) // au montage : onboarded faux, hasFolder() jamais appelée
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    safFolder.hasFolder.mockReset().mockRejectedValue(new Error('E/S native'))
    settingsStore.onboarded = true // déclenche le watch → evaluate(true) → hasFolder() rejette
    await flushPromises()

    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })
})

// Revue du 19/08/2026, important 5 (même forme que celle mesurée sur
// `SyncReportDialog`, traitée de la même main). Le correctif a fait passer le RENDU de la
// porte sur `hasSlot` (la file des messages) mais a laissé le verrou de défilement calé sur
// `visible`, sa condition propre : retenue derrière le garde-fou de version (rang 1), la
// porte verrouillait le fond sans que rien ne soit peint.
describe('le verrou de défilement suit la FILE, pas la seule condition propre', () => {
  it('retenue par un message plus fort : le fond N EST PAS verrouillé, il l est quand la porte apparaît', async () => {
    const q = useNoticeQueueStore()
    q.request(NOTICE.VERSION_GUARD) // rang 1 : le seul plus fort que la porte

    const w = mountIt()
    await flushPromises()

    // PRÉCONDITION : la porte VEUT l'écran (natif, accueil fini, aucun dossier — cf.
    // beforeEach) mais un plus fort le tient, et rien n'est peint.
    expect(q.requesters).toContain(NOTICE.FOLDER_GATE)
    expect(q.active).toBe(NOTICE.VERSION_GUARD)
    expect(w.find('[role="dialog"]').exists()).toBe(false)

    expect(document.body.style.overflow).toBe('')

    q.withdraw(NOTICE.VERSION_GUARD)
    await flushPromises()

    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
  })
})

// ─── Décision produit du 05/09/2026 : publication du compte rendu ───────
//
// AVANT ce lot, `onChooseNow` ne lisait PAS la valeur de retour de
// `maybeRestoreAfterDesignation` : une restauration qui échouait (erreur de garde
// E/S, JSON corrompu, échec interne de `runRestore`) passait TOTALEMENT inaperçue
// sur le chemin du téléphone neuf. Désormais, chaque incident est publié au store
// `restore-error` (consommé par RestoreErrorDialog, montée dans App.vue) AVANT
// `hide()` — la modale survit à la porte, mais le rapport doit exister dès que
// l'écran bouge. On teste le WIRING de publication ; les variations du contrat du
// helper lui-même sont couvertes par tests/unit/restore-on-designate.spec.js.
import { h, defineComponent, ref as vueRef } from 'vue'
import { useRestoreErrorStore } from '@/stores/restore-error'

// Hôte minimal : la seule façon d'observer l'ORDRE « publication PUIS closed » est
// d'écouter l'émission `closed` pendant qu'on espionne `setReport` — Vue 3 n'a plus
// `$on`, donc on monte la porte dans un parent qui note l'événement (render
// function : pas de compilation de template en test).
const mountWithClosedLog = async () => {
  const ordre = []
  // Espion sur la publication : note « publié » dans le MÊME journal que
  // l'émission `closed`, pour prouver l'ORDRE (publication avant hide()).
  const store = useRestoreErrorStore()
  vi.spyOn(store, 'setReport').mockImplementation((r) => {
    ordre.push('publié')
    return store.$patch({ report: r })
  })
  const Host = defineComponent({
    setup() {
      const gate = vueRef(null)
      return () => h(OnboardingFolderPrompt, { ref: gate, onClosed: () => ordre.push('closed') })
    },
  })
  const host = mount(Host, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
  await flushPromises() // le onMounted de la porte est async : mêmes attentes que mountIt
  return { host, ordre, store }
}

// Scénario complet de désignation d'un dossier PLEIN : porte → « Choisir » →
// désignation réussie → garde passante → offre → « Restaurer » → runRestore.
const designationDossierPlein = (label = 'Documents/Rowtine') => {
  designate.designateFolder.mockResolvedValue({ granted: true, label })
  backupService.getBackupStorage.mockResolvedValue({})
  restoreApi.hasBackup.mockResolvedValue(true)
  restoreService.isDbRestorable.mockResolvedValue(true)
}

const accepteLOffre = async (w) => {
  await w.find('[data-test="choose-now"]').trigger('click')
  await flushPromises()
  await w.find('[data-test="local-restore-accept"]').trigger('click')
  await flushPromises()
}

describe('publication de l’incident de restauration au store restore-error', () => {
  it('runRestore échoue ({ ok:false, error }) → modale error publiée, avec le libellé du dossier', async () => {
    designationDossierPlein()
    restoreService.runRestore.mockResolvedValue({ ok: false, error: 'JSON corrompu' })
    const { host, ordre } = await mountWithClosedLog()
    const store = useRestoreErrorStore()

    await accepteLOffre(host)

    expect(store.report).toMatchObject({ kind: 'error', error: 'JSON corrompu', path: 'Documents/Rowtine' })
    expect(store.report.at).toBeTruthy()
    // ORDRE : la publication PRÉCÈDE `hide()` — la modale vit dans App.vue, mais le
    // rapport doit exister dès que l'émission `closed` déclenche les réévaluations.
    expect(ordre).toEqual(['publié', 'closed'])
  })

  it('erreur de GARDE (getBackupStorage rejette) → modale error, et la porte se ferme quand même', async () => {
    designate.designateFolder.mockResolvedValue({ granted: true, label: 'Documents/Rowtine' })
    backupService.getBackupStorage.mockRejectedValue(new Error('E/S'))
    const { host, ordre } = await mountWithClosedLog()
    const store = useRestoreErrorStore()

    await host.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()

    expect(store.report).toMatchObject({ kind: 'error', error: 'E/S', path: 'Documents/Rowtine' })
    // ORDRE identique au cas runRestore : publié avant hide(). Et l'entrée
    // 'closed' du journal prouve que la porte a conclu son flux — une erreur de
    // garde n'empêche JAMAIS l'appelant de conclure.
    expect(ordre).toEqual(['publié', 'closed'])
  })

  it('runRestore renvoie { ok:true, owned:false } → modale unowned (les écarts rejoignent le rapport)', async () => {
    designationDossierPlein()
    const ecarts = [{ where: 'Patrons/x [9]', code: 'ENTITY_REJECTED' }]
    restoreService.runRestore.mockResolvedValue({ ok: true, decided: true, owned: false, errors: ecarts })
    const { host } = await mountWithClosedLog()
    const store = useRestoreErrorStore()

    await accepteLOffre(host)

    expect(store.report).toMatchObject({ kind: 'unowned', error: null, path: 'Documents/Rowtine' })
    expect(store.report.details).toStrictEqual(ecarts)
  })

  it('refus de l’offre (« Perdre les données », confirmé) : aucune publication — un refus n’est pas un incident', async () => {
    designationDossierPlein()
    const { host } = await mountWithClosedLog()
    const store = useRestoreErrorStore()

    await host.find('[data-test="choose-now"]').trigger('click')
    await flushPromises()
    // Le refus passe DÉSORMAIS par la confirmation de la modale, puis
    // par l'écrasement que la porte exécute elle-même — qui ne publie RIEN ici :
    // ce store ne rapporte que les incidents de RESTAURATION, et l'attente résout
    // à `false` (chemin `{ attempted: false }` du helper, sans `error`).
    await host.find('[data-test="local-restore-decline"]').trigger('click')
    await flushPromises()
    await host.find('[data-test="confirm-ok"]').trigger('click')
    await flushPromises()

    expect(restoreService.runRestore).not.toHaveBeenCalled()
    expect(store.report).toBeNull()
  })

  it('succès nominal (pas de owned, pas d’erreur) : AUCUNE publication — rien à signaler', async () => {
    designationDossierPlein()
    restoreService.runRestore.mockResolvedValue({ ok: true, decided: true })
    const { host } = await mountWithClosedLog()
    const store = useRestoreErrorStore()

    await accepteLOffre(host)

    expect(store.report).toBeNull()
  })

  // L'appropriation a réussi mais la base a été lue AVEC des écarts : PAS de
  // variante visuelle supplémentaire — pas de publication, les
  // écarts ne rejoignent le rapport copiable que si une modale est ouverte.
  it('succès avec écarts (errors) mais appropriation OK : pas de modale', async () => {
    designationDossierPlein()
    restoreService.runRestore.mockResolvedValue({
      ok: true,
      decided: true,
      errors: [{ where: 'Dossier illisible', error: 'EACCES' }],
    })
    const { host } = await mountWithClosedLog()
    const store = useRestoreErrorStore()

    await accepteLOffre(host)

    expect(store.report).toBeNull()
  })

  // VERROU DE DÉFILEMENT, LA SUCCESSION COMPLÈTE (revue du 05/09) : la porte pose le verrou à l'ouverture ;
  // la modale RestoreErrorDialog, publiée AVANT le retrait de la porte, l'ACQUIERT
  // à son tour (verrou à compteur, utils/body-scroll-lock.js). `hide()` ne déverrouille donc
  // plus le fond : il ne décompte que la part de la porte, celle de la modale tient encore.
  // L'état FINAL doit rester `overflow: hidden` : la modale ouverte pendant que la porte s'est
  // déjà retirée. Ce test combiné (porte + modale montées ensemble, comme dans App.vue)
  // épingle le passage de relais : l'écran derrière la modale ne doit JAMAIS redevenir
  // défilable au moment où elle s'ouvre.
  it('échec de restauration : le fond RESTE verrouillé quand hide() retire la part de la porte', async () => {
    designationDossierPlein()
    restoreService.runRestore.mockResolvedValue({ ok: false, error: 'EIO' })
    const ordre = []
    const Host = defineComponent({
      setup() {
        const gate = vueRef(null)
        return () =>
          h('div', [
            h(OnboardingFolderPrompt, { ref: gate, onClosed: () => ordre.push('closed') }),
            h(RestoreErrorDialog),
          ])
      },
    })
    const host = mount(Host, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    await flushPromises()

    // La porte ouverte tient le verrou…
    expect(document.body.style.overflow).toBe('hidden')

    await accepteLOffre(host)

    // …la porte a conclu (hide() n'a décompté que SA part du compteur), la modale est là…
    expect(ordre).toContain('closed')
    expect(host.find('[data-test="restore-error-dialog"]').exists()).toBe(true)
    // …et l'état final est TOUJOURS verrouillé — la part de la modale tient encore.
    expect(document.body.style.overflow).toBe('hidden')

    host.unmount()
  })
})

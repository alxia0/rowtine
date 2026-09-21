<script setup>
import { onMounted, ref, watch } from 'vue'
import { RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'
import NavProgress from '@/components/NavProgress.vue'
import SnackBar from '@/components/SnackBar.vue'
import PhotoLightbox from '@/components/PhotoLightbox.vue'
import ChartFullscreen from '@/components/ChartFullscreen.vue'
import PhotoCropper from '@/components/PhotoCropper.vue'
import PhotoSourceSheet from '@/components/PhotoSourceSheet.vue'
import OnboardingFolderPrompt from '@/components/OnboardingFolderPrompt.vue'
import BackupDecisionPrompt from '@/components/BackupDecisionPrompt.vue'
import SyncReportDialog from '@/components/SyncReportDialog.vue'
import RestoreErrorDialog from '@/components/RestoreErrorDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { versionGuardState } from '@/db/version-guard'
import { useSmartBack } from '@/composables/useSmartBack'
import { useSwipeBack } from '@/composables/useSwipeBack'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeSlot } from '@/composables/useNoticeSlot'
import { registerAutoBackupOnPause } from '@/backup/auto-trigger'
import { getBackupStorage, getBackupPermissionOk } from '@/backup/backup-service'
import { shouldOfferRestore } from '@/backup/restore-service'
import { backupPauseReason } from '@/backup/backup-pause'
import { runPatronMdSync } from '@/backup/run-patron-md-sync'
import { classifySyncReport } from '@/backup/sync-report-decision'
import { composeBackupFailureReport } from '@/backup/failure-report'
import { copyToClipboard } from '@/utils/copy-to-clipboard'
import { scheduleWarmup } from '@/utils/warmup'
import { folderGateHandlesBack } from '@/utils/folder-gate-back'
import { versionGuardHandlesBack } from '@/utils/version-guard-back'
import { ensureReprise } from '@/db/purchases-reprise'
import { getSetting, setSetting } from '@/db/db'
import {
  estimateStorage,
  maybeWarnQuota,
  requestPersistentStorage,
  shouldWarnQuotaNow,
} from '@/db/storage-health'
import { useChartZoomStore } from '@/stores/chart-zoom'
import { useColorPickerStore } from '@/stores/color-picker'
import { useLightboxStore } from '@/stores/lightbox'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectConsumptionStore } from '@/stores/project-consumption'
import { useProjectsStore } from '@/stores/projects'
import { usePurchasesStore } from '@/stores/purchases'
import { useSettingsStore } from '@/stores/settings'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSyncReportStore } from '@/stores/sync-report'
import { useBackupFailureStore } from '@/stores/backup-failure'
import { useFolderChangeStore } from '@/stores/folder-change'

const lightbox = useLightboxStore()
const chartZoom = useChartZoomStore()
const colorPicker = useColorPickerStore()
const projectConsumption = useProjectConsumptionStore()
const smartBack = useSmartBack()
const patternsStore = usePatternsStore()
const projectsStore = useProjectsStore()
const purchasesStore = usePurchasesStore()
const settingsStore = useSettingsStore()
const snackbar = useSnackbarStore()
const syncReportStore = useSyncReportStore()
const backupFailureStore = useBackupFailureStore()
const folderChangeStore = useFolderChangeStore()
const { t } = useI18n()

// Bandeau bloquant de décision (avenant 04/08/2026) : visibilité
// pilotée ICI, pas par BackupDecisionPrompt lui-même — `maybeOfferRestore` calcule
// `shouldOfferRestore` une fois au lancement et gouverne à la fois ce `v-if` ET le
// saut de `runPatronMdSync()` ci-dessous (une seule évaluation, un seul critère).
const showBackupDecisionPrompt = ref(false)
// File des messages (19/08/2026) : la primauté du garde-fou de version sur la porte
// du dossier et la bienvenue tenait jusqu'ici à un z-index (1300 contre 1200 et 80). Elle
// tient maintenant au RANG, et le z-index ne fait plus que peindre. Les deux mécanismes
// restent en place : celui-ci décide QUI s'affiche, celui-là décide de l'ordre de peinture
// pour tout ce qui n'est pas gouverné par la file (voile de la visionneuse, recadreur…).
const versionGuardHasSlot = useNoticeSlot(NOTICE.VERSION_GUARD, () => versionGuardState.triggered)
const backupDecisionHasSlot = useNoticeSlot(NOTICE.BACKUP_DECISION, showBackupDecisionPrompt)
// La RAISON de la pause (`null` | `'no-decision'` | `'other-device'`, cf.
// backup-pause.js), telle que la dernière évaluation de `maybeOfferRestore` l'a lue.
// Conservée dans la portée exprès : c'est ce que le bandeau consommera pour dire à
// l'utilisatrice CE QUI s'est passé, plutôt que de le re-déduire — la re-déduction est
// précisément ce qui a rendu possible le cul-de-sac que ce changement ferme.
const pauseReason = ref(null)
// Référence vers l'instance montée : `onBack`/le handler
// `backButton` natif délèguent au bandeau la décision de savoir si le retour peut
// aboutir (`canLeave`) — cf. `BackupDecisionPrompt::handleBackPressed`.
const backupPromptRef = ref(null)
// La porte du dossier (09/08) : interrogée par les DEUX chaînes de retour.
const folderGateRef = ref(null)
// La vue actuellement routée (Task 3, lot intents 20/09) : interrogée par les DEUX chaînes de
// retour, même motif que `backupPromptRef` ci-dessus — cf. `onBack()`/le handler `backButton`
// plus bas, et le commentaire de `ProjectDetailView.handleBackPressed()`. `null` sur toutes les
// vues qui n'exposent pas `handleBackPressed` (le chaînage optionnel `?.()` s'en accommode).
const currentViewRef = ref(null)

// Pont Réglages → porte (décision produit du 05/09/2026) : SafFolderSection,
// profond dans le RouterView, appelle `requestChange()` sur le mini-store
// `stores/folder-change.js` ; App.vue, SEUL propriétaire de la ref de la porte, consomme
// la demande et ouvre la porte en mode change (`openForChange` : sans les gardes du
// premier lancement — c'est un geste explicite). La demande est une IMPULSION, remise à
// faux ICI, par le consommateur : une demande ultérieure, même identique, doit
// re-déclencher ce `watch`, et une porte momentanément injoignable (ref pas encore
// montée, plateforme non native) ne doit pas laisser un `true` résiduel avaler en
// silence la demande suivante.
watch(
  () => folderChangeStore.requested,
  (requested) => {
    if (!requested) return
    folderChangeStore.requested = false
    folderGateRef.value?.openForChange()
  },
)
// Le plugin `@capacitor/app`, capturé une fois résolu par l'import dynamique plus bas
// (le même objet `App` que le handler natif `backButton` utilise). `onBack` (balayage
// de bord, cf. useSwipeBack ci-dessous) en a besoin pour pouvoir, lui aussi, quitter
// l'app quand la porte est visible : ce chemin n'est PAS réservé au web, il est actif
// sur appareil (correctif revue, 09/08 — la conception d'origine le supposait web/dev
// seulement). `null` tant que l'import n'a pas résolu, ou sur web où le plugin est
// absent — `folderGateHandlesBack` s'en accommode déjà (avale sans planter).
let capacitorApp = null

// Rapport de synchro MD : cas propre → snackbar discrète ; cas à
// signaler (progression perdue, avertissements, assets manquants, dossiers ignorés,
// erreurs) → modale `SyncReportDialog` (montée ci-dessous, visible d'elle-même via
// `classifySyncReport` sur ce même store). Rien à synchroniser → aucune UI.
watch(
  () => syncReportStore.report,
  (report) => {
    const decision = classifySyncReport(report)
    if (decision.kind !== 'snackbar') return
    snackbar.show(decision.count === 1 ? t('patronSync.synced1') : t('patronSync.syncedN', { n: decision.count }))
  },
)

// Échec de l'enregistrement automatique (décision produit du 05/09/2026) :
// le chemin AUTOMATIQUE d'auto-backup.js publie désormais ses échecs d'écriture —
// ils ne meurent plus en silence. Deux niveaux de détail, assumés : le snackbar porte
// une phrase COURTE (chemin + erreur tronquée — un message d'erreur SAF peut faire des
// centaines de caractères et noierait la barre), et le RAPPORT COMPLET (date, version,
// chemin, erreur intégrale — composeBackupFailureReport) part dans le presse-papiers
// via l'action : c'est ce texte collé qu'on reçoit dans les signalements. Durée 10 s :
// copier demande de lire, viser, maintenir — les 5 s par défaut ferment avant le geste.
// Cas résiduel NON traité ici : `skipped: 'permission'` (plus aucun dossier désigné) —
// l'écriture n'a pas échoué, il n'y a simplement pas de destination ; la porte du
// dossier et l'avertissement permanent des Réglages portent déjà ce message.
watch(
  () => backupFailureStore.failure,
  (failure) => {
    if (!failure) return
    // Troncature à 80 caractères : au-delà, la snackbar passe sur deux lignes sur
    // téléphone sans rien dire de plus d'utile — le détail intégral est précisément
    // ce que l'action « Copier l'erreur » remet.
    const err = String(failure.error ?? '')
    const shortError = err.length > 80 ? `${err.slice(0, 80)}…` : err
    snackbar.show(t('backupFailure.snackbar', { path: failure.path || t('backupFailure.pathUnknown'), error: shortError }), {
      actionLabel: t('backupFailure.copyAction'),
      duration: 10000,
      onAction: async () => {
        // Un échec de copie ne peut pas être muet (contrat de copyToClipboard) :
        // on l'annonce. Le snackbar étant UNIQUE, ce message REMPLACE celui de
        // l'échec d'écriture — accepté : l'utilisatrice vient de viser l'action,
        // elle doit savoir qu'elle n'a rien obtenu ; l'échec d'écriture, lui,
        // sera ré-annoncé au prochain passage automatique de toute façon.
        const copied = await copyToClipboard(composeBackupFailureReport(failure))
        if (!copied) snackbar.show(t('backupFailure.copyFailed'))
      },
    })
  },
)

onMounted(async () => {
  await patternsStore.load()                         // déclenche migrateReadersIfNeeded
  // Le patron libre doit naître dans la langue CHOISIE par l'utilisatrice à l'écran
  // d'accueil, jamais seulement DEVINÉE de l'appareil (correctif du 31/07 — bug
  // réel trouvé en revue, pas un cas limite : c'est le chemin du tout PREMIER lancement lui-
  // même, déterministe dès que la langue devinée diffère du choix). `ensureFreePattern` est
  // idempotent (crée une seule fois) : un appel ICI avant la fin de l'onboarding, avec la
  // langue seulement devinée, « gagnerait » silencieusement contre le choix explicite fait
  // ensuite dans le menu déroulant d'OnboardingView, qui ne ferait plus qu'un no-op.
  // Tant que l'onboarding n'est pas fait, on laisse OnboardingView.seedExamples() être seule
  // autorité sur la création (elle connaît la langue VALIDÉE) — `settingsStore.onboarded`
  // doit donc être la valeur RÉELLE (persistée Dexie), pas le défaut synchrone du store :
  // contrairement à `locale` (une pré-sélection, où « proche » suffisait), une erreur ici
  // recréerait le bug qu'on corrige. Une fois onboardée, cet appel redevient un simple filet
  // de sécurité idempotent (le patron existe déjà, langue déjà correcte) — cf. commentaire
  // de tête de main.js : le montage n'attend PAS le garde de route, donc rien ne garantit
  // que settingsStore.load() ait déjà tourné ailleurs à cet instant précis.
  if (!settingsStore.loaded) await settingsStore.load()
  const fid = settingsStore.onboarded ? await patternsStore.ensureFreePattern(settingsStore.locale) : null
  await projectsStore.load()
  await projectsStore.migrateFreeProjects(fid)

  // Durcissement stockage : demander la persistance OS + alerter si presque plein
  // (au plus 1×/24h, sinon on matraque l'utilisateur à chaque lancement).
  await requestPersistentStorage()
  const est = await estimateStorage()
  const lastQuotaWarnAt = await getSetting('lastQuotaWarnAt')
  if (shouldWarnQuotaNow(lastQuotaWarnAt, Date.now())) {
    maybeWarnQuota(est, () => {
      snackbar.show(t('storage.nearFull'))
      setSetting('lastQuotaWarnAt', new Date().toISOString())
    })
  }

  // Synchro MD au lancement : SAUTÉE si une restauration vient d'être
  // proposée/déclenchée sur ce lancement (une restauration remplace toute la base ;
  // une synchro concurrente serait inutile au mieux, une course au pire — cf.
  // garde anti-course).
  const restoreOffered = await maybeOfferRestore()
  if (!restoreOffered) runPatronMdSync()

  // Reprise du budget (31/07) : reconstruit l'historique d'achat des fiches saisies
  // avant cette fonctionnalité, une seule fois. APRÈS le chargement des réglages (la devise en dépend)
  // et APRÈS l'offre de restauration — une restauration acceptée est PRÉVUE pour écrire
  // elle-même les achats (backup/restore.js, pas encore livrée à ce
  // stade), la reprise n'a pas à la devancer.
  //
  // Correctif final (revue) : le registre se charge D'ABORD — ExpensesView et
  // YarnPurchases.vue ne rechargent JAMAIS le store eux-mêmes (contrairement à HomeView),
  // ils lisent purchasesStore tel qu'App.vue l'a laissé au démarrage. `ensureReprise` est
  // entouré d'un try/catch : le drapeau n'étant posé qu'EN FIN de `runReprise`
  // (purchases-reprise.js), une reprise qui échoue en cours de route sera simplement
  // rejouée au lancement suivant — une exception ici ne doit JAMAIS empêcher le reste de
  // la chaîne (et donc le chargement du registre pour toute la session). Si la reprise a
  // effectivement créé des lignes, on recharge : sans ce second appel, les lignes que
  // `runReprise` vient d'écrire directement en base (hors du store) resteraient invisibles
  // du store pour toute la session — un budget affiché à zéro serait pire que le bug corrigé.
  await purchasesStore.load()
  try {
    const created = await ensureReprise(settingsStore.currency)
    if (created) await purchasesStore.load()
  } catch {
    // Rejouée au prochain lancement (drapeau non posé) — cf. commentaire ci-dessus.
  }

  // Préchauffe au repos : une fois l'accueil peint, on pré-charge le code des écrans
  // chauds + les stores partagés, hors du chemin du tap (cure du « lent la 1re fois »).
  scheduleWarmup()
})

// Proposition de la décision au lancement (avenant 04/08/2026). `getBackupStorage()`
// renvoie null en web → no-op immédiat.
//
// AVENANT : ce n'est plus une proposition ponctuelle (snackbar à une action, qu'
// ignorer suffisait à laisser détruire) mais un bandeau
// bloquant (`BackupDecisionPrompt`, monté ci-dessous via `showBackupDecisionPrompt`)
// qui REVIENT À CHAQUE LANCEMENT tant qu'aucune décision n'a été prise pour ce
// dossier, pas seulement avant la fin de l'accueil (`!onboarded` a sauté du
// critère, cf. `shouldOfferRestore`). Sans ce changement, une utilisatrice qui MET
// À JOUR l'app (dossier déjà plein, décision jamais posée car la clé est neuve)
// resterait enfermée : plus jamais de bandeau, plus jamais de sauvegarde, en
// silence.
//
// Nuance : « revient à chaque
// lancement » n'équivaut PAS à « reste affiché sans issue » — dans le cas bloqué
// (restauration impossible, `canRestore` faux), « Plus tard » ferme le bandeau POUR
// CETTE SESSION sans poser de décision (cf. BackupDecisionPrompt.vue). Le bandeau
// n'est donc inéludable QUE dans le cas nominal.
//
// Renvoie `true` si le bandeau est affiché sur ce lancement — signal consommé par
// le câblage de la synchro MD ci-dessous pour éviter de faire
// courir les deux en même temps.
async function maybeOfferRestore() {
  const storage = await getBackupStorage()
  if (!storage) return false
  // Site unique de vérité (06/08/2026) : ce bandeau doit apparaître exactement
  // quand la sauvegarde s'arrête d'écrire — c'est le même prédicat qui gouverne les deux,
  // plus deux dérivations parallèles qui pouvaient diverger. La RAISON est conservée dans
  // la portée : le bandeau s'en sert pour choisir son message (« aucune décision » /
  // « un autre appareil a écrit ici »), au lieu de re-déduire le cas de son côté.
  pauseReason.value = await backupPauseReason(storage)
  const offer = shouldOfferRestore({
    pauseReason: pauseReason.value,
    granted: await getBackupPermissionOk(),
  })
  showBackupDecisionPrompt.value = offer
  return offer
}

// Étape 4 (re-revue finale) : ré-évalue l'offre quand l'invite de dossier
// du 1er lancement se ferme (`OnboardingFolderPrompt`, événement `closed`) — la
// SEULE autre évaluation a lieu ci-dessus, une fois, dans `onMounted`, AVANT que
// l'utilisatrice n'ait eu l'occasion de désigner un dossier depuis cette invite. Si
// elle désigne un dossier PLEIN puis refuse la modale de restauration locale
// (`LocalRestoreOffer` via `maybeRestoreAfterDesignation`), le refus exécute
// désormais « Perdre les données » (décision du 05/09) : une décision est posée SI
// l'écrasement réussit — mais s'il ÉCHOUE, aucune décision n'est posée et rien ne le
// dit avant le lancement suivant sans ce second appel.
//
// Ne peut PAS faire disparaître un bandeau que l'utilisatrice vient de fermer via
// « Plus tard » : les deux invites sont mutuellement exclusives (celle-ci n'apparaît
// que quand AUCUN dossier n'est désigné ; le bandeau de décision n'apparaît que
// quand un dossier EST désigné et contient une sauvegarde) — `showBackupDecisionPrompt`
// ne peut donc valoir que `false` au moment de cet appel, et `maybeOfferRestore()` ne
// peut ici que le FAIRE PASSER à `true`, jamais l'inverse.
function onOnboardingFolderPromptClosed() {
  // Correctif : `maybeOfferRestore()` interroge le plugin natif
  // SAF, dont un rejet non intercepté serait une promesse rejetée SILENCIEUSE, jamais
  // reprise nulle part. Le `.catch` RESTE nécessaire après le changement du 06/08/2026 :
  // `backupPauseReason` capture bien ses propres erreurs, mais `getBackupStorage()` et
  // `getBackupPermissionOk()`, appelées ici même, n'ont toujours aucun filet. Repli sûr,
  // même esprit que `.catch(() => {})` ci-dessus (App.addListener) : le bandeau ne
  // s'affiche simplement pas sur CE lancement, sans faire planter quoi que ce soit.
  maybeOfferRestore().catch(() => {})
}

// Garde-fou de démarrage (13/08/2026) : ferme le
// message « c'est compris » — le drapeau n'est réévalué qu'au prochain lancement (posé
// une seule fois par router/index.js, cf. src/db/version-guard.js), donc il ne revient
// pas pendant la session en cours après ce clic.
function dismissVersionGuard() {
  versionGuardState.triggered = false
}

// Retour unifié : priorité au plein écran diagramme, puis à la visionneuse photo, puis au
// pop-up sélecteur de couleur (StashView), puis au dialogue « combien de pelotes as-tu
// utilisées ? » (fiche projet ET carte d'accueil, clôture), sinon retour écran. Ces pop-up
// doivent être fermés en priorité : sinon Back navigue hors de l'écran et jette le
// formulaire/l'action en cours — régression vs l'ancien <input type=color> natif, dont le
// Back système fermait proprement le dialogue (revue, deuxième passe). Fermer le dialogue de
// consommation (clôture) via Back, au contraire, consomme TOUT le réservé (décision produit,
// cf. composable useProjectConsumption) — Back n'échappe pas à la question. (Note : le
// dialogue « pelotes tricotées ? », posé À la suppression, a été retiré de ce maillon avec
// le reste de la fonctionnalité — la suppression ne pose plus cette question.)
// Le bandeau de décision passe AVANT tout (correctif de revue) : tant qu'aucune
// décision n'est prise, naviguer derrière lui laisserait
// l'utilisatrice sur un écran qu'elle n'a pas demandé, l'overlay toujours au-dessus.
// Il AVALE le retour — sauf quand la sortie « Plus tard » existe (restauration
// impossible), où le retour vaut « Plus tard » : refuser le retour SANS offrir de
// sortie murerait l'app. `interceptBackupPrompt` est appelée par LES DEUX chemins de
// retour (`onBack` ci-dessous, via `useSwipeBack` ET le fallback web ; le handler
// `backButton` natif plus bas, qui ne passe PAS par `onBack` — chaîne dupliquée pour
// son geste de sortie propre, `App.exitApp()`) : un seul endroit qui sait comment
// interroger le bandeau.
function interceptBackupPrompt() {
  if (!showBackupDecisionPrompt.value) return false
  backupPromptRef.value?.handleBackPressed()
  return true
}

function onBack() {
  // Le garde-fou de version passe AVANT MÊME la porte du dossier (correction
  // finale, 13/08) : `versionGuardState` PRIME sur elle (cf. src/db/version-guard.js,
  // commentaire sur `versionGuardState`), et ce dialogue n'a — comme la porte — aucune
  // fermeture volontaire sur le voile. Le geste est AVALÉ SANS RIEN FAIRE : ni
  // navigation, ni sortie de l'app, ni fermeture du message. Le bouton « Compris » du
  // dialogue reste la seule sortie.
  if (versionGuardHandlesBack(versionGuardState)) return
  // La porte du dossier passe ensuite avant tout le reste : elle n'a pas de bouton de
  // fermeture, et naviguer derrière elle changerait d'écran sous un voile qu'on ne peut
  // pas lever. `onBack` sert le balayage de bord — ACTIF SUR APPAREIL, pas seulement le
  // repli web (correctif revue, 09/08) — ET le repli web lui-même. Sur web/dev,
  // `capacitorApp` est `null` (plugin absent) : le geste est avalé sans quitter, sans
  // planter.
  if (folderGateHandlesBack(folderGateRef.value, capacitorApp)) return
  if (interceptBackupPrompt()) return
  if (chartZoom.open) chartZoom.close()
  else if (lightbox.open) lightbox.close()
  else if (colorPicker.open) colorPicker.close()
  else if (projectConsumption.open) projectConsumption.close()
  // La vue routée courante (Task 3, lot intents 20/09) : cf. commentaire de
  // `currentViewRef` ci-dessus. Placée en DERNIER recours, après tous les pop-up — elle
  // ne doit intercepter QUE le cas où aucun overlay bloquant n'est ouvert ; sinon un
  // dialogue « combien de pelotes ? » ouvert depuis un onglet non par défaut ne se
  // fermerait plus jamais au retour, régression sur une décision produit déjà actée
  // (cf. commentaire de tête de `onBack()`, « Back n'échappe pas à la question »).
  else if (!currentViewRef.value?.handleBackPressed?.()) smartBack()
}

// Geste « retour » : balayage depuis le bord gauche (utile en navigation à 3 boutons) ET
// bouton/geste retour système Android (navigation gestuelle) via @capacitor/app — ce dernier
// couvre tous les écrans même quand le système intercepte le balayage de bord.
useSwipeBack(onBack)

if (typeof window !== 'undefined') {
  import('@capacitor/app')
    .then(({ App }) => {
      // Capturé pour `onBack` (balayage de bord) ci-dessus : même objet `App` que ce
      // handler natif utilise, pour qu'un seul et même geste de sortie (`exitApp`) soit
      // disponible aux DEUX chaînes de retour, pas seulement à celle-ci.
      capacitorApp = App
      App.addListener('backButton', ({ canGoBack }) => {
        if (versionGuardHandlesBack(versionGuardState)) return
        if (folderGateHandlesBack(folderGateRef.value, App)) return
        if (interceptBackupPrompt()) return
        if (chartZoom.open) chartZoom.close()
        else if (lightbox.open) lightbox.close()
        else if (colorPicker.open) colorPicker.close()
        else if (projectConsumption.open) projectConsumption.close()
        // Même ajout que dans onBack() ci-dessus, à la même position de précédence — cf.
        // commentaire de `currentViewRef` : dernier recours, après tous les pop-up.
        else if (currentViewRef.value?.handleBackPressed?.()) return
        else if (canGoBack || window.history.state?.back != null) smartBack()
        else App.exitApp()
      })
      // Sauvegarde automatique : à chaque mise en arrière-plan de l'app,
      // on tente une sauvegarde throttlée (silencieuse, pas de retour visuel).
      registerAutoBackupOnPause(App)
      // Synchro MD : à chaque retour au premier plan, on retente
      // une synchro (mêmes gardes natif/stockage/permission + garde in-progress
      // que `runPatronMdSync` applique déjà — silencieuse, pas de retour visuel
      // au cas propre ; un rapport est produit pour les autres cas).
      App.addListener('resume', () => runPatronMdSync())
    })
    .catch(() => {}) // plugin absent (ex. web) : on garde le balayage JS
}
</script>

<template>
  <NavProgress />
  <!-- Bande opaque de la zone barre de statut, au défilement : le modèle de défilement
       est le document ; sur les écrans sans en-tête
       collant opaque (fiche projet .phdr, fiche patron .phdr, onboarding), le contenu qui
       défile se peignait dans la bande `0 … --sa-top`, par-dessus l'heure/la batterie/
       l'encoche. Une seule bande fixe ICI couvre TOUS les écrans et toutes les largeurs
       (un .phdr collant garderait le trou latéral de max-width sur tablette). height:
       var(--sa-top) → 0 sur web/e2e (élément nul, no-op). z-index 45 : au-dessus du contenu
       et des en-têtes collants (≤ 40), SOUS les menus/voiles/feuilles (≥ 50), les dialogues
       plein écran (80-85, dont le voile doit assombrir toute la hauteur sans liseré) et
       NavProgress (2000). pointer-events: none : ne mange jamais un tap ni un scroll.
       Synergie avec le masquage de démarrage 2f5d9436 : `--sa-top` est posé avant le
       dévoilement, la bande a donc sa hauteur dès le premier paint visible. -->
  <div class="sa-scrim" aria-hidden="true"></div>
  <!-- Transitions d'écran : réactivées
       APRÈS avoir donné une racine unique à chaque vue de src/views/ — <Transition> refuse
       un fragment (AppHeader + main donnaient une page vide, cf. tokens.css). Chaque vue a
       désormais UNE racine (18 vues enveloppées dans un <div> sans style ; Onboarding,
       ProjectDetail et Reader avaient déjà une racine ou une chaîne v-if/else toujours
       élément). PAS de :key sur <component> (choix minimal) : le fondu ne joue qu'au
       CHANGEMENT de composant — une navigation qui réutilise la même vue avec un autre
       paramètre (project-new → project-edit, ReaderView d'un projet à l'autre) ne
       re-monte PAS l'écran (ni fondu ni perte d'état/scroll). mode="out-in" : l'écran
       sortant est démonté AVANT que le suivant n'apparaisse, jamais superposés — SANS
       durée de sortie volontairement (cf. tokens.css) : il quitte à la frame suivante, un
       écran encore animé en sortie resterait cliquable et avalerait les taps rapides.
       Pas d'`appear` : le premier écran du lancement ne s'anime pas. Le fondu d'entrée
       (150 ms) vit dans tokens.css (`.route-fade-*`), avec sa garde
       prefers-reduced-motion. -->
  <RouterView v-slot="{ Component }">
    <Transition name="route-fade" mode="out-in">
      <component :is="Component" ref="currentViewRef" />
    </Transition>
  </RouterView>
  <SnackBar />
  <PhotoLightbox />
  <ChartFullscreen />
  <PhotoCropper />
  <!-- Feuille « galerie / appareil photo » (décision produit du 04/09/2026, option (a)) :
       monte AVANT le recadeur dans le flux car elle se ferme toujours avant qu'il
       s'ouvre (le settle du choix précède le pick puis le crop — jamais superposés). -->
  <PhotoSourceSheet />
  <OnboardingFolderPrompt ref="folderGateRef" @closed="onOnboardingFolderPromptClosed" />
  <!-- `pause-reason` (06/08) : la raison lue par `maybeOfferRestore` est
       TRANSMISE, pas re-déduite par le bandeau. C'est le quatrième site du critère, et
       le seul qui ne calcule rien — sans cette liaison, le bandeau annoncerait « restaure
       d'abord » alors que la sauvegarde est arrêtée parce qu'un AUTRE appareil a écrit,
       et n'offrirait aucune sortie vers les Réglages, seul endroit où changer de dossier. -->
  <BackupDecisionPrompt
    v-if="backupDecisionHasSlot"
    ref="backupPromptRef"
    :pause-reason="pauseReason"
    @resolved="showBackupDecisionPrompt = false"
  />
  <SyncReportDialog />
  <!-- Incident de restauration (décision produit du 05/09/2026) : modale
       singleton pilotée par le store `restore-error`, publiée par la porte du
       dossier et le bandeau de décision. Montée UNE FOIS ici (même motif que
       SyncReportDialog) pour survivre à la fermeture de ses déclencheurs — et
       volontairement HORS file des messages : elle doit se peindre PAR-DESSUS la
       porte et le bandeau, que la file lui ferait attendre (cf. son en-tête). -->
  <RestoreErrorDialog />
  <!-- Garde-fou de démarrage (13/08/2026 ; commentaire
       corrigé le 13/08, revue 13/08) : PRIME sur la porte du dossier et
       la bienvenue.
       ⚠️ Le cas résiduel n'est PAS celui d'un onboarding interrompu : la porte
       (OnboardingFolderPrompt.vue:77) exige `onboarded === true` pour s'afficher — un
       appareil non onboardé arrive sur OnboardingView, un écran, pas un calque
       par-dessus ce message. Le cas résiduel RÉEL, plausible et pas marginal (l'appareil
       est en usage, donc porteur d'une base à 30) : `onboarded === true` ET
       `hasFolder()` devenu faux (permission du dossier révoquée, dossier supprimé).
       `concluded` (OnboardingFolderPrompt.vue:63) est un drapeau de MODULE, remis à zéro
       à chaque session, et `hasFolder()` est relue à chaque `evaluate()` : la porte PEUT
       revenir à toute session ultérieure, y compris une session où ce garde-fou est
       aussi déclenché. `ConfirmDialog` est fixe en z-index 80 (son propre scoped
       style), largement sous les 1200 de la porte/du bandeau/du rapport de synchro :
       `.app-version-guard-layer` (scoped ci-dessous) crée un nouveau contexte
       d'empilement qui fait peindre ses descendants position:fixed AU-DESSUS des trois
       autres, sans toucher ConfirmDialog.vue ni les composants tiers. -->
  <div class="app-version-guard-layer">
    <ConfirmDialog
      :open="versionGuardHasSlot"
      centered
      :dismiss-on-scrim="false"
      :title="t('versionGuard.title')"
      :message="t('versionGuard.message')"
      :confirm-label="t('common.gotIt')"
      @confirm="dismissVersionGuard"
    />
  </div>
</template>

<style scoped>
/* Couche du garde-fou de démarrage (13/08/2026).
   Suit la convention du projet (z-index en dur dans le style scopé du composant qui
   en a besoin, cf. BackupDecisionPrompt.vue/OnboardingFolderPrompt.vue/
   SyncReportDialog.vue à 1200, ChartFullscreen.vue/PhotoCropper.vue/PhotoSourceSheet.vue
   à 1100 — la feuille de source photo y rejoint le recadeur SANS jamais s'y superposer :
   elle est fermée avant que le recadeur ne s'ouvre —, PhotoLightbox.vue à 1000) : le
   prochain rang au-dessus des overlays bloquants existants (1200), pour que le garde-fou
   — qui PRIME sur eux — peigne toujours par-dessus, même dans le cas résiduel
   documenté ci-dessus. `position: relative` + un `z-index` explicite ouvrent un nouveau
   contexte d'empilement : le `ConfirmDialog` `position: fixed` qu'elle contient
   (z-index 80 dans son propre style, inchangé) est alors comparé aux autres calques à
   CE niveau (1300), pas au sien. */
.app-version-guard-layer {
  position: relative;
  z-index: 1300;
}
.sa-scrim {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--sa-top);
  background: var(--bg);
  z-index: 45;
  pointer-events: none;
}
</style>

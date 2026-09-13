<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useI18n } from 'vue-i18n'
import { hasFolder, folderKey } from '@/backup/saf-folder'
import { designateFolder } from '@/backup/designate-folder'
import { maybeRestoreAfterDesignation } from '@/backup/restore-on-designate'
import { getSetting, setSetting } from '@/db/db'
import { clearBackupDecision, recordBackupDecision } from '@/backup/backup-decision'
import { runBackup } from '@/backup/backup-service'
import { markFolderClean } from '@/backup/restore-guard'
import SyncProgressLine from '@/components/SyncProgressLine.vue'
import LocalRestoreOffer from '@/components/LocalRestoreOffer.vue'
import { beginSyncProgress, endSyncProgress } from '@/backup/progress'
import { useSettingsStore } from '@/stores/settings'
import { useRestoreErrorStore } from '@/stores/restore-error'
import { useSnackbarStore } from '@/stores/snackbar'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeSlot } from '@/composables/useNoticeSlot'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import { useFolderChangeStore } from '@/stores/folder-change'

// LA PORTE DU DOSSIER (lot « premier lancement simplifié », 09/08/2026).
//
// Ce composant était une invite NON BLOQUANTE (« Plus tard » n'empêchait rien) qui
// s'affichait par-dessus l'écran de bienvenue, avant même qu'on ait vu ce qu'est
// l'application. Il est devenu une PORTE : sans dossier, l'app ne va pas plus loin.
//
// Décision produit (09/08) en connaissance du risque : bloquer garantit qu'aucune
// donnée n'existe jamais sans copie de sauvegarde. La garde qui va avec — et qui n'est
// pas négociable — est que c'est un ÉCRAN QUI EXPLIQUE ET PORTE UN BOUTON, jamais une
// boucle qui rouvrirait le sélecteur toute seule : si le sélecteur d'un OEM se comporte
// mal, l'utilisatrice doit voir un écran, pas une app qui clignote sans issue. La
// sortie est le bouton retour du téléphone, qui quitte l'app (cf. App.vue).
//
// ORDRE : la porte attend la fin de l'écran de bienvenue (`onboarded`, valeur PERSISTÉE
// et non le défaut synchrone du store — même piège que celui documenté dans App.vue
// lignes 91-98). Conséquence mesurée : les patrons d'exemple sont déjà en base quand la
// récupération est évaluée. `isDbRestorable` tolère cette base-là depuis le correctif du
// 04/08/2026 — mais c'est désormais le chemin NOMINAL, pas un cas limite, d'où le test
// dédié dans tests/unit/onboarding-folder-prompt.spec.js.
//
// CORRECTIF (revue, 09/08) : ce composant est monté UNE SEULE FOIS, en frère de
// `<RouterView/>` dans App.vue — jamais démonté/remonté quand l'écran de bienvenue se
// termine (c'est une navigation interne). Un `onMounted` seul ne voit donc `onboarded`
// qu'à l'instant du lancement : sur un appareil vierge, à cet instant précis, l'accueil
// n'est pas fini, donc `onboarded` est faux, et `visible` restait à `false` pour TOUTE
// la session — la porte n'apparaissait qu'au redémarrage suivant, sans jamais bloquer le
// tout premier lancement. `evaluate()` est donc appelée aux DEUX moments : au montage
// (lecture Dexie via `getSetting`, qui ne dépend pas de l'ordre de chargement du store)
// ET quand `settingsStore.onboarded` devient vrai en cours de session (le `watch`
// ci-dessous — `completeOnboarding()` le fait passer à `true` de façon réactive,
// cf. src/stores/settings.js:77). Les deux, jamais l'un à la place de l'autre :
// `settingsStore.onboarded` seul ne serait fiable qu'après `settingsStore.load()`,
// dont rien ne garantit l'ordre par rapport à ce montage-ci.
//
// `safOnboardingSeen` n'est plus ni lu ni écrit : il n'y a plus de « déjà proposé »,
// seulement « déjà désigné ». Une valeur résiduelle en base est inoffensive.
//
// DÉCISION DU 05/09/2026 : la porte a désormais un SECOND mode,
// « change » — ouverte depuis les Réglages (`openForChange`, via le pont
// `stores/folder-change.js`), pour changer de dossier une installation déjà en place.
// Ce qui change en mode change : ouverture SANS les gardes (`concluded`/`onboarded`/
// `hasFolder`), retour du téléphone qui referme au lieu de quitter l'app
// (folder-gate-back.js), annulation du sélecteur qui referme sans message NI
// `concluded`, drapeaux d'installation (`welcomeDue`/`importCaveatDue`) non posés,
// titre/corps dédiés, et acquittement de la décision préservé si le dossier
// ré-désigné est le MÊME (`folderKey()` comparé avant/après). Le reste —
// `designateFolder`, `clearBackupDecision` sur dossier différent,
// `maybeRestoreAfterDesignation` (l'offre de restauration locale sur un NOUVEAU
// dossier plein reste voulue, ses gardes `isDbRestorable` protègent une base pleine),
// publication d'incident, `hide()` — est le flux d'origine, inchangé.
const { t } = useI18n()
const settingsStore = useSettingsStore()
const snackbar = useSnackbarStore()
// Pont Réglages ↔ porte : résolu UNE FOIS au setup, pas à chaque
// fermeture — `hide()`/`closeWithoutConclusion()` s'exécutent hors contexte de
// setup (handlers d'événements), là où l'injection de Pinia ne répond plus.
const folderChangeBridge = useFolderChangeStore()

// `closed` reste le contrat attendu par App.vue : il ré-évalue l'offre de restauration
// dans la session courante au lieu d'attendre le lancement suivant.
const emit = defineEmits(['closed'])

const visible = ref(false)
// MODE DE LA PORTE (décision produit du 05/09/2026 : « AJOUTER un bouton
// qui permet de modifier »). 'onboarding' : le premier lancement, la porte d'origine —
// le retour du téléphone QUITTE l'app et `hide()` pose `concluded` (plus jamais
// rallumée dans la session). 'change' : ouverte DEPUIS LES RÉGLAGES (`openForChange`,
// un geste explicite de l'utilisatrice) — le retour la REFERME (quitter l'app sous un
// changement demandé serait inacceptable, cf. folder-gate-back.js), l'annulation du
// sélecteur aussi, et RIEN ne pose `concluded` tant qu'aucune désignation n'a réussi :
// si la permission saute ensuite en cours de session, la porte doit pouvoir se
// rallumer. Exposé par `defineExpose` : les DEUX chaînes de retour d'App.vue lisent le
// mode au moment du geste via `folderGateHandlesBack`.
const mode = ref('onboarding')
// File des messages (19/08/2026) : `visible` reste la condition PROPRE de la porte —
// `evaluate()` et `hide()` ne changent pas. Seul l'affichage passe par la file.
const hasSlot = useNoticeSlot(NOTICE.FOLDER_GATE, visible)
// Piège au Tab + restitution du focus au déclencheur à la fermeture (dette audit UX
// 16/07, composable partagé) : le voile ne bloque le Tab que visuellement. L'offre de
// restauration locale (LocalRestoreOffer) est un FRÈRE du template, ses événements
// clavier ne traversent jamais ce piège.
useDialogFocusReturn(() => hasSlot.value)

// ⚠️ LE VERROU DE DÉFILEMENT SUIT `hasSlot`, PAS `visible` (correctif de la revue du 19/08).
// `visible` dit « la porte a lieu d'être », `hasSlot` dit « la file lui
// accorde l'écran » : depuis que le rendu est passé sur `hasSlot`, les deux ne
// coïncident plus tant qu'un message plus fort tient l'écran — le fond était alors verrouillé
// alors qu'AUCUNE porte n'était peinte. Posé ici plutôt que dans `evaluate()`/`hide()`, qui
// ne connaissent que la condition propre. `hide()` et `onBeforeUnmount` gardent leur remise à
// zéro : le premier parce qu'il conclut la session de la porte, le second parce qu'un
// démontage ne fait pas retomber ce `watch`. Même correctif, même jour, sur
// `SyncReportDialog.vue`. Gardé par le test « le verrou de défilement suit la FILE » de
// tests/unit/onboarding-folder-prompt.spec.js.
//
// ⚠️ PAS de `{ immediate: true }` ici, à la différence de `SyncReportDialog.vue` — et ce n'est
// pas un oubli : `visible` est un `ref` local qui vaut TOUJOURS `false` au `setup` (seul
// `evaluate()`, appelé au plus tôt dans `onMounted`, peut le lever). `hasSlot` ne peut donc
// jamais être déjà vrai à la création du `watch`, et celui-ci ne peut pas être inerte. La
// modale de synchro, elle, se peuple par un `watch` immédiat sur son magasin : elle a le
// problème inverse, d'où le réglage inverse.
//
// Deux modales successives, fond déverrouillé : la pose et le retrait
// passent par le verrou à COMPTEUR partagé (utils/body-scroll-lock.js) — refermer la porte
// ne doit plus déverrouiller le fond tant qu'une AUTRE modale le tient. `verrouPose` garde
// la règle « on ne relâche que ce qu'ON a posé » : `hide()`, `closeWithoutConclusion()` et
// `onBeforeUnmount` (plus bas) repassent par le même drapeau, jamais de libération à
// l'aveugle qui décompterait le verrou d'un autre composant.
let verrouPose = false
watch(hasSlot, (v) => {
  if (v) {
    verrouPose = true
    lockBodyScroll()
  } else if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
})
const choosing = ref(false)
const failed = ref(false)

// LA RÈGLE DES SUPERPOSITIONS : la surface qui déclenche une opération de dossier RETIRE son invitation pendant
// l'opération — l'invitation est périmée dès que le dossier est désigné. Levé juste
// avant `beginSyncProgress('read')` dans `onChooseNow`, pas plus tôt : avant le begin,
// la ligne de progression n'est pas encore active et le panneau serait vide ; les
// écritures de réglages qui précèdent sont des ms — l'invitation reste ce temps-là,
// le bouton y est déjà inerte (`choosing`). Pendant l'opération, le panneau ne rend
// donc QUE la ligne de progression : ses libellés « Lecture… »/« Écriture… », dérivés
// de la phase réelle, SONT le message — unique et vrai. Pas de titre statique type
// « Restauration en cours… » non plus : il mentirait pendant le scan d'une
// installation neuve à dossier vide (rien n'est encore restauré à cet instant). La
// modale LocalRestoreOffer (z-index supérieur) reste, elle, le message tant qu'elle est
// ouverte. Jamais redescendu : la seule suite est `hide()` — la porte a conclu — car
// `maybeRestoreAfterDesignation` ne lève jamais (filet interne).
const restoring = ref(false)

// L'offre de restauration LOCALE (données trouvées dans le dossier qu'on vient de
// désigner) est une VRAIE modale maison (LocalRestoreOffer.vue), plus le
// `window.confirm` natif — dont les boutons CANCEL/OK n'étaient jamais traduits et
// dont le figement des minuteries est documenté dans restore-service.js. Le helper
// (`maybeRestoreAfterDesignation`) reçoit la question sous forme de promesse : la
// modale se monte, et le choix de l'utilisatrice résout l'attente — « Restaurer »
// enchaîne exactement ce que faisait OK (même `runRestore`, mêmes progressions) ; le
// refus (depuis le 05/09 : le bouton dit désormais « Perdre les données ») passe
// par la confirmation DE LA MODALE, puis CE composant exécute l'écrasement
// (`onRestoreDiscard` ci-dessous) AVANT que l'attente ne soit résolue à `false` — la
// promesse pendante est ce qui retient la porte pendant toute l'opération.
const restoreOfferVisible = ref(false)
// Anti double-tap du geste destructeur (cf. `onRestoreDiscard`) — PAS un verrou
// d'écriture : `runBackup` est déjà sérialisé par backupChain.
const discarding = ref(false)
let resolveRestoreChoice = null

// Le rappel passé au helper : ouvre la modale et attend LE geste. Résoudre à
// `false` (jamais à `true` par défaut) est le seul sens prudent.
function askRestoreConfirmation() {
  return new Promise((resolve) => {
    resolveRestoreChoice = resolve
    restoreOfferVisible.value = true
  })
}

// Referme l'offre et résout l'attente, quel que soit le bouton : refermer PUIS
// résoudre, pour que la porte reprenne son cours (fin de `onChooseNow`) écran propre.
// La garde porte sur la promesse PENDANTE, pas sur la visibilité : le geste
// destructeur referme l'offre AVANT son opération (`onRestoreDiscard`) et ne résout
// qu'APRÈS — l'ancienne garde (`restoreOfferVisible`) empêcherait cette résolution-là,
// et la porte serait restée suspendue pour toujours.
function settleRestoreChoice(choice) {
  if (!resolveRestoreChoice) return
  restoreOfferVisible.value = false
  const resolve = resolveRestoreChoice
  resolveRestoreChoice = null
  resolve(choice)
}

// LE REFUS EXÉCUTÉ (décision produit du 05/09 : « Perdre les données »).
// La modale n'émet `discard` qu'APRÈS sa propre confirmation ; ici, le geste est
// l'équivalent exact de « Repartir de zéro », à l'identique de
// `SafFolderSection.startFresh` et de `BackupDecisionPrompt.onStartFresh` :
// `runBackup` en écrasement (la SEULE porte qui franchit la garde anti-écrasement)
// PUIS `recordBackupDecision` — jamais l'inverse, la décision ne se pose qu'après une
// écriture réussie. C'est l'écrasement qui rend le refus définitif : poser la décision
// SANS écrire laisserait la pause (« aucune décision » ou « autre appareil ») rouvrir
// le bandeau aussitôt (backup-pause.js : seul l'écrasement réécrit la fiche du dossier
// avec CE device).
//
// ORDRE : l'offre est refermée AVANT l'opération, mais l'attente n'est résolue
// qu'APRÈS (`settleRestoreChoice(false)` en `finally`) — pendant l'écriture, la
// promesse pendante retient la porte, déjà en mode `restoring` : sa
// `<SyncProgressLine owner="inline">` est le bon écran pendant l'écriture, ses
// libellés « Écriture… » dérivés de la phase réelle.
//
// `runBackup` est sérialisé par la chaîne de sauvegarde (backupChain,
// backup-service.js) : aucun verrou local à inventer pour les écritures ;
// `discarding` ne protège que du double-tap pendant que l'offre se referme.
//
// VOCABULAIRE (décision produit du 05/09) : dans CE flux, jamais « sauvegarde » —
// le succès comme l'échec parlent d'enregistrement des données, via
// des clés DÉDIÉES (restore.discardDone / restore.discardFailed). Les clés
// saf.syncDone / saf.syncFailed, qui disent « sauvegarde », restent celles de
// « Repartir de zéro » (SafFolderSection.startFresh, BackupDecisionPrompt
// .onStartFresh) ; saf.syncFailedPermission (« Aucun dossier désigné. ») est
// neutre et partagée.
//
// RETOMBÉE SUR ÉCHEC (permission perdue, E/S) : aucune décision posée — la porte se
// referme quand même (`settleRestoreChoice(false)` → fin de `onChooseNow` → `hide()`)
// et App ré-évalue l'offre à la fermeture (`onOnboardingFolderPromptClosed` →
// `maybeOfferRestore`) : le bandeau « Des données t'attendent » revient avec des
// boutons agissants. Retombée saine EXISTANTE, câblée et testée côté App.vue
// (tests/unit/App.restore-offer.spec.js, bloc « ré-évaluation après la fermeture ») —
// on ne la réinvente pas ici.
async function onRestoreDiscard() {
  if (discarding.value) return
  discarding.value = true
  restoreOfferVisible.value = false
  const report = beginSyncProgress('backup')
  try {
    const res = await runBackup({ overwriteBackup: true, onProgress: report })
    if (res.ok) {
      // Le booléen de `recordBackupDecision()` DOIT être lu (cf. SafFolderSection) :
      // ignoré, un échec d'enregistrement ferait croire au succès (restore
      // .discardDone) alors que la garde se referme aussitôt derrière —
      // cul-de-sac silencieux.
      const decided = await recordBackupDecision()
      // Drapeau « dossier propre » : l'écrasement réussi met
      // le dossier et la base en image l'un de l'autre — la MÊME situation qu'à la
      // fin d'une restauration réussie, où restore-service.js pose déjà ce drapeau
      // (session only, cf. restore-guard.js : effacé par toute mutation Dexie et à
      // la pause). Sans lui, le tir d'auto-backup armé par `recordBackupDecision`
      // ci-dessus relit et réécrit un dossier identique pour rien (~255 s de
      // requêtes SAF mesurées sur Nexus 7 dans le scénario symétrique).
      //
      // PLACEMENT — MÊME CONTRAT que restore-service.js : APRÈS
      // `recordBackupDecision()`, pas avant. Son `setSetting` passe par le hook
      // Dexie de db.js, qui efface le drapeau à toute mutation : posé avant lui, il
      // serait effacé aussitôt et le tir auto relirait TOUT le dossier. Atteindre
      // cette ligne prouve que l'écrasement est allé au bout (`res.ok`) : un échec
      // (permission perdue, E/S) laisse le dossier potentiellement divergent de la
      // base, le drapeau y est interdit — les skips plus bas renvoient plus tôt.
      // Un `decided` faux n'empêche rien : la décision, c'est un réglage de plus en
      // base, pas un contenu — le miroir dossier↔base tient quand même.
      markFolderClean()
      snackbar.show(decided ? t('restore.discardDone') : t('saf.decisionNotSaved'))
    } else if (res.skipped === 'permission') {
      snackbar.show(t('saf.syncFailedPermission'))
    } else {
      snackbar.show(t('restore.discardFailed'))
    }
  } finally {
    endSyncProgress()
    discarding.value = false
    // La résolution, et elle seule, referme le flux de `onChooseNow` (fin de
    // `maybeRestoreAfterDesignation`, publication éventuelle, `hide()`).
    settleRestoreChoice(false)
  }
}
// Devient vrai dès qu'une désignation a réussi (cf. `hide()`) : la porte a rempli son
// rôle pour cette session et ne doit plus jamais se rallumer, même si `evaluate()` est
// re-déclenchée par le `watch` (ex. le store finit de charger APRÈS la désignation).
let concluded = false

// Logique de décision, partagée par les deux points d'entrée ci-dessous. `hasFolder()`
// est relu à CHAQUE appel : le dossier peut avoir été désigné entre le montage et le
// moment où `onboarded` devient vrai.
//
// `hasFolder()` protégée ICI (et non chez chaque appelant) : le montage l'attend déjà
// (`await evaluate(...)`), mais le `watch` ci-dessous appelle `evaluate(true)` en
// tir-et-oublie — un rejet du plugin natif (permission perdue, E/S) y serait sinon une
// promesse rejetée non gérée, silencieuse. Même filet que celui de `getSetting` dans
// `onMounted`, au même endroit pour les deux entrées plutôt que dupliqué chez l'appelant.
async function evaluate(onboarded) {
  if (concluded || visible.value) return
  if (!Capacitor.isNativePlatform()) return
  if (!onboarded) return
  try {
    const has = await hasFolder()
    if (has) return
    if (concluded || visible.value) return // re-vérifié après l'attente : rien n'a dû changer pendant l'await
    visible.value = true
  } catch {
    // repli prudent : une erreur de hasFolder() ne montre pas la porte, mais ne casse
    // pas l'appelant (ni le montage, ni le watch).
  }
}

onMounted(async () => {
  if (!Capacitor.isNativePlatform()) return
  let onboarded
  try {
    onboarded = await getSetting('onboarded')
  } catch {
    return // repli prudent : une base illisible ne montre pas la porte, mais ne casse pas le montage
  }
  await evaluate(onboarded)
})

// Couvre le cas « l'accueil se termine PENDANT cette session » : `completeOnboarding()`
// (src/stores/settings.js) passe `onboarded` à `true` de façon réactive avant même
// d'avoir fini de persister — ce `watch` le voit aussitôt, sans attendre un remontage
// qui n'aura jamais lieu.
watch(
  () => settingsStore.onboarded,
  (val) => {
    if (val) evaluate(true)
  },
)

onBeforeUnmount(() => {
  // Que ce qu'ON a posé (cf. `verrouPose` au-dessus) : le composant est monté une fois
  // pour toutes par App.vue, mais un démontage de test ne doit pas décompter le verrou
  // d'un autre composant.
  if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
  // Filet : si le composant démonte pendant qu'une réponse de la modale de
  // restauration est attendue, la promesse ne doit pas rester pendante —
  // résolue au refus, le seul sens prudent.
  settleRestoreChoice(false)
})

function hide() {
  visible.value = false
  concluded = true
  mode.value = 'onboarding'
  // Libéré ICI (avant le flush du `watch` sur `hasSlot`) pour l'immédiat, mais via le
  // drapeau : c'est le compteur partagé qui décide du retrait réel.
  if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
  // Pont Réglages ↔ porte : SafFolderSection recharge son état à CHAQUE
  // fermeture de la porte (la raison de pause et le chemin affichés seraient
  // sinon périmés après un changement de dossier — la section ne se recharge
  // aujourd'hui qu'au montage). Notifié ICI plutôt que côté App.vue : l'événement
  // `closed` ne couvre pas la refermeture sans conclusion d'une annulation (cf.
  // `closeWithoutConclusion`), qui doit rafraîchir les Réglages tout autant. Notifier
  // à chaque fermeture est sans danger : la section n'est simplement pas montée
  // pendant le premier lancement.
  folderChangeBridge.notifyGateClosed()
  emit('closed')
}

// OUVERTURE SANS GARDES, demandée par les Réglages via le pont
// (`stores/folder-change.js`). Court-circuite `evaluate()` : ni `concluded`, ni
// `onboarded`, ni `hasFolder()` — c'est un geste EXPLICITE de l'utilisatrice, la porte
// n'a pas à en juger, et sans dossier désigné il DÉSIGNE, avec dossier il CHANGE.
// Hors plateforme native le plugin est absent : ne pas ouvrir un écran mort (le bouton
// des Réglages n'y est d'ailleurs pas rendu). Déjà visible (premier lancement en
// cours) : ne rien changer — les Réglages ne sont de toute façon pas atteignables
// derrière la porte. `failed` est remis à zéro pour qu'une erreur d'une précédente
// tentative ne réapparaisse pas ; `restoring` aussi, en défense (une opération de
// dossier tient la porte visible, donc rien ne peut être en cours ici).
function openForChange() {
  if (!Capacitor.isNativePlatform()) return
  if (visible.value) return
  mode.value = 'change'
  failed.value = false
  restoring.value = false
  visible.value = true
}

// REFERMETURE SANS CONCLUSION (mode change uniquement) : sélecteur annulé ou retour
// du téléphone — AUCUNE désignation n'a eu lieu, donc rien à conclure : pas de
// `concluded` (la porte doit pouvoir se rallumer en session si la permission saute,
// cf. `mode`), pas de message (annuler n'est pas une erreur), pas d'événement
// `closed` (rien n'a changé : la ré-évaluation de l'offre de restauration que
// déclenche `closed` côté App.vue n'a rien à re-lire, et surtout ne doit pas
// ressusciter un bandeau que l'utilisatrice vient de renvoyer avec « Plus tard »).
// Le compteur de fermeture du pont, lui, avance : les Réglages rechargent leur état
// même après une annulation.
function closeWithoutConclusion() {
  visible.value = false
  mode.value = 'onboarding'
  failed.value = false
  if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
  folderChangeBridge.notifyGateClosed()
}

// Exposé à `folder-gate-back.js` : en mode change, le retour du téléphone REFERME la
// porte au lieu de quitter l'app. Refuse de fermer pendant qu'une opération de
// dossier tient l'écran (désignation en cours, offre de restauration ouverte,
// restauration/écrasement) : refermer la porte sous le flux de `onChooseNow`
// l'orphanerait — l'attente de la promesse de restauration retient déjà la porte,
// il ne faut pas la lui retirer. Le geste reste consommé dans tous les cas
// (`folderGateHandlesBack` renvoie `true`) : il n'a simplement aucun effet tant que
// l'opération n'est pas terminée.
function closeFromBack() {
  if (choosing.value || restoring.value || restoreOfferVisible.value) return
  if (!visible.value || mode.value !== 'change') return
  closeWithoutConclusion()
}

// DEUXIÈME BLOC de la publication (décision produit du 05/09/2026) :
// traduit le compte rendu de `maybeRestoreAfterDesignation` en ouverture de la
// modale RestoreErrorDialog (montée dans App.vue, pilotée par le store
// `restore-error`). AVANT cette évolution, la valeur de retour n'était pas lue : une
// restauration qui échouait (erreur de garde E/S, JSON corrompu, échec interne
// de `runRestore`) passait TOTALEMENT inaperçue sur le chemin du téléphone neuf.
// Les cas, dans l'ordre du contrat (cf. restore-on-designate.js) :
//   - outcome.error : une ERREUR DE GARDE a été avalée — une erreur E/S sur la
//     garde est aussi une « erreur technique » au sens de la décision ;
//   - result.ok === false avec result.error : `runRestore` a lui-même échoué —
//     c'est LE trou principal (échec réel de restauration) ;
//   - result.ok && owned === false : la restauration a RÉUSSI mais
//     l'appropriation du dossier n'a pas pu être confirmée — variante « reprise
//     du dossier non confirmée », pas un échec ;
//   - result.ok && errors non vide SANS problème d'appropriation : PAS de modale
//     (aucune nouvelle variante visuelle décidée) ; les écarts rejoignent
//     seulement le rapport copiable quand une modale est ouverte à l'occasion.
// Les refus (`skipped`) restent sans publication : ce ne sont pas des erreurs
// techniques, et la garde venait d'être consultée avec succès.
//
// Publication AVANT `hide()` : la modale vit dans App.vue, elle survit à la
// fermeture de la porte — mais rien ne garantit l'ordre des réévaluations
// déclenchées par l'émission de `closed` (`onOnboardingFolderPromptClosed`
// côté App.vue re-consulte le plugin natif SAF) : publier d'abord, c'est
// garantir que le rapport existe déjà quand l'écran bouge. Le `path` transmis
// est le libellé fraîchement désigné (`res.label`) — pas un re-appel au plugin
// natif, qui pourrait échouer précisément dans le scénario d'erreur qu'on
// décrit ; null, le rapport dira « (inconnu) ».
function publishRestoreOutcome(outcome, folderPath) {
  if (!outcome) return
  const report = { path: folderPath ?? null, at: new Date().toISOString() }
  if (outcome.error) {
    useRestoreErrorStore().setReport({ kind: 'error', error: outcome.error, ...report })
    return
  }
  const result = outcome.result
  if (!result) return
  if (!result.ok) {
    // Refus (`skipped`) : pas une erreur technique, rien à publier. Erreur
    // explicite : l'échec de restauration même, jamais silencieux désormais.
    if (result.error) useRestoreErrorStore().setReport({ kind: 'error', error: result.error, ...report })
    return
  }
  if (result.owned === false) {
    useRestoreErrorStore().setReport({
      kind: 'unowned',
      error: null, // writeManifest rend `false` sans dire pourquoi — le rapport le suppose
      ...report,
      // Écarts `readBackup` éventuels : joints au rapport copiable TELS QUELS,
      // le compositeur (failure-report.js) les normalise.
      details: result.errors,
    })
  }
}

// Ouvre le sélecteur système. Trois issues, trois comportements :
//   - désignation réussie → on conclut ;
//   - sélecteur annulé (`granted: false`) → la porte reste, sans message : annuler n'est
//     pas une erreur, c'est un geste ;
//   - rejet (`confirmFolder` ne peut pas créer son propre dossier) → message SUR LA PORTE.
//     Avant ce lot, ce rejet n'était capté nulle part : promesse rejetée silencieuse.
async function onChooseNow() {
  if (choosing.value) return // un `:disabled` d'affichage ne protège pas d'un double-tap
  choosing.value = true
  failed.value = false
  // Ré-désignation du MÊME dossier : l'identité du dossier AVANT la
  // désignation. `folderKey()` (saf-folder.js) est l'URI de l'arbre SAF telle que
  // PERSISTÉE côté natif — `designateFolder()` la remplace par celle du dossier
  // choisi, c'est maintenant ou jamais pour la lire. Comparée APRÈS la désignation :
  // IDENTIQUE ⇒ c'est le même dossier, et `clearBackupDecision` effacerait
  // l'acquittement d'un dossier INCHANGÉ — pause « aucune décision » surprise,
  // bandeau bloquant pour rien, et « Restaurer » y refuserait (garde not-empty).
  // Le choix est donc : même clé ⇒ décision PRÉSERVÉE, porte refermée normalement.
  // `null` avant (permission déjà perdue) ou après (lecture en échec) ne peut jamais
  // égaler une clé d'après-désignation : on repasse alors par le chemin prudent, un
  // dossier qu'on n'a pas su identifier ne doit pas hériter d'un acquittement.
  // Lu seulement en mode change : au premier lancement, aucun acquittement ne peut
  // concerner le dossier à venir, l'effacement reste inconditionnel.
  let keyBefore = null
  if (mode.value === 'change') {
    try {
      keyBefore = await folderKey()
    } catch {
      keyBefore = null // repli prudent : identité illisible ⇒ on effacera (cf. ci-dessous)
    }
  }
  try {
    const res = await designateFolder()
    if (!res.granted) {
      // Sélecteur annulé. Premier lancement : la porte RESTE (comportement du
      // 09/08/2026, inchangé — rien ne dit à une utilisatrice du premier lancement
      // de repartir sans dossier, et l'écran reste sa seule sortie au retour).
      // Mode change : on REFERME sans message — annuler n'est pas une erreur, et
      // la porte n'a pas à retenir quelqu'un qui est venu d'elle-même.
      if (mode.value === 'change') closeWithoutConclusion()
      return
    }
    // Le chemin réel, seule occasion de le connaître (cf. designate-folder.js). Écrit
    // AVANT la récupération : celle-ci peut réécrire toute la base, et ce libellé décrit
    // l'appareil-ci, pas le contenu restauré. Jamais `null` en base — l'absence de clé
    // est ce que la section des Réglages sait lire (repli sur `folderName()`).
    if (res.label) {
      try {
        await setSetting('safFolderLabel', res.label)
      } catch {
        // Rattrapé à la prochaine désignation ; la ligne des Réglages se replie.
      }
    }
    // Nouveau dossier = décision à reprendre. AVANT la récupération, qui peut elle-même
    // poser la décision (récupérer l'acquitte) — l'effacer après effacerait la sienne.
    // Sauf ré-désignation du MÊME dossier en mode change : identité avant
    // et après identique ⇒ décision PRÉSERVÉE (le POURQUOI est au-dessus, à la lecture
    // de `keyBefore`) — un dossier inchangé garde son acquittement, sans pause
    // surprise ni bandeau pour rien.
    if (mode.value === 'change') {
      let keyAfter = null
      try {
        keyAfter = await folderKey()
      } catch {
        keyAfter = null // lecture en échec : on ne sait PAS identifier ⇒ on efface (prudent)
      }
      if (keyAfter === null || keyAfter !== keyBefore) await clearBackupDecision()
    } else {
      await clearBackupDecision()
    }
    // Les drapeaux d'INSTALLATION qui suivent ne se posent qu'au PREMIER LANCEMENT
    // (mode 'onboarding'). En mode change, l'installation existe déjà : ces drapeaux
    // ont été consommés ou pendent de leur propre acquittement — ne rien poser ici
    // n'efface rien, et leur sorte ne dépend en rien d'un changement de dossier.
    if (mode.value === 'onboarding') {
      // La bienvenue de l'accueil se pose ICI, AVANT `maybeRestoreAfterDesignation` ci-dessous
      // — jamais après (lot « ordre des pop-ups », 10/08/2026). Cette dernière peut RESTAURER
      // TOUTE LA BASE depuis une sauvegarde trouvée dans le dossier, réglages compris : une
      // utilisatrice qui désigne un dossier contenant une sauvegarde retrouve ses données,
      // elle n'est pas une nouvelle utilisatrice et ne doit pas voir « Tout est en place pour
      // commencer ». En posant le drapeau AVANT, une restauration qui a lieu l'efface
      // naturellement (les réglages restaurés priment sur ceux qu'on vient d'écrire, cf.
      // writeSnapshotToDb dans restore.js) — le bon comportement tombe tout seul, sans code
      // dédié pour distinguer les deux cas. Le poser APRÈS casserait exactement ce mécanisme :
      // la bienvenue s'afficherait alors même par-dessus des données restaurées.
      try {
        await settingsStore.setWelcomeDue()
      } catch {
        // Rattrapé, même esprit que `safFolderLabel` ci-dessus : la désignation elle-même a
        // réussi, la porte doit se fermer quand même. Au pire la bienvenue ne s'affiche pas
        // (repli silencieux) — jamais l'inverse, la porte bloquée par un indicateur d'accueil.
      }
      // DEUXIÈME BLOC `try`, ET NON UN SEUL POUR LES DEUX (lot du 19/08/2026). Groupés, un
      // échec de la première écriture emporterait la seconde : l'installation aurait la
      // bienvenue mais jamais l'avertissement d'import, et rien ne le rattraperait — ce
      // drapeau n'est posé qu'ICI, une fois dans la vie de l'installation. Deux blocs
      // séparés rendent les deux écritures indépendantes.
      //
      // Même moment que `setWelcomeDue()` ci-dessus, mais PAS la même garantie de repli sur
      // restauration — ⚠️ ne pas recopier l'argument « une restauration l'efface
      // naturellement » : il est vrai pour `welcomeDue` (restore-service.js écrit
      // explicitement `setSetting('welcomeDue', false)` après la fusion du snapshot) mais
      // FAUX ici, car rien d'équivalent n'existe pour `importCaveatDue`. Une sauvegarde
      // ANCIENNE (sans cette clé, cas d'Alexia) laisse donc le `true` posé ici survivre à la
      // fusion (`writeSnapshotToDb` ne remplace que les clés présentes dans la sauvegarde) —
      // l'avertissement s'affichera donc une fois, même pour une désignation suivie d'une
      // restauration. C'est voulu et conforme au commentaire de `importCaveatDue` dans
      // settings.js : ce drapeau ne s'efface qu'à l'acquittement de la pop-up,
      // jamais par un autre mécanisme — contrairement à `welcomeDue`, aucun cas particulier
      // n'est fait pour la restauration. Poser AVANT `maybeRestoreAfterDesignation` reste
      // néanmoins correct : si la sauvegarde restaurée est elle-même POSTÉRIEURE à ce lot et
      // porte déjà la clé (avertissement déjà acquitté sur l'appareil d'origine), la fusion
      // fait alors primer sa valeur sur le `true` local, sans code dédié pour distinguer les
      // deux cas.
      try {
        await settingsStore.setImportCaveatDue()
      } catch {
        // Même repli : au pire l'avertissement d'import ne s'affiche jamais sur cette
        // installation. Jamais la porte bloquée pour autant.
      }
    }
    // L'invitation est périmée depuis la désignation : le panneau bascule sur la
    // progression seule (cf. `restoring`). C'est ici que 33 Mo se lisent devant
    // quelqu'un qui vient d'installer l'app.
    restoring.value = true
    const report = beginSyncProgress('read')
    let restoreOutcome
    try {
      restoreOutcome = await maybeRestoreAfterDesignation(t, {
        onProgress: report,
        confirmRestore: askRestoreConfirmation,
      })
    } finally {
      endSyncProgress()
    }
    // Publication AVANT hide() — cf. publishRestoreOutcome : la modale vit dans
    // App.vue, elle survit à la porte, mais le rapport doit exister dès que
    // l'écran bouge (l'émission de `closed` déclenche des réévaluations).
    publishRestoreOutcome(restoreOutcome, res.label)
    hide()
  } catch {
    // Désignation impossible : on le DIT, et le bouton reste actionnable.
    failed.value = true
  } finally {
    choosing.value = false
  }
}

// Exposé à App.vue : le bouton retour du téléphone doit QUITTER l'app tant que la porte
// est là en mode premier lancement, jamais naviguer derrière elle (il n'y a pas de
// bouton de fermeture). Une ref exposée plutôt qu'un émit d'état : App.vue interroge au
// moment du geste, il n'a pas à maintenir une copie de cet état, qui divergerait.
// Complète le contrat : `mode` (lu par `folderGateHandlesBack` pour décider
// fermer ou quitter), `openForChange` (le pont Réglages → porte, consommé par le
// `watch` d'App.vue) et `closeFromBack` (la refermeture du mode change).
defineExpose({ visible, mode, openForChange, closeFromBack })
</script>

<template>
  <div
    v-if="hasSlot"
    class="ofp-overlay"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="restoring ? undefined : 'ofp-title'"
    :aria-describedby="restoring ? undefined : 'ofp-body'"
    @keydown="trapTabFocus"
  >
    <div class="ofp-overlay__panel">
      <!-- Règle des superpositions (cf. `restoring`) : pendant l'opération de dossier, l'invitation est retirée —
           périmée dès la désignation — et la progression reste SEULE au panneau ; la
           modale LocalRestoreOffer (z-index supérieur) est le message tant qu'elle est
           ouverte. Les aria de l'overlay suivent : leurs id disparaissent avec le titre
           et le corps, retirés du même geste. -->
      <template v-if="!restoring">
        <!-- En mode change, titre et corps adaptés — les textes du premier
             lancement (« Bienvenue ! » et un corps qui dit que l'app a besoin d'un
             dossier pour fonctionner) mentiraient à quelqu'un qui vient des Réglages
             avec une installation déjà en place. `failed` garde son message unique,
             valable dans les deux modes. (⚠️ Commentaire sans nom d'app : la garde
             « jamais le nom en dur dans un composant » balaye ce fichier.) -->
        <h2 id="ofp-title" class="ofp__title">
          {{ t(mode === 'change' ? 'safOnboarding.changeTitle' : 'safOnboarding.title') }}
        </h2>
        <p id="ofp-body" class="ofp__body">
          {{ t(mode === 'change' ? 'safOnboarding.changeBody' : 'safOnboarding.body') }}
        </p>
        <p v-if="failed" class="ofp__error" data-test="designate-error">
          {{ t('safOnboarding.failed') }}
        </p>
        <div class="ofp__actions">
          <!-- 06/09/2026, demande d'usage : un bouton Annuler pour abandonner
               l'opération — UNIQUEMENT en mode change. Au premier lancement, la
               porte reste sans issue par décision du 09/08 (aucune donnée sans
               dossier) : personne n'a à « annuler » une installation qui n'a pas
               commencé. Le geste est `closeWithoutConclusion` — le MÊME chemin
               qu'une annulation du sélecteur : aucune désignation, aucun message,
               aucune conclusion, Réglages prévenus par le pont (notifyGateClosed). -->
          <button
            v-if="mode === 'change'"
            class="btn"
            data-test="change-cancel"
            :disabled="choosing"
            @click="closeWithoutConclusion"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="btn btn--primary"
            data-test="choose-now"
            :disabled="choosing"
            @click="onChooseNow"
          >
            {{ t('safOnboarding.chooseNow') }}
          </button>
        </div>
      </template>
      <SyncProgressLine owner="inline" />
    </div>
  </div>
  <!-- L'offre de restauration locale, AU-DESSUS de la porte (z-index 1300) : elle
       naît pendant que la porte tient l'écran, juste après une désignation réussie.
       « Restaurer » résout l'attente en `true` (enchaîne `runRestore`) ; le refus
       « Perdre les données » — confirmé DANS la modale — émet `discard`, exécuté par
       `onRestoreDiscard` AVANT que l'attente ne soit résolue à `false`
       (`settleRestoreChoice`). -->
  <LocalRestoreOffer
    v-if="restoreOfferVisible"
    @restore="settleRestoreChoice(true)"
    @discard="onRestoreDiscard"
  />
</template>

<style scoped>
.ofp-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom));
}
.ofp-overlay__panel {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: var(--bg);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  box-shadow: var(--clay-sm);
}
.ofp__title {
  font-size: 18px;
  margin-bottom: var(--sp-2);
}
.ofp__body {
  color: var(--ink-55);
  font-size: 14px;
  margin-bottom: var(--sp-4);
}
.ofp__error {
  color: var(--danger);
  font-size: 13px;
  margin-bottom: var(--sp-3);
}
.ofp__actions {
  display: flex;
  gap: var(--sp-2);
  justify-content: flex-end;
}
</style>

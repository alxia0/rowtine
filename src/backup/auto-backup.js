// Rowtine — sauvegarde automatique débouncée sur mutation.
// Le hook Dexie (src/db/db.js) arme `scheduleAutoBackup()` à chaque écriture ;
// on coalesce les rafales de mutations en un seul appel à `runBackup()`
// (backup-service), avec un intervalle généreux (SAF est lent : `wait` = 8 s,
// `maxWait` = 30 s pour garantir un déclenchement pendant une rafale soutenue).
//
// Anti-boucle : un unique drapeau de
// suppression — compteur, pas booléen, pour supporter l'imbrication — empêche
// l'armement pendant `runBackup` lui-même (son `setSetting('lastBackupAt')`
// est aussi une écriture DB qui, sans suppression, se réarmerait
// indéfiniment) ET pendant `syncPatronMd` : fusionner un `patron.md`
// édité à la main écrit en DB, et si cela armait un backup, `backupAll`
// régénérerait `patron.md` depuis la DB et écraserait l'édition manuelle que
// cette synchronisation préserve volontairement.
//
// Correctif revue (exclusion mutuelle backup↔sync) : le drapeau de
// suppression ci-dessus ne bloque QUE l'ARMEMENT (`scheduleAutoBackup`). Un
// timer débouncé déjà armé AVANT le début d'une fenêtre de suppression tire
// quand même à échéance — y compris PENDANT cette fenêtre. Et `flushAutoBackup`
// (appelé à la mise en pause) est fire-and-forget : rien n'empêchait jusqu'ici
// le `runBackup` qu'il déclenche de tourner en même temps qu'une `syncPatronMd`
// démarrée juste après par un `resume`, les deux touchant le même dossier SAF.
// `callRunBackup` (le point d'exécution réel, pas seulement d'armement) gate
// donc désormais le TIR : suppression active → on réarme au lieu de tirer (la
// mutation en attente n'est pas perdue) ; `syncPatronMd` en cours (couvre
// aussi sa phase de lecture/hash, hors fenêtre de suppression) → idem, on
// réarme pour retenter après la fenêtre de synchro.
//
// Annonce des échecs d'écriture (« échec de sauvegarde automatique
// silencieux », décision produit du 05/09/2026) : jusqu'ici le compte rendu de
// `runBackup` était jeté sur le chemin AUTOMATIQUE — un échec d'écriture ne
// disait RIEN. Désormais lu en `.then` (PAS de await : le contrat debounce
// reste fire-and-forget, et la promesse renvoyée à l'appelant reste celle de
// `runBackup`), une issue `{ ok:false, error }` est loggée (précédent :
// run-patron-md-sync.js) ET publiée au store `backup-failure` qu'App.vue
// consomme (snackbar + rapport copiable). Les `skipped` restent silencieux :
// 'web' (pas de plateforme native) et 'permission' (aucun dossier désigné —
// cas résiduel documenté dans App.vue) ne sont pas des erreurs d'écriture, et
// 'restorable' est la pause voulue, déjà affichée par le bandeau/Réglages.
// (`runBackup` ne renvoie d'ailleurs QUE ces trois skipped : 'backup-running'
// est émis côté syncPatronMd, jamais par lui.)
import { debounce } from '@/utils/debounce'
// Drapeau « dossier propre depuis la restauration » (depuis le 06/09/2026). Import
// STATIQUE sans risque de cycle : restore-guard.js est un module d'état pur qui
// n'importe rien (même raison que pour patron-md-sync.js, cf. son en-tête).
import { isFolderCleanSinceRestore } from './restore-guard'

export const AUTO_BACKUP_WAIT_MS = 8000
export const AUTO_BACKUP_MAX_WAIT_MS = 30000

let suppressCount = 0

// Import dynamique (et non statique) de backup-service : backup-service
// importe `@/db/db` (pour `setSetting`), et `db.js` importe ce module (pour
// armer le hook sur mutation). Un `import` statique de backup-service ici
// refermerait le cycle db.js → auto-backup.js → backup-service.js → db.js dès
// l'évaluation des modules. En ne résolvant `runBackup` qu'au moment de
// l'appel débouncé (jamais pendant le chargement des modules), le cycle ne se
// referme jamais tant que db.js est en cours d'évaluation.
//
// `isSyncRunning` (patron-md-sync.js) est résolu de la même façon, paresseuse :
// patron-md-sync.js importe déjà `suppressAutoBackup` de CE module de façon
// statique ; un import statique de patron-md-sync.js ICI refermerait un cycle
// à deux nœuds (auto-backup.js ↔ patron-md-sync.js) dès l'évaluation des
// modules. L'import dynamique ne s'exécute qu'au moment du tir du debounce,
// bien après que les deux modules sont chargés — aucun cycle à l'évaluation.
//
// Pas de mise en cache manuelle du résultat de `import()` : le registre de
// modules ES la fait déjà nativement — un second `import()` d'un module déjà
// évalué ne re-fetch ni ne ré-évalue, il renvoie le même module.
async function callRunBackup() {
  if (isAutoBackupSuppressed()) {
    debouncedBackup()
    return
  }
  if (isFolderCleanSinceRestore()) {
    // La base est l'image exacte du dossier depuis la restauration de cette session
    // et rien n'a muté depuis : un passage ne relirait que du déjà-lu. Silencieux
    // par convention (`skipped` sans `error` ne se publie jamais — cf. en-tête).
    // Contrairement aux deux gardes ci-dessous, PAS de ré-armement : rien n'est en
    // attente à préserver (toute écriture effacerait le drapeau, cf. hook Dexie de
    // db.js), et la prochaine vraie mutation réarmera d'elle-même.
    return undefined
  }
  const { isSyncRunning } = await import('./patron-md-sync')
  if (isSyncRunning()) {
    debouncedBackup()
    return
  }
  const { runBackup } = await import('./backup-service')
  // Promise.resolve : identité conservée quand runBackup renvoie une promesse
  // (le cas réel), normalisation sinon — un `runBackup()` sans valeur de retour
  // (mock de test, futur appelant bizarre) ne doit pas casser la lecture du
  // compte rendu.
  return Promise.resolve(runBackup()).then((res) => {
    // Seul un échec d'ÉCRITURE se déclare : `res.error` est la signature de la
    // capture finale de `runBackupSerialized` (backup-service.js). Les
    // `skipped` (cf. en-tête) et un `res` absent (appelant bizarre) passent
    // sans un bruit, inchangés.
    if (res && res.ok === false && res.error) {
      console.error('[auto-backup] échec de l’enregistrement automatique des données', res.error)
      // Publication détachée VOLONTAIREMENT (pas d'await, pas de retour de la
      // promesse) : l'appelant du debounce ne doit ni attendre la publication
      // ni hériter de ses failures possibles — cf. les try/catch internes.
      publishAutoBackupFailure(res.error)
    }
    return res
  })
}

// Publie l'échec au store `backup-failure` (consommé par App.vue). TOUT est
// importé dynamiquement ICI, dans le `.then`, jamais en tête de module :
// auto-backup.js est chargé par db.js dès l'ouverture de la base, donc
// potentiellement AVANT l'installation de Pinia et sans droit à une dépendance
// statique vers elle (ni vers `@/db/db`, qui le charge — cf. en-tête) ; au
// moment du tir du debounce tout est chargé et l'`import()` tombe sur le cache.
//
// Ne lève JAMAIS : chaque await est sous son propre filet. Un échec de
// publication (Pinia pas encore actif, réglage illisible) laisse le
// console.error ci-dessus comme seule trace — ce qui reste infiniment mieux
// que le silence intégral d'avant cette annonce.
async function publishAutoBackupFailure(error) {
  // Chemin du dossier pour le message : même composition que la ligne des
  // Réglages (`folderDisplayPath` = réglage `safFolderLabel`, repli
  // `folderName()` — cf. saf-folder-label.js). Null (plugin absent, réglage
  // illisible) : App.vue dira « un dossier inconnu » plutôt que de mentir.
  let path = null
  try {
    const { folderDisplayPath } = await import('./saf-folder-label')
    path = await folderDisplayPath()
  } catch {
    // Repli déjà null : le rapport restera publishable quoi qu'il arrive.
  }
  try {
    const { useBackupFailureStore } = await import('@/stores/backup-failure')
    useBackupFailureStore().setFailure({ error, path, at: new Date().toISOString() })
  } catch {
    // Pas de Pinia active (module évalué avant l'app ?) : publication
    // impossible, on l'assume — jamais d'exception qui remonte ici.
  }
}

const debouncedBackup = debounce(callRunBackup, AUTO_BACKUP_WAIT_MS, {
  maxWait: AUTO_BACKUP_MAX_WAIT_MS,
})

export function isAutoBackupSuppressed() {
  return suppressCount > 0
}

// Armé par le hook Dexie à chaque mutation persistée. No-op pendant une
// suppression active (cf. tête de fichier).
export function scheduleAutoBackup() {
  if (isAutoBackupSuppressed()) return
  debouncedBackup()
}

// Envoie immédiatement un backup en attente (utilisé à la mise en pause de
// l'app : on ne veut pas perdre jusqu'à `wait` ms de mutations non
// sauvegardées si l'app est tuée en arrière-plan).
export function flushAutoBackup() {
  debouncedBackup.flush()
}

// Exécute `asyncFn` avec l'armement du debounce désactivé ; compteur (pas
// booléen) pour rester correct si des suppressions s'imbriquent (ex. un appel
// à `runBackup` déclenché DURANT une `syncPatronMd` déjà suppressée) —
// restauré en `finally` même si `asyncFn` lève.
export async function suppressAutoBackup(asyncFn) {
  suppressCount += 1
  try {
    return await asyncFn()
  } finally {
    suppressCount -= 1
  }
}

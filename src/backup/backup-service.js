// Rowtine — service de sauvegarde runtime. Sélectionne le stockage SAF (Capacitor), vérifie la
// permission (sans la redemander — la demande est un geste explicite dans les
// Réglages), orchestre collecte + écriture, et horodate la dernière sauvegarde.
import { Capacitor } from '@capacitor/core'
import { SafBackupStorage } from './saf-storage'
import { hasFolder } from './saf-folder'
import { collectBackupData } from './collect'
import { backupAll } from './orchestrator'
import { setSetting } from '@/db/db'
import { suppressAutoBackup } from './auto-backup'
import { hasBackup } from './restore'
import { recordBackupDecision } from './backup-decision'
import { writeManifest } from './backup-manifest'

// Sélectionne le stockage : SAF si un dossier est désigné, sinon null
// (web/dev, ou natif sans dossier désigné). Le repli MANAGE (héritage) a été
// retiré — le backend natif reste présent (`native-storage.js`)
// mais n'est plus utilisé nulle part ; sa suppression est prévue séparément. Async car
// `hasFolder()` interroge le plugin natif.
export async function getBackupStorage() {
  if (!Capacitor.isNativePlatform()) return null
  if (await hasFolder()) return new SafBackupStorage()
  return null
}

// Garde de permission unifiée : SAF est autorisé dès qu'un dossier est désigné
// (hasFolder implique la permission persistée). Le repli sur la permission
// MANAGE (« accès à tous les fichiers ») a été retiré.
export async function getBackupPermissionOk() {
  return hasFolder()
}

// Exécute une sauvegarde complète.
// - Pas de stockage natif (web/dev, ou natif sans dossier SAF désigné) → { ok:false, skipped:'web' }.
// - Dossier SAF non désigné → { ok:false, skipped:'permission' }
//   (on ne demande PAS la désignation ici : c'est un geste explicite proposé dans les Réglages).
// - Sinon : collecte le snapshot, écrit l'arborescence, horodate `lastBackupAt`.
// - Toute erreur en cours de route → { ok:false, error } (jamais d'exception qui remonte).
// `force` est accepté pour l'appel manuel (bouton « Sauvegarder maintenant ») —
// réservé pour un usage futur ; aucune sauvegarde n'est throttlée à ce niveau.
//
// Correctif revue (exclusion mutuelle backup↔sync) : drapeau
// « une sauvegarde tourne actuellement » — vrai le temps de l'exécution
// RÉELLE de `runBackup` (n'importe quel déclencheur : tir de debounce, flush à
// la pause, appel explicite « Sauvegarder maintenant »), faux sinon, remis en
// `finally`. Consommé par `syncPatronMd` (patron-md-sync.js) pour ne jamais
// démarrer une synchro pendant qu'une sauvegarde touche encore le dossier SAF
// (les deux écrivent/lisent la même arborescence — jamais concurrent).
let backupRunning = false

// SÉRIALISATION DES SAUVEGARDES (correctif revue de l'écriture par tranches).
// `backupRunning` ne servait qu'à ÉCONDUIRE une synchro MD ; rien n'empêchait deux
// `runBackup` de tourner en même temps. Le débounce ne couvre qu'un seul chemin
// (`isAutoBackupSuppressed`), pas les deux appelants DIRECTS de « Repartir de zéro »
// (SafFolderSection, BackupDecisionPrompt), dont le verrou local ne pare qu'un
// double clic sur SON propre bouton.
//
// C'était bénin AVANT le tranchage : deux `writeFile` concurrents sur `laines.json`,
// le dernier gagnait, le fichier restait COMPLET. Depuis, les deux passes partagent
// `laines.json.part` — A crée et écrit A0 ; B efface le .part de A et écrit B0 ; A
// ajoute A1 par-dessus B0 (son décalage retombe juste, la garde de séquence ne voit
// rien) ; B est éconduit ; A publie `B0+A1+A2` SOUS LE NOM FINAL. `readRootJson` lève
// alors sur un JSON mélangé et la restauration échoue EN ENTIER — exactement ce que
// cette sérialisation prétend rendre impossible.
//
// SÉRIALISER, pas éconduire : `overwriteBackup: true` est un geste destructeur
// explicite, confirmé par une boîte de dialogue — il ne doit pas devenir un no-op
// silencieux parce qu'une sauvegarde automatique passait par là. Chaîne de promesses
// plutôt que drapeau + attente : deux attentes réveillées par le même drapeau
// repartiraient ENSEMBLE, ce que ce correctif doit justement empêcher. Le maillon
// avale l'échec des deux côtés — une sauvegarde ratée ne doit pas empoisonner toutes
// les suivantes.
let backupChain = Promise.resolve()

// Import dynamique de patron-md-sync (et non statique) : patron-md-sync.js
// importe déjà `isAutoBackupRunning` de CE module de façon statique (voir son
// en-tête) — un import statique symétrique ici refermerait le cycle
// backup-service.js ↔ patron-md-sync.js dès l'évaluation des modules. En ne
// résolvant `isSyncRunning`/`whenSyncIdle` qu'au moment de l'appel (jamais
// pendant le chargement), le cycle ne se referme jamais tant que les modules
// sont en cours d'évaluation (même stratégie que `callRunBackup` dans
// auto-backup.js).

export function isAutoBackupRunning() {
  return backupRunning
}

// Anti-boucle : les écritures DB propres à la sauvegarde tournent sous
// `suppressAutoBackup` (pas la collecte ni l'écriture SAF, cf.
// `runBackupSerialized`) — `setSetting('lastBackupAt')` ci-dessous est lui-même
// une écriture DB qui, sans cette suppression, réarmerait indéfiniment la
// sauvegarde débouncée via le hook Dexie (`src/db/db.js`).
export function runBackup(options = {}) {
  // Le rang dans la file est pris SYNCHRONEMENT, à l'appel : deux appels lancés dans
  // le même tour de boucle d'événements ne peuvent pas se retrouver côte à côte.
  // L'appelant reçoit SA promesse (`run`), pas la queue de chaîne — les deux écrans
  // qui lisent `res.ok` gardent donc bien leur propre résultat.
  const run = backupChain.then(() => runBackupSerialized(options))
  // Le maillon avale l'échec DES DEUX CÔTÉS, et c'est lui qui porte la garantie.
  // `runBackupSerialized` rattrape presque tout en interne et RÉSOUT `{ ok:false }` —
  // mais pas la résolution du module de synchro ni l'attente de `whenSyncIdle` : elles
  // vivent bien dans son `try` (dont le `finally` relâche `backupRunning`), mais ce
  // `try` n'a PAS de `catch`, donc elles rejettent pour de bon. Sans `() => {}`, la
  // chaîne resterait rejetée et la sauvegarde SUIVANTE serait refusée sans même être
  // tentée : une seule anomalie passagère condamnerait toutes les sauvegardes de la
  // session.
  //
  // Pas de second gestionnaire sur `backupChain.then(…)` en revanche : il serait
  // INATTEIGNABLE puisque ce maillon-ci ne rejette jamais. Du code mort qui aurait
  // l'air d'une garde.
  backupChain = run.then(
    () => {},
    () => {},
  )
  return run
}

async function runBackupSerialized({ force = false, overwriteBackup = false, onProgress } = {}) {
  void force
  // Correctif revue finale (Important) : l'ancienne garde n'existait que côté
  // `callRunBackup` (chemin debounce/flush) — un appelant DIRECT de
  // `runBackup` (ex. bouton « Synchroniser maintenant », SafFolderSection.vue)
  // la contournait et pouvait tourner PENDANT une synchro MD en cours sur le
  // même dossier SAF. En posant la garde ICI, à l'entrée même de `runBackup`,
  // TOUT appelant (présent ou futur) en bénéficie — défense en profondeur,
  // la garde de `callRunBackup` reste en place par ailleurs.
  // ⚠️ LE DRAPEAU EST POSÉ AVANT L'ATTENTE, PAS APRÈS (correctif de revue).
  // L'ordre inverse laissait grande ouverte la fenêtre que cette garde existe pour
  // fermer : `whenSyncIdle()` ne promet que « plus aucune synchro À CET INSTANT ».
  // Entre sa résolution et la pose du drapeau, `syncPatronMd` — qui n'est éconduite
  // que par `isAutoBackupRunning()`, encore faux — pouvait démarrer un nouveau
  // passage, et sauvegarde et synchro repartaient ensemble sur la MÊME arborescence
  // SAF. En posant le drapeau d'abord, toute synchro tentée pendant l'attente est
  // éconduite (`skipped:'backup-running'`) : la fenêtre n'existe plus.
  backupRunning = true
  try {
    const { isSyncRunning, whenSyncIdle } = await import('./patron-md-sync')
    if (isSyncRunning()) await whenSyncIdle()
    // SUPPRESSION EN DEUX MORCEAUX, PAS AUTOUR DE TOUT LE PASSAGE. Elle n'existe que
    // pour les écritures DB de la sauvegarde ELLE-MÊME (`lastBackupAt`, décision,
    // identifiant d'appareil créé au premier appel) — cf. `runBackup`. Posée autour de
    // la collecte et de l'écriture SAF (des dizaines de secondes), elle avalait aussi les
    // mutations de l'utilisatrice faites PENDANT ce temps : postérieures à la collecte,
    // absentes du snapshot, et jamais programmées (`scheduleAutoBackup` sort sans rien
    // armer sous suppression) — le dossier restait sur l'état antérieur jusqu'à la
    // mutation suivante, `flushAutoBackup` n'ayant rien à envoyer à la mise en veille.
    // Hors suppression, une telle mutation arme le débounce, et le passage suivant
    // prend son rang dans `backupChain` derrière celui-ci.
    try {
      const pre = await suppressAutoBackup(async () => {
        const storage = await getBackupStorage()
        if (!storage) return { done: { ok: false, skipped: 'web' } }
        if (!(await getBackupPermissionOk())) return { done: { ok: false, skipped: 'permission' } }

        // Garde anti-écrasement. Posée ICI, à l'entrée du
        // point destructeur, et non dans `callRunBackup` : l'en-tête de ce fichier
        // documente que la garde d'exclusion backup↔sync avait fait cette erreur et
        // était contournée par les appelants directs. Ici, les quatre déclencheurs la
        // traversent — minuterie débouncée, `flushAutoBackup` à la mise en veille,
        // bouton « Synchroniser maintenant », et tout appelant futur.
        //
        // `overwriteBackup` est la SEULE porte de sortie (bouton « Repartir de zéro »,
        // avec confirmation). ⚠️ `force` ne l'ouvre PAS : il est déjà passé par
        // « Synchroniser maintenant », qui doit rester soumis à la garde.
        const { isBackupPaused } = await import('./backup-pause')
        if (!overwriteBackup && (await isBackupPaused(storage))) {
          return { done: { ok: false, skipped: 'restorable' } }
        }

        // Le dossier était-il vide AVANT cette écriture ? Décisif : c'est le seul cas
        // où la sauvegarde a le droit d'écrire sans décision préalable, et donc le seul
        // où il faut en poser une — sinon le dossier qu'on vient de remplir bloquerait
        // toutes les sauvegardes suivantes (« pause définitive en silence », re-revue
        // finale du 04/08). C'est cet appareil qui vient de créer ce contenu : la
        // décision ne fait qu'enregistrer ce qui est déjà vrai.
        //
        // `overwriteBackup` court-circuite CETTE lecture aussi, pas seulement l'écriture
        // de la décision ci-dessous : ce chemin pose déjà la sienne côté appelant
        // (`SafFolderSection.startFresh`, `BackupDecisionPrompt.onStartFresh`), donc le
        // résultat ne servirait à rien — et la porte de secours ne doit pas gagner un
        // nouveau mode d'échec (une erreur de LECTURE sur `hasBackup` ferait échouer une
        // écriture qui, elle, aurait réussi).
        const folderWasEmpty = overwriteBackup ? false : !(await hasBackup(storage))
        return { storage, folderWasEmpty }
      })
      if (pre.done) return pre.done
      const { storage, folderWasEmpty } = pre

      const snapshot = await collectBackupData()
      await backupAll(storage, snapshot, { onProgress })

      return await suppressAutoBackup(async () => {
        await setSetting('lastBackupAt', new Date().toISOString())

        // Fiche d'identité (depuis le 06/08/2026) — écrite EN DERNIER, exprès : sa date doit
        // être celle de CETTE écriture, pas celle du cycle précédent que porte
        // `reglages.json` (cf. l'en-tête de backup-manifest.js). Placée après
        // `backupAll`, elle est aussi hors d'atteinte de `reconcile`, qui ne balaie que
        // `Projets/` et `Patrons/`.
        //
        // `writeManifest` ne lève jamais et renvoie `false` en cas d'échec : une fiche
        // manquante ne doit pas faire échouer une sauvegarde qui a réussi. Elle sera
        // réécrite au cycle suivant ; entre-temps l'écran dira « origine inconnue »,
        // ce qui est exactement vrai. Le try/catch est une seconde ceinture, identique à
        // celle de `recordBackupDecision` ci-dessous : rien de ce qui suit une sauvegarde
        // réussie n'a le droit de la transformer en échec.
        try {
          await writeManifest(storage)
        } catch {
          // Rattrapé au prochain passage — cf. commentaire ci-dessus.
        }

        // ⚠️ Ne doit JAMAIS faire échouer une sauvegarde qui a réussi : `recordBackupDecision`
        // peut lever (base illisible) ou renvoyer `false` (dossier non identifiable) — dans
        // les deux cas, on continue. Le cas se rattrapera à la sauvegarde suivante (le
        // dossier ne sera plus vide, mais la ligne des Réglages et le bandeau prendront
        // le relais).
        if (folderWasEmpty) {
          try {
            await recordBackupDecision()
          } catch {
            // Rattrapé au prochain passage — cf. commentaire ci-dessus.
          }
        }

        return { ok: true }
      })
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  } finally {
    backupRunning = false
  }
}

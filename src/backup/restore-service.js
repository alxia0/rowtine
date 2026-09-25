// Rowtine — service de restauration runtime. Sélectionne le stockage natif (mêmes règles que
// backup-service.js), vérifie la permission (sans la demander — geste explicite
// dans les Réglages ou après proposition au 1er lancement), lit l'arborescence
// de sauvegarde, réécrit la base Dexie, puis recharge les stores Pinia globaux
// pour que l'UI reflète immédiatement les données restaurées.
import { getBackupStorage, getBackupPermissionOk } from './backup-service'
import {
  beginRestore,
  endRestore,
  isRestoreRunning,
  markFolderClean,
} from './restore-guard'
import { hasBackup, readBackup, writeSnapshotToDb } from './restore'
import { suppressAutoBackup } from './auto-backup'
import { clearBackupDecision, recordBackupDecision } from './backup-decision'
import { writeManifest } from './backup-manifest'
import { db, getSetting, setSetting } from '@/db/db'
import i18n from '@/i18n'
import { detectDeviceLocale } from '@/utils/app-locale'
import { getSeededSampleIds } from '@/utils/seeded-samples'
import { isLibraryPattern } from '@/utils/pattern-price'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore } from '@/stores/projects'
import { useYarnsStore } from '@/stores/yarns'
import { usePurchasesStore } from '@/stores/purchases'
import { useSettingsStore } from '@/stores/settings'
import { useTrashStore } from '@/stores/trash'
import { useActiveSessionStore } from '@/stores/activeSession'

// Recharge tous les stores Pinia qui exposent un `load()` global (les stores
// « par projet » — sections/counters/sessions — se rechargeront d'eux-mêmes à la
// prochaine navigation, pas besoin de les toucher ici). `activeSession` relit le
// réglage `activeSession`, préservé tel quel par `writeSnapshotToDb` (clé exclue
// de la sauvegarde) — le recharger est donc un no-op fonctionnel, fait par
// cohérence avec les autres stores globaux. `purchases` (correctif remonté par la
// revue, budget laine cumulé) manquait à
// cette liste : sans lui, l'écran Dépenses — premier et seul consommateur de ce
// store — afficherait un budget périmé juste après une restauration.
async function reloadStores() {
  const settingsStore = useSettingsStore()
  await Promise.all([
    usePatternsStore().load(),
    useProjectsStore().load(),
    useYarnsStore().load(),
    usePurchasesStore().load(),
    settingsStore.load(),
    useTrashStore().load(),
    useActiveSessionStore().load(),
  ])
  // Correctif (bloquants avant diffusion, 01/08) : `settingsStore.load()`
  // ci-dessus recharge bien `settings.locale` depuis la base restaurée, mais ne
  // touchait jamais `i18n.global.locale` — l'interface restait affichée dans
  // l'ANCIENNE langue jusqu'au redémarrage suivant. Même geste que
  // `SettingsView::setLocale` et que le garde `beforeEach` de router/index.js.
  i18n.global.locale.value = settingsStore.locale || detectDeviceLocale()
}

// Exécute une restauration complète depuis l'arborescence de sauvegarde.
// - Pas de stockage natif (web/dev) → { ok:false, skipped:'web' }.
// - Permission absente (dossier SAF non désigné) → { ok:false, skipped:'permission' }
//   (on ne la demande PAS ici : c'est un geste explicite, cf. UI Réglages).
// - Aucune sauvegarde présente sur le stockage → { ok:false, skipped:'empty' }.
// - Sinon : lit l'arbo (readBackup), réécrit la base (writeSnapshotToDb — clear+bulkPut,
//   ids d'origine préservés), recharge les stores Pinia globaux.
// Toute erreur en cours de route → { ok:false, error } (jamais d'exception qui remonte).
// Succès avec appropriation non confirmée (cf. le bloc `writeManifest`)
// → { ok:true, decided, owned:false } — même convention que `decided`/`errors` :
// la clé n'existe QUE quand il y a quelque chose à dire.
// Restauration incomplète (écarts consignés par `readBackup`) → { ok:true, decided:false,
// owned:false, errors } : ni appropriation ni décision, la sauvegarde reste en pause.
//
// Anti-boucle : `readBackup` + `writeSnapshotToDb` + `reloadStores`
// tournent TOUS sous `suppressAutoBackup` — pas seulement les deux derniers.
// Raison initiale : réécrire toutes les tables armerait la sauvegarde débouncée
// (hook Dexie) juste après une restauration, un aller-retour inutile (les données
// restaurées sont par définition déjà celles du dossier de sauvegarde).
//
// Correctif (revue du 04/08/2026) : `readBackup` se trouvait
// À L'EXTÉRIEUR de `suppressAutoBackup` — sur 34 Mo, c'est de loin la phase la
// plus longue de `runRestore`, largement plus que `writeSnapshotToDb`. Scénario
// constaté (le mécanisme même du sinistre du 04/08) : une
// mutation en Réglages arme une sauvegarde débouncée (8 s) ; `window.confirm` gèle
// les minuteries pendant que l'utilisatrice lit puis accepte, plus de 8 s après ;
// la minuterie part au tout premier `await` suivant — c'est-à-dire PENDANT
// `readBackup` si celui-ci reste hors de la fenêtre — et `backupAll` réconcilie le
// dossier contre la base courante, supprimant les dossiers de projets pendant
// qu'on est en train de les lire. Vérifié dans `auto-backup.js` avant ce correctif :
// `callRunBackup` teste `isAutoBackupSuppressed()` au moment du TIR (pas de
// l'armement) et réarme au lieu de tirer si la suppression est active — une
// minuterie déjà en attente ne peut donc PAS s'exécuter pendant la fenêtre, à
// condition que la fenêtre couvre bien toute la durée à risque, lecture comprise.
// Ré-export : `isRestoreRunning` vit dans `restore-guard.js` (module sans dépendance,
// cf. son en-tête pour la raison), mais reste lisible depuis ce service — les appelants
// qui ont déjà `restore-service.js` sous la main n'ont pas à connaître ce détail.
export { isRestoreRunning }

export async function runRestore({ onProgress, notifyRestored } = {}) {
  // Drapeau « restauration en cours » posé AVANT tout traitement — y compris les quatre
  // refus rapides ci-dessous, qui font chacun un aller-retour `await` vers le stockage
  // ou la base — et relâché dans le `finally` qui referme TOUTE la fonction (y compris
  // l'enregistrement de la décision, hors du try principal). Ré-entrance : une seconde
  // restauration pendant qu'une première tourne est refusée plutôt que de courir en
  // parallèle sur la même arborescence.
  if (isRestoreRunning()) return { ok: false, skipped: 'restore-running' }
  beginRestore()
  try {
    return await runRestoreInner({ onProgress, notifyRestored })
  } finally {
    endRestore()
  }
}

async function runRestoreInner({ onProgress, notifyRestored }) {
  let restoreErrors = []
  // Appropriation du dossier (cf. le bloc `writeManifest` ci-dessous pour le
  // pourquoi) : déclarée AU RANG DE LA FONCTION — et pas dans le try ni dans la
  // fenêtre `suppressAutoBackup` — parce que c'est le RÉSULTAT de `runRestore`
  // qui la porte, lu après la fermeture des deux blocs.
  let owned = true
  try {
    const storage = await getBackupStorage()
    if (!storage) return { ok: false, skipped: 'web' }
    if (!(await getBackupPermissionOk())) return { ok: false, skipped: 'permission' }
    if (!(await hasBackup(storage))) return { ok: false, skipped: 'empty' }
    // Garde-fou final (défense en profondeur, correctif revue) : re-vérifie juste
    // avant l'écriture destructrice, au plus près du clear+bulkPut, que la base ne
    // contient rien que l'utilisatrice ait créé (base vide, OU seulement les
    // exemples semés au 1er lancement — correctif du 04/08/2026, cf. isDbRestorable
    // ci-dessus). Ferme la fenêtre entre l'affichage de l'offre et l'action de
    // l'utilisateur (la base a pu se remplir entre-temps — import PDF/IA, ajout
    // d'une laine) ET tout futur point d'appel qui oublierait de gater en amont.
    if (!(await isDbRestorable())) return { ok: false, skipped: 'not-empty' }

    await suppressAutoBackup(async () => {
      const snapshot = await readBackup(storage, { onProgress })
      // Écarts consignés par `readBackup` (dossier illisible, JSON malformé, entité
      // écartée — cf. restore.js). Remontés à l'appelant TELS QUELS : la restauration a
      // bien abouti, elle est simplement incomplète, et c'était autrefois un échec total.
      // Toujours PAS d'écran dédié (un message par écart demanderait quatre traductions
      // pour des cas hétérogènes) ; depuis cette décision, ils partent en revanche dans le
      // RAPPORT COPIABLE quand une variante de RestoreErrorDialog est ouverte à
      // l'occasion (cf. `details` dans failure-report.js).
      restoreErrors = snapshot.errors || []
      // RESTAURATION INCOMPLÈTE = LE DOSSIER N'EST PAS PRIS EN CHARGE (correctif revue
      // 1.3.2). Un dossier de projet ou de patron écarté, un fichier racine illisible
      // (laines.json, achats.json...) : la base restaurée ne contient pas ce que le
      // dossier contient. S'approprier le dossier et enregistrer la décision relancerait
      // la sauvegarde, dont la réconciliation (orchestrator.js) supprimerait les dossiers
      // absents de la base et réécrirait les fichiers racine vides : une restauration
      // partielle deviendrait une perte définitive. On restaure donc ce qui a pu être lu,
      // mais le dossier reste intact et la sauvegarde en pause ; l'appelant montre le
      // rapport d'écarts (variante `owned: false`). Tout écart compte, photo manquante
      // comprise : mieux vaut une pause de trop qu'un dossier effacé.
      const partial = restoreErrors.length > 0
      // Phase courte (écriture en base + rechargement des stores) : pas de total,
      // elle dure une seconde — un dénominateur y serait du bruit.
      onProgress?.({ phase: 'write', done: 0, total: 0 })
      await writeSnapshotToDb(snapshot)

      // CORRECTIF (revue finale, 10/08/2026) : `welcomeDue` est posé LOCALEMENT, à la
      // désignation du dossier — AVANT cet appel à `runRestore` (cf.
      // OnboardingFolderPrompt.vue::onChooseNow). `writeSnapshotToDb` (restore.js) FUSIONNE
      // les réglages restaurés avec ceux déjà en base au lieu de les remplacer, pour
      // préserver les clés absentes de la sauvegarde (EXCLUDED_SETTINGS_KEYS) : une
      // sauvegarde écrite AVANT ce lot ne porte aucune clé `welcomeDue`, donc le `true`
      // posé localement SURVIT telle quelle à la fusion. Sans cette ligne, l'accueil
      // mentirait après une restauration réussie (« Deux projets et des patrons d'exemple
      // t'attendent » sur un travail bien réel, retrouvé). On l'efface donc explicitement
      // ICI, entre l'écriture du snapshot et le rechargement des stores juste en dessous
      // (`reloadStores` relit `settings.welcomeDue` depuis la base via `settingsStore.load()`
      // — il faut que la base dise déjà `false` à ce moment-là).
      // ⛔ NE PAS ajouter `welcomeDue` à `EXCLUDED_SETTINGS_KEYS` (serialize.js) : ça ne
      // changerait rien ici — le drapeau ne vient pas de la sauvegarde, il est posé
      // localement, sur CET appareil, avant même que `readBackup` ne soit appelée.
      await setSetting('welcomeDue', false)
      // Message « tes données sont de retour » (lot du 06/09/2026) : la ligne
      // ci-dessus efface la bienvenue du semis à juste titre (elle décrirait des
      // exemples qui viennent d'être écrasés), mais sans celle-ci l'utilisatrice
      // n'avait PLUS AUCUN message après une restauration réussie. La valeur suit
      // `notifyRestored` — la porte du dossier est le seul chemin où la restauration
      // est le FIL du parcours (restore-on-designate.js, fin d'onboarding) — mais
      // l'ÉCRITURE est inconditionnelle : la clé n'est pas dans EXCLUDED_SETTINGS_KEYS
      // (serialize.js), un snapshot peut donc importer un `restoredDue: true` d'un
      // autre appareil ; sur le chemin qui n'arme PAS le message (bandeau des
      // Réglages, BackupDecisionPrompt.vue, `notifyRestored` absent), une écriture
      // conditionnelle laisserait ce `true` survivre à la restauration et la pop-up
      // « tes données sont de retour » s'ajouterait au snackbar que le bandeau
      // affiche déjà, en doublon. Écrire `false` ici neutralise ce résidu importé.
      // MÊME CONTRAT que `welcomeDue` juste au-dessus : écrit en base AVANT
      // `reloadStores()`, dont `settingsStore.load()` est le lecteur — écrit après,
      // le drapeau ne serait vu qu'au prochain démarrage. HomeView lit ce drapeau
      // pour basculer le contenu de la pop-up (clés `restore.*`) et l'efface à
      // l'acquittement avec `welcomeDue` (settings.js : `restoredDue`, jumeau du
      // présent geste).
      // Restauration incomplète : pas de « tout a été retrouvé », le rapport d'écarts
      // prend le relais.
      await setSetting('restoredDue', !!notifyRestored && !partial)

      // Projet et patron de la visite guidée (lot du 23/09/2026) : LOCAUX, exclus de la
      // sauvegarde (EXCLUDED_SETTINGS_KEYS, serialize.js) donc PAS écrasés par le snapshot
      // lors de la fusion ci-dessus — l'ancien id local survit tel quel, alors que
      // `projects`/`patterns` (tables REMPLACÉES, pas fusionnées) peuvent désormais porter,
      // au même id, un vrai projet ou patron importé de la sauvegarde. On les efface ICI,
      // comme `welcomeDue`/`restoredDue` juste au-dessus : `ensureTourProject`
      // (src/utils/tour-sample.js) traite `null` comme absent et retrouve — ou recrée — le
      // bonnet de démonstration au prochain appel, sans jamais rouvrir la visite sur un
      // projet de l'utilisatrice.
      await setSetting('tourProjectId', null)
      await setSetting('tourPatternId', null)
      // Même danger pour `seededSampleIds` (seeded-samples.js), mais SEULEMENT quand la
      // sauvegarde n'en porte pas (installation antérieure au 04/08/2026) : la valeur
      // LOCALE survit alors à la fusion et désignerait comme « exemples » des ids que les
      // tables remplacées attribuent désormais au travail de l'utilisatrice (voie b
      // d'`ensureTourProject`, `findReusablePattern`, `isDbRestorable`). Portée par le
      // snapshot, elle décrit les exemples restaurés avec lui : on la garde.
      if (!(snapshot.settings || []).some((s) => s?.key === 'seededSampleIds')) {
        await setSetting('seededSampleIds', null)
      }
      await reloadStores()

      // RESTAURER, C'EST PRENDRE POSSESSION DU DOSSIER (06/08/2026).
      // Sans cette ligne, la fiche du dossier continuerait de porter l'appareil
      // d'ORIGINE — celui d'où l'on vient de restaurer : `backupPauseReason`
      // (backup-pause.js) répondrait « other-device » à CHAQUE sauvegarde suivante de
      // cet appareil-ci, définitivement, en silence, et la seule porte agissante
      // affichée serait le bouton destructeur (« Repartir de zéro »). C'est le jumeau
      // exact du défaut de « pause définitive » trouvé le 04/08 en exécutant du code,
      // sur le chemin même que le guide promet (« tu réinstalles, tu redésignes ce
      // dossier, tout revient comme avant »).
      //
      // POURQUOI ICI, À L'INTÉRIEUR DE `suppressAutoBackup`, et pas après la fenêtre :
      // même raison que `readBackup`/`writeSnapshotToDb` (cf. l'en-tête de cette
      // fonction). Une écriture hors de la fenêtre laisserait une sauvegarde débouncée
      // déjà armée tirer et réconcilier le dossier pendant l'opération — le mécanisme
      // exact du sinistre du 04/08. Deux raisons concrètes plutôt qu'une : l'écriture
      // touche le dossier SAF, ET `deviceId()` (appelée par `buildManifest`) écrit
      // elle-même en base au tout premier appel, ce qui réarmerait le hook Dexie.
      //
      // POURQUOI APRÈS `writeSnapshotToDb` : les décomptes de la fiche (`contenu`) sont
      // lus dans la base — avant l'écriture du snapshot, ils décriraient la base d'AVANT
      // la restauration. Correctif de revue : PAS « zéro » comme je l'avais écrit, la
      // magnitude était fausse — `isDbRestorable` admet aussi une base ne contenant que
      // les exemples semés, soit 2 projets et 3 patrons dans le cas réaliste (celui d'un
      // téléphone neuf qui vient de passer l'écran d'accueil). Le fond tient, et c'est
      // lui qui compte : l'écran dont le seul rôle est de rassurer annoncerait les
      // décomptes du SEMIS au lieu de ceux du travail restauré — un chiffre faux est pire
      // qu'un chiffre absent sur cet écran-là.
      // L'identifiant, lui, reste bien celui de CET appareil : `deviceId` figure dans
      // EXCLUDED_SETTINGS_KEYS (serialize.js) — il ne part pas dans la sauvegarde — et
      // `writeSnapshotToDb` FUSIONNE les réglages en préservant les clés absentes du
      // snapshot (restore.js), au lieu de les effacer.
      //
      // ⚠️ CE CHEMIN-CI NE SE RATTRAPE PAS TOUT SEUL — c'est ce qui commande tout le
      // reste de ce bloc. Dans `backup-service.js`, une fiche non écrite est réécrite au
      // cycle suivant, parce que les sauvegardes continuent de tourner. Ici, non : si
      // l'appropriation échoue, le dossier porte toujours l'appareil d'origine, donc la
      // sauvegarde suivante est justement SUSPENDUE (`'other-device'`) — il n'y a pas de
      // « prochaine sauvegarde » pour rattraper quoi que ce soit. Et le cul-de-sac est
      // complet : le bandeau s'affiche, mais « Restaurer » refusera désormais
      // (`'not-empty'` — la base vient d'être remplie), ne laissant que le bouton
      // destructeur « Repartir de zéro ». Copier-coller le geste de `backup-service.js`
      // sans cette différence serait une fausse tranquillité au point le plus fragile.
      //
      // LE SEUL ÉCHEC ATTEIGNABLE EST LE `false`, PAS LA LEVÉE (correctif de revue).
      // `writeManifest` capture en interne : son contrat est de RENVOYER `false`, jamais
      // de lever. Jeter ce booléen — ce que faisait la première version de cette ligne —
      // revenait à protéger par try/catch un chemin que le contrat déclare impossible
      // tout en ne REGARDANT MÊME PAS le seul mode d'échec qui puisse réellement
      // survenir. On le lit donc, et on réessaie UNE fois.
      //
      // POURQUOI UN SEUL SECOND ESSAI, ET PAS PLUS. L'échec visé est une écriture SAF
      // transitoire sur un fichier de ~300 octets, juste après que des dizaines de Mo
      // viennent de s'écrire sans problème — un second essai le couvre. Au-delà, ce ne
      // serait plus un incident passager mais une permission perdue, qu'aucune
      // répétition ne réparerait : boucler ne ferait qu'allonger l'attente devant un
      // écran de restauration déjà terminée. Le second essai reste DANS
      // `suppressAutoBackup`, pour la même raison que le premier.
      //
      // `owned` (décision produit du 05/09/2026 — ferme le « CE QUI RESTE
      // OUVERT » d'avant) : quand les DEUX essais rendent `false`, la restauration reste
      // un succès — une fiche non écrite ne transforme jamais en échec une
      // restauration qui, elle, a intégralement réussi — mais elle n'est plus
      // SILENCIEUSE : le résultat porte `owned: false` et l'appelant le dit à
      // l'utilisatrice (RestoreErrorDialog, variante « reprise du dossier non
      // confirmée »). Sans ce drapeau, le cul-de-sac décrit plus haut restait entier :
      // le dossier porte l'appareil d'origine, la sauvegarde suivante est suspendue
      // (`'other-device'`), et rien ne l'expliquait nulle part. Une LEVÉE de
      // `writeManifest`, elle, reste hors contrat (cf. la seconde ceinture ci-dessous)
      // et ne pose PAS le drapeau : on ne sait pas ce qui s'est passé, on ne prétend
      // donc pas le décrire. Convention de remontée identique à `decided`/`errors` :
      // absent du résultat nominal, présent seulement quand il y a quelque chose à dire.
      if (partial) {
        owned = false
        // Une décision déjà présente pour ce dossier (re-désignation du même dossier,
        // qui la préserve) laisserait la sauvegarde tourner : on l'efface pour que la
        // pause soit certaine. Dans la fenêtre `suppressAutoBackup`, comme le reste.
        await clearBackupDecision()
        return
      }
      try {
        if (!(await writeManifest(storage))) {
          // Second et dernier essai. Sa valeur décide désormais de `owned` : les deux
          // essais en échec sont précisément le cas que l'utilisatrice doit voir.
          if (!(await writeManifest(storage))) owned = false
        }
      } catch {
        // Volontairement muet : ne rien faire vaut mieux que de faire échouer une
        // restauration réussie — mais ce n'est pas pour autant sans conséquence.
      }
    })
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }

  // Décision (avenant du 04/08/2026) : restaurer EST
  // le geste par lequel elle acquitte ce dossier. Remontée à l'appelant (`decided`)
  // — si l'enregistrement échoue, la base a bien été restaurée mais la sauvegarde
  // reste en pause : le dire vaut mieux que de la laisser croire que tout est réglé.
  //
  // HORS du try principal ci-dessus (déjà refermé) : une levée de `setSetting` ici
  // ne doit PAS faire renvoyer `{ ok: false }` sur une base intégralement restaurée
  // avec succès — `recordBackupDecision()` ne lève elle-même jamais (elle capture
  // en interne), le `try/catch` ci-dessous est une seconde ligne de défense.
  // Restauration incomplète : aucune décision enregistrée, aucun dossier déclaré propre
  // (cf. le bloc `partial` plus haut). La sauvegarde reste en pause.
  if (restoreErrors.length) return { ok: true, decided: false, owned: false, errors: restoreErrors }
  let decided
  try {
    decided = await recordBackupDecision()
  } catch {
    decided = false
  }
  // Le dossier et la base viennent d'être mis en image l'un de l'autre : les
  // passages automatiques qui suivent (synchro MD, auto-backup rebondi) ne
  // reliront que du déjà-lu (mesure 06/09 : ~255 s pour rien). Session only —
  // cf. restore-guard.js pour pourquoi ni manifeste ni réglage persistant.
  //
  // PLACEMENT — lu dans le code réel, il corrige l'intuition « à la fin du bloc
  // suppressAutoBackup ». Le DERNIER écrit en base de ce chemin de succès n'est pas
  // dans la fenêtre : c'est `recordBackupDecision()` ci-dessus (son `setSetting`
  // passe par le hook Dexie de db.js, qui efface le drapeau à toute mutation). Posé
  // avant lui, le drapeau serait effacé trois lignes plus loin — et l'armement de
  // sauvegarde qu'il déclenche relirait TOUT le dossier : le bug visé, intact. Posé
  // ICI, après lui, toute écriture suivante est une vraie mutation utilisateur —
  // exactement ce que le drapeau doit attendre pour se taire. Atteindre cette ligne
  // PROUVE que la restauration est allée au bout (`ok: true`) : les skips et le
  // catch général renvoient plus tôt.
  markFolderClean()
  // `errors` n'apparaît que s'il y a eu un écart (même règle que le snapshot de
  // `readBackup`) : le résultat d'une restauration nominale garde sa forme d'origine.
  // `owned: false` suit la même convention (cf. le bloc `writeManifest`) : absent du
  // chemin nominal, présent seulement quand la reprise du dossier n'a pas pu être
  // confirmée — c'est l'appelant qui le traduit en message (RestoreErrorDialog).
  const result = restoreErrors.length ? { ok: true, decided, errors: restoreErrors } : { ok: true, decided }
  if (!owned) result.owned = false
  return result
}

// Pure — GARDE-FOU UNIQUE contre une restauration destructrice :
// `writeSnapshotToDb` est un clear+bulkPut, jamais une fusion — le déclencher sur une
// base NON vide écraserait des données utilisateur actives (ce cas est le territoire
// de `syncPatronMd`, pas de la restauration). Vrai seulement si la base est vide ET
// qu'une sauvegarde est présente sur le stockage. Utilisée par les DEUX points de
// déclenchement possibles (offre au lancement, désignation de dossier) — jamais
// dupliquée.
export function shouldRestoreFromFolder({ empty, hasBackup }) {
  return !!empty && !!hasBackup
}

// Pure — décide de PROPOSER le choix au lancement (jamais de le déclencher).
//
// AVENANT (04/08/2026) : `!onboarded` a sauté. Il enfermait l'utilisatrice qui MET À
// JOUR l'app — déjà onboardée, dossier plein, aucune décision enregistrée (la clé est
// neuve) : sauvegarde en pause pour toujours, et aucun bandeau pour le lui dire. La
// condition est désormais « aucune décision prise pour ce dossier », ce qui est
// exactement l'état où le choix doit être posé.
//
// `empty` a sauté aussi, et c'est délibéré : conditionner l'offre à la restaurabilité
// masquait le bandeau à celle qui a DÉJÀ du travail réel — c'est-à-dire celle qui a le
// plus à perdre à ne rien sauvegarder. Le bandeau propose donc les DEUX gestes, et
// c'est `runRestore` qui refuse une restauration destructrice (sa garde finale
// `isDbRestorable`, inchangée), pas l'affichage du bandeau.
// Le bandeau s'affiche exactement quand la sauvegarde est en pause — quelle qu'en soit la
// raison. Avant le 06/08, ce prédicat testait `decided` pour son compte : la raison
// « un autre appareil a écrit ici » ne l'aurait jamais déclenché, et les écritures se
// seraient arrêtées sans que rien ne s'affiche. `hasBackup` a disparu de la signature :
// `pauseReason` vaut déjà `null` quand le dossier n'a pas de sauvegarde.
//
// `!= null` (et non `!== null`) exprès, correctif de revue : un appelant futur qui
// OMETTRAIT le paramètre passerait `undefined`, que `!== null` juge « en pause » — le
// bandeau s'afficherait sans raison. Latent aujourd'hui (App.vue est le seul appelant de
// production), mais deux caractères ferment le mode d'échec.
export function shouldOfferRestore({ pauseReason, granted }) {
  return !!granted && pauseReason != null
}

// Vrai si la base locale ne contient AUCUNE donnée utilisateur parmi celles que
// `writeSnapshotToDb` écrase (clear+bulkPut, cf. restore.js/REPLACED_TABLES) —
// PAS seulement « aucun projet » (correctif de revue) : une base
// sans projet peut malgré tout contenir des patrons de bibliothèque importés
// (PDF/IA, sans projet associé) ou des laines en stock, qu'une restauration
// écraserait silencieusement et irrémédiablement. Un patron `builtin` (le patron
// libre, toujours créé par `ensureFreePattern` au 1er lancement, cf. App.vue) ne
// compte PAS : sa présence seule ne rend pas la base « non vide ». Un patron
// d'instance de projet (`ownerProjectId != null`) non plus : il est déjà couvert
// transitivement par le test sur `projects`. Même prédicat que `seedable`/
// `libraryPatterns` (src/stores/patterns.js:38,81) — volontairement réutilisé,
// pas réinventé. Utilisée par les DEUX déclencheurs (offre au lancement dans
// App.vue, désignation de dossier dans `OnboardingFolderPrompt`) ET en garde
// finale dans `runRestore` ci-dessus.
export async function isDbEmpty() {
  if ((await db.projects.count()) > 0) return false
  const libraryPatterns = await db.patterns.filter(isLibraryPattern).count()
  if (libraryPatterns > 0) return false
  if ((await db.yarns.count()) > 0) return false
  // Compteurs INDÉPENDANTS (projectId === 0) : `writeSnapshotToDb` vide+réécrit la
  // table `counters`, donc une base ne contenant QUE des compteurs indépendants
  // (aucun projet/patron/laine) n'est PAS vide — sinon la restauration les
  // effacerait (correctif revue finale). Même requête que collect.js.
  if ((await db.counters.where('projectId').equals(0).count()) > 0) return false
  // Achats (correctif, budget laine cumulé) : `purchases` a rejoint
  // `REPLACED_TABLES` (restore.js) — une ligne d'achat peut survivre SANS laine
  // associée (suppression définitive d'une laine, orphelinage `yarnId: null`) :
  // elle n'est donc PAS transitivement couverte par le test sur `yarns`
  // ci-dessus. Sans cette ligne, une base ne contenant plus que de l'historique
  // d'achats orphelin serait jugée « vide » et une restauration l'effacerait
  // silencieusement.
  if ((await db.purchases.count()) > 0) return false
  return true
}

// Id du projet de la visite guidée (réglage local `tourProjectId`), réduit aux entiers
// strictement positifs comme `seededSampleIds`.
async function tourProjectIds() {
  const v = await getSetting('tourProjectId')
  const n = Number(v)
  return v !== null && v !== undefined && Number.isInteger(n) && n > 0 ? [n] : []
}

// Vrai si restaurer ne détruirait rien que l'utilisatrice ait créé : base
// strictement vide, OU ne contenant QUE les exemples semés au 1er lancement.
//
// Pourquoi cette fonction existe (04/08/2026) : le semis d'exemples remplit la
// base à la FIN de l'écran d'accueil, donc `isDbEmpty()` y est faux dès la
// première seconde. La restauration n'était alors JAMAIS proposée — et le guide
// promet pourtant « tu réinstalles, tu redésignes ce dossier, tout revient comme
// avant ». Constaté sur appareil : trois écrasements du dossier d'une
// utilisatrice réelle avant d'être diagnostiqué.
//
// Laines, achats et compteurs indépendants restent STRICTEMENT vides : le semis
// n'en crée aucun, leur présence signifie donc une action de l'utilisatrice.
//
// Correctif (auto-revue, avant commit) : contrairement à `isDbEmpty`, cette
// fonction laisse EXPRÈS des projets exister (les projets semés) — le
// raisonnement d'`isDbEmpty` (« sections/diagrams/sessions/compteurs par-projet
// sont couverts transitivement par le test sur `projects` ») ne tient donc plus
// ici : une utilisatrice qui a UNIQUEMENT travaillé sur le projet démo semé
// (ajouté un compteur de rangs, journalisé des sessions, cf. `ProjectsStore.remove`
// pour la liste des tables qui en dépendent) verrait ce travail réel effacé sans
// que rien ne le détecte. Les projets restant STRICTEMENT ceux du semis (vérifié
// juste en dessous), toute ligne dans ces tables leur appartient forcément
// (suppression de projet = cascade, jamais d'orpheline) — les tester en bloc
// suffit, sans avoir à croiser les `projectId`.
//
// Correctif (revue) : la progression la plus commune (rangs cochés dans le
// lecteur, sans jamais lancer le chrono) n'écrit AUCUNE ligne dans `sessions` —
// elle vit dans le champ `readerState` DU PROJET lui-même (cf. `ReaderView.vue`,
// `ProjectDetailView.vue::onToggleSection`, et `CorrectionView.vue` : « readerState
// vit sur le PROJET, jamais sur le patron »). Un projet semé peut donc porter du
// travail réel tout en restant une ligne de la table `projects` — comparer les
// projets par seule IDENTITÉ (id semé ou non) ne suffit pas, il faut aussi
// regarder CE QUE la ligne contient. `photos` suit le même raisonnement : `[]`
// au semis, non-vide seulement si l'utilisatrice en a ajouté une. `notes` n'est
// PAS testée ici : le semis y écrit déjà un texte de démonstration non vide
// (`texts.wip.notes`/`texts.idea.notes`, variable par langue) — sa seule
// non-vacuité ne distingue donc pas le texte semé d'une modification réelle.
export async function isDbRestorable() {
  // Corbeille AVANT le raccourci `isDbEmpty` (qui l'ignore) : une utilisatrice qui a
  // supprimé les exemples ET son propre travail a des tables vides mais une corbeille
  // pleine — `writeSnapshotToDb` la viderait, et ces éléments ne sont pas dans la
  // sauvegarde (dossiers listés dans `corbeille.json`, sautés par `readBackup`).
  if ((await db.trash.count()) > 0) return false
  if (await isDbEmpty()) return true

  const semis = await getSeededSampleIds()
  // Projet de la visite guidée : `recreateTourProject` (tour-sample.js) peut le recréer
  // hors du semis, sans l'inscrire dans `seededSampleIds`. `tourProjectId` ne désigne
  // jamais qu'un projet créé par l'app (semé, ou recréé par la visite) : on le tolère
  // comme un exemple, et les contrôles de travail réel ci-dessous s'appliquent à lui
  // comme aux projets semés.
  // PAS `tourPatternId` : il suit le patron lié au projet de la visite, que
  // l'utilisatrice peut relier à l'un de ses propres patrons (ProjectEditView). Le
  // tolérer ferait effacer ce patron par la restauration. Un patron recréé par la
  // visite garde donc la garde stricte (restauration refusée), le repli prudent.
  // Nouveaux tableaux, jamais `push` : le repli de `getSeededSampleIds` partage ceux
  // d'une constante de module.
  const seeded = {
    projects: [...semis.projects, ...(await tourProjectIds())],
    patterns: semis.patterns,
  }
  // Repli sûr : rien d'enregistré (installation antérieure, semis échoué) → on
  // s'en tient à la garde stricte, jamais plus permissif qu'avant.
  if (!seeded.patterns.length && !seeded.projects.length) return false

  if ((await db.yarns.count()) > 0) return false
  if ((await db.purchases.count()) > 0) return false

  const seededProjects = new Set(seeded.projects)
  const projects = await db.projects.toArray()
  if (projects.some((p) => !seededProjects.has(p.id))) return false
  // Progression écrite DANS la ligne du projet semé (pas dans une table à part) :
  // `readerState` (rangs/grilles/compteurs du lecteur) et `lastWorkedAt` (armé par
  // tout geste de progression, cf. `ReaderView.vue::writeSnap`) — aucun des deux
  // n'exige une session chronométrée (`sessions`). `photos` : `[]` au semis,
  // non-vide seulement si l'utilisatrice en a ajouté une sur la fiche.
  if (
    projects.some(
      (p) => (p.readerState && Object.keys(p.readerState).length > 0) || p.lastWorkedAt || p.photos?.length > 0,
    )
  )
    return false

  // Même filtre que `isDbEmpty` : ni patron `builtin` (patron libre), ni instance
  // de projet (forkée) — volontairement réutilisé, pas réinventé.
  const seededPatterns = new Set(seeded.patterns)
  const library = await db.patterns.filter(isLibraryPattern).toArray()
  if (library.some((p) => !seededPatterns.has(p.id))) return false

  // Progression réelle sur le projet démo semé qui, elle, vit bien dans une table
  // à part : diagrammes annotés, compteurs (indépendants ET par-projet — un seul
  // `count()` total, cf. revue : `.equals(0)`/`.notEqual(0)` laissaient invisible
  // une ligne au `projectId` non indexé, `undefined`/`null`, atteignable par
  // réinjection d'un ancien bundle de corbeille), sessions journalisées. `sections`
  // reste testée aussi (défense en profondeur) bien que plus aucun chemin de l'app
  // ne l'écrive (`replaceFromPattern`, seule à le faire, n'a plus d'appelant).
  // Aucune de ces tables n'est peuplée par le semis lui-même (cf.
  // `seedExamplesIfEmpty`, `seedSamplesIfEmpty`) — leur non-vacuité ne peut donc
  // venir que d'une action de l'utilisatrice.
  if ((await db.sections.count()) > 0) return false
  if ((await db.diagrams.count()) > 0) return false
  if ((await db.sessions.count()) > 0) return false
  if ((await db.counters.count()) > 0) return false

  // Corbeille : NON sauvegardée (cf. `writeSnapshotToDb`, `db.trash.clear()` sans
  // retour) — une laine/un patron/un projet supprimé mais encore récupérable y
  // deviendrait irrécupérable. Avant ce correctif, ce trou était INATTEIGNABLE :
  // les 2 projets semés rendaient `isDbEmpty()` faux pour toujours après l'accueil.
  // `isDbRestorable` le rend atteignable (base « semis seul » + un élément
  // supprimé) — garde ajoutée ICI seulement, `isDbEmpty` reste gelée.
  if ((await db.trash.count()) > 0) return false

  return true
}

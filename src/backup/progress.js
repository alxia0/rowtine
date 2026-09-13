// Rowtine — état de progression des opérations de dossier.
//
// PAS UN STORE PINIA, volontairement : rien ici ne survit à l'opération en cours, il
// n'y a rien à persister, rien à recharger, et aucun autre écran n'a à l'observer.
// Un objet réactif de trois champs est la bonne taille.
//
// N'EST ALIMENTÉ QUE PAR CE QUE L'UTILISATRICE A DEMANDÉ. La sauvegarde automatique de
// fond ne passe aucun `onProgress` (cf. orchestrator.js) et n'apparaît donc jamais ici
// — sinon l'interface clignoterait toutes les huit secondes pendant qu'elle tricote.
import { reactive } from 'vue'

// `phase` : 'backup' (écriture vers le dossier) | 'read' (lecture du dossier) |
// 'write' (réécriture de la base, courte et sans total).
//
// `owner` (correctif de revue) : QUI a ouvert
// l'opération — 'inline' (Réglages, invite de dossier du 1er lancement) ou 'app'
// (`BackupDecisionPrompt`, qui monte lui-même sa propre `<SyncProgressLine owner="app">`
// sous ses boutons — PAS le bandeau de App.vue, qui ne monte plus cette ligne du tout
// depuis que la progression a déménagé DANS le panneau du bandeau).
// `syncProgress` est un état global unique ; sans ce champ, une restauration lancée
// depuis le bandeau ferait apparaître DEUX barres si les Réglages sont ouverts en
// même temps — cf. SyncProgressLine.vue, qui ne rend que l'instance dont la prop
// `owner` correspond à ce champ.
export const syncProgress = reactive({
  active: false,
  phase: null,
  owner: null,
  done: 0,
  total: 0,
  written: 0,
  // Nom lisible de l'élément EN COURS d'import (phase `read` seulement, cf.
  // restore.js `readBackup`) : le libellé « Lecture… 12 sur 24 — <nom> » montre ce qui
  // se traite, pour que le délai soit vécu comme du travail. Chaîne vide = rien encore.
  current: '',
  // Sous-barre du dossier EN COURS (phase `read` seulement) : { file, done,
  // total } en octets — le fichier en cours nommé, le cumul du dossier rafraîchi à
  // CHAQUE tranche lue. null = pas de sous-barre : hors lecture, ou tailles inconnues
  // (DocumentFile.length() rend 0 chez certains fournisseurs SAF — on se masque, on
  // n'invente jamais une progression), repli propre sur le libellé `current` seul.
  sub: null,
})

// Ouvre une opération visible et renvoie le rapporteur à passer en `onProgress`.
// Remet TOUS les compteurs à zéro : sans cela, une opération courte hériterait des
// chiffres de la précédente et afficherait une barre déjà pleine avant d'avoir commencé.
export function beginSyncProgress(phase, owner = 'inline') {
  syncProgress.active = true
  syncProgress.phase = phase
  syncProgress.owner = owner
  syncProgress.done = 0
  syncProgress.total = 0
  syncProgress.written = 0
  syncProgress.current = ''
  syncProgress.sub = null
  return (evt) => {
    if (!evt) return
    syncProgress.phase = evt.phase ?? syncProgress.phase
    syncProgress.done = evt.done ?? syncProgress.done
    syncProgress.total = evt.total ?? syncProgress.total
    syncProgress.written = evt.written ?? syncProgress.written
    // Champ OPTIONNEL du contrat onProgress : absent (le `finally` de readBackup
    // ré-émet sans argument), on GARDE l'ancien — c'est le libellé du dossier EN
    // COURS de traitement, il doit rester affiché pendant qu'il se termine.
    syncProgress.current = evt.current ?? syncProgress.current
    // sub : sémantique en TROIS états, pas un simple `??` — `undefined`
    // (champ absent du contrat, entre deux dossiers) GARDE la valeur, `null`
    // (dossier sans tailles connues) la TUE, un objet (tranche réussie) la remplace.
    syncProgress.sub = evt.sub === undefined ? syncProgress.sub : evt.sub
  }
}

// À appeler dans un `finally` : l'indicateur doit disparaître même si l'opération lève.
export function endSyncProgress() {
  syncProgress.active = false
  syncProgress.phase = null
  syncProgress.owner = null
}

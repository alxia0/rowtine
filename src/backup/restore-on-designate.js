// Rowtine — restauration sur désignation de dossier.
// Extrait de OnboardingFolderPrompt.vue pour être PARTAGÉ avec
// SafFolderSection.vue (section Réglages « Changer de dossier ») —
// un seul point de vérité pour la garde destructive-safe (`shouldRestoreFromFolder` :
// jamais sur une base contenant quoi que ce soit que l'utilisatrice ait créé,
// cf. `isDbRestorable` dans restore-service.js — correctif du 04/08/2026, ce
// n'est plus « jamais sur une base non vide » au sens strict) et la confirmation
// explicite avant d'écraser quoi que ce soit, même sur base restaurable.
import { getBackupStorage } from './backup-service'
import { hasBackup } from './restore'
import { runRestore, shouldRestoreFromFolder, isDbRestorable } from './restore-service'
import { suppressAutoBackup } from './auto-backup'
import { beginRestoreDecision, endRestoreDecision } from './restore-guard'

// Propose puis déclenche (si acceptée) une restauration juste après qu'un
// dossier a été désigné avec succès. Ne lève jamais : une erreur de garde
// (E/S SAF) ne doit pas empêcher l'appelant de conclure son propre flux (fin
// d'onboarding, rafraîchissement de la section Réglages) — seulement sauter
// la restauration. `t` : fonction de traduction (vue-i18n), gardée pour la
// forme (l'ancien `window.confirm` l'utilisait ; l'UI vit désormais dans
// LocalRestoreOffer.vue, qui lit ses propres clés i18n). `confirmRestore` :
// rappel ASYNCHRONE qui pose la question à l'utilisatrice et résout à
// `true` (« Restaurer ») ou `false` (refus : bouton « Perdre les données », confirmé
// dans la modale puis EXÉCUTÉ par l'appelant en écrasement + décision du
// 05/09 — pour CE helper, un refus reste un refus, le contrat est inchangé) — c'est
// LocalRestoreOffer.vue,
// montée par l'appelant ; l'ancien `window.confirm` natif (boutons CANCEL/OK non
// traduits, minuteries gelées — cf. restore-service.js) est retiré. ABSENCE de
// `confirmRestore` = refus : jamais de restauration sans UI qui l'explique —
// plus permissif que l'ancien code serait exactement le mauvais sens.
//
// CONTRAT DE RETOUR (décision produit du 05/09/2026) : un objet
// `{ attempted, result?, error? }` — avant ce changement, la fonction renvoyait un
// booléen qui ne disait rien de ce qui s'était réellement passé, et le
// compte rendu de `runRestore` était JETÉ (`await runRestore(...); return true`) :
// sur le chemin du téléphone neuf — dossier plein désigné à la porte —, une
// restauration qui échouait (erreur E/S, JSON corrompu) passait TOTALEMENT
// inaperçue. Désormais :
//   - `{ attempted: false, error }` : une ERREUR DE GARDE a été avalée par le
//     catch (getBackupStorage/hasBackup/isDbRestorable qui lèvent) — une erreur
//     E/S sur la garde est aussi une « erreur technique » au sens de la
//     décision du 05/09, l'appelant la publie à RestoreErrorDialog ;
//   - `{ attempted: true, result }` : `runRestore` a été appelé, `result` est
//     son compte rendu TEL QUEL ({ ok, decided, owned?, errors?, skipped?,
//     error? }) — c'est l'appelant qui traduit `owned:false` en variante
//     « reprise du dossier non confirmée » ;
//   - `{ attempted: false }` sans `error` : rien à faire ou refus — ni échec
//     ni incident, rien à signaler.
// La fonction NE publie PAS elle-même au store : elle reste sans dépendance à
// Pinia et à l'UI (testable en pur JS), la traduction du compte rendu en
// message reste le travail de l'appelant.
export async function maybeRestoreAfterDesignation(t, { onProgress, confirmRestore } = {}) {
  // suppressAutoBackup ENVELOPPE TOUT (gardes comprises) : les écritures de réglages
  // de la désignation (label, welcomeDue, clearBackupDecision) arment le debounce de
  // l'auto-backup — laissé libre, il peut tirer PENDANT que la modale attend, et sur
  // un dossier legacy sans sauvegarde.json ce tir est DESTRUCTEUR (collision des ids
  // du semis avec les ids du dossier, renommage puis suppression par réconciliation).
  // callRunBackup réarme au lieu de tirer pendant la fenêtre : le tir rebondit
  // jusqu'à la décision, rien n'est perdu.
  return suppressAutoBackup(async () => {
    try {
      const storage = await getBackupStorage()
      if (!storage) return { attempted: false }
      const empty = await isDbRestorable()
      const backup = await hasBackup(storage)
      if (!shouldRestoreFromFolder({ empty, hasBackup: backup })) return { attempted: false }
      if (!confirmRestore) return { attempted: false }
      // Drapeau « décision en attente » (restore-guard.js) : posé AVANT l'attente du
      // geste, baissé en `finally` — un refus, une erreur ou une modale qui lève ne
      // doivent jamais le laisser armé, sinon TOUTE synchro MD serait éconduite pour
      // toujours ({ skipped: 'decision-pending' } en boucle).
      beginRestoreDecision()
      let choice = false
      try {
        choice = await confirmRestore()
      } finally {
        endRestoreDecision()
      }
      if (!choice) return { attempted: false }
      // `notifyRestored: true` (depuis le 06/09/2026) : la porte est le SEUL appelant qui
      // arme le message « tes données sont de retour » — ici, la restauration EST le fil
      // du parcours (fin d'onboarding), et `runRestore` vient d'effacer `welcomeDue` :
      // sans ce drapeau, l'accueil resterait muet sur ce qui vient de se passer. L'autre
      // appelant (BackupDecisionPrompt.vue, bandeau des Réglages) s'en passe : il a son
      // propre snackbar, et le drapeau ferait doublon — cf. restore-service.js, qui pose
      // la clé en base AVANT `reloadStores()`, même contrat que `welcomeDue`.
      const result = await runRestore({ onProgress, notifyRestored: true })
      return { attempted: true, result }
    } catch (e) {
      // Avalée pour l'appelant (qui conclut son flux), mais plus PERDUE : le
      // message technique repart dans le compte rendu pour publication.
      return { attempted: false, error: e?.message || String(e) }
    }
  })
}

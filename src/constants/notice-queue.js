// L'ORDRE DES MESSAGES QUI OCCUPENT L'ÉCRAN.
//
// Huit messages peuvent s'ouvrir par-dessus l'application sans qu'on les ait demandés.
// Avant ce lot, rien ne disait lequel gagne quand deux se présentent ensemble : trois
// d'entre eux partageaient même le rang d'empilement CSS 1200, et c'est l'ordre du DOM
// qui tranchait, par accident. Deux incidents de cette famille sont au dossier (10/08 :
// deux pop-up superposées au premier lancement ; 13/08 : la progression de restauration
// par-dessus la porte du dossier), tous deux invisibles à la revue de code et vus
// seulement sur l'appareil.
//
// LE RANG 1 EST LE PLUS FORT. Les rangs ne sont PAS des z-index : ils ne disent pas qui
// se peint au-dessus, ils disent qui a le droit de s'afficher. Un seul message est à
// l'écran à la fois — c'est l'invariant que `src/stores/notice-queue.js` garantit.
//
// L'ordre suit l'urgence réelle, pas l'ordre du code :
//   1 versionGuard   — il prime déjà sur tout, c'était écrit et voulu (App.vue)
//   2 folderGate     — rien ne fonctionne tant qu'aucun dossier n'est désigné
//   3 backupDecision — elle décide du sort des données
//   4 syncReport     — il rend compte d'une écriture DÉJÀ faite
//   5 welcome        — elle accueille, elle n'urge pas
//   6 readerTour     — la visite guidée du lecteur (lot du 23/09/2026) : demandée
//                      explicitement (`?tour=1`), juste après la bienvenue qui la propose
//   7 importCaveat   — il ne se justifie qu'une fois arrivée dans la Bibliothèque
//   8 swipeHint      — elle enseigne un geste, elle peut attendre que tous les autres aient
//                      parlé. ⚠️ Elle vit sur les écrans de LISTE (Bibliothèque, Stock) et
//                      sur la fiche PROJET. « Elle peut attendre la fiche suivante », écrit
//                      ici au départ, décrivait un placement supprimé le jour même : il n'y a
//                      plus de « fiche suivante » où elle reviendrait, elle ne s'affiche
//                      qu'UNE fois en tout (cf. FirstDetailTip.vue).
//
// ⚠️ Passer par ces constantes, JAMAIS par la chaîne en dur : une chaîne mal tapée
// donnerait un message qui ne s'affiche jamais, en silence — exactement le défaut que ce
// registre existe pour tuer. `request()` lève d'ailleurs sur un identifiant inconnu.
export const NOTICE = {
  VERSION_GUARD: 'versionGuard',
  FOLDER_GATE: 'folderGate',
  BACKUP_DECISION: 'backupDecision',
  SYNC_REPORT: 'syncReport',
  WELCOME: 'welcome',
  READER_TOUR: 'readerTour',
  IMPORT_CAVEAT: 'importCaveat',
  SWIPE_HINT: 'swipeHint',
}

export const NOTICE_RANKS = {
  [NOTICE.VERSION_GUARD]: 1,
  [NOTICE.FOLDER_GATE]: 2,
  [NOTICE.BACKUP_DECISION]: 3,
  [NOTICE.SYNC_REPORT]: 4,
  [NOTICE.WELCOME]: 5,
  [NOTICE.READER_TOUR]: 6,
  [NOTICE.IMPORT_CAVEAT]: 7,
  [NOTICE.SWIPE_HINT]: 8,
}

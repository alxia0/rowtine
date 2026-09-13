// Rowtine — câblage du déclenchement automatique de sauvegarde à la mise en
// pause de l'app. Isolé d'App.vue
// pour rester testable sans monter le composant : enregistre le listener
// `pause` de @capacitor/app. En mode nominal, la sauvegarde est débouncée sur
// chaque mutation (hook Dexie, `src/db/db.js` + `src/backup/auto-backup.js`) —
// à la mise en pause, on ne veut pas attendre la fin du débounce (jusqu'à
// `AUTO_BACKUP_WAIT_MS`) : on envoie immédiatement tout écrit en attente,
// silencieusement (pas un geste explicite de l'utilisateur).
import { flushAutoBackup } from './auto-backup'
import { clearFolderClean } from './restore-guard'

export function registerAutoBackupOnPause(App) {
  return App.addListener('pause', () => {
    // Borne la fenêtre « dossier propre » à la session foreground : pendant que
    // l'app est en pause, le PC peut éditer le dossier — au retour, la synchro du
    // lancement doit reprendre son comportement habituel, pas sauter sur un
    // « propre » périmé. Le flush qui suit devient no-op si rien n'a muté.
    clearFolderClean()
    flushAutoBackup()
  })
}

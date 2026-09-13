// Verrou de défilement du fond, À COMPTEUR.
//
// LE BUG : chaque modale posait et retirait `document.body.style.overflow` POUR ELLE-MÊME
// (`= 'hidden'` à l'ouverture, `= ''` à la fermeture, idiome `v ? 'hidden' : ''`). Dès que
// DEUX messages modaux se succèdent — ou se chevauchent — la fermeture du PREMIER remettait
// le fond à `''` pendant que le SECOND tenait encore l'écran : la page derrière la modale
// redevient défilable. Mesuré le 19/08 à la revue de branche du lot de l'avertissement
// d'import ; latent ce jour-là (les deux modales connues s'excluaient par conception), mais
// il ne fallait qu'un troisième message venu s'intercaler dans la file pour le rendre réel.
//
// LE CORRECTIF : le verrou devient PARTAGÉ. Le premier `lockBodyScroll()` pose
// `overflow: hidden`, le dernier `unlockBodyScroll()` le remet à `''` — le fond reste
// verrouillé tant qu'UNE modale au moins tient le compteur, quelle que soit l'ordre des
// ouvertures et fermetures. TOUT composant qui touchait `body.style.overflow` en direct
// passe par ici : un seul récalcitrant suffirait à rouvrir le fond sous les autres.
//
// CONTRAT :
//   - `lockBodyScroll()` : imbriquable ; seul le passage 0→1 écrit sur `<body>`.
//   - `unlockBodyScroll()` : au passage 1→0, remet `''`. SÛR en cas d'appel
//     DÉSÉQUILIBRÉ (compteur déjà à 0) : il ne touche À RIEN — jamais de compteur
//     négatif, jamais l'`overflow` d'un autre.
//
// ⚠️ La garde anti-déséquilibre est un FILET, pas une autorisation : chaque composant
// continue de ne libérer que ce qu'IL a acquis (drapeau local `verrouPose`, cf.
// SyncReportDialog.vue et RestoreErrorDialog.vue). Un composant fermé sans avoir
// jamais ouvert ne doit pas décompter le verrou d'un autre — sans quoi on retombe
// dans le bug d'origine, par un autre chemin. Extraite le 06/09/2026 des huit sites
// qui portaient l'idiome en dur : OnboardingFolderPrompt, SyncReportDialog,
// BackupDecisionPrompt, PhotoCropper, PhotoSourceSheet, ChartFullscreen,
// RestoreErrorDialog, PhotoLightbox.

let compteur = 0

export function lockBodyScroll() {
  compteur += 1
  if (compteur === 1) document.body.style.overflow = 'hidden'
}

export function unlockBodyScroll() {
  if (compteur === 0) return // déséquilibré : sans détention, on ne déverrouille personne
  compteur -= 1
  if (compteur === 0) document.body.style.overflow = ''
}

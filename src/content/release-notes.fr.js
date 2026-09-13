// Journal des nouveautés affiché à l'écran À propos. Contenu
// écrit pour Alexia, pas le CHANGELOG.md du dépôt (voix développeur, détails de tests/APK —
// cf. CHANGELOG.md racine) : ce fichier ne le remplace pas, il en tire un résumé lisible par
// version, une entrée à la fois. Rédigé en français, la source de vérité — traduit dans les
// trois autres langues (release-notes.en.js, .de.js, .es.js), résolues par
// src/content/release-notes.js. Même mécanisme que privacy-policy.js/.fr.js/.en.js/… (revue
// du 02/08 : ce fichier était le seul contenu long du chantier sans
// résolveur ni traduction, rendu tel quel aux quatre langues).
//
// La plus RÉCENTE d'abord (ordre d'affichage). L'app n'a encore jamais été diffusée : la
// toute première entrée n'a donc pas de date de publication à donner.
//
// Nom de l'app : marqueur `{app}` (pas en clair), substitué à l'affichage
// par AboutView.vue (src/utils/app-name-token.js) — même mécanisme que
// privacy-policy.fr.js.
export const RELEASE_NOTES_FR = [
  {
    version: '1.0',
    notes: ['Première version de {app}.'],
  },
]

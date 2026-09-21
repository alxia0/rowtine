// Journal des nouveautés affiché à l'écran À propos. Contenu
// écrit pour Alexia, pas le CHANGELOG.md du dépôt (voix développeur, détails de tests/APK —
// cf. CHANGELOG.md racine) : ce fichier ne le remplace pas, il en tire un résumé lisible par
// version, une entrée à la fois. Rédigé en français, la source de vérité — traduit dans les
// trois autres langues (release-notes.en.js, .de.js, .es.js), résolues par
// src/content/release-notes.js. Même mécanisme que privacy-policy.js/.fr.js/.en.js/… (revue
// du 02/08 : ce fichier était le seul contenu long du chantier sans
// résolveur ni traduction, rendu tel quel aux quatre langues).
//
// La plus RÉCENTE d'abord (ordre d'affichage).
//
// Nom de l'app : marqueur `{app}` (pas en clair), substitué à l'affichage
// par AboutView.vue (src/utils/app-name-token.js) — même mécanisme que
// privacy-policy.fr.js.
export const RELEASE_NOTES_FR = [
  {
    version: '1.3.0',
    notes: [
      "Nouvel onglet Stats sur chaque projet : temps total, sessions, pelotes utilisées, période, meilleure série de jours et carte calendaire.",
      "Partager un badge de votre ouvrage (photo, chiffres, couleurs, quatre gabarits, texte libre, langue au choix).",
      "Partage d'une photo de projet depuis la galerie.",
      "Stock de laines : le prix accepte la virgule.",
      "Permission d'accès aux photos retirée (sélecteur système).",
    ],
  },
  {
    version: '1.1 à 1.2.3',
    notes: ['Mise en conformité avec les stores (F-Droid, Google Play), sans changement de fonctionnalité.'],
  },
  {
    version: '1.0',
    notes: ['Première version de {app}.'],
  },
]

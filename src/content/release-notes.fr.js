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
    version: '1.4.2',
    notes: [
      "Sections répétables : une section peut se faire plusieurs fois (chaussettes, manches, oreilles ou pattes d'un amigurumi), et chaque exemplaire garde sa progression. Par défaut, les manches, oreilles, membres et jambes se font par 2.",
      "Paire de chaussettes : confection soit l'une après l'autre, soit les deux en même temps rang par rang.",
      'Import possible des PDF multi-patrons.',
      'Designer du patron : affiché sur le patron et dans le badge partagé.',
      'Nouveaux types de section pour les chaussettes (pointe, pied, talon, jambe, gousset, bord-côtes) et un type « Générique répétable ».',
    ],
  },
  {
    version: '1.4.1',
    notes: [
      "Notification du suivi : l'appui sur un bouton est retenu même si Android a fermé ou figé l'app.",
      "Notification activée uniquement sur demande, avec une pop-up d'autorisation d'arrière-plan.",
      "Reprise d'un projet sur le dernier rang travaillé : un patron peut se traiter dans le désordre.",
      "Fiche projet : interrupteur « Garder l'écran allumé » accessible pendant le travail.",
    ],
  },
  {
    version: '1.4.0',
    notes: [
      "Mémo des techniques de points : les points et techniques de base et courants, tricot et crochet (montages, rabattages, points), dans les outils et dans l'aide-mémoire du lecteur ; choix des points à garder sous la main pour chaque patron.",
      "Le rang en cours dans une notification pendant le suivi : cocher le rang, compter les répétitions (moins et plus), rappel du diagramme, visible sur l'écran de verrouillage. À activer dans les Réglages, avec l'autorisation d'arrière-plan qui rend le bouton fiable.",
      "L'écran reste allumé pendant le suivi. Actif d'office ; réglable dans les Réglages et depuis l'aide-mémoire du suivi.",
      "Lecteur : l'étape en cours s'arrête aussi sur les compteurs de répétition, et toucher le tiers gauche d'une carte d'étape la coche.",
      "Badge : coloris de chaque laine, matières de l'ouvrage au-dessus du calendrier, image plus nette.",
      'Stock de laines : chaque carte affiche le métrage total du lot.',
      "Fiche projet : unités de l'échantillon traduites, diamètre d'aiguille écrit avec le séparateur décimal de la langue.",
      'Guide mis à jour.',
    ],
  },
  {
    version: '1.3.3',
    notes: [
      'Quantités de laine décimales (ex. 2,5 pelotes) : stock, achats, réservations, consommation par projet, export CSV et partage.',
      'Import PDF : les images du patron sont mieux conservées, et les patrons mieux lus, allemands en particulier.',
      "Visu du patron : images d'étape en grand, couverture du PDF en tête, aperçu amélioré.",
      "Diverses améliorations de l'interface et divers correctifs.",
    ],
  },
  {
    version: '1.3.2',
    notes: [
      'Import du stock de laines depuis un export Ravelry (.xlsx) : statut, couleur, achats, notes, lieu de rangement et « Acheté chez » sur chaque achat.',
      "Corrections d'affichage diverses.",
    ],
  },
  {
    version: '1.3.1',
    notes: [
      'Photos HEIC/HEIF acceptées (Android 9 ou plus).',
      'Menu du stock de laines amélioré.',
    ],
  },
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

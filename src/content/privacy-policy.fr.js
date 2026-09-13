// Politique de confidentialité — texte long, donc HORS des
// clés i18n (les quatre src/i18n/*.json sont gardés par une parité
// STRICTE de 883+ clés ; y verser un texte juridique les rendrait illisibles et la parité
// ingérable). Rédigé en français pour une lectrice non technique ; la traduction
// est prévue séparément — cf. constat écrit dans le corps du texte lui-même (dernier bloc), reporté
// tel quel pour ne pas se perdre en cours de route.
//
// ⚠️ Texte juridique : engage même traduit automatiquement plus tard.
//
// Un tableau de blocs typés plutôt qu'une chaîne Markdown : pas de bibliothèque de rendu à
// ajouter pour un texte que NOUS écrivons — un petit composant suffit à
// afficher titre/paragraphe/liste.
//
// Nom de l'app : jamais en clair ici (pas définitif, 120 occurrences
// déjà en dur ailleurs, pas une de plus). Le marqueur `{app}` est substitué à l'AFFICHAGE
// par PrivacyPolicyView.vue (src/utils/app-name-token.js), pas ici : ce fichier n'a pas
// accès à vue-i18n (contenu statique importé tel quel, hors composant).
import { CONTACT_EMAIL } from '../constants/app-links'

export const PRIVACY_POLICY_UPDATED = '2026-09-04'

export const PRIVACY_POLICY_FR = [
  {
    type: 'p',
    text: "{app} ne collecte aucune donnée. Cette page explique ce que ça veut dire concrètement, sans jargon.",
  },
  { type: 'h2', text: 'Quelles données existent' },
  {
    type: 'p',
    text: "Tes projets, tes patrons, ton stock de laines, ton historique d'achats, tes réglages (langue, unités, devise…) et les photos que tu ajoutes depuis l'app : tout ça, c'est toi qui le crées, pour toi. {app} ne te demande ni compte, ni inscription, ni aucune information sur qui tu es.",
  },
  { type: 'h2', text: 'Où elles vivent' },
  {
    type: 'p',
    text: "Uniquement sur ton téléphone, dans la mémoire de l'app. Si tu choisis un dossier de sauvegarde (dans les Réglages), une copie y est écrite aussi — sur ton téléphone ou une carte mémoire que tu contrôles. Jamais sur un serveur : {app} n'en a aucun.",
  },
  { type: 'h2', text: 'Ce qui sort de ton téléphone' },
  {
    type: 'p',
    text: "Rien. {app} fonctionne entièrement hors ligne et ne contacte aucun serveur, aucun service tiers. Pas de publicité, pas de traceur, pas de mesure d'audience.",
  },
  { type: 'h2', text: 'Si tu désinstalles l’app' },
  {
    type: 'p',
    text: "La base de données de l'app disparaît avec elle. Ce que tu as sauvegardé dans le dossier choisi (Réglages) y reste : tu peux le retrouver, ou le supprimer toi-même, à part.",
  },
  // Responsable + contact : bloquant diffusion — nom tranché (04/09/2026), l'adresse est la
  // seule porte existante (CONTACT_EMAIL, donnée le 05/08/2026, sans création de compte).
  { type: 'h2', text: 'Responsable et contact' },
  {
    type: 'p',
    text: `{app} est éditée par Alexia O. Pour toute question sur tes données ou sur cette politique, écris à ${CONTACT_EMAIL}.`,
  },
]

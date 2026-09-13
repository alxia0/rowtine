// Langues de l'interface (lot « 4 langues », 29/07). Liste UNIQUE, consommée à la fois par
// l'écran de bienvenue (OnboardingView) et les réglages (SettingsView) : deux listes en dur
// divergeraient à la première évolution.
//
// Les libellés restent chacun dans SA PROPRE langue et ne sont PAS des clés i18n à traduire :
// un germanophone perdu dans une app en français doit reconnaître « Deutsch », pas
// « Allemand ». C'est l'usage universel des sélecteurs de langue (cf. tout système
// d'exploitation ou site multilingue).
export const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
]

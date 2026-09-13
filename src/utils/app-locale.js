// Langue de l'interface déduite de l'appareil, au tout premier lancement (avant que
// l'utilisatrice n'ait choisi quoi que ce soit). UN SEUL détecteur, consommé par les
// quatre points qui écrivaient auparavant 'fr' en dur (i18n/index.js, stores/settings.js,
// router/index.js, OnboardingView.vue) : deux détecteurs finiraient par diverger, et
// c'est exactement le genre d'écart qui produit un écran à moitié traduit.
//
// Ne décide QUE de la langue. Les unités et la devise se déduisent de la RÉGION et
// restent la responsabilité de `defaultsForLocale` (src/utils/locale-defaults.js) —
// l'anglais ne veut pas dire impérial (cf. le commentaire de tête de ce module).
//
// Repli sur l'ANGLAIS, jamais sur le français : c'est déjà le `fallbackLocale` de
// vue-i18n (src/i18n/index.js), et une italienne comprendra mieux un écran anglais
// qu'un écran français.
import { LANGUAGES } from '@/constants/languages'

const SUPPORTED = new Set(LANGUAGES.map((l) => l.code))
export const FALLBACK_LOCALE = 'en'

// « de-AT », « de_DE », « DE » → « de ». Android renvoie parfois le séparateur souligné.
function languageSubtag(tag) {
  if (typeof tag !== 'string') return ''
  return tag.replace('_', '-').split('-')[0].toLowerCase()
}

// Accepte une étiquette seule (`navigator.language`) ou une liste de préférences
// (`navigator.languages`) : sur Android, une utilisatrice peut avoir l'italien en 1er et
// l'allemand en 2e — la 1re langue que l'application sait parler gagne.
export function detectAppLocale(navigatorLanguage) {
  const tags = Array.isArray(navigatorLanguage) ? navigatorLanguage : [navigatorLanguage]
  for (const tag of tags) {
    const code = languageSubtag(tag)
    if (SUPPORTED.has(code)) return code
  }
  return FALLBACK_LOCALE
}

// Lecture réelle de l'appareil, isolée ici pour que les tests puissent injecter une
// étiquette sans toucher à `navigator`. `navigator.languages` d'abord (la liste ordonnée
// des préférences), `navigator.language` en repli.
export function detectDeviceLocale() {
  if (typeof navigator === 'undefined') return FALLBACK_LOCALE
  const list = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : navigator.language
  return detectAppLocale(list)
}

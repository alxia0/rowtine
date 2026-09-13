// Mécanisme de repli partagé par les trois points d'accès à du contenu localisé du dépôt
// (guide utilisateur, politique de confidentialité, journal des nouveautés) : même boucle
// « langue demandée, puis FALLBACK_ORDER » recopiée à l'identique dans les trois modules
// avant cette factorisation. Chaque appelant garde sa propre forme de retour (sections,
// blocks+updated, notes...), construite à partir de l'`entry` renvoyée ici.
//
// Ordre de repli du projet — anglais, puis français EN DERNIER RECOURS (doctrine partagée
// avec src/i18n/index.js) : inatteignable aujourd'hui par construction (les quatre langues de
// LANGUAGES sont toutes couvertes), conservé comme filet pour une 5e langue future. Privée :
// aucun des trois appelants (guide/index.js, privacy-policy.js, release-notes.js) n'a besoin
// d'un ordre de repli différent — pas de paramètre à exposer pour un cas qui n'existe pas.
const FALLBACK_ORDER = ['en', 'fr']

// Renvoie { lang, fallback, entry } où `lang` est la langue RÉELLEMENT servie (peut différer
// de celle demandée), `fallback` dit si un repli a eu lieu, et `entry` est `dict[lang]`.
// Renvoie `null` si `dict` ne couvre ni `locale` ni aucune langue de FALLBACK_ORDER — chaque
// appelant garde la responsabilité (et le message) de son propre throw de secours, filet qui
// ne doit jamais être atteint en pratique (cf. chaque appelant).
export function resolveLocalized(dict, locale) {
  for (const lang of [locale, ...FALLBACK_ORDER]) {
    if (dict[lang]) return { lang, fallback: lang !== locale, entry: dict[lang] }
  }
  return null
}

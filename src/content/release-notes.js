// Point d'accès unique au journal des nouveautés pour AboutView.vue — résout la langue à
// afficher, avec repli, sans que l'écran ait à connaître la liste des langues disponibles.
// Même mécanisme que src/content/privacy-policy.js (repris à l'identique, revue finale de
// branche du 02/08 : ce fichier n'existait pas, le journal se rendait en français aux quatre
// langues).
import { RELEASE_NOTES_FR } from './release-notes.fr'
import { RELEASE_NOTES_EN } from './release-notes.en'
import { RELEASE_NOTES_DE } from './release-notes.de'
import { RELEASE_NOTES_ES } from './release-notes.es'
import { resolveLocalized } from './resolve-localized-content'

const NOTES = {
  fr: RELEASE_NOTES_FR,
  en: RELEASE_NOTES_EN,
  de: RELEASE_NOTES_DE,
  es: RELEASE_NOTES_ES,
}

// Repli sur l'anglais, puis le français EN DERNIER RECOURS — même ordre que
// src/content/privacy-policy.js et src/content/guide/index.js (doctrine du projet), boucle
// factorisée dans src/content/resolve-localized-content.js : inatteignable aujourd'hui par
// construction, conservé comme filet pour une 5e langue future.

// Renvoie { lang, fallback, notes } : `lang` est la langue RÉELLEMENT servie (peut différer
// de celle demandée), `fallback` dit si un repli a eu lieu.
export function resolveReleaseNotes(locale) {
  const resolved = resolveLocalized(NOTES, locale)
  if (!resolved) {
    // N'arrive jamais en pratique : 'fr' est toujours présent dans NOTES ci-dessus.
    throw new Error(`Aucun journal des nouveautés disponible pour "${locale}" ni pour aucun repli`)
  }
  return { lang: resolved.lang, fallback: resolved.fallback, notes: resolved.entry }
}

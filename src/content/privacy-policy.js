// Point d'accès unique à la politique de confidentialité pour PrivacyPolicyView.vue — résout
// la langue à afficher, avec repli, sans que l'écran ait à connaître la liste des langues
// disponibles. Même mécanisme que le guide utilisateur (src/content/guide/index.js)
// : un fichier de contenu PAR langue, choisi selon la locale active.
//
// Différence assumée avec le guide : pas de bandeau de repli visible ici. Le guide a
// authentiquement connu une période où seul le français existait (livré avant les
// traductions) — le bandeau y avertissait d'un vrai repli en cours. Cette politique,
// elle, naît directement avec ses quatre langues (en même temps que les trois
// traductions) : POLICIES ci-dessous couvre déjà les quatre langues de LANGUAGES
// (constants/languages.js) au moment où ce module existe, donc le repli n'a jamais eu
// d'occasion réelle de se produire — ajouter un bandeau reviendrait à afficher un
// avertissement pour un événement qui n'est jamais arrivé. Le mécanisme de repli lui-même est
// conservé (même filet que le guide, pour une 5e langue future), simplement sans traduction
// dédiée de l'avertissement.
import { PRIVACY_POLICY_FR, PRIVACY_POLICY_UPDATED as UPDATED_FR } from './privacy-policy.fr'
import { PRIVACY_POLICY_EN, PRIVACY_POLICY_UPDATED as UPDATED_EN } from './privacy-policy.en'
import { PRIVACY_POLICY_DE, PRIVACY_POLICY_UPDATED as UPDATED_DE } from './privacy-policy.de'
import { PRIVACY_POLICY_ES, PRIVACY_POLICY_UPDATED as UPDATED_ES } from './privacy-policy.es'
import { resolveLocalized } from './resolve-localized-content'

const POLICIES = {
  fr: { blocks: PRIVACY_POLICY_FR, updated: UPDATED_FR },
  en: { blocks: PRIVACY_POLICY_EN, updated: UPDATED_EN },
  de: { blocks: PRIVACY_POLICY_DE, updated: UPDATED_DE },
  es: { blocks: PRIVACY_POLICY_ES, updated: UPDATED_ES },
}

// Repli sur l'anglais, puis le français EN DERNIER RECOURS — même ordre que
// src/content/guide/index.js (doctrine du projet, cf. aussi src/i18n/index.js), boucle
// factorisée dans src/content/resolve-localized-content.js : inatteignable aujourd'hui par
// construction, conservé comme filet pour une 5e langue future.

// Renvoie { lang, fallback, blocks, updated } : `lang` est la langue RÉELLEMENT servie (peut
// différer de celle demandée), `fallback` dit si un repli a eu lieu.
export function resolvePrivacyPolicy(locale) {
  const resolved = resolveLocalized(POLICIES, locale)
  if (!resolved) {
    // N'arrive jamais en pratique : 'fr' est toujours présent dans POLICIES ci-dessus.
    throw new Error(`Aucune politique de confidentialité disponible pour "${locale}" ni pour aucun repli`)
  }
  return { lang: resolved.lang, fallback: resolved.fallback, ...resolved.entry }
}

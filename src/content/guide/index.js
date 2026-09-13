// Point d'accès unique au contenu du guide utilisateur pour GuideView.vue — résout la
// langue à afficher, avec repli, sans que l'écran ait à connaître la liste des langues
// disponibles.
//
// Import STATIQUE (pas de `import.meta.glob` ici, volontairement différent de images.js) :
// le contenu généré vit dans src/generated/, un fichier PAR langue, chacun ajouté à la main
// dans GUIDE_CONTENT ci-dessous — un import dynamique masquerait à la lecture du code
// quelles langues existent réellement.
import fr from '@/generated/guide-content.fr.json'
import en from '@/generated/guide-content.en.json'
import de from '@/generated/guide-content.de.json'
import es from '@/generated/guide-content.es.json'
import { resolveLocalized } from '@/content/resolve-localized-content'

const GUIDE_CONTENT = { fr, en, de, es }

// Ordre de repli : la langue demandée, puis l'anglais (repli habituel du projet — cf.
// src/i18n/index.js), puis le français EN DERNIER RECOURS. C'est la valeur D'ORIGINE de ce
// module (revue du 02/08) : réduite temporairement à `['fr']` par le
// commit « retire le repli 'en' mort tant qu'aucun guide anglais n'existe » le temps que
// `guide-content.en.json` n'existait pas encore (une branche 'en' morte par construction),
// avec la remarque explicite d'y revenir dès que l'import anglais serait rétabli — ce qui est
// fait ci-dessus. Confirmé en revue : ce n'est PAS un choix nouveau ni hors périmètre,
// seulement la restauration de ce que ce fichier prévoyait déjà lui-même.
//
// Les quatre langues du guide étant désormais toutes en place, ce repli est INATTEIGNABLE
// par construction : GUIDE_CONTENT couvre exactement les quatre langues de LANGUAGES
// (constants/languages.js), donc `locale` y trouve toujours une entrée directe avant même de
// consulter FALLBACK_ORDER — décision explicite (garder le MÉCANISME de
// repli et son bandeau, pas les retirer) plutôt qu'un oubli : conservé comme filet pour une
// cinquième langue future dont la traduction du guide prendrait du retard sur celle de
// l'interface. Le jour où `constants/languages.js` gagne une langue sans que son
// `<langue>.md` existe encore, resolveGuideContent bascule sur l'anglais (ou, à défaut, sur
// le français) au lieu de planter, et GuideView le signale EXPLICITEMENT (bandeau) plutôt que
// d'afficher un contenu dans la mauvaise langue sans le dire — jamais un écran muet sur ce
// point. Ordre de repli et boucle : src/content/resolve-localized-content.js (mécanisme
// partagé avec privacy-policy.js et release-notes.js).

// Renvoie { lang, fallback, sections } : `lang` est la langue RÉELLEMENT servie (peut
// différer de celle demandée), `fallback` dit si un repli a eu lieu (pour que l'écran
// affiche un avertissement explicite — ne jamais laisser un écran muet sur ce
// point).
export function resolveGuideContent(locale) {
  const resolved = resolveLocalized(GUIDE_CONTENT, locale)
  if (!resolved) {
    // N'arrive jamais en pratique : 'fr' est toujours présent dans GUIDE_CONTENT ci-dessus.
    throw new Error(`Aucun contenu de guide disponible pour "${locale}" ni pour aucun repli`)
  }
  return { lang: resolved.lang, fallback: resolved.fallback, sections: resolved.entry.sections }
}

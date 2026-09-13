// Choix du jeu d'exemples selon la langue, par import DYNAMIQUE : une seule langue entre
// dans le paquet chargé, et le contenu n'est lu qu'au premier lancement (il ne pèse rien
// sur les démarrages suivants, où la bibliothèque n'est plus vide).
import { detectAppLocale } from '@/utils/app-locale'

// Identifiant STABLE (jamais traduit) du patron auquel le projet « en cours » est lié.
// Un nom affiché ne doit jamais servir de clé de données : il change avec la langue.
export const DEMO_PATTERN_DEMO_ID = 'bonnet'

// Même règle pour le projet « idée » (l'écharpe douillette), rattaché depuis le 11/08 au
// patron de démonstration de l'écharpe : la fiche gagne ainsi une image (via
// `resolveCover`, qui retombe sur la photo du PATRON) et des instructions, sans jamais
// écrire dans `project.photos` ni dans `db.sections` — deux écritures qui rendraient la
// restauration de sauvegarde impossible (cf. `isDbRestorable`).
export const DEMO_PATTERN_IDEA_ID = 'echarpe'

// ⚠️ Ne déclarer ici que les langues RÉELLEMENT ÉCRITES. Un alias `en/de/es → fr.js`
// serait un piège silencieux : l'anglais afficherait du français sans que rien ne rougisse.
const LOADERS = {
  fr: () => import('./fr.js'),
  en: () => import('./en.js'),
  de: () => import('./de.js'),
  es: () => import('./es.js'),
}

export async function loadDemoContent(locale) {
  const code = detectAppLocale(locale)
  const load = LOADERS[code]
  if (!load) throw new Error(`Pas de jeu d'exemples pour « ${code} »`)
  return (await load()).default
}

// Fusion de deux formes PLATES de référence (cf. refblocks.js). Remplace le
// `Object.assign(flat, ref)` de parse.js, qui gardait le SECOND bloc d'une rubrique et
// jetait le premier — perte silencieuse, contraire à la règle cardinale du projet.
// Module pur, sans dépendance non-Node : importable tel quel par le banc corpus (Node).
//
// Trois familles recouvrent les huit rubriques + scalaires inconnus :
//  - texte libre à joindre par saut de ligne (gauge/yarn/needles) : jonction dans l'ordre du
//    document — c'est ainsi que se lisent deux paragraphes successifs d'une même rubrique ;
//  - listes (materials/tips/techniques/abbr/sizeTable) : concaténation ;
//  - scalaires inconnues : jonction par saut de ligne, faute de mieux — élimine la perte
//    silencieuse qui caractérisait Object.assign.
// NOTE : ne pas confondre avec FREE_TEXT_KEYS de refblocks.js, qui désigne 6 clés
// (« corps hors-table », autre sens, autres clés, autre ensemble). Importée depuis le
// module feuille scalar-keys.js (sans AUCUN import) plutôt que de refblocks.js (qui,
// lui, dépend de '../reader') : ce module reste sans dépendance transitive, pour que
// sa compatibilité Node (banc corpus) ne dépende jamais d'un module non-Node du dossier.
import { SCALAR_TEXT_KEYS } from './scalar-keys'

export function mergeFlat(into, add) {
  const out = { ...into }
  for (const [key, value] of Object.entries(add || {})) {
    const current = out[key]
    if (current === undefined || current === null || current === '') {
      out[key] = value
      continue
    }
    if (SCALAR_TEXT_KEYS.has(key)) {
      out[key] = `${current}\n${value}`
      continue
    }
    if (Array.isArray(current) && Array.isArray(value)) {
      out[key] = [...current, ...value]
      continue
    }
    // Clé scalaire inconnue : jonction par saut de ligne, faute de mieux, plutôt que
    // de perdre la valeur entrante (qui reproduirait le défaut de Object.assign).
    out[key] = `${current}\n${value}`
  }
  return out
}

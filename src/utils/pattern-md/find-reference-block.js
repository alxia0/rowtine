// Localise, dans le document, le bloc de référence d'une rubrique donnée — la cible de la
// fusion quand la travailleuse taggue une seconde sélection vers la même rubrique.
//
// La règle de reconnaissance est CELLE DU PARSEUR, jamais une expression régulière ad hoc :
//  - `## Fil {yarn}` -> cible (balise de référence explicite) ;
//  - `## Fil` nu     -> cible (titre réservé, chemin de compat FR héritée, reservedKey) ;
//  - `## yarn {other}` -> JAMAIS (c'est une `demotedSection` de parse.js,
//    volontairement taguée {other} pour ne plus jamais être réabsorbée ; la fusionner
//    re-enclencherait la destruction que ce tag empêche) ;
//  - `## Aiguilles {sleeve}` -> JAMAIS (kind de travail, pas une balise de référence).
// Module pur, sans DOM ni CM6.
import { REF_TAG_TO_KEY } from './refblocks'
import { H2_RE, referenceKeyOfTitle } from './md-line-type'

/**
 * @param {string} docText Texte complet du document.
 * @param {string} tag Balise EN de référence (yarn, needles, measurements…).
 * @returns {{ titleLine: number, endLine: number }|null} Numéros de ligne 1-based.
 *   `endLine` est la dernière ligne NON VIDE du corps, ou la ligne du titre si le corps
 *   est vide. Le premier bloc trouvé gagne.
 */
export function findReferenceBlock(docText, tag) {
  const wanted = REF_TAG_TO_KEY[tag]
  if (!wanted) return null

  const lines = String(docText ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const h2 = H2_RE.exec(lines[i])
    if (!h2 || referenceKeyOfTitle(h2[1]) !== wanted) continue

    const titleLine = i + 1
    let endLine = titleLine
    for (let j = i + 1; j < lines.length; j++) {
      if (H2_RE.test(lines[j])) break
      if (lines[j].trim()) endLine = j + 1
    }
    return { titleLine, endLine }
  }
  return null
}

// Transforme une sélection multi-lignes en changements CM6. Pure : aucun import CM6/DOM,
// module chargeable tel quel par Vitest. La seule logique propre à ce module est la
// conversion (texte complet, numéros de ligne 1-based) -> offsets de caractères, au format
// `{ from, to, insert }` consommable tel quel par `view.dispatch({ changes })`.
//
// DEUX RÉGIMES, et c'est intentionnel :
//  - `reference` est une transformation de BLOC : N lignes sélectionnées deviennent UN bloc
//    à titre réservé (`## Fil {yarn}`) portant les lignes en CORPS. C'est le correctif du
//    19/08/2026 : l'ancien traitement ligne-à-ligne mettait le texte dans le TITRE, ce que
//    le parseur rejetait — à raison — vers les notes (refblocks.js, garde FREE_TEXT_KEYS).
//  - tous les autres types restent une transformation LIGNE À LIGNE, via retagLine.
import { retagLine, stripMarkup } from './md-retag.js'
import { selectionToFlat } from './selection-to-reference.js'
import { referenceBlocksToMd, REF_TAG_TO_KEY, reservedKey } from './refblocks.js'
import { lineType } from './md-line-type.js'
import { findReferenceBlock } from './find-reference-block.js'

// `fromLine`/`toLine` suivent la convention CodeMirror (1-based, cf.
// `state.doc.lineAt(pos).number`). Les deux bornes sont incluses et clampées sur les lignes
// réellement présentes dans `docText`.
export function retagSelection(docText, fromLine, toLine, type, opts = {}) {
  const lines = String(docText ?? '').split('\n')
  const first = Math.max(1, Math.min(fromLine, lines.length))
  const last = Math.max(first, Math.min(toLine, lines.length))

  if (type === 'reference') {
    return referenceChanges(lines, first, last, opts)
  }

  const changes = []
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const len = lines[i].length
    if (lineNo >= first && lineNo <= last) {
      changes.push({ from: offset, to: offset + len, insert: retagLine(lines[i], type, opts) })
    }
    offset += len + 1 // +1 pour le \n séparateur
  }
  return { changes }
}

/**
 * Numéro (1-based) de la ligne d'INTITULÉ NUE à absorber juste au-dessus de `first`, ou
 * `null` s'il n'y en a pas. Correctif du faux titre résiduel (constaté le 20/08/2026 sur
 * `Harlow_Sweater_FR`, arbitrage retenu, piste (a)) : quand l'import a laissé « Abréviations »
 * en texte brut au-dessus de son contenu, taguer le seul CONTENU laissait cette ligne en
 * place et le patron affichait le mot deux fois — le faux titre et le vrai titre de rubrique.
 *
 * La règle est volontairement ÉTROITE, et chacune de ses trois conditions porte :
 *  1. on ne saute que des lignes BLANCHES pour remonter (rien ne s'y perd) — une ligne de
 *     contenu intercalée interdit l'absorption, l'intitulé n'est alors plus « le sien » ;
 *  2. `TYPES_INTITULE_NU.has(lineType(l))` (`'texte'` ou `'sous-titre'`) : un titre de SECTION
 *     de travail (`## Abréviations {body}`, un nom donné par l'utilisatrice à sa section) et
 *     un bloc de rubrique déjà tagué sont tous deux exclus — le second est de toute façon déjà
 *     écarté du CONTENU par le filtre `lineType !== 'reference'`, mais il ne doit pas non plus
 *     élargir la plage remplacée. `'sous-titre'` (un `### Titre` résiduel) rejoint
 *     `'texte'` dans cet ensemble : c'est le même faux titre résiduel, seulement avec des
 *     dièses que `slug()` efface de toute façon (cf. commentaire de `TYPES_INTITULE_NU`) ;
 *  3. `reservedKey(...) === REF_TAG_TO_KEY[tag]` : le vocabulaire du PARSEUR, jamais une
 *     seconde table qui dériverait de la première. `slug()` neutralise casse, accents et
 *     ponctuation, donc « ABREVIATIONS : » matche — et « Abréviations et symboles », qui
 *     n'est plus le nom de la rubrique, ne matche pas.
 *
 * Règle cardinale respectée : le mot absorbé n'est pas supprimé, il est RÉÉMIS à l'identique
 * comme titre de rubrique par `referenceBlocksToMd`. C'est exactement le traitement que la
 * garde `lineType !== 'reference'` applique déjà au même mot quand il est tagué.
 *
 * ⚠️ LIMITE CONNUE, assumée : `RESERVED` (refblocks.js) n'est renseigné qu'en FRANÇAIS. Un
 * patron dont l'import a laissé « Abbreviations » ou « Abkürzungen » en texte brut n'est donc
 * PAS absorbé — le résidu subsiste, comme avant ce correctif. Ce n'est pas une régression ;
 * élargir demanderait une table multilingue qui n'a pas été demandée.
 */
function leadingLabelLine(lines, first, tag) {
  const key = REF_TAG_TO_KEY[tag]
  if (!key) return null
  let n = first - 1
  while (n >= 1 && !lines[n - 1].trim()) n--
  if (n < 1) return null
  return isBareLabelFor(lines[n - 1], key) ? n : null
}

// `sous-titre` rejoint `texte` ici : un `### Abréviations` posé au-dessus d'une
// sélection est le MÊME faux titre résiduel qu'un `Abréviations` nu, et il était
// déjà absorbé avant que lineType ne sache lire les `###` (slug() efface les
// dièses : reservedKey('### Abréviations') === 'abbr'). Ne pas l'élargir ici
// aurait laissé le titre orphelin au-dessus du bloc fraîchement créé.
const TYPES_INTITULE_NU = new Set(['texte', 'sous-titre'])

// Le prédicat seul, partagé par les deux chemins. `TYPES_INTITULE_NU.has(lineType(l))` exclut
// d'un coup les titres de section de travail et les blocs de rubrique déjà tagués (ils ne sont
// ni `'texte'` ni `'sous-titre'`) ; `reservedKey` apporte le vocabulaire du parseur (casse,
// accents et ponctuation neutralisés par `slug`).
function isBareLabelFor(line, key) {
  return !!key && TYPES_INTITULE_NU.has(lineType(line)) && reservedKey(String(line ?? '').trim()) === key
}

// Offset du premier caractère de la ligne `lineNo` (1-based).
function offsetOfLine(lines, lineNo) {
  let offset = 0
  for (let i = 0; i < lineNo - 1; i++) offset += lines[i].length + 1
  return offset
}

function referenceChanges(lines, first, last, opts) {
  // Absorption du faux titre résiduel (cf. `leadingLabelLine`) : la plage remplacée démarre
  // une ligne plus haut, mais cette ligne est retirée du CONTENU juste en dessous — sans quoi
  // « Abréviations » deviendrait une entrée du glossaire au lieu d'en être le titre.
  const absorbed = leadingLabelLine(lines, first, opts.tag)
  const start = absorbed ?? first
  const selected = lines.slice(start - 1, last)
  // Écarte, AVANT stripMarkup, tout titre de bloc de RÉFÉRENCE déjà posé — quelle que soit sa
  // rubrique (`## Fil {yarn}`, `## Matériel {materials}`, un titre réservé nu comme
  // `## Échantillon`…). C'est le geste de rattrapage le plus probable : l'utilisatrice range
  // son fil dans « Matériel » par erreur, sélectionne le bloc entier, clique « Fil » — le mot
  // « Matériel » ne doit pas atterrir comme ligne de contenu dans la rubrique Fil. `lineType`
  // (md-line-type.js) porte déjà la désambiguïsation exacte du parseur entre bloc référence et
  // section de travail ; on la réutilise plutôt que d'écrire une seconde règle ici, qui
  // dériverait tôt ou tard de la première.
  //
  // Frontière stricte : un titre de SECTION de travail (`## Corps {body}`, `## Manches
  // {sleeve}`, une section rétrogradée en `{other}`) reste — c'est un nom que l'utilisatrice a
  // donné à sa section, donc du contenu du patron, pas du vocabulaire de l'app. Le perdre
  // violerait la règle cardinale (rien de ce que l'utilisatrice a saisi ne disparaît).
  // `slice(1)` quand une ligne a été absorbée : par construction `start === absorbed`, donc
  // c'est la PREMIÈRE de `selected`. Elle reste dans la plage remplacée (donc elle disparaît
  // du texte), mais pas dans le contenu versé à la rubrique.
  const content = (absorbed ? selected.slice(1) : selected).filter((l) => lineType(l) !== 'reference')
  const bare = content.map(stripMarkup)
  const flat = selectionToFlat(bare, opts.tag, { sizeLabels: opts.sizeLabels })
  // `selectionToFlat` renvoie `null` pour trois causes distinctes : balise hors référence,
  // sélection vide, ou balise de référence valide sans forme plate émise (cas galerie). Les
  // trois sont traitées IDENTIQUEMENT : ne rien faire plutôt que de consommer la sélection —
  // sinon la règle cardinale du projet (rien de ce que l'utilisatrice a saisi ne disparaît)
  // se romprait ici, au point d'appel, là où personne ne la chercherait.
  if (!flat) return { changes: [] }

  // Émission par referenceBlocksToMd, JAMAIS par une chaîne écrite ici : on hérite du titre
  // réservé canonique, de la balise EN, de l'en-tête de table et du cas « taille unique »,
  // exactement comme à l'import. Une seconde fonction d'émission divergerait.
  const md = referenceBlocksToMd(flat, opts.sizeLabels || [])
  const from = offsetOfLine(lines, start)
  const to = from + selected.join('\n').length
  // `referenceBlocksToMd` termine toujours par un `\n` : on le retire pour ne pas ajouter
  // une ligne vide à chaque application (le texte qui suit garde sa propre séparation).
  return { changes: [{ from, to, insert: md.replace(/\n$/, '') }] }
}

/**
 * Déplace les lignes sélectionnées dans le corps d'un bloc de référence DÉJÀ présent, au
 * lieu d'en créer un second. Renvoie DEUX changements, triés par offset CROISSANT : dans une
 * transaction CM6 toutes les positions sont exprimées dans le document AVANT changement — il
 * n'y a aucun décalage à compenser, seulement l'ordre trié et non chevauchant qu'attend
 * `ChangeSet.of`.
 *
 * Renvoie `{ changes: [] }` — donc « rien à faire par cette voie » — quand il n'y a pas de
 * bloc cible, ou quand la sélection chevauche encore sa portée APRÈS bornage par
 * `clampedEndLine` (elle inclut le titre, ou tombe au milieu d'un corps existant qu'elle ne
 * suffixe pas) : dans ces deux cas, l'appelant (`applyRetag`) retombe sur `retagSelection`
 * simple. VÉRIFIÉ (pas supposé) : ce repli n'est PAS un no-op — sur une sélection au milieu
 * d'un corps déjà présent, il crée un second bloc de la même rubrique, à l'emplacement de la
 * sélection. Rien ne se perd : `mergeFlat` (`reference-merge.js`) fusionne les deux
 * blocs au prochain passage par le parseur, contenu et ordre préservés — cf. le commentaire de
 * `clampedEndLine` ci-dessous pour le détail du cas couvert vs. celui qui retombe ici.
 *
 * @param {string} docText
 * @param {number} fromLine Première ligne sélectionnée (1-based, incluse).
 * @param {number} toLine Dernière ligne sélectionnée (1-based, incluse).
 * @param {{ tag: string, sizeLabels?: string[] }} opts
 */
// `findReferenceBlock` balaie le corps jusqu'au prochain H2 (ou la fin du document) SANS
// s'arrêter aux lignes blanches internes : un paragraphe libre qui suit le bloc sans qu'aucun
// H2 ne les sépare se retrouve donc compté dans `endLine`, alors qu'il n'appartient pas
// encore au bloc — c'est justement le paragraphe que la sélection courante s'apprête à y
// faire entrer. Défaut trouvé en écrivant cette tâche : la version précédente réutilisait `target.endLine`
// tel quel pour la garde anti-doublon ET pour le découpage du corps, ce qui la faisait se
// déclencher à tort dès que la sélection touchait la fin de cette portée balayée (repli en
// no-op au lieu de fusionner), et aurait produit un doublon si la garde avait été
// contournée sans corriger le découpage (le corps repris aurait déjà contenu la sélection).
//
// On ne borne QUE quand la sélection est un SUFFIXE de la portée balayée (elle commence
// après le titre ET son extrémité atteint ou dépasse `target.endLine` brut) : c'est le seul
// cas où rien de réel ne se trouve après elle dans cette portée, donc rien ne se perd à
// arrêter le corps repris juste avant elle. Une sélection au MILIEU du corps existant (un
// authentique doublon potentiel des deux côtés, l'architecture à 2 changements ne sait pas
// découper 3 segments) n'est jamais un suffixe : la garde continue de se déclencher, et
// l'appelant retombe sur `retagSelection` — qui, dans CE cas précis, n'est pas un no-op : il
// insère un second bloc de la même rubrique là où était la sélection (vérifié empiriquement,
// pas supposé). Sans danger : ce second bloc porte le même tag que le premier, et `mergeFlat`
// les fusionne dès le prochain passage par le parseur — rien de ce que
// l'utilisatrice a saisi ne disparaît, juste un aller-retour de plus qu'une vraie fusion en
// place. Signalé au coordinateur plutôt que « corrigé » : étendre
// l'architecture à 3 segments pour ce cas non testé n'a pas été jugé nécessaire pour l'instant.
function clampedEndLine(target, fromLine, toLine) {
  const isTrailingSuffix = fromLine > target.titleLine && toLine >= target.endLine
  return isTrailingSuffix ? Math.min(target.endLine, fromLine - 1) : target.endLine
}

export function mergeIntoReference(docText, fromLine, toLine, opts = {}) {
  const target = findReferenceBlock(docText, opts.tag)
  if (!target) return { changes: [] }
  const endLine = clampedEndLine(target, fromLine, toLine)
  if (!(endLine < fromLine || target.titleLine > toLine)) return { changes: [] }
  // Absorption du faux titre résiduel — ÉLARGISSEMENT OPTIONNEL, jamais une condition de la
  // fusion : un intitulé candidat qui tombe DANS le bloc cible est refusé, et la fusion se
  // fait alors comme avant. Le refuser n'est pas un raffinement, c'est nécessaire : le corps
  // du bloc est réémis par le premier changement, couper cette même ligne par le second ferait
  // se chevaucher deux plages de la même transaction, et `ChangeSet.of` lève là-dessus.
  const candidate = leadingLabelLine(String(docText ?? '').split('\n'), fromLine, opts.tag)
  const absorbed = candidate != null && (candidate > endLine || candidate < target.titleLine) ? candidate : null
  return buildMergeChanges(docText, { from: fromLine, to: toLine, absorbed }, { ...target, endLine }, opts)
}

function buildMergeChanges(doc, selection, target, opts) {
  const lines = doc.split('\n')
  const offsetOf = (lineNo) => {
    let offset = 0
    for (let i = 0; i < lineNo - 1; i++) offset += lines[i].length + 1
    return offset
  }

  const selFrom = offsetOf(selection.from)
  const selected = lines.slice(selection.from - 1, selection.to)
  const selTo = selFrom + selected.join('\n').length

  // La SÉLECTION doit fournir du contenu à elle seule (correctif revue). Sinon,
  // taper sur la seule ligne `## Matériel {materials}` — un tap suffit sur téléphone — puis
  // cliquer « Fil » SUPPRIMAIT cette ligne : le titre est bien filtré (c'est voulu), mais le
  // corps du bloc cible suffisait à produire un résultat non nul, donc le second changement
  // emportait quand même la sélection. La rubrique Matériel disparaissait, son contenu se
  // raccrochant à Fil au reparse, sans un mot. Par le chemin CRÉATION (aucun bloc Fil
  // existant), le MÊME geste ne fait rien : `selectionToFlat` renvoie `null` et
  // `referenceChanges` s'abstient. On s'aligne ici sur ce comportement-là, avec exactement le
  // même pipeline (filtre `lineType` puis `stripMarkup` puis `selectionToFlat`) plutôt qu'une
  // seconde règle qui finirait par diverger — sur `selected` BRUT, avant le marquage `### `
  // des techniques, qui n'a de sens que pour la sélection déjà retenue.
  // Effet de bord assumé : une sélection réduite à des lignes blanches devient elle aussi un
  // no-op au lieu de les supprimer — rien de ce que l'utilisatrice a saisi ne disparaît.
  const selectionContent = selected.filter((l) => lineType(l) !== 'reference').map(stripMarkup)
  if (!selectionToFlat(selectionContent, opts.tag, { sizeLabels: opts.sizeLabels })) return { changes: [] }

  // CORPS SEUL, titre EXCLU (`slice(titleLine, endLine)` et non `titleLine - 1`) : `lines`
  // est indexé à partir de 0, `titleLine` à partir de 1, donc `lines[titleLine]` est déjà la
  // première ligne du corps. Reprendre le titre serait un bug net — `stripMarkup` en tirerait
  // « Fil », qui redescendrait en CONTENU du bloc reconstruit. `target.endLine` est ici déjà
  // la version bornée par `clampedEndLine` : le corps repris s'arrête avant la sélection quand
  // celle-ci en est le suffixe, pour ne jamais la reprendre deux fois (cf. commentaire ci-dessus).
  //
  // Second lieu d'absorption du faux titre, et le plus important des deux ici : la portée
  // balayée par `findReferenceBlock` court jusqu'au prochain H2, lignes blanches comprises,
  // donc un intitulé résiduel posé APRÈS le bloc mais avant la sélection tombe DEDANS. Il
  // n'arrive alors pas par la coupe de la sélection mais par ce corps réémis — mesuré : sans
  // ce filtre, « Abréviations » ressortait en entrée de glossaire à définition vide. Le
  // retirer ici ne perd rien : `referenceBlocksToMd` le réémet comme titre du bloc.
  const body = lines
    .slice(target.titleLine, target.endLine)
    .filter((l) => !isBareLabelFor(l, REF_TAG_TO_KEY[opts.tag]))

  // Techniques : le corps existant peut déjà porter un ou plusieurs titres `### Titre`
  // (relus tels quels — `stripMarkup` ne reconnaît que `##`, jamais `###`, cf.
  // selection-to-reference.js). Les lignes REPRISES, elles, n'en portent pas encore : sans
  // marqueur à elles, `linesToTechniques` ne peut plus faire la différence une fois `body` et
  // `selected` concaténés — il les absorberait dans le corps de la DERNIÈRE technique
  // existante au lieu d'en faire une entrée à part. Seul CE point du code connaît encore la
  // frontière entre « déjà là » et « tout juste sélectionné » : on la marque ici, avec le
  // même « ### <1re ligne> » que produirait la création d'un bloc Techniques neuf (aucune
  // seconde règle de découpage : `linesToTechniques` interprète ensuite ce marqueur exactement
  // comme les autres).
  //
  // Correctif revue (régression) : la ligne testée/préfixée doit être NORMALISÉE
  // (`stripMarkup` puis trim), pas la ligne BRUTE. Deux défauts sinon, tous deux réels : une
  // sélection qui commence par une ligne blanche (glisser-sélectionner le plus courant)
  // préfixait `''` en `'### '`, qui ne matche plus `/^###\s+(.+)$/` une fois retrimée par
  // `selectionToFlat` — retombe dans le corps de la technique précédente au lieu d'ouvrir la
  // sienne (résurgence du défaut déjà corrigé, sous un autre déclencheur). Une sélection qui
  // commence par une puce (`- Montage tubulaire`) préfixait le tiret AVEC le texte
  // (`### - Montage tubulaire`) : le marqueur de puce atterrissait dans le titre au lieu
  // d'être retiré. On cherche donc la 1re ligne dont le contenu NORMALISÉ n'est pas vide (une
  // ligne blanche n'a rien à donner comme titre, on ne la préfixe pas : on saute par-dessus),
  // et c'est ce contenu normalisé — pas la ligne brute — qui devient le titre.
  const firstContentIdx = selected.findIndex((l) => stripMarkup(l).trim())
  let mergedSelected = selected
  if (REF_TAG_TO_KEY[opts.tag] === 'techniques' && firstContentIdx !== -1) {
    const normalized = stripMarkup(selected[firstContentIdx]).trim()
    if (!/^###\s+/.test(normalized)) {
      mergedSelected = [
        ...selected.slice(0, firstContentIdx),
        `### ${normalized}`,
        ...selected.slice(firstContentIdx + 1),
      ]
    }
  }

  // Corps existant + lignes reprises, ré-émis ENSEMBLE par retagSelection (donc via
  // stripMarkup puis referenceBlocksToMd) : la table ou la liste résultante est bien formée,
  // jamais recollée à la main.
  const merged = [...body, ...mergedSelected]
  const rebuilt = retagSelection(merged.join('\n'), 1, merged.length, 'reference', opts).changes[0]
  if (!rebuilt) return { changes: [] }

  // La plage remplacée couvre le titre ET le corps : `referenceBlocksToMd` ré-émet le titre.
  const blockFrom = offsetOf(target.titleLine)
  const blockTo = blockFrom + lines.slice(target.titleLine - 1, target.endLine).join('\n').length

  // Suppression de la sélection d'origine : on emporte le saut de ligne qui la précède quand
  // il y en a un, pour ne pas laisser une ligne vide orpheline.
  // Quand une ligne d'intitulé est absorbée, la coupe REMONTE jusqu'à elle : elle et les
  // lignes blanches qui la séparent de la sélection partent avec. `selected` (donc `selFrom`
  // et `selTo`) reste calé sur la sélection D'ORIGINE — l'intitulé ne doit jamais devenir du
  // contenu du bloc, ici pas plus qu'au chemin création.
  const absFrom = selection.absorbed != null ? offsetOf(selection.absorbed) : selFrom
  const cutFrom = absFrom > 0 ? absFrom - 1 : absFrom

  const changes = [
    { from: blockFrom, to: blockTo, insert: rebuilt.insert },
    { from: cutFrom, to: selTo, insert: '' },
  ]
  return { changes: changes.sort((a, b) => a.from - b.from) }
}

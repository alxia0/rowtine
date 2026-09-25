// Classification pure d'une ligne Rowtine-MD par sa syntaxe, pour piloter les
// décorations de l'éditeur CodeMirror. AUCUN import CM6/DOM ici :
// module chargeable tel quel par Vitest.
import { reservedKey, REF_TAG_TO_KEY, isPipeLine } from './refblocks.js'

// PRÉFIXES SYNTAXIQUES DES TITRES — exportés, et seuls écrits en littéral.
// `cm-editor.js` en a besoin pour la LONGUEUR du préfixe à masquer (`m[0].length`), pas
// pour le titre nu : il ne peut donc pas consommer H2_RE/SOUS_TITRE_RE, dont le `m[0]`
// couvre la ligne entière. Il en recopiait trois variantes (`/^##\s+/`, `/^###\s+/` et
// `/^#{2,3}\s/`) ; c'est exactement la divergence contre laquelle `refblocks.js` met en
// garde pour les tableaux — deux jeux de regex pour une même syntaxe dérivent au premier
// ajustement de dialecte, et l'éditeur cesse alors de montrer ce que le parseur lira.
export const H2_PREFIXE_RE = /^##\s+/
export const SOUS_TITRE_PREFIXE_RE = /^###\s+/

// Titre `## Titre {tag}` -> `tag`. Exportée pour que md-retag.js, parse.js et
// find-reference-block.js la réutilisent au lieu de la recopier chacun en dur :
// même mise en garde que ci-dessus, quatre jeux de regex identiques dériveraient
// au premier ajustement de dialecte au lieu d'un seul.
//
// ⚠️ `(|.*?\S)` et NON `(.*?)` : le motif d'origine faisait se CHEVAUCHER deux quantifieurs
// (`.*?` accepte les blancs, `\s*` aussi), donc à chaque position où le titre pouvait finir
// le moteur reparcourait toute la suite de blancs — coût quadratique. `## a` + 64 000
// espaces + `b` : 1 670 ms AVANT, 0,12 ms APRÈS (mesuré). L'éditeur rejoue `lineType` sur
// chaque ligne à CHAQUE redécoration CodeMirror : une seule ligne pathologique suffisait à
// faire ramer la frappe en continu. En exigeant que le groupe finisse sur un caractère NON
// blanc (`\S`), la frontière avec `\s*` devient unique : plus rien à explorer.
// Sémantique STRICTEMENT identique (l'alternative vide en tête reproduit le « plus court
// d'abord » du quantifieur paresseux) — vérifié par 300 000 tirages aléatoires comparant
// index et groupes des deux motifs : zéro divergence.
export const TITLE_KIND_RE = /^(|.*?\S)\s*\{([a-z0-9-]+)\}$/

// Même désambiguïsation que le parseur (src/utils/pattern-md/parse.js, dialecte
// EN) : un titre `## Titre {tag}` n'est un bloc référence que si `tag` EST une
// balise de référence (REF_TAG_TO_KEY) — ex. `## Fil {yarn}` — sinon (kind de
// travail EN/FR connu, ou tag inconnu, ex. `## Aiguilles {sleeve}`) c'est
// toujours une section de travail. Le test de titre réservé par slug ne
// s'applique qu'au titre sans attribut {kind}. × = U+00D7.
// Les regex de LIGNE ENTIÈRE sont construites À PARTIR des préfixes ci-dessus plutôt que
// réécrites en littéral : deux formes voisines dans le même fichier divergent aussi bien
// que deux formes dans deux fichiers, et ici la composition rend la divergence
// IMPOSSIBLE. `(.+?)\s*$` exige un titre non vide (`'## '` seul reste du `'texte'`) et
// rogne les blancs de fin — comportement d'origine, inchangé.
// Exportée pour que parse.js, md-retag.js et find-reference-block.js la réutilisent au lieu
// de recopier chacun le même littéral `/^##\s+(.+?)\s*$/` en dur — même mise en garde que
// TITLE_KIND_RE ci-dessus : plusieurs jeux de regex identiques dérivent au premier
// ajustement de dialecte.
// `(.*?\S|\s)` et non `(.+?)` : MÊME correctif anti-quadratique que TITLE_KIND_RE ci-dessus
// (`.+?` et `\s*` se chevauchaient), avec la MÊME sémantique — la seconde alternative `\s`
// conserve à l'identique le cas dégénéré d'un titre fait UNIQUEMENT de blancs (`'##  '`
// rendait `m[1] === ' '`, il le rend toujours). 1 685 ms → 0,11 ms sur `## a` + 64 000
// espaces + `b` ; zéro divergence sur 300 000 tirages aléatoires.
const TITRE_CORPS = '(.*?\\S|\\s)\\s*$'
export const H2_RE = new RegExp(H2_PREFIXE_RE.source + TITRE_CORPS)
// Sous-titre de technique (masquage vue enrichie) : `refblocks.js` émet
// `### ${t.title}` pour chaque technique d'un bloc `## Techniques {techniques}`.
// `\s+` juste après les trois dièses exclut naturellement `#### profond` (la ligne a
// une quatrième dièse à cette position, pas un blanc) : il reste `'texte'`, comme
// avant. H2_RE (`##\s+`) ne matche déjà pas `###…` (après `##` vient `#`, pas un
// blanc) ; ce test vit néanmoins APRÈS le test H2 dans `lineType` par lisibilité
// (l'ordre suit la hiérarchie des titres), et AVANT les tests image/note/puce qui
// n'ont eux aucune raison de se soucier d'un préfixe `#`.
// Même corps de titre que H2_RE (donc même correctif anti-quadratique, appliqué une seule
// fois) : deux formes voisines pour la même syntaxe divergeraient, cf. la mise en garde
// TITLE_KIND_RE plus haut.
const SOUS_TITRE_RE = new RegExp(SOUS_TITRE_PREFIXE_RE.source + TITRE_CORPS)
// `\s*` en tête : une image ancrée sous une étape est indentée (`  ![](…)`,
// cf. serialize.js) — elle doit être reconnue comme image comme la galerie.
const IMG_RE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/
// Exportées : md-retag.js recopiait ces deux-là à l'identique plutôt que de les
// réutiliser (IMG_RE ci-dessus, elle, DIFFÈRE réellement là-bas — pas de `\s*` en
// tête — donc reste propre à chaque fichier). Même mise en garde que TITLE_KIND_RE/
// H2_RE plus haut : deux jeux de regex identiques dériveraient au premier ajustement.
export const NOTE_RE = /^>\s?/
export const BULLET_RE = /^-\s+(.*)$/
const COUNTER_PREFIX_RE = /^\{(×|cadence)/

// Titre NU d'un titre de niveau 2 (`## Corps {sleeve}` → `Corps`), ou `null` si
// la ligne n'est pas un titre. Exporté pour que `step-line.js` n'ait pas à
// recopier H2_RE/TITLE_KIND_RE : deux jeux d'expressions régulières pour la
// même syntaxe dériveraient au premier changement de dialecte.
export function h2Title(line) {
  const m = H2_RE.exec(String(line ?? ''))
  if (!m) return null
  const tm = TITLE_KIND_RE.exec(m[1])
  return tm ? tm[1] : m[1]
}

// Clé interne de rubrique portée par une ligne de titre, ou `null` si la ligne n'est
// pas un bloc de référence — même désambiguïsation que le dispatch de blocs de
// parse.js. Exportée pour que find-reference-block.js la réutilise au lieu de la
// recopier (c'était le cas jusqu'ici, à l'identique) : même mise en garde que
// TITLE_KIND_RE/H2_RE plus haut dans ce fichier, un seul endroit à faire évoluer.
export function referenceKeyOfTitle(title) {
  const tm = TITLE_KIND_RE.exec(title)
  return tm ? (REF_TAG_TO_KEY[tm[2]] ?? null) : reservedKey(title)
}

export function lineType(line) {
  const l = String(line ?? '')

  const h2 = H2_RE.exec(l)
  if (h2) {
    return referenceKeyOfTitle(h2[1]) ? 'reference' : 'section'
  }

  if (SOUS_TITRE_RE.test(l)) return 'sous-titre'
  // Rangée de tableau — `isPipeLine` vient du parseur (refblocks.js), pas d'une
  // regex recopiée : l'éditeur et le parseur doivent s'accorder au caractère près sur ce
  // qu'est une rangée (cf. commentaire de l'export). Il exige une barre EN TÊTE et une
  // barre EN FIN (après trim), donc « un texte avec un | tuyau » reste `'texte'`, et une
  // barre isolée aussi (il en faut deux). La ligne SÉPARATRICE (`|---|---|`) est du même
  // type : c'est `isTableSep` qui la distingue, à l'usage, de ses voisines — en faire un
  // type à part ajouterait une catégorie à `lineClass` et à la barre de requalification
  // pour une ligne qui n'est jamais affichée seule.
  // Placé après le test des sous-titres et avant image/note/puce : aucun de ces trois ne
  // peut matcher une ligne commençant par une barre, l'ordre relatif est donc sans effet.
  if (isPipeLine(l)) return 'tableau'
  if (IMG_RE.test(l)) return 'image'
  if (NOTE_RE.test(l)) return 'note'

  const bullet = BULLET_RE.exec(l)
  if (bullet) return COUNTER_PREFIX_RE.test(bullet[1]) ? 'compteur' : 'rang'

  return 'texte'
}

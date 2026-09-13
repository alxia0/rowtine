// Pont reader <-> fragment Rowtine-MD (Lot B3 — éditeur MD in-app).
// Un « fragment » est le corps du Rowtine-MD (sections + blocs référence),
// SANS le bloc front-matter (`---…---`) : le nom/auteur/tailles du patron
// restent gérés par le formulaire hôte, pas par l'éditeur MD de la travailleuse.
// Aucune logique de rendu/parsing dupliquée : on réutilise patternToMd/mdToPattern
// telles quelles, en habillant/déshabillant le front-matter autour du fragment.
import { patternToMd } from './serialize'
import { mdToPattern } from './parse'
import { frontmatterKeyToEn } from './dialect'
import { MD_VERSION, VERSION_KEY } from './meta'

// emitFrontMatter (meta.js) produit toujours `---\nrowtine: N\n---\n`, suivi
// dans patternToMd d'un saut de ligne supplémentaire (séparateur de jointure)
// avant le premier contenu : on absorbe ce bloc + toutes les lignes vides qui
// suivent pour ne laisser que le fragment « pur ».
const FRONT_MATTER_RE = /^---\n[\s\S]*?\n---\n+/

export function readerToMdFragment(reader) {
  const { md } = patternToMd({ reader })
  return md.replace(FRONT_MATTER_RE, '')
}

// Ré-enveloppe le fragment d'un front-matter minimal avant de le confier à
// mdToPattern. Minimal ne veut pas dire « sans tailles » : le nombre de
// tailles (n) doit rester connu du parseur pour que les grilles multi-tailles
// (notation papier "104 (108) 112" -> {{i}} + c[]) se reparsent fidèlement —
// sans ça, mdTextToStep (n<2) renonce à toute vectorisation et le texte de
// rang resterait figé en texte plat. On tire donc `sizes:` des tailles COURANTES,
// jamais de titre/auteur/lien (qui restent hors du fragment, gérés ailleurs).
//
// Correctif revue finale (I1) : `overrideLabels` porte les tailles que la travailleuse
// vient de saisir dans le champ « Tailles » de l'écran de correction. Sans elles, l'éditeur
// émettait la table au NOUVEAU nombre de colonnes pendant que le parseur la relisait à
// l'ANCIEN (celui de baseReader) : la table tout juste reconstruite était rejetée
// (`sizes.countMismatch`) et rétrogradée en notes, donc le geste échouait au premier essai.
// Repli sur baseReader quand le champ est vide — MÊME repli que `normalizeReaderForSave`
// (reader-edit.js), pour que le nombre de colonnes attendu au parse et celui écrit à
// l'enregistrement ne puissent jamais diverger.
function minimalFrontMatter(baseReader, overrideLabels) {
  const override = (overrideLabels || []).map(String).map((s) => s.trim()).filter(Boolean)
  const sizeLabels = override.length ? override : (baseReader?.sizeLabels || []).map(String).filter(Boolean)
  // Réutilise la clé de version exportée par meta.js (VERSION_KEY/MD_VERSION) plutôt que de
  // la recopier en dur : un second littéral dériverait silencieusement au prochain renommage.
  const lines = ['---', `${VERSION_KEY}: ${MD_VERSION}`]
  if (sizeLabels.length) lines.push(`${frontmatterKeyToEn('tailles')}: ${sizeLabels.join(' · ')}`)
  lines.push('---', '')
  return lines.join('\n')
}

// Clone JSON défensif (Task D6/D6b, anti-aliasing) : baseReader est le snapshot
// durable de l'import, il ne doit JAMAIS être aliasé/muté (cf. reader-editable.js).
// Sert aux TROIS chemins qui, sinon, réutiliseraient un objet de baseReader PAR
// RÉFÉRENCE dans le reader de sortie : les deux replis symétriques (chart,
// reference — `?? baseReader.xxx`) ET le retour anticipé zéro-section (qui
// aliaserait le reader ENTIER, ensuite muté EN PLACE par carveUneditedSteps/
// reattachCharts/resolveReaderImages — la forme la plus sévère). On ne clone
// JAMAIS le résultat frais du reparse (`parsedReader.chart/.reference`) : déjà un
// objet neuf, le cloner perturberait pour rien les identités fraîches dont
// s'empare reattachCharts. Données pures (nombres/chaînes/tableaux/booléens),
// round-trip JSON fidèle, cf. `cloneStep` (reader-editable.js). `null`/`undefined`
// passent tels quels (un repli absent doit rester absent).
function cloneDeep(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

// `opts.sizeLabels` (facultatif) : tailles courantes de l'écran hôte, prioritaires sur
// celles de baseReader pour le SEUL front-matter (cf. minimalFrontMatter). Tout le reste
// — carving des steps non édités, gardes anti-effacement de `chart`/`reference` — continue
// de lire baseReader, qui reste le snapshot durable de l'import.
export function mdFragmentToReader(fragment, baseReader, { sizeLabels } = {}) {
  const wrapped = minimalFrontMatter(baseReader, sizeLabels) + '\n' + String(fragment ?? '')
  const { pattern, warnings } = mdToPattern(wrapped)
  const parsedReader = pattern?.reader
  const sections = parsedReader?.sections || []
  // Parse qui n'a produit aucune section exploitable (fragment vide/illisible) :
  // ne pas corrompre le reader existant. On renvoie un CLONE de baseReader (jamais
  // l'objet lui-même) : editableToReader enchaîne carveUneditedSteps/reattachCharts/
  // resolveReaderImages qui mutent le reader retourné EN PLACE (steps/chart/img) --
  // aliaser baseReader ici le corromprait en silence (aliasing D6 le plus sévère).
  if (!sections.length) return { reader: cloneDeep(baseReader), warnings }

  // Garde anti-wipe : serialize.js n'émet la grille d'une section {chart} QUE si un
  // step {chart:true} existe ET qu'une image est renseignée, sur section.chart (grille
  // propre à la section, Lot A multi-grilles) ou à défaut reader.chart (repli rétrocompat
  // patrons pré-multi-grilles) — cf. serialize.js. Un chart sans step chart ou sans image
  // n'a donc AUCUNE trace dans le fragment. Un reparse qui ne le retrouve pas ne doit pas
  // l'effacer — on retombe sur le chart de base (trade-off assumé : le chart devient
  // « collant », l'éditeur MD n'offre aucun chemin pour le supprimer). Même garde pour
  // `reference`, par symétrie, si un bloc référence ne re-sérialise pas.
  const reader = {
    ...baseReader,
    sections,
    chart: parsedReader.chart ?? cloneDeep(baseReader.chart),
    reference: parsedReader.reference ?? cloneDeep(baseReader.reference),
  }
  return { reader, warnings }
}

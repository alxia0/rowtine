// Avertissements ET erreurs système du moteur, sous forme de CODE + paramètres — jamais
// de phrase figée comme seul transport d'information.
//
// Pourquoi pas un simple `t()` dans le moteur : ces modules sont importés tels quels par
// le banc `tools/mdlab/*.mjs` sous Node, hors de toute application Vue. Un `import i18n`
// y ferait tout échouer. Le moteur nomme donc le problème ; l'application le raconte
// (cf. src/utils/warning-i18n.js) ; le banc se replie sur `formatWarningFr` ci-dessous.
//
// Depuis le 07/09, le canal sert aussi aux ERREURS destinées au rapport de
// synchro (ex. les cinq erreurs SAF de saf-storage.js) : la fabrique `E` ci-dessous pose
// le code et les params SUR une vraie Error, dont le verbatim français reste dans
// `.message` pour le diagnostic (console, logs, terminal) — à l'écran, c'est le code qui
// est traduit, et le verbatim survit en attribut title.
//
// ⚠️ Le NOMBRE d'avertissements est une grandeur mesurée ailleurs — `merge-pattern-md.js`
// refuse une fusion au-delà d'un seuil, et `tools/mdlab/bench.mjs` en publie le compte.
// Ce module change la FORME de chaque avertissement, jamais leur quantité.

export const WARNING_CODES = Object.freeze({
  ZIP_MISSING_IMAGE: 'zip.missingImage',
  BLOCK_NOT_A_TABLE: 'block.notATable',
  BLOCK_UNRECOGNIZED_LINE: 'block.unrecognizedLine',
  ABBR_NO_DEFINITION: 'abbr.noDefinition',
  SIZES_COUNT_MISMATCH: 'sizes.countMismatch',
  // Deux natures de perte distinctes lors du carving de l'éditeur (reader-editable.js), plutôt
  // qu'un `line.loss` générique dont le paramètre libre `detail` aurait fait voyager une phrase
  // FRANÇAISE en dur jusqu'à l'écran (bug repéré, corrigé ici avant d'exister en
  // production).
  LINE_LOSS_TOTAL: 'line.lossTotal',
  LINE_LOSS_SIZE_COUNTS: 'line.lossSizeCounts',
  MERGE_NO_SECTIONS: 'merge.noSections',
  MERGE_FEWER_SECTIONS: 'merge.fewerSections',
  MERGE_FEWER_STEPS: 'merge.fewerSteps',
  MERGE_TOO_MANY_WARNINGS: 'merge.tooManyWarnings',
  // Motifs de saut de la synchro MD→DB (patron-md-sync.js, résolution de l'entité live) —
  // le 01/09 : ces trois phrases voyageaient en FRANÇAIS en dur jusqu'au rapport de
  // synchro (fuite connue du 31/07, alors exemptées dans KNOWN_LEAKS du garde
  // warnings-no-french.spec.js). Migrées vers le canal du catalogue : code + traduction à
  // l'affichage (warningText). Le rapport de synchro n'est PAS persisté (store Pinia en
  // mémoire, réécrit à chaque passage) : aucun format de fichier concerné.
  SYNC_ORPHAN_FOLDER: 'sync.orphanFolder',
  SYNC_PROJECT_WITHOUT_PATTERN: 'sync.projectWithoutPattern',
  SYNC_NO_FORKED_PATTERN: 'sync.noForkedPattern',
  // Décision du 01/09 : le libellé `chart.repeat` (« 8 M × 24 Reihen » des démos, phrase libre
  // des patrons importés d'avant le 31/07) n'a AUCUNE place dans le format Rowtine-MD —
  // serialize.js ne peut pas l'émettre, parse.js le laisse vide (cf. commentaires là-bas,
  // revue 31/07 : l'affichage le reconstruit via chartMotifLabel). Une fusion MD→DB remplace
  // le reader ENTIER et perdait donc ce libellé EN SILENCE. La synchro (merge-pattern-md.js)
  // émet désormais ce code quand la fusion va perdre un libellé porté par l'interne. Pas de
  // préservation possible sans changer le format sur disque (migration exclue par ce choix) :
  // l'avertissement est le correctif minimal honnête.
  CHART_REPEAT_LABEL_LOST: 'chart.repeatLabelLost',
  // Bascule diagramme/image en attente (CorrectionView.vue), appliquée sur une section
  // retrouvée par empreinte image dans le reader reparsé : si l'empreinte ne matche plus rien
  // (édition texte concurrente sur la même ligne image), la bascule est perdue et signalée.
  // Deux codes plutôt qu'un `correction.loss` à `detail` libre (le nom du bloc perdu N'EST PAS
  // toujours connu : `original` peut être introuvable) — même raison que LINE_LOSS_* ci-dessus :
  // un `detail` composé en JS aurait fait voyager du FRANÇAIS en dur jusqu'à l'écran.
  CORRECTION_CHART_OP_LOST: 'correction.chartOpLost',
  CORRECTION_CHART_OP_LOST_NAMED: 'correction.chartOpLostNamed',
  // Le 30/07 : neuf phrases oubliées de l'inventaire initial, découvertes par la garde
  // `tests/unit/warnings-no-french.spec.js` — `meta.js` (front-matter) et
  // `parse.js` (sections de travail) poussaient encore du français en dur dans `warnings`.
  META_NO_FRONTMATTER: 'meta.noFrontmatter',
  META_UNREADABLE_LINE: 'meta.unreadableLine',
  META_UNKNOWN_KEY: 'meta.unknownKey',
  SECTION_UNKNOWN_SIZES: 'section.unknownSizes',
  SECTION_UNKNOWN_KIND: 'section.unknownKind',
  SECTION_ORPHAN_IMAGE: 'section.orphanImage',
  SECTION_EXTRA_CHART: 'section.extraChart',
  SECTION_REPEAT_NO_COUNT: 'section.repeatNoCount',
  SECTION_LOOSE_TEXT: 'section.looseText',
  // Erreurs de la couche SAF (saf-storage.js, lecture par tranches) — le 07/09 :
  // quatre de ces phrases françaises en dur (desync, chunkAlign, readStuck, sizeMismatch)
  // remontaient BRUTES dans le rapport de synchro (`patron-md-sync.js` ne transportait que
  // `err.message`), une utilisatrice en/de/es voyait du français exactement dans les rares
  // messages où comprendre compte. La cinquième (chunkSize) est une garde du constructeur
  // dont le paramètre n'existe qu'aux tests — elle n'atteint jamais le rapport, mais rejoint
  // le même canal par cohérence (un seul catalogue). Même canal que les avertissements :
  // la fabrique E() pose le code et les params SUR l'Error (le verbatim français reste dans
  // .message pour le diagnostic, journalisé par patron-md-sync.js et rendu en attribut title
  // par SyncReportDialog). Garde anti-régression : tests/unit/warnings-no-french.spec.js
  // interdit tout `new Error(` résiduel dans saf-storage.js.
  SAF_CHUNK_SIZE: 'saf.chunkSize',
  SAF_DESYNC: 'saf.desync',
  SAF_CHUNK_ALIGN: 'saf.chunkAlign',
  SAF_READ_STUCK: 'saf.readStuck',
  SAF_SIZE_MISMATCH: 'saf.sizeMismatch',
})

// Fabrique. `params` est toujours un objet (jamais `undefined`) : les sites d'affichage
// peuvent l'étaler sans garde.
export function W(code, params) {
  return { code, params: params || {} }
}

// Fabrique d'ERREUR codée, sœur de W ci-dessus (07/09) : une erreur destinée au
// rapport de synchro porte le même canal « code + params + traduction à l'affichage », mais
// elle reste une VRAIE Error — le verbatim français de `.message` est intact pour le
// diagnostic là où aucun `t()` n'existe (console dev, terminal, logcat), et `patron-md-sync.js`
// fait voyager l'objet ENTIER (code + params + message) dans `report.errors`. `params` est
// toujours un objet (jamais `undefined`), comme W.
export function E(code, params, message) {
  const err = new Error(message)
  err.code = code
  err.params = params || {}
  return err
}

const WARNING_CODE_SET = new Set(Object.values(WARNING_CODES))

// Un avertissement structuré n'est reconnu que si son `.code` figure au catalogue. Sans ce
// garde-fou, un objet Error du système de fichiers (`{ code: 'ENOENT', message: '…' }`, qui
// porte lui aussi un `.code` string) serait pris pour un avertissement du moteur : l'écran
// afficherait la clé i18n brute `warnings.ENOENT` au lieu du message d'erreur — pire que de ne
// rien traduire du tout.
export function isStructuredWarning(w) {
  return !!w && typeof w === 'object' && typeof w.code === 'string' && WARNING_CODE_SET.has(w.code)
}

// Repli pour un objet qui RESSEMBLE à un avertissement (il a un `.code`, ou n'importe quel
// autre champ) mais dont le code n'est pas au catalogue — cf. isStructuredWarning ci-dessus.
// Règle du projet : rien de ce qui remonte à l'utilisatrice ne doit s'évanouir. On n'affiche
// donc jamais une chaîne vide s'il existe un message exploitable ; à défaut, on dégrade vers
// une chaîne vide (rien à perdre : l'objet ne portait aucun texte lisible).
export function fallbackWarningText(w) {
  if (!w || typeof w !== 'object') return ''
  if (typeof w.message === 'string' && w.message) return w.message
  if (typeof w.reason === 'string' && w.reason) return w.reason
  return ''
}

// Libellés FR des blocs réservés, pour le repli banc Node UNIQUEMENT (formatWarningFr
// ci-dessous). Miroir volontaire de `KEY_LABELS` (refblocks.js) et de `warnings.blockName.*`
// (les 4 dictionnaires i18n) — trois copies à tenir synchronisées à la main, documenté ici :
// ce module reste zéro-dépendance (importable sous Node nu par le banc `tools/mdlab/*.mjs`),
// il ne peut donc PAS importer `KEY_LABELS` depuis refblocks.js (qui, lui, importe `../reader` —
// et créerait une dépendance circulaire refblocks.js → warning-codes.js → refblocks.js).
const BLOCK_NAMES_FR = {
  abbr: 'Abréviations',
  sizeTable: 'Tailles',
  yarn: 'Fil',
  needles: 'Aiguilles',
  gauge: 'Échantillon',
  materials: 'Matériel',
  techniques: 'Techniques',
  tips: 'Conseils',
}

// Repli FRANÇAIS, pour le banc Node et les rapports d'outillage UNIQUEMENT (jamais
// l'application, qui traduit via warning-i18n.js). Les phrases reprenaient à l'origine mot
// pour mot celles d'avant ce lot, pour que les rapports du banc restent comparables aux
// anciens ; depuis la resynchronisation du 06/09/2026, elles miroirent plutôt les traductions
// FR de l'app — cf. le commentaire du bloc `meta.*` ci-dessous.
const FR = {
  'zip.missingImage': (p) => `Image introuvable dans le zip : « ${p.ref} » — référence retirée, le reste du patron est conservé.`,
  'block.notATable': (p) => `Bloc « ${p.block} » : contenu non reconnu (table attendue), conservé en notes`,
  'block.unrecognizedLine': (p) => `Bloc « ${p.block} » : « ${p.line} » n'est pas reconnu ici, conservé en notes`,
  'abbr.noDefinition': (p) => `Abréviations : ligne « ${p.line} » sans définition, conservée en notes`,
  'sizes.countMismatch': (p) => `Tailles : ligne « ${p.label} » a ${p.got} valeurs (${p.expected} attendues), conservée en notes`,
  'line.lossTotal': (p) => `Ligne « ${p.line} » : le nombre de répétitions (total) n’a pas pu être conservé après correction.`,
  'line.lossSizeCounts': (p) => `Ligne « ${p.line} » : le décompte par taille n’a pas pu être conservé après correction.`,
  'merge.noSections': () => "le MD n'a produit aucune section alors que le patron interne en a",
  'merge.fewerSections': () => 'le MD a beaucoup moins de sections que le patron interne (réduction de plus de 50 %)',
  'merge.fewerSteps': () => "le MD a beaucoup moins d'étapes que le patron interne (réduction de plus de 50 %)",
  'merge.tooManyWarnings': (p) => `trop d'avertissements de lecture (${p.count}) : MD probablement mal compris`,
  // Bloc des codes posés le 01/09 (synchro MD→DB). Phrases miroir de fr.json
  // (mêmes réserves que meta.* ci-dessous : copies tenues à la main, resynchronisées à la
  // pose — les garde-fous de tests/unit/warning-i18n.spec.js rougissent si un code du
  // catalogue n'a pas d'entrée ici).
  'sync.orphanFolder': () => 'patron de bibliothèque introuvable dans les données de l’app (dossier orphelin)',
  'sync.projectWithoutPattern': () => 'projet introuvable ou sans patron lié',
  'sync.noForkedPattern': () => 'aucun patron forké pour ce projet (patron.md résiduel ignoré)',
  'chart.repeatLabelLost': () =>
    'libellé(s) de diagramme non conservés : patron.md ne transporte pas ce texte ; il sera reconstruit à l’affichage d’après les dimensions du diagramme',
  'correction.chartOpLost': () => `Le changement diagramme/image d’un bloc n’a pas pu être appliqué (bloc introuvable après correction).`,
  'correction.chartOpLostNamed': (p) => `Le changement diagramme/image du bloc « ${p.blockTitle} » n’a pas pu être appliqué (bloc introuvable après correction).`,
  // Miroir des traductions FR de l'app (`warnings.meta.*` de src/i18n/fr.json), tenu À LA
  // MAIN : resynchronisé le 06/09/2026 sur l'humanisation « front-matter » → « en-tête du
  // patron » du 16/08 (commit 5e57043b), qui n'avait pas été répercutée ici. La dérive reste
  // possible entre deux resynchronisations manuelles — le garde « miroir fr.json » de
  // tests/unit/warning-i18n.spec.js rougit si ces trois phrases décrochent à nouveau.
  'meta.noFrontmatter': () => `en-tête du patron absent (attendu tout en haut du fichier)`,
  'meta.unreadableLine': (p) => `en-tête du patron : ligne illisible « ${p.line} »`,
  'meta.unknownKey': (p) => `en-tête du patron : clé inconnue « ${p.key} »`,
  'section.unknownSizes': (p) => `Section « ${p.section} » : taille(s) inconnue(s) « ${p.sizes} » dans la grille`,
  'section.unknownKind': (p) => `Section « ${p.section} » : type inconnu « ${p.kind} » (repli pelote)`,
  'section.orphanImage': (p) => `Section « ${p.section} » : image indentée sans étape porteuse, ignorée`,
  // ⚠️ Ce `{chart}` est un LITTÉRAL (nom de balise Rowtine-MD), jamais une interpolation :
  // sans risque ici (simple gabarit JS), mais la phrase i18n (fr/en/de/es.json) reformule SANS
  // cette accolade — vue-i18n effacerait silencieusement `{chart}` en l'absence d'un paramètre
  // `chart` fourni (mesuré). Léger écart de formulation ASSUMÉ entre ce
  // repli Node et l'app, documenté plutôt que corrigé en douce.
  'section.extraChart': (p) => `Section « ${p.section} » : une seule grille par section {chart} ; diagramme supplémentaire ignoré`,
  'section.repeatNoCount': (p) => `Section « ${p.section} » : répétition sans nombre, rétrogradée en rang`,
  'section.looseText': (p) => `Section « ${p.section} » : texte hors puce/citation traité comme note`,
  // Erreurs SAF (codes saf.* ci-dessus) : miroir des phrases FR de l'app (warnings.saf.* de
  // src/i18n/fr.json), posées avec elles le 09/09/2026 — le banc mdlab doit pouvoir formater
  // ces codes s'il en rencontre. Copies tenues à la main, mêmes réserves que sync.*/meta.*.
  'saf.chunkSize': (p) => `taille de tranche invalide (${p.bytes} — multiple de 3 positif attendu)`,
  'saf.desync': (p) => `pont natif désynchronisé pour ${p.path} : lecture par tranches non supportée`,
  'saf.chunkAlign': (p) => `tranche non alignée à l'octet ${p.offset} de ${p.path} (concaténation base64 impossible)`,
  'saf.readStuck': (p) => `lecture bloquée à l'octet ${p.offset} de ${p.path}`,
  'saf.sizeMismatch': (p) => `taille incohérente pour ${p.path} : ${p.read} octets lus pour ${p.expected} annoncés (fichier modifié pendant la lecture ?)`,
}

export function formatWarningFr(w) {
  if (typeof w === 'string') return w
  if (isStructuredWarning(w)) {
    // `w.code` est garanti présent dans WARNING_CODES (cf. isStructuredWarning), mais RIEN ne
    // garantit qu'un futur code ajouté à WARNING_CODES ait aussi son entrée FR —
    // les deux tableaux sont maintenus à la main, dans deux endroits du fichier. Sans ce garde,
    // `FR[w.code]` vaudrait `undefined` et l'appeler planterait le banc Node avec un
    // `TypeError` (pas une dégradation lisible). On dégrade donc vers le code lui-même, comme
    // avant ce module (cf. tests/unit/warning-i18n.spec.js, invariant "tout code a une phrase").
    const fn = FR[w.code]
    if (!fn) return w.code
    const params = { ...w.params }
    // Même résolution que warning-i18n.js côté application : le moteur transporte la CLÉ du
    // bloc (`blockKey`), jamais son libellé — sinon un futur code non-FR transporterait quand
    // même une clé technique illisible dans le rapport du banc.
    if (params.blockKey) params.block = BLOCK_NAMES_FR[params.blockKey] || params.blockKey
    return fn(params)
  }
  return fallbackWarningText(w)
}

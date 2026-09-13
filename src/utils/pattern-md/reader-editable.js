// reader-editable.js — pont reader <-> texte Rowtine-MD éditable (Task B1, écran
// de correction post-import). Assemble les briques existantes (fragment.js,
// resolve-images.js) SANS logique de rendu/parsing dupliquée, pur, sans IO.
//
// readerToEditable(reader) -> { md, images } : md = fragment (readerToMdFragment) ;
// images = map chemin d'asset -> data-URL dérivée du reader (buildImageMap), pour
// alimenter les vignettes de l'éditeur (setImages).
//
// editableToReader(md, baseReader, opts) -> { reader, warnings } : reparse le fragment
// (mdFragmentToReader) PUIS ré-attache les data-URLs (resolveReaderImages).
//
// CARVING (anti-perte, cf. §Step1 f/g) : le dialecte Rowtine-MD ne peut pas
// toujours représenter fidèlement un step -- deux cas connus, sondés empiriquement :
//   (f) sizeLabels de longueur <2 avec un step.c présent : mdTextToStep (line.js)
//       renonce à toute vectorisation dès que n<2, `c` est perdu au reparse.
//   (g) step.repeat où total != c[0] : parse.js régénère TOUJOURS total = c[0]
//       (ou broadcast du nombre nu) à la relecture, la valeur d'origine est perdue.
// Dans les deux cas la perte est structurelle (dialecte), pas liée à une édition :
// même sans aucune modification humaine du texte, le brique-à-brique perd le champ.
// On la rattrape en comparant, step par step (même index de section ET de step),
// le rendu "papier" + le type (chart/note/repeat) + le nombre d'images du step
// fraîchement reparsé à celui du step de baseReader : si identiques, la ligne n'a
// PAS été éditée par la travailleuse -> on restaure le step d'origine de
// baseReader tel quel (clone défensif, jamais par référence -- baseReader est le
// snapshot durable de l'import, il ne doit jamais être aliasé/muté).
//
// Si le texte diffère, la ligne A été éditée. Deux sous-cas :
//  - RATTRAPAGE CIBLÉ (g) : `total` est une métadonnée ORTHOGONALE à la prose --
//    stepTextToMd ne le rend JAMAIS dans le texte papier (seuls t/c comptent).
//    Si les COMPTES (step.c, le vecteur de mailles/tailles qui définit le
//    total) sont restés identiques à ceux de baseReader, seule la prose a changé
//    (verbe, ponctuation...) -- le `total` d'origine reste valide et doit
//    survivre : on l'écrase par celui de baseReader (clone). Si les comptes ont
//    changé, le total fraîchement régénéré (c[0]) est le bon, pas de rattrapage.
//  - PERTE VISIBLE, JAMAIS SILENCIEUSE : si le step de baseReader portait une
//    donnée carve-eligible (f: `c` présent en taille unique ; g: total != c[0])
//    et qu'elle n'a PAS pu être rattrapée (ligne éditée d'une façon que le
//    rattrapage ciblé ne sait pas récupérer -- ex. (f) un nombre édité, le `c`
//    disparaît sans recours possible puisque mdTextToStep n'a jamais de vecteur
//    en taille unique), on n'invente PAS une fausse préservation : on pousse un
//    avertissement clair (FR, actionnable) dans `warnings`, cf. règle cardinale
//    du projet "jamais perdre d'info -- perte silencieuse = bug".
// best-effort au-delà de ça : on garde le step fraîchement parsé (on ne peut
// pas deviner la nouvelle distribution par taille d'une ligne que la
// travailleuse vient de changer).
// Cette même comparaison sert le Step 2 (éditer une ligne préserve les autres) :
// seule la ligne éditée diffère, toutes les autres sont restaurées à l'identique
// (images, compteurs, aide-mémoire compris, puisque non touchés par l'édition).
//
// Limite assumée (documentée, hors périmètre des tests de cette tâche) : si le
// nombre de sections ou de steps d'une section change (ajout/retrait), le carving
// est désactivé pour la zone concernée (comparaison positionnelle uniquement,
// pas de diff structurel) -- on retombe alors sur le reparse brut, sans le
// rattrapage. De même, si une ligne image est supprimée SANS toucher au texte de
// son step porteur, le nombre d'images fait partie de la signature de comparaison
// (voir stepSignature) : la suppression est donc bien détectée comme une édition
// et n'est pas silencieusement annulée.
//
// DIAGRAMMES (Task B2) : le carving ci-dessus est POSITIONNEL (même index de
// section ET de step) -- il ne suffit pas pour un diagramme, dont les métadonnées
// (rows/cols/readDir/reps/sizes/builtinLegend) doivent survivre même quand la
// travailleuse RENOMME ou RÉORDONNE la section qui le porte (l'éditeur existe
// justement pour ça). Pire : quand rows/cols valent 0 (sentinelle lossy connue),
// serialize.js n'émet MÊME PAS la ligne d'attributs (seule porteuse de readDir/
// reps/sizes) -- ces champs sont perdus au reparse même SANS aucune édition.
// On les récupère donc par une clé orthogonale au titre/à l'ordre : l'EMPREINTE
// DE CONTENU de l'image (photoFileName, même data-URL -> même hash), cf.
// reattachCharts ci-dessous. On ré-attache l'objet `chart` de baseReader ENTIER,
// jamais re-sérialisé -- la seule vérité de ces champs est baseReader.
import { readerToMdFragment, mdFragmentToReader } from './fragment'
import { resolveReaderImages, buildImageMap } from './resolve-images'
import { stepTextToMd } from './line'
import { photoFileName } from '@/backup/naming.js'
import { sectionIsChart } from '@/utils/reader-correction'
import { W, WARNING_CODES } from './warning-codes'
// Compteur pur déjà utilisé par la synchro dossier (merge-pattern-md.js) pour le même
// avertissement — aucune duplication de logique, symétrie exacte entre les deux voies
// qui remplacent un reader entier (fusion MD->DB / reparse éditeur) sans pouvoir
// transporter chart.repeat (hors dialecte Rowtine-MD, cf. parse.js:250-257).
import { chartRepeatLabelsLost } from '../../backup/merge-pattern-md'

export function readerToEditable(reader) {
  const md = readerToMdFragment(reader)
  const images = buildImageMap(reader)
  return { md, images }
}

// `opts.sizeLabels` (facultatif) : tailles courantes de l'écran hôte (champ « Tailles » de
// CorrectionView), passées telles quelles au front-matter minimal du reparse — cf.
// mdFragmentToReader (fragment.js). Elles ne touchent QUE le nombre de colonnes attendu par
// le parseur : le carving et les gardes anti-effacement lisent toujours baseReader.
//
// `opts.extraImages` (facultatif, retour terrain 27/08/2026) : map chemin -> data-URL de
// repli pour resolveReaderImages, en plus de celles que baseReader porte déjà. Cas d'usage
// unique connu : une image de GALERIE (pattern.gallery) insérée dans le texte depuis
// l'éditeur de correction n'est ancrée dans AUCUNE section de baseReader -- sans ce repli,
// sa data-URL resterait introuvable après le reparse et l'image resterait cassée.
export function editableToReader(md, baseReader, opts = {}) {
  const { reader: parsed, warnings: parseWarnings } = mdFragmentToReader(md, baseReader, opts)
  const { reader: carved, warnings: carveWarnings } = carveUneditedSteps(parsed, baseReader)
  reattachCharts(carved, baseReader)
  const reader = resolveReaderImages(carved, baseReader, opts.extraImages)
  const warnings = [...parseWarnings, ...carveWarnings]
  // Décision du 01/09 (cf. merge-pattern-md.js) : chart.repeat ne peut pas survivre à un
  // reparse Rowtine-MD. La garde anti-wipe de fragment.js protège le CAS où le chart entier
  // disparaît du reparse (repli sur baseReader.chart, libellé inclus) ; dès qu'un chart EST
  // reparsé (cas normal), son repeat retombe toujours vide — perte silencieuse jusqu'ici.
  // Comparaison AVANT/APRÈS (pas un simple ">0" sur baseReader) : une garde anti-wipe qui a
  // préservé le chart de base à l'identique ne doit PAS avertir (rien n'est perdu).
  if (chartRepeatLabelsLost({ reader }) < chartRepeatLabelsLost({ reader: baseReader })) {
    warnings.push(W(WARNING_CODES.CHART_REPEAT_LABEL_LOST))
  }
  return { reader, warnings }
}

// Empreinte de contenu d'une image de diagramme, indépendante de sa forme
// (data-URL brute côté baseReader, chemin d'asset `img/photo-<hash>.<ext>` côté
// section fraîchement reparsée) : les deux formes convergent vers le MÊME nom de
// fichier `photo-<hash>.<ext>` (nommage déterministe par contenu, photoFileName),
// il suffit de comparer le nom de base. `null` si rien d'exploitable (jamais de
// throw -- une section-diagramme sans image ne peut simplement pas être matchée).
function chartFingerprint(img) {
  if (typeof img !== 'string' || !img) return null
  if (img.startsWith('data:')) return photoFileName(img, 0)
  const parts = img.split('/')
  return parts[parts.length - 1] || null
}

// Ré-attache, PAR EMPREINTE IMAGE, l'objet `chart` d'origine (baseReader) sur la
// section correspondante du reader reparsé -- quels que soient son titre ou sa
// position après édition. Robuste au renommage ET au réordre (contrairement à un
// appariement par titre/index) car la clé est le CONTENU de l'image, jamais la
// prose ni l'ordre des sections.
//
// Cas dégénérés (jamais de perte silencieuse ni de throw, best-effort documenté) :
//  - chart sans image exploitable (baseReader) : aucune empreinte, pas de clé ->
//    ce diagramme ne peut être ré-attaché (il n'a de toute façon aucune trace
//    dans le md, cf. garde `!(ch && ch.img)` dans serialize.js -- perte pré-
//    existante, hors périmètre de cette tâche).
//  - section-diagramme supprimée dans l'éditeur : son empreinte reste dans la
//    table mais n'est jamais consommée -- pas de résurrection, comportement
//    voulu (l'éditeur MD n'offre pas de "suppression" plus fine du diagramme).
//  - deux diagrammes PARTAGEANT la même image (même empreinte) : appariés dans
//    l'ORDRE D'APPARITION (FIFO) de baseReader vers le reader reparsé -- limite
//    assumée si leur ordre relatif est lui-même inversé par l'édition (contenu
//    identique = indiscernable par empreinte seule).
function reattachCharts(reader, baseReader) {
  const queues = new Map()
  for (const sec of baseReader?.sections || []) {
    if (!sectionIsChart(sec)) continue
    const fp = chartFingerprint(sec.chart?.img)
    if (!fp) continue
    if (!queues.has(fp)) queues.set(fp, [])
    queues.get(fp).push(sec.chart)
  }
  if (queues.size === 0) return reader

  for (const sec of reader?.sections || []) {
    if (!sec?.chart) continue
    const fp = chartFingerprint(sec.chart.img)
    if (!fp) continue
    const queue = queues.get(fp)
    if (!queue || !queue.length) continue
    sec.chart = cloneStep(queue.shift())
  }
  return reader
}

// Signature "papier" d'un step : type + nombre d'images + texte rendu (placeholders
// résolus). Deux steps de même signature sont indiscernables du point de vue de la
// travailleuse dans le texte éditable -- la ligne n'a pas été touchée.
function stepSignature(step) {
  if (!step) return null
  const imgCount = Array.isArray(step.imgs) ? step.imgs.length : 0
  if (step.chart) return `chart|${imgCount}`
  const kind = step.note ? 'note' : step.repeat ? 'repeat' : 'row'
  return `${kind}|${imgCount}|${stepTextToMd(step.t, step.c)}`
}

// Clone JSON défensif : les steps sont des données pures (chaînes, nombres,
// tableaux, booléens), jamais de fonctions/dates -- round-trip JSON est fidèle et
// évite toute dépendance à `structuredClone`.
function cloneStep(step) {
  return JSON.parse(JSON.stringify(step))
}

// Égalité profonde d'un vecteur de comptes (step.c, ou step.total) : ce sont
// des données pures, JSON.stringify suffit. `?? null` normalise `undefined`
// pour ne jamais comparer deux `undefined` comme "égaux" par accident (un
// total disparu ne doit jamais paraître identique à un total présent).
function countsEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

// RATTRAPAGE CIBLÉ (g) : `total` est orthogonal à la prose (stepTextToMd ne le
// rend jamais dans le texte papier). Si les comptes (step.c, le vecteur qui
// définit le total) sont restés IDENTIQUES entre le step fraîchement reparsé
// et celui de baseReader, alors seule la prose a changé (verbe, ponctuation) :
// le `total` d'origine reste valide et doit survivre à l'édition -- on
// l'écrase par celui de baseReader (clone, jamais par référence). Si les
// comptes ont changé, ou si la ligne n'est plus détectée comme une répétition,
// aucun rattrapage : le total fraîchement régénéré est le seul disponible.
// Retourne true si le rattrapage a eu lieu (mute `parsed.total` en place).
function rescueRepeatTotal(parsed, base) {
  // Un marqueur ÉDITEUR ({×N}, origin:'editor') encode le total voulu par la travailleuse,
  // INDÉPENDAMMENT des comptes de mailles : ne jamais le ré-écraser par la base, même si
  // les comptes n'ont pas bougé (sinon un « - {×5} … » ET une prose éditée redonnerait
  // l'ancien total via ce chemin, cf. bug Roni par la branche rescue).
  if (parsed?.origin === 'editor') return false
  if (!base?.repeat || !Array.isArray(base.c) || !Array.isArray(base.total)) return false
  if (!parsed?.repeat || !Array.isArray(parsed.c)) return false
  if (!countsEqual(parsed.c, base.c)) return false
  parsed.total = cloneStep(base.total)
  return true
}

// Vrai si `parsed` est un compteur EXPLICITE de l'éditeur ({×N}/{cadence X×N}, tag
// origin:'editor' posé par parse.js) dont le `total` a été DÉLIBÉRÉMENT changé par
// rapport à la base : dans ce seul cas la valeur de la travailleuse prime et le carving
// positionnel doit être court-circuité. Un marqueur relu à l'identique (même total, ex.
// total lossy d'import re-sérialisé en {×N}) n'est PAS un override → carving normal.
function isEditorTotalOverride(parsed, base) {
  return parsed?.origin === 'editor' && parsed?.repeat && !countsEqual(parsed.total, base?.total)
}

// PERTE VISIBLE (jamais silencieuse) : si le step de baseReader portait une
// donnée carve-eligible -- (f) `c` présent en taille unique, et/ou (g) total !=
// c[0] -- et qu'elle est encore absente/regénérée après reparse + rattrapage
// ciblé, on ne l'invente pas : on retourne la liste des CODES décrivant CHAQUE
// perte (tableau vide si rien n'est perdu) -- jamais de phrase française en dur
// ici : ce module reste zéro-dépendance i18n (cf. warning-codes.js), la phrase
// se construit à l'affichage (warning-i18n.js) ou dans le banc (formatWarningFr).
// Les deux cas sont indépendants (l'un porte sur `total`, l'autre sur `c`) : une
// même ligne éditée peut perdre les deux à la fois, donc on les ACCUMULE (pas de
// `return` prématuré) plutôt que de s'arrêter au premier match. Le texte de la
// ligne (paramètre `line`) est attaché par l'appelant (carveUneditedSteps), qui
// seul connaît `paperText` -- celui de la ligne APRÈS édition (parsed), pour que
// la travailleuse retrouve la ligne dans l'éditeur.
function remainingCarveLoss(parsed, base, sizeLabelsLen) {
  const codes = []
  if (!base) return codes
  if (base.repeat && Array.isArray(base.c) && Array.isArray(base.total) &&
      !countsEqual(base.total, base.c[0])) {
    // Un total posé DÉLIBÉRÉMENT dans l'éditeur ({×N}, origin:'editor') est écrit
    // NOIR SUR BLANC dans le marqueur : il n'est jamais « perdu », il est CHOISI.
    // Tant que la ligne reste un compteur éditeur ET que les comptes de mailles (c)
    // n'ont pas bougé (mêmes conditions que rescueRepeatTotal), la valeur éditeur est
    // authoritative → PAS de perte-total à signaler (sinon faux avertissement quand
    // la base était « lossy » et que la prose est aussi retouchée, cf. bug Roni par
    // le chemin ÉDITÉ). Court-circuit volontairement ÉTROIT : si les comptes ONT
    // changé (ex. taille unique n<2, `c` non reconstruit — fixture (f)+(g)), la ligne
    // a réellement perdu de l'info et l'avertissement total légitime reste émis,
    // exactement comme pour tout total lossy NON éditeur.
    const editorTotalSafe = parsed?.origin === 'editor' && countsEqual(parsed?.c, base.c)
    if (!editorTotalSafe && !countsEqual(parsed?.total, base.total)) {
      codes.push(WARNING_CODES.LINE_LOSS_TOTAL)
    }
  }
  if (sizeLabelsLen < 2 && Array.isArray(base.c) && base.c.length) {
    if (!Array.isArray(parsed?.c) || !countsEqual(parsed.c, base.c)) {
      codes.push(WARNING_CODES.LINE_LOSS_SIZE_COUNTS)
    }
  }
  return codes
}

// Restaure, POUR CHAQUE STEP NON ÉDITÉ (signature identique à baseReader, même
// index de section et de step), le step d'origine de baseReader -- rattrape les
// pertes structurelles du dialecte (f, g) sans jamais aliaser baseReader (clone).
// Pour un step ÉDITÉ (signature différente), tente le rattrapage ciblé du total
// de répétition (g) puis, si une perte carve-eligible subsiste malgré tout,
// pousse un avertissement clair dans `warnings` (jamais de perte silencieuse).
// Ne s'applique que si les tableaux sections/steps ont la même longueur (sinon la
// correspondance positionnelle n'est plus fiable) ; sinon la zone concernée reste
// telle que fraîchement reparsée (pas de perte supplémentaire, pas de rattrapage
// non plus -- limite assumée, cf. commentaire d'en-tête).
function carveUneditedSteps(parsedReader, baseReader) {
  const warnings = []
  const baseSections = baseReader?.sections
  const sections = parsedReader?.sections
  if (!Array.isArray(baseSections) || !Array.isArray(sections)) {
    return { reader: parsedReader, warnings }
  }
  if (sections.length !== baseSections.length) return { reader: parsedReader, warnings }

  const sizeLabelsLen = Array.isArray(baseReader?.sizeLabels) ? baseReader.sizeLabels.length : 0

  for (let i = 0; i < sections.length; i++) {
    const baseSteps = baseSections[i]?.steps
    const steps = sections[i]?.steps
    if (!Array.isArray(baseSteps) || !Array.isArray(steps)) continue
    if (steps.length !== baseSteps.length) continue
    for (let j = 0; j < steps.length; j++) {
      const base = baseSteps[j]
      const parsed = steps[j]
      if (stepSignature(parsed) === stepSignature(base)) {
        // Texte papier identique : normalement une ligne NON éditée → restaurer le step
        // d'origine (rattrape f et g sans distinction). EXCEPTION : un marqueur EXPLICITE
        // de l'éditeur dont le total DIFFÈRE de la base = correction du COMPTEUR SEUL
        // ({×5} sur Roni, la prose « … 5 times (= mailles) » ne bouge pas). La signature
        // ignore le marqueur ET le total (stepSignature), donc sans cette exception restore
        // ré-imposerait l'ancien total → perte SILENCIEUSE de la correction. On exige un
        // total DIFFÉRENT pour ne pas toucher un marqueur simplement relu à l'identique
        // (total lossy d'import re-sérialisé en {×N}, origin:'editor' mais valeur inchangée
        // → doit rester carvé/restauré byte-identique, sans champ `origin` fantôme).
        if (isEditorTotalOverride(parsed, base)) continue
        // Le reparse vient de VECTORISER cette ligne (`c` neuf) alors que la base n'avait
        // aucun décompte par taille : restaurer la base ANNULERAIT la vectorisation. C'est
        // le cas réel de la correction des tailles (la travailleuse passe « Taille unique »
        // à « S, M, L » dans CorrectionView) : `stepSignature` re-rend `{{i}}`/`c` en texte
        // papier, donc la ligne fraîchement vectorisée a la MÊME signature que sa base
        // plate et se faisait écraser — la correction était un no-op silencieux sur toutes
        // les lignes que la travailleuse n'avait pas retapées elle-même (cf. opts.sizeLabels,
        // fragment.js). Sens STRICT (parsed a `c`, base n'en a pas) : le cas inverse
        // (perte de `c` en taille unique) reste géré par remainingCarveLoss.
        const gainedCounts = Array.isArray(parsed?.c) && parsed.c.length &&
          !(Array.isArray(base?.c) && base.c.length)
        if (gainedCounts) continue
        steps[j] = cloneStep(base)
        continue
      }
      // Ligne éditée : rattrapage ciblé du total si les comptes n'ont pas
      // bougé, puis avertissement visible si une perte carve-eligible subsiste.
      // `rescueRepeatTotal` ne touche PAS un marqueur éditeur (garde interne) : une valeur
      // posée explicitement ne doit jamais être ré-écrasée par la base.
      rescueRepeatTotal(parsed, base)
      const lossCodes = remainingCarveLoss(parsed, base, sizeLabelsLen)
      if (lossCodes.length) {
        const paperText = stepTextToMd(parsed?.t, parsed?.c)
        for (const code of lossCodes) {
          warnings.push(W(code, { line: paperText }))
        }
      }
    }
  }
  return { reader: parsedReader, warnings }
}

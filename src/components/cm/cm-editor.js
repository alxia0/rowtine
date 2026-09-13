// Éditeur CodeMirror 6 — v2 du banc, ADDITIF : ne remplace pas
// encore editor.js dans main.js (bascule prévue). Même API
// getValue/setValue que editor.js pour que main.js puisse migrer sans douleur.
// Promu dans src/ (moteur unique) : source de vérité unique, le banc
// tools/mdedit/main.js importe désormais depuis ici (@/components/cm/cm-editor.js).
import { StateEffect, StateField, EditorState, EditorSelection, Compartment } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { lineType, H2_PREFIXE_RE, SOUS_TITRE_PREFIXE_RE, TITLE_KIND_RE } from '@/utils/pattern-md/md-line-type.js'
import { retagSelection, mergeIntoReference } from '@/utils/pattern-md/md-retag-selection.js'
import { retagLine } from '@/utils/pattern-md/md-retag.js'
import { parseStepCounter, parseSectionRepeat } from '@/utils/pattern-md/counters.js'
import { resolveImageSrc } from '@/utils/pattern-md/resolve-image-src.js'
import { groupedSectionKinds, DEFAULT_KIND } from '@/utils/section-kinds.js'
import { ICONS } from '@/utils/icons'
import { reservedKey, REF_TAG_TO_KEY, isTableSep, splitCells, isPipeLine } from '@/utils/pattern-md/refblocks.js'
import { kindToFr } from '@/utils/pattern-md/dialect.js'
import { recheckCaretMargin } from '@/utils/keyboard-avoidance.js'
import { trapTabFocus } from '@/composables/useFocusTrap'
import fr from '@/i18n/fr.json'

// @codemirror/view est épinglé à 6.43.6 dans package.json (version exacte, sans `^`)
// depuis le 2026-08-16. À partir de la 6.43.7, le retour-arrière en tout début de
// ligne ne retire plus proprement le balisage `- ` d'une ligne rang (le texte se
// retrouve avec un `-` résiduel) ; test qui l'attrape :
// tests/e2e/correction-editor-keys.spec.js (« Retour-arrière en tout début de
// ligne »). Bissection confirmée : 6.43.6 passe, 6.43.7 échoue déjà.
//
// Mécanisme établi le 2026-09-06 (diff des tarballs npm 6.43.6 → 6.43.11) : la
// 6.43.7 réécrit deux routines de position/DOM — LineTile.resolveInline (choix du
// côté d'un widget où atterrit une position : les conditions TileFlag.After/Before
// deviennent dépendantes de `side`) et TilePointer.advance (ordre du signalement
// walker.skip pendant la reconstruction DOM ; changelog : « widgets changing length
// could break content updates » — exactement notre RowCheckWidget, qui remplace 2
// caractères) — et introduit au passage un balayage ALÉATOIRE dans posAtCoords
// (supprimé en 6.43.8 : « identical posAtCoords queries could return different
// results »). Le calcul de suppression, lui, vit dans @codemirror/commands
// (deleteByChar + skipAtomic, pur modèle) et n'a pas bougé. La 6.43.11 (03/09)
// n'a réverté ni corrigé ces routines — pas de correctif amont identifiable.
// En attendant une version amont vérifiable : deleteMarkupBackward (plus bas)
// rend le geste indépendant de la résolution du curseur au bord du widget, et
// l'épinglage reste.
// Portée réelle de l'épinglage : il bloque la RE-RÉSOLUTION au `yarn install`
// (un simple retour à une plage `^6.43.6` suffit à se faire re-résoudre vers la
// dernière version autorisée dès le prochain install — vérifié). Il ne bloque PAS
// un `yarn up @codemirror/view` explicite, qui réécrit la plage sans égard pour
// l'épinglage précédent (comportement documenté de `yarn up`).
// Dette technique connue.

// Même regex qu'ailleurs dans le banc (md-line-type.js, md-retag.js) : une
// ligne « rang » est `- <contenu>` ; son contenu peut lui-même porter un
// préfixe compteur `{×N}` / `{cadence X×N}` (counters.js).
const BULLET_RE = /^-\s+(.*)$/

// -----------------------------------------------------------------------
// État hideMarkup — booléen, défaut = enrichi (masqué). Un
// StateEffect le bascule ; toggleMarkup() (plus bas) dispatch cet effet et
// renvoie le nouvel état pour que main.js mette à jour le libellé du bouton.
// -----------------------------------------------------------------------
const setHideMarkupEffect = StateEffect.define()

const hideMarkup = StateField.define({
  create() {
    return true
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHideMarkupEffect)) value = effect.value
    }
    return value
  },
})

// A-t-on changé de mode (enrichi ↔ brut) dans cette transaction ? Ni docChanged
// ni viewportChanged ne le détectent (piège identifié par la revue) : les deux
// plugins de masquage (markupMaskPlugin ci-dessous, counterWidgetPlugin plus
// bas) doivent explicitement tester ça pour se reconstruire au 1er clic.
function hideMarkupChanged(update) {
  return update.startState.field(hideMarkup) !== update.state.field(hideMarkup)
}

// -----------------------------------------------------------------------
// État imageMap (feature « images inline ») — porte la map basename → URL
// locale construite par main.js (setImages) après chargement d'un dossier
// d'images (`_images/` extrait à côté du PDF, cf. extract_images.py). Même
// mécanique StateField/StateEffect que hideMarkup : réactif, recomputé au
// prochain rendu quand la map change (aucune image chargée → null, le
// placeholder texte reste l'affichage par défaut, cf. pickImageWidget).
// -----------------------------------------------------------------------
const setImagesEffect = StateEffect.define()

const imagesField = StateField.define({
  create() {
    return null
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setImagesEffect)) value = effect.value
    }
    return value
  },
})

function imagesChanged(update) {
  return update.startState.field(imagesField) !== update.state.field(imagesField)
}

// -----------------------------------------------------------------------
// Décorations de type de ligne (inchangé)
// -----------------------------------------------------------------------

// Classe CSS d'une ligne selon son type + son état de sélection. Pure (aucun
// CM6/DOM) pour être testable : combine la classe de catégorie (md-<type>),
// l'affordance image sélectionnée et le bloc actif (#3a, ligne du
// curseur surlignée — caret peu visible, surtout en sombre).
export function lineClass(type, isSelectedLine, isImageSelected) {
  const parts = [`md-${type}`]
  if (type === 'image' && isImageSelected) parts.push('cm-image-line-selected')
  if (isSelectedLine) parts.push('cm-active-block')
  return parts.join(' ')
}

// Construit le jeu de décorations de ligne pour les lignes visibles du
// viewport : une classe `md-<type>` par ligne, posée via Decoration.line().
// Décorations de ligne = jamais de plage vide ; on ne décore que ce qui est
// à l'écran (viewport), recalculé au moindre changement de doc ou de viewport.
function buildDecorations(view) {
  const builder = []
  // Ligne du curseur : sert à poser l'affordance visuelle « ligne image
  // sélectionnée » (tap-to-select) et le bloc actif (#3a) — le
  // curseur y arrive via selectImageLine() plus bas, jamais par un tap natif
  // (widget atomique).
  const selectedLine = view.state.doc.lineAt(view.state.selection.main.head).number
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const type = lineType(line.text)
      const isSel = line.number === selectedLine
      const cls = lineClass(type, isSel, type === 'image' && isSel)
      builder.push(Decoration.line({ class: cls }).range(line.from))
      pos = line.to + 1
    }
  }
  return Decoration.set(builder, true)
}

// Décore chaque ligne visible selon son type (section/rang/note/image/
// compteur/référence/texte) — gouttière + fond, cf. styles.css. Rebuild aussi
// sur selectionSet (pas seulement docChanged/viewportChanged) : buildDecorations
// pose en plus `cm-image-line-selected` sur la ligne image du curseur (affordance
// visuelle du tap-to-select), qui doit suivre le déplacement du
// curseur SANS édition du document (ex. un simple tap sur une autre image).
const lineTypePlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view)
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

// -----------------------------------------------------------------------
// Widget compteur — une puce cliquable `×N` / `cadence X×N` qui
// remplace visuellement le préfixe `{...}` d'une ligne compteur.
// -----------------------------------------------------------------------

// Repère le compteur (s'il y en a un) porté par une ligne `- {...} texte`,
// et l'étendue exacte (offsets absolus dans le doc) du préfixe `{...}` à
// remplacer par le widget. Renvoie `null` si la ligne n'est pas un compteur
// (jamais de throw sur une ligne malformée : parseStepCounter est déjà pur
// et total).
function counterOnLine(line) {
  const bullet = BULLET_RE.exec(line.text)
  if (!bullet) return null
  const content = bullet[1]
  const { counter, rest } = parseStepCounter(content)
  if (!counter) return null
  const contentStart = line.from + (line.text.length - content.length)
  const counterLen = content.length - rest.length
  if (counterLen <= 0) return null
  return { from: contentStart, to: contentStart + counterLen, counter }
}

function counterLabel(counter) {
  return counter.kind === 'cadence' ? `cadence ${counter.every}×${counter.times}` : `×${counter.times}`
}

// Puces cliquables du texte (CounterWidget/SectionKindWidget) — après revue :
// `role="button" tabindex="0"` + un seul écouteur `click` les rendait
// atteignables au Tab (annoncées comme bouton) mais Entrée/Espace ne faisaient RIEN —
// un vrai manquement WCAG 2.1.1, la souris/le tactile étaient les SEULES voies
// d'activation. Ce helper partagé pose le même clavier que `role="button"` l'exige
// nativement (Entrée ET Espace, Espace seulement au keyup pour éviter tout scroll de
// page parasite — même convention que les boutons natifs du navigateur).
// `stopPropagation` : sans lui, un Entrée/Espace reçu alors que le focus est DANS le
// contentDOM de CM6 (ce span y vit) remonterait au clavier par défaut de l'éditeur
// (`defaultKeymap`), qui interprète Entrée comme « couper la ligne » — DANS le texte
// du patron, pas dans un simple bouton. `preventDefault` en plus sur Espace : évite
// le défilement de page qu'un `<button>` natif bloque déjà tout seul.
function wireChipKeyboardActivation(span, onActivate) {
  span.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onActivate()
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      event.stopPropagation()
    }
  })
  span.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      event.stopPropagation()
      onActivate()
    }
  })
}

class CounterWidget extends WidgetType {
  constructor(counter, onEdit, title, from) {
    super()
    // Position de la ligne : ENTRE dans `eq()` comme pour ReferenceTitleWidget/
    // ImageThumbWidget/ImagePlaceholderWidget/TableWidget. `onEdit` gèle `line.number` à la
    // construction ; sans `from` dans l'égalité, deux puces au compteur IDENTIQUE restaient
    // interchangeables, CodeMirror réutilisait le nœud DOM (et donc la fermeture périmée)
    // après un décalage de lignes, et éditer une puce réécrivait le compteur d'une AUTRE
    // ligne — ou levait un RangeError si le numéro gelé dépassait la fin du document.
    this.from = from
    this.counter = counter
    this.onEdit = onEdit
    // Libellé traduit (labels.editCounterTitle, cf. buildCounterWidgets) — repli
    // FR déjà assuré en amont par le merge FR_TOOLBAR_LABELS de createCmEditor,
    // donc jamais undefined en pratique ; filet de sécurité ici quand même, sur
    // la même source FR_TOOLBAR_LABELS (pas une 2e chaîne dupliquée à la main).
    this.title = title || FR_TOOLBAR_LABELS.editCounterTitle
  }
  eq(other) {
    return (
      other.counter.kind === this.counter.kind &&
      other.counter.times === this.counter.times &&
      other.counter.every === this.counter.every &&
      other.title === this.title &&
      other.from === this.from
    )
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-counter-chip'
    span.setAttribute('role', 'button')
    span.tabIndex = 0
    span.textContent = counterLabel(this.counter)
    span.title = this.title
    span.addEventListener('click', (event) => {
      event.preventDefault()
      this.onEdit()
    })
    wireChipKeyboardActivation(span, () => this.onEdit())
    return span
  }
  // Après revue : absent jusqu'ici — sans lui, `keydown`/`keyup`
  // (posés par wireChipKeyboardActivation ci-dessus) restaient soumis au clavier par
  // défaut de CM6 AVANT de pouvoir atteindre les écouteurs du span, `stopPropagation`
  // compris (CM6 intercepte au niveau de la vue, en amont du DOM natif). Même patron
  // que ReferenceTitleWidget/SectionKindWidget : ignore tout sauf les évènements que
  // ce widget gère lui-même explicitement.
  ignoreEvent(event) {
    return !['mousedown', 'click', 'keydown', 'keyup'].includes(event.type)
  }
}

// Demande les nouvelles valeurs (N, et X pour une cadence) via un mini-dialogue
// à clavier numérique (openNumberPrompt/openNumberFormPrompt, cf. plus bas —
// remplace l'ex-promptInt/window.prompt qui ouvrait le clavier AZERTY complet)
// et réécrit la ligne via retagLine. N'écrit rien si l'utilisateur annule ou
// laisse un champ vide/non numérique — jamais de throw.
// `labels` : libellés du mini-dialogue (cf. FR_PROMPT_LABELS / opts.labels.prompt
// de createCmEditor) — propres à CET éditeur, passés en argument explicite tout
// le long de la chaîne d'appel (counterWidgetPlugin -> buildCounterWidgets ->
// onEdit -> ici) pour rester corrects si deux éditeurs coexistent avec des
// langues différentes (cf. commentaire de createCounterWidgetPlugin plus bas).
async function editCounterOnLine(view, lineNumber, labels) {
  const line = view.state.doc.line(lineNumber)
  const hit = counterOnLine(line)
  if (!hit) return

  // Cadence : même formulaire fusionné à 2 champs (openNumberFormPrompt) que
  // le sous-choix Cadence de la barre — la ré-édition depuis le chip du texte a
  // désormais la même carte que la création initiale, au lieu de 2 dialogues
  // séquentiels. Même ordre X puis N (cf. convention d'affichage « cadence X×N »).
  if (hit.counter.kind === 'cadence') {
    const values = await openNumberFormPrompt(
      [
        { label: labels.prompt.cadenceEvery, fallback: hit.counter.every },
        { label: labels.prompt.cadenceTimes, fallback: hit.counter.times },
      ],
      labels.prompt.cancel
    )
    if (values === null) return
    const [every, times] = values
    const newText = retagLine(line.text, 'compteur-cadence', { every, times })
    view.dispatch({ changes: { from: line.from, to: line.to, insert: newText } })
    return
  }

  // Répétition : INCHANGÉE (1 seul champ, openNumberPrompt) — ce cas n'est pas
  // touché ici.
  const times = await openNumberPrompt(labels.prompt.repeatTimes, hit.counter.times, labels.prompt.cancel)
  if (times === null) return
  const newText = retagLine(line.text, 'compteur-rep', { times })
  view.dispatch({ changes: { from: line.from, to: line.to, insert: newText } })
}

// Ouvre le MÊME popover Section que la puce de la barre d'outils (openMenuPopover +
// sectionMenuItems + applyRetag, définis plus bas dans ce fichier — déclarations de
// fonction, hoistées), mais ancré sur la puce DANS LE TEXTE (retour terrain). Ne
// réutilise PAS `retagLine` en direct (comme editCounterOnLine ci-dessus) : sa
// branche 'section' (md-retag.js) réémet `## titre {kind}` à partir du titre nu
// SEUL, perdant silencieusement un compteur de répétition `{×N}` déjà présent —
// `applyRetag`/`retagSelection` (chemin de la barre, déjà éprouvé) le préserve. Pose
// donc d'abord la sélection sur CETTE ligne (la puce peut être cliquée sans que le
// curseur y soit déjà), puis rejoue exactement le même chemin que le bouton Section.
function editSectionKindOnLine(view, lineNumber, labels, anchorEl) {
  const line = view.state.doc.line(lineNumber)
  const selectedKind = currentSectionKind(line.text)
  openMenuPopover(
    anchorEl,
    sectionMenuItems(labels.sections),
    (kind) => {
      view.dispatch({ selection: { anchor: line.from } })
      applyRetag(view, 'section', { kind })
    },
    selectedKind
  )
}

// La puce ne s'affiche qu'en mode enrichi (hideMarkup vrai) — en
// mode brut, le `{×N}` / `{cadence X×N}` redevient du texte.
// `labels` : propre à CHAQUE éditeur (cf. createCounterWidgetPlugin ci-dessous),
// transmis jusqu'à editCounterOnLine pour que son mini-dialogue (openNumberPrompt)
// affiche les bons libellés.
function buildCounterWidgets(view, labels) {
  if (!view.state.field(hideMarkup)) return Decoration.none
  const builder = []
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const hit = counterOnLine(line)
      if (hit) {
        const onEdit = () => editCounterOnLine(view, line.number, labels)
        const widget = new CounterWidget(hit.counter, onEdit, labels.editCounterTitle, line.from)
        builder.push(Decoration.replace({ widget }).range(hit.from, hit.to))
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(builder, true)
}

// Fabrique (pas un singleton module) : même patron que createMarkupMaskPlugin
// ci-dessous (§ commentaire dédié) — `labels` est propre à CHAQUE éditeur (cf.
// createCmEditor), donc le plugin doit être reconstruit par instance. Un
// singleton module partagé entre plusieurs éditeurs coexistants figerait les
// libellés du mini-dialogue (openNumberPrompt) sur ceux du PREMIER éditeur créé
// — c'est exactement le piège qu'une variable mutable de module aurait
// introduit ici.
function createCounterWidgetPlugin(labels) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildCounterWidgets(view, labels)
      }
      update(update) {
        if (update.docChanged || update.viewportChanged || hideMarkupChanged(update)) {
          this.decorations = buildCounterWidgets(update.view, labels)
        }
      }
    },
    { decorations: (v) => v.decorations }
  )
}

// -----------------------------------------------------------------------
// Masquage réel du balisage — remplace (Decoration.replace)
// les préfixes/suffixes syntaxiques par rien (ou par un widget d'affordance)
// quand hideMarkup est vrai (mode enrichi, défaut). En mode brut (hideMarkup
// faux), ce plugin ne pose aucune décoration : le MD s'affiche tel quel, y
// compris le `{×N}` (le widget compteur ci-dessus est lui aussi gaté sur
// hideMarkup).
//
// Énumération :
//   - section/référence : `## ` (préfixe) + ` {kind}`/` {×N}` (suffixe du titre)
//   - rang/compteur      : `- ` (préfixe) → RowCheckWidget (case à cocher
//                          visuelle non interactive, CSS pur) —
//                          le `{...}` compteur est géré par counterWidgetPlugin,
//                          plage adjacente jamais chevauchante (le `- ` s'arrête
//                          pile où commence le contenu du rang)
//   - note               : `> ` (préfixe)
//   - image              : la ligne entière → petit placeholder texte (pas
//                          d'emoji), `[image : alt]` ou `[image]` si alt vide
// -----------------------------------------------------------------------

// `TITLE_KIND_RE` vient de md-line-type.js (import ci-dessus), pas recopié ici — même
// mise en garde que `H2_PREFIXE_RE` un peu plus bas : une copie locale divergerait au
// premier ajustement du dialecte.
// `\s*` en tête : accepte l'indentation d'une image ancrée sous une étape
// (`  ![](…)`, cf. serialize.js), cohérent avec IMG_RE (md-line-type.js).
const IMG_ALT_RE = /^\s*!\[([^\]]*)\]\(([^)]*)\)\s*$/

// Calcule les plages (offsets absolus) du préfixe `## ` et du suffixe
// `{kind}`/`{×N}` d'une ligne titre (section ou référence). Réutilise
// parseSectionRepeat + TITLE_KIND_RE dans le même ordre que le parseur réel
// (parse.js) : le compteur de section se détache d'abord, sinon il empêcherait
// de reconnaître un {kind} qui le précède. bareTitle est garanti être un
// préfixe littéral du texte après `## ` (les deux regex sont ancrées en début
// de chaîne et ne font que rogner de la fin), donc l'arithmétique de longueur
// ci-dessous retombe toujours sur des offsets valides.
//
// `H2_PREFIXE_RE` vient de md-line-type.js, il n'est PAS recopié ici : c'est la même
// regex qui décide, là-bas, qu'une ligne est une section ou une référence. Une copie
// locale divergerait au premier ajustement du dialecte, et l'éditeur masquerait alors
// un préfixe que le classement ne reconnaît plus (ou l'inverse). Même règle que pour
// `isPipeLine`/`isTableSep`, empruntés au parseur pour les tableaux.
function titleMaskRanges(line) {
  const prefixMatch = H2_PREFIXE_RE.exec(line.text)
  if (!prefixMatch) return null
  const prefixFrom = line.from
  const prefixTo = line.from + prefixMatch[0].length
  const rawTitle = line.text.slice(prefixMatch[0].length).replace(/\s+$/, '')
  const sr = parseSectionRepeat(rawTitle)
  const tm = TITLE_KIND_RE.exec(sr.title)
  const bareTitle = tm ? tm[1] : sr.title
  const suffixFrom = prefixTo + bareTitle.length
  return { prefixFrom, prefixTo, suffixFrom, suffixTo: line.to, bareTitle, tag: tm ? tm[2] : null }
}

// Bloc référence (Aide-mémoire) au titre CANONIQUE, jamais retouché par la
// travailleuse (cas nominal : referenceBlocksToMd régénère toujours ce même
// titre FR figé, cf. refblocks.js/serialize.js — le dialecte/prompt IA/round-trip
// restent inchangés, SEUL l'affichage varie ici). Distingue ce cas du titre
// RÉÉCRIT (cf. refblocks-non-destructif.spec.js) : quand
// la travailleuse étiquette une ligne d'instruction via le menu Aide mémoire,
// le titre porte alors sa ligne réelle (pas le libellé réservé) — ce texte est
// du contenu, il ne doit JAMAIS être masqué/remplacé.
function canonicalReferenceLabel(ranges, labels) {
  if (!ranges.tag || !labels) return null
  const key = REF_TAG_TO_KEY[ranges.tag]
  const label = labels[ranges.tag]
  if (!key || !label) return null
  return reservedKey(ranges.bareTitle) === key ? label : null
}

// Plage du préfixe `- ` d'une ligne rang/compteur (même regex que BULLET_RE,
// donc même offset que `contentStart` dans counterOnLine — adjacence garantie).
function bulletMaskRange(line) {
  const bullet = BULLET_RE.exec(line.text)
  if (!bullet) return null
  const prefixLen = bullet[0].length - bullet[1].length
  return { from: line.from, to: line.from + prefixLen }
}

// Plage du préfixe `> ` (0 ou 1 espace, cf. NOTE_RE de md-line-type.js) d'une
// ligne note.
function noteMaskRange(line) {
  const m = /^>\s?/.exec(line.text)
  return m && m[0].length ? { from: line.from, to: line.from + m[0].length } : null
}

// Les widgets image sont posés en Decoration.replace ET rendus
// atomiques par maskAtomicRanges (plus bas) — un tap ne pose donc PAS le
// curseur nativement (CM6 ignore par défaut les événements DOM survenant dans
// un widget). `from`/`onSelect` permettent au clic de dispatcher lui-même une
// sélection sur le DÉBUT de la ligne image, pour que les flèches monter/
// descendre (ReaderTextEditor, move-line.js) puissent ensuite la déplacer.
//
// `from` doit être comparé dans eq() : buildMarkupDecorations reconstruit un
// NOUVEAU widget à chaque docChanged, mais CM6 ne réexécute toDOM() (donc ne
// réattache pas l'écouteur clic avec la position à jour) que si eq() renvoie
// faux. Sans `from` dans eq(), un widget dont le CONTENU (alt/src) n'a pas
// changé mais dont la LIGNE a bougé (édition au-dessus) garderait son ancien
// nœud DOM avec une closure pointant sur l'ANCIENNE position — clic qui
// sélectionnerait le mauvais endroit (cf. cm-editor-image-select.spec.js).
//
// `TableWidget` (plus bas) s'en sert aussi, pour reporter le curseur
// sur la ligne source de la cellule touchée. Le nom reste celui de son premier
// usage ; la mécanique, elle, n'a jamais rien eu d'imagier — « poser le curseur
// en tête d'une ligne masquée par un widget ». Vérifié : un `dispatch`
// programmatique n'est PAS filtré par `EditorView.atomicRanges` (seuls le sont
// les commandes de déplacement du curseur et la sélection pointeur native), donc
// le curseur atteint bien une ligne située AU MILIEU d'un bloc atomique.
function selectImageLine(view, from) {
  view.dispatch({ selection: { anchor: from }, scrollIntoView: false })
  view.focus()
}

// mousedown : preventDefault évite que le navigateur tente une sélection de
// texte/drag sur l'image (comportement par défaut d'un <img>/<span> dans un
// contentEditable) avant que notre clic ne dispatche la vraie sélection CM6.
function preventTextSelectDrag(event) {
  event.preventDefault()
}

// Menu contextuel « catégoriser en diagramme » à 2 niveaux (retour terrain, 24/08/2026,
// étendu 25/08/2026) : ouvert au clic sur une image du texte QUAND l'éditeur reçoit
// `imageActions` (opts.imageActions, createCmEditor) — remplace alors `selectImageLine`
// pour CE widget. `imageActions.getInfo` répond `null` quand la section de l'image cliquée
// n'est pas chart-éligible : repli sur selectImageLine, jamais de menu vide. Popover
// PRINCIPAL : 1 entrée « Suivre comme diagramme »/« Changer le type » (désactivée + hint si
// !info.enabled), + une 2e entrée « Juste une image » et une 3e entrée « Envoyer vers la
// galerie » (info.demoteLabel/info.toGalleryLabel), toutes deux ssi info.isChart &&
// info.enabled. Choisir la 1re entrée ouvre un SECOND popover (info.shapeOptions,
// présélectionné sur info.selectedShape) — même mécanisme `openMenuPopover`, ancré sur LE
// MÊME anchorEl (le popover principal est déjà fermé par openMenuPopover à ce moment, cf.
// son closeOpenMenuPopover?.() en tête de fonction). Choisir la 2e/3e entrée appelle
// directement imageActions.demote/sendToGallery(lineNumber, mdPath), sans sous-popover.
function openImageActionsMenu(view, lineNumber, mdPath, anchorEl, imageActions) {
  const info = imageActions.getInfo(lineNumber, mdPath)
  if (!info) {
    selectImageLine(view, view.state.doc.line(lineNumber).from)
    return
  }
  // `anchorEl` est un <img>/<span> À L'INTÉRIEUR du contentEditable de CodeMirror, jamais
  // focusable par défaut — les fermetures de openMenuPopover (Échap, clic sur le scrim)
  // appellent pourtant `anchorEl.focus()` pour rendre le focus quelque part de sensé après
  // fermeture. Sans tabIndex, cet appel est un no-op silencieux : le focus reste nulle part,
  // piège clavier. `tabIndex = -1` le rend focusable PROGRAMMATIQUEMENT sans l'ajouter à
  // l'ordre de tabulation normal (même patron que `focusAt` plus bas dans openMenuPopover).
  anchorEl.tabIndex = -1
  const items = [
    { value: 'shape', label: info.primary.label, disabled: !info.enabled, hint: info.enabled ? undefined : info.primary.hint },
  ]
  if (info.enabled && info.isChart) {
    items.push({ value: 'demote', label: info.demoteLabel })
    // Mécanisme inverse (retour terrain 25/08/2026) : un diagramme du texte qui n'en est en
    // fait pas un peut repartir vers la galerie — même condition d'apparition que `demote`
    // (SEULEMENT sur un diagramme existant, jamais sur une image pas encore promue).
    items.push({ value: 'gallery', label: info.toGalleryLabel })
  }
  openMenuPopover(anchorEl, items, (choice) => {
    if (choice === 'demote') {
      imageActions.demote(lineNumber, mdPath)
      return
    }
    if (choice === 'gallery') {
      imageActions.sendToGallery(lineNumber, mdPath)
      return
    }
    openMenuPopover(
      anchorEl,
      info.shapeOptions,
      (shapeValue) => imageActions.setShape(lineNumber, mdPath, shapeValue),
      info.selectedShape
    )
  })
}

// Libellé affiché à la place d'un titre de bloc référence canonique (cf.
// canonicalReferenceLabel) — jamais interactif au clavier/texte (le clic
// repositionne juste le curseur en tête de ligne, même patron que les widgets
// image ci-dessous, pour rester sélectionnable/déplaçable).
class ReferenceTitleWidget extends WidgetType {
  constructor(label, from, onSelect) {
    super()
    this.label = label
    this.from = from
    this.onSelect = onSelect
  }
  eq(other) {
    return other.label === this.label && other.from === this.from
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-ref-title'
    span.textContent = this.label
    span.addEventListener('mousedown', preventTextSelectDrag)
    span.addEventListener('click', (event) => {
      event.preventDefault()
      this.onSelect()
    })
    return span
  }
  ignoreEvent(event) {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}

// Puce de kind de section (retour terrain : « je la voulais dans le texte lui-même,
// pas dans la barre d'outil. Regarde comment c'est fait pour le compteur ») — même
// patron que CounterWidget plus haut : une puce CLIQUABLE insérée dans le texte à la
// place de la balise `{kind}` masquée, plutôt qu'un indicateur à côté de la barre.
// `label` : toujours une valeur concrète (jamais vide) — même le kind par défaut
// (Générique/pelote, aucune balise dans la source) affiche sa puce, pour que le type
// reste visible d'un coup d'œil sans avoir à deviner « pas de puce = Générique ».
class SectionKindWidget extends WidgetType {
  constructor(label, onEdit, from) {
    super()
    this.label = label
    this.onEdit = onEdit
    // Position de la ligne : ENTRE dans `eq()`, même contrat que ReferenceTitleWidget juste
    // au-dessus. `onEdit` gèle `line.number` à la construction ; sans `from` dans l'égalité,
    // deux titres au MÊME libellé de puce (« Générique » par défaut, donc le cas courant)
    // restaient interchangeables : après un décalage de lignes CodeMirror réutilisait le nœud
    // DOM et sa fermeture périmée, et toucher la puce retaguait une AUTRE ligne — un « - Rang
    // 1 » devenait « ## Rang 1 {sleeve} » pendant que la section visée restait intacte.
    this.from = from
  }
  eq(other) {
    return other.label === this.label && other.from === this.from
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-section-kind-chip'
    span.setAttribute('role', 'button')
    span.tabIndex = 0
    span.textContent = this.label
    span.addEventListener('mousedown', preventTextSelectDrag)
    span.addEventListener('click', (event) => {
      event.preventDefault()
      this.onEdit(span)
    })
    wireChipKeyboardActivation(span, () => this.onEdit(span))
    return span
  }
  // Après revue : keydown/keyup ajoutés à la liste gérée par CE
  // widget (cf. wireChipKeyboardActivation posé plus haut dans toDOM) — sans eux,
  // Entrée/Espace au clavier restaient soumis au clavier par défaut de CM6 avant
  // d'atteindre les écouteurs du span.
  ignoreEvent(event) {
    return !['mousedown', 'click', 'keydown', 'keyup'].includes(event.type)
  }
}

class ImagePlaceholderWidget extends WidgetType {
  // `hasMenu` (revue) : vrai quand `onSelect` ouvre le menu contextuel
  // (openImageActionsMenu, imageActions fourni) plutôt que de simplement repositionner le
  // curseur (selectImageLine, comportement historique sans imageActions) — même patron
  // statique que `retagMenuBtn` : `aria-haspopup` posé ICI, au premier rendu, jamais par
  // openMenuPopover (qui ne gère que `aria-expanded`, cf. son commentaire plus bas). Posé
  // uniquement quand un menu s'ouvre réellement : sinon `aria-haspopup="menu"` mentirait à
  // un lecteur d'écran sur une image qui ne fait que déplacer le curseur.
  constructor(alt, from, onSelect, hasMenu) {
    super()
    this.alt = alt
    this.from = from
    this.onSelect = onSelect
    this.hasMenu = hasMenu
  }
  eq(other) {
    return other.alt === this.alt && other.from === this.from && other.hasMenu === this.hasMenu
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-image-placeholder'
    span.textContent = this.alt ? `[image : ${this.alt}]` : '[image]'
    if (this.hasMenu) span.setAttribute('aria-haspopup', 'menu')
    span.addEventListener('mousedown', preventTextSelectDrag)
    span.addEventListener('click', (event) => {
      event.preventDefault()
      this.onSelect(span)
    })
    return span
  }
  ignoreEvent(event) {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}

// Vignette réelle (feature « images inline ») : posée à la place du
// placeholder texte quand la source de la ligne image se résout dans la map
// d'images courante (cf. pickImageWidget). Bornée en hauteur (styles.css,
// .cm-image-thumb) pour rester une simple affordance dans le flux d'édition,
// pas une prévisualisation pleine taille.
class ImageThumbWidget extends WidgetType {
  // `hasMenu` : même rôle que sur ImagePlaceholderWidget ci-dessus (statique, posé
  // uniquement quand `onSelect` ouvre réellement un menu).
  constructor(src, alt, from, onSelect, hasMenu) {
    super()
    this.src = src
    this.alt = alt
    this.from = from
    this.onSelect = onSelect
    this.hasMenu = hasMenu
  }
  eq(other) {
    return other.src === this.src && other.alt === this.alt && other.from === this.from && other.hasMenu === this.hasMenu
  }
  toDOM() {
    const img = document.createElement('img')
    img.className = 'cm-image-thumb'
    img.src = this.src
    img.alt = this.alt
    img.loading = 'lazy'
    if (this.hasMenu) img.setAttribute('aria-haspopup', 'menu')
    img.addEventListener('mousedown', preventTextSelectDrag)
    img.addEventListener('click', (event) => {
      event.preventDefault()
      this.onSelect(img)
    })
    return img
  }
  ignoreEvent(event) {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}

// Choisit quel widget poser pour une ligne image donnée : vignette réelle si
// `mdPath` se résout dans `imageMap` (resolveImageSrc), sinon placeholder
// texte inchangé. Extrait en fonction pure (aucun DOM/CM6) pour rester
// testable indépendamment du montage CodeMirror.
export function pickImageWidget(mdPath, alt, imageMap) {
  const src = resolveImageSrc(mdPath, imageMap)
  return src ? { kind: 'thumb', src, alt } : { kind: 'placeholder', alt }
}

// Case à cocher visuelle : remplace le préfixe `- `
// masqué d'une ligne rang/compteur par une affordance « instruction à
// réaliser » (lecture en check-list). Non interactive : aucun listener,
// aucun glyphe/emoji dans le DOM (convention projet) — le carré est dessiné
// en CSS pur via la classe `cm-row-check` (styles.css). Toutes les instances
// sont visuellement identiques (eq() renvoie toujours true).
class RowCheckWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-row-check'
    return span
  }
  ignoreEvent() {
    return false
  }
}

// -----------------------------------------------------------------------
// Tableaux Markdown rendus en vraie <table>
//
// POURQUOI CE N'EST PAS DANS markupMaskPlugin (là où on l'attendrait) : un
// `Decoration.replace({ block: true })`, comme toute décoration qui couvre un
// saut de ligne, ne PEUT PAS être fournie par un ViewPlugin. @codemirror/view
// 6.43.6 le refuse à l'exécution — vérifié en montant un éditeur réel :
//   RangeError: Block decorations may not be specified via plugins
// (dist/index.js:2743 ; le drapeau `disallowBlockEffectsFor` vaut
// `dynamicDecorationMap`, vrai dès que la valeur du facet `decorations` est une
// FONCTION — or un ViewPlugin s'y enregistre toujours comme `v => v.decorations`).
// D'où un StateField, dont la valeur entre dans le facet telle quelle.
//
// Conséquence directe : le piège du bloc à cheval sur `view.visibleRanges`
// DISPARAÎT. Un StateField voit le document entier, il n'y a plus
// de bord de plage visible d'où repartir en arrière — le code de remontée aurait
// été du code mort justifié par une prémisse devenue fausse.
//
// Autre conséquence, vérifiée plutôt que supposée : la boucle par ligne de
// `buildMarkupDecorations` n'a besoin d'AUCUN filtre sur les lignes consommées
// par un widget de bloc. `addLineMaskDecorations` n'a pas de branche `'tableau'`
// et `counterOnLine` exige une puce `- ` : ni l'une ni l'autre ne produit quoi
// que ce soit sur une rangée de tableau. Les classes de ligne posées par
// `lineTypePlugin` (`md-tableau`) restent, elles, indispensables — c'est le style
// du REPLI, quand aucun widget n'est posé.
// -----------------------------------------------------------------------

// En-tête + séparatrice + au moins une rangée, comptés en LIGNES-TUYAU (les lignes
// vides intercalées ne comptent pas, cf. buildTableDecorations). En dessous, ce n'est
// pas un tableau qu'on masquerait mais du texte qu'on ferait disparaître.
const TABLE_MIN_LINES = 3

// Valide les lignes-tuyau d'une rubrique (dans l'ordre du document, cf.
// buildTableDecorations) et en construit le modèle
// d'affichage, ou renvoie `null` — auquel cas AUCUN widget n'est posé et les
// lignes restent affichées telles quelles (règle cardinale du projet : jamais de
// perte silencieuse ; dans le doute, on garde le texte).
//
// Les refus (plus deux compléments) :
//  - moins de 3 lignes-tuyau (dont « une seule ligne qui ressemble à une rangée ») ;
//  - ligne séparatrice absente à l'indice 1 — c'est-à-dire à la DEUXIÈME ligne-tuyau
//    de la rubrique, exactement le `pipeIdx[1]` du parseur ; sa POSITION est le seul
//    critère ;
//  - rangée qui a PLUS de cellules que l'en-tête (voir l'asymétrie ci-dessous) ;
//  - en-tête qui est lui-même une séparatrice (`|---|` en première ligne) ;
//  - séparatrice dont le nombre de cellules ne correspond pas à l'en-tête.
//
// ASYMÉTRIE ASSUMÉE sur « les largeurs de rangées différentes » du §4 — une rangée
// plus COURTE que l'en-tête est complétée par des cellules vides, pas repliée.
//
// Ce que fait RÉELLEMENT le pipeline d'enregistrement (relu, pas déduit) :
// `CorrectionView.onSave` appelle `editableToReader` — donc le parseur — AVANT
// `resizeReferenceSizeTable`. Or `parseReservedBlock`, branche `sizeTable`, rejette
// toute rangée dont le compte de valeurs diffère du nombre de tailles :
// avertissement `SIZES_COUNT_MISMATCH`, la ligne part en `leftover`, que `parse.js`
// rétrograde en note. Le recadrage tourne APRÈS, sur un reader d'où la rangée a déjà
// disparu — il ne la voit jamais. Le parseur traite les rangées trop courtes et trop
// longues À L'IDENTIQUE : ni `resizeReferenceSizeTable` ni `fitSizeRowValues` n'ont
// leur mot à dire sur ce chemin.
//
// DIVERGENCE AFFICHAGE / ENREGISTREMENT, nommée telle quelle : une rangée courte
// s'affiche ici comme une rangée de tableau, alors que l'enregistrement en fera une
// NOTE, avec un avertissement. Ce n'est pas une perte (le texte est conservé et
// l'avertissement est émis), mais l'écran ne montre pas ce qui sera enregistré.
// C'est assumé, pour une raison qui tient au geste de l'écran : cette rangée courte
// est produite par l'émetteur lui-même. Sortie réelle de `referenceBlocksToMd` pour
// `sizeTable: [{ label: 'Tour', values: ['52'] }]` avec 3 tailles — il écrit
// `| ${label} | ${values.join(' | ')} |` et ne complète JAMAIS :
//     | mesure | S | M | L |
//     |---|---|---|---|
//     | Tour | 52 |
// Un patron fraîchement importé, ouvert dans « Corriger le patron » avant tout
// enregistrement — le scénario même de cet écran — porte donc des rangées courtes.
// Les afficher en tableau montre à la tricoteuse LES CASES QUI MANQUENT, c'est-à-dire
// exactement ce qu'elle doit remplir pour que la rangée survive à l'enregistrement.
// Replier en texte brut cacherait ce défaut au milieu des barres verticales.
//
// L'inverse (rangée plus LONGUE que l'en-tête) reste un repli, et l'asymétrie ne
// vient PAS du pipeline (qui traite les deux pareil) mais de l'affichage : il n'y a
// aucune colonne où mettre la valeur en trop. Toute façon de la rendre mentirait sur
// la structure — inventer une colonne, ou masquer la valeur. La ligne brute est le
// seul affichage honnête, et elle laisse la tricoteuse placer la valeur elle-même.
//
// Ce qu'on NE refuse volontairement PAS : une séparatrice apparente APRÈS
// l'indice 1. `isTableSep` accepte tout ce qui n'est fait que de barres, espaces,
// tirets et deux-points — donc `|  |  |  |`, c'est-à-dire une rangée de tailles
// aux cases vides, cas parfaitement réel (cf. « la case vide d'une taille ajoutée
// survit au second enregistrement »). Replier là-dessus ferait perdre le rendu du
// tableau des tailles au premier ajout de taille non renseignée. Un vrai
// `|---|---|` égaré au milieu des données s'affiche donc comme une rangée de
// cellules `---` : visible et corrigible, ce qui vaut mieux qu'un repli.
// La contrepartie de cette règle — une rangée aux cases toutes vides qui tomberait
// PILE à l'indice 1 serait prise pour la séparatrice, la vraie descendant d'un cran —
// est une frontière connue, épinglée par un test dédié dans cm-editor-tableau.spec.js
// (« frontière connue »). Aucun contenu ne disparaît pour autant : la ligne alors
// consommée comme séparatrice est vide par définition.
function tableBlockModel(lines) {
  if (lines.length < TABLE_MIN_LINES) return null
  if (!isTableSep(lines[1].text)) return null
  if (isTableSep(lines[0].text)) return null
  const header = { cells: splitCells(lines[0].text), from: lines[0].from }
  if (splitCells(lines[1].text).length !== header.cells.length) return null
  const rows = []
  for (let i = 2; i < lines.length; i++) {
    const cells = splitCells(lines[i].text)
    if (cells.length > header.cells.length) return null
    while (cells.length < header.cells.length) cells.push('')
    rows.push({ cells, from: lines[i].from })
  }
  return { header, rows }
}

// Le tableau affiché à la place du bloc source. Même contrat que les widgets
// image de ce fichier (cf. ImageThumbWidget) : `eq` compare les données
// d'identité, `ignoreEvent` ne laisse passer que mousedown/click, et le clic
// repositionne le curseur via selectImageLine.
//
// `eq` compare le TEXTE SOURCE du bloc et son offset de départ, rien d'autre —
// sans quoi le widget se reconstruirait à chaque frappe ailleurs dans le
// document et le tableau clignoterait. C'est suffisant ET complet : `model`
// (cellules et offsets de ligne) est une fonction pure de ces deux valeurs, donc
// deux widgets qui s'égalent ici portent forcément le même modèle. L'offset est
// indispensable au même titre que pour ImageThumbWidget : un tableau inchangé
// mais DÉPLACÉ (édition au-dessus) garderait sinon son DOM et ses écouteurs de
// clic pointant sur l'ancienne position.
class TableWidget extends WidgetType {
  constructor(source, from, model) {
    super()
    this.source = source
    this.from = from
    this.model = model
  }
  eq(other) {
    return other.source === this.source && other.from === this.from
  }
  toDOM(view) {
    const table = document.createElement('table')
    table.className = 'cm-md-table'
    const thead = document.createElement('thead')
    thead.appendChild(this.buildRow(view, 'th', this.model.header.cells, this.model.header.from))
    table.appendChild(thead)
    const tbody = document.createElement('tbody')
    for (const row of this.model.rows) tbody.appendChild(this.buildRow(view, 'td', row.cells, row.from))
    table.appendChild(tbody)
    return table
  }
  // `data-from` = offset de la ligne source de la rangée. C'est la seule chose dont
  // `markCursorRow` (plus bas) a besoin pour retrouver la rangée du curseur dans le
  // DOM déjà rendu — sans reconstruire le widget, donc sans le clignotement que
  // `eq()` évite justement.
  buildRow(view, tag, cells, lineFrom) {
    const tr = document.createElement('tr')
    tr.dataset.from = String(lineFrom)
    for (const cell of cells) tr.appendChild(this.buildCell(view, tag, cell, lineFrom))
    return tr
  }
  // Une cellule = le texte de la cellule + le report du curseur sur SA ligne
  // source (l'indice de rangée donne le décalage, déjà résolu en offset absolu
  // par tableBlockModel). `preventTextSelectDrag` sur mousedown pour la même
  // raison que sur les vignettes : empêcher le navigateur d'entamer une
  // sélection de texte avant que le clic ne pose la vraie sélection CM6.
  buildCell(view, tag, text, lineFrom) {
    const el = document.createElement(tag)
    el.textContent = text
    el.addEventListener('mousedown', preventTextSelectDrag)
    el.addEventListener('click', (event) => {
      event.preventDefault()
      selectImageLine(view, lineFrom)
    })
    return el
  }
  ignoreEvent(event) {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}

// Frontière de groupe : un titre de niveau 2 OU 3. `####` ne matche pas (après `##`
// comme après `###` vient un `#`, jamais un blanc) — cohérent avec `lineType`, qui le
// classe `'texte'`.
//
// `##` parce que c'est le découpage de `parse.js`. `###` en PLUS, et c'est une
// divergence délibérée avec le parseur, qui ne coupe pas là : sans elle, un sous-titre
// posé entre deux tables compterait comme une ligne de contenu et supprimerait le rendu
// de TOUTE la rubrique (cf. `poser()`). Le faire fermer le groupe rend les deux tables
// au lieu d'aucune, et ne cache rien au passage : le `###` reste affiché entre elles
// (il est rendu, dièses masqués). Aucune rangée n'est ni masquée ni inventée —
// seul le REGROUPEMENT visuel diffère de celui du parseur, qui n'en ferait qu'une table.
// C'est le sens d'erreur le moins coûteux des deux.
//
// Composé des DEUX préfixes de md-line-type.js au lieu du `/^#{2,3}\s/` qu'il remplace
// (strictement équivalent : `/^##\s+/` ne peut pas matcher `###…`, le 3e dièse n'étant
// pas un blanc, et aucun des deux ne matche `####…`). Ainsi, la frontière de groupe
// suit automatiquement toute évolution de ce qu'est un titre — elle ne peut plus
// diverger du classement de `lineType`, dont ce commentaire se réclame justement.
function estDebutDeTitre(text) {
  return H2_PREFIXE_RE.test(text) || SOUS_TITRE_PREFIXE_RE.test(text)
}

// Parcourt TOUT le document (cf. commentaire de section : pas de viewport ici),
// regroupe les lignes-tuyau et pose un widget de bloc pour chaque groupe bien formé.
// Les plages sont produites dans l'ordre croissant par construction, ce dont
// `Decoration.set(..., true)` a besoin.
//
// LA RÈGLE DE GROUPEMENT EST CELLE DU PARSEUR, pas une seconde règle maison. Le
// premier jet groupait les lignes-tuyau CONTIGUËS ; `parseTableBlock` (refblocks.js),
// lui, prend TOUTES les lignes-tuyau de la rubrique, trous compris. Les deux
// divergeaient dans les deux sens, et sur des états de document atteignables à une
// pression de flèche : une rangée poussée au-delà d'une ligne vide s'affichait en
// rangée brute isolée alors que l'enregistrement la remettait dans le tableau ; une
// ligne vide entre l'en-tête et la séparatrice repliait tout ici alors que le parseur
// y lisait une table valide. C'est la classe d'échec contre laquelle le commentaire
// d'export de refblocks.js met en garde — l'écran ne disant pas ce qui sera
// enregistré.
//
// Donc, ici : groupe = toutes les lignes-tuyau entre deux titres, et l'indice 1 dont
// parle `tableBlockModel` est la DEUXIÈME LIGNE-TUYAU du groupe, exactement le
// `pipeIdx[1]` du parseur. Les lignes vides intercalées entrent dans la plage
// remplacée (elles ne portent aucun contenu, les masquer ne perd rien) ; une ligne de
// CONTENU intercalée, elle, interdit le widget — voir `poser()`.
//
// JUSQU'OÙ VA L'ÉQUIVALENCE AVEC LE PARSEUR — pas partout, et il ne faut pas le
// promettre. `parse.js` (vers la ligne 62) n'appelle `parseReservedBlock` que si le
// titre du bloc se résout sur une clé réservée ; sinon c'est `parseWorkSection`, et
// ce qui précède le premier titre passe par `parseIntro`. Ni l'un ni l'autre n'appelle
// `parseTableBlock`. L'équivalence de groupement décrite ci-dessus vaut donc DANS une
// rubrique réservée à table (Abréviations, Tailles) — les deux seules que
// `referenceBlocksToMd` émette — et nulle part ailleurs.
//
// Ailleurs (section de travail, préambule), l'éditeur rend quand même un tableau là où
// l'enregistrement n'en construira aucun : les rangées deviendront des pas ou des
// lignes d'intro, barres comprises. C'est un SUR-affichage, et il est assumé — pas
// découvert. Il est borné : aucune rangée n'est masquée ni inventée, seule la
// DESTINATION des lignes diffère, et elle diffère à l'identique qu'on rende ou non.
// Rowtine-MD n'a pas de table hors de ces deux rubriques : ce cas vient donc d'un
// import bancal ou d'une retouche à la main, et la forme lisible aide justement à voir
// ce qu'il faut déplacer vers la bonne rubrique.
// L'argument inverse existe et n'est pas faible — les barres brutes signalent « ceci
// n'est dans aucune rubrique », et c'est un aperçu fidèle du texte du pas qui sera
// enregistré. Restreindre le rendu aux deux rubriques réservées supprimerait ce
// sur-affichage ; c'est noté comme suite possible dans le rapport de tâche, pas tranché
// ici.
//
// L'appartenance au bloc est testée avec `isPipeLine` et NON `lineType(...) ===
// 'tableau'` — les deux sont équivalents (aucune branche antérieure de `lineType`
// ne peut matcher une ligne qui commence par une barre ; équivalence verrouillée
// par un test dans md-retag.spec.js), mais ce champ repasse sur le document
// ENTIER à chaque frappe, là où les plugins ne voient que le viewport. Mesuré sur
// un patron de 2124 lignes, 50 frappes : 1,06 ms/frappe sans ce champ, 2,41 ms
// avec `lineType` (qui refait H2_RE + slug/reservedKey sur chaque titre), 1,51 ms
// avec `isPipeLine`. Le surcoût passe de +1,35 ms à +0,45 ms par frappe pour un
// mot changé.
function buildTableDecorations(doc) {
  const builder = []
  // Rubrique courante : lignes-tuyau rencontrées, et « une ligne de CONTENU (non
  // vide, non-tuyau) a été vue depuis la dernière ligne-tuyau ». Ce second drapeau
  // ne devient `trou` que si une ligne-tuyau lui succède : une ligne de contenu
  // APRÈS la dernière rangée n'est pas un trou, elle est simplement hors du groupe.
  let pipes = []
  let contenuDepuisDerniereRangee = false
  let trou = false

  const poser = () => {
    // Un groupe non contigu ne peut pas être couvert par une seule plage de
    // remplacement sans MASQUER la ligne de contenu qui le coupe. Dans ce cas,
    // aucun widget : le texte brut reste, et il reste FIDÈLE à ce que le parseur
    // fera (il regroupera quand même les rangées). Sous-afficher n'est jamais un
    // mensonge ; afficher un tableau amputé en serait un.
    //
    // LA PORTÉE DE CE REFUS EST LE GROUPE ENTIER, C'EST-À-DIRE TOUT CE QUI SÉPARE
    // DEUX TITRES — pas seulement les rangées voisines du trou. Une seule ligne de
    // contenu glissée entre deux lignes-tuyau supprime donc le rendu de TOUS les
    // tableaux de la rubrique : deux tables séparées par une note dans « Abréviations »
    // donnaient deux widgets avec la règle contiguë du premier jet, elles n'en donnent
    // plus aucun. La tricoteuse retrouve les barres verticales qu'elle venait
    // justement corriger. C'est le coût, réel, de l'alignement sur le parseur — dont
    // le groupe est lui aussi la rubrique entière. Il est atténué par la frontière
    // `###` (voir `estDebutDeTitre`), qui referme le groupe sur un sous-titre au lieu de
    // le faire tomber.
    const model = trou ? null : tableBlockModel(pipes)
    if (model) {
      const from = pipes[0].from
      const to = pipes[pipes.length - 1].to
      const source = doc.sliceString(from, to)
      builder.push(Decoration.replace({ widget: new TableWidget(source, from, model), block: true }).range(from, to))
    }
    pipes = []
    contenuDepuisDerniereRangee = false
    trou = false
  }

  // Un seul balayage, sans `doc.line(n)` par ligne (descente d'arbre à chaque
  // appel) : `iterLines` donne les textes dans l'ordre et l'offset se suit à la
  // main. Le modèle de document CM6 sépare toujours ses lignes par un seul `\n`,
  // donc `from += text.length + 1` est exact — et les tests de clic (curseur posé
  // sur la ligne source d'une cellule) échoueraient bruyamment si ça dérivait.
  let from = 0
  for (const text of doc.iterLines()) {
    if (estDebutDeTitre(text)) {
      poser()
    } else if (isPipeLine(text)) {
      if (contenuDepuisDerniereRangee && pipes.length) trou = true
      contenuDepuisDerniereRangee = false
      pipes.push({ text, from, to: from + text.length })
    } else if (text.trim()) {
      contenuDepuisDerniereRangee = true
    }
    from += text.length + 1
  }
  poser()
  return Decoration.set(builder, true)
}

// Le champ ne dépend QUE du document : il ne lit pas `hideMarkup`, pour n'avoir
// jamais à toucher `tr.state` depuis un `update` de StateField (ordre de calcul
// des champs entre eux). Le mode enrichi/brut est appliqué à la lecture, par
// `tableDecorations` ci-dessous — un seul endroit, partagé par le facet des
// décorations et celui des plages atomiques.
const tableBlocksField = StateField.define({
  create(state) {
    return buildTableDecorations(state.doc)
  },
  update(value, tr) {
    return tr.docChanged ? buildTableDecorations(tr.newDoc) : value
  },
})

function tableDecorations(state) {
  return state.field(hideMarkup) ? state.field(tableBlocksField) : Decoration.none
}

// Plages atomiques (même raison que createMaskAtomicRanges pour les masques
// inline) : sans elles le curseur pourrait entrer DANS un bloc masqué, où il
// n'est pas dessiné — la frappe modifierait alors un texte invisible. Champ
// distinct de celui de markupMaskPlugin, qui ne connaît que les décorations du
// plugin.
const tableAtomicRanges = EditorView.atomicRanges.of((view) => tableDecorations(view.state))

// Affordance « rangée du curseur ». Sans elle, le curseur posé
// par un clic sur une cellule est INVISIBLE — la ligne source est masquée par le
// widget, et `cm-active-block` (posé par `lineTypePlugin` sur `.cm-line`) tombe donc
// sur une ligne qui n'est pas rendue. La tricoteuse ne pouvait ni voir où elle avait
// tapé, ni savoir quelle rangée les flèches allaient déplacer.
//
// POURQUOI PAS PAR DÉCORATION : faire entrer la sélection dans `eq()` ferait
// reconstruire le widget à chaque déplacement du curseur — exactement le
// clignotement que `eq()` existe pour éviter. On repose donc une simple CLASSE sur la
// rangée déjà rendue, sans toucher à l'arbre.
//
// Appelée depuis l'`updateListener` de `createCmEditor`, qui s'exécute APRÈS
// `docView.update()` (vérifié dans la source de @codemirror/view : les listeners sont
// notifiés en fin de `update()`, une fois le DOM à jour) — les `<tr data-from>` sont
// donc déjà là, y compris ceux d'un widget tout juste reconstruit.
//
// Les deux gardes en tête gardent le coût nul dans le cas courant : un document sans
// tableau, ou le mode texte brut, ne paie aucun parcours de DOM. Sinon le
// `querySelectorAll` reste borné au viewport, seule partie que CM6 rende.
function markCursorRow(view) {
  if (!view.state.field(hideMarkup)) return
  if (!view.state.field(tableBlocksField).size) return
  const rows = view.contentDOM.querySelectorAll('table.cm-md-table tr[data-from]')
  if (!rows.length) return
  const from = String(view.state.doc.lineAt(view.state.selection.main.head).from)
  for (const tr of rows) tr.classList.toggle('is-cursor-row', tr.dataset.from === from)
}

function addLineMaskDecorations(builder, line, imageMap, view, labels, imageActions) {
  const type = lineType(line.text)
  if (type === 'section') {
    const ranges = titleMaskRanges(line)
    if (!ranges) return
    if (ranges.prefixTo > ranges.prefixFrom) {
      builder.push(Decoration.replace({}).range(ranges.prefixFrom, ranges.prefixTo))
    }
    // Puce de kind DANS LE TEXTE (retour terrain : « je la voulais dans le texte
    // lui-même, pas dans la barre d'outil. Regarde comment c'est fait pour le
    // compteur ») — même patron que CounterWidget, TOUJOURS posée (même sans balise
    // source — kind par défaut) pour que le type reste visible d'un coup d'œil,
    // jamais seulement « pas de balise = deviner ». `lineNumber` (pas `line`)
    // capturé dans la closure : relu au clic (editSectionKindOnLine), jamais un
    // objet Line qui aurait pu périmer entre la construction de la décoration et le
    // clic (édition ailleurs dans le document).
    //
    // `Decoration.widget` (PAS `.replace`) quand `suffixFrom === suffixTo` (aucune
    // balise à remplacer, kind par défaut) : un `.replace().range(pos, pos)` a fait
    // planter la construction de TOUT le jeu de décorations de la vue (mesuré :
    // widgets image d'une ligne SUIVANTE disparus, cm-editor-image-select.spec.js) —
    // `Decoration.widget` est l'API prévue pour insérer SANS rien remplacer, un
    // `.replace` à plage vide n'est pas un point d'insertion valide pour ce
    // RangeSetBuilder. `.replace` reste correct quand une vraie balise existe
    // (plage non vide, même contrat que CounterWidget/ReferenceTitleWidget).
    const lineNumber = line.number
    const label = sectionKindLabel(labels, currentSectionKind(line.text))
    const onEdit = (anchorEl) => editSectionKindOnLine(view, lineNumber, labels, anchorEl)
    const widget = new SectionKindWidget(label, onEdit, line.from)
    if (ranges.suffixTo > ranges.suffixFrom) {
      builder.push(Decoration.replace({ widget }).range(ranges.suffixFrom, ranges.suffixTo))
    } else {
      builder.push(Decoration.widget({ widget, side: 1 }).range(ranges.suffixFrom))
    }
    return
  }
  if (type === 'reference') {
    const ranges = titleMaskRanges(line)
    if (!ranges) return
    if (ranges.prefixTo > ranges.prefixFrom) {
      builder.push(Decoration.replace({}).range(ranges.prefixFrom, ranges.prefixTo))
    }
    if (ranges.suffixFrom > ranges.prefixTo) {
      const label = canonicalReferenceLabel(ranges, labels)
      if (label) {
        const onSelect = () => selectImageLine(view, line.from)
        builder.push(
          Decoration.replace({ widget: new ReferenceTitleWidget(label, line.from, onSelect) }).range(
            ranges.prefixTo,
            ranges.suffixFrom
          )
        )
      }
    }
    if (ranges.suffixTo > ranges.suffixFrom) {
      builder.push(Decoration.replace({}).range(ranges.suffixFrom, ranges.suffixTo))
    }
    return
  }
  if (type === 'sous-titre') {
    // Sous-titre de technique : seul le préfixe `### ` est masqué, le titre lui-même
    // reste du texte normal (pas de widget, contrairement à `reference` qui remplace tout le
    // suffixe par un libellé canonique — un `### Titre` n'a pas de forme canonique à afficher
    // à la place). Même contrat que le masquage de `## ` juste au-dessus : cette plage entre
    // automatiquement dans `createMaskAtomicRanges` (même plugin, décorations réutilisées
    // telles quelles), donc Retour-arrière juste après le masque fusionne correctement avec la
    // ligne précédente au lieu de ne supprimer qu'un seul des caractères masqués.
    const m = SOUS_TITRE_PREFIXE_RE.exec(line.text)
    if (m) builder.push(Decoration.replace({}).range(line.from, line.from + m[0].length))
    return
  }
  if (type === 'rang' || type === 'compteur') {
    const r = bulletMaskRange(line)
    if (r && r.to > r.from) builder.push(Decoration.replace({ widget: new RowCheckWidget() }).range(r.from, r.to))
    return
  }
  if (type === 'note') {
    const r = noteMaskRange(line)
    if (r) builder.push(Decoration.replace({}).range(r.from, r.to))
    return
  }
  if (type === 'image') {
    if (line.to <= line.from) return
    const m = IMG_ALT_RE.exec(line.text)
    const alt = m ? m[1].trim() : ''
    const path = m ? m[2].trim() : ''
    const choice = pickImageWidget(path, alt, imageMap)
    const lineNumber = line.number
    const onSelect = imageActions
      ? (anchorEl) => openImageActionsMenu(view, lineNumber, path, anchorEl, imageActions)
      : () => selectImageLine(view, line.from)
    const widget =
      choice.kind === 'thumb'
        ? new ImageThumbWidget(choice.src, choice.alt, line.from, onSelect, !!imageActions)
        : new ImagePlaceholderWidget(choice.alt, line.from, onSelect, !!imageActions)
    builder.push(Decoration.replace({ widget }).range(line.from, line.to))
  }
}

function buildMarkupDecorations(view, labels, imageActions) {
  if (!view.state.field(hideMarkup)) return Decoration.none
  const imageMap = view.state.field(imagesField)
  const builder = []
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      addLineMaskDecorations(builder, line, imageMap, view, labels, imageActions)
      pos = line.to + 1
    }
  }
  return Decoration.set(builder, true)
}

// Fabrique (pas un singleton module) : `labels` est propre à CHAQUE éditeur
// (libellés traduits de reader-editable, cf. createCmEditor) — un plugin partagé
// entre toutes les instances figerait les libellés de la première créée.
function createMarkupMaskPlugin(labels, imageActions) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildMarkupDecorations(view, labels, imageActions)
      }
      update(update) {
        if (update.docChanged || update.viewportChanged || hideMarkupChanged(update) || imagesChanged(update)) {
          this.decorations = buildMarkupDecorations(update.view, labels, imageActions)
        }
      }
    },
    { decorations: (v) => v.decorations }
  )
}

// Bug confirmé (cf. commit fix(correction)) : le keymap seul (defaultKeymap ci-dessous)
// corrige la coupe Entrée en milieu de ligne, mais PAS le Retour-arrière juste après un
// widget masquant `- `/`> `/`## `/etc. (RowCheckWidget et consorts, tous posés en
// Decoration.replace par markupMaskPlugin) : sans ceci, Retour-arrière ne voit qu'un
// SEUL des deux caractères masqués (ex. l'espace de `- `) et le supprime seul, ce qui
// fait réapparaître le `-`/`>`/etc. comme texte littéral au lieu de fusionner avec la
// ligne précédente. En déclarant ces plages ATOMIQUES (mêmes décorations que le
// masquage, réutilisées telles quelles), le curseur/les commandes de suppression les
// traversent d'un bloc — Retour-arrière juste après le widget atterrit alors à la vraie
// position `line.from` et déclenche la fusion de ligne standard de CM6.
function createMaskAtomicRanges(markupMaskPlugin) {
  return EditorView.atomicRanges.of((view) => view.plugin(markupMaskPlugin)?.decorations ?? Decoration.none)
}

// -----------------------------------------------------------------------
// Retour-arrière défensif en frontière de puce (06/09).
//
// Pourquoi : en vue enrichie, le préfixe `- ` d'un rang/compteur est masqué par
// RowCheckWidget et rendu ATOMIQUE (createMaskAtomicRanges ci-dessus). Le chemin
// par défaut (@codemirror/commands deleteCharBackward) calcule un décalage d'UN
// caractère (findClusterBreak, pur modèle), puis skipAtomic l'étend au préfixe
// entier — le résultat dépend donc de la résolution du curseur AU BORD du widget
// et du facettage atomicRanges, deux terrains que @codemirror/view 6.43.7 a
// remués (réécriture de LineTile.resolveInline et de TilePointer.advance, cf.
// commentaire d'épinglage en tête de fichier ; bissection du 16/08 : 6.43.6
// marche, 6.43.7 casse le retour-arrière en début de ligne). Aucune version
// publiée ensuite (jusqu'à 6.43.11 incluse) n'a réverté ni corrigé ce code.
//
// Cette commande rend le geste EXPLICITE côté modèle : quand le curseur vide
// (unique) est à la frontière du préfixe masqué — strictement après son début,
// au plus tard à sa fin, donc juste après la case à cocher —, on retire le
// préfixe ENTIÈREMENT en une transaction, sans dépendre de skipAtomic. Sur la
// 6.43.6 la transaction produite est identique à celle du chemin par défaut
// (mêmes changements [line.from, line.from + préfixe), même curseur associé à
// gauche, même userEvent « delete.backward »), donc aucun changement de
// comportement observable — le test e2e correction-editor-keys.spec.js
// (1ʳᵉ pression = retrait du balisage, 2ᵉ = fusion) reste l'arbitre.
//
// Tout le reste retourne false et laisse la main à defaultKeymap : vrai début de
// ligne (fusion avec la précédente), milieu de texte (1 caractère), sélection
// non vide, multi-curseurs (impossibles ici — allowMultipleSelections jamais
// activé —, garde par prudence), mode brut (pas de widget à traverser).
// -----------------------------------------------------------------------
export function deleteMarkupBackward(view) {
  const state = view.state
  if (state.readOnly) return false
  const selection = state.selection
  if (selection.ranges.length !== 1 || !selection.main.empty) return false
  if (!state.field(hideMarkup, false)) return false
  const head = selection.main.head
  const line = state.doc.lineAt(head)
  const type = lineType(line.text)
  if (type !== 'rang' && type !== 'compteur') return false
  const r = bulletMaskRange(line)
  if (!r || head <= r.from || head > r.to) return false
  view.dispatch({
    changes: { from: r.from, to: r.to },
    // Même association (-1) que le curseur posé par deleteBy
    // (@codemirror/commands) sur le chemin par défaut.
    selection: EditorSelection.cursor(r.from, -1),
    scrollIntoView: true,
    userEvent: 'delete.backward',
  })
  return true
}

// -----------------------------------------------------------------------
// Clavier logiciel (décision produit) — PAR DÉFAUT, taper dans le
// texte place le CURSEUR sans ouvrir le clavier virtuel (le re-balisage se
// fait par sélection/dispatch programmatiques, jamais par frappe), pour que
// la barre de requalification et le texte restent visibles sans être
// masqués par le clavier. Un bouton dédié (ReaderTextEditor.vue) affiche/
// masque le clavier pour permettre de VRAIMENT taper.
//
// Compartment sur EditorView.contentAttributes — PAS `view.contentDOM.
// inputMode = …` posé à la main : un re-render CM6 (buildDecorations,
// updateAttrs, etc.) recalcule les attributs du contentDOM à chaque update
// et écraserait un attribut posé hors du système de facettes. Un Compartment
// reste, lui, réappliqué à CHAQUE update (cf. EditorView.updateAttrs, qui
// relit le facet contentAttributes) — donc survit à un docChanged/re-render,
// contrairement à une affectation DOM brute. `inputmode="none"` empêche
// l'IME/clavier virtuel de s'ouvrir au focus SANS désactiver la sélection
// (curseur/sélection restent manipulables programmatiquement).
// -----------------------------------------------------------------------
const keyboardAttrsCompartment = new Compartment()

function keyboardContentAttrs(on) {
  return { inputmode: on ? 'text' : 'none' }
}

// Reconfigure le Compartment ci-dessus, puis force le système à réévaluer
// l'affordance clavier :
//  - on=true  : blur() puis focus() — sur Android WebView, changer inputmode
//    sur un contentDOM déjà focus ne relève pas toujours le clavier tout
//    seul ; le cycle blur→focus force la réévaluation.
//  - on=false : blur() seul. `@capacitor/keyboard` (Keyboard.hide()) N'EST
//    PAS câblé ici : ce plugin n'est PAS une dépendance du projet à ce jour
//    (cf. package.json — seuls status-bar/camera/filesystem/app sont
//    installés), et un import (même dynamique) d'un module absent casserait
//    la résolution Vite. Si le test device (Pixel 7, gate) montre que blur()
//    seul ne ferme pas le clavier logiciel de façon fiable, ajouter la
//    dépendance `@capacitor/keyboard` puis appeler Keyboard.hide() ici en
//    suivant EXACTEMENT le patron de syncStatusBar (src/theme/apply.js) :
//    dynamic import + try/catch + garde Capacitor.isNativePlatform() (no-op
//    silencieux web/banc/test).
// Renvoie `on` (même contrat que toggleMarkup) pour que l'appelant (Reader-
// TextEditor.vue) synchronise son libellé de bouton sans état dupliqué.
function setKeyboard(view, on) {
  view.dispatch({ effects: keyboardAttrsCompartment.reconfigure(EditorView.contentAttributes.of(keyboardContentAttrs(on))) })
  view.contentDOM.blur()
  if (on) view.focus()
  return on
}

// ── Fallback device — PAS câblé au bouton par défaut ──
// Si inputmode="none" s'avère insuffisant sur Pixel 7 (le clavier s'ouvre
// quand même), basculer sur `EditorView.editable.of(false)` : CM6 dérive
// l'attribut DOM `contenteditable` directement de la facette `editable`
// (cf. updateAttrs() de @codemirror/view) — contenteditable="false" tue le
// clavier virtuel de façon certaine, quel que soit le fabricant/OS. Le
// re-balisage continue de fonctionner : `editable` ne gouverne QUE le
// contenteditable natif (frappe/IME utilisateur), pas les dispatches
// programmatiques (`view.dispatch({ changes/selection })`, cf. applyRetag
// plus bas) — un curseur peut donc toujours être posé et une ligne
// requalifiée avec contenteditable=false.
// Compartment séparé du précédent (posé à `true` par défaut = comportement
// actuel inchangé tant que ce fallback n'est pas activé) pour que les deux
// stratégies restent indépendantes et permutables sans tout redéployer.
// Pour ACTIVER ce fallback à la place de la voie inputmode : remplacer le
// corps de setKeyboard ci-dessus par un appel à setKeyboardEditableFallback
// (même signature `(view, on) => boolean`).
const editableCompartment = new Compartment()

function setKeyboardEditableFallback(view, on) {
  view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(on)) })
  view.contentDOM.blur()
  if (on) view.focus()
  return on
}

// -----------------------------------------------------------------------
// Barre de requalification — agit sur la/les ligne(s) couverte(s)
// par la sélection courante, via retagSelection (helper pur) + une seule
// transaction CM6 multi-changements.
// -----------------------------------------------------------------------

// Un affordance par balisage de la LÉGENDE (§ barre = balisages possibles, et
// pas plus) : Étape · Compteur · Note · Section · Texte · Référence.
// Compteur, Section et Référence portent un sous-choix → rendus en puce ouvrant
// un popover (openMenuPopover — plus aucun <select> dans la barre).
// L'ancien
// menu « + catégorie » (18 kinds de section, une déco d'icône, PAS un
// balisage) est retiré. Le balisage Image existe toujours (parsé/rendu par
// les widgets ci-dessus), mais n'a plus d'ACTION manuelle dans la barre :
// les images sont déjà présentes dans le texte importé, jamais
// insérées à la main ; on garde seulement le tap-to-select pour les déplacer.
//
// Ordres FIXES (valeurs internes, indépendantes de la langue) — les libellés
// affichés viennent de `labels` (cf. buildToolbarHtml ci-dessous), jamais codés
// ici. `applyRetag`/`wireToolbar` lisent ces `value`/`tag`, jamais un libellé.
const COUNTER_KINDS = ['rep', 'cadence']
const REFERENCE_TAGS = ['yarn', 'needles', 'gauge', 'materials', 'tips', 'abbreviations', 'measurements', 'techniques']

// Repli FR : le banc tools/mdedit appelle createCmEditor hors i18n (pas de
// `labels`). C'est le SEUL usage de fr.json ici — l'app, elle, passe toujours
// ses libellés traduits (opts.labels, cf. ReaderTextEditor.vue useI18n()).
const FR_KIND_LABELS = { kinds: fr.reader.kind, families: fr.reader.family }

// Menu Section : « Générique » (défaut) en tête hors groupe, puis un <optgroup>
// par famille, alphabétique dedans (cf. groupedSectionKinds, section-kinds.js).
// diagramme/echantillon exclus (doublons de la barre : bouton Diagramme du menu
// Aide mémoire, balise Échantillon des 7 libellés de référence).
const SECTION_EXCLUDE = ['diagramme', 'echantillon']
const FR_SECTIONS = groupedSectionKinds(FR_KIND_LABELS, 'fr', { exclude: SECTION_EXCLUDE })

// Repli FR de TOUTE la barre (banc tools/mdedit hors i18n) — source unique
// correction.toolbar.* de fr.json, pour ne jamais dériver du JSON.
const FR_TOOLBAR_LABELS = { ...fr.correction.toolbar, sections: FR_SECTIONS }

// Repli FR du mini-dialogue de saisie numérique (openNumberPrompt) — même
// contrat que FR_TOOLBAR_LABELS : source unique fr.json (common.cancel +
// correction.prompt.*), spread (pas de liste recopiée à la main, qui
// dériverait silencieusement vers `undefined` dans le banc). `cancel` réutilise
// la clé common.cancel existante plutôt que d'en dupliquer
// une sous correction.prompt.
const FR_PROMPT_LABELS = { cancel: fr.common.cancel, ...fr.correction.prompt }

// Inline le SVG d'une icône du registre (même rendu qu'AppIcon.vue) pour l'injecter
// dans la barre HTML de l'éditeur (chaîne, pas un composant Vue). Décoratif :
// aria-hidden — le sens est porté par l'aria-label du bouton/menu parent.
function iconSvg(name, size = 20) {
  const d = ICONS[name] || ICONS.pelote
  const vb = d.vb || '0 0 24 24'
  const sw = d.sw ?? 1.7
  return (
    `<svg viewBox="${vb}" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">${d.body}</svg>`
  )
}

// Le libellé (déjà FOURNI à l'appelant pour aria-label/
// title, cf. ci-dessous) est aussi rendu en <span> VISIBLE, sous l'icône (cf. CSS
// .cm-retag-btn-label, ReaderTextEditor.vue) — retour device : au tactile (pas de
// hover sur Android), le `title` HTML ne s'affiche jamais, seul aria-label restait
// pour distinguer Étape/Note/Texte, découvrable uniquement en cliquant ou via
// l'aide repliée. `aria-hidden` PAS posé sur ce span : un lecteur d'écran lirait
// alors deux fois le même mot (aria-label du bouton + span visible) — laisser le
// span porter le texte normalement et retirer l'aria-label serait équivalent en
// rendu, mais aria-label reste la source unique lue par les tests existants
// (cm-editor-toolbar-i18n.spec.js) : gardé pour ne pas les faire dériver.
const retagBtn = (type, label, icon) =>
  `<button type="button" data-retag="${type}" class="cm-retag-btn" aria-label="${label}" title="${label}">` +
  `${iconSvg(icon)}<span class="cm-retag-btn-label">${label}</span></button>`

// Puce Section/Aide-mémoire : même structure que retagBtn
// ci-dessus (icône + libellé empilé, cible 44×44 via la même classe `cm-retag-btn`),
// mais SANS `data-retag` : le clic ouvre un popover (openMenuPopover) plutôt
// que d'appliquer un retag direct — cf. wireToolbar plus bas, qui câble le `click` à
// la main pour ces deux-là. `className` (2e classe posée sur le bouton, en plus de
// `cm-retag-btn`) porte `cm-retag-section`/`cm-retag-ref` : c'est CE sélecteur que
// TYPE_TO_SELECTOR/updateToolbarActive utilisent pour l'état actif, inchangé depuis
// l'époque des <select> (même contrat, juste porté par un bouton désormais).
// `chipLabel` (repli sur `ariaLabel`) : le SPAN visible peut différer de
// aria-label/title — mesuré Playwright réel à 360px (cf. rapport de tâche) : le FR
// « Aide mémoire » (avec espace) enroule sur 2 lignes dans le carré 44px et rend le
// bouton 46px de haut (non carré), alors que EN/ES/DE (« Reference »/« Referencia »/
// « Referenz », un seul mot) tiennent tous les trois sur une ligne à cette même
// largeur. `labels.referenceChip` porte donc un libellé VISIBLE plus court
// spécifiquement pour le FR (« Mémoire ») ; aria-label/title restent la forme
// complète (`ariaReference`, jamais raccourcie) — l'abréviation est un choix de
// lisibilité visuelle, pas une perte d'information pour la lecture d'écran.
//
// `aria-haspopup="menu" aria-expanded="false"` posés ICI, statiquement, dès le premier
// rendu (revue) : avant ce correctif, ces deux attributs n'existaient
// qu'APRÈS le premier tap (posés par openMenuPopover à l'ouverture) — un lecteur d'écran
// ne pouvait donc pas distinguer, avant toute interaction, une puce à popover
// (Section/Aide-mémoire/Compteur) d'une puce à action immédiate (Étape/Note/Texte).
// openMenuPopover continue de faire passer `aria-expanded` à "true"/"false" à
// l'ouverture/fermeture (inchangé) mais NE TOUCHE PLUS à `aria-haspopup` (qui vaut
// désormais "menu" en permanence, jamais réécrit en "true") — cf. openMenuPopover plus
// bas, dont l'ancien `setAttribute('aria-haspopup', 'true')` est retiré pour cette
// raison : le laisser aurait silencieusement écrasé cette valeur "menu" à chaque
// ouverture.
const retagMenuBtn = (className, ariaLabel, icon, chipLabel = ariaLabel) =>
  `<button type="button" class="cm-retag-btn ${className}" aria-label="${ariaLabel}" title="${ariaLabel}" ` +
  `aria-haspopup="menu" aria-expanded="false">` +
  `${iconSvg(icon)}<span class="cm-retag-btn-label">${chipLabel}</span></button>`

// Aplatit les groupes de groupedSectionKinds (forme [{ family, label, items: [{ value,
// label }] }]) en la forme attendue par openMenuPopover ([{ value, label, groupLabel? }],
// cf. openMenuPopover) : le groupe hors famille (family === null, le défaut « Générique »/pelote)
// garde ses items SANS groupLabel (enfants directs du popover, comme avant en tête de
// liste hors <optgroup>), les autres portent le `label` de leur famille comme groupLabel
// — openMenuPopover les regroupe alors sous un intitulé, à condition qu'ils restent
// CONSÉCUTIFS (contrat de la fonction) : c'est garanti ici, chaque famille est émise
// d'un bloc par groupedSectionKinds. Remplace l'ancien rendu <optgroup> (sectionMenuHtml,
// retiré avec les <select>).
function sectionMenuItems(sections) {
  const items = []
  for (const g of sections || []) {
    for (const it of g.items) {
      // Les deux branches listent leurs champs EXPLICITEMENT (pas de `...it` d'un
      // côté seulement) : si `groupedSectionKinds` ajoutait un jour un champ à
      // `items`, un spread asymétrique le laisserait fuiter vers openMenuPopover
      // par une seule des deux branches, silencieusement.
      items.push(
        g.family === null
          ? { value: it.value, label: it.label }
          : { value: it.value, label: it.label, groupLabel: g.label }
      )
    }
  }
  return items
}

// Items du popover Aide-mémoire : les 8 balises de référence à plat, PUIS
// Diagramme — même liste et même ordre que l'ancien <select> (cf. wireToolbar : le choix
// « diagramme » route vers `section`/`kind: 'diagramme'`, pas vers `reference`, cf. plus
// bas). Aucun `groupLabel` : ce menu n'a jamais été groupé, contrairement à Section.
function referenceMenuItems(labels) {
  return [
    ...REFERENCE_TAGS.map((tag) => ({ value: tag, label: labels[tag] })),
    { value: 'diagramme', label: labels.chart },
  ]
}

// Items du popover Compteur : les 2 sous-choix Répétition/Cadence, dans le
// même ordre et avec le même repli de libellé (`counterRep`/`counterCadence`) que
// l'ancien <select> (cf. l'ex-`counterOpts` de buildToolbarHtml, retiré avec le
// <select>). Aucun `groupLabel` : jamais groupé, comme le menu Aide-mémoire.
function counterMenuItems(labels) {
  return COUNTER_KINDS.map((k) => ({
    value: k,
    label: labels[k === 'rep' ? 'counterRep' : 'counterCadence'],
  }))
}

/**
 * Construit le HTML de la barre de requalification.
 * @param {object} [labels] Libellés traduits (cf. createCmEditor). Absent →
 *   repli FR complet (contrat du banc tools/mdedit, qui appelle cette
 *   fonction — via createCmEditor — hors i18n).
 */
export function buildToolbarHtml(labels = FR_TOOLBAR_LABELS) {
  // Retour device : les 3 boutons Étape/Note/Texte et les 3 puces
  // Section/Aide-mémoire puis Compteur (retagMenuBtn) portent icône
  // + libellé texte empilés, 44×44px — plus aucun <select> dans cette barre depuis que
  // Compteur (le dernier survivant) est passé en puce ; `labels.counter` — l'ex-placeholder
  // du <select> — n'est donc plus lu ici, cf. counterMenuItems pour le contenu du
  // popover qui le remplace.
  return (
    `<div class="cm-retag-toolbar" role="toolbar" aria-label="${labels.ariaToolbar}">` +
    // Ordre hérité du regroupement en 2 lignes (retour device 28/07) : conservé tel
    // quel, seul le CONTRÔLE change (puce + popover au lieu de <select>, cf.
    // wireToolbar), jamais sa place — même une fois la coupure forcée retirée
    // (ci-dessous), l'ordre garde son utilité : Étape/Note groupés en tête, Texte en
    // fin, les 3 puces à popover au centre.
    //
    // `.cm-retag-break` RETIRÉ (revue du 2026-08-22) : ce <span> et son
    // CSS (ReaderTextEditor.vue, tools/mdedit/styles.css) forçaient une coupure en 2
    // lignes après les 3 premiers contrôles, sous 600px. À l'époque, le
    // <select> Compteur (108px) rendait cette coupure nécessaire ; Compteur est
    // ensuite devenu une puce 44px lui aussi, mais la coupure avait explicitement été
    // gardée (« hors périmètre »), et personne n'avait plus repris la décision
    // depuis. MESURÉ (Playwright réel, 360/393px, patron simple ET patron avec bloc
    // Aide-mémoire actif) avant de retirer : les 6 puces (6×44 + 5 gaps = 284px) tiennent
    // sur UNE SEULE ligne à ces deux largeurs, sans débordement horizontal du document
    // ni de la barre (toolbar.scrollWidth === toolbar.clientWidth), et l'indicateur de
    // type d'aide-mémoire (.cm-retag-ref-type, rempli et variable) passe proprement sur
    // sa PROPRE ligne sous les 6 puces sans jamais en chevaucher une seule. Rien ne
    // justifiait donc plus la coupure forcée : elle a été retirée (CSS + ce <span> +
    // support JS).
    retagBtn('rang', labels.step, 'checkbox') +
    retagBtn('note', labels.note, 'note') +
    retagMenuBtn('cm-retag-ref', labels.ariaReference, 'book', labels.referenceChip) +
    retagMenuBtn('cm-retag-counter', labels.ariaCounter, 'counter') +
    retagMenuBtn('cm-retag-section', labels.ariaSection, 'tab-sections') +
    retagBtn('texte', labels.text, 'text') +
    // Indicateur du type d'aide-mémoire de la ligne courante, rempli par
    // updateToolbarActive quand le curseur est sur un `## … {tag}` de référence.
    // Reste en DERNIER : son texte est variable et décalerait le groupement ailleurs.
    `<span class="cm-retag-ref-type" aria-live="polite"></span>` +
    `</div>`
  )
}

// Calcule les numéros de ligne (1-based) couverts par la sélection courante.
// Cas limite : quand la sélection se termine exactement au début d'une
// ligne sans qu'aucun caractère de celle-ci ne soit sélectionné, on ne
// l'inclut pas (même règle que l'ancien menu textarea, md-toolbar.js).
function selectedLineRange(state) {
  const sel = state.selection.main
  const firstLine = state.doc.lineAt(sel.from)
  let lastLine = state.doc.lineAt(sel.to)
  if (sel.from !== sel.to && sel.to === lastLine.from && lastLine.number > firstLine.number) {
    lastLine = state.doc.lineAt(Math.max(sel.to - 1, firstLine.from))
  }
  return { from: firstLine.number, to: lastLine.number }
}

function applyRetag(view, type, opts = {}) {
  const { state } = view
  const { from, to } = selectedLineRange(state)
  const doc = state.doc.toString()

  // FUSION : si la rubrique existe déjà ailleurs dans le document, la sélection la rejoint
  // au lieu de créer un second bloc. Les DEUX changements partent dans la MÊME transaction
  // -> un seul Ctrl+Z pour annuler le geste entier. `mergeIntoReference` renvoie zéro
  // changement quand il n'y a rien à fusionner : on retombe alors sur le retag simple.
  // Le parseur fusionne de son côté (reference-merge.js) : cette garde-ci sert le confort de
  // lecture du texte, celle-là protège les MD qui n'ont pas transité par cet éditeur.
  if (type === 'reference') {
    const merged = mergeIntoReference(doc, from, to, opts)
    if (merged.changes.length) {
      view.dispatch({ changes: merged.changes })
      view.focus()
      return
    }
  }

  const { changes } = retagSelection(doc, from, to, type, opts)
  if (changes.length) view.dispatch({ changes })
  view.focus()
}

// Styles auto-contenus du mini-dialogue numérique — injectés UNE fois (garde
// par id), tokens avec repli pour rester correct au banc mdedit (hors app,
// donc hors thème clair/sombre) comme dans l'app (auto-thème via les tokens).
// Identifiant unique par ouverture (label <-> input, aria-labelledby), cf.
// commentaire d'openNumberPrompt. Un compteur de module suffit : jamais de
// Math.random()/Date.now() nécessaires pour un simple id DOM local à la page.
let numpromptCounter = 0
function numpromptId() {
  numpromptCounter += 1
  return `cm-numprompt-${numpromptCounter}`
}

// Piège au Tab (après revue) : le voile (`.cm-numprompt`,
// scrim) ne bloque le Tab que VISUELLEMENT — sans ce garde, Tab/Maj+Tab pouvait
// faire sortir le focus de la carte vers la page derrière, jamais `inert` côté
// DOM. Boucle entre le PREMIER et le DERNIER élément focalisable de `container`
// (champ(s) + Annuler + OK). Version PARTAGÉE depuis le 07/09
// (composables/useFocusTrap.js — généralisation du même motif, unifiée avec
// ChartFullscreen et tous les dialogues) : ce fichier n'a plus qu'à l'importer,
// les 2 appels ci-dessous passant la carte en conteneur explicite (le listener
// est document-level, `event.currentTarget` n'y est pas la carte).

const NUMPROMPT_STYLE_ID = 'cm-numprompt-style'
function ensureNumPromptStyles() {
  if (document.getElementById(NUMPROMPT_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = NUMPROMPT_STYLE_ID
  style.textContent = `
.cm-numprompt {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, .5);
  /* Le DEFILEMENT vit ici, sur l'enveloppe, et NON sur la carte : sans conteneur
     defilant, le mecanisme d'evitement du clavier
     (src/utils/keyboard-avoidance.js) se replierait sur le document, poserait sa
     marge DERRIERE ce dialogue en position fixe et ne deplacerait rien - il
     serait inerte.
     Pourquoi PAS sur la carte (mesure sur l'appareil le 30/07) : la carte est
     courte et n'atteint jamais son plafond, donc les 45vh de marge la GONFLENT au
     lieu de creer de la place a defiler - elle passait de ~152 a 577 points, dont
     425 de vide sous les boutons. Sur l'enveloppe, qui occupe deja tout l'ecran,
     la marge cree de la place a defiler sans rien gonfler : carte 168 points,
     16 de vide, et le champ est meme legerement mieux place (228 contre 236).
     (Pas d'accent grave ici : ce bloc CSS vit dans un gabarit JavaScript.) */
  overflow-y: auto;
}
.cm-numprompt__card {
  background: var(--bg, #fff);
  color: var(--ink, #1a1a1a);
  padding: 16px;
  border-radius: var(--r-md, 12px);
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* Ni max-height ni overflow-y ICI : le defilement est porte par l'enveloppe
     .cm-numprompt ci-dessus (voir l'explication mesuree qui s'y trouve). */
}
.cm-numprompt__label {
  font-size: 1rem;
}
.cm-numprompt__input {
  min-height: 44px;
  font-size: 16px;
  padding: 8px 12px;
  border: 1px solid var(--line, #ccc);
  border-radius: var(--r-md, 12px);
  background: var(--tile, #fff);
  color: var(--ink, #1a1a1a);
}
.cm-numprompt__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.cm-numprompt__btn {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--line, #ccc);
  border-radius: var(--r-md, 12px);
  background: var(--tile, #fff);
  color: var(--ink, #1a1a1a);
}
.cm-numprompt__btn--primary {
  background: var(--brand, #b5651d);
  color: var(--on-accent, #fff);
  border-color: var(--brand, #b5651d);
}
`
  document.head.appendChild(style)
}

// Remplace l'ex-promptInt (window.prompt, clavier AZERTY complet imposé par le
// navigateur) par un mini-dialogue DOM à input `inputmode="numeric"` (clavier
// chiffres uniquement sur device). Résout un entier > 0, ou `null` UNIQUEMENT sur
// Annuler/Échap/clic hors carte — jamais de throw. Une entrée vide/non numérique au
// moment de valider NE FERME PAS la carte (après revue : auparavant
// elle résolvait `null` et fermait, indiscernable d'un Annuler — la
// travailleuse pouvait croire son nombre posé alors que rien n'avait changé) :
// focus reporté sur le champ, comme openNumberFormPrompt juste en dessous.
// `cancelLabel` : repli FR_PROMPT_LABELS.cancel par défaut — préserve le
// comportement des appelants externes (cf. tests/unit/cm-number-prompt.spec.js,
// qui appelle cette fonction EXPORTÉE avec 1 ou 2 arguments seulement) et celui
// du banc tools/mdedit (hors i18n, jamais de 3e argument).
export function openNumberPrompt(message, fallback, cancelLabel = FR_PROMPT_LABELS.cancel) {
  ensureNumPromptStyles()
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'cm-numprompt'

    const card = document.createElement('div')
    card.className = 'cm-numprompt__card'
    // Après revue : `role="dialog"`/`aria-modal` + libellé
    // associé au champ étaient absents (contrairement à openMenuPopover, qui les
    // pose déjà correctement) — un lecteur d'écran qui atteint le champ n'annonçait
    // jamais la question posée. `numpromptId()` : identifiant unique par ouverture,
    // pour ne jamais collider si (cas non prévu aujourd'hui, cf. tête de fichier —
    // un seul popover de MENU à la fois, mais rien n'empêche structurellement deux
    // numprompt) deux cartes coexistaient.
    const uid = numpromptId()
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-labelledby', uid)

    const label = document.createElement('label')
    label.id = uid
    label.htmlFor = `${uid}-input`
    label.className = 'cm-numprompt__label'
    label.textContent = message

    const input = document.createElement('input')
    input.id = `${uid}-input`
    input.type = 'text'
    input.className = 'cm-numprompt__input'
    input.inputMode = 'numeric'
    input.setAttribute('inputmode', 'numeric')
    input.setAttribute('pattern', '[0-9]*')
    if (fallback != null) input.value = String(fallback)

    const actions = document.createElement('div')
    actions.className = 'cm-numprompt__actions'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'cm-numprompt__btn'
    cancelBtn.textContent = cancelLabel

    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.className = 'cm-numprompt__btn cm-numprompt__btn--primary'
    okBtn.textContent = 'OK'

    actions.append(cancelBtn, okBtn)
    card.append(label, input, actions)
    overlay.appendChild(card)

    function close(result) {
      document.removeEventListener('keydown', onKeydown)
      overlay.remove()
      resolve(result)
    }

    // Après revue : une entrée vide/non numérique fermait AVANT
    // exactement comme Annuler (résolvait `null`) — une travailleuse qui corrige un
    // nombre de répétitions pouvait repartir en croyant l'avoir posé alors que rien
    // n'avait changé, sans le moindre indice visuel. Repris du contrat DÉJÀ correct
    // d'openNumberFormPrompt (juste en dessous dans ce fichier) : refuse de fermer,
    // reporte le focus sur le champ — la même carte reste ouverte, prête à corriger.
    function confirm() {
      const n = parseInt(input.value, 10)
      if (!(Number.isFinite(n) && n > 0)) {
        input.focus()
        input.select()
        return
      }
      close(n)
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(null)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        confirm()
        return
      }
      trapTabFocus(event, card)
    }

    cancelBtn.addEventListener('click', () => close(null))
    okBtn.addEventListener('click', confirm)
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null)
    })
    document.addEventListener('keydown', onKeydown)

    document.body.appendChild(overlay)
    input.focus()
    input.select()
  })
}

// Sœur d'openNumberPrompt ci-dessus, pour PLUSIEURS champs à la fois (Cadence
// fusionne « Répéter tous les » et « fois » dans une
// SEULE carte au lieu de 2 dialogues séquentiels). Même carte/overlay
// (`.cm-numprompt`/`.cm-numprompt__card`, déjà en `flex-direction: column; gap:
// 12px` — rien à ajouter en CSS pour empiler 2 champs), même mécanique de
// fermeture (Échap, clic hors carte, listener document-level retiré à la
// fermeture), mais validation et navigation clavier adaptées à N champs :
// - Entrée sur un champ qui n'est PAS le dernier déplace le focus au suivant
//   (ne valide rien) ; Entrée sur le dernier valide, comme un clic sur « OK ».
// - Un seul bouton « OK » valide TOUS les champs ENSEMBLE : si l'un d'eux est
//   vide/non numérique, RIEN ne ferme — focus posé sur le premier champ fautif,
//   sans message d'erreur. MÊME validation qu'openNumberPrompt depuis
//   la revue de conception (auparavant, openNumberPrompt
//   résolvait `null` et fermait silencieusement sur une entrée invalide — les deux
//   fonctions divergeaient délibérément sur ce point ; toujours pas factorisées
//   derrière un paramètre commun, la proximité des deux implémentations suffit).
// `fields` : `[{ label, fallback }, …]`, dans l'ordre d'affichage. Résout un
// TABLEAU de valeurs (même ordre que `fields`), ou `null` si annulé.
export function openNumberFormPrompt(fields, cancelLabel = FR_PROMPT_LABELS.cancel) {
  ensureNumPromptStyles()
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'cm-numprompt'

    const card = document.createElement('div')
    card.className = 'cm-numprompt__card'
    // Après revue : mêmes manques qu'openNumberPrompt (rôle,
    // libellé associé au champ) — cf. son commentaire pour le détail. `aria-labelledby`
    // référence TOUS les libellés de champ (liste d'ids séparés par un espace, forme
    // ARIA valide) : ce dialogue n'a pas de titre unique, seulement des libellés par
    // champ (« Répéter tous les », « fois »).
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    const labelIds = []

    const inputs = fields.map(({ label: text, fallback }) => {
      const uid = numpromptId()
      labelIds.push(uid)
      const label = document.createElement('label')
      label.id = uid
      label.htmlFor = `${uid}-input`
      label.className = 'cm-numprompt__label'
      label.textContent = text

      const input = document.createElement('input')
      input.id = `${uid}-input`
      input.type = 'text'
      input.className = 'cm-numprompt__input'
      input.inputMode = 'numeric'
      input.setAttribute('inputmode', 'numeric')
      input.setAttribute('pattern', '[0-9]*')
      if (fallback != null) input.value = String(fallback)

      card.append(label, input)
      return input
    })
    card.setAttribute('aria-labelledby', labelIds.join(' '))

    const actions = document.createElement('div')
    actions.className = 'cm-numprompt__actions'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'cm-numprompt__btn'
    cancelBtn.textContent = cancelLabel

    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.className = 'cm-numprompt__btn cm-numprompt__btn--primary'
    okBtn.textContent = 'OK'

    actions.append(cancelBtn, okBtn)
    card.append(actions)
    overlay.appendChild(card)

    function close(result) {
      document.removeEventListener('keydown', onKeydown)
      overlay.remove()
      resolve(result)
    }

    // Valide TOUS les champs ensemble. Le premier champ invalide (vide/non
    // numérique/≤0, même contrat qu'openNumberPrompt) empêche la fermeture et
    // reçoit le focus — aucune fermeture partielle, aucun message d'erreur.
    function confirm() {
      const values = inputs.map((input) => {
        const n = parseInt(input.value, 10)
        return Number.isFinite(n) && n > 0 ? n : null
      })
      const badIndex = values.indexOf(null)
      if (badIndex !== -1) {
        inputs[badIndex].focus()
        inputs[badIndex].select()
        return
      }
      close(values)
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(null)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const idx = inputs.indexOf(document.activeElement)
        if (idx !== -1 && idx < inputs.length - 1) {
          inputs[idx + 1].focus()
          inputs[idx + 1].select()
        } else {
          confirm()
        }
        return
      }
      trapTabFocus(event, card)
    }

    cancelBtn.addEventListener('click', () => close(null))
    okBtn.addEventListener('click', confirm)
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null)
    })
    document.addEventListener('keydown', onKeydown)

    document.body.appendChild(overlay)
    inputs[0].focus()
    inputs[0].select()
  })
}

// -----------------------------------------------------------------------
// Popover de menu générique (fondations) — mécanisme réutilisable, désormais
// câblé sur les 3 anciens <select> de la barre : Section/Aide-mémoire, puis
// Compteur. Les 3 sont désormais des puces `retagMenuBtn` qui ouvrent
// ce popover, cf. wireToolbar plus bas et sectionMenuItems/referenceMenuItems/
// counterMenuItems pour la forme `items` attendue par chacun).
//
// Même patron d'overlay que openNumberPrompt ci-dessus (overlay ajouté à
// document.body, listener keydown document-level retiré à la fermeture,
// jamais de throw), mais ANCRÉ au rect de l'élément déclencheur plutôt que
// centré à l'écran, et en `position: fixed` réglé DIRECTEMENT en style
// inline (pas seulement en CSS) : `.cm-retag-toolbar` passe en
// `overflow-x: auto` en mode compact (ReaderTextEditor.vue), un popover en
// `position: absolute` y serait tronqué au défilement horizontal de la barre
// Le CSS de ReaderTextEditor.vue (`.cm-menu-popover`)
// ne porte que l'habillage visuel ; top/left/position restent calculés ici,
// à chaque ouverture, à partir du rect réel de l'ancre.
//
// État "un seul popover ouvert à la fois" en SCOPE MODULE, PAS scindé par
// instance d'éditeur : contrairement à `labels`/`sizeLabels` (données
// propres à CHAQUE éditeur, capturées par closure dans createCmEditor parce
// qu'elles diffèrent d'un éditeur coexistant à l'autre, ex. la langue), cette
// fonction ne reçoit aucune donnée d'éditeur — juste un élément déclencheur,
// une liste d'items et un callback, fournis frais à chaque appel. Le même
// précédent existe déjà pour openNumberPrompt (document.body, listener
// document-level, module-scope) : un seul popover peut visuellement exister
// à la fois dans le document, donc un singleton module-scope est le bon
// niveau ici, pas un état à scinder par instance.
let closeOpenMenuPopover = null

const MENU_POPOVER_MARGIN = 8

// Styles auto-contenus du popover de menu — injectés UNE fois (garde par id), même
// patron qu'ensureNumPromptStyles ci-dessus. Déplacés ICI depuis ReaderTextEditor.vue
// (revue) : ce CSS ne vivait QUE dans ce composant Vue, un fichier que
// tools/mdedit n'importe jamais (ce banc monte l'éditeur via createCmEditor directement,
// cf. tête de fichier) — le popover s'y ouvrait donc SANS AUCUN style (pas de fond, pas
// de bordure, pas de z-index), et surtout `.cm-menu-popover-scrim` n'y portait ni
// `position: fixed` ni `inset: 0` (ces déclarations vivaient dans la même règle Vue) :
// le clic hors popover n'y fermait donc RIEN dans ce banc (seul Échap fonctionnait).
// Même remède qu'ensureNumPromptStyles avant lui : un module JS partagé par l'app ET
// par tools/mdedit est le seul endroit qui bénéficie aux deux à la fois.
// Tokens SANS repli dans tools/mdedit (qui n'a pas la feuille de tokens de l'app,
// cf. ensureNumPromptStyles ci-dessus pour le même besoin) : `--e-3` (ombre),
// `--ink-55` (intitulé de groupe), `--surface` (survol/focus d'un item). `--bg`/`--ink`/
// `--line`/`--r-md`/`--r-sm` portaient déjà un repli dans la règle Vue d'origine,
// conservés à l'identique.
const MENU_POPOVER_STYLE_ID = 'cm-menu-popover-style'
function ensureMenuPopoverStyles() {
  if (document.getElementById(MENU_POPOVER_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = MENU_POPOVER_STYLE_ID
  style.textContent = `
.cm-menu-popover {
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
  max-width: calc(100vw - 16px);
  max-height: 60vh;
  overflow-y: auto;
  padding: 6px;
  background: var(--bg, #fff);
  color: var(--ink, #1a1a1a);
  border: 1px solid var(--line, #ccc);
  border-radius: var(--r-md, 16px);
  box-shadow: var(--e-3, 0 8px 24px rgba(0, 0, 0, .2));
  /* Transition d'ouverture, optionnelle : PAS un second bloc prefers-reduced-motion ici.
     Dans l'app, le bloc global sur l'etoile universelle (src/styles/tokens.css) neutralise
     deja cette animation sans rien y ajouter. tools/mdedit n'a PAS cette feuille de tokens :
     cette animation y joue donc meme si le systeme demande de reduire les animations - ecart
     assume (mdedit est un banc de developpement, pas l'app livree), pas silencieux.
     Pas d'accent grave dans ce commentaire : la paire qui s'y
     trouvait AVANT ce correctif (deux accents graves autour d'une simple etoile, pour la
     mettre en valeur façon markdown) coupait ce bloc CSS en deux gabarits JavaScript
     distincts multiplies l'un par l'autre (gabarit A fois gabarit B) - le style.textContent obtenu valait
     litteralement la chaine "NaN", jamais du CSS. Root cause la plus large, plus
     large que le simple manque de fond du scrim : AUCUNE regle de ce
     bloc (fond/bordure/rayon de la fenetre, padding/coche des items, position/inset/z-index
     du scrim) n'a jamais ete appliquee en production avant ce correctif - confirme en
     inspectant document.getElementById('cm-menu-popover-style').textContent apres un appel
     reel a ensureMenuPopoverStyles() (typeof === 'string', valeur === "NaN"). Meme piege que
     celui documente pour .cm-numprompt plus haut dans ce fichier : ce bloc CSS vit dans un
     gabarit JavaScript, un accent grave non echappe y termine la chaine. */
  animation: cm-menu-popover-in 120ms ease;
}
@keyframes cm-menu-popover-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.cm-menu-popover__group {
  padding: 6px 10px 2px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-55, #666);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.cm-menu-popover__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  text-align: left;
  border: none;
  border-radius: var(--r-sm, 12px);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}
.cm-menu-popover__item:hover,
.cm-menu-popover__item:focus-visible {
  background: var(--surface, #f0f0f0);
  outline: none;
}
/* Marque de sélection (retour terrain) : la puce fermée montre déjà le
   type actif (.is-active, façon Word — cf. updateToolbarActive, INCHANGÉ par
   ce correctif), mais rien ne montrait LEQUEL des items du popover, une fois
   rouvert, correspondait à ce type actif. .cm-menu-popover__item-check
   (coche, registre d'icônes existant — même iconSvg que le reste de cette
   barre, pas une image ad hoc) est posé pour TOUS les items d'un popover qui
   porte la notion de sélection (Section/Aide-mémoire), vide ou non, pour que
   les libellés restent alignés entre item sélectionné et items voisins —
   seul l'item actif a le fond distinct ci-dessous. Compteur n'a pas cette
   notion (cf. wireToolbar) : ses items n'ont jamais cette classe.
   --brand déjà utilisé plus haut (cm-numprompt__btn--primary) pour un accent,
   même choix ici. Pas d'accent grave dans ce commentaire : ce bloc CSS vit
   dans un gabarit JavaScript (même piège documenté plus haut, cm-numprompt). */
.cm-menu-popover__item-check {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--brand, #b5651d);
}
.cm-menu-popover__item--selected {
  background: var(--surface, #f0f0f0);
  font-weight: 700;
}
.cm-menu-popover__item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cm-menu-popover__item-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--ink-55, #666);
}
.cm-menu-popover__item--disabled {
  cursor: default;
  opacity: 0.55;
}
.cm-menu-popover__item--disabled:hover,
.cm-menu-popover__item--disabled:focus-visible {
  background: transparent;
}
.cm-menu-popover-scrim {
  position: fixed;
  inset: 0;
  z-index: 2000;
  /* Assombrissement (retour terrain Nexus 7) : SANS lui, le texte de
     l'éditeur restait pleinement visible derrière/autour du popover et se
     chevauchait avec ses intitulés de groupe. Même valeur que .cm-numprompt
     ci-dessus : aucun token de voile
     commun n'existe ailleurs dans le projet (les overlays du reste de l'app
     vont de rgba(0,0,0,.12) à rgba(0,0,0,.9) selon le composant, jamais
     factorisés), donc reprise à l'identique pour rester cohérent avec le
     patron le plus proche plutôt que d'inventer une nouvelle valeur.
     .cm-menu-popover — POSÉ APRÈS le scrim dans le DOM (cf. openMenuPopover)
     — reste au-dessus visuellement malgré le même z-index : à z-index égal,
     l'ordre du DOM tranche. Pas d'accent grave dans ce commentaire : ce bloc
     CSS vit dans un gabarit JavaScript (cf. la note plus haut sur cette même
     fonction, qui documente le bogue que cela a causé avant ce correctif). */
  background: rgba(0, 0, 0, .5);
}
`
  document.head.appendChild(style)
}

/**
 * Ouvre un popover de menu ancré à `anchorEl`, en position fixe (jamais
 * tronqué par le défilement horizontal de la barre en mode compact).
 * `items` : `[{ value, label, groupLabel? }]` — un `groupLabel` identique sur
 * des items consécutifs les regroupe visuellement sous un intitulé (même
 * esprit qu'un `<optgroup>`, cf. sectionMenuItems plus haut). `onSelect(value)`
 * est appelé au clic/Entrée sur un item, puis le popover se ferme.
 * `selectedValue` (retour terrain) distingue TROIS états, pas deux :
 *   - une VALEUR (`item.value === selectedValue`) : ce popover est une liste à
 *     choix unique, CET item est actuellement actif — porte la marque de
 *     sélection (coche + fond distinct). Si plusieurs items partagent cette
 *     valeur (ex. `corps`/`bordure`, multi-familles dans section-kinds.js),
 *     seule la PREMIÈRE occurrence rencontrée est marquée — un radiogroup ne
 *     doit jamais avoir deux items cochés ;
 *   - `null` : ce popover reste une liste à choix unique (tous les items
 *     reçoivent `role="menuitemradio"` + `aria-checked`), mais AUCUN n'est
 *     actif en ce moment (curseur sur une ligne sans type actif, ou sans
 *     balise lisible) — état « rien de coché » normal d'un groupe radio ;
 *   - `undefined` (repli d'appel, 4e argument omis) : ce popover n'a PAS de
 *     notion de sélection courante du tout — `role="menuitem"` simple, jamais
 *     de coche. C'est le cas de Compteur (cf. wireToolbar) :
 *     Répétition/Cadence sont des ACTIONS qui ouvrent un formulaire de saisie,
 *     pas un choix persistant relisible sur la ligne — rien à cocher.
 * `onSelect(value)` est appelé au clic/Entrée sur un item, puis le popover se
 * ferme.
 * @param {HTMLElement} anchorEl Élément déclencheur (reçoit aria-haspopup/
 *   aria-expanded, même patron que StatusBadge.vue).
 * @param {{ value: string, label: string, groupLabel?: string }[]} items
 * `item.disabled` (optionnel) rend l'item non actionnable (clic/Entrée sans effet,
 * popover reste ouvert) mais toujours focusable/annoncé (aria-disabled, pas
 * l'attribut HTML `disabled`). `item.hint` (optionnel) affiche un second texte, plus
 * discret, sous le libellé — pensé pour expliquer POURQUOI un item est désactivé, ou
 * pour détailler un choix (cf. le sous-popover de type de diagramme, CorrectionView.vue).
 * @param {(value: string) => void} onSelect
 * @param {string|null} [selectedValue]
 */
export function openMenuPopover(anchorEl, items, onSelect, selectedValue) {
  ensureMenuPopoverStyles()

  // Un seul popover à la fois : fermer celui déjà ouvert (autre déclencheur,
  // ou le même rouvert) avant d'en poser un second.
  closeOpenMenuPopover?.()

  // `aria-haspopup` n'est PLUS posé ici (revue) : `retagMenuBtn`
  // le pose désormais statiquement ("menu") dans le HTML dès le premier rendu, pour
  // qu'un lecteur d'écran le voie AVANT tout tap. Le reposer ici à "true" écraserait
  // silencieusement cette valeur à chaque ouverture. `aria-expanded`, lui, reste posé
  // ici : c'est un état qui change réellement à l'ouverture/fermeture (inchangé).
  anchorEl.setAttribute('aria-expanded', 'true')

  const scrim = document.createElement('div')
  scrim.className = 'cm-menu-popover-scrim'

  const popover = document.createElement('div')
  popover.className = 'cm-menu-popover'
  popover.setAttribute('role', 'menu')
  // `position: fixed` posé en JS (pas seulement en CSS) : c'est ce calcul-ci,
  // avec le rect réel de l'ancre, qui doit gouverner — jamais une valeur figée
  // dans la feuille de style qui pourrait diverger silencieusement.
  popover.style.position = 'fixed'

  // Retour terrain : les 3 états de `selectedValue` sont documentés dans le
  // JSDoc ci-dessus — ici, `hasSelection` distingue seulement le 3e état (`undefined`,
  // repli d'appel : PAS de notion de sélection, cf. Compteur) des deux autres (une
  // valeur, ou `null` : ce popover porte la notion de sélection, coche placeholder
  // posée sur CHAQUE item pour que les libellés restent alignés, cf. CSS
  // ensureMenuPopoverStyles).
  const hasSelection = selectedValue !== undefined

  // Une même `value` peut apparaître dans PLUSIEURS groupes consécutifs (ex.
  // section-kinds.js : `corps`/`bordure` appartiennent à deux familles, donc
  // `sectionMenuItems` les émet deux fois). Un `menuitemradio` ne doit porter
  // la coche que sur une SEULE occurrence — sinon deux radios cochés dans le
  // même groupe (défaut d'accessibilité). On ne marque donc que la PREMIÈRE
  // occurrence rencontrée d'une valeur donnée.
  const alreadyMarked = new Set()

  let currentGroup = null
  let currentGroupLabel
  for (const item of items || []) {
    let parent = popover
    if (item.groupLabel !== undefined) {
      if (!currentGroup || item.groupLabel !== currentGroupLabel) {
        currentGroupLabel = item.groupLabel
        currentGroup = document.createElement('div')
        currentGroup.setAttribute('role', 'group')
        const heading = document.createElement('div')
        heading.className = 'cm-menu-popover__group'
        heading.textContent = item.groupLabel
        currentGroup.appendChild(heading)
        popover.appendChild(currentGroup)
      }
      parent = currentGroup
    } else {
      currentGroup = null
      currentGroupLabel = undefined
    }
    const isSelected = hasSelection && item.value === selectedValue && !alreadyMarked.has(item.value)
    if (isSelected) alreadyMarked.add(item.value)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cm-menu-popover__item'
    if (hasSelection) {
      btn.setAttribute('role', 'menuitemradio')
      btn.setAttribute('aria-checked', String(isSelected))
      if (isSelected) btn.classList.add('cm-menu-popover__item--selected')
    } else {
      btn.setAttribute('role', 'menuitem')
    }
    // Item désactivé (menu d'action image, cf. openImageActionsMenu plus bas) : PAS
    // l'attribut HTML `disabled` — un bouton natif désactivé sort de la navigation
    // clavier (Tab/flèches), ce qui masquerait le texte d'explication (`hint`) aux
    // utilisatrices de lecteur d'écran naviguant au clavier. `aria-disabled` reste
    // focusable/annoncé, seul le clic/Entrée est neutralisé ci-dessous.
    if (item.disabled) {
      btn.classList.add('cm-menu-popover__item--disabled')
      btn.setAttribute('aria-disabled', 'true')
    }
    btn.tabIndex = -1
    if (hasSelection) {
      const check = document.createElement('span')
      check.className = 'cm-menu-popover__item-check'
      check.setAttribute('aria-hidden', 'true')
      if (isSelected) check.innerHTML = iconSvg('check', 18)
      btn.appendChild(check)
    }
    const textWrap = document.createElement('span')
    textWrap.className = 'cm-menu-popover__item-text'
    const labelSpan = document.createElement('span')
    labelSpan.className = 'cm-menu-popover__item-label'
    labelSpan.textContent = item.label
    textWrap.appendChild(labelSpan)
    if (item.hint) {
      const hintSpan = document.createElement('span')
      hintSpan.className = 'cm-menu-popover__item-hint'
      hintSpan.textContent = item.hint
      textWrap.appendChild(hintSpan)
    }
    btn.appendChild(textWrap)
    btn.addEventListener('click', () => {
      // Un item désactivé n'appelle jamais onSelect ni ne ferme le popover — la
      // travailleuse reste sur le menu ouvert, avec le hint sous les yeux.
      if (item.disabled) return
      // Ordre voulu : onSelect PUIS fermeture — le callback peut
      // avoir besoin du DOM/focus tel qu'il était au moment du choix.
      onSelect(item.value)
      close()
    })
    parent.appendChild(btn)
  }

  document.body.appendChild(scrim)
  document.body.appendChild(popover)

  const buttons = Array.from(popover.querySelectorAll('.cm-menu-popover__item'))
  if (buttons.length) buttons[0].tabIndex = 0

  // Ancrage : rect de l'élément déclencheur, ajusté si le popover déborderait
  // à droite de la fenêtre (formule d'ancrage). Le `Math.max` externe
  // est un ajout SUPPLÉMENTAIRE (filet de sécurité sur un très petit écran,
  // où la formule seule pourrait renvoyer une valeur négative) — documenté,
  // pas un changement silencieux de la formule.
  const rect = anchorEl.getBoundingClientRect()
  const popoverWidth = popover.offsetWidth
  const left = Math.min(rect.left, window.innerWidth - popoverWidth - MENU_POPOVER_MARGIN)
  popover.style.left = `${Math.max(MENU_POPOVER_MARGIN, left)}px`

  // Ancrage VERTICAL (ajout ultérieur — l'ancrage d'origine ne posait que
  // `top = rect.bottom + 4` sans filet, aucun consommateur réel n'existant encore pour le
  // mettre à l'épreuve). Mesuré Playwright réel à 360×740 : le popover Aide-mémoire (9
  // items, ~426px) ouvert depuis la puce de la 2e ligne de la barre (ancrée vers y≈370)
  // déborde de ~58px sous la fenêtre — `max-height: 60vh` (ReaderTextEditor.vue) ne s'y
  // substitue PAS, la liste tenant sous ce plafond : rien ne raccourcit alors le popover,
  // il déborde juste hors écran, ses derniers items devenant inatteignables (le popover
  // est en `position: fixed`, un défilement de PAGE ne l'amène jamais dans le cadre).
  // Repli : s'il ne tient pas sous l'ancre ET qu'il tient mieux au-dessus, il s'ouvre
  // au-dessus ; sinon (ni l'un ni l'autre ne suffit, ex. tablette très basse) on le
  // plaque contre le bord bas de la fenêtre — jamais hors cadre, quitte à recouvrir
  // l'ancre, cas que `max-height: 60vh` empêche déjà d'atteindre en pratique.
  const popoverHeight = popover.offsetHeight
  const spaceBelow = window.innerHeight - rect.bottom - MENU_POPOVER_MARGIN
  const spaceAbove = rect.top - MENU_POPOVER_MARGIN
  const openAbove = popoverHeight > spaceBelow && spaceAbove > spaceBelow
  const top = openAbove
    ? rect.top - popoverHeight - 4
    : Math.min(rect.bottom + 4, window.innerHeight - popoverHeight - MENU_POPOVER_MARGIN)
  // Plancher supplémentaire (retour terrain, écran de correction) : l'ancre (Section/
  // Aide-mémoire/Compteur) vit DANS le bandeau collant `.rte__bar` (flèches + « Modifier
  // le texte » au-dessus des puces) — sans ce plancher, un popover haut (max-height 60vh,
  // repli du bloc ci-dessus quand rien ne tient dessous) s'ouvre « au-dessus de l'ancre »
  // en pratique AU-DESSUS DU BANDEAU ENTIER, recouvrant les flèches et « Modifier le
  // texte » restés visibles derrière le voile — mesuré (Playwright, 412×915, popover
  // Section) : top calculé à 190px alors que `.rte__bar` descend jusqu'à ~372px. Jamais
  // moins que le bas du bandeau + la même marge : le popover peut toujours s'ouvrir plus
  // bas (couvrant l'éditeur, déjà assombri par le voile), jamais par-dessus des contrôles
  // qui restent, eux, cliquables au-dessus du voile. `closest` renvoie `null` hors de cet
  // écran (ex. tools/mdedit, qui ne monte pas `.rte__bar`) : repli sur le comportement
  // existant, inchangé.
  const stickyBar = anchorEl.closest('.rte__bar')
  const minTop = stickyBar
    ? stickyBar.getBoundingClientRect().bottom + MENU_POPOVER_MARGIN
    : MENU_POPOVER_MARGIN
  const clampedTop = Math.max(minTop, top)
  popover.style.top = `${clampedTop}px`
  // Le plancher ci-dessus peut repousser le popover plus bas que ce que le calcul de
  // hauteur (`popoverHeight`, mesuré AVANT ce plancher) avait prévu : sans correction, un
  // popover à 9 items (~60vh) plaqué juste sous un bandeau haut déborderait sous la
  // fenêtre, ses derniers items devenant inatteignables — exactement le défaut que le
  // filet « hauteur » plus haut dans ce fichier documente déjà pour un AUTRE cas
  // (aucun espace ni dessus ni dessous). `max-height` (pas `height`) : un popover court
  // (peu d'items) doit rester à sa hauteur naturelle, `overflow-y: auto` (CSS de base,
  // ensureMenuPopoverStyles) absorbe le reste si besoin.
  popover.style.maxHeight = `${Math.max(0, window.innerHeight - clampedTop - MENU_POPOVER_MARGIN)}px`

  function close() {
    document.removeEventListener('keydown', onKeydown)
    scrim.removeEventListener('click', onScrimClick)
    popover.remove()
    scrim.remove()
    // Fermeture PÉRIMÉE (retour de revue) : `onSelect` peut lui-même ouvrir
    // un second popover sur LE MÊME anchorEl avant de rendre la main ici (cf.
    // openImageActionsMenu — choisir la 1re entrée ouvre le sous-popover de type
    // DEPUIS le callback onSelect du popover principal). Ce second `openMenuPopover`
    // a déjà appelé `closeOpenMenuPopover?.()` (qui exécute CE close() une première
    // fois, légitimement) puis a posé son propre `aria-expanded="true"` et son propre
    // `closeOpenMenuPopover`. Le retour au handler de clic du popover principal
    // rappelle ensuite ce même `close()` une seconde fois — stale, puisqu'un autre
    // popover a pris sa place sur cet anchor entre-temps. Sans ce garde, cet appel
    // périmé écraserait `aria-expanded="true"` (posé par le second popover, toujours
    // affiché) par un `"false"` mensonger. Le nettoyage DOM/écouteurs ci-dessus reste
    // sûr à rejouer même périmé (ne touche que les éléments PROPRES à cette fermeture,
    // déjà retirés) — seul l'état partagé de l'ancre doit être protégé.
    if (closeOpenMenuPopover === close) {
      anchorEl.setAttribute('aria-expanded', 'false')
      closeOpenMenuPopover = null
    }
  }
  closeOpenMenuPopover = close

  function onScrimClick() {
    close()
    anchorEl.focus()
  }
  scrim.addEventListener('click', onScrimClick)

  function focusAt(index) {
    const target = buttons[index]
    if (!target) return
    for (const b of buttons) b.tabIndex = -1
    target.tabIndex = 0
    target.focus()
  }

  // Navigation clavier : flèches haut/bas déplacent le focus entre les items
  // (ordre du DOM, groupes ignorés — même patron qu'un menu natif), Entrée
  // déclenche l'item focus (jsdom ne synthétise pas de clic natif sur Entrée,
  // d'où l'appel explicite à `.click()`), Échap ferme depuis n'importe où.
  //
  // Tab/Shift+Tab (revue) : AVANT ce correctif, Tab n'était pas géré
  // du tout — le focus sortait du popover vers le reste de la page pendant que le scrim
  // bloquait tout, laissant le clavier bloqué sans retour visuel. Piège clavier simple :
  // Tab/Shift+Tab CYCLE entre les items (boucle aux extrémités), même patron que
  // ArrowDown/ArrowUp ci-dessous plutôt qu'une mécanique séparée. Traité AVANT le
  // `idx === -1` : si le focus a par extraordinaire déjà quitté un item du popover
  // (aucun cas connu aujourd'hui, le scrim bloque tout clic hors popover), Tab ramène
  // quand même sur le premier item plutôt que de ne rien faire.
  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      anchorEl.focus()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const idxTab = buttons.indexOf(document.activeElement)
      if (idxTab === -1) {
        focusAt(0)
      } else if (event.shiftKey) {
        focusAt((idxTab - 1 + buttons.length) % buttons.length)
      } else {
        focusAt((idxTab + 1) % buttons.length)
      }
      return
    }
    const idx = buttons.indexOf(document.activeElement)
    if (idx === -1) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt((idx + 1) % buttons.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt((idx - 1 + buttons.length) % buttons.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      buttons[idx].click()
    }
  }
  document.addEventListener('keydown', onKeydown)

  focusAt(0)
}

// Extrait la balise EN `{tag}` en fin de ligne, ou `undefined` si la ligne n'en
// porte pas — MÊME regex que celle qu'`updateToolbarActive` utilise déjà pour
// l'indicateur textuel `.cm-retag-ref-type` (« type de la ligne courante » à
// côté de l'aide-mémoire), pas une règle réinventée pour ce correctif (retour
// terrain). Sert au popover Aide-mémoire ci-dessous : ses valeurs de menu
// SONT ces balises EN (cf. referenceMenuItems), aucune retraduction nécessaire —
// contrairement à Section, qui a sa propre extraction (currentSectionKind,
// juste en dessous) : une balise de référence n'est jamais suivie d'un compteur
// de répétition `{×N}` (notion propre aux sections de travail), l'ancrage en fin
// de ligne y est donc sûr.
const LINE_TAG_RE = /\{([a-z0-9-]+)\}\s*$/i
function lineTagOf(lineText) {
  return LINE_TAG_RE.exec(lineText)?.[1]
}

// Kind de section actuellement actif sur la ligne (à vérifier par l'appelant AVANT
// d'appeler cette fonction — lineType(lineText) === 'section' — elle ne le refait
// pas). Un `## Titre` SANS balise est le kind implicite DEFAULT_KIND (pelote) :
// `retagLine` ne l'écrit jamais explicitement (cf. md-retag.js, `opts.kind !==
// DEFAULT_KIND`), donc son absence EST la valeur, pas un cas « aucun kind ».
//
// NE PEUT PAS réutiliser `lineTagOf` tel quel : un titre de section peut porter un
// compteur de répétition `{×N}` APRÈS le kind (`## Corps {body} {×3}` — lu par
// stripMarkup, ET par le widget de la ligne plus haut dans ce fichier, même si le
// menu Section n'écrit lui-même jamais ce compteur aujourd'hui). `lineTagOf`, ancré
// en fin de ligne, y lirait `×3` (qui échoue silencieusement son propre motif
// `[a-z0-9-]+`) et ne trouverait donc AUCUNE balise, marquant à tort « Générique »
// sur une ligne qui est en réalité « Corps » — pire qu'aucune marque. Même ORDRE que
// `stripMarkup` (md-retag.js) : `parseSectionRepeat` détache d'abord le compteur de
// répétition, PUIS le kind est lu sur ce qui reste.
function currentSectionKind(lineText) {
  const h2 = H2_PREFIXE_RE.exec(lineText)
  if (!h2) return DEFAULT_KIND
  const sr = parseSectionRepeat(lineText.slice(h2[0].length))
  const tag = LINE_TAG_RE.exec(sr.title)?.[1]
  return tag ? kindToFr(tag) : DEFAULT_KIND
}

// Libellé TRADUIT d'un kind de section (clé FR, ex. "corps") — pour l'indicateur « à
// côté » de la barre (.cm-retag-ref-type, updateToolbarActive plus bas), qui doit
// afficher le MÊME texte que celui déjà coché dans le popover Section, jamais la clé
// brute. `labels.sections` est la forme GROUPÉE (groupedSectionKinds) déjà utilisée
// pour peupler ce popover — cherchée ici plutôt que retraduite séparément : une seule
// source de vérité pour « comment un kind s'affiche dans cette langue ». Repli sur la
// clé elle-même si `labels.sections` est absent ou ne la contient pas (jamais de trou
// silencieux, même contrat que le repli `labels?.[tag] || tag` déjà en place pour
// l'Aide-mémoire un peu plus bas).
function sectionKindLabel(labels, kind) {
  for (const group of labels?.sections || []) {
    const found = group.items?.find((it) => it.value === kind)
    if (found) return found.label
  }
  return kind
}

// `labels` : propre à CET éditeur (cf. createCmEditor), pour que le mini-dialogue
// du sous-choix Compteur (openNumberPrompt/openNumberFormPrompt) affiche les bons
// libellés — même exigence de câblage que buildCounterWidgets/editCounterOnLine
// ci-dessus.
function wireToolbar(toolbarEl, view, labels, getSizeLabels) {
  toolbarEl.querySelectorAll('button[data-retag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyRetag(view, btn.dataset.retag)
    })
  })

  // Compteur (puce + popover, cf. openMenuPopover/counterMenuItems plus
  // haut, remplace le <select> à sous-choix Répétition/Cadence — même patron que
  // Section/Aide-mémoire ci-dessous). Répétition ouvre la carte à 1 champ
  // (openNumberPrompt, INCHANGÉ) ; Cadence ouvre la carte fusionnée à 2 champs
  // (openNumberFormPrompt) au lieu des 2 dialogues séquentiels d'avant.
  // Le popover se ferme SEUL avant l'ouverture de la carte (cf. openMenuPopover :
  // onSelect PUIS close(), et le premier `await` de la carte survient APRÈS son
  // propre appendChild synchrone) — jamais deux calques superposés.
  const counter = toolbarEl.querySelector('.cm-retag-counter')
  counter.addEventListener('click', () => {
    openMenuPopover(counter, counterMenuItems(labels), async (kind) => {
      if (kind === 'rep') {
        const times = await openNumberPrompt(labels.prompt.repeatTimes, undefined, labels.prompt.cancel)
        if (times !== null) applyRetag(view, 'compteur-rep', { times })
      } else if (kind === 'cadence') {
        const values = await openNumberFormPrompt(
          [
            { label: labels.prompt.cadenceEvery, fallback: undefined },
            { label: labels.prompt.cadenceTimes, fallback: undefined },
          ],
          labels.prompt.cancel
        )
        if (values === null) return
        const [every, times] = values
        applyRetag(view, 'compteur-cadence', { every, times })
      }
    })
  })

  // Section (puce + popover, cf. openMenuPopover/sectionMenuItems plus haut,
  // remplace le <select> à sous-choix Générique/kind). `labels.sections` est lu à
  // l'OUVERTURE (pas figé à la construction de la barre), comme l'ancien <select> qui
  // lisait aussi ses <option> à chaque ouverture native — sans effet pratique
  // aujourd'hui (labels ne change pas après le montage), mais pas de nouvelle
  // supposition introduite.
  const section = toolbarEl.querySelector('.cm-retag-section')
  section.addEventListener('click', () => {
    // Marque de sélection (retour terrain) : détermine le kind actif de
    // la ligne du curseur exactement comme `updateToolbarActive` détermine le
    // type actif de la puce fermée (`lineType(lineText)`), réutilisé plutôt que
    // réinventé. Toujours une VALEUR concrète (jamais `undefined`) : Section porte
    // la notion de sélection dans tous les cas (liste à choix unique), `null`
    // signifiant « rien d'actif en ce moment » — distinct d'`undefined`, réservé à
    // Compteur plus haut (« pas de notion de sélection du tout », cf. son propre
    // appel d'openMenuPopover, sans 4e argument).
    const lineText = view.state.doc.lineAt(view.state.selection.main.head).text
    const selectedKind = lineType(lineText) === 'section' ? currentSectionKind(lineText) : null
    openMenuPopover(
      section,
      sectionMenuItems(labels.sections),
      (kind) => {
        applyRetag(view, 'section', { kind })
      },
      selectedKind
    )
  })

  // Aide mémoire (puce + popover, remplace le <select>). Même routage qu'avant :
  // « Diagramme » est un kind de SECTION ({chart}), pas une balise de référence ; les
  // 8 autres vont à `reference`, avec `sizeLabels` lu au moment du choix (cf. wireToolbar
  // avant migration, même contrat pour le sous-item « Tailles »).
  const ref = toolbarEl.querySelector('.cm-retag-ref')
  ref.addEventListener('click', () => {
    // Marque de sélection (retour terrain) : les valeurs du menu Aide-
    // mémoire SONT déjà les balises EN (referenceMenuItems), donc `lineTagOf`
    // suffit — pas de retraduction comme pour Section. Toujours une VALEUR
    // concrète passée à openMenuPopover (jamais `undefined`, cf. commentaire
    // Section ci-dessus pour la distinction avec Compteur) : `null` si la ligne
    // n'est pas de type `reference`, OU si elle l'est mais sans balise à relire —
    // même limite assumée que l'indicateur `.cm-retag-ref-type` existant, qui
    // affiche déjà rien dans ce cas (ex. `## Fil` hérité, TITRE RÉSERVÉ sans
    // balise explicite : `reference` pour `lineType`, mais `lineTagOf` n'y trouve
    // rien à lire). Le `?? null` couvre ce second cas : `lineTagOf` peut renvoyer
    // `undefined`, qu'il ne faut PAS laisser remonter tel quel ici.
    const lineText = view.state.doc.lineAt(view.state.selection.main.head).text
    const selectedTag = lineType(lineText) === 'reference' ? (lineTagOf(lineText) ?? null) : null
    openMenuPopover(
      ref,
      referenceMenuItems(labels),
      (tag) => {
        if (tag === 'diagramme') applyRetag(view, 'section', { kind: 'diagramme' })
        else applyRetag(view, 'reference', { tag, sizeLabels: getSizeLabels() })
      },
      selectedTag
    )
  })
}

// État actif de la barre (façon Word) : surligne l'affordance correspondant au
// balisage de la LIGNE du curseur (lineType). Compteur/Section/Référence sont des
// puces à popover (retagMenuBtn) : elles n'ont pas de `.value` à lire, leur état
// actif est donc une CLASSE, posée/retirée ici comme pour tout le reste de la
// barre. Sélection multi-lignes → on prend la ligne de tête.
// Pas d'entrée `image` : le bouton de re-balisage manuel des
// images a été retiré (elles restent parsées/rendues, cf. widgets plus haut) ; leur
// affordance « sélectionnée » vit désormais sur la LIGNE elle-même
// (`cm-image-line-selected`, cf. buildDecorations), pas dans cette barre.
// Pas d'entrée `sous-titre` non plus, et pour une raison différente : aucun
// contrôle de la barre ne correspond à un sous-titre `###`, et allumer « Texte » dessus
// serait un mensonge dans les deux sens — `stripMarkup` ne reconnaît pas les `###`
// (cf. selection-to-reference.js:96), donc taper « Texte » sur un `### Jeté` ne le
// changerait pas malgré le bouton actif. `TYPE_TO_SELECTOR['sous-titre']` est `undefined`,
// donc `updateToolbarActive` n'allume rien : c'est le comportement voulu, pas un oubli.
const TYPE_TO_SELECTOR = {
  rang: 'button[data-retag="rang"]',
  note: 'button[data-retag="note"]',
  section: '.cm-retag-section',
  texte: 'button[data-retag="texte"]',
  compteur: '.cm-retag-counter',
  reference: '.cm-retag-ref',
}

function updateToolbarActive(toolbarEl, view, labels) {
  // `aria-pressed` : uniquement les VRAIS boutons bascule (data-retag — rang/note/texte).
  // Section/Aide-mémoire sont devenus des <button> aussi (retagMenuBtn), et Compteur
  // s'y est ajouté : ce sont des déclencheurs de MENU — openMenuPopover leur pose déjà
  // aria-haspopup/aria-expanded. Poser aria-pressed dessus en plus superposerait deux
  // sémantiques contradictoires (bascule ET menu) sur le même élément ; seule la classe
  // `is-active` (habillage visuel) leur reste, comme du temps des <select> qui n'avaient
  // jamais aria-pressed non plus.
  for (const el of toolbarEl.querySelectorAll('.is-active')) {
    el.classList.remove('is-active')
    if (el.tagName === 'BUTTON' && el.hasAttribute('data-retag')) el.removeAttribute('aria-pressed')
  }
  const lineText = view.state.doc.lineAt(view.state.selection.main.head).text
  const type = lineType(lineText)
  const el = TYPE_TO_SELECTOR[type] && toolbarEl.querySelector(TYPE_TO_SELECTOR[type])
  if (el) {
    el.classList.add('is-active')
    if (el.tagName === 'BUTTON' && el.hasAttribute('data-retag')) el.setAttribute('aria-pressed', 'true')
  }
  // Indicateur « à côté » : type de la ligne courante — Aide-mémoire seul y affiche
  // sa balise précise, plus fine que le libellé générique déjà visible sous l'icône
  // de sa puce. Note n'y figure PLUS (retour terrain suivant : le mot affiché était
  // strictement identique au libellé déjà visible sous l'icône de la puce Note
  // active — même défaut que Texte avait, cf. ci-dessous). Section n'y figure pas
  // non plus (retour terrain précédent : « la chips qui rappelle la section, je la
  // voulais dans le texte lui-même, pas dans la barre d'outil » — cf.
  // SectionKindWidget/addLineMaskDecorations, même patron que le chip Compteur).
  // Texte non plus : son libellé est identique à celui déjà affiché sous l'icône T
  // de la puce active juste à côté, l'indicateur n'ajoute aucune information.
  // Étape reste exclue (déjà symbolisée par la case à cocher de la ligne).
  const refType = toolbarEl.querySelector('.cm-retag-ref-type')
  if (refType) {
    let text = ''
    if (type === 'reference') {
      const tag = lineTagOf(lineText)
      text = tag ? labels?.[tag] || tag : ''
    }
    refType.textContent = text
  }
}

/**
 * Monte un éditeur CodeMirror 6 dans `host`, avec sa barre de requalification.
 * @param {HTMLElement} host
 * @param {{ value?: string, onChange?: (md: string) => void, labels?: object, locale?: string, sizeLabels?: string[], toolbarHost?: HTMLElement }} [opts]
 *   `toolbarHost` : élément recevant la barre de requalification, à la place de
 *   `host`. Repli `|| host` (comportement historique) si absent — INDISPENSABLE :
 *   le banc de développement (`yarn mdedit`, tools/mdedit/main.js) appelle
 *   `createCmEditor` sans cette option, et tools/mdedit/styles.css suppose la
 *   toolbar enfant DIRECT de `host`. Utilisé côté app par ReaderTextEditor.vue,
 *   qui fusionne ses deux bandeaux collants (flèches + toolbar) en un seul
 *   conteneur `.rte__bar` : la toolbar doit alors être montée DANS ce
 *   conteneur, pas dans `host` (qui ne porte plus que l'éditeur lui-même).
 *   `labels` : libellés traduits de TOUTE la barre (cf. FR_TOOLBAR_LABELS pour
 *   la forme attendue — step/note/text/counterRep/counterCadence/section/
 *   reference/chart/les 7 tags de référence/les 4 aria-label/editCounterTitle
 *   (title du chip compteur en vue enrichie)), + soit `sections` déjà groupé
 *   (forme groupedSectionKinds), soit `kinds`/`families` (recalculé ici avec
 *   `locale`). Absent → repli FR complet (contrat du banc tools/mdedit, qui
 *   monte l'éditeur hors i18n). `labels.prompt` (optionnel) : libellés du
 *   mini-dialogue de saisie numérique (cadenceEvery/cadenceTimes/repeatTimes +
 *   cancel), cf. FR_PROMPT_LABELS pour la forme attendue — repli FR par clé
 *   manquante (comme le reste de `labels`), pas par objet entier.
 *   `sizeLabels` : tailles du patron (`reader.sizeLabels`), défaut `[]` —
 *   transmises à `applyRetag(view, 'reference', opts)` pour le bouton
 *   « Aide mémoire > Tailles ». État mutable interne, cf. `setSizeLabels`.
 * @returns {{ getValue: () => string, setValue: (md: string) => void, toggleMarkup: () => boolean, setMarkupHidden: (hidden: boolean) => void, setKeyboard: (on: boolean) => boolean, setImages: (map: object|null) => void, getSizeLabels: () => string[], setSizeLabels: (next: string[]) => void, view: EditorView, toolbar: HTMLElement }}
 */
export function createCmEditor(host, opts = {}) {
  const { value = '', onChange, onSelectionLine, onCursorMoved } = opts

  // Tailles du patron (`reader.sizeLabels`), necessaires au bouton « Aide memoire > Tailles »
  // pour emettre une table au bon nombre de colonnes. Etat MUTABLE et non une simple option
  // figee : le champ « Tailles » de l'ecran de correction est editable a chaud, et l'editeur
  // n'est monte qu'une fois (contrat `value: props.md` au montage seulement).
  let sizeLabels = Array.isArray(opts.sizeLabels) ? [...opts.sizeLabels] : []

  // Menu contextuel image (cf. openImageActionsMenu) : `null` = comportement d'origine
  // (selectImageLine), verrouillé par tests/unit/cm-editor-image-select.spec.js et par
  // tools/mdedit/main.js (qui n'a jamais ce câblage — banc hors écran de correction).
  const imageActions = opts.imageActions || null

  const rawLabels = opts.labels || {}
  const locale = opts.locale || 'fr'
  const sections =
    rawLabels.sections ||
    groupedSectionKinds(
      rawLabels.kinds ? { kinds: rawLabels.kinds, families: rawLabels.families } : FR_KIND_LABELS,
      locale,
      { exclude: SECTION_EXCLUDE }
    )
  // `prompt` fusionné à part (repli par CLÉ, cf. FR_PROMPT_LABELS) : un appelant
  // qui ne fournit qu'une partie des libellés du mini-dialogue ne doit jamais
  // se retrouver avec `undefined` sur les clés omises (même contrat que le
  // repli FR du reste de la barre).
  const labels = {
    ...FR_TOOLBAR_LABELS,
    ...rawLabels,
    sections,
    prompt: { ...FR_PROMPT_LABELS, ...rawLabels.prompt },
  }

  const toolbarWrap = document.createElement('div')
  toolbarWrap.innerHTML = buildToolbarHtml(labels)
  const toolbar = toolbarWrap.firstElementChild
  // cf. JSDoc ci-dessus : repli sur `host` obligatoire pour le banc `yarn mdedit`.
  const toolbarHost = opts.toolbarHost || host
  toolbarHost.appendChild(toolbar)

  const editorHost = document.createElement('div')
  host.appendChild(editorHost)

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && onChange) onChange(update.state.doc.toString())
    // Bouton actif façon Word : suit le déplacement du curseur et les éditions.
    if (update.selectionSet || update.docChanged) updateToolbarActive(toolbar, update.view, labels)
    // Pastille diagramme (écran de correction) : `!update.docChanged`, même garde
    // et même raison que `recheckCaretMargin` plus bas — le curseur avance aussi en tapant
    // (selectionSet ET docChanged vrais ensemble), et cette pastille ouvre la bande
    // « Diagrammes » + y défile (toggleCharts, CorrectionView.vue) : sans ce garde-fou, une
    // frappe dans une section chart-éligible rouvrirait/redéfilerait la bande à CHAQUE
    // caractère, y compris après que la travailleuse l'ait refermée à la main.
    if (update.selectionSet && !update.docChanged && onSelectionLine) {
      onSelectionLine(update.state.doc.lineAt(update.state.selection.main.head).number)
    }
    // Position BRUTE du curseur, SANS le garde-fou `!docChanged` ci-dessus (retour terrain
    // 27/08/2026, insertion d'une image de galerie à l'endroit du curseur) : contrairement à
    // la pastille diagramme, ce signal doit rester à jour PENDANT la frappe (taper un
    // nouveau rang déplace le curseur par docChanged, jamais par un selectionSet isolé) — le
    // consommateur (CorrectionView.vue) ne fait qu'y lire une ligne, aucun effet de bord
    // coûteux (pas de défilement/dépli) qui justifierait la même restriction.
    if ((update.selectionSet || update.docChanged) && onCursorMoved) {
      onCursorMoved(update.state.doc.lineAt(update.state.selection.main.head).number)
    }
    // Rangée de tableau sous le curseur : ici et pas dans une décoration,
    // cf. le commentaire de markCursorRow. `viewportChanged`/`hideMarkupChanged` en
    // plus de la sélection : un widget re-rendu (défilement, bascule de mode) revient
    // sans la classe.
    if (update.selectionSet || update.docChanged || update.viewportChanged || hideMarkupChanged(update)) {
      markCursorRow(update.view)
    }
    // Retour terrain (écran de correction) : un clic sur une AUTRE ligne (ou une flèche
    // haut/bas qui change de ligne) déplace la sélection SANS jamais redonner le focus au
    // `[contenteditable]` (il l'a déjà) — `keyboard-avoidance.js` (installé globalement,
    // écouteur `focusin`/`focusout`) ne revérifie donc JAMAIS la ligne nouvellement visée
    // après le premier focus. Mesuré : le bandeau collant de cet écran (flèches + barre de
    // requalification, `.rte__bar`) pouvait recouvrir la ligne tout juste sélectionnée,
    // sa hauteur variant elle-même selon la ligne (indicateur de type rempli ou non, cf.
    // updateToolbarActive plus haut). `!update.docChanged` : ne rejoue PAS ce calcul à
    // chaque frappe (le curseur avance aussi la sélection en tapant) — seul un vrai
    // déplacement de curseur (clic, flèche) doit re-garantir la marge ; `docChanged` reste
    // couvert par le seuil `Math.abs(delta) < 4` de `scrollCaretIntoView` de toute façon,
    // mais l'exclure évite un appel inutile à chaque caractère tapé.
    if (update.selectionSet && !update.docChanged) {
      requestAnimationFrame(() => recheckCaretMargin(update.view.contentDOM))
    }
  })

  const markupMaskPlugin = createMarkupMaskPlugin(labels, imageActions)
  const counterWidgetPlugin = createCounterWidgetPlugin(labels)

  const state = EditorState.create({
    doc: value,
    // lineWrapping : les lignes de rang/note longues reviennent à la ligne au lieu
    // de scroller horizontalement — indispensable sur une largeur téléphone (responsive).
    extensions: [
      hideMarkup,
      imagesField,
      EditorView.lineWrapping,
      lineTypePlugin,
      counterWidgetPlugin,
      markupMaskPlugin,
      createMaskAtomicRanges(markupMaskPlugin),
      // Tableaux. `tableBlocksField` doit venir APRÈS `hideMarkup`
      // (lu par tableDecorations), et le facet reçoit ici une VALEUR (via
      // .compute), pas une fonction : c'est la condition pour qu'une décoration
      // de bloc soit acceptée — cf. le commentaire de section de TableWidget.
      tableBlocksField,
      EditorView.decorations.compute([tableBlocksField, hideMarkup], tableDecorations),
      tableAtomicRanges,
      // Nom accessible de la zone d'édition (défaut mesuré : CodeMirror pose
      // role="textbox" sur .cm-content SANS aria-label — un lecteur d'écran
      // annonce « zone de texte », sans dire laquelle). Entrée STATIQUE (pas de
      // Compartment : rien ici ne change après le montage) du même facet
      // `contentAttributes` que keyboardAttrsCompartment juste en dessous — un
      // facet FUSIONNE ses entrées, donc cette valeur cohabite avec `inputmode`
      // et SURVIT à sa reconfiguration par setKeyboard (cf. tests/unit/
      // cm-editor-keyboard.spec.js). Un Compartment remplace ce qu'IL contient,
      // jamais ce qu'apportent les autres entrées du facet.
      EditorView.contentAttributes.of({ 'aria-label': labels.ariaEditor }),
      // Défaut : pas de clavier virtuel au focus (décision produit) —
      // cf. commentaire de setKeyboard ci-dessus pour le détail du Compartment.
      keyboardAttrsCompartment.of(EditorView.contentAttributes.of(keyboardContentAttrs(false))),
      // Fallback device (non actif par défaut) : posé à `true`
      // = comportement actuel inchangé (editable) tant que setKeyboardEditableFallback
      // n'est pas appelé.
      editableCompartment.of(EditorView.editable.of(true)),
      updateListener,
      // Aucun keymap n'était installé (bug confirmé, cf. commit) : Entrée/Retour-arrière
      // tombaient sur le comportement natif contentEditable, qui désynchronise la
      // sélection modèle CM6 à la frontière des widgets non-éditables (RowCheckWidget en
      // vue enrichie) — coupe/jointure de ligne au mauvais endroit (voire no-op total).
      // Depuis le 06/09, deleteMarkupBackward passe AVANT
      // defaultKeymap (premier binding du tableau = essayé en premier) : même
      // transaction que le chemin par défaut sur la 6.43.6, mais indépendant de la
      // résolution du curseur au bord du widget que la 6.43.7 a fragilisée — cf.
      // commentaire de deleteMarkupBackward et celui d'épinglage en tête de fichier.
      keymap.of([{ key: 'Backspace', run: deleteMarkupBackward }, ...defaultKeymap]),
    ],
  })

  const view = new EditorView({ state, parent: editorHost })
  // Le premier rendu ne passe par aucun `update` : la rangée du curseur initial doit
  // être marquée à la main (cas d'un patron rouvert avec le curseur dans un tableau).
  markCursorRow(view)

  // getSizeLabels/setSizeLabels sont déclarées ici (avant wireToolbar) pour que
  // CE SOIT LA MÊME fonction qui est passée à wireToolbar et exposée dans l'objet
  // retourné plus bas — une seule façon de lire `sizeLabels`, donc une seule
  // implémentation de la copie défensive (revue : le callback transmis à
  // wireToolbar renvoyait la référence interne brute, contournant la copie de
  // getSizeLabels et laissant fuir l'état mutable jusqu'à applyRetag/retagSelection).
  function getSizeLabels() {
    return [...sizeLabels]
  }
  function setSizeLabels(next) {
    sizeLabels = Array.isArray(next) ? [...next] : []
  }

  wireToolbar(toolbar, view, labels, getSizeLabels)
  updateToolbarActive(toolbar, view, labels) // état initial (ligne 1)

  function getValue() {
    return view.state.doc.toString()
  }

  function setValue(md) {
    const next = String(md ?? '')
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    })
  }

  // Masquage réel : bascule le StateField hideMarkup et renvoie
  // le nouvel état pour que l'appelant (main.js) mette à jour le libellé du
  // bouton (« Voir le balisage » quand enrichi ↔ « Vue enrichie » quand brut).
  function toggleMarkup() {
    const next = !view.state.field(hideMarkup)
    view.dispatch({ effects: setHideMarkupEffect.of(next) })
    return next
  }

  // Pose l'état hideMarkup de façon DÉTERMINISTE (vs toggleMarkup qui inverse) :
  // utile pour piloter le mode depuis l'UI (« Modifier le texte », ReaderTextEditor).
  function setMarkupHidden(hidden) {
    view.dispatch({ effects: setHideMarkupEffect.of(!!hidden) })
  }

  // Injecte/remplace la map basename → URL locale (feature « images inline »,
  // main.js après chargement d'un dossier `_images/`). Passer `null`/absent
  // revient au placeholder texte partout. Réactif : dispatch l'effet, le
  // StateField imagesField se met à jour, markupMaskPlugin recompute via
  // imagesChanged().
  function setImages(map) {
    view.dispatch({ effects: setImagesEffect.of(map || null) })
  }

  // Clavier logiciel : bascule inputmode="text"/"none" sur ce `view`
  // précis (setKeyboard/setKeyboardEditableFallback module-level prennent
  // `view` en paramètre — plusieurs éditeurs peuvent partager les mêmes
  // Compartments module-scoped, chacun avec son propre état de facette).
  function boundSetKeyboard(on) {
    return setKeyboard(view, on)
  }
  // Fallback device : PAS branché sur le bouton (ReaderTextEditor.vue
  // appelle boundSetKeyboard), exposé pour rester testable/activable sans
  // redéployer de nouvelle fonction si le test device (Pixel 7) montre que la
  // voie inputmode ne suffit pas.
  function boundSetKeyboardEditableFallback(on) {
    return setKeyboardEditableFallback(view, on)
  }

  return {
    getValue,
    setValue,
    toggleMarkup,
    setMarkupHidden,
    setImages,
    setKeyboard: boundSetKeyboard,
    setKeyboardEditableFallback: boundSetKeyboardEditableFallback,
    getSizeLabels,
    setSizeLabels,
    view,
    toolbar,
  }
}

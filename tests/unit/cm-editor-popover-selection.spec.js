// (retour terrain Nexus 7) — deuxième root cause : en rouvrant le
// popover Section/Aide-mémoire sur une ligne déjà taguée, aucun des items n'indiquait lequel
// était actuellement actif pour cette ligne (les 17 items de Section étaient rendus
// strictement identiques). Ce fichier exerce le câblage RÉEL (wireToolbar), pas seulement le
// mécanisme générique d'openMenuPopover (cf. cm-menu-popover.spec.js pour ce niveau-là) :
// montage complet de l'éditeur, positionnement du curseur sur une ligne taguée, ouverture du
// popover, puis vérification que l'item correspondant porte la marque de sélection.
import { describe, it, expect, afterEach } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'
import fr from '@/i18n/fr.json'

function mount(value, opts = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value, ...opts })
  return { host, editor }
}

// Place le curseur (sélection vide) au début de la ligne `lineNumber` (1-based) — même
// geste que chooseReference (cm-editor-toolbar-reference.spec.js), pour que
// updateToolbarActive-comme-logique (lineType de la ligne du curseur) porte sur la bonne
// ligne avant l'ouverture du popover.
function placeCursor(editor, lineNumber) {
  const { state, dispatch } = editor.view
  const at = state.doc.line(lineNumber).from
  dispatch({ selection: { anchor: at, head: at } })
}

const items = () => [...document.querySelectorAll('.cm-menu-popover__item')]
const selectedItem = () => items().find((b) => b.classList.contains('cm-menu-popover__item--selected'))

afterEach(() => {
  // Même filet de sécurité que les autres suites cm-editor-* : un popover resté ouvert
  // fuirait vers le test suivant et fausserait items()/selectedItem().
  document.querySelectorAll('.cm-menu-popover, .cm-menu-popover-scrim').forEach((el) => el.remove())
})

describe('marque de sélection du popover Section (retour terrain)', () => {
  it('curseur sur une ligne déjà taguée « Manche » : l’item « Manche » est marqué à l’ouverture', () => {
    const { editor, host } = mount('## Manche {sleeve}\ncontenu')
    placeCursor(editor, 1)
    editor.toolbar.querySelector('.cm-retag-section').click()

    const active = selectedItem()
    expect(active, 'aucun item marqué comme sélectionné').toBeTruthy()
    expect(active.textContent).toBe(fr.reader.kind.manche)
    expect(active.getAttribute('role')).toBe('menuitemradio')
    expect(active.getAttribute('aria-checked')).toBe('true')

    // Tous les autres items restent non cochés, mais portent bien le même rôle radio
    // (liste à sélection unique, un seul actif à la fois).
    const others = items().filter((b) => b !== active)
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((b) => b.getAttribute('role') === 'menuitemradio')).toBe(true)
    expect(others.every((b) => b.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(others.every((b) => !b.classList.contains('cm-menu-popover__item--selected'))).toBe(true)
    host.remove()
  })

  it('curseur sur une ligne de section sans balise explicite : « Générique » (kind par défaut) est marqué', () => {
    // `## Titre` nu = kind implicite DEFAULT_KIND (pelote) — jamais écrit explicitement en
    // {kind} par retagLine (cf. md-retag.js), mais bien le kind ACTIF de cette ligne.
    const { editor, host } = mount('## Un titre nu\ncontenu')
    placeCursor(editor, 1)
    editor.toolbar.querySelector('.cm-retag-section').click()

    const active = selectedItem()
    expect(active).toBeTruthy()
    expect(active.textContent).toBe(fr.reader.kind.pelote)
    host.remove()
  })

  it('curseur sur une ligne sans type actif (texte simple) : aucun item marqué', () => {
    const { editor, host } = mount('Juste du texte, pas une section')
    placeCursor(editor, 1)
    editor.toolbar.querySelector('.cm-retag-section').click()

    expect(selectedItem()).toBeUndefined()
    // Le popover Section porte TOUJOURS la notion de sélection (liste à choix unique,
    // cf. JSDoc openMenuPopover) : role=menuitemradio même quand rien n'est actif — seul
    // aria-checked passe à "false" sur tout le monde. Ce n'est PAS le même état
    // qu'un popover sans notion de sélection du tout (Compteur, cf. plus bas), qui lui
    // garde role=menuitem.
    expect(items().every((b) => b.getAttribute('role') === 'menuitemradio')).toBe(true)
    expect(items().every((b) => b.getAttribute('aria-checked') === 'false')).toBe(true)
    host.remove()
  })

  // Root cause additionnelle trouvée en implémentant ce correctif (pas anticipée) :
  // un titre de section peut porter un compteur de répétition `{×N}` APRÈS le kind
  // (`## Corps {body} {×3}` — cf. stripMarkup/md-retag.js, et le widget de répétition de
  // section plus haut dans cm-editor.js, même si le menu Section n'écrit lui-même jamais
  // ce compteur aujourd'hui). Une extraction naïve du tag ancrée en fin de ligne y lirait
  // `×3` (qui échoue son propre motif [a-z0-9-]+) et ne trouverait AUCUNE balise,
  // marquant à tort « Générique » — pire qu'aucune marque, cf. currentSectionKind.
  it('curseur sur une section taguée ET porteuse d’un compteur de répétition {×N} : le kind reste lu correctement', () => {
    const { editor, host } = mount('## Corps {body} {×3}\ncontenu')
    placeCursor(editor, 1)
    editor.toolbar.querySelector('.cm-retag-section').click()

    const active = selectedItem()
    expect(active, 'aucun item marqué comme sélectionné').toBeTruthy()
    expect(active.textContent).toBe(fr.reader.kind.corps)
    host.remove()
  })

  // Régression (revue, familles « Parties d'accessoire ») : `corps` a
  // désormais families: ['vetement', 'accessoire'] (section-kinds.js) — groupedSectionKinds
  // l'émet donc DEUX FOIS dans la liste aplatie (une fois par groupe de famille), et
  // sectionMenuItems préserve les deux occurrences. Le test « Manche » ci-dessus ne peut
  // PAS attraper un bug de marquage-en-double : `manche` est mono-famille, il n'apparaît
  // qu'une fois. Idem le test « compteur de répétition » ci-dessus, qui utilise
  // `selectedItem()` (un `.find()` — ne voit que le PREMIER match, passerait même si un
  // second item « Corps » était coché ailleurs dans le menu).
  it('curseur sur une ligne taguée « Corps » (kind multi-familles) : un SEUL item « Corps » est marqué, malgré ses deux occurrences (vêtement + accessoire)', () => {
    const { editor, host } = mount('## Corps {body}\ncontenu')
    placeCursor(editor, 1)
    editor.toolbar.querySelector('.cm-retag-section').click()

    const corpsItems = items().filter((b) => b.textContent === fr.reader.kind.corps)
    // Si ce nombre tombe à 1, section-kinds.js a changé sous ce test (corps n'est plus
    // multi-familles) — le revoir plutôt que le faire taire.
    expect(corpsItems.length).toBe(2)

    const checkedCorps = corpsItems.filter((b) => b.getAttribute('aria-checked') === 'true')
    expect(checkedCorps.length).toBe(1)
    expect(checkedCorps[0].classList.contains('cm-menu-popover__item--selected')).toBe(true)

    // Invariant radiogroup à l'échelle du popover ENTIER, pas seulement parmi les items
    // « Corps » : un seul item coché, tous rôles.
    const allChecked = items().filter((b) => b.getAttribute('aria-checked') === 'true')
    expect(allChecked.length).toBe(1)
    host.remove()
  })
})

describe('marque de sélection du popover Aide-mémoire (retour terrain)', () => {
  it('curseur sur une ligne déjà taguée « Fil » : l’item « Fil » est marqué à l’ouverture', () => {
    const { editor, host } = mount('## Fil {yarn}\ncontenu')
    placeCursor(editor, 1)
    editor.toolbar.querySelector('.cm-retag-ref').click()

    const active = selectedItem()
    expect(active, 'aucun item marqué comme sélectionné').toBeTruthy()
    expect(active.textContent).toBe(fr.correction.toolbar.yarn)
    expect(active.getAttribute('role')).toBe('menuitemradio')
    expect(active.getAttribute('aria-checked')).toBe('true')
    host.remove()
  })

  it('curseur sur une ligne sans balise de référence active : aucun item marqué', () => {
    const { editor, host } = mount('Juste du texte, pas une référence')
    placeCursor(editor, 1)
    editor.toolbar.querySelector('.cm-retag-ref').click()

    expect(selectedItem()).toBeUndefined()
    // Même distinction que Section ci-dessus : role=menuitemradio persiste (Aide-mémoire
    // porte toujours la notion de sélection), seul aria-checked passe à "false" partout.
    expect(items().every((b) => b.getAttribute('role') === 'menuitemradio')).toBe(true)
    expect(items().every((b) => b.getAttribute('aria-checked') === 'false')).toBe(true)
    host.remove()
  })
})

// Constat (à vérifier, pas à supposer) : Compteur ouvre un sous-choix
// Répétition/Cadence — une ACTION qui débouche sur un formulaire de saisie, jamais un choix
// persistant relisible sur la ligne (contrairement au kind d'une section ou au tag d'un bloc
// référence). Il n'y a donc rien à marquer : ce test verrouille l'absence de toute
// sémantique de sélection sur ce popover, plutôt que de la deviner.
describe('popover Compteur — pas de notion de sélection courante', () => {
  it('ouvre Répétition/Cadence sans jamais poser role=menuitemradio/aria-checked/marque', () => {
    const { editor, host } = mount('- un rang')
    placeCursor(editor, 1)
    editor.toolbar.querySelector('.cm-retag-counter').click()

    const counterItems = items()
    expect(counterItems.length).toBe(2)
    expect(counterItems.every((b) => b.getAttribute('role') === 'menuitem')).toBe(true)
    expect(counterItems.every((b) => b.getAttribute('aria-checked') === null)).toBe(true)
    expect(counterItems.every((b) => !b.classList.contains('cm-menu-popover__item--selected'))).toBe(true)
    host.remove()
  })
})

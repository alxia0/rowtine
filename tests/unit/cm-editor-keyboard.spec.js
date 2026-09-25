// @vitest-environment jsdom
// Clavier : pas d'ouverture au tap + bouton afficher/masquer (décision
// produit) — taper dans le texte doit poser le CURSEUR sans ouvrir le clavier
// virtuel par défaut ; un bouton dédié (ReaderTextEditor.vue) appelle
// `editor.setKeyboard(on)` pour l'afficher/masquer à la demande.
//
// Ce que ce fichier PEUT prouver (jsdom) : l'API `setKeyboard` reconfigure
// bien le Compartment posé sur EditorView.contentAttributes — l'attribut DOM
// `inputmode` change, et SURVIT à un re-render (docChanged), ce qui est
// exactement le piège déjà identifié (un `contentDOM.inputMode = …`
// posé hors Compartment serait écrasé au prochain rendu CM6 — cf.
// commentaire de setKeyboard, cm-editor.js). L'édition programmatique
// (dispatch de changes/sélection, comme le fait le re-balisage) continue de
// fonctionner quel que soit l'état du clavier.
//
// Ce que ce fichier NE PEUT PAS prouver : que le clavier logiciel Android
// s'ouvre/se ferme RÉELLEMENT. jsdom n'a pas de clavier virtuel ; waydroid
// (E2E) non plus (item à plus haut risque, device-only). C'est un
// GATE DEVICE à valider sur Pixel 7.
import { describe, it, expect } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'

function mount(value = '## Corps\n- Rang 1\n') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value })
  return { host, editor }
}

describe('setKeyboard(on) — Compartment sur EditorView.contentAttributes', () => {
  it('défaut au montage : inputmode="none" (pas de clavier au focus)', () => {
    const { editor } = mount()
    expect(editor.view.contentDOM.getAttribute('inputmode')).toBe('none')
  })

  it('setKeyboard(true) : inputmode devient "text" et renvoie true', () => {
    const { editor } = mount()
    const result = editor.setKeyboard(true)
    expect(result).toBe(true)
    expect(editor.view.contentDOM.getAttribute('inputmode')).toBe('text')
  })

  it('setKeyboard(false) après setKeyboard(true) : revient à "none" et renvoie false', () => {
    const { editor } = mount()
    editor.setKeyboard(true)
    const result = editor.setKeyboard(false)
    expect(result).toBe(false)
    expect(editor.view.contentDOM.getAttribute('inputmode')).toBe('none')
  })

  it("survit à un re-render (docChanged) — c'est tout l'intérêt du Compartment sur " +
    "contentAttributes plutôt qu'une affectation contentDOM.inputMode brute", () => {
    const { editor } = mount()
    editor.setKeyboard(true)
    expect(editor.view.contentDOM.getAttribute('inputmode')).toBe('text')
    // Une frappe/édition quelconque déclenche un rebuild des décorations
    // (lineTypePlugin, markupMaskPlugin, etc.) — si l'attribut avait été posé
    // hors Compartment, il serait perdu ici.
    editor.view.dispatch({ changes: { from: 0, to: 0, insert: '- Rang 0\n' } })
    expect(editor.view.contentDOM.getAttribute('inputmode')).toBe('text')
  })

  it("n'empêche pas l'édition programmatique (dispatch de changes) quel que soit l'état", () => {
    const { editor } = mount('## Corps\n- Rang 1\n')
    editor.setKeyboard(false)
    editor.setValue('## Corps\n- Rang 1 modifié\n')
    expect(editor.getValue()).toBe('## Corps\n- Rang 1 modifié\n')

    editor.setKeyboard(true)
    editor.view.dispatch({ changes: { from: 0, to: 0, insert: 'x' } })
    expect(editor.getValue().startsWith('x')).toBe(true)
  })

  it('deux éditeurs montés en parallèle ont un état de clavier indépendant (Compartment module-scoped, état par view)', () => {
    const a = mount().editor
    const b = mount().editor
    a.setKeyboard(true)
    expect(a.view.contentDOM.getAttribute('inputmode')).toBe('text')
    expect(b.view.contentDOM.getAttribute('inputmode')).toBe('none')
  })
})

describe('setKeyboardEditableFallback(on) — fallback device, non câblé au bouton', () => {
  it("bascule contenteditable via le Compartment EditorView.editable, indépendamment de setKeyboard", () => {
    const { editor } = mount()
    expect(editor.view.contentDOM.getAttribute('contenteditable')).toBe('true')
    const result = editor.setKeyboardEditableFallback(false)
    expect(result).toBe(false)
    expect(editor.view.contentDOM.getAttribute('contenteditable')).toBe('false')
    editor.setKeyboardEditableFallback(true)
    expect(editor.view.contentDOM.getAttribute('contenteditable')).toBe('true')
  })

  it('contenteditable=false : le re-balisage programmatique (dispatch) fonctionne toujours', () => {
    const { editor } = mount('## Corps\n- Rang 1\n')
    editor.setKeyboardEditableFallback(false)
    editor.view.dispatch({ selection: { anchor: 0 }, changes: { from: 0, to: 0, insert: '' } })
    editor.setValue('## Corps\n- Rang 1 modifié\n')
    expect(editor.getValue()).toBe('## Corps\n- Rang 1 modifié\n')
  })
})

// Nom accessible de la zone d'édition (défaut mesuré : CodeMirror pose role="textbox"
// sur .cm-content SANS aria-label — un lecteur d'écran annonce « zone de texte », sans
// dire laquelle). `EditorView.contentAttributes` est un FACET qui FUSIONNE ses entrées :
// une valeur STATIQUE ajoutée à la liste d'extensions doit donc cohabiter avec
// `keyboardAttrsCompartment` (qui, lui, ne reconfigure QUE `inputmode`) et survivre à
// cette reconfiguration — ce n'est pas évident à la lecture, un Compartment remplaçant
// ce qu'IL contient, pas ce que d'autres entrées du même facet apportent.
describe("aria-label de la zone d'édition (EditorView.contentAttributes, entrée statique)", () => {
  it('après montage : aria-label renseigné sur contentDOM', () => {
    const { editor } = mount()
    expect(editor.view.contentDOM.getAttribute('aria-label')).toBeTruthy()
  })

  it("survit à setKeyboard(true), qui reconfigure le Compartment inputmode du même facet", () => {
    const { editor } = mount()
    const label = editor.view.contentDOM.getAttribute('aria-label')
    editor.setKeyboard(true)
    expect(editor.view.contentDOM.getAttribute('aria-label')).toBe(label)
  })

  it('survit à un re-render provoqué par un dispatch de changes (docChanged)', () => {
    const { editor } = mount()
    const label = editor.view.contentDOM.getAttribute('aria-label')
    editor.view.dispatch({ changes: { from: 0, to: 0, insert: '- Rang 0\n' } })
    expect(editor.view.contentDOM.getAttribute('aria-label')).toBe(label)
  })
})

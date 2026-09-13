// moveLineUp/moveLineDown (extraites de ReaderTextEditor.vue vers
// cm-editor/move-line.js pour être testables sans monter le composant Vue,
// cf. reader-text-editor.spec.js qui mocke createCmEditor et ne peut donc PAS
// exercer le comportement CM6 réel) échangent le TEXTE de la ligne courante
// avec sa voisine, au niveau document.
//
// Preuve explicite demandée qu'une ligne IMAGE (`![](img/x.png)`) se
// déplace comme n'importe quelle autre ligne : la plage atomique posée par
// maskAtomicRanges (cm-editor.js) sur les lignes image ne bloque PAS ce
// déplacement, car moveLineUp/Down ciblent la ligne par POSITION
// (doc.lineAt(selection.main.head)), jamais via une commande de curseur
// (cursorCharLeft/Right) soumise aux atomicRanges. On monte un VRAI éditeur
// CM6 (créé par createCmEditor, donc maskAtomicRanges actif) pour que ce test
// puisse effectivement détecter un blocage s'il existait.
import { describe, it, expect } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'
import { moveLineUp, moveLineDown } from '@/components/cm/move-line'

function mount(value) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return createCmEditor(host, { value })
}

function selectLine(editor, lineNumber) {
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.line(lineNumber).from } })
}

describe('moveLineDown/moveLineUp — ligne image', () => {
  it('moveLineDown déplace une ligne image APRÈS sa voisine (échange réel du texte)', () => {
    const editor = mount('- Rang 1\n![](img/x.png)\n- Rang 2\n')
    selectLine(editor, 2) // ligne image
    moveLineDown(editor.view)
    expect(editor.getValue()).toBe('- Rang 1\n- Rang 2\n![](img/x.png)\n')
  })

  it('moveLineUp déplace une ligne image AVANT sa voisine', () => {
    const editor = mount('- Rang 1\n- Rang 2\n![](img/x.png)\n')
    selectLine(editor, 3) // ligne image
    moveLineUp(editor.view)
    expect(editor.getValue()).toBe('- Rang 1\n![](img/x.png)\n- Rang 2\n')
  })

  it('no-op en haut de document (ligne image déjà en tête)', () => {
    const value = '![](img/x.png)\n- Rang 1\n'
    const editor = mount(value)
    selectLine(editor, 1)
    moveLineUp(editor.view)
    expect(editor.getValue()).toBe(value)
  })

  it('no-op en bas de document (ligne image déjà en dernier)', () => {
    // PAS de \n final : un \n de fin crée une 3e ligne (vide) dans le modèle
    // CM6 — la ligne 2 ne serait alors plus « la dernière » et le test ne
    // prouverait rien (piège vérifié en le laissant échouer une fois).
    const value = '- Rang 1\n![](img/x.png)'
    const editor = mount(value)
    selectLine(editor, 2)
    moveLineDown(editor.view)
    expect(editor.getValue()).toBe(value)
  })

  it('conserve un offset de curseur relatif après le déplacement (texte non-image, garde-fou de non-régression)', () => {
    const editor = mount('- Rang 1\n- Rang 2\n')
    // Curseur au milieu de "Rang 2" (offset 4 dans la ligne 2).
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.line(2).from + 4 } })
    moveLineUp(editor.view)
    expect(editor.getValue()).toBe('- Rang 2\n- Rang 1\n')
    expect(editor.view.state.selection.main.head).toBe(editor.view.state.doc.line(1).from + 4)
  })
})

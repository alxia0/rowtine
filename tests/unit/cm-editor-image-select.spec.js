// Retrait du bouton Image + tap-to-select — les widgets image
// (ImageThumbWidget/ImagePlaceholderWidget, cm-editor.js) sont posés en
// Decoration.replace ET rendus atomiques par maskAtomicRanges : un tap ne pose
// PAS le curseur nativement (CM6 ignore par défaut les événements DOM survenant
// dans un widget, cf. WidgetType.ignoreEvent). Ce lot dispatche donc
// EXPLICITEMENT une sélection sur le DÉBUT (`from`) de la ligne image tapée,
// pour que les flèches monter/descendre (ReaderTextEditor, moveLineUp/Down,
// cf. move-line.spec.js) puissent ensuite la déplacer.
//
// Piège écarté (point de vigilance) : la déco/widget est reconstruite à chaque
// docChanged (buildMarkupDecorations recalcule tout), mais CM6 ne réexécute
// toDOM() (donc ne réattache pas l'écouteur clic) que si `eq()` renvoie faux
// entre l'ancien et le nouveau widget. Sans inclure la position (`from`) dans
// eq(), un widget dont le CONTENU (src/alt) n'a pas changé mais dont la LIGNE
// a bougé (édition au-dessus) garderait son ancien nœud DOM avec une closure
// pointant sur l'ANCIENNE position → clic qui sélectionne le mauvais endroit.
// Le 3e test ci-dessous le prouve par mutation (déplace du texte au-dessus de
// l'image puis clique : doit atterrir sur la NOUVELLE position).
import { describe, it, expect } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'

function mount(value) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value })
  return { host, editor }
}

function click(node) {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('clic sur une image → sélection de sa ligne (tap-to-select)', () => {
  it('place le curseur sur le from de la ligne image cliquée (placeholder, sans imageMap)', () => {
    const value = '## Corps\n- Rang 1\n![](img/x.png)\n- Rang 2\n'
    const { host, editor } = mount(value)
    const imageLine = editor.view.state.doc.line(3)
    const node = host.querySelector('.cm-image-placeholder')
    expect(node).toBeTruthy()
    click(node)
    expect(editor.view.state.selection.main.head).toBe(imageLine.from)
  })

  it('place le curseur sur le from de la ligne image cliquée (vignette réelle, data: URL)', () => {
    const value = '## Corps\n- Rang 1\n![schéma](data:image/png;base64,AAA)\n- Rang 2\n'
    const { host, editor } = mount(value)
    const imageLine = editor.view.state.doc.line(3)
    const node = host.querySelector('.cm-image-thumb')
    expect(node).toBeTruthy()
    click(node)
    expect(editor.view.state.selection.main.head).toBe(imageLine.from)
  })

  it('après une édition qui décale la ligne image, le clic vise la NOUVELLE position (pas de closure périmée)', () => {
    const value = '## Corps\n- Rang 1\n![](img/x.png)\n- Rang 2\n'
    const { host, editor } = mount(value)
    // Insère une ligne au-dessus de l'image : décale sa position doc d'une ligne
    // ENTIÈRE sans changer son contenu (src/alt identiques) — c'est justement le
    // cas que `eq()` doit distinguer pour ne PAS réutiliser l'ancien nœud DOM.
    editor.view.dispatch({ changes: { from: 0, to: 0, insert: '- Rang 0\n' } })
    const imageLine = editor.view.state.doc.line(4)
    const node = host.querySelector('.cm-image-placeholder')
    click(node)
    expect(editor.view.state.selection.main.head).toBe(imageLine.from)
  })

  it('pose une classe visuelle sur la ligne image sélectionnée', () => {
    const value = '## Corps\n- Rang 1\n![](img/x.png)\n- Rang 2\n'
    const { host } = mount(value)
    const node = host.querySelector('.cm-image-placeholder')
    click(node)
    const lineEl = host.querySelector('.cm-line.md-image')
    expect(lineEl).toBeTruthy()
    expect(lineEl.className).toMatch(/selected/i)
  })

  it("ne pose PAS la classe visuelle tant que la ligne image n'est pas sélectionnée", () => {
    const value = '## Corps\n- Rang 1\n![](img/x.png)\n- Rang 2\n'
    const { host } = mount(value)
    const lineEl = host.querySelector('.cm-line.md-image')
    expect(lineEl).toBeTruthy()
    expect(lineEl.className).not.toMatch(/selected/i)
  })
})

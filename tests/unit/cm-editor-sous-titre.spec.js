// @vitest-environment jsdom
// Le sous-titre `### Titre` d'une technique (émis par refblocks.js pour chaque
// entrée d'un bloc `## Techniques {techniques}`) doit être masqué en vue enrichie, comme le
// sont déjà `## `, `- `, `> `, etc. Avant ce correctif, `lineType` classait ces lignes en
// `'texte'` (aucun test ne matchait `###`), donc `addLineMaskDecorations` ne leur posait
// AUCUN masque : le patron affichait `### Croiser une torsade vers la gauche` dièses comprises
// au milieu d'un texte par ailleurs propre (patron de démo « Bonnet Torsade »).
//
// Sur le modèle de tests/unit/cm-editor-keyboard.spec.js : un vrai `createCmEditor` monté en
// jsdom. On lit `view.contentDOM.textContent`, le texte RÉELLEMENT rendu par CodeMirror une
// fois les décorations appliquées — pas la plage de décoration construite en interne, qui ne
// prouverait que l'intention, pas le rendu.
import { describe, it, expect } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'

function mount(value) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value })
  return { host, editor }
}

describe('masquage du sous-titre ### en vue enrichie', () => {
  const doc = '## Techniques {techniques}\n\n### Jeté\n\nfaire un jeté\n'

  it('vue enrichie (défaut) : le ### du sous-titre est masqué, le mot Jeté reste visible', () => {
    const { editor, host } = mount(doc)
    const text = editor.view.contentDOM.textContent
    expect(text).toContain('Jeté')
    expect(text).not.toContain('###')
    host.remove()
  })

  it("setMarkupHidden(false) : le balisage réapparaît, ### redevient visible", () => {
    const { editor, host } = mount(doc)
    editor.setMarkupHidden(false)
    const text = editor.view.contentDOM.textContent
    expect(text).toContain('###')
    expect(text).toContain('Jeté')
    host.remove()
  })

  // `lineTypePlugin` dérive sa classe via `md-${type}` (cm-editor.js,
  // fonction `lineClass`) — aucun changement de code n'était nécessaire pour que
  // `'sous-titre'` produise `md-sous-titre`, mais une lecture de source ne prouve pas
  // le rendu réel. On le vérifie donc ici sur le DOM effectivement construit par CM6,
  // ligne par ligne (querySelectorAll, pas un seul querySelector : la ligne `###
  // Jeté` n'est pas forcément la première `.cm-line` masquée du document).
  it('la ligne ### porte bien la classe md-sous-titre posée par lineTypePlugin', () => {
    const { editor, host } = mount(doc)
    const lines = [...editor.view.contentDOM.querySelectorAll('.cm-line.md-sous-titre')]
    expect(lines).toHaveLength(1)
    expect(lines[0].textContent).toContain('Jeté')
    host.remove()
  })
})

// Retour-arrière en début de ligne — la commande défensive
// deleteMarkupBackward (cm-editor.js) doit produire, sur la 6.43.6 épinglée, la
// MÊME transaction que le chemin par défaut (deleteCharBackward + skipAtomic de
// @codemirror/commands) quand le curseur est à la frontière du préfixe `- `
// masqué, et laisser sinon la main à defaultKeymap. C'est le bouclier modèle
// contre la fragilisation de la résolution de curseur au bord des widgets par
// @codemirror/view 6.43.7 (cf. commentaire d'épinglage dans cm-editor.js).
//
// Ce que ce fichier PEUT prouver (jsdom, modèle pur) : la garde de la commande,
// sa transaction (document + sélection), et son câblage AVANT defaultKeymap.
// Ce qu'il ne peut PAS prouver : le rendu DOM au bord du widget sous 6.43.7+
// (le defaut amont n'est pas reproductible ici — node_modules épinglé 6.43.6)
// ; c'est le rôle du test e2e correction-editor-keys.spec.js.
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { createCmEditor, deleteMarkupBackward } from '@/components/cm/cm-editor'

const DOC = '## Corps\n- Rang 1\n- Rang 2\n'
// '## Corps\n' = 9 caractères ; la ligne 2 (« - Rang 1 ») va de 9 à 16.
const LIGNE2_DEBUT = 9
const LIGNE2_APRES_PUCE = LIGNE2_DEBUT + 2 // juste après le widget case-à-cocher

function mount(value = DOC) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value })
  return { editor }
}

describe('deleteMarkupBackward — garde', () => {
  it('câblée AVANT defaultKeymap dans le keymap de l’éditeur', () => {
    const { editor } = mount()
    const bindings = editor.view.state
      .facet(keymap)
      .flat()
      .filter((b) => b.key === 'Backspace')
    const defauts = bindings.findIndex(
      (b) => b.run === defaultKeymap.find((d) => d.key === 'Backspace').run,
    )
    const notre = bindings.findIndex((b) => b.run === deleteMarkupBackward)
    expect(notre).toBeGreaterThanOrEqual(0)
    expect(defauts).toBeGreaterThanOrEqual(0)
    expect(notre).toBeLessThan(defauts)
  })

  it('curseur juste après la puce masquée d’un rang : retire `- ` entier, curseur en début de ligne', () => {
    const { editor } = mount()
    editor.view.dispatch({ selection: { anchor: LIGNE2_APRES_PUCE } })
    expect(deleteMarkupBackward(editor.view)).toBe(true)
    // La ligne 2 (« - Rang 1 ») redevient du texte nu ; les deux autres lignes,
    // dont la puce de la ligne 3, sont intactes.
    expect(editor.getValue()).toBe('## Corps\nRang 1\n- Rang 2\n')
    expect(editor.view.state.selection.main.head).toBe(LIGNE2_DEBUT)
  })

  it('curseur juste après la puce d’une ligne compteur : retire `- ` et laisse le compteur en texte', () => {
    const { editor } = mount('- {×5} pas\n')
    editor.view.dispatch({ selection: { anchor: 2 } })
    expect(deleteMarkupBackward(editor.view)).toBe(true)
    expect(editor.getValue()).toBe('{×5} pas\n')
    expect(editor.view.state.selection.main.head).toBe(0)
  })

  it('curseur en MILIEU de texte : false, rien ne bouge (main laissée à defaultKeymap)', () => {
    const { editor } = mount()
    editor.view.dispatch({ selection: { anchor: LIGNE2_APRES_PUCE + 3 } })
    expect(deleteMarkupBackward(editor.view)).toBe(false)
    expect(editor.getValue()).toBe(DOC)
  })

  it('curseur au VRAI début d’un rang (ex. flèche Gauche traversant le widget atomique) : false — la fusion reste au chemin par défaut', () => {
    const { editor } = mount()
    editor.view.dispatch({ selection: { anchor: LIGNE2_DEBUT } })
    expect(deleteMarkupBackward(editor.view)).toBe(false)
    expect(editor.getValue()).toBe(DOC)
  })

  it('ligne qui commence par « - » SANS espace : pas un rang (BULLET_RE exige `\\s+`), false', () => {
    const { editor } = mount('-sans-espace\n')
    editor.view.dispatch({ selection: { anchor: 2 } })
    expect(deleteMarkupBackward(editor.view)).toBe(false)
    expect(editor.getValue()).toBe('-sans-espace\n')
  })

  it('mode brut (hideMarkup false) : false — pas de widget à traverser, suppression normale', () => {
    const { editor } = mount()
    // hideMarkup true = mode enrichi (défaut) ; false = mode brut.
    editor.setMarkupHidden(false)
    editor.view.dispatch({ selection: { anchor: LIGNE2_APRES_PUCE } })
    expect(deleteMarkupBackward(editor.view)).toBe(false)
    expect(editor.getValue()).toBe(DOC)
  })

  it('sélection non vide : false', () => {
    const { editor } = mount()
    editor.view.dispatch({ selection: { anchor: LIGNE2_APRES_PUCE, head: LIGNE2_APRES_PUCE + 2 } })
    expect(deleteMarkupBackward(editor.view)).toBe(false)
    expect(editor.getValue()).toBe(DOC)
  })

  it('multi-curseurs impossible dans cet éditeur (allowMultipleSelections désactivé) — la garde ranges.length!==1 n’est que ceinture et bretelles', () => {
    const { editor } = mount()
    // Facet CM6 désactivé par défaut et jamais activé dans le projet : une
    // sélection multi-ranges est de toute façon réduite à sa range principale
    // par state.update. La garde de deleteMarkupBackward reste par prudence.
    expect(editor.view.state.facet(EditorState.allowMultipleSelections)).toBe(false)
  })

  it('deuxième pression (vrai début de ligne, plus de puce) : false — la fusion reste au chemin par défaut', () => {
    const { editor } = mount()
    editor.view.dispatch({ selection: { anchor: LIGNE2_APRES_PUCE } })
    expect(deleteMarkupBackward(editor.view)).toBe(true)
    // Après retrait de la puce, « Rang 2 » démarre à l’index LIGNE2_DEBUT.
    editor.view.dispatch({ selection: { anchor: LIGNE2_DEBUT } })
    expect(deleteMarkupBackward(editor.view)).toBe(false)
  })
})

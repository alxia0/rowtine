// Extrait de ReaderTextEditor.vue (flèches monter/descendre) pour
// être testable sans monter le composant Vue : `<script setup>` n'exporte pas
// ses fonctions locales vers un import ES normal, or ce comportement CM6 réel
// (dispatch sur un vrai EditorView) doit pouvoir être prouvé unitairement,
// notamment pour une ligne IMAGE (cf. move-line.spec.js — les widgets image
// sont posés en Decoration.replace + rendus atomiques par maskAtomicRanges,
// cm-editor.js ; ces deux fonctions ciblent la ligne par POSITION
// (doc.lineAt), jamais via une commande de curseur soumise aux atomicRanges,
// donc le déplacement n'est pas bloqué).
//
// Échange le texte de la ligne du curseur avec sa voisine via une seule
// dispatch CM6, puis replace le curseur sur la ligne déplacée (offset relatif
// conservé). No-op en bord de document.
export function moveLineUp(view) {
  const { state } = view
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  if (line.number <= 1) return // déjà en haut
  const prev = state.doc.line(line.number - 1)
  const offset = pos - line.from
  view.dispatch({
    changes: { from: prev.from, to: line.to, insert: line.text + '\n' + prev.text },
    selection: { anchor: prev.from + offset },
  })
  view.focus()
}

export function moveLineDown(view) {
  const { state } = view
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  if (line.number >= state.doc.lines) return // déjà en bas
  const next = state.doc.line(line.number + 1)
  const offset = pos - line.from
  view.dispatch({
    changes: { from: line.from, to: next.to, insert: next.text + '\n' + line.text },
    selection: { anchor: line.from + next.text.length + 1 + offset },
  })
  view.focus()
}

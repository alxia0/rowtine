// @vitest-environment jsdom
// Test d'intégration reporté (createCmEditor + opts.sizeLabels) : le
// câblage complet menu « Aide mémoire » -> applyRetag -> retagSelection n'était couvert par
// AUCUN test — on pouvait supprimer le passage des tailles sans faire tomber la suite
// (constaté par mutation). Ce fichier monte réellement l'éditeur et actionne le
// menu « Aide mémoire » de la barre d'outils, puis vérifie le document produit.
//
// « Aide mémoire » est passé de <select> à une PUCE qui ouvre un
// popover générique (openMenuPopover) : choisir une catégorie n'est plus un `change`
// sur un <select> mais un clic sur la puce PUIS un clic sur l'item du popover portant le
// libellé FR de la balise (cf. fr.json correction.toolbar.*) — même geste que la tricoteuse.
import { describe, it, expect, afterEach } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'
import fr from '@/i18n/fr.json'

function mount(value, opts = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value, ...opts })
  return { host, editor }
}

// Filet de sécurité : un popover resté ouvert (assertion qui aurait échoué avant le clic
// sur l'item) ne doit jamais fuiter vers le test suivant.
afterEach(() => {
  document.querySelectorAll('.cm-menu-popover, .cm-menu-popover-scrim').forEach((el) => el.remove())
})

// Sélectionne les lignes [fromLine, toLine] (1-based) puis actionne la puce « Aide mémoire »
// de la barre : clic sur la puce (ouvre le popover, cf. wireToolbar/openMenuPopover), clic
// sur l'item dont le texte est le libellé FR de `tag` (le popover se ferme de lui-même, cf.
// rien à refermer ici, contrairement à l'ancien `select.selectedIndex = 0`).
function chooseReference(editor, fromLine, toLine, tag) {
  const { state, dispatch } = editor.view
  const from = state.doc.line(fromLine).from
  const to = state.doc.line(toLine).to
  dispatch({ selection: { anchor: from, head: to } })
  editor.toolbar.querySelector('.cm-retag-ref').click()
  const label = fr.correction.toolbar[tag]
  const item = [...document.querySelectorAll('.cm-menu-popover__item')].find((b) => b.textContent === label)
  expect(item, `item de popover introuvable pour le libellé « ${label} »`).toBeTruthy()
  item.click()
}

describe('barre « Aide mémoire » — chemin complet menu -> applyRetag -> retagSelection', () => {
  it('« Tailles » verse la sélection dans une VRAIE table, avec les colonnes de sizeLabels', () => {
    const doc = 'Tour de poitrine 90 (100) 110\nLongueur totale 55 (58) 61'
    const { editor, host } = mount(doc, { sizeLabels: ['S', 'M', 'L'] })
    chooseReference(editor, 1, 2, 'measurements')
    const out = editor.getValue()
    expect(out).toContain('## Tailles {measurements}')
    // Les 3 colonnes S/M/L viennent de opts.sizeLabels, transmises par getSizeLabels() ->
    // applyRetag -> retagSelection : c'est exactement le câblage resté sans test.
    expect(out).toContain('| mesure | S | M | L |')
    expect(out).toContain('| Tour de poitrine | 90 | 100 | 110 |')
    expect(out).toContain('| Longueur totale | 55 | 58 | 61 |')
    host.remove()
  })

  it('setSizeLabels (édition à chaud) est bien lu par le menu, pas seulement les tailles du montage', () => {
    const doc = 'Tour de poitrine 90 (100)'
    const { editor, host } = mount(doc, { sizeLabels: ['S'] })
    editor.setSizeLabels(['S', 'M'])
    chooseReference(editor, 1, 1, 'measurements')
    const out = editor.getValue()
    expect(out).toContain('| mesure | S | M |')
    expect(out).toContain('| Tour de poitrine | 90 | 100 |')
    host.remove()
  })

  it('sans sizeLabels : gabarit de repli à autant de colonnes vides que de tailles (ici zéro)', () => {
    const doc = 'Mesures prises a plat'
    const { editor, host } = mount(doc)
    chooseReference(editor, 1, 1, 'measurements')
    const out = editor.getValue()
    expect(out).toContain('## Tailles {measurements}')
    expect(out).toContain('| mesure |')
    host.remove()
  })

  it('« Fil » alimente un bloc à titre réservé (non-régression du chemin non-table)', () => {
    const doc = 'Coton DK, 400 m\n3 pelotes'
    const { editor, host } = mount(doc)
    chooseReference(editor, 1, 2, 'yarn')
    const out = editor.getValue()
    expect(out).toContain('## Fil {yarn}')
    expect(out).not.toContain('## Coton DK, 400 m {yarn}')
    expect(out).toContain('Coton DK, 400 m')
    expect(out).toContain('3 pelotes')
    host.remove()
  })
})

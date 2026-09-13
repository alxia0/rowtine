// Compteur est passé de <select class="cm-retag-counter">
// à une puce qui ouvre un popover générique (openMenuPopover), même patron
// que Section/Aide-mémoire (cf. cm-editor-section-menu.spec.js et
// cm-editor-toolbar-reference.spec.js pour les tests analogues de ces deux-là) :
// Répétition -> carte à 1 champ (openNumberPrompt, INCHANGÉ) ; Cadence -> carte
// fusionnée à 2 champs (openNumberFormPrompt), au lieu des 2 dialogues
// séquentiels d'avant. Ce fichier monte réellement l'éditeur et actionne le
// popover Compteur, puis vérifie le document produit — même esprit que
// cm-editor-toolbar-reference.spec.js pour Aide-mémoire.
import { describe, it, expect, afterEach } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'
import fr from '@/i18n/fr.json'

function mount(value, opts = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value, ...opts })
  return { host, editor }
}

function getPopoverItems() {
  return [...document.querySelectorAll('.cm-menu-popover__item')]
}
function getPopover() {
  return document.querySelector('.cm-menu-popover')
}
function getDialogInputs() {
  return [...document.querySelectorAll('.cm-numprompt__input')]
}
function getOkBtn() {
  return document.querySelector('.cm-numprompt__btn--primary')
}
// openNumberPrompt/openNumberFormPrompt résolvent via une chaîne de microtâches
// (le `await` dans le callback `onSelect` de wireToolbar) qu'un simple
// `await Promise.resolve()` ne garantit pas de vider en une fois — même piège
// documenté dans cm-editor-prompt-i18n.spec.js. Un tick macrotâche (setTimeout)
// garantit que la queue de microtâches est vidée avant que le test ne reprenne
// la main, donc qu'`applyRetag` a bien eu le temps de s'exécuter.
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// Filet de sécurité : un popover ou un mini-dialogue resté ouvert (assertion qui
// aurait échoué avant le clic suivant) ne doit jamais fuiter vers le test suivant
// (même patron que cm-editor-toolbar-reference.spec.js / cm-number-prompt.spec.js).
afterEach(() => {
  document.querySelectorAll('.cm-menu-popover, .cm-menu-popover-scrim, .cm-numprompt').forEach((el) => el.remove())
})

// Sélectionne toute la ligne 1 puis ouvre le popover Compteur (clic sur la puce).
function openCounterPopover(editor) {
  const { state, dispatch } = editor.view
  const line = state.doc.line(1)
  dispatch({ selection: { anchor: line.from, head: line.to } })
  editor.toolbar.querySelector('.cm-retag-counter').click()
}

describe('popover « Compteur » de la barre de balisage', () => {
  it('liste 2 items, Répétition puis Cadence, dans cet ordre', () => {
    const { host, editor } = mount('Tricoter un rang simple')
    openCounterPopover(editor)
    expect(getPopoverItems().map((b) => b.textContent)).toEqual([
      fr.correction.toolbar.counterRep,
      fr.correction.toolbar.counterCadence,
    ])
    host.remove()
  })

  it('« Répétition » ouvre la carte à 1 champ INCHANGÉE (openNumberPrompt) et applique {×N} à la sélection', async () => {
    const { host, editor } = mount('Tricoter un rang simple')
    openCounterPopover(editor)
    const item = getPopoverItems().find((b) => b.textContent === fr.correction.toolbar.counterRep)
    item.click()

    // Le popover s'est fermé, une SEULE carte à 1 champ est ouverte.
    expect(getPopover()).toBeNull()
    const inputs = getDialogInputs()
    expect(inputs.length).toBe(1)

    inputs[0].value = '4'
    getOkBtn().click()
    await tick()
    expect(editor.getValue()).toContain('{×4} Tricoter un rang simple')
    host.remove()
  })

  it('« Cadence » ouvre la carte FUSIONNÉE à 2 champs (openNumberFormPrompt) et applique {cadence X×N} à la sélection', async () => {
    const { host, editor } = mount('Tricoter un rang simple')
    openCounterPopover(editor)
    const item = getPopoverItems().find((b) => b.textContent === fr.correction.toolbar.counterCadence)
    item.click()

    // Un seul calque à la fois : le popover-liste est fermé AVANT que la carte du
    // formulaire n'apparaisse (jamais superposés).
    expect(getPopover()).toBeNull()
    const inputs = getDialogInputs()
    expect(inputs.length).toBe(2)
    // Le focus atterrit sur le PREMIER champ (« Répéter tous les »), pas ailleurs —
    // c'est aussi la preuve que la carte est bien apparue APRÈS la fermeture du
    // popover (sinon le focus resterait sur un item de popover déjà retiré du DOM).
    expect(document.activeElement).toBe(inputs[0])

    inputs[0].value = '2'
    inputs[1].value = '5'
    getOkBtn().click()
    await tick()
    expect(editor.getValue()).toContain('{cadence 2×5} Tricoter un rang simple')
    host.remove()
  })

  it('Cadence : un champ vide au moment de valider ne ferme rien, ne modifie pas le document', async () => {
    const { host, editor } = mount('Tricoter un rang simple')
    openCounterPopover(editor)
    getPopoverItems().find((b) => b.textContent === fr.correction.toolbar.counterCadence).click()

    const inputs = getDialogInputs()
    inputs[0].value = '2'
    // inputs[1] (« fois ») reste vide.
    getOkBtn().click()
    await tick()

    expect(document.querySelector('.cm-numprompt')).not.toBeNull()
    expect(editor.getValue()).not.toContain('cadence')
    document.querySelector('.cm-numprompt .cm-numprompt__btn:not(.cm-numprompt__btn--primary)').click()
    host.remove()
  })
})

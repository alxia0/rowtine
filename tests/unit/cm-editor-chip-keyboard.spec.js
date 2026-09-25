// @vitest-environment jsdom
// Après revue — les puces cliquables du texte (CounterWidget,
// SectionKindWidget) étaient `role="button" tabindex="0"` avec un SEUL écouteur
// `click` : atteignables au Tab (annoncées comme bouton par un lecteur d'écran)
// mais Entrée/Espace ne déclenchaient rien — un manquement WCAG 2.1.1 réel, la
// souris/le tactile étaient les SEULES voies d'activation. Verrouille que les deux
// widgets répondent maintenant au clavier, via le helper partagé
// wireChipKeyboardActivation (cm-editor.js).
import { describe, it, expect } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'

function mountHost(value) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  createCmEditor(host, { value })
  return host
}

function keydown(el, key) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}
function keyup(el, key) {
  el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
}

describe('Puces du texte — activation clavier (Entrée/Espace)', () => {
  it('CounterWidget : Entrée ouvre le mini-dialogue (comme un clic)', () => {
    const host = mountHost('- {×3} Rang test\n')
    const chip = host.querySelector('.cm-counter-chip')
    expect(chip).toBeTruthy()
    expect(document.querySelector('.cm-numprompt')).toBeNull()
    keydown(chip, 'Enter')
    expect(document.querySelector('.cm-numprompt')).not.toBeNull()
    // Nettoyage : referme sans valider, pour ne pas laisser fuir l'overlay.
    document.querySelector('.cm-numprompt__input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    host.remove()
  })

  it('CounterWidget : Espace (au keyup) ouvre aussi le mini-dialogue', () => {
    const host = mountHost('- {×3} Rang test\n')
    const chip = host.querySelector('.cm-counter-chip')
    keydown(chip, ' ')
    // Un keydown seul ne déclenche rien (évite l'activation sur l'appui, comme un
    // <button> natif) — c'est le keyup qui active.
    expect(document.querySelector('.cm-numprompt')).toBeNull()
    keyup(chip, ' ')
    expect(document.querySelector('.cm-numprompt')).not.toBeNull()
    document.querySelector('.cm-numprompt__input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    host.remove()
  })

  it('SectionKindWidget : Entrée ouvre le popover Section (comme un clic)', () => {
    const host = mountHost('## Corps\nRang test\n')
    const chip = host.querySelector('.cm-section-kind-chip')
    expect(chip).toBeTruthy()
    expect(document.querySelector('.cm-menu-popover')).toBeNull()
    keydown(chip, 'Enter')
    expect(document.querySelector('.cm-menu-popover')).not.toBeNull()
    // Nettoyage : ferme via le scrim.
    document.querySelector('.cm-menu-popover-scrim')?.click()
    host.remove()
  })

  it('les deux puces restent focalisables (Tab) même sans souris', () => {
    const host = mountHost('## Corps\n- {×3} Rang test\n')
    const sectionChip = host.querySelector('.cm-section-kind-chip')
    const counterChip = host.querySelector('.cm-counter-chip')
    expect(sectionChip.tabIndex).toBe(0)
    expect(counterChip.tabIndex).toBe(0)
    expect(sectionChip.getAttribute('role')).toBe('button')
    expect(counterChip.getAttribute('role')).toBe('button')
    host.remove()
  })
})

// Protège : une puce réutilisée par CodeMirror (même offset, lignes décalées au-dessus) agit sur SA ligne.
describe('Puces du texte : ligne résolue au clic', () => {
  it('CounterWidget : après une fusion de lignes au-dessus (offset inchangé), la puce ouvre SA valeur', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createCmEditor(host, { value: 'a\nb\n- {×3} x\n- {×5} y\n' })
    // « a\nb » → « abc » : même longueur, une ligne de moins au-dessus des puces.
    editor.view.dispatch({ changes: { from: 0, to: 3, insert: 'abc' } })
    const chip = [...host.querySelectorAll('.cm-counter-chip')].find((el) => el.textContent.includes('3'))
    chip.click()
    expect(document.querySelector('.cm-numprompt__input').value).toBe('3')
    document.querySelector('.cm-numprompt__input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    host.remove()
  })

  it('SectionKindWidget : après la même fusion, la puce retague SON titre, pas le voisin', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createCmEditor(host, { value: 'a\nb\n## Corps\n## Bordure\n' })
    editor.view.dispatch({ changes: { from: 0, to: 3, insert: 'abc' } })
    host.querySelectorAll('.cm-section-kind-chip')[0].click() // puce de « ## Corps »
    const item = [...document.querySelectorAll('.cm-menu-popover__item')].find((b) => b.textContent === 'Manche')
    item.click()
    const lignes = editor.getValue().split('\n')
    expect(lignes[1]).toMatch(/^## Corps \{\w+\}$/)
    expect(lignes[2]).toBe('## Bordure')
    document.querySelectorAll('.cm-menu-popover, .cm-menu-popover-scrim').forEach((el) => el.remove())
    host.remove()
  })
})

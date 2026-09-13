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

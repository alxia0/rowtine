// @vitest-environment jsdom
// Unitaire — piège à focus commun des dialogues (src/composables/useFocusTrap.js).
// Dette de l'audit UX du 16/07 : dans une surface role="dialog", Tab/Maj+Tab ne doivent
// JAMAIS sortir vers la page derrière (le voile ne bloque que visuellement), et la
// fermeture doit rendre le focus au déclencheur — pour les 22 surfaces du recensement,
// via UN composable partagé (pas une copie par dialogue).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

// `cancelable: true` indispensable : sans lui, preventDefault() est sans effet et
// `defaultPrevented` resterait faux même quand le piège fait son travail.
function tabEvent(opts = {}) {
  return new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...opts })
}

describe('trapTabFocus — boucle dernier↔premier focusable', () => {
  let container
  let b1 // volontairement disabled : doit être EXCLU de la boucle
  let b2
  let b3

  beforeEach(() => {
    container = document.createElement('div')
    b1 = document.createElement('button')
    b1.disabled = true
    b2 = document.createElement('button')
    b3 = document.createElement('button')
    container.append(b1, b2, b3)
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('Tab depuis le dernier focusable ramène au premier NON-disabled et appelle preventDefault', () => {
    b3.focus()
    const e = tabEvent()
    trapTabFocus(e, container)
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(b2)
  })

  it('Maj+Tab depuis le premier focusable va au dernier', () => {
    b2.focus()
    const e = tabEvent({ shiftKey: true })
    trapTabFocus(e, container)
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(b3)
  })

  it('Tab au milieu ne piège rien (le navigateur déplace normalement le focus)', () => {
    b2.focus()
    const e = tabEvent()
    trapTabFocus(e, container)
    expect(e.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(b2)
  })

  it('sans param container, le conteneur est event.currentTarget (dispatch avec listener posé)', () => {
    container.addEventListener('keydown', trapTabFocus)
    try {
      b3.focus()
      const e = tabEvent()
      // Événement émis depuis un BOUTON (target), remonté au conteneur (currentTarget) :
      // exactement ce que fait @keydown="trapTabFocus" sur la racine d'un dialogue.
      b3.dispatchEvent(e)
      expect(e.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(b2)
    } finally {
      container.removeEventListener('keydown', trapTabFocus)
    }
  })
})

// Hôte minimal reproduisant le câblage type : un déclencheur dans la page, un dialogue
// v-if piloté par une prop `open`, useDialogFocusReturn branché sur cette prop.
const Host = defineComponent({
  props: { open: { type: Boolean, default: false } },
  setup(props) {
    useDialogFocusReturn(() => props.open)
    return () =>
      h('div', [
        h('button', { class: 'trigger' }, 'Déclencheur'),
        props.open
          ? h('div', { role: 'dialog' }, [h('button', { class: 'inside' }, 'Dans le dialogue')])
          : null,
      ])
  },
})

describe('useDialogFocusReturn — restitution au déclencheur (ref d’ouverture)', () => {
  it('capture le déclencheur à l’ouverture, le retrouve à la fermeture', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const trigger = wrapper.find('.trigger')
    trigger.element.focus()
    await wrapper.setProps({ open: true })
    wrapper.find('.inside').element.focus()
    expect(document.activeElement).toBe(wrapper.find('.inside').element)
    await wrapper.setProps({ open: false })
    expect(document.activeElement).toBe(trigger.element)
    wrapper.unmount()
  })

  it('déclencheur retiré du DOM pendant l’ouverture : la fermeture ne lève pas d’erreur', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const trigger = wrapper.find('.trigger')
    trigger.element.focus()
    await wrapper.setProps({ open: true })
    wrapper.find('.inside').element.focus()
    trigger.element.remove()
    await wrapper.setProps({ open: false })
    // Le déclencheur n'est plus connectable : aucun focus imposé, pas d'erreur.
    expect(document.activeElement).toBe(document.body)
    wrapper.unmount()
  })
})

describe('useDialogFocusReturn — carte v-if sans ref (montage/démontage = ouverture/fermeture)', () => {
  it('capture au montage, restitue au démontage un déclencheur encore connecté', () => {
    const persist = document.createElement('button')
    persist.textContent = 'déclencheur hors composant'
    document.body.appendChild(persist)
    persist.focus()

    const AlwaysOpen = defineComponent({
      setup() {
        useDialogFocusReturn()
        return () => h('div', { role: 'dialog' }, [h('button', { class: 'inside' }, 'Dans le dialogue')])
      },
    })
    const wrapper = mount(AlwaysOpen, { attachTo: document.body })
    wrapper.find('.inside').element.focus()
    wrapper.unmount()
    expect(document.activeElement).toBe(persist)
    persist.remove()
  })
})

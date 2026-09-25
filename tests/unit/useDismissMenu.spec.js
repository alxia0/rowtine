// @vitest-environment jsdom
// Unitaire — a11y des menus : Escape ferme, focus géré à l’ouverture/fermeture.
import { describe, it, expect } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useDismissMenu } from '@/composables/useDismissMenu'

function mountMenu() {
  const Comp = defineComponent({
    setup() {
      const { open, triggerRef, menuRef } = useDismissMenu()
      return { open, triggerRef, menuRef }
    },
    render() {
      return h('div', [
        h('button', { ref: 'triggerRef', onClick: () => (this.open = true) }, 'Menu'),
        this.open
          ? h('nav', { ref: 'menuRef' }, [h('button', { id: 'first' }, 'Accueil')])
          : null,
      ])
    },
  })
  return mount(Comp, { attachTo: document.body })
}

describe('useDismissMenu', () => {
  it('ouvre le menu et porte le focus sur son premier élément', async () => {
    const w = mountMenu()
    w.vm.open = true
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement?.id).toBe('first')
    w.unmount()
  })

  it('Escape ferme le menu', async () => {
    const w = mountMenu()
    w.vm.open = true
    await w.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.vm.open).toBe(false)
    w.unmount()
  })

  it('rend le focus au déclencheur à la fermeture', async () => {
    const w = mountMenu()
    w.vm.open = true
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    w.vm.open = false
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement?.textContent).toBe('Menu')
    w.unmount()
  })
})

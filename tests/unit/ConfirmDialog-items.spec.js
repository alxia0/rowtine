// @vitest-environment jsdom
// Unitaire — ConfirmDialog : la prop `items` (liste de points entre le message et les
// boutons, pour le message « Nouveautés » d'une mise à jour). Absente ou vide, le dialogue
// reste STRICTEMENT celui d'avant : aucun nœud de liste dans le DOM.
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

let wrapper
function mountDialog(extra = {}) {
  wrapper = mount(ConfirmDialog, {
    props: { open: true, title: 'Titre', message: 'Message', confirmLabel: 'OK', ...extra },
    attachTo: document.body,
  })
  return wrapper
}
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ConfirmDialog — prop items', () => {
  it('une <li> par chaîne, dans la liste prévue', () => {
    const w = mountDialog({ items: ['a', 'b'] })
    const liste = w.find('[data-test="confirm-items"]')
    // PRÉCONDITION : la liste existe, sinon `findAll` sur un nœud vide ne prouverait rien.
    expect(liste.exists()).toBe(true)
    expect(liste.element.tagName).toBe('UL')
    const lis = liste.findAll('li')
    expect(lis).toHaveLength(2)
    expect(lis.map((l) => l.text())).toEqual(['a', 'b'])
  })

  it('la liste est placée entre le message et les boutons', () => {
    const w = mountDialog({ items: ['a'] })
    const html = w.html()
    expect(html.indexOf('cfd__msg')).toBeLessThan(html.indexOf('confirm-items'))
    expect(html.indexOf('confirm-items')).toBeLessThan(html.indexOf('cfd__actions'))
  })

  it('sans items : aucun nœud de liste', () => {
    const w = mountDialog()
    expect(w.find('[data-test="confirm-items"]').exists()).toBe(false)
  })

  it('items vide : aucun nœud de liste', () => {
    const w = mountDialog({ items: [] })
    expect(w.find('[data-test="confirm-items"]').exists()).toBe(false)
  })
})

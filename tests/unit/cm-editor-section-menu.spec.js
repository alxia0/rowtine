// Le menu Section de la barre de
// balisage (`.cm-retag-section`) était une liste plate de 18 entrées, avec
// des libellés codés en dur en français (import statique de fr.json dans
// cm-editor.js, qui n'est PAS un composant Vue et n'a pas de t()). Ce test
// verrouille : (1) le rendu en sous-blocs par famille via groupedSectionKinds
// (cf. src/utils/section-kinds.js, commit 01d9a10), et (2) le repli FR quand
// createCmEditor est appelé sans labels (contrat du banc de test qui
// monte l'éditeur hors i18n).
//
// `.cm-retag-section` est passé de <select>/
// <optgroup> à une PUCE qui ouvre un popover générique (openMenuPopover) :
// les assertions ne lisent plus `sectionSelect(host).innerHTML`
// mais le DOM du popover réellement ouvert (`.cm-menu-popover__group` pour
// les intitulés de famille, `.cm-menu-popover__item` pour les kinds).
import { describe, it, expect, afterEach } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'
import en from '@/i18n/en.json'

const mount = (opts = {}) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value: '', ...opts })
  return { host, editor }
}

// Ouvre le popover Section en cliquant la puce (même geste que la tricoteuse) —
// openMenuPopover pose alors ses items dans document.body (cf. cm-editor.js).
function openSectionPopover(editor) {
  editor.toolbar.querySelector('.cm-retag-section').click()
}
const popoverGroupLabels = () => [...document.querySelectorAll('.cm-menu-popover__group')].map((g) => g.textContent)
const popoverItemLabels = () => [...document.querySelectorAll('.cm-menu-popover__item')].map((b) => b.textContent)

// Filet de sécurité : un popover resté ouvert (test qui n'aurait pas cliqué d'item)
// fuirait sinon vers le test suivant, faussant les querySelectorAll ci-dessus.
afterEach(() => {
  document.querySelectorAll('.cm-menu-popover, .cm-menu-popover-scrim').forEach((el) => el.remove())
})

describe('menu Section de la barre de balisage (popover)', () => {
  it('rend des sous-blocs par famille (et non une liste plate)', () => {
    const { host, editor } = mount()
    openSectionPopover(editor)
    const groups = popoverGroupLabels()
    expect(groups.length).toBeGreaterThan(0)
    expect(groups).toContain('Parties de vêtement')
    host.remove()
  })

  it('utilise les libellés fournis (traduits), pas fr.json en dur', () => {
    const { host, editor } = mount({
      labels: { kinds: en.reader.kind, families: en.reader.family },
      locale: 'en',
    })
    openSectionPopover(editor)
    const items = popoverItemLabels()
    expect(items).toContain('Sleeve')
    expect(items).not.toContain('Manche')
    expect(popoverGroupLabels()).toContain('Garment parts')
    host.remove()
  })

  it('sans labels (cas du banc mdedit), replie sur le français', () => {
    const { host, editor } = mount()
    openSectionPopover(editor)
    expect(popoverItemLabels()).toContain('Manche')
    host.remove()
  })
})

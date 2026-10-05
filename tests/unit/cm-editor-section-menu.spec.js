// @vitest-environment jsdom
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
import fr from '@/i18n/fr.json'

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
    expect(groups).toContain('Vêtements')
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
    expect(popoverGroupLabels()).toContain('Garments')
    host.remove()
  })

  it('sans labels (cas du banc mdedit), replie sur le français', () => {
    const { host, editor } = mount()
    openSectionPopover(editor)
    expect(popoverItemLabels()).toContain('Manche')
    host.remove()
  })
})

// Puce d'exemplaires des titres de kind répétable : « ×N » comme la puce du compteur, carte de
// saisie 1..99, réécriture via retagLine.
describe('puce d’exemplaires des sections répétables', () => {
  const tk = (key, n) => {
    const raw = key.split('.').reduce((o, k) => o[k], fr)
    return n === undefined ? raw : raw.replace('{n}', n)
  }
  const copiesChips = (host) => [...host.querySelectorAll('.cm-section-copies-chip')]
  const choose = (label) => [...document.querySelectorAll('.cm-menu-popover__item')].find((b) => b.textContent === label).click()
  const card = () => document.querySelector('.cm-numprompt__card')
  const input = () => card().querySelector('.cm-numprompt__input')
  // La carte se résout en promesse : la ligne n'est réécrite qu'au tour suivant.
  const ok = async () => {
    card().querySelector('.cm-numprompt__btn--primary').click()
    await new Promise((r) => setTimeout(r, 0))
  }
  const type = (v) => {
    input().value = String(v)
    input().dispatchEvent(new Event('input'))
  }
  afterEach(() => document.querySelectorAll('.cm-numprompt').forEach((el) => el.remove()))

  it('présente sur un titre répétable en « ×N », absente sur un titre qui ne l’est pas', () => {
    const { host } = mount({ value: '## Pied {foot}\n- r\n## Corps {body}\n## Manche {sleeve x40}' })
    const chips = copiesChips(host)
    expect(chips).toHaveLength(2)
    expect(chips[0].textContent).toBe('×1')
    expect(chips[1].textContent).toBe('×40')
    host.remove()
  })

  it('la carte part de la valeur courante, ou de 2 à 1 exemplaire', () => {
    const { host } = mount({ value: '## Pied {foot}\n## Manche {sleeve x5}' })
    copiesChips(host)[0].click()
    expect(input().value).toBe('2')
    card().querySelector('.cm-numprompt__btn:not(.cm-numprompt__btn--primary)').click()
    expect(card()).toBeNull()
    copiesChips(host)[1].click()
    expect(input().value).toBe('5')
    host.remove()
  })

  it('saisir 40 réécrit la ligne, 1 retire le suffixe, 0 ou 100 laisse la carte ouverte', async () => {
    const { host, editor } = mount({ value: '## Pied {foot}' })
    copiesChips(host)[0].click()
    type(40)
    await ok()
    expect(editor.getValue()).toBe('## Pied {foot x40}')
    copiesChips(host)[0].click()
    for (const bad of [0, 100, '']) {
      type(bad)
      await ok()
      expect(card()).not.toBeNull()
    }
    type(1)
    await ok()
    expect(editor.getValue()).toBe('## Pied {foot}')
    host.remove()
  })

  it('la carte d\u2019exemplaires n\u2019offre plus de choix de mode, valider rend le nombre', async () => {
    const { host, editor } = mount({ value: '## Pied {foot x2}' })
    copiesChips(host)[0].click()
    expect(card().querySelector('[role="radiogroup"]')).toBeNull()
    type(3)
    await ok()
    expect(editor.getValue()).toBe('## Pied {foot x3}')
    host.remove()
  })

  it('la puce d\u2019une section {toe x2 together} affiche ×2', () => {
    const { host } = mount({ value: '## Pied {foot x2 together}\n## Talon {heel x2}' })
    const chips = copiesChips(host)
    expect(chips[0].textContent).toBe('×2')
    expect(chips[1].textContent).toBe('×2')
    host.remove()
  })

  it('nom accessible de la puce : libellé Exemplaires suivi de la valeur en toutes lettres', () => {
    const { host } = mount({ value: '## Pied {foot x2}\n## Talon {heel x2}\n## Jambe {leg}' })
    const aria = copiesChips(host).map((c) => c.getAttribute('aria-label'))
    expect(aria).toEqual([
      `${tk('reader.copies.label')} : ${tk('reader.copies.n', 2)}`,
      `${tk('reader.copies.label')} : ${tk('reader.copies.n', 2)}`,
      `${tk('reader.copies.label')} : ${tk('reader.copies.one')}`,
    ])
    host.remove()
  })
})

// @vitest-environment jsdom
// Menu contextuel de catégorisation d'image (retour terrain, 24/08/2026, étendu 25/08/2026) :
// quand createCmEditor reçoit opts.imageActions, le clic sur une image du texte (vignette ou
// placeholder) ouvre un popover PRINCIPAL (openMenuPopover) au lieu de simplement
// positionner le curseur (selectImageLine, cf. cm-editor-image-select.spec.js —
// comportement INCHANGÉ tant qu'aucun imageActions n'est fourni). La 1re entrée du
// popover principal (« Suivre comme diagramme »/« Changer le type », active ssi
// info.enabled) ouvre un SECOND popover (choix du type, 4 items présélectionnés sur
// info.selectedShape) ; une 2e entrée (« Juste une image ») et une 3e entrée (« Envoyer
// vers la galerie ») n'apparaissent que si info.isChart && info.enabled. getInfo peut
// renvoyer null (section pas chart-éligible) → repli sur selectImageLine, jamais de menu
// vide.
import { describe, it, expect, afterEach } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'

function mount(value, imageActions) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createCmEditor(host, { value, imageActions })
  return { host, editor }
}

function click(node) {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function popoverItems() {
  return [...document.querySelectorAll('.cm-menu-popover__item')]
}

const SHAPE_OPTIONS = [
  { value: 'standard', label: 'Rangs standards', hint: 'Un diagramme lu rang par rang' },
  { value: 'radial-square', label: 'Radial-carré', hint: 'Motif carré depuis le centre' },
  { value: 'radial-circle', label: 'Radial-rond', hint: 'Motif rond depuis le centre' },
  { value: 'path', label: 'Tracé', hint: 'Pour une bordure irrégulière' },
]

afterEach(() => {
  document.querySelectorAll('.cm-menu-popover, .cm-menu-popover-scrim').forEach((el) => el.remove())
  document.body.innerHTML = ''
})

describe('clic sur une image avec imageActions → menu contextuel à 2 niveaux', () => {
  it('image éligible, pas encore diagramme : popover principal = 1 seule entrée active « Suivre comme diagramme »', () => {
    const value = '## Corps\n![](img/x.png)\n'
    const getInfo = () => ({
      enabled: true,
      primary: { label: 'Suivre comme diagramme', hint: null },
      isChart: false,
      demoteLabel: null,
      shapeOptions: SHAPE_OPTIONS,
      selectedShape: 'standard',
    })
    const { host } = mount(value, { getInfo, setShape: () => {}, demote: () => {} })
    click(host.querySelector('.cm-image-placeholder'))
    const items = popoverItems()
    expect(items.length).toBe(1)
    expect(items[0].textContent).toContain('Suivre comme diagramme')
    expect(items[0].classList.contains('cm-menu-popover__item--disabled')).toBe(false)
  })

  it('image éligible, déjà diagramme : popover principal = 3 entrées, « Changer le type » + « Juste une image » + « Envoyer vers la galerie »', () => {
    const value = '## Corps\n![](img/x.png)\n'
    const getInfo = () => ({
      enabled: true,
      primary: { label: 'Changer le type', hint: null },
      isChart: true,
      demoteLabel: 'Juste une image',
      toGalleryLabel: 'Envoyer vers la galerie',
      shapeOptions: SHAPE_OPTIONS,
      selectedShape: 'radial-square',
    })
    const { host } = mount(value, { getInfo, setShape: () => {}, demote: () => {}, sendToGallery: () => {} })
    click(host.querySelector('.cm-image-placeholder'))
    const items = popoverItems()
    expect(items.length).toBe(3)
    expect(items[0].textContent).toContain('Changer le type')
    expect(items[1].textContent).toContain('Juste une image')
    expect(items[2].textContent).toContain('Envoyer vers la galerie')
  })

  it("cliquer « Suivre comme diagramme » ouvre le sous-popover de type, présélectionné sur selectedShape, et choisir une entrée appelle setShape(line, mdPath, value)", () => {
    const value = '## Corps\n![](img/x.png)\n'
    const calls = []
    const getInfo = () => ({
      enabled: true,
      primary: { label: 'Suivre comme diagramme', hint: null },
      isChart: false,
      demoteLabel: null,
      shapeOptions: SHAPE_OPTIONS,
      selectedShape: 'standard',
    })
    const { host } = mount(value, { getInfo, setShape: (line, mdPath, v) => calls.push([line, mdPath, v]), demote: () => {} })
    const anchor = host.querySelector('.cm-image-placeholder')
    click(anchor)
    popoverItems()[0].click() // ouvre le sous-popover
    const subItems = popoverItems()
    expect(subItems.length).toBe(4)
    expect(subItems[0].getAttribute('aria-checked')).toBe('true') // 'standard' présélectionné
    // Revue tâche B : le sous-popover est ouvert depuis le callback onSelect du
    // popover principal, sur LE MÊME anchor (le placeholder image) — la fermeture
    // périmée du popover principal (rejouée après coup par son propre handler de
    // clic) ne doit pas écraser le aria-expanded="true" que le sous-popover vient
    // de poser sur cet anchor.
    expect(anchor.getAttribute('aria-expanded')).toBe('true')
    subItems[1].click() // 'radial-square'
    expect(calls).toEqual([[2, 'img/x.png', 'radial-square']])
  })

  it('cliquer « Juste une image » appelle demote(line, mdPath) directement, sans sous-popover', () => {
    const value = '## Corps\n![](img/x.png)\n'
    const calls = []
    const getInfo = () => ({
      enabled: true,
      primary: { label: 'Changer le type', hint: null },
      isChart: true,
      demoteLabel: 'Juste une image',
      toGalleryLabel: 'Envoyer vers la galerie',
      shapeOptions: SHAPE_OPTIONS,
      selectedShape: 'path',
    })
    const { host } = mount(value, { getInfo, setShape: () => { throw new Error('ne doit pas être appelé') }, demote: (line, mdPath) => calls.push([line, mdPath]) })
    click(host.querySelector('.cm-image-placeholder'))
    popoverItems()[1].click()
    expect(calls).toEqual([[2, 'img/x.png']])
    expect(document.querySelector('.cm-menu-popover')).toBeNull()
  })

  it('cliquer « Envoyer vers la galerie » appelle sendToGallery(line, mdPath) directement, sans sous-popover', () => {
    const value = '## Corps\n![](img/x.png)\n'
    const calls = []
    const getInfo = () => ({
      enabled: true,
      primary: { label: 'Changer le type', hint: null },
      isChart: true,
      demoteLabel: 'Juste une image',
      toGalleryLabel: 'Envoyer vers la galerie',
      shapeOptions: SHAPE_OPTIONS,
      selectedShape: 'path',
    })
    const { host } = mount(value, {
      getInfo,
      setShape: () => { throw new Error('ne doit pas être appelé') },
      demote: () => { throw new Error('ne doit pas être appelé') },
      sendToGallery: (line, mdPath) => calls.push([line, mdPath]),
    })
    click(host.querySelector('.cm-image-placeholder'))
    popoverItems()[2].click()
    expect(calls).toEqual([[2, 'img/x.png']])
    expect(document.querySelector('.cm-menu-popover')).toBeNull()
  })

  it("image NON éligible : l'entrée unique est désactivée avec le hint, aucun clic n'ouvre le sous-popover", () => {
    const value = '## Corps\n![](img/x.png)\n'
    const getInfo = () => ({
      enabled: false,
      primary: { label: 'Suivre comme diagramme', hint: 'Seule la première image de la section peut devenir un diagramme' },
      isChart: false,
      demoteLabel: null,
      shapeOptions: SHAPE_OPTIONS,
      selectedShape: 'standard',
    })
    const setShape = () => {
      throw new Error('ne doit pas être appelé')
    }
    const { host } = mount(value, { getInfo, setShape, demote: () => {} })
    click(host.querySelector('.cm-image-placeholder'))
    const item = popoverItems()[0]
    expect(item.classList.contains('cm-menu-popover__item--disabled')).toBe(true)
    expect(item.textContent).toContain('Seule la première image de la section peut devenir un diagramme')
    item.click()
    expect(popoverItems().length).toBe(1) // toujours le popover principal, pas le sous-popover
  })

  it('repli sur selectImageLine (aucun menu) quand getInfo renvoie null', () => {
    const value = '## Corps\n![](img/x.png)\n'
    const getInfo = () => null
    const { host, editor } = mount(value, { getInfo, setShape: () => {}, demote: () => {} })
    const imageLine = editor.view.state.doc.line(2)
    click(host.querySelector('.cm-image-placeholder'))
    expect(document.querySelector('.cm-menu-popover')).toBeNull()
    expect(editor.view.state.selection.main.head).toBe(imageLine.from)
  })

  it('sans imageActions, le clic garde le comportement existant (selectImageLine, pas de menu)', () => {
    const value = '## Corps\n![](img/x.png)\n'
    const { host, editor } = mount(value, undefined)
    const imageLine = editor.view.state.doc.line(2)
    click(host.querySelector('.cm-image-placeholder'))
    expect(document.querySelector('.cm-menu-popover')).toBeNull()
    expect(editor.view.state.selection.main.head).toBe(imageLine.from)
  })

  // Revue finale (constat 3) : `aria-haspopup="menu"` posé STATIQUEMENT sur le widget
  // image dès le premier rendu (même patron que `retagMenuBtn`, cf. cm-editor.js), et
  // seulement quand un menu s'ouvre réellement — jamais quand `imageActions` est absent
  // (le clic ne fait alors que repositionner le curseur, cf. test ci-dessus).
  it('avec imageActions, le widget image porte aria-haspopup="menu" dès le rendu', () => {
    const value = '## Corps\n![](img/x.png)\n'
    const getInfo = () => ({
      enabled: true,
      primary: { label: 'Suivre comme diagramme', hint: null },
      isChart: false,
      demoteLabel: null,
      shapeOptions: SHAPE_OPTIONS,
      selectedShape: 'standard',
    })
    const { host } = mount(value, { getInfo, setShape: () => {}, demote: () => {} })
    expect(host.querySelector('.cm-image-placeholder').getAttribute('aria-haspopup')).toBe('menu')
  })

  it('sans imageActions, le widget image ne porte pas aria-haspopup', () => {
    const value = '## Corps\n![](img/x.png)\n'
    const { host } = mount(value, undefined)
    expect(host.querySelector('.cm-image-placeholder').getAttribute('aria-haspopup')).toBeNull()
  })
})

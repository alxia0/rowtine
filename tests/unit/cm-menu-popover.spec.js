// @vitest-environment jsdom
// Fondations du popover de menu générique qui
// remplacera plus tard les <select> Compteur/Section/Aide-mémoire de
// la barre de requalification. Cette suite exerce le mécanisme SEUL — aucun
// contrôle existant n'est câblé dessus (périmètre volontairement restreint), donc rien ici ne
// touche applyRetag/wireToolbar.
import { describe, it, expect, afterEach } from 'vitest'
import { openMenuPopover } from '@/components/cm/cm-editor'

function makeAnchor({ left = 20, top = 40, bottom = 60 } = {}) {
  const anchor = document.createElement('button')
  anchor.type = 'button'
  anchor.textContent = 'Ouvrir'
  anchor.getBoundingClientRect = () => ({
    left,
    right: left + 40,
    top,
    bottom,
    width: 40,
    height: bottom - top,
    x: left,
    y: top,
    toJSON() {},
  })
  document.body.appendChild(anchor)
  return anchor
}

function getPopover() {
  return document.querySelector('.cm-menu-popover')
}
function getScrim() {
  return document.querySelector('.cm-menu-popover-scrim')
}
function getItems() {
  return Array.from(document.querySelectorAll('.cm-menu-popover__item'))
}

afterEach(() => {
  // Filet de sécurité (même patron que cm-number-prompt.spec.js) : un test qui
  // échoue avant de fermer ne doit pas polluer le suivant.
  document.querySelectorAll('.cm-menu-popover, .cm-menu-popover-scrim, button').forEach((el) => el.remove())
})

describe('openMenuPopover', () => {
  // Retour terrain (Nexus 7) : root cause confirmée par reproduction visuelle
  // Playwright — `.cm-menu-popover-scrim` n'avait AUCUNE couleur de fond, le texte de
  // l'éditeur restait donc pleinement visible derrière/autour du popover. Même patron de
  // vérification que cm-number-prompt.spec.js (le texte du <style> injecté, pas
  // getComputedStyle — jsdom n'applique pas la cascade d'un <style> de <head>).
  it("le scrim porte une couleur de fond non transparente (retour terrain)", () => {
    const anchor = makeAnchor()
    openMenuPopover(anchor, [{ value: 'a', label: 'A' }], () => {})
    const css = document.getElementById('cm-menu-popover-style').textContent
    const bloc = css.slice(css.indexOf('.cm-menu-popover-scrim'))
    const decl = bloc.slice(0, bloc.indexOf('}'))
    const m = /background:\s*([^;]+);/.exec(decl)
    expect(m, 'aucune déclaration `background` sur .cm-menu-popover-scrim').toBeTruthy()
    const value = m[1].trim().toLowerCase()
    expect(value).not.toBe('transparent')
    expect(value).not.toBe('none')
    expect(value).not.toBe('rgba(0, 0, 0, 0)')
  })

  // Mécanisme générique de marque de sélection (`selectedValue`, 4e argument
  // optionnel), exercé ici au niveau d'openMenuPopover seul, avant son câblage réel dans
  // wireToolbar (Section/Aide-mémoire, cf. cm-editor-popover-selection.spec.js).
  it('avec selectedValue : marque l’item correspondant, role=menuitemradio + aria-checked sur tous', () => {
    const anchor = makeAnchor()
    openMenuPopover(
      anchor,
      [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      () => {},
      'b'
    )
    const items = getItems()
    expect(items.map((b) => b.getAttribute('role'))).toEqual(['menuitemradio', 'menuitemradio'])
    expect(items.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    expect(items[0].classList.contains('cm-menu-popover__item--selected')).toBe(false)
    expect(items[1].classList.contains('cm-menu-popover__item--selected')).toBe(true)
    // Le libellé visible reste inchangé : la coche ajoutée pour l'item actif n'introduit
    // aucun texte parasite (l'icône est un SVG, sans nœud texte).
    expect(items.map((b) => b.textContent)).toEqual(['A', 'B'])
  })

  it('sans selectedValue (undefined, repli d’appel) : aucune marque, role=menuitem inchangé', () => {
    const anchor = makeAnchor()
    openMenuPopover(anchor, [{ value: 'a', label: 'A' }], () => {})
    const item = getItems()[0]
    expect(item.getAttribute('role')).toBe('menuitem')
    expect(item.getAttribute('aria-checked')).toBeNull()
    expect(item.classList.contains('cm-menu-popover__item--selected')).toBe(false)
  })

  it('pose un popover role="menu" avec un item par entrée de `items`', () => {
    const anchor = makeAnchor()
    openMenuPopover(anchor, [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ], () => {})
    const popover = getPopover()
    expect(popover).not.toBeNull()
    expect(popover.getAttribute('role')).toBe('menu')
    expect(getItems().map((b) => b.textContent)).toEqual(['A', 'B'])
  })

  // Constat 4 (revue finale, 2026-08-22) : `aria-haspopup` n'est PLUS posé par
  // openMenuPopover — il est désormais posé STATIQUEMENT ("menu") dans le HTML par
  // `retagMenuBtn`, dès le premier rendu (cf. cm-editor-toolbar-order.spec.js), pour
  // qu'un lecteur d'écran le voie AVANT tout tap. Si openMenuPopover le reposait encore
  // ici (à "true"), il écraserait silencieusement cette valeur "menu" à chaque
  // ouverture — ce test vérifie donc l'INVERSE de l'ancien comportement : un anchor qui
  // n'a JAMAIS porté aria-haspopup (comme ici, un <button> nu) n'en reçoit toujours pas
  // après ouverture, seul aria-expanded change.
  it('ne pose PAS aria-haspopup (responsabilité du HTML statique) mais bascule aria-expanded', () => {
    const anchor = makeAnchor()
    openMenuPopover(anchor, [{ value: 'a', label: 'A' }], () => {})
    expect(anchor.getAttribute('aria-haspopup')).toBeNull()
    expect(anchor.getAttribute('aria-expanded')).toBe('true')
  })

  it('regroupe les items consécutifs qui partagent un groupLabel', () => {
    const anchor = makeAnchor()
    openMenuPopover(
      anchor,
      [
        { value: 'yarn', label: 'Fil', groupLabel: 'Aide-mémoire' },
        { value: 'needles', label: 'Aiguilles', groupLabel: 'Aide-mémoire' },
        { value: 'rep', label: 'Répétition' },
      ],
      () => {}
    )
    const groups = document.querySelectorAll('.cm-menu-popover [role="group"]')
    expect(groups.length).toBe(1)
    expect(groups[0].querySelector('.cm-menu-popover__group').textContent).toBe('Aide-mémoire')
    expect(groups[0].querySelectorAll('.cm-menu-popover__item').length).toBe(2)
    // Le 3e item, sans groupLabel, reste un enfant DIRECT du popover (pas du groupe).
    expect(getPopover().querySelectorAll(':scope > .cm-menu-popover__item').length).toBe(1)
  })

  it('clic sur un item appelle onSelect(value) puis ferme le popover', () => {
    const anchor = makeAnchor()
    const selected = []
    openMenuPopover(anchor, [{ value: 'note', label: 'Note' }], (v) => selected.push(v))
    getItems()[0].click()
    expect(selected).toEqual(['note'])
    expect(getPopover()).toBeNull()
    expect(anchor.getAttribute('aria-expanded')).toBe('false')
  })

  it('Échap ferme le popover sans appeler onSelect', () => {
    const anchor = makeAnchor()
    const onSelect = () => {
      throw new Error('onSelect ne doit pas être appelé')
    }
    openMenuPopover(anchor, [{ value: 'a', label: 'A' }], onSelect)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(getPopover()).toBeNull()
    expect(anchor.getAttribute('aria-expanded')).toBe('false')
  })

  it('clic sur le scrim (hors popover) ferme sans appeler onSelect', () => {
    const anchor = makeAnchor()
    const onSelect = () => {
      throw new Error('onSelect ne doit pas être appelé')
    }
    openMenuPopover(anchor, [{ value: 'a', label: 'A' }], onSelect)
    getScrim().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(getPopover()).toBeNull()
  })

  it('un seul popover ouvert à la fois : en ouvrir un second ferme le premier', () => {
    const anchor1 = makeAnchor()
    const anchor2 = makeAnchor()
    openMenuPopover(anchor1, [{ value: 'a', label: 'A' }], () => {})
    expect(document.querySelectorAll('.cm-menu-popover').length).toBe(1)
    expect(anchor1.getAttribute('aria-expanded')).toBe('true')

    openMenuPopover(anchor2, [{ value: 'b', label: 'B' }], () => {})
    expect(document.querySelectorAll('.cm-menu-popover').length).toBe(1)
    expect(anchor1.getAttribute('aria-expanded')).toBe('false')
    expect(anchor2.getAttribute('aria-expanded')).toBe('true')
    expect(getItems().map((b) => b.textContent)).toEqual(['B'])
  })

  // Constat 5 (revue finale, 2026-08-22) : AVANT ce correctif, Tab n'était pas géré —
  // le focus sortait du popover vers le reste de la page pendant que le scrim bloquait
  // tout clic, laissant le clavier bloqué sans retour visuel. Même patron que
  // ArrowDown/ArrowUp : boucle aux extrémités.
  it('Tab/Shift+Tab cycle entre les items du popover (piège clavier, boucle aux extrémités)', () => {
    const anchor = makeAnchor()
    openMenuPopover(
      anchor,
      [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
      () => {}
    )
    const [a, b, c] = getItems()
    expect(document.activeElement).toBe(a)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(b)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(c)

    // Boucle : Tab sur le dernier item revient au premier — le focus ne sort JAMAIS
    // du popover vers le reste de la page.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(a)

    // Shift+Tab : sens inverse, boucle aussi.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(c)
  })

  it('ouvre avec le focus sur le premier item, ArrowDown/ArrowUp déplacent le focus', () => {
    const anchor = makeAnchor()
    openMenuPopover(
      anchor,
      [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
      () => {}
    )
    const [a, b, c] = getItems()
    expect(document.activeElement).toBe(a)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(b)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(c)

    // Boucle : ArrowDown sur le dernier item revient au premier.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(a)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(document.activeElement).toBe(c)
  })

  it('Entrée sur l’item focus appelle onSelect avec sa valeur', () => {
    const anchor = makeAnchor()
    const selected = []
    openMenuPopover(
      anchor,
      [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      (v) => selected.push(v)
    )
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(selected).toEqual(['b'])
    expect(getPopover()).toBeNull()
  })

  it('ancre en position fixed au rect du déclencheur (top = bas du rect + 4px, left = rect.left)', () => {
    const anchor = makeAnchor({ left: 30, top: 50, bottom: 60 })
    openMenuPopover(anchor, [{ value: 'a', label: 'A' }], () => {})
    const popover = getPopover()
    expect(popover.style.position).toBe('fixed')
    expect(popover.style.top).toBe('64px') // rect.bottom (60) + 4
    expect(popover.style.left).toBe('30px') // pas de débordement à droite ici
  })

  // Piège identifié en revue : jsdom ne calcule aucune mise en page réelle
  // (offsetWidth vaut 0 par défaut sur tout élément), donc un test qui ne
  // stube QUE getBoundingClientRect passerait même si la clause anti-
  // débordement (Math.min ci-dessous) était supprimée du code — il ne
  // prouverait rien. Même remède que cm-number-prompt.spec.js (qui stube
  // scrollWidth/clientWidth/offsetHeight sur ses propres nœuds) : ici,
  // popover.offsetWidth est lu de façon SYNCHRONE dans openMenuPopover, avant
  // que le test ait pu récupérer le nœud pour le stuber — la seule fenêtre
  // possible est donc le prototype HTMLElement, restauré juste après.
  it('ajuste à gauche si le popover déborderait à droite de la fenêtre', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 300 })
    window.innerWidth = 320
    try {
      // rect.left = 250 : sans ajustement, le popover (300px) déborderait de
      // 250 + 300 = 550px, largement au-delà des 320px de la fenêtre.
      const anchor = makeAnchor({ left: 250, top: 50, bottom: 60 })
      openMenuPopover(anchor, [{ value: 'a', label: 'A' }], () => {})
      const popover = getPopover()
      // Math.min(250, 320 - 300 - 8) = Math.min(250, 12) = 12
      expect(popover.style.left).toBe('12px')
    } finally {
      if (originalDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalDescriptor)
      window.innerWidth = originalInnerWidth
    }
  })

  // Ajout au-delà du périmètre initial, qui ne posait que
  // `top = rect.bottom + 4` sans filet vertical (aucun consommateur réel n'existait
  // encore pour le mettre à l'épreuve). Mesuré Playwright réel à 360×740 : le popover Aide-mémoire (9 items, ~426px), ouvert depuis une puce de la
  // 2e ligne de la barre, débordait de ~58px sous la fenêtre — inatteignable, `position:
  // fixed` ne suit pas le défilement de PAGE. Même piège que le test précédent (jsdom
  // ne calcule aucune mise en page réelle, `offsetHeight` vaut 0 par défaut) : stub du
  // prototype, restauré en `finally`.
  it('plaque le popover contre le bas de la fenêtre si ni au-dessus ni en dessous ne suffit', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 300 })
    window.innerHeight = 320
    try {
      // rect.top = 50, rect.bottom = 60 : espace en dessous = 320-60-8 = 252 (< 300,
      // ne tient pas), espace au-dessus = 50-8 = 42 (encore moins) — aucun des deux
      // ne suffit, on plaque contre le bas : top = 320 - 300 - 8 = 12.
      const anchor = makeAnchor({ left: 20, top: 50, bottom: 60 })
      openMenuPopover(anchor, [{ value: 'a', label: 'A' }], () => {})
      const popover = getPopover()
      expect(popover.style.top).toBe('12px')
    } finally {
      if (originalDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalDescriptor)
      window.innerHeight = originalInnerHeight
    }
  })

  it('ouvre au-dessus de l’ancre si ça ne tient pas en dessous mais que ça tient mieux au-dessus', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 250 })
    window.innerHeight = 320
    try {
      // rect.top = 290, rect.bottom = 300 : espace en dessous = 320-300-8 = 12 (ne
      // tient pas), espace au-dessus = 290-8 = 282 (largement assez) — ouvre au-dessus :
      // top = rect.top - popoverHeight - 4 = 290 - 250 - 4 = 36.
      const anchor = makeAnchor({ left: 20, top: 290, bottom: 300 })
      openMenuPopover(anchor, [{ value: 'a', label: 'A' }], () => {})
      const popover = getPopover()
      expect(popover.style.top).toBe('36px')
    } finally {
      if (originalDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalDescriptor)
      window.innerHeight = originalInnerHeight
    }
  })

  it("un item disabled porte aria-disabled et la classe --disabled, affiche son hint, et le clic n'appelle pas onSelect ni ne ferme le popover", () => {
    const anchor = makeAnchor()
    const onSelect = () => {
      throw new Error('onSelect ne doit pas être appelé')
    }
    openMenuPopover(anchor, [{ value: 'a', label: 'A', disabled: true, hint: 'Explication' }], onSelect)
    const item = getItems()[0]
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(item.classList.contains('cm-menu-popover__item--disabled')).toBe(true)
    expect(item.textContent).toContain('A')
    expect(item.textContent).toContain('Explication')
    item.click()
    expect(getPopover()).not.toBeNull()
  })

  it('Entrée sur un item disabled focus ne ferme pas le popover ni n’appelle onSelect', () => {
    const anchor = makeAnchor()
    const onSelect = () => {
      throw new Error('onSelect ne doit pas être appelé')
    }
    openMenuPopover(anchor, [{ value: 'a', label: 'A', disabled: true, hint: 'Explication' }], onSelect)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(getPopover()).not.toBeNull()
  })

  it('un item sans hint ni disabled reste identique au comportement existant (rétrocompatibilité)', () => {
    const anchor = makeAnchor()
    const selected = []
    openMenuPopover(anchor, [{ value: 'a', label: 'A' }], (v) => selected.push(v))
    const item = getItems()[0]
    expect(item.getAttribute('aria-disabled')).toBeNull()
    expect(item.classList.contains('cm-menu-popover__item--disabled')).toBe(false)
    item.click()
    expect(selected).toEqual(['a'])
    expect(getPopover()).toBeNull()
  })

  // Revue tâche B (menu image à 2 niveaux) : le callback onSelect du popover
  // PRINCIPAL peut lui-même rouvrir un SECOND openMenuPopover sur LE MÊME anchorEl
  // avant de rendre la main (cf. openImageActionsMenu, cm-editor.js — choisir « Suivre
  // comme diagramme » ouvre le sous-popover de type depuis ce callback). Le clic
  // originel sur l'item du popover principal exécute alors, dans cet ordre :
  // onSelect() [qui ouvre le sous-popover, lequel ferme le principal puis pose
  // aria-expanded="true"] PUIS son propre close() [du popover PRINCIPAL, maintenant
  // périmé]. Sans garde, ce close() périmé écraserait aria-expanded="true" (posé par
  // le sous-popover, toujours affiché) par un "false" mensonger.
  it("ouvrir un second popover sur LE MÊME anchor DEPUIS onSelect laisse aria-expanded à 'true' (pas d'écrasement par la fermeture périmée du premier)", () => {
    const anchor = makeAnchor()
    openMenuPopover(anchor, [{ value: 'open-sub', label: 'Ouvrir le sous-menu' }], (value) => {
      if (value === 'open-sub') {
        openMenuPopover(anchor, [{ value: 'x', label: 'X' }], () => {})
      }
    })
    getItems()[0].click()
    // Le sous-popover est bien ouvert (1 seul popover à la fois, celui du sous-menu).
    expect(getItems().map((b) => b.textContent)).toEqual(['X'])
    expect(anchor.getAttribute('aria-expanded')).toBe('true')
  })
})

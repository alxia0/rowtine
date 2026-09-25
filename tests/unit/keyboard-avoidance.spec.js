// @vitest-environment jsdom
// Mécanisme global de remontée du champ actif au-dessus du clavier virtuel (retour
// terrain 29/07, cf. src/utils/keyboard-avoidance.js pour le raisonnement complet).
// Généralise et remplace les copies par écran de NeedleGaugeView.vue et
// ColorPickerDialog.vue — les 3 tests marqués « repris de needle-gauge-view.spec.js »
// vivaient là-bas avant ce lot.
//
// Limite assumée (cf. le plan) : jsdom ne calcule aucune vraie mise en page et
// Playwright n'a pas de clavier virtuel. Ce fichier vérifie que le mécanisme se
// déclenche sur les bons éléments, que `scrollIntoView` est appelé avec les bonnes
// options, que la marge basse est posée/retirée au bon moment, et que le
// scroll-margin-top est calculé — PAS qu'un champ est visible au-dessus d'un vrai
// clavier Android (hors de portée d'un test headless, cf. gate device).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isTextField,
  findScrollContainer,
  installKeyboardAvoidance,
} from '@/utils/keyboard-avoidance'

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

// Simule un conteneur RÉELLEMENT défilant : jsdom laisse toutes les dimensions de
// mise en page à 0, on les stub comme le fait déjà color-picker-dialog.spec.js pour
// getBoundingClientRect.
function stubBox(el, { scrollWidth = 100, clientWidth = 100, scrollHeight = 100, clientHeight = 100 } = {}) {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

describe('isTextField — filtre des champs concernés', () => {
  it('accepte <textarea>', () => {
    expect(isTextField(document.createElement('textarea'))).toBe(true)
  })

  it('accepte [contenteditable] (y compris injecté à l’exécution, ex. CodeMirror)', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    expect(isTextField(div)).toBe(true)
  })

  it('n’accepte PAS un contenteditable explicitement désactivé (contenteditable="false")', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'false')
    expect(isTextField(div)).toBe(false)
  })

  it.each(['text', 'number', 'search', 'email', 'tel', 'password', 'url'])(
    'accepte <input type="%s">',
    (type) => {
      const input = document.createElement('input')
      input.type = type
      expect(isTextField(input)).toBe(true)
    },
  )

  it('un <input> sans attribut type est un texte implicite (ex. inputmode="decimal" de NeedleGaugeView)', () => {
    const input = document.createElement('input')
    expect(isTextField(input)).toBe(true)
  })

  // Discriminant explicite : tests/e2e/checkbox.spec.js teste le focus clavier sur les
  // cases à cocher — si ce filtre les acceptait, ce test e2e casserait (défilement
  // inattendu au Tab sur une case). `date` est exclu pour la même raison que `select` :
  // Android ouvre un sélecteur natif (roue/calendrier), jamais le clavier virtuel — cf.
  // les champs de date de ProjectDetailView.vue/ProjectEditView.vue/StashView.vue.
  it.each(['checkbox', 'radio', 'button', 'file', 'color', 'range', 'date'])(
    'exclut <input type="%s">',
    (type) => {
      const input = document.createElement('input')
      input.type = type
      expect(isTextField(input)).toBe(false)
    },
  )

  it('exclut <select>', () => {
    expect(isTextField(document.createElement('select'))).toBe(false)
  })

  it('exclut <button>', () => {
    expect(isTextField(document.createElement('button'))).toBe(false)
  })
})

describe('findScrollContainer — remonte au premier ancêtre RÉELLEMENT défilant', () => {
  it('repli sur le document quand aucun ancêtre ne défile (cas de 15 des 17 écrans)', () => {
    const field = document.createElement('input')
    document.body.appendChild(field)
    expect(findScrollContainer(field)).toBe(document.documentElement)
    field.remove()
  })

  it('trouve une carte de dialogue défilante (overflow-y:auto, ex. .cpick__card/.ycn__card)', () => {
    const card = document.createElement('div')
    card.style.overflowY = 'auto'
    stubBox(card, { scrollWidth: 300, clientWidth: 300 }) // pas de débordement HORIZONTAL
    const field = document.createElement('input')
    card.appendChild(field)
    document.body.appendChild(card)
    expect(findScrollContainer(field)).toBe(card)
    card.remove()
  })

  // Sur Chromium réel (mesuré sur Nexus 7, 29/07), `overflow-x: auto` seul fait aussi
  // calculer `overflow-y: auto` (couplage CSS, absent de jsdom) : un bandeau de chips/
  // onglets se confondrait avec une carte de dialogue si on ne testait que le mot-clé.
  // On simule ici le pire cas (couplage + débordement horizontal réel) pour vérifier
  // que le débordement HORIZONTAL exclut bien ce conteneur.
  it('ignore un bandeau pensé pour un défilement HORIZONTAL, même si overflow-y calcule à auto', () => {
    const strip = document.createElement('div')
    strip.style.overflowX = 'auto'
    strip.style.overflowY = 'auto' // reproduit le couplage réel mesuré sur device
    stubBox(strip, { scrollWidth: 900, clientWidth: 300 }) // déborde bien en LARGEUR
    const field = document.createElement('input')
    strip.appendChild(field)
    document.body.appendChild(strip)
    expect(findScrollContainer(field)).toBe(document.documentElement)
    strip.remove()
  })

  it('ignore overflow-x:clip (ex. .panels de ProjectDetailView.vue) : ne coupe pas au document', () => {
    const panels = document.createElement('div')
    panels.style.overflowX = 'clip'
    const field = document.createElement('input')
    panels.appendChild(field)
    document.body.appendChild(panels)
    expect(findScrollContainer(field)).toBe(document.documentElement)
    panels.remove()
  })
})

describe('mécanisme global (focusin/focusout posés une fois sur document)', () => {
  let cleanupEls = []

  beforeEach(() => {
    installKeyboardAvoidance()
    cleanupEls = []
  })
  afterEach(() => {
    // Filet de sécurité : résout tout geste/retrait resté en attente si un test a
    // échoué en cours de route (état module partagé entre les tests de ce fichier).
    // Un pointeur resté « posé » ne s'effacerait sinon qu'au bout de `GESTURE_MAX_MS`
    // (secondes) : on annule explicitement tous les identifiants utilisés ici.
    // `pointercancel` et NON `pointerup` : lui seul vide le compte des pointeurs sans
    // DÉMARRER une fenêtre de grâce, qui déborderait sur le test suivant (150 ms, bien
    // plus que l'intervalle entre deux tests) et y ferait ARMER un retrait attendu
    // immédiat.
    //
    // ⚠️ Ce filet empêche d'en CRÉER une, il n'EFFACE PAS celle qu'un test a déjà posée :
    // `lastPointerUpAt` fuit d'un test à l'autre, notamment depuis « `pointerup` seul NE
    // résout PAS ». Les tests qui attendent un retrait IMMÉDIAT après une fuite possible
    // doivent donc franchir la fenêtre eux-mêmes par une vraie attente (c'est ce que font
    // les `setTimeout(200)`/`(250)` de ce fichier — ils ne sont pas décoratifs).
    for (const id of [undefined, 1, 2, 3]) {
      const ev = new Event('pointercancel', { bubbles: true })
      Object.defineProperty(ev, 'pointerId', { value: id })
      document.dispatchEvent(ev)
    }
    cleanupEls.forEach((el) => el.remove())
    document.documentElement.style.paddingBottom = ''
  })

  function makeField(type) {
    const el = document.createElement(type === 'textarea' ? 'textarea' : 'input')
    if (type !== 'textarea') el.type = type
    el.scrollIntoView = vi.fn()
    document.body.appendChild(el)
    cleanupEls.push(el)
    return el
  }

  // Repris de needle-gauge-view.spec.js (« recentre un champ de saisie… ») : même
  // assertion, portée par le mécanisme global plutôt que par l'écran.
  it('recentre un champ de saisie au focus : scrollIntoView appelé avec les bonnes options', async () => {
    const input = makeField('text')
    input.focus()
    await nextFrame()
    await nextFrame()
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  // ⚠️ CRITIQUE DE REVUE (30/07), 3e passe : `behavior: 'smooth'` était passé EN DUR.
  // `tokens.css` impose pourtant `scroll-behavior: auto !important` sous « réduire les
  // animations » — mais cette règle CSS ne gouverne pas un `behavior` passé en argument
  // JavaScript (mesuré en Blink : le défilement restait animé, préférence active).
  it('respecte « réduire les animations » : behavior auto au lieu de smooth', async () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }))
    try {
      const input = makeField('text')
      input.focus()
      await nextFrame()
      await nextFrame()
      expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    } finally {
      window.matchMedia = original
    }
  })

  // ⚠️ CRITIQUE DE REVUE (30/07), 3e passe : le `requestAnimationFrame` différé ne
  // revérifiait pas son état. Si le champ perd le focus dans la MÊME frame, `removeNow`
  // est déjà passé — le rAF défilait quand même et reposait un `scroll-margin-top` que
  // plus rien ne viendrait jamais nettoyer.
  it('le rAF différé ne fait rien si le champ a perdu le focus dans la même frame', async () => {
    const input = makeField('text')
    input.focus()
    input.blur() // même frame : `removeNow` passe AVANT que le rAF ne s'exécute
    await nextFrame()
    await nextFrame()

    expect(input.scrollIntoView).not.toHaveBeenCalled()
    expect(input.style.scrollMarginTop).toBe('') // rien de posé définitivement
    expect(document.documentElement.style.paddingBottom).toBe('')
  })

  // Même garde, autre chemin : un AUTRE champ prend le focus dans la même frame — le
  // rAF du premier ne doit pas défiler vers un champ qui n'a plus le focus.
  it('le rAF différé ne fait rien si un AUTRE champ a pris le focus dans la même frame', async () => {
    const first = makeField('text')
    const second = makeField('text')
    first.focus()
    second.focus()
    await nextFrame()
    await nextFrame()

    expect(first.scrollIntoView).not.toHaveBeenCalled()
    expect(first.style.scrollMarginTop).toBe('')
    expect(second.scrollIntoView).toHaveBeenCalled()
  })

  // Repris de needle-gauge-view.spec.js (« ne recentre rien au focus d'un bouton… »).
  it('ne recentre rien au focus d’un bouton (seulement les champs de saisie)', async () => {
    const button = document.createElement('button')
    button.scrollIntoView = vi.fn()
    document.body.appendChild(button)
    cleanupEls.push(button)
    button.focus()
    await nextFrame()
    await nextFrame()
    expect(button.scrollIntoView).not.toHaveBeenCalled()
  })

  it('PAS de setTimeout(300) : une seule frame suffit, scrollIntoView n’est pas encore appelé juste après le focus', async () => {
    const input = makeField('text')
    input.focus()
    // Volontairement AUCUNE attente ici : au tick synchrone qui suit le focus, la
    // frame de mesure n'a pas encore tourné.
    expect(input.scrollIntoView).not.toHaveBeenCalled()
    await nextFrame()
    await nextFrame()
    expect(input.scrollIntoView).toHaveBeenCalled()
  })

  it('pose une marge basse (45vh) sur le conteneur défilant pendant le focus, la retire au blur', async () => {
    const input = makeField('text')
    input.focus()
    await nextFrame()
    expect(document.documentElement.style.paddingBottom).toBe('45vh')
    input.blur()
    expect(document.documentElement.style.paddingBottom).toBe('')
  })

  it('bascule la marge basse d’un conteneur à l’autre quand le focus change de champ', async () => {
    const card = document.createElement('div')
    card.style.overflowY = 'auto'
    stubBox(card, { scrollWidth: 300, clientWidth: 300 })
    document.body.appendChild(card)
    cleanupEls.push(card)
    const inCard = document.createElement('input')
    inCard.scrollIntoView = vi.fn()
    card.appendChild(inCard)

    const onPage = makeField('text')

    onPage.focus()
    await nextFrame()
    expect(document.documentElement.style.paddingBottom).toBe('45vh')

    inCard.focus()
    await nextFrame()
    expect(document.documentElement.style.paddingBottom).toBe('') // rendue par le champ précédent
    expect(card.style.paddingBottom).toBe('45vh')
  })

  // Repris de needle-gauge-view.spec.js (« mesure la VRAIE hauteur du bandeau… »,
  // retour terrain 22/07 : une valeur figée en CSS avait sous-estimé le bandeau réel).
  // Le bandeau doit être RÉELLEMENT collant (`position: sticky`) pour être détecté —
  // cf. `measureStickyTopHeight`, qui découvre les bandeaux au lieu d'en nommer un
  // seul (AMENDEMENT du 29/07 : un écran peut en empiler plusieurs, cf. tests dédiés
  // plus bas).
  it('mesure la VRAIE hauteur du bandeau <header> de la page et la pose en scroll-margin-top (+16)', async () => {
    const header = document.createElement('header')
    header.style.position = 'sticky'
    header.style.top = '0px'
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      height: 101, top: 0, bottom: 101, left: 0, right: 375, width: 375, x: 0, y: 0, toJSON() {},
    })
    document.body.appendChild(header)
    cleanupEls.push(header)

    const input = makeField('text')
    input.focus()
    await nextFrame()
    await nextFrame()
    expect(input.style.scrollMarginTop).toBe('117px') // 101 (bandeau réel) + 16 (respiration)
  })

  // Point relevé à la revue (avant ce lot, le champ hexa de ColorPickerDialog utilisait
  // la même mesure de bandeau que la PAGE — or le bandeau de page n'existe pas/ne
  // recouvre rien à l'intérieur d'une carte de dialogue, dont l'en-tête n'est pas
  // collant). Un champ dans une carte défilante ne doit PAS hériter du bandeau de page.
  it('ne mesure PAS le bandeau de page pour un champ dans une carte de dialogue défilante', async () => {
    const header = document.createElement('header')
    header.style.position = 'sticky'
    header.style.top = '0px'
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      height: 101, top: 0, bottom: 101, left: 0, right: 375, width: 375, x: 0, y: 0, toJSON() {},
    })
    document.body.appendChild(header)
    cleanupEls.push(header)

    const card = document.createElement('div')
    card.style.overflowY = 'auto'
    stubBox(card, { scrollWidth: 300, clientWidth: 300 })
    document.body.appendChild(card)
    cleanupEls.push(card)
    const inCard = document.createElement('input')
    inCard.scrollIntoView = vi.fn()
    card.appendChild(inCard)

    inCard.focus()
    await nextFrame()
    await nextFrame()
    expect(inCard.style.scrollMarginTop).toBe('16px') // 0 (pas de bandeau à dégager ici) + 16
  })

  // AMENDEMENT du 29/07 : sur l'écran de correction de patron, AppHeader ET le bandeau
  // de l'éditeur sont tous deux collants et empilés — le mécanisme doit mesurer le bas
  // du DERNIER bandeau, pas juste le premier `<header>` trouvé. Ce bandeau s'appelle
  // `.rte__bar` depuis leur fusion (il portait le nom `.rte__controls` quand ce
  // test a été écrit, avant que les deux barres n'en fassent une) ; la fixture ci-dessous
  // reste synthétique et ne nomme aucune classe réelle, c'est tout l'intérêt du mécanisme
  // (il DÉCOUVRE les bandeaux par leur `position: sticky`, cf. sticky-top.js).
  it('empile plusieurs bandeaux collants (ex. AppHeader + `.rte__bar` de l’écran de correction)', async () => {
    const header = document.createElement('header')
    header.style.position = 'sticky'
    header.style.top = '0px'
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      height: 101, top: 0, bottom: 101, left: 0, right: 375, width: 375, x: 0, y: 0, toJSON() {},
    })
    document.body.appendChild(header)
    cleanupEls.push(header)

    const controls = document.createElement('div')
    controls.style.position = 'sticky'
    controls.style.top = '101px' // se cale sous le bandeau ci-dessus, comme `.rte__bar`
    vi.spyOn(controls, 'getBoundingClientRect').mockReturnValue({
      height: 60, top: 101, bottom: 161, left: 0, right: 375, width: 375, x: 0, y: 0, toJSON() {},
    })
    document.body.appendChild(controls)
    cleanupEls.push(controls)

    const input = makeField('text')
    input.focus()
    await nextFrame()
    await nextFrame()
    expect(input.style.scrollMarginTop).toBe('177px') // 161 (bas du 2e bandeau) + 16
  })

  // Un bandeau collé en BAS (ex. `.correct__actions`, `.onb__cta-bar`) n'a pas de `top`
  // fini : il ne doit JAMAIS être compté comme un bandeau de HAUT de page.
  it('ignore un bandeau collant posé en BAS (top:auto) dans la mesure du scroll-margin-top', async () => {
    const bottomBar = document.createElement('div')
    bottomBar.style.position = 'sticky'
    bottomBar.style.bottom = '0px' // pas de `top` posé : calcule `top: auto`
    vi.spyOn(bottomBar, 'getBoundingClientRect').mockReturnValue({
      height: 80, top: 900, bottom: 980, left: 0, right: 375, width: 375, x: 0, y: 0, toJSON() {},
    })
    document.body.appendChild(bottomBar)
    cleanupEls.push(bottomBar)

    const input = makeField('text')
    input.focus()
    await nextFrame()
    await nextFrame()
    expect(input.style.scrollMarginTop).toBe('16px') // aucun bandeau de HAUT : repli à 0 + 16
  })

  // Discriminant : un élément avec un `top` numérique mais qui n'est PAS collant
  // (ex. `position: relative`, une mise en page ordinaire) ne doit jamais être compté
  // comme un bandeau — sinon un simple élément positionné n'importe où sur la page
  // gonflerait le scroll-margin-top à tort.
  it('ignore un élément avec un `top` numérique qui n’est PAS `position: sticky`', async () => {
    const notSticky = document.createElement('div')
    notSticky.style.position = 'relative'
    notSticky.style.top = '50px'
    vi.spyOn(notSticky, 'getBoundingClientRect').mockReturnValue({
      height: 200, top: 50, bottom: 250, left: 0, right: 375, width: 375, x: 0, y: 0, toJSON() {},
    })
    document.body.appendChild(notSticky)
    cleanupEls.push(notSticky)

    const input = makeField('text')
    input.focus()
    await nextFrame()
    await nextFrame()
    expect(input.style.scrollMarginTop).toBe('16px') // aucun bandeau COLLANT : repli à 0 + 16
  })

  // Discriminant : un élément `position: sticky` avec un `top` fini mais TRÈS loin du
  // haut (ex. un futur module collant plus bas dans une longue page) ne doit pas être
  // confondu avec un bandeau empilé au SOMMET — garde-fou explicite (`top > 300`).
  it('ignore un élément collant dont le `top` est trop loin du sommet pour être un bandeau empilé', async () => {
    const farSticky = document.createElement('div')
    farSticky.style.position = 'sticky'
    farSticky.style.top = '1000px'
    vi.spyOn(farSticky, 'getBoundingClientRect').mockReturnValue({
      height: 50, top: 1000, bottom: 1050, left: 0, right: 375, width: 375, x: 0, y: 0, toJSON() {},
    })
    document.body.appendChild(farSticky)
    cleanupEls.push(farSticky)

    const input = makeField('text')
    input.focus()
    await nextFrame()
    await nextFrame()
    expect(input.style.scrollMarginTop).toBe('16px') // trop loin du sommet : repli à 0 + 16
  })

  it('nettoie le scroll-margin-top posé au focus quand le champ perd le focus', async () => {
    const input = makeField('text')
    input.focus()
    await nextFrame()
    await nextFrame()
    expect(input.style.scrollMarginTop).not.toBe('')
    input.blur()
    expect(input.style.scrollMarginTop).toBe('')
  })

  // ⚠️ CRITIQUE DE REVUE (29/07) — défaut bloquant : retirer la marge basse DÈS le
  // `focusout` déplace la mise en page SOUS le doigt entre l'appui (`pointerdown`) et le
  // relâchement (`pointerup`/`click`), et fait rater la cible visée (mesuré : 5 tests
  // e2e rouges, bouton visé à 464 retrouvé à 888 en cours de geste). Le retrait doit
  // attendre la fin du geste.
  describe('retrait différé pendant un geste tactile (2 défauts bloquants corrigés : 29/07 puis 30/07)', () => {
    it('un focusout SANS pointerdown préalable (tabulation) retire la marge immédiatement', async () => {
      const input = makeField('text')
      input.focus()
      await nextFrame()
      expect(document.documentElement.style.paddingBottom).toBe('45vh')
      input.blur() // pas de pointerdown avant : aucun geste à protéger
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    it('un focusout PRÉCÉDÉ d’un pointerdown ailleurs NE retire PAS la marge tout de suite', async () => {
      const input = makeField('text')
      const button = document.createElement('button')
      document.body.appendChild(button)
      cleanupEls.push(button)

      input.focus()
      await nextFrame()
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      // Ordre mesuré sur device : pointerdown → focusout → pointerup → click.
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      input.blur() // focusout simulé (jsdom ne le fait pas tout seul sans un vrai focus ailleurs)
      // La marge doit encore être là : le clic n'est pas terminé, bouger la page
      // maintenant ferait rater la cible visée.
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      button.dispatchEvent(new Event('click', { bubbles: true }))
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    // ⚠️ CRITIQUE DE REVUE (30/07), défaut bloquant n°2 : mesuré au VRAI toucher sur
    // device (`Input.dispatchTouchEvent`), `pointerup` retire la marge AVANT que Blink
    // n'ait réparti les évènements souris de compatibilité (nouveau test de position) —
    // le clic atterrissait sur le mauvais élément (`H2.card__title` au lieu du bouton
    // Enregistrer). Ce piège est invisible à Playwright (pilote la souris pure, un autre
    // chemin dans Blink) : seule la mesure tactile réelle le révèle — ce test vérifie
    // seulement que `pointerup` seul (sans `click` ensuite) NE résout PAS, ce que jsdom
    // peut prouver ; la preuve du bon comportement au TOUCHER réel est dans le rapport.
    it('`pointerup` seul NE résout PAS le retrait — seul `click` (ou `pointercancel`) le fait', async () => {
      const input = makeField('text')
      const button = document.createElement('button')
      document.body.appendChild(button)
      cleanupEls.push(button)

      input.focus()
      await nextFrame()
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      input.blur()
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      button.dispatchEvent(new Event('pointerup', { bubbles: true }))
      // Toujours en place : `pointerup` ne résout plus rien (piège n°2).
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      button.dispatchEvent(new Event('click', { bubbles: true }))
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    it('résout aussi au `pointercancel` (geste qui n’aboutit jamais à un clic)', async () => {
      const input = makeField('text')
      const button = document.createElement('button')
      document.body.appendChild(button)
      cleanupEls.push(button)

      input.focus()
      await nextFrame()
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      input.blur()
      expect(document.documentElement.style.paddingBottom).toBe('45vh')
      button.dispatchEvent(new Event('pointercancel', { bubbles: true }))
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    // ⚠️ CRITIQUE DE REVUE (30/07), défaut bloquant n°3 — RÉGRESSION introduite par le
    // correctif du 29/07 : armer un retrait dès qu'un `pointerdown` touche ailleurs que
    // le champ actif (SANS attendre un vrai `focusout`) casse un balayage de défilement
    // fait PENDANT qu'un champ garde le focus (mesuré : Notes repartait sous le clavier
    // en PLEIN balayage, `activeElement` restait pourtant le champ — aucun `focusin` ne
    // repasse jamais, la marge ne revenait plus). Un geste ne doit que DIFFÉRER un
    // retrait DÉJÀ demandé par un VRAI `focusout`, jamais en déclencher un lui-même.
    it('un balayage (pointerdown ailleurs SANS focusout, puis pointercancel) NE retire PAS la marge — le champ garde le focus', async () => {
      const input = makeField('text')
      const elsewhere = document.createElement('div')
      document.body.appendChild(elsewhere)
      cleanupEls.push(elsewhere)

      input.focus()
      await nextFrame()
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      // Le champ ne perd JAMAIS le focus ici (comme un vrai balayage de défilement) :
      // aucun `blur()`/`focusout` n'est simulé, uniquement le geste tactile.
      elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      elsewhere.dispatchEvent(new Event('pointercancel', { bubbles: true }))
      expect(document.documentElement.style.paddingBottom).toBe('45vh')
      expect(input.style.scrollMarginTop).not.toBe('')
    })

    // Le bouton retour Android ferme le clavier natif SANS déclencher `blur` DOM (mesuré
    // et documenté dans ColorPickerDialog.vue : `activeElement` reste le champ). Sans
    // armement au `pointerdown` (retiré pour corriger la régression ci-dessus), ce cas
    // n'est couvert QUE si l'interaction suivante déclenche un VRAI `focusout` — ex.
    // taper un AUTRE champ/contrôle focalisable, qui referme normalement le précédent.
    // Compromis assumé (documenté en tête de fichier) : le cas du balayage, très
    // courant, prime sur celui-ci, plus rare.
    it('couvre le cas « retour Android ferme le clavier sans blur » SI l’interaction suivante déclenche un vrai focusout', async () => {
      const input = makeField('text')
      const button = document.createElement('button')
      document.body.appendChild(button)
      cleanupEls.push(button)

      input.focus()
      await nextFrame()
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      // Simule le clavier fermé par le bouton retour (le champ reste focus) PUIS un
      // toucher sur un contrôle qui referme réellement le champ (focusout réel).
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      input.blur()
      button.dispatchEvent(new Event('click', { bubbles: true }))
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    // Mineur relevé à la revue : si NI `click` NI `pointercancel` n'arrive jamais après
    // un retrait armé (ex. le geste sort de la WebView vers une liste native), la marge
    // resterait bloquée jusqu'à la prochaine résolution. Un NOUVEAU geste, ailleurs,
    // prouve que le précédent est bel et bien terminé : son propre `pointerdown` résout
    // ce qui est resté en attente, avant de suivre son propre geste.
    it('un nouveau pointerdown résout un retrait resté armé d’un geste précédent jamais terminé', async () => {
      const input = makeField('text')
      const button = document.createElement('button')
      document.body.appendChild(button)
      cleanupEls.push(button)

      input.focus()
      await nextFrame()
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      input.blur() // arme le retrait
      expect(document.documentElement.style.paddingBottom).toBe('45vh')
      // AUCUN pointerup/click/pointercancel n'arrive jamais ici (geste sorti de la WebView).

      const other = document.createElement('div')
      document.body.appendChild(other)
      cleanupEls.push(other)
      other.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    // ⚠️ CRITIQUE DE REVUE (30/07), 2e passe — RÉGRESSION introduite par le retrait de
    // `pointerup` (piège n°2) : plus rien ne remettait le suivi de geste à zéro pour un
    // geste terminé sans `click`. Conséquence mesurée : champ actif, pincement, puis
    // navigation → le `focusout` du changement d'écran prenait à tort la branche ARMER
    // (suivi resté « collé ») au lieu du retrait immédiat, et l'écran suivant conservait
    // 45vh de vide défilable.
    //
    // ⚠️ 3e passe (30/07) : ce test posait un `pointerdown` puis attendait 250 ms avant
    // le `focusout`, en exigeant le retrait IMMÉDIAT. Au niveau DOM, c'est exactement
    // indiscernable d'un APPUI DÉLIBÉRÉ DE 250 ms sur un bouton — il affirmait donc que
    // le comportement CASSÉ (piège n°5, le bug d'origine) était le bon. Réécrit, pas
    // re-seuillé : un pincement se décrit par des pointeurs qui sont descendus ET
    // REPARTIS (`pointerId` explicites : `new Event` n'en porte pas), ce qui ne dépend
    // plus du tout de l'expiration de la soupape.
    function pointerEvent(type, pointerId) {
      const ev = new Event(type, { bubbles: true })
      Object.defineProperty(ev, 'pointerId', { value: pointerId })
      return ev
    }

    it('un pincement à deux doigts terminé n’empêche pas un focusout PLUS TARD de retirer immédiatement', async () => {
      const input = makeField('text')
      const elsewhere = document.createElement('div')
      document.body.appendChild(elsewhere)
      cleanupEls.push(elsewhere)

      input.focus()
      await nextFrame()
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      // Pincement mesuré en Blink : `pointerdown#2 pointerdown#3 pointercancel#2
      // pointercancel#3` — deux doigts posés, puis annulés (jamais de `click`).
      elsewhere.dispatchEvent(pointerEvent('pointerdown', 2))
      elsewhere.dispatchEvent(pointerEvent('pointerdown', 3))
      elsewhere.dispatchEvent(pointerEvent('pointercancel', 2))
      elsewhere.dispatchEvent(pointerEvent('pointercancel', 3))

      // Au-delà de la fenêtre de grâce qui suit la relâche (délai réel, pas de minuteur
      // simulé : la garde utilise `performance.now()`), plus aucun geste à protéger.
      await new Promise((resolve) => setTimeout(resolve, 250))
      input.blur()
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    // ⚠️ CRITIQUE DE REVUE (30/07), 3e passe — PIÈGE N°5, le bug d'ORIGINE rouvert : la
    // garde du tour précédent bornait `pointerdown → focusout`, c'est-à-dire la durée
    // pendant laquelle le DOIGT RESTE POSÉ — une grandeur choisie par l'utilisatrice,
    // donc non bornable. Mesuré au toucher réel (`Input.dispatchTouchEvent`), champ actif
    // et page en butée, bouton Enregistrer visé : 80 ms → `save`, mais 300 ms → `MAIN`
    // et 600 ms → `MAIN`. Un appui délibéré de 300 ms sur tablette est ordinaire :
    // « Enregistrer n'enregistre pas ». Le bon discriminant est la RELÂCHE.
    //
    // Ce test-ci est la partie prouvable par jsdom : un appui LONG (délai réel) ne doit
    // pas faire retirer la marge tant que le pointeur n'est pas relâché. La preuve du
    // comportement au TOUCHER RÉEL (souris ≠ tactile dans Blink) est dans le rapport.
    it('un appui LONG (300 ms, pointeur encore posé) diffère le retrait — la mise en page ne bouge pas sous le doigt', async () => {
      const input = makeField('text')
      const button = document.createElement('button')
      document.body.appendChild(button)
      cleanupEls.push(button)

      input.focus()
      await nextFrame()
      button.dispatchEvent(pointerEvent('pointerdown', 1))

      // Le doigt reste posé 300 ms — bien au-delà de l'ancienne fenêtre de 150 ms.
      await new Promise((resolve) => setTimeout(resolve, 300))
      input.blur() // le `focusout` d'un toucher arrive à la FIN du geste
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      button.dispatchEvent(pointerEvent('pointerup', 1))
      // `pointerup` ne résout toujours rien (piège n°2) : `click` n'a pas encore eu lieu.
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      button.dispatchEvent(new Event('click', { bubbles: true }))
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    // Voie TACTILE : là, le `focusout` arrive JUSTE APRÈS `pointerup` (mesuré 0-1 ms) —
    // le compte des pointeurs est déjà retombé à zéro, seule la fenêtre de grâce protège.
    //
    // Limite mesurée de ce test (preuve par mutation, 30/07) : SUPPRIMER entièrement
    // l'écouteur `pointerup` le laisse VERT — le compte des pointeurs, jamais décrémenté,
    // couvre alors le cas à sa place. Les deux termes se recouvrent sur un geste court ;
    // la mutation qui isole VRAIMENT celui-ci est « `pointerup` décompte mais n'horodate
    // plus la relâche » (vérifiée rouge). C'est cet horodatage qui est porteur.
    // Le test suivant ferme la mutation restée verte.
    it('sur la voie tactile (focusout APRÈS pointerup), la fenêtre de grâce diffère encore le retrait', async () => {
      const input = makeField('text')
      const button = document.createElement('button')
      document.body.appendChild(button)
      cleanupEls.push(button)

      input.focus()
      await nextFrame()
      button.dispatchEvent(pointerEvent('pointerdown', 1))
      button.dispatchEvent(pointerEvent('pointerup', 1))
      input.blur() // ordre réel mesuré : pointerup → mousedown → focusout → click
      expect(document.documentElement.style.paddingBottom).toBe('45vh')

      button.dispatchEvent(new Event('click', { bubbles: true }))
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    // ⚠️ Ferme la mutation « supprimer l'écouteur `pointerup` » restée VERTE à la 4e passe.
    // Sans cet écouteur, le pointeur n'est JAMAIS retiré du compte : un geste pourtant
    // terminé (appui, relâche, clic) laisse le mécanisme croire indéfiniment — enfin,
    // jusqu'à l'expiration de la soupape, soit des SECONDES — qu'un doigt est encore posé.
    // Conséquence : un `focusout` sans aucun rapport (tabulation, changement d'écran)
    // prend à tort la branche ARMER et l'écran garde 45vh de vide défilable. Ce n'est donc
    // pas une propriété redondante du mécanisme, c'est une vraie lacune.
    it('après un geste COMPLET, un focusout sans rapport retire immédiatement (le pointeur a bien été décompté)', async () => {
      const input = makeField('text')
      const button = document.createElement('button')
      document.body.appendChild(button)
      cleanupEls.push(button)

      // Geste complet et terminé, ailleurs.
      button.dispatchEvent(pointerEvent('pointerdown', 1))
      button.dispatchEvent(pointerEvent('pointerup', 1))
      button.dispatchEvent(new Event('click', { bubbles: true }))

      // Au-delà de la fenêtre de grâce : plus AUCUN geste à protéger. Seul le compte des
      // pointeurs pourrait encore prétendre le contraire — il ne le doit pas.
      await new Promise((resolve) => setTimeout(resolve, 200))
      input.focus()
      await nextFrame()
      expect(document.documentElement.style.paddingBottom).toBe('45vh')
      input.blur()
      expect(document.documentElement.style.paddingBottom).toBe('')
    })

    // `click` n'est PAS un évènement de pointeur : s'il décrémentait aussi le compte des
    // pointeurs, celui-ci passerait sous zéro et un appui ULTÉRIEUR ne serait plus vu
    // comme « geste en cours » — le piège n°5 reviendrait par intermittence.
    it('un cycle complet appui/relâche/clic laisse le compte des pointeurs sain pour le geste SUIVANT', async () => {
      const input = makeField('text')
      const button = document.createElement('button')
      document.body.appendChild(button)
      cleanupEls.push(button)

      // 1er geste complet, sans rapport avec un champ.
      button.dispatchEvent(pointerEvent('pointerdown', 1))
      button.dispatchEvent(pointerEvent('pointerup', 1))
      button.dispatchEvent(new Event('click', { bubbles: true }))

      // 2e geste : appui long sur le bouton pendant qu'un champ a le focus.
      input.focus()
      await nextFrame()
      button.dispatchEvent(pointerEvent('pointerdown', 1))
      await new Promise((resolve) => setTimeout(resolve, 300))
      input.blur()
      expect(document.documentElement.style.paddingBottom).toBe('45vh')
    })
  })

  describe('champ [contenteditable] : viser le CURSEUR, pas l’élément entier (défaut bloquant corrigé le 30/07)', () => {
    // jsdom n'implémente pas Range.prototype.getBoundingClientRect (vérifié empiriquement :
    // absent, lève une TypeError) : on l'ajoute pour la durée du test, comme
    // getBoundingClientRect est déjà stubbé ailleurs dans ce fichier pour les éléments.
    function stubCaret(el, rectPatch) {
      const range = document.createRange()
      range.selectNodeContents(el)
      range.getBoundingClientRect = () => ({
        top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rectPatch,
      })
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }

    function makeEditable() {
      const el = document.createElement('div')
      el.setAttribute('contenteditable', 'true')
      el.scrollIntoView = vi.fn()
      document.body.appendChild(el)
      cleanupEls.push(el)
      return el
    }

    // ⚠️ CRITIQUE DE REVUE (30/07), défaut bloquant n°3 (éditeur de correction) : mesuré
    // en touchant une ligne au milieu d'un vrai patron, `scrollIntoView` sur l'élément
    // [contenteditable] entier (`.cm-content`, qui peut mesurer des milliers de points
    // de haut) amenait la ligne éditée à ~1025 — 81 points sous une fenêtre de 944,
    // TOUJOURS hors écran. Corrigé en visant le rectangle du CURSEUR
    // (`window.getSelection()`), pas celui de l'élément.
    it('défile le CONTENEUR (pas scrollIntoView sur l’élément) jusqu’à ce que le CURSEUR soit sous le scroll-margin-top', async () => {
      const el = makeEditable()
      document.documentElement.scrollBy = vi.fn()

      el.focus() // AVANT le stub : jsdom pose sa propre sélection par défaut au focus
      stubCaret(el, { top: 1025, height: 20 })
      await nextFrame()
      await nextFrame()

      expect(el.scrollIntoView).not.toHaveBeenCalled() // PAS l'élément entier
      expect(document.documentElement.scrollBy).toHaveBeenCalledTimes(1)
      const call = document.documentElement.scrollBy.mock.calls[0][0]
      expect(call.top).toBe(1025 - 16) // curseur amené juste sous le repli (0 bandeau + 16 ici)
    })

    it('ne défile pas si le curseur est déjà à sa place (à moins de 4px du scroll-margin-top)', async () => {
      const el = makeEditable()
      document.documentElement.scrollBy = vi.fn()

      el.focus()
      stubCaret(el, { top: 18, height: 20 }) // 18 ≈ 16 (scroll-margin-top) : déjà en place
      await nextFrame()
      await nextFrame()

      expect(document.documentElement.scrollBy).not.toHaveBeenCalled()
    })

    it('se replie sur scrollIntoView si aucun rectangle de curseur n’est lisible (pas encore de sélection)', async () => {
      const el = makeEditable()
      document.documentElement.scrollBy = vi.fn()

      el.focus()
      // Rectangle tout à zéro (largeur ET hauteur ET position nulles) : le signal
      // « rien d'exploitable » que `caretRect` reconnaît — cf. son commentaire.
      stubCaret(el, {})
      await nextFrame()
      await nextFrame()

      expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
      expect(document.documentElement.scrollBy).not.toHaveBeenCalled()
    })

    // Un <textarea>/<input> normal n'a pas de curseur exposé par `window.getSelection()`
    // de cette façon : doit continuer à utiliser `scrollIntoView`, comportement inchangé.
    it('un champ NORMAL (pas contenteditable) continue d’utiliser scrollIntoView sur l’élément', async () => {
      const input = makeField('text')
      input.focus()
      await nextFrame()
      await nextFrame()
      expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    })

    // ⚠️ CRITIQUE DE REVUE (30/07), 2e passe : sur une ligne VIDE (le geste le plus
    // courant de cet écran — ajouter du texte), `Range.getBoundingClientRect()` renvoie
    // un rectangle NUL 5 fois sur 5 (mesuré) — l'ancre de la sélection y est un nœud
    // ÉLÉMENT, pas un nœud texte. Sans repli dédié, on retombait sur `scrollIntoView` de
    // TOUT l'élément [contenteditable] — exactement le défaut du bloquant n°3 (1re passe)
    // qu'on venait de corriger, non couvert sur ce chemin précis. `caretRect` doit se
    // replier sur le rectangle de l'ÉLÉMENT qui contient le curseur (ici simulé par
    // `emptyLine`, jamais nommé `.cm-line` dans le code — générique).
    it('sur une ligne VIDE (rectangle du Range nul), vise le rectangle de l’ÉLÉMENT qui contient le curseur — jamais scrollIntoView sur l’élément entier', async () => {
      const el = makeEditable()
      document.documentElement.scrollBy = vi.fn()

      const emptyLine = document.createElement('div') // simule une ligne vide (ex. .cm-line)
      emptyLine.getBoundingClientRect = () => ({
        top: 796, bottom: 816, left: 0, right: 300, width: 300, height: 20, x: 0, y: 0, toJSON() {},
      })
      el.appendChild(emptyLine)

      el.focus()
      // Range nul (comme mesuré sur une ligne vide), MAIS l'ancre de la sélection est
      // l'élément-ligne lui-même, qui a une vraie mise en page.
      const range = document.createRange()
      range.selectNodeContents(emptyLine)
      range.getBoundingClientRect = () => ({
        top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {},
      })
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      await nextFrame()
      await nextFrame()

      expect(el.scrollIntoView).not.toHaveBeenCalled() // PAS l'élément [contenteditable] entier
      expect(document.documentElement.scrollBy).toHaveBeenCalledTimes(1)
      const call = document.documentElement.scrollBy.mock.calls[0][0]
      expect(call.top).toBe(796 - 16) // rectangle de la LIGNE, pas de l'éditeur entier
    })

    // Mineur relevé à la revue : `scrollCaretIntoView` doit utiliser le conteneur
    // RÉELLEMENT défilant qui lui est transmis, pas `document.documentElement` en dur —
    // chemin non atteignable aujourd'hui (aucun [contenteditable] de l'app ne vit dans
    // une carte de dialogue), mais à couvrir pour ne pas régresser silencieusement le
    // jour où ça change.
    it('défile le conteneur RÉELLEMENT transmis (pas document en dur) quand un [contenteditable] vit dans une carte défilante', async () => {
      const card = document.createElement('div')
      card.style.overflowY = 'auto'
      stubBox(card, { scrollWidth: 300, clientWidth: 300 })
      card.scrollBy = vi.fn()
      document.body.appendChild(card)
      cleanupEls.push(card)
      document.documentElement.scrollBy = vi.fn()

      const el = document.createElement('div')
      el.setAttribute('contenteditable', 'true')
      el.scrollIntoView = vi.fn()
      Object.defineProperty(el, 'offsetHeight', { value: 10, configurable: true }) // petit devant la carte
      card.appendChild(el)

      el.focus()
      stubCaret(el, { top: 500, height: 20 })
      await nextFrame()
      await nextFrame()

      expect(card.scrollBy).toHaveBeenCalledTimes(1)
      expect(document.documentElement.scrollBy).not.toHaveBeenCalled()
    })
  })
})

describe('isVerticalScrollBox (via findScrollContainer) — teste la HAUTEUR, pas la largeur', () => {
  // ⚠️ CRITIQUE DE REVUE (29/07), 2e défaut bloquant : `.cm-scroller` (thème de BASE de
  // la dépendance @codemirror/view, jamais écrit dans ce dépôt) pose `overflow-x: auto`
  // → calcule aussi `overflow-y: auto` (couplage mesuré) → le retour à la ligne annule
  // son débordement horizontal → le garde-fou précédent (largeur seule) le laissait
  // passer, alors qu'il NE DÉFILE PAS verticalement (`scrollHeight == clientHeight`,
  // mesuré). Conséquence mesurée : 45vh injectés DANS l'éditeur, la ligne où l'on écrit
  // passait de 726 (visible) à 1927 (bien sous l'écran).
  it('rejette un conteneur que le CHAMP REMPLIT entièrement (ex. .cm-content dans .cm-scroller)', () => {
    const scroller = document.createElement('div')
    scroller.style.overflowX = 'auto' // .cm-scroller réel : seul overflow-x est posé…
    scroller.style.overflowY = 'auto' // … mais calcule aussi overflow-y:auto (couplage mesuré)
    // scrollHeight == clientHeight (ne déborde PAS verticalement, mesuré sur device) ET
    // scrollWidth == clientWidth (le retour à la ligne annule le débordement horizontal).
    stubBox(scroller, { scrollWidth: 300, clientWidth: 300, scrollHeight: 300, clientHeight: 300 })
    const content = document.createElement('div')
    content.setAttribute('contenteditable', 'true')
    // Le champ REMPLIT le conteneur (comme .cm-content dans .cm-scroller, qui n'a pas de
    // hauteur propre et s'ajuste exactement au texte) : rien à côté de lui.
    Object.defineProperty(content, 'offsetHeight', { value: 300, configurable: true })
    scroller.appendChild(content)
    document.body.appendChild(scroller)

    expect(findScrollContainer(content)).toBe(document.documentElement)
    scroller.remove()
  })

  // « Attention au correctif naïf » (amendement du plan) : `scrollHeight > clientHeight`
  // seul exclurait AUSSI une carte de dialogue à contenu court (ex.
  // YarnConsumptionDialog avec une seule laine) — or pour un dialogue en position fixe,
  // se replier sur le document ne fait rien défiler du tout. Le discriminant retenu
  // (le champ REMPLIT-il le conteneur ?) doit continuer à accepter ce cas.
  it('accepte toujours une carte de dialogue à CONTENU COURT (scrollHeight == clientHeight, champ petit)', () => {
    const card = document.createElement('div')
    card.style.overflowY = 'auto' // ex. .ycn__card avec une seule laine : ne déborde pas encore
    stubBox(card, { scrollWidth: 300, clientWidth: 300, scrollHeight: 300, clientHeight: 300 })
    const field = document.createElement('input') // petit devant le reste de la carte
    Object.defineProperty(field, 'offsetHeight', { value: 44, configurable: true })
    card.appendChild(field)
    document.body.appendChild(card)

    expect(findScrollContainer(field)).toBe(card)
    card.remove()
  })
})

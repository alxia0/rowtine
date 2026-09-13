// Task C1 (cluster « éditeur zone-de-texte ») — ReaderTextEditor.vue habille
// createCmEditor (CM6, @/components/cm/cm-editor) en composant v-model:md.
//
// CodeMirror EditorView a besoin d'APIs de layout absentes de jsdom (mesures
// de ligne/scroll) : monter le VRAI éditeur ici serait flaky/mort. On mocke
// createCmEditor pour tester le CONTRAT du wrapper (options passées, emit sur
// onChange, setImages, destroy au démontage, rendu des boutons via AppIcon) —
// pas le comportement CM6 réel (couvert e2e, task C3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import fr from '@/i18n/fr.json'

// Une instance par appel de createCmEditor, poussée dans `instances` pour que
// chaque test récupère ses propres stubs (opts capturées + espions).
const instances = []

vi.mock('@/components/cm/cm-editor', () => ({
  createCmEditor: vi.fn((host, opts) => {
    const instance = {
      opts,
      getValue: vi.fn(() => ''),
      setValue: vi.fn(),
      toggleMarkup: vi.fn(() => false), // conservé pour compat banc, plus appelé par ce composant (#3b)
      setMarkupHidden: vi.fn(),
      setImages: vi.fn(),
      setKeyboard: vi.fn((on) => on), // même contrat que le vrai setKeyboard (cf. cm-editor.js)
      setSizeLabels: vi.fn(), // le watch(props.sizeLabels) du composant l'appelle
      view: { destroy: vi.fn() },
      toolbar: document.createElement('div'),
    }
    instances.push(instance)
    return instance
  }),
}))

import { createCmEditor } from '@/components/cm/cm-editor'
import ReaderTextEditor from '@/components/ReaderTextEditor.vue'
import en from '@/i18n/en.json'

// `revealLine()` (exposé) doit transmettre à
// `cmRevealLine` (reveal-line.js) les deux hauteurs occultées mesurées ICI —
// `measureStickyTopHeight()` (src/utils/sticky-top.js) et `actionsHeight`
// (ResizeObserver sur `.correct__actions`). Le calcul RÉEL du
// `yMargin` est prouvé par reveal-line.spec.js ; ce fichier prouve seulement
// le CONTRAT du wrapper — les bons nombres arrivent au bon endroit.
vi.mock('@/components/cm/reveal-line', () => ({ revealLine: vi.fn(() => true) }))
vi.mock('@/utils/sticky-top', () => ({ measureStickyTopHeight: vi.fn(() => 0) }))

import { revealLine as cmRevealLine } from '@/components/cm/reveal-line'
import { measureStickyTopHeight } from '@/utils/sticky-top'

// B6 : ReaderTextEditor compose désormais les libellés de la barre via
// useI18n() (cf. cm-editor.js, opts.labels) — createCmEditor étant mocké
// ci-dessus, ce plugin sert seulement à ce que useI18n() ne plante pas au
// montage ; le contenu réel des libellés traduits est couvert par
// cm-editor-toolbar-i18n.spec.js et cm-editor-section-menu.spec.js.
const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
// P2 : le libellé de bascule balisage (markupLabel) doit passer par t(), pas
// être codé en dur en FR — instance EN dédiée pour le prouver (une instance FR
// seule ne peut jamais détecter une fuite FR figée dans le composant).
const i18nEn = createI18n({ legacy: false, locale: 'en', messages: { en } })

function mountEditor(props = {}) {
  return mount(ReaderTextEditor, {
    props: { md: '## Corps\n- Rang 1 : monter 60 m.\n', images: {}, ...props },
    global: { plugins: [i18n] },
  })
}

function mountEditorEn(props = {}) {
  return mount(ReaderTextEditor, {
    props: { md: '## Corps\n- Rang 1 : monter 60 m.\n', images: {}, ...props },
    global: { plugins: [i18nEn] },
  })
}

describe('ReaderTextEditor', () => {
  beforeEach(() => {
    instances.length = 0
    createCmEditor.mockClear()
  })

  it('monte createCmEditor une seule fois, avec value === props.md', () => {
    const md = '## Corps\n- Rang 1 : monter 60 m.\n'
    mountEditor({ md })
    expect(createCmEditor).toHaveBeenCalledTimes(1)
    const [, opts] = createCmEditor.mock.calls[0]
    expect(opts.value).toBe(md)
  })

  // Fusion des deux bandeaux collants : la barre de
  // requalification doit être montée dans `.rte__bar` (le ref `toolbarHost` du
  // template), pas dans le host de l'éditeur — sinon elle resterait dans son propre
  // bandeau collant séparé et la fusion n'aurait pas eu lieu.
  it('passe opts.toolbarHost à createCmEditor (ref du template, peuplée avant onMounted)', () => {
    mountEditor()
    const [, opts] = createCmEditor.mock.calls[0]
    expect(opts.toolbarHost).not.toBeUndefined()
  })

  it('passe opts.imageActions à createCmEditor (null par défaut, valeur transmise si fournie)', () => {
    const w1 = mountEditor()
    const [, optsDefault] = createCmEditor.mock.calls[0]
    expect(optsDefault.imageActions).toBeNull()
    w1.unmount()

    createCmEditor.mockClear()
    const imageActions = { getInfo: () => null, setShape: () => {}, demote: () => {} }
    mountEditor({ imageActions })
    const [, opts] = createCmEditor.mock.calls[0]
    // `toEqual`, pas `toBe` (déviation assumée, cf. rapport de tâche) : Vue enveloppe un
    // prop objet dans un Proxy shallowReactive avant qu'il n'atteigne `props.imageActions`
    // — mesuré ici, même sans aucun `reactive()`/`ref()` explicite côté ce composant.
    // Comparaison par IDENTITÉ (`toBe`) impossible depuis l'extérieur du composant, donc
    // non représentative d'un vrai défaut ; même précédent que le test `sizeLabels` voisin
    // (`toEqual`, pas `toBe`, sur un objet/tableau reçu en prop).
    expect(opts.imageActions).toEqual(imageActions)
  })

  it('passe les libellés traduits (opts.labels) et la locale courante à createCmEditor (B6)', () => {
    mountEditor()
    const [, opts] = createCmEditor.mock.calls[0]
    expect(opts.locale).toBe('fr')
    expect(opts.labels.step).toBe(fr.correction.toolbar.step)
    expect(opts.labels.ariaToolbar).toBe(fr.correction.toolbar.ariaToolbar)
    // Menu Section : sections déjà groupées par famille, tri sur le
    // libellé traduit (cf. groupedSectionKinds) — pas de kinds/families bruts.
    expect(Array.isArray(opts.labels.sections)).toBe(true)
    expect(opts.labels.sections.some((g) => g.family === 'vetement')).toBe(true)
  })

  // « Conseils » (tips) est la 8e balise du menu Aide-mémoire —
  // TOOLBAR_LABEL_KEYS doit la lister pour que useI18n() la lise et la passe
  // à createCmEditor ; sinon opts.labels.tips reste absent et createCmEditor
  // retombe silencieusement sur le FR de FR_TOOLBAR_LABELS (fusion `{...FR,
  // ...rawLabels}`, cf. cm-editor.js) même en EN/ES/DE. Même patron que
  // l'assertion des flèches monter/descendre ci-dessous : l'assertion FR
  // prouve que la clé RÉSOUT, l'assertion EN prouve qu'aucun FR n'est resté
  // figé — aucune des deux seules ne suffit à couvrir les deux défauts
  // possibles (clé absente de TOOLBAR_LABEL_KEYS → repli FR silencieux en EN ;
  // clé mal nichée dans les JSON → chemin de clé brut en FR).
  it('le libellé de Conseils (tips) arrive traduit dans opts.labels — FR résout, EN suit', () => {
    mountEditor()
    const [, optsFr] = createCmEditor.mock.calls[0]
    expect(optsFr.labels.tips).toBe(fr.correction.toolbar.tips)

    mountEditorEn()
    const [, optsEn] = createCmEditor.mock.calls[1]
    expect(optsEn.labels.tips).toBe(en.correction.toolbar.tips)
    expect(optsEn.labels.tips).not.toBe(fr.correction.toolbar.tips)
  })

  // Nom accessible de la zone d'édition (correction.toolbar.ariaEditor, cf. cm-editor.js
  // EditorView.contentAttributes.of({ 'aria-label': labels.ariaEditor })) — même patron
  // que le test « tips » ci-dessus : l'assertion FR prouve que la clé résout, l'assertion
  // EN prouve qu'aucun FR n'est resté figé. Si 'ariaEditor' manquait à TOOLBAR_LABEL_KEYS,
  // opts.labels.ariaEditor resterait `undefined` ici (createCmEditor n'est pas appelé
  // réellement dans ce fichier — mocké — donc pas de repli FR_TOOLBAR_LABELS pour masquer
  // l'oubli), ce que ni l'une ni l'autre assertion ne laisserait passer.
  it('le libellé de la zone d’édition (ariaEditor) arrive traduit dans opts.labels — FR résout, EN suit', () => {
    mountEditor()
    const [, optsFr] = createCmEditor.mock.calls[0]
    expect(optsFr.labels.ariaEditor).toBe(fr.correction.toolbar.ariaEditor)

    mountEditorEn()
    const [, optsEn] = createCmEditor.mock.calls[1]
    expect(optsEn.labels.ariaEditor).toBe(en.correction.toolbar.ariaEditor)
    expect(optsEn.labels.ariaEditor).not.toBe(fr.correction.toolbar.ariaEditor)
  })

  it('déclencher le onChange capturé émet update:md avec getValue() (pas l’argument onChange)', () => {
    const w = mountEditor()
    const instance = instances[0]
    // Sentinelle distincte de l'argument passé à onChange : si le composant
    // émettait l'argument tel quel plutôt que getValue(), ce test le détecte.
    instance.getValue.mockReturnValue('TEXTE-GETVALUE')
    instance.opts.onChange('texte-ignore-par-le-wrapper')
    expect(w.emitted('update:md')).toBeTruthy()
    expect(w.emitted('update:md')[0]).toEqual(['TEXTE-GETVALUE'])
  })

  it('appelle setImages(props.images) au montage', () => {
    const images = { 'img/schema.png': 'data:image/png;base64,AAA' }
    mountEditor({ images })
    expect(instances[0].setImages).toHaveBeenCalledWith(images)
  })

  // sizeLabels est le seul prop suivi après le montage (watch dédié,
  // cf. en-tête du composant — le contrat « value: props.md au montage
  // seulement » reste intact). Le champ « Tailles » de l'écran de correction
  // est éditable à chaud : un changement de la prop après montage doit
  // atteindre l'éditeur via setSizeLabels, pas seulement l'option initiale.
  it('opts.sizeLabels initial puis setSizeLabels(next) quand la prop change après montage', async () => {
    const w = mountEditor({ sizeLabels: ['S', 'M'] })
    const instance = instances[0]
    expect(instance.opts.sizeLabels).toEqual(['S', 'M'])
    expect(instance.setSizeLabels).not.toHaveBeenCalled()

    await w.setProps({ sizeLabels: ['S', 'M', 'L', 'XL'] })
    expect(instance.setSizeLabels).toHaveBeenCalledWith(['S', 'M', 'L', 'XL'])
  })

  it('détruit l’éditeur (view.destroy) au démontage', () => {
    const w = mountEditor()
    const instance = instances[0]
    w.unmount()
    expect(instance.view.destroy).toHaveBeenCalledTimes(1)
  })

  it('rend les flèches monter/descendre + le bouton « Modifier le texte » via AppIcon, sans emoji', () => {
    const w = mountEditor()
    const up = w.find('.rte__arrow--up')
    const down = w.find('.rte__arrow--down')
    const toggle = w.find('.rte__toggle')
    expect(up.exists()).toBe(true)
    expect(down.exists()).toBe(true)
    expect(toggle.exists()).toBe(true)

    expect(up.findComponent(AppIcon).props('name')).toBe('chevronUp')
    expect(down.findComponent(AppIcon).props('name')).toBe('chevronDown')
    expect(toggle.findComponent(AppIcon).exists()).toBe(true)

    // Aucun emoji/glyphe dans l'UI (règle projet) : ni sur les boutons, ni ailleurs.
    const emojiRe = /\p{Extended_Pictographic}/u
    expect(emojiRe.test(w.text())).toBe(false)
  })

  // #3b — fusion « Voir le balisage » + « Clavier » en un seul bouton
  // « Modifier le texte » : par défaut (codeMode off) l'écran s'ouvre en mode
  // enrichi + clavier fermé ; ON passe en balisage brut ET autorise le
  // clavier. ⚠️ Le comportement clavier réel (le clavier logiciel s'ouvre/se
  // ferme effectivement) n'est PAS vérifiable en test unitaire — GATE DEVICE
  // (Pixel 7), cf. rapport de tâche.
  it('rend UN seul bouton « Modifier le texte » (défaut enrichi/clavier fermé), pas 2 boutons', () => {
    const w = mountEditor()
    const toggles = w.findAll('.rte__toggle')
    expect(toggles.length).toBe(1)
    expect(w.text()).toContain('Modifier le texte')
  })

  // Retour terrain second tour : « Modifier le texte »
  // n'est plus le premier enfant de `.rte__bar` (extrême gauche, avant les 6 puces)
  // mais suit désormais `.rte__toolbar-host` — il reprend la place laissée libre par
  // la pastille de type de ligne retirée pour Note (redondante), en FIN de bandeau.
  // `compareDocumentPosition` (pas un simple indexOf sur les enfants directs de
  // `.rte__bar`) : reste vrai même si un intermédiaire (`.rte__controls`) s'interpose
  // entre le bouton et son ancêtre commun avec la barre de puces.
  it('place « Modifier le texte » APRÈS la barre de puces dans le DOM (reprend la place de la pastille retirée)', () => {
    const w = mountEditor()
    const toolbarHost = w.find('.rte__toolbar-host').element
    const toggle = w.find('.rte__toggle').element
    const position = toolbarHost.compareDocumentPosition(toggle)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('« Modifier le texte » ON → balisage brut + clavier ouvert ; OFF → enrichi + clavier fermé', async () => {
    const w = mountEditor()
    const inst = instances[0]
    const btn = w.find('.rte__toggle')
    await btn.trigger('click') // ON
    expect(inst.setMarkupHidden).toHaveBeenLastCalledWith(false)
    expect(inst.setKeyboard).toHaveBeenLastCalledWith(true)
    // `rte__bar--compact` réduit la barre à 1 ligne
    // défilante — SEULEMENT en mode texte (clavier ouvert), jamais en vue enrichie.
    expect(w.find('.rte__bar').classes()).toContain('rte__bar--compact')
    await btn.trigger('click') // OFF
    expect(inst.setMarkupHidden).toHaveBeenLastCalledWith(true)
    expect(inst.setKeyboard).toHaveBeenLastCalledWith(false)
    expect(w.find('.rte__bar').classes()).not.toContain('rte__bar--compact')
  })

  // Libellé porté par `aria-label` (pas un texte visible dans le bouton, cf. commentaire
  // CSS `.rte__toggle` — icône seule, carré 44×44 comme les flèches voisines) : toujours
  // traduit via t(), jamais de FR figé.
  it('le libellé du bouton passe par t() (pas de FR figé) — instance EN', () => {
    const w = mountEditorEn()
    expect(w.find('.rte__toggle').attributes('aria-label')).toBe('Edit text')
  })

  // Le passage multilingue : les 2 aria-label des flèches monter/descendre
  // étaient en dur en français (attribut figé, jamais de t()). L'assertion FR
  // prouve que la clé RÉSOUT (une clé mal orthographiée/mal nichée dans
  // fr.json ferait passer vue-i18n en mode « rend le chemin de clé tel
  // quel » — le grep sur le littéral français resterait propre sans le
  // détecter) ; l'assertion EN prouve qu'aucun FR n'est resté figé. Aucune
  // des deux seules ne suffit à couvrir les deux défauts possibles.
  it('aria-label des flèches monter/descendre : la clé RÉSOUT (FR) et suit la langue (EN)', () => {
    const wFr = mountEditor()
    expect(wFr.find('.rte__arrow--up').attributes('aria-label')).toBe(fr.correction.moveCursorUp)
    expect(wFr.find('.rte__arrow--down').attributes('aria-label')).toBe(fr.correction.moveCursorDown)

    const wEn = mountEditorEn()
    expect(wEn.find('.rte__arrow--up').attributes('aria-label')).toBe(en.correction.moveCursorUp)
    expect(wEn.find('.rte__arrow--down').attributes('aria-label')).toBe(en.correction.moveCursorDown)
  })

  // Le clavier virtuel reste FERMÉ tant que « Modifier
  // le texte » n'est pas activé (setKeyboard(false) par défaut, cf. cm-editor.js) sans
  // rien à l'écran pour le signaler — d'où cet indice permanent. Permanent = pas un
  // onboarding qu'on ferme une fois pour toutes : `codeMode` repart à `false` à
  // CHAQUE montage (aucune persistance), donc l'indice réapparaît à chaque ouverture
  // du patron en mode lecture, pas seulement à la première utilisation de l'app.
  // Toujours monté (pas de v-if) : ce comportement accepte explicitement soit l'absence,
  // soit un changement d'état — celui-ci évite un saut de mise en page pile sous le
  // doigt qui vient de taper sur « Modifier le texte ».
  it('affiche l’indice « clavier fermé » en mode lecture, et « clavier ouvert » une fois « Modifier le texte » activé', async () => {
    const w = mountEditor()
    const hint = w.find('.rte__hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe(fr.correction.keyboardClosedHint)

    await w.find('.rte__toggle').trigger('click') // « Modifier le texte » ON
    expect(w.find('.rte__hint').exists()).toBe(true)
    expect(w.find('.rte__hint').text()).toBe(fr.correction.keyboardOpenHint)

    await w.find('.rte__toggle').trigger('click') // OFF : retour en mode lecture
    expect(w.find('.rte__hint').text()).toBe(fr.correction.keyboardClosedHint)
  })

  it('les deux états de l’indice clavier passent par t() (pas de FR figé) — instance EN', async () => {
    const w = mountEditorEn()
    expect(w.find('.rte__hint').text()).toBe(en.correction.keyboardClosedHint)

    await w.find('.rte__toggle').trigger('click')
    expect(w.find('.rte__hint').text()).toBe(en.correction.keyboardOpenHint)
  })
})

// Retour terrain, Nexus 7, second tour : les flèches chevauchaient parfois le
// bouton Enregistrer. Cause racine TROUVÉE par reproduction Playwright :
// le composant lisait `entries[0].contentRect.height`
// (ResizeObserver) — la boîte de CONTENU de `.correct__actions`, qui EXCLUT son propre
// padding/bordure — au lieu de sa boîte de BORDURE, celle qui compte réellement pour un
// élément collé au bas du viewport. `.correct__actions` n'existe pas dans le DOM de ce
// fichier (ReaderTextEditor monté seul, sans CorrectionView parent) : on en pose une
// fausse dans `document.body`, comme le fait le vrai écran, pour exercer le même
// `document.querySelector('.correct__actions')`.
describe('ReaderTextEditor — hauteur de .correct__actions (chevauchement des flèches)', () => {
  let actionsEl
  let roInstances

  function rect(height) {
    return { height, top: 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }
  }

  beforeEach(() => {
    actionsEl = document.createElement('div')
    actionsEl.className = 'correct__actions'
    document.body.appendChild(actionsEl)
    roInstances = []
    // ResizeObserver ABSENT de jsdom (jamais polyfillé, cf. tests/unit/setup.js) : mock
    // minimal qui capture le callback pour le déclencher à la main avec un `entries[0]`
    // reproduisant EXACTEMENT ce qu'un vrai navigateur envoie — `contentRect` (boîte de
    // contenu, ce que l'ancien code lisait à tort) ET `borderBoxSize` (boîte de bordure,
    // ce que le code corrigé doit lire) simultanément, avec des valeurs VOLONTAIREMENT
    // différentes pour distinguer sans ambiguïté laquelle des deux est utilisée.
    globalThis.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb
        roInstances.push(this)
      }
      observe(element, options) {
        this.observeOptions = options
      }
      disconnect() {}
    }
  })

  afterEach(() => {
    actionsEl.remove()
    delete globalThis.ResizeObserver
  })

  it('mesure la hauteur de BORDURE (borderBoxSize), pas la hauteur de CONTENU (contentRect)', async () => {
    vi.spyOn(actionsEl, 'getBoundingClientRect').mockReturnValue(rect(73))
    const w = mountEditor()
    roInstances[0].cb([{ contentRect: rect(48), borderBoxSize: [{ blockSize: 73 }], target: actionsEl }])
    await nextTick() // la mise à jour du ref ne repeint le DOM qu'au prochain tick (réactivité Vue)
    const bottom = w.find('.rte__line-movers').element.style.bottom
    expect(bottom).toContain('73px')
    expect(bottom).not.toContain('48px')
  })

  it('mesure la hauteur DÈS le montage (getBoundingClientRect), avant tout callback ResizeObserver — plus de fenêtre à 0px', async () => {
    vi.spyOn(actionsEl, 'getBoundingClientRect').mockReturnValue(rect(61))
    const w = mountEditor()
    await nextTick()
    // Aucun callback RO déclenché ici : la valeur doit déjà refléter la vraie hauteur.
    const bottom = w.find('.rte__line-movers').element.style.bottom
    expect(bottom).toContain('61px')
    expect(bottom).not.toContain('calc(0px')
  })

  it('repli sur getBoundingClientRect si borderBoxSize est absent (navigateur/mock plus ancien)', async () => {
    vi.spyOn(actionsEl, 'getBoundingClientRect').mockReturnValue(rect(50))
    const w = mountEditor()
    roInstances[0].cb([{ contentRect: rect(30), target: actionsEl }]) // pas de borderBoxSize
    await nextTick()
    const bottom = w.find('.rte__line-movers').element.style.bottom
    expect(bottom).toContain('50px')
  })

  it('observe avec { box: "border-box" } pour capturer les changements de padding/bordure (safe-area-inset-bottom)', () => {
    mountEditor()
    expect(roInstances[0].observeOptions).toEqual({ box: 'border-box' })
  })
})

// Retour terrain 2026-08-23 : `revealLine()`
// (exposé) doit transmettre à `cmRevealLine` (reveal-line.js, mocké) deux
// FONCTIONS — pas deux nombres déjà lus — pour le haut (un getter MÉMOÏSÉ sur
// `measureStickyTopHeight`, mocké ci-dessus) et le bas (un getter sur
// `actionsHeight`, même dispositif `.correct__actions` que le bloc
// ci-dessus). Des fonctions parce que CodeMirror les appelle lui-même, plus
// tard, durant SA PROPRE passe de mesure (cf. reveal-line.js) — leur passer un
// nombre déjà lu ICI reviendrait à mesurer trop tôt, le bug que cette tâche
// corrige.
//
// Relecture : le facet posé par `cmRevealLine` reste actif
// pour toute la vie de l'éditeur — sans mémoïsation, `measureStickyTopHeight()`
// (parcours de TOUT LE DOM) repartirait à CHAQUE frappe (cf. commentaire de
// `revealLine()` dans le composant). Le getter `top` passé ici doit donc
// appeler `measureStickyTopHeight()` au PLUS UNE fois, quel que soit le
// nombre de fois où CodeMirror rappelle le getter lui-même.
describe('ReaderTextEditor — revealLine transmet les hauteurs occultées', () => {
  let actionsEl
  let roInstances

  function rect(height) {
    return { height, top: 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }
  }

  beforeEach(() => {
    actionsEl = document.createElement('div')
    actionsEl.className = 'correct__actions'
    document.body.appendChild(actionsEl)
    roInstances = []
    // Même mock que le bloc ci-dessus (capture le callback pour le
    // déclencher à la main) : nécessaire ici pour prouver que `bottom()`,
    // contrairement à `top()`, reste EN DIRECT après un changement de
    // `.correct__actions`.
    globalThis.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb
        roInstances.push(this)
      }
      observe() {}
      disconnect() {}
    }
    cmRevealLine.mockClear()
    measureStickyTopHeight.mockReset().mockReturnValue(0)
  })

  afterEach(() => {
    actionsEl.remove()
    delete globalThis.ResizeObserver
  })

  it('passe { top, bottom } (des fonctions) à cmRevealLine, top() renvoyant measureStickyTopHeight()', async () => {
    vi.spyOn(actionsEl, 'getBoundingClientRect').mockReturnValue(rect(73))
    measureStickyTopHeight.mockReturnValue(120)
    const w = mountEditor()
    await nextTick()
    // `instances` (partagé par tout ce fichier, cf. tête de fichier) n'est PAS
    // remis à zéro par ce describe block — on prend donc la DERNIÈRE instance
    // créée (celle du montage ci-dessus), pas `instances[0]`.
    const instance = instances[instances.length - 1]
    w.vm.revealLine(5)
    expect(cmRevealLine).toHaveBeenCalledTimes(1)
    const [view, lineNumber, occlusion] = cmRevealLine.mock.calls[0]
    expect(view).toBe(instance.view)
    expect(lineNumber).toBe(5)
    expect(typeof occlusion.top).toBe('function')
    expect(occlusion.top()).toBe(120)
    expect(typeof occlusion.bottom).toBe('function')
    expect(occlusion.bottom()).toBe(73)
  })

  // Relecture (finding Important #2) : sans cette
  // mémoïsation, CodeMirror rappellerait `measureStickyTopHeight()` (parcours
  // de TOUT LE DOM) à chaque frappe pour toute la durée de vie de l'éditeur —
  // le facet posé par `cmRevealLine` (mocké ici, donc son VRAI comportement
  // CM6 n'est pas rejoué) n'est jamais retiré. On simule cet appel répété en
  // invoquant `occlusion.top()` plusieurs fois nous-mêmes, comme le ferait
  // CM6 à chaque passe de mesure.
  it('mémoïse measureStickyTopHeight() : occlusion.top() appelé 3 fois ne mesure le DOM qu’UNE fois', async () => {
    vi.spyOn(actionsEl, 'getBoundingClientRect').mockReturnValue(rect(73))
    measureStickyTopHeight.mockReturnValue(120)
    const w = mountEditor()
    await nextTick()
    w.vm.revealLine(5)
    const [, , occlusion] = cmRevealLine.mock.calls[0]
    expect(occlusion.top()).toBe(120)
    expect(occlusion.top()).toBe(120)
    expect(occlusion.top()).toBe(120)
    expect(measureStickyTopHeight).toHaveBeenCalledTimes(1)
  })

  // Compagnon du test précédent : `bottom`, lui, n'a pas besoin d'être
  // mémoïsé (`actionsHeight.value` est une simple lecture de ref, pas un
  // parcours DOM) — un appel répété doit donc rester en phase avec la valeur
  // COURANTE de `actionsHeight`, jamais figée au premier appel comme `top`.
  it('bottom() reste EN DIRECT (pas mémoïsé) : suit actionsHeight.value même après un premier appel', async () => {
    vi.spyOn(actionsEl, 'getBoundingClientRect').mockReturnValue(rect(50))
    const w = mountEditor()
    await nextTick()
    w.vm.revealLine(5)
    const [, , occlusion] = cmRevealLine.mock.calls[0]
    expect(occlusion.bottom()).toBe(50)
    // `.correct__actions` grandit (ResizeObserver la retient à
    // jour) — un appel ultérieur de `bottom()` doit refléter la NOUVELLE
    // valeur, pas celle capturée au premier appel (contrairement à `top()`,
    // cf. test précédent).
    roInstances[0].cb([{ contentRect: rect(0), borderBoxSize: [{ blockSize: 90 }], target: actionsEl }])
    await nextTick()
    expect(occlusion.bottom()).toBe(90)
  })

  it('éditeur absent (démonté/pas encore monté) → false, cmRevealLine jamais appelé', () => {
    const w = mountEditor()
    w.unmount()
    cmRevealLine.mockClear()
    expect(w.vm.revealLine(3)).toBe(false)
    expect(cmRevealLine).not.toHaveBeenCalled()
  })
})

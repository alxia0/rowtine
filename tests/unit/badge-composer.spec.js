import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import i18n from '@/i18n'
import BadgeComposer from '@/components/BadgeComposer.vue'
import { useProjectsStore } from '@/stores/projects'
import { useCropperStore } from '@/stores/cropper'
import { LANGUAGES } from '@/constants/languages'
import ColorPickerDialog from '@/components/ColorPickerDialog.vue'
import { useSettingsStore } from '@/stores/settings'
import { COLOR_PALETTE } from '@/constants/swatch'
import { pickImage } from '@/utils/photo'
import { shareImageDataUrl } from '@/utils/share-badge'
import { computeBadgeGeometry, buildRawStatLines } from '@/utils/badge-render'

// `pickImage` (galerie/caméra réelles, @capacitor/camera) : hors de portée de ces tests,
// couvert par photo.spec.js — mocké pour ne pas dépendre du plugin natif ici.
vi.mock('@/utils/photo', () => ({ pickImage: vi.fn() }))
// `shareImageDataUrl` : plugin natif Capacitor Share/Filesystem, hors de portée ici — on
// vérifie seulement qu'il est APPELÉ avec la bonne image, pas son comportement natif réel.
vi.mock('@/utils/share-badge', () => ({ shareImageDataUrl: vi.fn().mockResolvedValue(true) }))

const src = () => readFileSync(resolve(process.cwd(), 'src/components/BadgeComposer.vue'), 'utf8')
const styleCss = () => {
  const m = src().match(/<style[^>]*>([\s\S]*?)<\/style>/)
  return (m ? m[1] : '').replace(/\/\*[\s\S]*?\*\//g, '')
}

// `resizeDataUrl` réel non exécutable ici : il décode via `new Image()`, que jsdom ne charge
// pas (la promesse ne se résoudrait jamais). Même mock que photo.spec.js/pattern-form-gallery
// — on vérifie que le badge PASSE par le plafond, le redimensionnement lui-même est couvert
// par tests/unit/image-resize.spec.js.
const resizeDataUrlMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/image-resize', () => ({ resizeDataUrl: (...args) => resizeDataUrlMock(...args) }))

const createBadgeCanvasMock = vi.hoisted(() => vi.fn())
const renderBadgeSpy = vi.hoisted(() => vi.fn())
// Régression correctif 2 (revue finale, chantier « badge corrections typo/zoom » 19/09) :
// `statLineCount`/`pairCount` (computed de ce fichier) doivent transmettre `unitSystem` à
// `buildRawStatLines`, comme les deux appels à `renderBadge` le font déjà — ce spy garde
// l'implémentation réelle (résultat inchangé) et n'observe que les arguments reçus.
const buildRawStatLinesSpy = vi.hoisted(() => vi.fn())
vi.mock('@/utils/badge-render', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createBadgeCanvas: (...a) => createBadgeCanvasMock(...a),
    renderBadge: (...a) => { renderBadgeSpy(...a); return actual.renderBadge(...a) },
    buildRawStatLines: (...a) => { buildRawStatLinesSpy(...a); return actual.buildRawStatLines(...a) },
  }
})

// jsdom ne déclenche jamais `onload`/`onerror` d'un `new Image()` pour une data URL (même
// limite que `resizeDataUrl` ci-dessus, vérifiée empiriquement) — sans ce stub, `loadImage()`
// (appelée par `updatePreview()` à CHAQUE montage, gabarit par défaut avec photoSlot) resterait
// en attente indéfiniment et `renderBadge` ne serait jamais atteint dans les tests de prévisu.
class FakeImage {
  constructor() {
    this.naturalWidth = 800
    this.naturalHeight = 800
  }
  set src(value) {
    this._src = value
    queueMicrotask(() => this.onload && this.onload())
  }
  get src() {
    return this._src
  }
}
vi.stubGlobal('Image', FakeImage)

function stubCanvas() {
  const calls = []
  const ctx = {
    fillStyle: '', font: '', textBaseline: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
    measureText: (s) => ({ width: String(s).length * 20 }),
    createLinearGradient: () => ({ addColorStop: (...s) => calls.push(['addColorStop', ...s]) }),
    fillRect(...a) { calls.push(['fillRect', ...a]) },
    fillText(...a) { calls.push(['fillText', ...a]) },
    drawImage(...a) { calls.push(['drawImage', ...a]) },
    // Bord arrondi des photos (revue 16/09) : `drawPhotoCover` clippe via
    // save/beginPath/arcTo/clip avant `drawImage`. `stroke` : pastille Technique
    // Vertical/Horizontal (Task 2, badge-render.js#drawTechniqueBadge) — tracé de sa bordure.
    save() {}, restore() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, clip() {},
    stroke(...a) { calls.push(['stroke', ...a]) },
  }
  const fake = {
    width: 0, height: 0,
    getContext: () => ctx,
    toDataURL: () => 'data:image/jpeg;base64,BADGE',
  }
  createBadgeCanvasMock.mockReturnValue(fake)
  return { fake, calls }
}
beforeEach(() => {
  // Rétabli à CHAQUE test : `restoreAllMocks` ci-dessous vide l'implémentation d'un vi.fn().
  resizeDataUrlMock.mockReset().mockImplementation((dataUrl) =>
    Promise.resolve(String(dataUrl).replace('BADGE', 'BADGE-RESIZED')),
  )
  createBadgeCanvasMock.mockReset().mockImplementation(() => document.createElement('canvas'))
  // Stub toDataURL sur les canvas du DOM (prévisu notamment) pour les tests plein écran.
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,BADGE')
})
// Le composeur pose le verrou de défilement du fond, qui est À COMPTEUR et PARTAGÉ entre
// tous les tests du fichier : un wrapper laissé monté laisserait le compteur au-dessus de
// zéro et le test du verrou ne verrait plus jamais la transition 0→1.
const wrappers = []
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  vi.restoreAllMocks()
})

const stats = {
  totalSeconds: 3600, sessionsCount: 2, ballsUsed: 3,
  startDay: '2026-01-05', endDay: '2026-01-06', ongoing: false, bestStreak: 2,
  grid: { columns: [] },
}

function mountComposer(project, extraProps = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const projectsStore = useProjectsStore()
  projectsStore.projects = [project]
  const cropperStore = useCropperStore()
  const settingsStore = useSettingsStore()
  // `rememberBadgeColor` écrit réellement en base (Dexie/fake-indexeddb) : même motif que
  // `projectsStore.update` juste au-dessus, mocké pour ne pas dépendre d'une vraie écriture
  // asynchrone dans CHAQUE test qui génère un badge (mesuré : plusieurs secondes réelles pour
  // que la transaction fake-indexeddb aboutisse ici, largement au-delà de ce qu'un
  // `flushPromises()` unique ou répété peut couvrir). Les tests qui portent spécifiquement
  // sur l'historique de couleurs vérifient l'APPEL de cette fonction, pas son effet de bord
  // réel en base (déjà couvert par settings.store.spec.js).
  settingsStore.rememberBadgeColor = vi.fn().mockResolvedValue(undefined)
  const wrapper = mount(BadgeComposer, {
    props: { project, stats, ...extraProps },
    global: { plugins: [i18n, pinia] },
  })
  wrappers.push(wrapper)
  return { pinia, projectsStore, cropperStore, settingsStore, wrapper }
}

// Navigation par onglets libre (17/09) : plus de bouton Suivant/Précédent/Générer, plus de
// verrou de progression — le clic sur « Partager » régénère TOUJOURS et ouvre directement le
// partage OS (plus de confirmation intermédiaire). Ce helper remplace l'ancien
// `goToResultStep` + clic sur `badge-generate`.
async function triggerShare(wrapper) {
  await wrapper.find('[data-test="badge-share"]').trigger('click')
  await flushPromises()
}

// La prévisu live (`updatePreview`, déclenchée par le `watch` sur gabarit/couleur/stats/texte
// libre/etc.) est désormais amortie de 200ms (retour Julien, 18/09 : taper vite dans le texte
// libre empilait un redessin complet par frappe et bloquait le fil principal plusieurs
// secondes) — un test qui vérifie l'EFFET de ce redessin après avoir changé une valeur suivie
// doit attendre au-delà de ce délai, `flushPromises()` seul (microtâches) ne suffit plus.
async function waitForPreview() {
  await new Promise((resolve) => setTimeout(resolve, 210))
}

// Onglet Photo supprimé (17/09) : ouvre BadgePhotoPicker en cliquant sur la prévisu (le
// centre du slot photo carré par défaut, quel que soit le gabarit — un appelant ciblant un
// AUTRE gabarit ou un slot précis passe ses propres coordonnées). jsdom ne fait pas de mise
// en page réelle (`getBoundingClientRect` renvoie des zéros) : stub explicite nécessaire pour
// que `onPreviewClick` ne sorte pas tôt. `h` par défaut = la hauteur RÉELLEMENT posée par
// `renderBadge` sur ce <canvas> (variable depuis que le gabarit Vertical dimensionne son
// canevas au nombre de lignes de stats, cf. badge-render.js) — jamais une constante figée,
// qui se serait périmée silencieusement à ce changement (le slot photo étant grand, une
// hauteur légèrement fausse aurait quand même touché le slot sans faire échouer de test).
async function openPhotoPicker(wrapper, { x = 540, y = 540, w = 1080, h } = {}) {
  await flushPromises()
  const canvas = wrapper.find('.bdg__preview')
  const height = h ?? canvas.element.height
  canvas.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height })
  await canvas.trigger('click', { clientX: x, clientY: y })
  await flushPromises()
  await wrapper.find('[data-test="badge-preview-fix"]').trigger('click')
}

// Panoramique une fois zoomée (Task 7) : ces tests ont besoin d'un `previewFrameStyle` de
// taille connue et non nulle, qui dépend de `previewBoxSize` (mesurée sur
// `.bdg__preview-layer`, toujours à 0 en jsdom sans mise en page réelle) — même montage de
// `ResizeObserver` factice, déclenché à la main après avoir forcé `clientWidth`/`clientHeight`
// sur le calque, que les tests `previewFrameStyle` plus haut (contain-fit round 3, 18/09).
function mockResizeObserver() {
  const roInstances = []
  const originalRO = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb
      roInstances.push(this)
    }
    observe(el) {
      this.el = el
    }
    disconnect() {}
  }
  return { roInstances, restore: () => { globalThis.ResizeObserver = originalRO } }
}
async function stubPreviewFrameBox(wrapper, roInstances, w, h) {
  const layerEl = wrapper.find('[data-test="badge-preview-layer"]').element
  const layerRO = roInstances.find((r) => r.el === layerEl)
  Object.defineProperty(layerEl, 'clientWidth', { value: w, configurable: true })
  Object.defineProperty(layerEl, 'clientHeight', { value: h, configurable: true })
  layerRO.cb()
  await wrapper.vm.$nextTick()
}

describe('BadgeComposer', () => {
  it('génère un badge sans photo et le pousse dans project.photos[]', async () => {
    stubCanvas()
    const project = { id: 1, name: 'Pull Alma', photos: [], technique: 'knitting' }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await triggerShare(wrapper)

    expect(projectsStore.update).toHaveBeenCalledTimes(1)
    const [id, patch] = projectsStore.update.mock.calls[0]
    expect(id).toBe(1)
    // Passé par le plafond d'image commun à toutes les portes d'entrée de `photos[]`
    // (resizeDataUrl, valeurs par défaut) — c'est la version PLAFONNÉE qui est stockée.
    expect(resizeDataUrlMock).toHaveBeenCalledWith('data:image/jpeg;base64,BADGE')
    expect(patch.photos).toEqual(['data:image/jpeg;base64,BADGE-RESIZED'])
    expect(wrapper.emitted('saved')).toBeTruthy()
  })

  it("n'écrase pas les photos existantes du projet", async () => {
    stubCanvas()
    const project = { id: 2, name: 'Écharpe', photos: ['data:image/jpeg;base64,OLD'], technique: 'crochet' }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await triggerShare(wrapper)

    const [, patch] = projectsStore.update.mock.calls[0]
    expect(patch.photos).toEqual(['data:image/jpeg;base64,OLD', 'data:image/jpeg;base64,BADGE-RESIZED'])
  })

  // I3 — le bouton Fermer devait rester utilisable après génération : le parent démontait
  // autrefois la feuille sur `saved` avant qu'elle ne puisse se rendre. Ici on vérifie le côté
  // composeur. La miniature `.bdg__result` a disparu (Task 7, bannière flottante) ; la
  // couverture de l'image générée reste assurée via `patch.photos`/`resultUrl` ailleurs dans ce
  // fichier.
  it('garde le bouton Fermer utilisable après génération', async () => {
    stubCanvas()
    const project = { id: 3, name: 'Pull Alma', photos: [], technique: 'knitting' }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await triggerShare(wrapper)

    const close = wrapper.find('[data-test="badge-close"]')
    await close.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  // C1 — la feuille n'était pas une modale : ni verrou de défilement, ni Échap, ni piège au
  // Tab. Le style (position/z-index) n'est pas vérifiable ici (`css: false` en config Vitest),
  // le COMPORTEMENT l'est.
  it('verrouille le défilement du fond au montage et le rend au démontage', () => {
    stubCanvas()
    expect(document.body.style.overflow).toBe('')
    const { wrapper } = mountComposer({ id: 4, name: 'X', photos: [] })
    expect(document.body.style.overflow).toBe('hidden')
    wrappers.pop()
    wrapper.unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('Échap demande la fermeture, et l’écouteur est retiré au démontage', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 5, name: 'X', photos: [] })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(wrapper.emitted('close')).toBeFalsy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)

    // `wrapper.emitted()` est vidé par le démontage : l'écouteur se vérifie au retrait.
    const retire = vi.spyOn(window, 'removeEventListener')
    wrappers.pop().unmount()
    expect(retire).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  // I4 — la teinte était figée sur celle des Réglages, sans moyen d'en changer (spec §106).
  it('offre un nuancier de teinte qui pilote le rendu du badge', async () => {
    const { calls } = stubCanvas()
    const project = { id: 6, name: 'X', photos: [] }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await wrapper.find('[data-test="badge-tab-color"]').trigger('click')
    const swatches = wrapper.findAll('.bdg__palette-sw')
    expect(swatches.length).toBeGreaterThan(1)
    await swatches[0].trigger('click')
    expect(swatches[0].attributes('aria-pressed')).toBe('true')
    await swatches[1].trigger('click')
    expect(swatches[1].attributes('aria-pressed')).toBe('true')
    expect(swatches[0].attributes('aria-pressed')).toBe('false')

    await triggerShare(wrapper)
    const premierArret = (c) => c.filter((x) => x[0] === 'addColorStop' && x[1] === 0).at(-1)[2]
    const teinteB = premierArret(calls)
    expect(projectsStore.update).toHaveBeenCalled()

    // Une SECONDE feuille, teinte différente ⇒ dégradé de fond différent : la teinte choisie
    // traverse bien jusqu'au dessin (elle n'est plus figée sur celle des Réglages).
    const { calls: calls2 } = stubCanvas()
    const { wrapper: w2, projectsStore: store2 } = mountComposer({ id: 7, name: 'X', photos: [] })
    store2.update = vi.fn().mockResolvedValue(undefined)
    await w2.find('[data-test="badge-tab-color"]').trigger('click')
    await w2.findAll('.bdg__palette-sw')[0].trigger('click')
    await triggerShare(w2)

    expect(premierArret(calls2)).not.toBe(teinteB)
  })

  // N1 — le recadreur s'ouvre PAR-DESSUS la feuille et ne gère pas Échap : sans garde, un
  // Échap pendant le recadrage démontait le composeur, recadreur orphelin et configuration
  // perdue sans un mot.
  it('ignore Échap tant que le recadreur est ouvert par-dessus', async () => {
    stubCanvas()
    const { wrapper, cropperStore } = mountComposer({ id: 8, name: 'X', photos: [] })

    cropperStore.open = true
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('close')).toBeFalsy()

    cropperStore.open = false
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  // N4 — la feuille restant ouverte après génération, un second clic relisait
  // `props.project.photos` avant la relecture en base du parent et perdait le premier badge.
  // Retour direct (16/09) : le badge doit rester modifiable après une première génération.
  // Une re-génération dans la MÊME ouverture de la feuille REMPLACE l'entrée précédente
  // (pas de doublon), le bouton Partager reste donc toujours actif.
  it('reste modifiable après génération : une re-génération remplace, n’ajoute pas de doublon', async () => {
    stubCanvas()
    const { wrapper, projectsStore } = mountComposer({ id: 9, name: 'X', photos: [] })
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    const bouton = wrapper.find('[data-test="badge-share"]')
    expect(bouton.attributes('disabled')).toBeUndefined()
    await bouton.trigger('click')
    await flushPromises()

    expect(projectsStore.update).toHaveBeenCalledTimes(1)
    const firstPatch = projectsStore.update.mock.calls[0][1]
    expect(firstPatch.photos).toHaveLength(1)
    // Toujours actif : pas de verrou après une première génération.
    expect(bouton.attributes('disabled')).toBeUndefined()

    await bouton.trigger('click')
    await flushPromises()
    expect(projectsStore.update).toHaveBeenCalledTimes(2)
    const secondPatch = projectsStore.update.mock.calls[1][1]
    // Même longueur qu'après le premier appel : REMPLACE l'entrée, n'en ajoute pas une 2e.
    expect(secondPatch.photos).toHaveLength(1)
  })

  // Navigation par onglets libre (17/09) : suppression des boutons Précédent/Suivant/Générer
  // — les 3 onglets fixes restent cliquables À TOUT MOMENT, y compris pour sauter directement
  // à un onglet jamais visité (plus de verrou de progression).
  it('assistant par onglets : 3 onglets fixes, cliquables directement, aucun bouton Suivant/Précédent/Générer', async () => {
    stubCanvas()
    const project = { id: 10, name: 'X', photos: ['data:image/jpeg;base64,COVER'], technique: 'knitting' }
    const { wrapper } = mountComposer(project)

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['Format', 'Couleur', 'Infos'])
    expect(wrapper.find('[data-test="badge-prev"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="badge-next"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="badge-generate"]').exists()).toBe(false)
    expect(wrapper.find('.bdg__palette-sw').exists()).toBe(false) // pas encore l'étape Couleur

    await wrapper.findAll('.bdg__tpl')[2].trigger('click') // TEMPLATE_KEYS[2] === 'minimal'
    // Saut direct vers Infos, sans passer par Couleur : autorisé.
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    expect(wrapper.find('.bdg__languages').exists()).toBe(true)

    await wrapper.find('[data-test="badge-tab-format"]').trigger('click')
    expect(wrapper.find('[data-test="badge-tab-format"]').classes()).toContain('bdg__segment--on')
  })

  it('onglets : jamais désactivés, aucune restriction de progression', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 14, name: 'X', photos: [] })

    const infosTab = wrapper.find('[data-test="badge-tab-infos"]')
    expect(infosTab.attributes('disabled')).toBeUndefined()
    await infosTab.trigger('click')
    expect(infosTab.classes()).toContain('bdg__segment--on')

    await wrapper.find('[data-test="badge-tab-format"]').trigger('click')
    expect(wrapper.find('[data-test="badge-tab-format"]').classes()).toContain('bdg__segment--on')
  })

  it('mise en page : aucun <fieldset> brut, boutons flottants Fermer/Partager toujours visibles', () => {
    const css = styleCss()
    expect(css).not.toMatch(/\.bdg__field\s*\{[^}]*border:/s) // pas de bordure de fieldset UA réapparue
    expect(css).toMatch(/\.bdg__close-btn\s*\{[^}]*position:\s*absolute/s)
    expect(css).toMatch(/\.bdg__share-btn\s*\{[^}]*position:\s*absolute/s)
    // Le template n'utilise plus <fieldset>/<legend> : source du composant, pas juste le CSS.
    expect(src()).not.toMatch(/<fieldset/)
    expect(src()).not.toMatch(/<legend/)
  })

  // Bug remonté par capture d'écran (17/09) : le padding de zone sûre du haut était posé sur
  // `.bdg` (le conteneur qui DÉFILE) plutôt que sur `.bdg__head` (l'en-tête `sticky`) — une
  // fois la feuille défilée, ce padding sortait du viewport et l'en-tête épinglé se retrouvait
  // sous la barre de statut, laissant le contenu suivant s'y peindre par-dessus. Motif `.phdr`
  // (ProjectDetailView.vue/PatternView.vue) : le padding de sécurité du haut doit vivre sur
  // l'en-tête collant lui-même, jamais sur son ancêtre défilant.
  it('zone sûre du haut : portée par les boutons flottants Fermer/Partager', () => {
    const css = styleCss()
    const bdgBlock = css.match(/\.bdg\s*\{[^}]*\}/s)?.[0] ?? '' // `\s*\{` ne matche QUE `.bdg {`, pas `.bdg__close-btn {` (le `__close-btn` littéral entre les deux n'est pas un espace)
    expect(bdgBlock).not.toMatch(/padding:\s*max\(var\(--sp-4\),\s*var\(--sa-top\)\)/)
    expect(css).toMatch(/\.bdg__close-btn\s*\{[^}]*top:\s*max\(var\(--sp-3\),\s*var\(--sa-top\)\)/s)
    expect(css).toMatch(/\.bdg__share-btn\s*\{[^}]*top:\s*max\(var\(--sp-3\),\s*var\(--sa-top\)\)/s)
  })

  it('prévisu : appelle renderBadge() avec les VRAIES stats et le VRAI projet, jamais une simulation', async () => {
    stubCanvas()
    const project = { id: 15, name: 'Vrai projet', photos: ['data:image/jpeg;base64,VRAIE'], technique: 'knitting' }
    const { wrapper } = mountComposer(project)
    await flushPromises()

    expect(renderBadgeSpy).toHaveBeenCalled()
    const lastCall = renderBadgeSpy.mock.calls.at(-1)[1]
    // `toEqual` (pas `toBe`) : Vue enveloppe les props objet dans un proxy (readonly), donc
    // `lastCall.stats`/`lastCall.project` ne sont jamais IDENTIQUES par référence aux objets
    // transmis en props même quand c'est bien le même contenu — seul le contenu doit rester réel.
    expect(lastCall.stats).toEqual(stats)
    expect(lastCall.project).toEqual(project)
  })

  // Régression Task 14 (chantier « badge corrections typo/zoom » 19/09) : `unitSystem` avait
  // disparu de toute la chaîne en même temps que le passage à l'affichage par laine — un
  // badge qui repasserait silencieusement en métrique pour une utilisatrice en impérial serait
  // un second bug. Vérifié aux DEUX appels à `renderBadge` (prévisu ET génération).
  it('transmet settings.unitSystem à renderBadge(), prévisu ET génération', async () => {
    stubCanvas()
    const project = { id: 18, name: 'X', photos: [], technique: 'knitting' }
    const { wrapper, projectsStore, settingsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)
    settingsStore.unitSystem = 'imperial'
    // Appel direct (plutôt qu'un déclencheur du watcher débattu, `unitSystem` n'en fait pas
    // partie — un changement de réglage en cours de session n'a pas besoin d'un redessin
    // immédiat de la prévisu) : `updatePreview()` lit `settings.unitSystem` à chaque appel,
    // c'est ce câblage-là que ce test vérifie.
    await wrapper.vm.updatePreview()

    const previewCall = renderBadgeSpy.mock.calls.at(-1)[1]
    expect(previewCall.unitSystem).toBe('imperial')

    await triggerShare(wrapper)
    const generateCall = renderBadgeSpy.mock.calls.at(-1)[1]
    expect(generateCall.unitSystem).toBe('imperial')
  })

  // Régression correctif 2 (revue finale, chantier « badge corrections typo/zoom » 19/09) :
  // `statLineCount`/`pairCount` mesurent la géométrie AVANT que `renderBadge` ne dessine quoi
  // que ce soit (cf. `currentTemplate`) — sans `unitSystem`, ils divergeraient silencieusement
  // du dessin réel si un format dépendant du système d'unités venait à changer le nombre de
  // lignes/groupes affichés. `buildRawStatLinesSpy` (même motif que `renderBadgeSpy` plus
  // haut) garde le calcul réel, seuls les arguments reçus sont observés.
  it('transmet settings.unitSystem à buildRawStatLines() pour statLineCount et pairCount', async () => {
    stubCanvas()
    const project = { id: 19, name: 'X', photos: [], technique: 'knitting' }
    const { wrapper, settingsStore } = mountComposer(project)
    buildRawStatLinesSpy.mockClear()
    settingsStore.unitSystem = 'imperial'
    // Même motif que le test `renderBadge` ci-dessus : appel direct de `updatePreview()`, qui
    // lit `currentTemplate.value` (donc `statLineCount.value`/`pairCount.value`) en tout début
    // de fonction, avant même le dessin.
    await wrapper.vm.updatePreview()

    const nonStructuredCalls = buildRawStatLinesSpy.mock.calls.filter(([, opts]) => !opts.structured)
    const structuredCalls = buildRawStatLinesSpy.mock.calls.filter(([, opts]) => opts.structured)
    expect(nonStructuredCalls.length).toBeGreaterThan(0)
    expect(structuredCalls.length).toBeGreaterThan(0)
    expect(nonStructuredCalls.every(([, opts]) => opts.unitSystem === 'imperial')).toBe(true)
    expect(structuredCalls.every(([, opts]) => opts.unitSystem === 'imperial')).toBe(true)
  })

  it('gabarit Vertical : la couverture du projet est la photo par défaut, remplaçable par une autre photo du projet', async () => {
    stubCanvas()
    const project = {
      id: 16,
      name: 'X',
      photos: ['data:image/jpeg;base64,COVER', 'data:image/jpeg;base64,AUTRE'],
      technique: 'knitting',
    }
    const { wrapper, cropperStore } = mountComposer(project)
    // `cropper.crop()` n'est résolue que par <PhotoCropper>, non monté ici (cf. cropper.js :
    // la promesse attend `settle()`). Sans ce stub, `choosePhoto()` resterait en attente et
    // `photoDataUrl` ne serait jamais mise à jour — même mock que `projectsStore.update`
    // ailleurs dans ce fichier, appliqué ici pour la même raison.
    cropperStore.crop = vi.fn().mockResolvedValue('data:image/jpeg;base64,AUTRE')
    await flushPromises()
    // Sans action de l'utilisatrice : la couverture du projet est déjà en place (nouveau
    // défaut) — et, grâce au stub `Image` ci-dessus, qui expose `src`, vérifiable précisément.
    expect(renderBadgeSpy).toHaveBeenCalled()
    const beforePick = renderBadgeSpy.mock.calls.at(-1)[1]
    expect(beforePick.photoImg.src).toBe('data:image/jpeg;base64,COVER')

    await openPhotoPicker(wrapper)
    await wrapper.findAll('.bpp__pick')[1].trigger('click')
    await wrapper.find('[data-test="photo-picker-ratio-square"]').trigger('click')
    await flushPromises()
    await waitForPreview()
    const lastCall = renderBadgeSpy.mock.calls.at(-1)[1]
    expect(lastCall.photoImg.src).toBe('data:image/jpeg;base64,AUTRE')
  })

  it('prévisu : aucune exception si le projet n’a ni photo ni stats', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 17, name: 'Vide', photos: [] })
    await flushPromises()
    expect(wrapper.find('.bdg__preview').exists()).toBe(true)
  })

  it('choix de la langue du badge : indépendant de la langue de l’app, transmis au rendu', async () => {
    const { calls } = stubCanvas()
    const project = { id: 11, name: 'X', photos: ['data:image/jpeg;base64,COVER'], technique: 'knitting' }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const english = wrapper.findAll('.bdg__lang').find((b) => b.text() === 'English')
    expect(english).toBeTruthy()
    expect(i18n.global.locale.value).toBe('fr')
    await english.trigger('click')
    expect(english.attributes('aria-pressed')).toBe('true')
    expect(i18n.global.locale.value).toBe('fr')

    await triggerShare(wrapper)

    expect(i18n.global.locale.value).toBe('fr')
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    // Gabarit par défaut (Vertical) : depuis le style empilé unique aux 4 gabarits (19/09,
    // chantier « badge corrections typo/zoom »), le libellé d'un bloc est dessiné en
    // MAJUSCULES, séparément de la valeur (cf. badge-render.js, `drawStackedBlocks`) —
    // 'Total time' (casse mixte) n'apparaît donc plus tel quel, seule sa version MAJUSCULE le
    // prouve.
    expect(texts.some((s) => s.includes('TOTAL TIME'))).toBe(true)
    expect(texts.some((s) => s.toLowerCase().includes('temps total'))).toBe(false)
  })

  it('après génération : affiche le message « badge enregistré »', async () => {
    stubCanvas()
    const project = { id: 12, name: 'X', photos: [], technique: 'knitting' }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    expect(wrapper.text()).not.toContain('Badge enregistré dans les photos du projet')
    await triggerShare(wrapper)
    expect(wrapper.text()).toContain('Badge enregistré dans les photos du projet')
  })

  it('confirmation "enregistré" : bannière flottante, pas de miniature séparée', async () => {
    stubCanvas()
    const project = { id: 51, name: 'X', photos: [], technique: 'knitting' }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    expect(wrapper.find('.bdg__saved-banner').exists()).toBe(false)
    await triggerShare(wrapper)
    const banner = wrapper.find('.bdg__saved-banner')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toBe('Badge enregistré dans les photos du projet')
  })

  it('liste de langues du badge : identique à celle des Réglages', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 13, name: 'X', photos: [] })
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const labels = wrapper.findAll('.bdg__lang').map((b) => b.text())
    expect(labels).toEqual(LANGUAGES.map((l) => l.label))
  })

  // Refonte 16/09 : le badge applique la couleur RÉELLE choisie (teinte + saturation +
  // luminosité), plus seulement sa teinte resynthétisée en pleine saturation — décision
  // précédente défaite sur retour direct (« un rouge vif choisi ressortait générique, pas
  // CE rouge »). Le filtre/dédoublonnage de badgePalette n'a donc plus de raison d'être :
  // toutes les entrées de COLOR_PALETTE sont proposées, y compris noir/gris/anthracite.
  it('couleur : la palette propose toutes les couleurs, chaque pastille applique sa couleur réelle', async () => {
    const { calls } = stubCanvas()
    const project = { id: 18, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await wrapper.find('[data-test="badge-tab-color"]').trigger('click')
    const swatches = wrapper.findAll('.bdg__palette-sw')
    expect(swatches.length).toBe(COLOR_PALETTE.length)
    const labels = swatches.map((s) => s.attributes('aria-label'))
    expect(labels).toContain('noir')
    expect(labels).toContain('rouge')

    const rougeIndex = COLOR_PALETTE.findIndex((c) => c.key === 'rouge')
    const rouge = COLOR_PALETTE[rougeIndex]
    await swatches[rougeIndex].trigger('click')
    expect(swatches[rougeIndex].attributes('aria-pressed')).toBe('true')

    await triggerShare(wrapper)
    expect(projectsStore.update).toHaveBeenCalled()
    // La couleur RÉELLE de la pastille (pas juste sa teinte) est transmise telle quelle au
    // rendu — plus d'indirection par un simple nombre de teinte.
    expect(renderBadgeSpy.mock.calls.at(-1)[1].color).toBe(rouge.hsl)
    expect(calls.some((c) => c[0] === 'addColorStop')).toBe(true)
  })

  it('couleur : le sélecteur libre est pré-rempli avec la couleur courante du badge', async () => {
    stubCanvas()
    const project = { id: 24, name: 'X', photos: [] }
    const { wrapper } = mountComposer(project)
    await wrapper.find('[data-test="badge-tab-color"]').trigger('click')
    await flushPromises()
    const colorBefore = renderBadgeSpy.mock.calls.at(-1)[1].color

    await wrapper.find('[data-test="badge-color-custom"]').trigger('click')
    const dialog = wrapper.findComponent(ColorPickerDialog)
    // Refonte 16/09 : `badgeColor` EST directement la couleur transmise au sélecteur libre
    // (plus d'indirection par teinte seule à retrouver dans la palette) — il s'ouvre donc
    // TOUJOURS exactement sur la couleur courante, par construction, plus par coïncidence.
    expect(dialog.props('color')).toBe(colorBefore)

    // Confirme sans rien toucher : ne doit rien changer.
    await dialog.vm.$emit('pick', dialog.props('color'))
    await flushPromises()
    expect(renderBadgeSpy.mock.calls.at(-1)[1].color).toBe(colorBefore)
  })

  it('couleur : le choix libre n’est mémorisé dans l’historique qu’après une génération aboutie', async () => {
    stubCanvas()
    const project = { id: 19, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper, projectsStore, settingsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await wrapper.find('[data-test="badge-tab-color"]').trigger('click')
    await wrapper.find('[data-test="badge-color-custom"]').trigger('click')
    expect(wrapper.findComponent(ColorPickerDialog).props('open')).toBe(true)
    await wrapper.findComponent(ColorPickerDialog).vm.$emit('pick', 'hsl(210 60% 50%)')
    await flushPromises()
    await waitForPreview()
    // Choisir une couleur (pastille ou sélecteur libre) ne l'enregistre pas encore dans
    // l'historique — un simple essai dans la palette n'y doit pas polluer l'historique.
    expect(settingsStore.rememberBadgeColor).not.toHaveBeenCalled()
    expect(renderBadgeSpy.mock.calls.at(-1)[1].color).toBe('hsl(210 60% 50%)')

    await triggerShare(wrapper)
    expect(settingsStore.rememberBadgeColor).toHaveBeenCalledWith('hsl(210 60% 50%)')
  })

  it('couleur : historique masqué au premier lancement (vide), affiché dès qu’il contient une couleur', async () => {
    stubCanvas()
    const { wrapper, settingsStore } = mountComposer({ id: 20, name: 'X', photos: [] })
    await wrapper.find('[data-test="badge-tab-color"]').trigger('click')
    expect(wrapper.find('[data-test="badge-recent-hues"]').exists()).toBe(false)

    settingsStore.badgeColorHistory = ['hsl(210 60% 50%)']
    await flushPromises()
    expect(wrapper.find('[data-test="badge-recent-hues"]').exists()).toBe(true)
    const recentSwatch = wrapper.find('[data-test="badge-recent-hues"] button')
    expect(recentSwatch.exists()).toBe(true)
    await recentSwatch.trigger('click')
    await flushPromises()
    await waitForPreview()
    expect(renderBadgeSpy.mock.calls.at(-1)[1].color).toBe('hsl(210 60% 50%)')
  })

  // Gabarit Texte seul (pas de couverture -> `templateKey` par défaut 'minimal', cf. son
  // commentaire dans le composant). Depuis le chantier « badge corrections typo/zoom »
  // (19/09, Task 4), la technique n'est plus jamais dessinée comme ligne de stats, y compris
  // pour minimal/double : ces 3 tests vérifient désormais la PASTILLE (dessinée en MAJUSCULES
  // par `drawTechniqueBadge`, badge-render.js), pas une ligne — cf. describe dédié plus bas
  // pour la couverture complète des 4 gabarits sur `statKeys`/`includeTechnique`.
  it('technique : activée par défaut si présente sur le projet, apparaît dans le rendu (gabarit Texte seul)', async () => {
    const { calls } = stubCanvas()
    const project = { id: 21, name: 'X', photos: [], technique: 'crochet' }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const techniquePill = wrapper.find('[data-test="badge-technique"]')
    expect(techniquePill.exists()).toBe(true)
    expect(techniquePill.attributes('aria-pressed')).toBe('true')
    expect(techniquePill.text()).toBe('Crochet')

    await triggerShare(wrapper)
    expect(projectsStore.update).toHaveBeenCalled()
    // MAJUSCULES : `drawTechniqueBadge` dessine `label.toUpperCase()` (pastille), plus de
    // ligne de stats en casse normale pour ce gabarit depuis l'unification (19/09).
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts.some((s) => s.includes('CROCHET'))).toBe(true)
  })

  it('technique : désactivée au clic -> absente du rendu (gabarit Texte seul)', async () => {
    const { calls } = stubCanvas()
    const project = { id: 22, name: 'X', photos: [], technique: 'knitting' }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const techniquePill = wrapper.find('[data-test="badge-technique"]')
    await techniquePill.trigger('click')
    expect(techniquePill.attributes('aria-pressed')).toBe('false')
    await triggerShare(wrapper)

    // MAJUSCULES (cf. le test symétrique juste au-dessus) : sans ce changement de casse, cette
    // assertion resterait vraie même si `includeTechnique` cessait d'être honoré pour ce
    // gabarit (`'TRICOT'.includes('Tricot')` est déjà `false`) — un test qui ne peut jamais
    // devenir rouge n'est pas un test.
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts.some((s) => s.includes('TRICOT'))).toBe(false)
  })

  it('technique : absente du modèle projet -> aucune pastille technique, aucune exception (gabarit Texte seul)', async () => {
    stubCanvas()
    const project = { id: 23, name: 'X', photos: [] } // pas de technique
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    expect(wrapper.find('[data-test="badge-technique"]').exists()).toBe(false)

    await expect(wrapper.find('[data-test="badge-share"]').trigger('click')).resolves.not.toThrow()
  })

  // Task 2 (chantier « badge cartouche condensé », 18/09c) : Vertical/Horizontal retirent la
  // technique de leurs stats (dessinée à part par `renderBadge`, en pastille sur la rangée du
  // titre). Chantier « badge corrections typo/zoom » (19/09, Task 3/4) : le même retrait
  // s'applique désormais aussi à minimal/double — `selectedStats` (jamais `'technique'`) est
  // la liste de stats transmise à `renderBadge` pour les 4 gabarits, cf. les 3 tests juste
  // au-dessus pour la pastille elle-même.
  describe('technique : retirée de statKeys pour les 4 gabarits (Task 2 + Task 3/4)', () => {
    it('Vertical (gabarit par défaut avec couverture) : technique absente de statKeys', async () => {
      stubCanvas()
      const project = { id: 62, name: 'X', photos: ['data:image/jpeg;base64,COVER'], technique: 'crochet' }
      mountComposer(project)
      await flushPromises()
      const lastCall = renderBadgeSpy.mock.calls.at(-1)[1]
      expect(lastCall.templateKey).toBe('vertical')
      expect(lastCall.statKeys).not.toContain('technique')
    })

    it('Horizontal : technique absente de statKeys', async () => {
      stubCanvas()
      const project = { id: 63, name: 'X', photos: ['data:image/jpeg;base64,COVER'], technique: 'crochet' }
      const { wrapper } = mountComposer(project)
      await flushPromises()
      await wrapper.findAll('.bdg__tpl')[1].trigger('click') // TEMPLATE_KEYS[1] === 'horizontal'
      await flushPromises()
      await waitForPreview()
      const lastCall = renderBadgeSpy.mock.calls.at(-1)[1]
      expect(lastCall.templateKey).toBe('horizontal')
      expect(lastCall.statKeys).not.toContain('technique')
    })

    // Ce test couvrait auparavant le comportement INVERSE (`technique` restait dans `statKeys`
    // pour minimal/double, Task 2) — désormais caduc : la Task 3 (badge-render.js) filtre
    // `'technique'` de `statKeys` pour TOUS les gabarits, et la Task 4 aligne `selectedStats`
    // (jamais `'technique'`, cf. suppression d'`effectiveStatKeys`) en conséquence, pour que la
    // hauteur de prévisu calculée par `BadgeComposer.vue` corresponde au rendu réel.
    it('minimal/double : technique absente de statKeys (unification 19/09, Task 3/4)', async () => {
      stubCanvas()
      const project = { id: 64, name: 'X', photos: [], technique: 'crochet' } // pas de couverture -> minimal par défaut
      const { wrapper } = mountComposer(project)
      await flushPromises()
      const minimalCall = renderBadgeSpy.mock.calls.at(-1)[1]
      expect(minimalCall.templateKey).toBe('minimal')
      expect(minimalCall.statKeys).not.toContain('technique')

      await wrapper.findAll('.bdg__tpl')[3].trigger('click') // TEMPLATE_KEYS[3] === 'double'
      await flushPromises()
      await waitForPreview()
      const doubleCall = renderBadgeSpy.mock.calls.at(-1)[1]
      expect(doubleCall.templateKey).toBe('double')
      expect(doubleCall.statKeys).not.toContain('technique')
    })

    // Revue FINALE de branche (19/09) : la case à cocher « Technique » était devenue INERTE
    // pour Vertical/Horizontal (la Task 2 l'avait sortie de `effectiveStatKeys` sans la
    // rebrancher ailleurs, et `renderBadge` dessinait la pastille dès que `project.technique`
    // existait). Décision produit confirmée par Julien : elle doit piloter la pastille comme
    // elle pilote déjà la ligne technique de minimal/double.
    it('Vertical : la case « Technique » décochée est transmise à renderBadge (pastille supprimée)', async () => {
      stubCanvas()
      const project = { id: 66, name: 'X', photos: ['data:image/jpeg;base64,COVER'], technique: 'crochet' }
      const { wrapper } = mountComposer(project)
      await flushPromises()
      expect(renderBadgeSpy.mock.calls.at(-1)[1].includeTechnique).toBe(true)
      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      await wrapper.find('[data-test="badge-technique"]').trigger('click')
      await flushPromises()
      await waitForPreview()
      const lastCall = renderBadgeSpy.mock.calls.at(-1)[1]
      expect(lastCall.templateKey).toBe('vertical')
      expect(lastCall.includeTechnique).toBe(false)
    })

    // Même test que le précédent, dupliqué pour minimal (Task 4, chantier « badge corrections
    // typo/zoom » 19/09) : la case « Technique » doit piloter `includeTechnique` pour les 4
    // gabarits désormais, et `statKeys` ne doit JAMAIS contenir `'technique'`, que la case soit
    // cochée ou non (elle ne pilote plus qu'une pastille, jamais une ligne de stats).
    it('minimal : la case « Technique » cochée pilote includeTechnique, jamais statKeys (pastille, pas une ligne)', async () => {
      stubCanvas()
      const project = { id: 67, name: 'X', photos: [], technique: 'crochet' } // pas de couverture -> minimal
      const { wrapper } = mountComposer(project)
      await flushPromises()
      const initialCall = renderBadgeSpy.mock.calls.at(-1)[1]
      expect(initialCall.templateKey).toBe('minimal')
      expect(initialCall.includeTechnique).toBe(true)
      expect(initialCall.statKeys).not.toContain('technique')

      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      await wrapper.find('[data-test="badge-technique"]').trigger('click')
      await flushPromises()
      await waitForPreview()
      const lastCall = renderBadgeSpy.mock.calls.at(-1)[1]
      expect(lastCall.templateKey).toBe('minimal')
      expect(lastCall.includeTechnique).toBe(false)
      expect(lastCall.statKeys).not.toContain('technique')
    })

    it("la pastille Infos « Technique » garde son comportement de case à cocher (aria-pressed) en Vertical, même si sa CONSÉQUENCE sur le rendu a changé", async () => {
      stubCanvas()
      const project = { id: 65, name: 'X', photos: ['data:image/jpeg;base64,COVER'], technique: 'crochet' }
      const { wrapper } = mountComposer(project)
      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      const techniquePill = wrapper.find('[data-test="badge-technique"]')
      expect(techniquePill.attributes('aria-pressed')).toBe('true')
      await techniquePill.trigger('click')
      expect(techniquePill.attributes('aria-pressed')).toBe('false')
    })
  })

  // Task 6 (chantier « badge cartouche condensé » 18/09c) : `currentTemplate` (prévisu) doit
  // réserver la même hauteur que le VRAI rendu (`renderBadge`, déjà correct depuis la Task 5)
  // pour le bloc "texte libre" de Vertical/Horizontal.
  //
  // MÉTHODE (revue post-commit, 19/09 — corrige une erreur de la première version de ces
  // tests) : `.bdg__preview` (le VRAI canevas dessiné par `renderBadge`, jamais mocké, cf. tête
  // de fichier) N'EST PAS une vérité terrain valable pour `currentTemplate` — vérifié par
  // expérience (j'ai temporairement réintroduit le bug dans `BadgeComposer.vue`, relancé ces
  // tests : les 6 passaient QUAND MÊME). Raison : `updatePreview()` ne transmet à `renderBadge`
  // que des props BRUTES (`statKeys`, `customText`, `includeCalendar`...) — `renderBadge`
  // calcule ENTIÈREMENT sa propre géométrie à partir d'elles (badge-render.js:1006), sans
  // jamais lire `currentTemplate`. `currentTemplate` est donc une valeur PUREMENT LOCALE au
  // composant, sans effet sur le canevas réellement dessiné : comparer `.bdg__preview` à une
  // reconstruction de `computeBadgeGeometry` est vrai QUELLE QUE SOIT la valeur produite par
  // `currentTemplate` — un test qui ne peut jamais être rouge n'est pas un test.
  //
  // Le SEUL effet observable de `currentTemplate` ailleurs dans ce composant est le
  // NUMÉRATEUR de `previewFixStyle` (position du bouton « Modifier », `tpl.photoSlot`) — et
  // seul le gabarit Horizontal (`orientation: 'landscape'`) y est sensible : son `photoSlot.y`
  // dépend de la hauteur totale du canevas (`(canvasH - slot.h) / 2`, badge-render.js:480).
  // Vertical/Deux images ancrent leur photo à une position FIXE (`{x: MARGIN, y: MARGIN}`),
  // indépendante de `statLineCount`/`freeTextLineCount` : AUCUNE conséquence observable en DOM
  // n'existe pour ces deux gabarits, quoi que fasse `currentTemplate`.
  //
  // Preuve DOM indépendante possible : UNIQUEMENT pour Horizontal (clic sur la prévisu, cf.
  // test dédié plus bas — vérifié par la même expérience de réintroduction du bug : bouton
  // absent avec le bug, présent une fois corrigé). Pour Vertical/minimal/double, faute de
  // canal observable, ces tests lisent `wrapper.vm.currentTemplate` (accessible malgré
  // l'absence de `defineExpose` sur ce composant `<script setup>`, vérifié empiriquement) —
  // SANS précédent ailleurs dans ce fichier, où tout le reste passe par le DOM. Si un futur
  // lecteur se demande pourquoi CES tests-ci dérogent à cette convention : ce n'est pas un
  // raccourci de confort, c'est qu'aucune alternative DOM n'existe pour ces trois gabarits
  // (revue du 19/09, tranchée après vérification empirique ci-dessus — ne pas « corriger » en
  // repassant par le canevas DOM, ça ferait REGRESSER ces tests vers une preuve vide de sens).
  describe('freeTextLineCount : `currentTemplate` réserve le bloc "texte libre" comme le vrai rendu (Task 6)', () => {
    it('Vertical + texte libre : `currentTemplate` réserve une ligne à part, `statLineCount` exclut le texte libre', async () => {
      stubCanvas()
      const project = { id: 70, name: 'X', photos: ['data:image/jpeg;base64,COVER'] } // couverture -> Vertical
      const { wrapper } = mountComposer(project)
      await flushPromises()
      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      await wrapper.find('[data-test="badge-text"]').setValue('Bravo')
      await flushPromises()
      await waitForPreview()

      // 4 stats par défaut (yarns décoché, aucune laine liée ; technique jamais dans STAT_KEYS,
      // donc jamais dans `selectedStats`), `customText` volontairement ABSENT de cet appel —
      // c'est exactement le compte que `renderBadge` utilise pour les 4 gabarits depuis
      // l'unification (badge-render.js exclut `customText` de `buildRawStatLines` pour tous).
      const statKeys = ['totalTime', 'startedOn', 'bestStreak', 'sessionsCount']
      const n = buildRawStatLines(statKeys, { stats, t: i18n.global.t, locale: 'fr', project, yarnUsage: [] }).length
      const sansTexteLibre = computeBadgeGeometry('vertical', 1, n, 1, false) // repère : 7e paramètre omis = 0
      // Signature à 7 paramètres depuis le retrait de `layoutStyle` (Task 3, chantier « badge
      // corrections typo/zoom » 19/09) : `freeTextLineCount` est le 7e, sans `undefined`
      // intercalaire. `pairCount` (Task 9, même chantier) est le 8e et dernier : `currentTemplate`
      // (BadgeComposer.vue) transmet `statLineCount.value` deux fois (`statLineCount` ET
      // `pairCount`, cf. son propre commentaire), donc `n` ici aussi.
      const attendu = computeBadgeGeometry('vertical', 1, n, 1, false, 0, 1, n)
      // (a) sanity : la réservation a un effet réel sur ma propre reconstruction, pas un no-op.
      expect(attendu.canvas.h).toBeGreaterThan(sansTexteLibre.canvas.h)
      expect(attendu.freeTextTop).not.toBeNull()
      // (b) preuve sur `currentTemplate` lui-même (cf. commentaire de tête : aucun canal DOM
      // n'existe pour Vertical, `photoSlot` y étant ancré à une position fixe).
      expect(wrapper.vm.currentTemplate).toEqual(attendu)
    })

    it('Horizontal + texte libre : `currentTemplate` réserve une ligne à part (même invariant, gabarit "stacked")', async () => {
      stubCanvas()
      const project = { id: 71, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
      const { wrapper } = mountComposer(project)
      await flushPromises()
      await wrapper.findAll('.bdg__tpl')[1].trigger('click') // TEMPLATE_KEYS[1] === 'horizontal'
      await flushPromises()
      await waitForPreview()
      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      await wrapper.find('[data-test="badge-text"]').setValue('Bravo')
      await flushPromises()
      await waitForPreview()

      const statKeys = ['totalTime', 'startedOn', 'bestStreak', 'sessionsCount']
      const n = buildRawStatLines(statKeys, { stats, t: i18n.global.t, locale: 'fr', project, yarnUsage: [] }).length
      const sansTexteLibre = computeBadgeGeometry('horizontal', 1, n, 1, false)
      const attendu = computeBadgeGeometry('horizontal', 1, n, 1, false, 0, 1, n) // pairCount = n, cf. Task 9
      expect(attendu.canvas.h).toBeGreaterThan(sansTexteLibre.canvas.h)
      expect(attendu.freeTextTop).not.toBeNull()
      expect(wrapper.vm.currentTemplate).toEqual(attendu)
    })

    // Preuve DOM INDÉPENDANTE (sans lire `currentTemplate`) — possible UNIQUEMENT pour
    // Horizontal (cf. commentaire de tête) : `previewFixStyle` positionne le bouton « Modifier »
    // au centre de `currentTemplate.photoSlot`, rapporté aux dimensions RÉELLES du canevas
    // (`onPreviewClick`) — si `currentTemplate` prédit une position DIFFÉRENTE de celle où la
    // photo est VRAIMENT dessinée, un clic sur le VRAI centre de la photo peut retomber HORS de
    // la zone prédite et le bouton ne pas apparaître. Vérifié par expérience (bug réintroduit
    // temporairement : ce test échoue, bouton absent).
    // Discriminant : la TAILLE du slot (`h`/`w`), plus sa POSITION (`x`/`y`), depuis la Tâche 1
    // (« badge-horizontal-photo-hauteur », 20/09, retour Julien) — la photo Horizontal occupe
    // désormais TOUJOURS toute la hauteur disponible entre les deux marges (`photoSlot.y` vaut
    // systématiquement `MARGIN`, `photoSlot.x` aussi), donc les deux géométries reconstruites
    // ci-dessous partagent la MÊME origine (coin haut-gauche) quel que soit leur contenu ; seule
    // leur taille diffère encore. Le plus grand slot des deux contient alors TOUJOURS le plus
    // petit (même origine) : le point qui discrimine est celui qui tombe dans le plus grand MAIS
    // hors du plus petit (son coin bas-droit, à 2 px près) — jamais un point choisi par avance
    // dans `correcte`, dont on ne sait plus a priori s'il est le plus grand des deux.
    it('Horizontal + texte libre : le bouton « Modifier » suit la VRAIE position de la photo (preuve DOM indépendante de `wrapper.vm`)', async () => {
      stubCanvas()
      const project = { id: 76, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
      const { wrapper } = mountComposer(project)
      await flushPromises()
      await wrapper.findAll('.bdg__tpl')[1].trigger('click') // TEMPLATE_KEYS[1] === 'horizontal'
      await flushPromises()
      await waitForPreview()
      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      await wrapper.find('[data-test="badge-text"]').setValue('Bravo')
      await flushPromises()
      await waitForPreview()

      const statKeys = ['totalTime', 'startedOn', 'bestStreak', 'sessionsCount']
      const n = buildRawStatLines(statKeys, { stats, t: i18n.global.t, locale: 'fr', project, yarnUsage: [] }).length
      // Géométrie CORRECTE (ce que `currentTemplate` doit produire après cette tâche) et
      // géométrie D'AVANT la Task 6 (`customText` mélangé aux stats, `freeTextLineCount`
      // jamais transmis) — toutes deux reconstruites via le VRAI `computeBadgeGeometry`, pour
      // retrouver la VRAIE taille du slot photo prédite dans chacun des deux cas.
      const correcte = computeBadgeGeometry('horizontal', 1, n, 1, false, 0, 1, n) // pairCount = n, cf. Task 9
      const avantTask6 = computeBadgeGeometry('horizontal', 1, n + 1, 1, false) // +1 : customText compté comme une stat
      // Sanity : le bug a un effet réel sur la TAILLE du slot (`h`, donc `w` aussi ici — ratio 1
      // dans cet appel, les deux valent toujours la même chose au sein d'un même slot).
      expect(correcte.photoSlot.h).not.toBe(avantTask6.photoSlot.h)

      const canvas = wrapper.find('.bdg__preview')
      const realW = canvas.element.width
      const realH = canvas.element.height
      expect(realH).toBeGreaterThan(0)
      // Le modèle `correcte` reconstruit ci-dessus EST bien la géométrie que le composant
      // utilise réellement (sinon les assertions qui suivent, bâties sur `correcte`, pourraient
      // passer à vide si `pairCount`/`weeksCount` divergeaient côté composant sans que rien ne
      // le remarque).
      expect(realW).toBe(correcte.canvas.w)
      expect(realH).toBe(correcte.canvas.h)
      canvas.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: realW, height: realH })

      // Lequel des deux est le plus grand ? Mesuré en pratique (Tâche 1, 20/09) : `correcte` est
      // le plus grand ici (le texte libre, réservé PAR-DESSUS le plancher photo, pèse plus que
      // la stat en moins qui reste, elle, SOUS ce même plancher côté `avantTask6`) — mais l'ordre
      // n'est pas figé dans ce test, pour ne pas casser silencieusement si les constantes de
      // `badge-render.js` bougent un jour.
      const correcteEstPlusGrand = correcte.photoSlot.h > avantTask6.photoSlot.h
      const plusGrand = correcteEstPlusGrand ? correcte : avantTask6
      const plusPetit = correcteEstPlusGrand ? avantTask6 : correcte

      // Point à l'intérieur du PLUS GRAND slot (coin bas-droit, 2 px de marge) mais HORS du plus
      // PETIT — les deux partageant la même origine (`x`/`y` = MARGIN, Tâche 1), c'est la seule
      // zone qui les distingue encore.
      const clickX = plusGrand.photoSlot.x + plusGrand.photoSlot.w - 2
      const clickY = plusGrand.photoSlot.y + plusGrand.photoSlot.h - 2
      // Garde : ce point doit être HORS du plus petit slot, sinon le test ne discriminerait rien
      // (`onPreviewClick` compare avec des bornes inclusives).
      const horsDuPlusPetit = clickX > plusPetit.photoSlot.x + plusPetit.photoSlot.w || clickY > plusPetit.photoSlot.y + plusPetit.photoSlot.h
      expect(horsDuPlusPetit).toBe(true)

      await canvas.trigger('click', { clientX: clickX, clientY: clickY })
      if (correcteEstPlusGrand) {
        // Ce point n'est DANS un slot que si `currentTemplate` utilise bien la géométrie
        // CORRECTE (la plus grande ici) : preuve suffisante à elle seule.
        expect(wrapper.find('[data-test="badge-preview-fix"]').exists()).toBe(true)
      } else {
        // Inversement : ce point tombe dans le slot D'AVANT la Task 6 (le plus grand ici) mais
        // hors du VRAI slot (le plus petit) — le bouton ne doit PAS apparaître si `currentTemplate`
        // reflète bien la géométrie correcte.
        expect(wrapper.find('[data-test="badge-preview-fix"]').exists()).toBe(false)
        // Deuxième clic, au centre du VRAI slot cette fois : preuve positive que le bouton
        // apparaît bien quand on retombe dedans (le clic précédent n'a pas laissé
        // `previewFixSlot` bloqué à `null` pour une autre raison).
        const cx = correcte.photoSlot.x + correcte.photoSlot.w / 2
        const cy = correcte.photoSlot.y + correcte.photoSlot.h / 2
        await canvas.trigger('click', { clientX: cx, clientY: cy })
        expect(wrapper.find('[data-test="badge-preview-fix"]').exists()).toBe(true)
      }
    })

    it('Vertical SANS texte libre : `freeTextLineCount` reste à 0 (pas de réservation superflue)', async () => {
      stubCanvas()
      const project = { id: 72, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
      const { wrapper } = mountComposer(project)
      await flushPromises()

      const statKeys = ['totalTime', 'startedOn', 'bestStreak', 'sessionsCount']
      const n = buildRawStatLines(statKeys, { stats, t: i18n.global.t, locale: 'fr', project, yarnUsage: [] }).length
      const attendu = computeBadgeGeometry('vertical', 1, n, 1, false, 0, 0, n) // pairCount = n, cf. Task 9
      expect(wrapper.vm.currentTemplate).toEqual(attendu)
    })

    it('Vertical, projet terminé (startedAt + finishedAt) : `pairCount` compte 1 groupe pour les 2 phrases de « startedOn » (Task 13)', async () => {
      stubCanvas()
      const project = {
        id: 73, name: 'X', photos: ['data:image/jpeg;base64,COVER'],
        startedAt: '2026-01-05', finishedAt: '2026-01-20',
      }
      const { wrapper } = mountComposer(project)
      await flushPromises()

      const statKeys = ['totalTime', 'startedOn', 'bestStreak', 'sessionsCount']
      const n = buildRawStatLines(statKeys, { stats, t: i18n.global.t, locale: 'fr', project, yarnUsage: [] }).length
      // `startedOn` produit ICI deux lignes (Commencé le + Terminé le) : `n` vaut 5, mais un
      // SEUL groupe pour les deux (Task 13) — `pairCount` doit donc valoir n - 1, jamais n
      // (l'ancienne approximation `statLineCount.value` réutilisée par `pairCount`, Task 9,
      // qui sur-réservait un `STACK_PAIR_GAP` de trop entre les deux phrases).
      expect(n).toBe(5)
      const attendu = computeBadgeGeometry('vertical', 1, n, 1, false, 0, 0, n - 1)
      expect(wrapper.vm.currentTemplate).toEqual(attendu)
    })

    it('Horizontal SANS texte libre : `freeTextLineCount` reste à 0 (même garde, gabarit "stacked")', async () => {
      stubCanvas()
      const project = { id: 75, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
      const { wrapper } = mountComposer(project)
      await flushPromises()
      await wrapper.findAll('.bdg__tpl')[1].trigger('click') // TEMPLATE_KEYS[1] === 'horizontal'
      await flushPromises()
      await waitForPreview()

      const statKeys = ['totalTime', 'startedOn', 'bestStreak', 'sessionsCount']
      const n = buildRawStatLines(statKeys, { stats, t: i18n.global.t, locale: 'fr', project, yarnUsage: [] }).length
      const attendu = computeBadgeGeometry('horizontal', 1, n, 1, false, 0, 0, n) // pairCount = n, cf. Task 9
      expect(wrapper.vm.currentTemplate).toEqual(attendu)
    })

    // Brief Task 6 : « adaptez-le ou ajoutez un cas vertical/horizontal où `technique` est
    // présente : la hauteur calculée ne doit PAS inclure de ligne pour elle. » Risque pratique
    // faible (`selectedStats` exclut déjà inconditionnellement `technique`, Task 2 puis
    // Task 3/4 pour les 4 gabarits, déjà couvert indirectement par ses propres tests sur
    // `statKeys`) — demandé explicitement par le brief, donc vérifié ici pour de vrai sur la
    // HAUTEUR calculée (`currentTemplate`), pas seulement sur la liste `statKeys` transmise à
    // `renderBadge`.
    it('Vertical avec `technique` sur le projet : la hauteur calculée ne réserve PAS de ligne pour elle (Task 2, vérifié ici sur `currentTemplate`)', async () => {
      stubCanvas()
      const project = { id: 74, name: 'X', photos: ['data:image/jpeg;base64,COVER'], technique: 'knitting' }
      const { wrapper } = mountComposer(project)
      await flushPromises()

      const statKeysSansTechnique = ['totalTime', 'startedOn', 'bestStreak', 'sessionsCount']
      const n = buildRawStatLines(statKeysSansTechnique, { stats, t: i18n.global.t, locale: 'fr', project, yarnUsage: [] }).length
      // (a) sanity : `technique` compterait bien pour une ligne de PLUS si elle n'était pas
      // exclue — sans ce repère, un bug qui la laisserait rentrer resterait invisible ici.
      const avecTechniqueSiIncluse = buildRawStatLines(['technique', ...statKeysSansTechnique], {
        stats, t: i18n.global.t, locale: 'fr', project, yarnUsage: [],
      }).length
      expect(avecTechniqueSiIncluse).toBe(n + 1)

      const attendu = computeBadgeGeometry('vertical', 1, n, 1, false, 0, 0, n) // n SANS technique ; pairCount = n, cf. Task 9
      // (b) preuve sur `currentTemplate` lui-même (`effectiveStatKeys` est déjà couvert par les
      // tests Task 2 sur `statKeys` transmis à `renderBadge` — ici on vérifie la HAUTEUR).
      expect(wrapper.vm.currentTemplate).toEqual(attendu)
    })

    // Ce test vérifiait auparavant que minimal/double gardaient `customText` mélangé aux
    // stats et ne réservaient jamais de `freeTextLineCount` — comportement désormais caduc :
    // le chantier « badge corrections typo/zoom » (19/09, Task 4) unifie les 4 gabarits sur le
    // même traitement que Vertical/Horizontal (Task 6) : `customText`/`technique` sortent tous
    // deux de `statLineCount`, le texte libre est réservé À PART via `freeTextLineCount`.
    it('minimal/double : `currentTemplate` réserve le texte libre à part comme les autres gabarits (unification 19/09)', async () => {
      stubCanvas()
      const project = { id: 73, name: 'X', photos: [], technique: 'crochet' } // pas de couverture -> minimal
      const { wrapper } = mountComposer(project)
      await flushPromises()
      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      await wrapper.find('[data-test="badge-text"]').setValue('Bravo')
      await flushPromises()
      await waitForPreview()

      // `technique`/`customText` tous deux ABSENTS de cet appel — mêmes 4 stats par défaut que
      // les autres gabarits, cf. le test Vertical équivalent plus haut.
      const statKeys = ['totalTime', 'startedOn', 'bestStreak', 'sessionsCount']
      const n = buildRawStatLines(statKeys, { stats, t: i18n.global.t, locale: 'fr', project, yarnUsage: [] }).length
      const attenduMinimal = computeBadgeGeometry('minimal', 1, n, 1, false, 0, 1, n) // pairCount = n, cf. Task 9
      expect(wrapper.vm.currentTemplate).toEqual(attenduMinimal)

      // Les pastilles de gabarit (`.bdg__tpl`) vivent dans l'onglet Format, pas Infos —
      // retour sur cet onglet avant de changer de gabarit (`badgeText` persiste entre onglets).
      await wrapper.find('[data-test="badge-tab-format"]').trigger('click')
      await wrapper.findAll('.bdg__tpl')[3].trigger('click') // TEMPLATE_KEYS[3] === 'double'
      await flushPromises()
      await waitForPreview()
      const attenduDouble = computeBadgeGeometry('double', [1, 1], n, 1, false, 0, 1, n) // pairCount = n, cf. Task 9
      expect(wrapper.vm.currentTemplate).toEqual(attenduDouble)
    })
  })

  it('texte libre (Infos) : transmis à la prévisu et au badge généré', async () => {
    const { calls } = stubCanvas()
    const project = { id: 25, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    await wrapper.find('[data-test="badge-text"]').setValue('Bravo ✨')
    await flushPromises()
    await waitForPreview()
    expect(renderBadgeSpy.mock.calls.at(-1)[1].customText).toBe('Bravo ✨')

    await triggerShare(wrapper)
    expect(projectsStore.update).toHaveBeenCalled()
    expect(renderBadgeSpy.mock.calls.at(-1)[1].customText).toBe('Bravo ✨')
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts).toContain('Bravo ✨')
  })

  // Retour utilisateur (17/09) : après saisie, valider (touche Entrée du clavier virtuel,
  // action « Terminé »/« Go ») doit refermer le clavier — la prévisu, déjà affichée sous les
  // onglets, redevient alors visible sans action supplémentaire.
  it('texte libre (Infos) : Entrée referme le clavier virtuel (blur), la prévisu redevient visible', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 36, name: 'X', photos: [] })
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const input = wrapper.find('[data-test="badge-text"]')
    // `document.activeElement` ne reflète le focus réel que si le wrapper est attaché au DOM
    // vivant (`attachTo`, pas le cas ici comme dans le reste du fichier) — on vérifie l'appel à
    // `blur()` directement plutôt que l'état de focus global du document.
    const blurSpy = vi.spyOn(input.element, 'blur')
    await input.trigger('keydown', { key: 'Enter' })
    expect(blurSpy).toHaveBeenCalled()
  })

  // Onglet Photo supprimé (17/09) : modifier une photo passe par la pop-up BadgePhotoPicker,
  // ouverte depuis un clic sur la prévisu (cf. openPhotoPicker) — plus par un bouton dans un
  // onglet dédié.
  it('pop-up photo : le bouton galerie/caméra réutilise pickImage() puis le recadrage habituel', async () => {
    stubCanvas()
    const project = { id: 26, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper, cropperStore } = mountComposer(project)
    pickImage.mockResolvedValueOnce('data:image/jpeg;base64,DEVICE')
    cropperStore.crop = vi.fn().mockResolvedValue('data:image/jpeg;base64,DEVICE-CROPPED')

    await openPhotoPicker(wrapper)
    await wrapper.find('[data-test="photo-picker-device"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="photo-picker-ratio-square"]').trigger('click')
    await flushPromises()
    await waitForPreview()

    expect(pickImage).toHaveBeenCalled()
    expect(cropperStore.crop).toHaveBeenCalledWith('data:image/jpeg;base64,DEVICE', 1)
    expect(renderBadgeSpy.mock.calls.at(-1)[1].photoImg.src).toBe('data:image/jpeg;base64,DEVICE-CROPPED')
  })

  it('gabarit Deux images : chaque encart cible son propre emplacement', async () => {
    stubCanvas()
    const project = {
      id: 27,
      name: 'X',
      photos: ['data:image/jpeg;base64,COVER', 'data:image/jpeg;base64,SECOND'],
    }
    const { wrapper, cropperStore } = mountComposer(project)
    cropperStore.crop = vi.fn().mockImplementation((dataUrl) => Promise.resolve(dataUrl))

    await wrapper.findAll('.bdg__tpl')[3].trigger('click') // TEMPLATE_KEYS[3] === 'double'
    await flushPromises()

    // Emplacement 2 (vide par défaut, l'emplacement 1 porte déjà la couverture) : canvas
    // 1080×1350, slots par défaut (ratio carré) à x=90/w=430 et x=560/w=430 — centre du 2e
    // à (775, 305).
    await openPhotoPicker(wrapper, { x: 775, y: 305, w: 1080, h: 1350 })
    await wrapper.findAll('.bpp__pick')[1].trigger('click') // 2e photo du projet
    await wrapper.find('[data-test="photo-picker-ratio-square"]').trigger('click')
    await flushPromises()
    await waitForPreview()

    const lastCall = renderBadgeSpy.mock.calls.at(-1)[1]
    expect(lastCall.photoImg.src).toBe('data:image/jpeg;base64,COVER')
    expect(lastCall.photoImg2.src).toBe('data:image/jpeg;base64,SECOND')
  })

  // Revue « pop-up photo » (17/09) : le ratio se choisit désormais AU RECADRAGE, dans la
  // pop-up (3 icônes — carré direct, horizontal/vertical déroulent 2 valeurs) — libre,
  // indépendant du gabarit du badge.
  it('pop-up photo : les 3 icônes de ratio pilotent l’aspect transmis au recadrage', async () => {
    stubCanvas()
    const project = { id: 30, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper, cropperStore } = mountComposer(project)
    cropperStore.crop = vi.fn().mockImplementation((dataUrl) => Promise.resolve(dataUrl))

    await openPhotoPicker(wrapper)
    await wrapper.find('.bpp__pick').trigger('click')
    await wrapper.find('[data-test="photo-picker-ratio-square"]').trigger('click')
    await flushPromises()
    expect(cropperStore.crop).toHaveBeenLastCalledWith('data:image/jpeg;base64,COVER', 1)

    await openPhotoPicker(wrapper)
    await wrapper.find('.bpp__pick').trigger('click')
    await wrapper.find('[data-test="photo-picker-ratio-horizontal"]').trigger('click')
    await wrapper.find('[data-test="photo-picker-ratio-16:9"]').trigger('click')
    await flushPromises()
    expect(cropperStore.crop).toHaveBeenLastCalledWith('data:image/jpeg;base64,COVER', 16 / 9)

    await openPhotoPicker(wrapper)
    await wrapper.find('.bpp__pick').trigger('click')
    await wrapper.find('[data-test="photo-picker-ratio-vertical"]').trigger('click')
    await wrapper.find('[data-test="photo-picker-ratio-3:4"]').trigger('click')
    await flushPromises()
    expect(cropperStore.crop).toHaveBeenLastCalledWith('data:image/jpeg;base64,COVER', 3 / 4)
  })

  it('prévisu : un clic sur une photo affiche « Modifier », qui ouvre la pop-up photo', async () => {
    stubCanvas()
    const project = { id: 28, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper } = mountComposer(project)
    await flushPromises()

    const canvas = wrapper.find('.bdg__preview')
    expect(wrapper.find('[data-test="badge-preview-fix"]').exists()).toBe(false)
    // Gabarit Vertical par défaut : photoSlot { x:90, y:90, w:900, h:900 } — la hauteur du
    // canevas varie avec le nombre de lignes de stats (cf. badge-render.js), mais le slot
    // reste assez grand pour qu'un clic à son centre le touche même avec un stub approximatif.
    canvas.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1080, height: 1620 })
    await canvas.trigger('click', { clientX: 540, clientY: 540 })
    expect(wrapper.find('[data-test="badge-preview-fix"]').exists()).toBe(true)

    await wrapper.find('[data-test="badge-preview-fix"]').trigger('click')
    expect(wrapper.find('[data-test="photo-picker-device"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="badge-preview-fix"]').exists()).toBe(false)
  })

  // `computeBadgeGeometry` dimensionne maintenant le canevas des gabarits à photo à partir du
  // nombre de lignes de stats (cf. badge-render.js) : `currentTemplate` DOIT recevoir le même
  // nombre que celui réellement transmis à `renderBadge`, sinon `previewFixStyle` (qui se
  // repère en pourcentage de `currentTemplate.value.canvas`) décale le bouton « Modifier » par
  // rapport à la photo RÉELLEMENT dessinée (bug découvert en revue du correctif du canevas).
  it('bouton « Modifier » : positionné selon la hauteur RÉELLE du canevas dessiné, pas un défaut à 0 ligne de stats', async () => {
    stubCanvas()
    const project = { id: 30, name: 'X', photos: ['data:image/jpeg;base64,COVER'] } // pas de technique : 4 stats par défaut (yarns décoché, yarnUsage vide)
    const { wrapper } = mountComposer(project)
    await flushPromises()

    const canvas = wrapper.find('.bdg__preview')
    const realH = canvas.element.height // hauteur RÉELLEMENT posée par renderBadge sur ce <canvas>
    expect(realH).toBeGreaterThan(0)
    // Affichage stub à la même échelle que la résolution interne (1:1), pour lire directement
    // en pixels réels le pourcentage posé par `previewFixStyle`.
    canvas.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1080, height: realH })
    // Centre du slot photo (carré 900×900 ancré en (90,90)) : indépendant du nombre de stats.
    await canvas.trigger('click', { clientX: 540, clientY: 540 })
    const fixBtn = wrapper.find('[data-test="badge-preview-fix"]')
    expect(fixBtn.exists()).toBe(true)
    const topPercent = parseFloat(fixBtn.element.style.top)
    expect((topPercent / 100) * realH).toBeCloseTo(540, 0)
  })

  it('bouton Partager : génère puis ouvre le partage OS directement, sans confirmation', async () => {
    stubCanvas()
    const project = { id: 29, name: 'X', photos: [], technique: 'knitting' }
    const { wrapper, projectsStore } = mountComposer(project)
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await triggerShare(wrapper)

    expect(projectsStore.update).toHaveBeenCalled()
    expect(shareImageDataUrl).toHaveBeenCalledWith(
      'data:image/jpeg;base64,BADGE-RESIZED',
      expect.objectContaining({ filename: 'badge-29.jpg' }),
    )
  })

  it('bouton « Modifier » : la position utilise les dimensions RÉELLES du canevas, jamais la prédiction du composant (ne peut plus désynchroniser après un retour à la ligne réel)', async () => {
    stubCanvas()
    const project = { id: 31, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper } = mountComposer(project)
    await flushPromises()

    const canvas = wrapper.find('.bdg__preview')
    // Simule un canevas RÉELLEMENT plus haut que ce que `currentTemplate` (la prédiction du
    // composant) calcule — le cas réel une fois qu'un titre ou une ligne de stat retourne à la
    // ligne dans un vrai navigateur, jamais reproductible sous jsdom où `ctx` est toujours nul
    // (cf. badge-render.spec.js, describe « anti-troncature »).
    const realH = canvas.element.height + 300
    canvas.element.height = realH
    canvas.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1080, height: realH })

    await canvas.trigger('click', { clientX: 540, clientY: 540 })
    const fixBtn = wrapper.find('[data-test="badge-preview-fix"]')
    const topPercent = parseFloat(fixBtn.element.style.top)
    // Centre du slot photo (carré 900×900 ancré en y=90), rapporté à la hauteur RÉELLE
    // simulée : si le code lisait encore `currentTemplate.value.canvas.h` (la prédiction,
    // inchangée par cette simulation), ce calcul ne retomberait PAS sur 540.
    expect((topPercent / 100) * realH).toBeCloseTo(540, 0)
  })

  it('onglet Infos : les pastilles affichent la valeur réelle du projet, pas un libellé générique, et se désactivent au clic', async () => {
    const { calls } = stubCanvas()
    // `startedAt` renseigné : la pastille « Dates » n'existe QUE si le projet a une date
    // (cf. `genericPillKeys`) — sans elle ce test compterait 5 pastilles et vérifierait la
    // mauvaise, alors qu'il porte sur le contenu des pastilles, pas sur leur présence.
    const project = { id: 33, name: 'X', photos: [], technique: 'knitting', startedAt: '2026-01-05' }
    // Une laine liée : la pastille dédiée 'yarns' (Task 6) apparaît alors avec un texte réel,
    // couverte par la boucle générique ci-dessous comme les autres pastilles.
    const yarnUsage = [{ yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 }]
    const { wrapper, projectsStore } = mountComposer(project, { yarnUsage })
    projectsStore.update = vi.fn().mockResolvedValue(undefined)

    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const pills = wrapper.findAll('.bdg__pill')
    // 4 clés de STAT_KEYS (hors 'yarns', traitée à part) + Technique + Laine(s).
    expect(pills.length).toBe(6)
    const genericLabels = ['Temps total', 'Dates', 'Meilleure série', 'Sessions', 'Technique']
    for (const pill of pills) {
      expect(genericLabels).not.toContain(pill.text())
      expect(pill.text().length).toBeGreaterThan(0)
    }

    const streakPill = pills[2] // ordre : totalTime, startedOn, bestStreak, sessionsCount, Technique, Laine(s)
    expect(streakPill.attributes('aria-pressed')).toBe('true')
    const streakText = streakPill.text()
    await streakPill.trigger('click')
    expect(streakPill.attributes('aria-pressed')).toBe('false')

    await triggerShare(wrapper)
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
    expect(texts.some((s) => s.includes(streakText))).toBe(false)
  })

  it('onglet Infos : pastille "Laine(s)" affiche une paire nom+pelotes PAR laine, cochée par défaut si des laines sont liées', async () => {
    stubCanvas()
    const yarnUsage = [
      { yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 },
      { yarn: { brand: 'Rico', model: 'Creative' }, balls: 2 },
    ]
    const { wrapper } = mountComposer({ id: 40, name: 'X', photos: [] }, { yarnUsage })
    await flushPromises()
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')

    const pill = wrapper.find('[data-test="badge-yarns"]')
    expect(pill.exists()).toBe(true)
    expect(pill.classes()).toContain('bdg__pill--on') // cochée par défaut, laines liées
    expect(pill.text()).toContain('Drops Merino')
    expect(pill.text()).toContain('Rico Creative')
  })

  // Un projet créé mais jamais travaillé n'a ni `startedAt` ni `finishedAt` : la pastille
  // « Dates » afficherait « Commencé le » suivi de rien (et le badge la même ligne creuse).
  it('onglet Infos : pastille « Dates » absente si le projet n’a aucune date', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 42, name: 'X', photos: [], startedAt: '', finishedAt: '' })
    await flushPromises()
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const texts = wrapper.findAll('.bdg__pill').map((p) => p.text())
    expect(texts.some((s) => s.includes('Commencé le'))).toBe(false)
    expect(texts.every((s) => s.length > 0)).toBe(true) // aucune pastille vide, invisible mais cliquable
  })

  it('onglet Infos : pastille "Laine(s)" absente sans laine liée au projet', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 41, name: 'X', photos: [] }, { yarnUsage: [] })
    await flushPromises()
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    expect(wrapper.find('[data-test="badge-yarns"]').exists()).toBe(false)
  })

  describe('option Avancement (progress)', () => {
    it('disponible et cochée par défaut pour un projet en cours avec rowsProgress connu', async () => {
      const { wrapper } = mountComposer(
        { id: 90, name: 'X', photos: [], status: 'wip' },
        { stats: { ...stats, rowsProgress: { done: 10, total: 40 } } },
      )
      await flushPromises()
      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      expect(wrapper.find('[data-test="badge-stat-progress"]').exists()).toBe(true)
      expect(wrapper.vm.selectedStats).toContain('progress')
    })

    it('absente pour un projet terminé', async () => {
      const { wrapper } = mountComposer(
        { id: 91, name: 'X', photos: [], status: 'done' },
        { stats: { ...stats, rowsProgress: { done: 40, total: 40 } } },
      )
      await flushPromises()
      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      expect(wrapper.find('[data-test="badge-stat-progress"]').exists()).toBe(false)
    })

    it('absente quand rowsProgress est null (aucun total de rangs connu)', async () => {
      const { wrapper } = mountComposer(
        { id: 92, name: 'X', photos: [], status: 'wip' },
        { stats: { ...stats, rowsProgress: null } },
      )
      await flushPromises()
      await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
      expect(wrapper.find('[data-test="badge-stat-progress"]').exists()).toBe(false)
    })

    // Revue Task B (chantier « badge motif d'avancement » 20/09) : `statLineCount` (ce fichier)
    // mesure la géométrie AVANT que `renderBadge` ne dessine quoi que ce soit (même invariant
    // que le test `freeTextLineCount` plus haut) — `buildRawStatLines` NON structuré compose
    // `progress` en une seule ligne jointe, sans savoir que son motif réserve une rangée FIXE
    // de plus côté dessin réel (`stackedRowCount`, badge-render.js, structured). Sans le « + 1 »
    // ajouté à `statLineCount`, `currentTemplate.canvas.h` sous-évaluait la hauteur réelle
    // exactement pour ce cas — même classe de bug que celle documentée pour `startedOn`.
    it("statLineCount ajoute exactement 1 rangée pour le motif quand progress est sélectionné avec rowsProgress connu, jamais quand il est absent", async () => {
      const projetEnCours = { id: 93, name: 'X', photos: [], status: 'wip' }
      const { wrapper: avecMotif } = mountComposer(
        projetEnCours,
        { stats: { ...stats, rowsProgress: { done: 10, total: 40 } } },
      )
      await flushPromises()
      expect(avecMotif.vm.selectedStats).toContain('progress')
      const rawLenAvecMotif = buildRawStatLines(avecMotif.vm.selectedStats, {
        stats: avecMotif.props('stats'), t: i18n.global.t, locale: 'fr',
        project: projetEnCours, yarnUsage: [],
      }).length
      // La rangée motif n'existe nulle part dans le compte NON structuré ci-dessus (une seule
      // ligne jointe « Label · Valeur » par stat, cf. `statLines`) — `statLineCount` doit donc
      // ajouter EXACTEMENT 1 par rapport à cette mesure brute.
      expect(avecMotif.vm.statLineCount).toBe(rawLenAvecMotif + 1)

      const { wrapper: sansMotif } = mountComposer(
        { id: 94, name: 'X', photos: [], status: 'wip' },
        { stats: { ...stats, rowsProgress: null } },
      )
      await flushPromises()
      // `progress` absente de `selectedStats` (jamais proposée sans `rowsProgress`, cf. tests
      // ci-dessus) : aucune rangée motif à ajouter, `statLineCount` colle exactement à la
      // mesure brute.
      expect(sansMotif.vm.selectedStats).not.toContain('progress')
      const rawLenSansMotif = buildRawStatLines(sansMotif.vm.selectedStats, {
        stats: sansMotif.props('stats'), t: i18n.global.t, locale: 'fr',
        project: { id: 94, name: 'X', photos: [], status: 'wip' }, yarnUsage: [],
      }).length
      expect(sansMotif.vm.statLineCount).toBe(rawLenSansMotif)
    })
  })

  it('onglet Infos : les pastilles sont regroupées en lignes (flex-wrap), pas une par ligne', () => {
    const css = styleCss()
    expect(css).toMatch(/\.bdg__pills\s*\{[^}]*flex-wrap:\s*wrap/s)
  })

  it('onglet Infos : aria-label combine libellé et valeur pour l’accessibilité', async () => {
    stubCanvas()
    const project = { id: 34, name: 'X', photos: [], technique: 'crochet' }
    const { wrapper } = mountComposer(project)
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const techniquePill = wrapper.find('[data-test="badge-technique"]')
    expect(techniquePill.attributes('aria-label')).toBe('Technique : Crochet')
  })

  it('carte calendaire : pastille absente si le projet n’a aucune donnée de grille', async () => {
    stubCanvas()
    const project = { id: 40, name: 'X', photos: [] }
    const { wrapper } = mountComposer(project) // `stats` partagé du fichier n'a pas de `grid` non vide par défaut
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    expect(wrapper.find('[data-test="badge-calendar"]').exists()).toBe(false)
  })

  it('carte calendaire : pastille présente et activable si le projet a des données de grille, transmise au rendu', async () => {
    stubCanvas()
    const project = { id: 41, name: 'X', photos: [] }
    const statsWithGrid = {
      ...stats,
      grid: { columns: [{ monday: 'col-0', cells: Array.from({ length: 7 }, (_, i) => ({ day: `d${i}`, level: 1, future: false })) }] },
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const projectsStore = useProjectsStore()
    projectsStore.projects = [project]
    const settingsStore = useSettingsStore()
    settingsStore.rememberBadgeColor = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(BadgeComposer, { props: { project, stats: statsWithGrid }, global: { plugins: [i18n, pinia] } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const pill = wrapper.find('[data-test="badge-calendar"]')
    expect(pill.exists()).toBe(true)
    expect(pill.attributes('aria-pressed')).toBe('true')

    await pill.trigger('click')
    expect(pill.attributes('aria-pressed')).toBe('false')
    await flushPromises()
    await waitForPreview()
    expect(renderBadgeSpy.mock.calls.at(-1)[1].includeCalendar).toBe(false)
  })

  it('carte calendaire cochée par défaut quand le projet a des données de grille', async () => {
    stubCanvas()
    const project = { id: 42, name: 'X', photos: [] }
    const statsWithGrid = {
      ...stats,
      grid: { columns: [{ monday: 'col-0', cells: Array.from({ length: 7 }, (_, i) => ({ day: `d${i}`, level: 1, future: false })) }] },
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const projectsStore = useProjectsStore()
    projectsStore.projects = [project]
    const settingsStore = useSettingsStore()
    settingsStore.rememberBadgeColor = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(BadgeComposer, { props: { project, stats: statsWithGrid }, global: { plugins: [i18n, pinia] } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const pill = wrapper.find('[data-test="badge-calendar"]')
    expect(pill.attributes('aria-pressed')).toBe('true')
  })

  it('laines cochées par défaut dès qu’au moins une laine est liée (yarnUsage non vide)', async () => {
    stubCanvas()
    const project = { id: 44, name: 'X', photos: [], technique: 'knitting' }
    const yarnUsage = [{ yarn: { brand: 'Drops', model: 'Merino' }, balls: 4 }]
    const { wrapper } = mountComposer(project, { yarnUsage })
    await flushPromises()

    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    const yarnsPill = wrapper.find('[data-test="badge-yarns"]')
    expect(yarnsPill.exists()).toBe(true)
    expect(yarnsPill.attributes('aria-pressed')).toBe('true')
    expect(yarnsPill.attributes('aria-label')).toBe('Laines : Drops Merino')
  })

  it('i18n : les libellés de la poignée du tiroir existent dans les 4 langues', async () => {
    const modules = await Promise.all(
      ['fr', 'de', 'en', 'es'].map((code) => import(`@/i18n/${code}.json`)),
    )
    for (const mod of modules) {
      const badge = mod.default.project.stats.badge
      expect(typeof badge.drawerExpand).toBe('string')
      expect(badge.drawerExpand.length).toBeGreaterThan(0)
      expect(typeof badge.drawerCollapse).toBe('string')
      expect(badge.drawerCollapse.length).toBeGreaterThan(0)
    }
  })

  it('prévisu : occupe le viewport en fond MOINS la bande réservée au tiroir (position fixed du conteneur, pas de scroll dédié)', () => {
    const css = styleCss()
    // `.bdg__preview-layer` (position: absolute; inset: 0, `bottom` ensuite écrasé par la
    // déclaration plus tardive ci-dessous) centre le canevas par flexbox — plus de conteneur
    // `.bdg__preview-scroll` intermédiaire à `overflow-y: auto` dédié à la prévisu seule. Il ne
    // couvre PAS tout le viewport : son bord bas s'arrête au bord haut du tiroir (`.bdg__drawer`),
    // qui se pose par-dessus à dessein (cf. commentaire du composant) pour ne jamais masquer les
    // réglages en cours sous le badge.
    expect(css).not.toMatch(/\.bdg__preview-scroll/)
    expect(css).not.toMatch(/\.bdg__preview-wrap/)
    expect(css).toMatch(/\.bdg__preview-layer\s*\{[^}]*position:\s*absolute/s)
    expect(css).toMatch(/\.bdg__preview-layer\s*\{[^}]*inset:\s*0/s)

    // Doublet vh/dvh sur `bottom`, même motif que `.bdg__drawer` (repli WebView sans `dvh`,
    // cf. test dédié plus bas) : la classe `.bdg__preview-layer--drawer-expanded`, posée quand
    // le tiroir est déplié (cf. template), reprend EXACTEMENT les seuils de
    // `.bdg__drawer`/`.bdg__drawer--expanded`.
    const layerBlock = css.match(/\.bdg__preview-layer\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(layerBlock).toMatch(/bottom:\s*max\(160px,\s*22vh\)[\s\S]*bottom:\s*max\(160px,\s*22dvh\)/)

    const expandedBlock = css.match(/\.bdg__preview-layer--drawer-expanded\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(expandedBlock).toMatch(/bottom:\s*max\(420px,\s*68vh\)[\s\S]*bottom:\s*max\(420px,\s*68dvh\)/)
  })

  it('prévisu : la classe `--drawer-expanded` bascule avec l’état du tiroir', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 51, name: 'X', photos: [] })
    await flushPromises()

    const layer = wrapper.find('.bdg__preview-layer')
    expect(layer.classes()).not.toContain('bdg__preview-layer--drawer-expanded')

    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    await handle.trigger('click')
    expect(layer.classes()).toContain('bdg__preview-layer--drawer-expanded')

    await handle.trigger('click')
    expect(layer.classes()).not.toContain('bdg__preview-layer--drawer-expanded')
  })

  it('prévisu : le calque centre le cadre par flexbox, le canevas remplit son cadre sans object-fit', () => {
    // Round 3 : la taille du cadre (`.bdg__preview-frame`) n'est plus posée en CSS pur (les
    // rounds 1/2 s'appuyaient sur `max-width/max-height: 100%`, invalidés par la mesure
    // Playwright du round 2 dès que c'est la HAUTEUR qui contraint le rendu — voir le test
    // dynamique plus bas et le rapport de tâche) mais calculée en JS (`previewFrameStyle`,
    // affectée en style inline). Le CSS statique se limite donc à : le calque centre le cadre
    // par flexbox, et le canevas REMPLIT exactement son cadre (`width/height: 100%`, jamais
    // `object-fit` qui désynchroniserait `getBoundingClientRect()`, cf. round 1).
    const css = styleCss()
    const layerBlock = css.match(/\.bdg__preview-layer\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(layerBlock).toMatch(/display:\s*flex/)
    expect(layerBlock).toMatch(/align-items:\s*center/)
    expect(layerBlock).toMatch(/justify-content:\s*center/)

    const previewBlock = css.match(/\.bdg__preview\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(previewBlock).toMatch(/(?<!max-)width:\s*100%/)
    expect(previewBlock).toMatch(/(?<!max-)height:\s*100%/)
    expect(previewBlock).not.toMatch(/object-fit/)
  })

  it('bouton « Modifier » : `.bdg__preview-frame` est le bloc englobant positionné (taille posée en JS, pas en CSS)', () => {
    // `previewFixStyle` ne passe jamais par `getBoundingClientRect()`, elle pose des
    // pourcentages CSS purs sur `.bdg__preview-fix` (`position: absolute`) — son bloc englobant
    // doit donc être un ancêtre positionné dont la boîte épouse la taille RÉELLE du canevas.
    // Round 3 : ce n'est plus le CSS statique qui pose cette taille (voir historique dans le
    // commentaire du composant) — `.bdg__preview-frame` ne porte plus que `position: relative`,
    // sa taille arrive en style inline via `previewFrameStyle` (testé plus bas).
    const css = styleCss()
    const frameBlock = css.match(/\.bdg__preview-frame\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(frameBlock).toMatch(/position:\s*relative/)
    expect(frameBlock).not.toMatch(/max-width/)
    expect(frameBlock).not.toMatch(/max-height/)
    expect(frameBlock).not.toMatch(/width:\s*auto/)
    expect(frameBlock).not.toMatch(/height:\s*auto/)

    // Gabarit : `.bdg__preview-fix` doit être un DESCENDANT de `.bdg__preview-frame`, pas un
    // enfant direct de `.bdg__preview-layer` posé à côté du canevas. Attributs additionnels
    // possibles sur la balise d'ouverture (`ref`, `:style`) : `[^>]*` avant le `>` fermant.
    const frameMarkup = src().match(/<div class="bdg__preview-frame"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? ''
    expect(frameMarkup).toMatch(/bdg__preview-fix/)
    expect(frameMarkup).toMatch(/<canvas/)
  })

  // Round 3 (18/09) : les rounds 1/2 (CSS pur) ont été invalidés par une mesure Playwright —
  // `max-width/max-height: 100%` imbriqué dans un conteneur flex shrink-to-fit ne se résout pas
  // de façon fiable quand c'est la HAUTEUR qui contraint le rendu (canevas débordant de 50 à
  // 128px selon le viewport mesuré, cf. rapport de tâche). `previewFrameStyle` remplace ce
  // calcul par un contain-fit déterministe EN JS (pixels explicites), sur le même principe que
  // `canvasBoxStyle`/`fitWithinBox` de PhotoLightbox.vue. jsdom ne fait pas de vrai layout
  // (`clientWidth`/`clientHeight` valent 0 par défaut) : on les force sur le vrai nœud DOM
  // `.bdg__preview-layer`, même technique que tests/unit/photo-lightbox-zoom.spec.js
  // (`Object.defineProperty` + le callback d'un `ResizeObserver` factice déclenché à la main,
  // qui appelle `measurePreviewBox()`). ResizeObserver ABSENT de jsdom (jamais polyfillé, cf.
  // tests/unit/setup.js) : mock minimal, même patron que reader-text-editor.spec.js/
  // radial-calibration-wizard.spec.js pour cette même API. `measurePreviewBox` relit
  // `clientWidth`/`clientHeight` directement sur le noeud plutôt que sur l'entrée passée au
  // callback (cf. <script setup>), donc le mock n'a pas besoin de fabriquer un `ResizeObserverEntry`
  // réaliste — l'appeler sans argument suffit. Les dimensions du canevas lui-même
  // (`canvas.width`/`height`) sont les VRAIES valeurs posées par `renderBadge` (jsdom ne décode
  // pas le contexte 2D, mais ces attributs sont posés avant tout appel de dessin — même
  // hypothèse que les tests `previewFixStyle` existants, qui lisent aussi `canvas.element.height`
  // directement).
  it('cadre : previewFrameStyle calcule un contain-fit déterministe en JS, largeur ET hauteur contraintes', async () => {
    // Deux `ResizeObserver` distincts depuis le correctif du 18/09 soir (calque de prévisu ET
    // tiroir, cf. <script setup>) : le mock retrouve celui du calque par l'élément observé,
    // pas par l'ordre de création (fragile, cf. commentaire de tête du fichier sur ce point).
    const roInstances = []
    const originalRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb
        roInstances.push(this)
      }
      observe(el) {
        this.el = el
      }
      disconnect() {}
    }
    try {
      stubCanvas()
      const project = { id: 32, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
      const { wrapper } = mountComposer(project)
      await flushPromises()

      const canvasEl = wrapper.find('.bdg__preview').element
      const canvasW = canvasEl.width
      const canvasH = canvasEl.height
      expect(canvasW).toBeGreaterThan(0)
      expect(canvasH).toBeGreaterThan(0)
      const canvasRatio = canvasW / canvasH

      const layerEl = wrapper.find('.bdg__preview-layer').element
      const frameEl = wrapper.find('.bdg__preview-frame').element
      const layerRO = roInstances.find((r) => r.el === layerEl)
      expect(layerRO).toBeTruthy()

      // Cas LARGEUR-contrainte : boîte relativement plus étroite/haute que le badge (ratio
      // boîte < ratio canevas) — la largeur du cadre est plafonnée à celle de la boîte, la
      // hauteur calculée par le ratio intrinsèque.
      Object.defineProperty(layerEl, 'clientWidth', { value: 400, configurable: true })
      Object.defineProperty(layerEl, 'clientHeight', { value: 2000, configurable: true })
      layerRO.cb()
      await wrapper.vm.$nextTick()
      expect(frameEl.style.width).toBe('400px')
      expect(parseFloat(frameEl.style.height)).toBeCloseTo(400 / canvasRatio, 1)

      // Cas HAUTEUR-contrainte — celui qui faisait déborder le canevas aux rounds 1/2 (boîte
      // relativement plus large/courte que le badge, ratio boîte > ratio canevas) : la hauteur
      // du cadre est plafonnée à celle de la boîte, la largeur calculée par le ratio, SANS
      // déborder.
      Object.defineProperty(layerEl, 'clientWidth', { value: 2000, configurable: true })
      Object.defineProperty(layerEl, 'clientHeight', { value: 400, configurable: true })
      layerRO.cb()
      await wrapper.vm.$nextTick()
      expect(frameEl.style.height).toBe('400px')
      expect(parseFloat(frameEl.style.width)).toBeCloseTo(400 * canvasRatio, 1)
    } finally {
      globalThis.ResizeObserver = originalRO
    }
  })

  it('cadre : un changement de taille du calque non signalé par `resize` (ex. recalcul de dvh) est repris via ResizeObserver', async () => {
    // Bug constaté en direct (18/09) : la barre d'adresse mobile qui apparaît/disparaît fait
    // varier `dvh` — donc la taille RÉELLE du calque — sans jamais déclencher de `resize` sur
    // `window`. Un `ResizeObserver` posé sur le calque lui-même doit reprendre la mesure quel
    // que soit ce qui a changé sa taille, sans dépendre de cet événement précis.
    const roInstances = []
    const originalRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb
        roInstances.push(this)
      }
      observe(el) {
        this.el = el
      }
      disconnect() {}
    }
    try {
      stubCanvas()
      const project = { id: 33, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
      const { wrapper } = mountComposer(project)
      await flushPromises()

      const layerEl = wrapper.find('.bdg__preview-layer').element
      const frameEl = wrapper.find('.bdg__preview-frame').element
      const layerRO = roInstances.find((r) => r.el === layerEl)
      expect(layerRO).toBeTruthy()
      const widthBefore = frameEl.style.width

      Object.defineProperty(layerEl, 'clientWidth', { value: 250, configurable: true })
      Object.defineProperty(layerEl, 'clientHeight', { value: 900, configurable: true })
      layerRO.cb()
      await wrapper.vm.$nextTick()

      expect(frameEl.style.width).not.toBe(widthBefore)
      expect(frameEl.style.width).toBe('250px')
    } finally {
      globalThis.ResizeObserver = originalRO
    }
  })

  it('calque de prévisu : l\'espace réservé au tiroir suit sa hauteur RÉELLE, pas son plafond replié/déplié', async () => {
    // Bug réel sur le Pixel 7 (CDP en direct, 18/09 soir), toujours présent malgré les deux
    // tests ci-dessus : `.bdg__preview-layer` réservait un `bottom` calé sur le PLAFOND
    // replié/déplié du tiroir (`.bdg__drawer--expanded`, doublet vh/dvh CSS), pas sur sa
    // hauteur RÉELLE. Le tiroir étant `height: auto` (grandit avec son contenu, cf. son propre
    // commentaire), un onglet court (Format) le laisse bien en-deçà de son plafond déplié — et
    // toute la différence restait en bande morte entre le badge et le vrai bord du tiroir.
    // Mesuré en direct : tiroir déplié à 224px de haut sur un plafond de 621px, prévisu
    // recadrée contre les 621px en entier. `previewLayerStyle` doit reprendre `bottom` sur
    // `drawerHeight` (mesurée par un second `ResizeObserver`, posé sur `.bdg__drawer` lui-même),
    // jamais sur la classe/le plafond CSS.
    const roInstances = []
    const originalRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(cb) {
        this.cb = cb
        roInstances.push(this)
      }
      observe(el) {
        this.el = el
      }
      disconnect() {}
    }
    try {
      stubCanvas()
      const project = { id: 34, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
      const { wrapper } = mountComposer(project)
      await flushPromises()

      const drawerEl = wrapper.find('[data-test="badge-drawer"]').element
      const layerEl = wrapper.find('.bdg__preview-layer').element
      const drawerRO = roInstances.find((r) => r.el === drawerEl)
      expect(drawerRO).toBeTruthy()

      // Tiroir DÉPLIÉ (onglet court) très en-deçà de son plafond de 621px, comme sur le Pixel.
      Object.defineProperty(drawerEl, 'clientHeight', { value: 224, configurable: true })
      drawerRO.cb()
      await wrapper.vm.$nextTick()

      expect(layerEl.style.bottom).toBe('224px')
    } finally {
      globalThis.ResizeObserver = originalRO
    }
  })

  it('tiroir bas : replié par défaut, la poignée bascule vers l’état déplié et inversement', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 50, name: 'X', photos: [] })
    await flushPromises()

    const drawer = wrapper.find('[data-test="badge-drawer"]')
    expect(drawer.exists()).toBe(true)
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    expect(handle.text()).toBe('Déplier les réglages')
    expect(handle.attributes('aria-expanded')).toBe('false')
    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
    expect(handle.text()).toBe('Replier')
    expect(handle.attributes('aria-expanded')).toBe('true')

    await handle.trigger('click')
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')
    expect(handle.text()).toBe('Déplier les réglages')
    expect(handle.attributes('aria-expanded')).toBe('false')
  })

  // Retour Julien (18/09 soir) : « je voudrais aussi ouvrir le tiroir par drag n drop et pas
  // seulement au tap ». `dispatchEvent` direct (pas `trigger()`) : même contournement que
  // chart-fullscreen.spec.js (bug connu vue-test-utils 2.4.11/jsdom où `clientY`, hérité de
  // `MouseEvent.prototype`, est vu comme assignable puis lève « has only a getter »). Les
  // listeners `pointermove`/`pointerup` sont posés sur `window` (cf. <script setup>), pas sur
  // la poignée — le glisser doit continuer de suivre même si le doigt sort de son cadre.
  it('tiroir bas : un glissement franc sur la poignée bascule le tiroir (pas seulement le tap)', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 54, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

    // Glisse vers le HAUT de 400px (clientY décroissant) : largement de quoi dépasser le point
    // médian replié/déplié quel que soit `window.innerHeight` en environnement de test.
    handle.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: 400, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientY: 400, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).toContain('bdg__drawer--expanded')

    // Et inversement, glisser vers le BAS referme.
    handle.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientY: 400, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientY: 800, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')
  })

  it('tiroir bas : un tap sans mouvement sur la poignée ne double-bascule pas (glissement + clic natif)', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 55, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')

    // pointerdown puis pointerup au MÊME endroit, sans mouvement : le chemin de glissement ne
    // doit rien faire (déplacement sous le seuil), seul le `@click` natif du bouton — déclenché
    // séparément ci-dessous, comme un vrai navigateur le ferait après un tap — bascule l'état.
    handle.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, clientY: 800, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
  })

  // Task 5 (chantier « badge corrections typo/zoom », intent 2026-09-19 retour zoom plein
  // écran) : exigence ajoutée par Julien en cours de conversation — glisser vers le haut sur
  // la PRÉVISU elle-même doit ouvrir le tiroir, exactement le même geste que sur la poignée
  // ci-dessus, juste une cible différente.
  it('prévisu : un glissement franc vers le haut sur la prévisu ouvre le tiroir (même geste que la poignée)', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 60, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const layer = wrapper.find('[data-test="badge-preview-layer"]')
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 10, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 10, clientY: 400, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10, clientY: 400, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
  })

  // Tâche 15 (chantier « badge corrections typo/zoom », 19/09) : Julien veut le MÊME geste de
  // fermeture utilisable depuis le CORPS du tiroir (`.bdg__drawer-body`, sous la poignée —
  // onglets Format/Couleur/Infos et leur contenu), pas seulement sa poignée. Règle standard
  // des feuilles coulissantes : seulement si le contenu du corps est déjà tout en haut
  // (`scrollTop === 0`) ET que le mouvement est vers le BAS.
  it('tiroir bas : un glissement franc vers le bas sur le CORPS du tiroir le referme, si son contenu est déjà tout en haut', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 61, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    const body = wrapper.find('[data-test="badge-drawer-body"]')

    // Déplie d'abord le tiroir (par un simple tap sur la poignée), pour avoir quelque chose à
    // refermer par le geste sur le corps.
    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')

    body.element.scrollTop = 0
    body.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 20, clientY: 400, bubbles: true }))
    // Un `pointermove` posé PENDANT la répartition d'un `pointermove` précédent n'est pas
    // notifié pour ce même événement (sémantique DOM standard) : le premier mouvement franchit
    // seulement le seuil et bascule vers `onDrawerHandlePointerDown` (qui pose ses propres
    // écouteurs) ; il faut un DEUXIÈME `pointermove`, comme le ferait un vrai doigt, pour que
    // le glissement de poignée reçoive un mouvement et referme le tiroir.
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 20, clientY: 410, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 20, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 20, clientY: 800, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')
  })

  it('tiroir bas : le même glissement vers le bas sur le CORPS ne referme PAS le tiroir si son contenu est déjà défilé (le défilement natif reste libre)', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 62, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    const body = wrapper.find('[data-test="badge-drawer-body"]')

    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')

    body.element.scrollTop = 40
    // jsdom ne fait aucune mise en page réelle mais conserve bien `scrollTop` comme une valeur
    // ordinaire assignée sur l'élément — cette assertion garantit que le test vérifie la vraie
    // garde `atTop`, pas une valeur retombée silencieusement à 0.
    expect(body.element.scrollTop).toBe(40)
    body.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, clientY: 400, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 21, clientY: 410, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 21, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, clientY: 800, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
    expect(wrapper.vm.dragHeight).toBe(null)
  })

  // Rescopé sur le tiroir DÉPLIÉ (Task « tiroir, deux finitions », 20/09) : ce test portait à
  // l'origine sur le tiroir REPLIÉ, mais un glisser vers le haut depuis le corps replié doit
  // désormais justement basculer vers le redimensionnement (cf. tests dédiés plus bas, juste
  // après celui-ci) — c'est la demande de Julien qui motive cette tâche. La garde qu'il vérifie
  // (un glisser vers le HAUT ne doit pas être pris pour le glisser-fermeture vers le BAS) reste
  // pertinente une fois le tiroir DÉPLIÉ, où le défilement natif du corps doit rester libre.
  it('tiroir bas, DÉPLIÉ : un glissement vers le HAUT depuis le CORPS (contenu tout en haut) ne bascule pas le redimensionnement', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 63, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    const body = wrapper.find('[data-test="badge-drawer-body"]')
    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')

    body.element.scrollTop = 0
    body.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 22, clientY: 800, bubbles: true }))
    // Deux `pointermove`, comme les tests de fermeture ci-dessus : un seul (800 -> 400) ne
    // serait pas discriminant. Si le contrôle de direction (`deltaDown > 6`) sautait, ce PREMIER
    // mouvement basculerait déjà vers `onDrawerHandlePointerDown` (la garde `atTop` seule ne
    // filtre pas le sens) — mais posé PENDANT la répartition de ce même `pointermove`, le
    // nouveau listener de glisser-poignée ne le reçoit pas (sémantique DOM standard). Il faut ce
    // SECOND `pointermove` (790 -> 400) pour qu'un tel glisser-poignée illégitime reçoive un
    // vrai mouvement, fasse grimper `dragHeight` au-dessus du point médian et bascule
    // `drawerExpanded` à tort — ce que la garde correcte doit empêcher.
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 22, clientY: 790, bubbles: true }))
    await wrapper.vm.$nextTick()
    // Discriminant : si la garde `!drawerExpanded.value` sautait, ce PREMIER `pointermove`
    // suffirait déjà à faire basculer vers `onDrawerHandlePointerDown`, qui fixe `dragHeight`
    // tout de suite (non nul) — avant même le second `pointermove`. Avec la garde correcte, rien
    // ne s'est encore produit ici : `dragHeight` doit rester `null`.
    expect(wrapper.vm.dragHeight).toBe(null)
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 22, clientY: 400, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 22, clientY: 400, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
    expect(wrapper.vm.dragHeight).toBe(null)
  })

  // Task « tiroir, deux finitions » (20/09) : retour Julien — « il faut supprimer le scroll
  // lorsque le tiroir est replié. Le swipe vers le haut doit ouvrir le tiroir et non scroller le
  // contenu. » Le corps replié n'a plus de défilement natif (`.bdg__drawer-body--locked`,
  // `overflow: hidden` + `touch-action: none`), donc un glisser vers le haut doit désormais
  // basculer vers le MÊME pont de redimensionnement que le glisser-fermeture vers le bas
  // ci-dessus, juste en sens inverse et réservé à l'état REPLIÉ (une fois déplié, le test
  // précédent montre que le scroll natif reprend la main).
  it('replié : le corps du tiroir n’a plus de défilement natif (overflow verrouillé)', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 66, name: 'X', photos: [] })
    await flushPromises()
    const body = wrapper.find('[data-test="badge-drawer-body"]')
    expect(body.classes()).toContain('bdg__drawer-body--locked')
  })

  it('replié : la règle `.bdg__drawer-body--locked` coupe bien le défilement natif ET le pan tactile', () => {
    const css = styleCss()
    const lockedBlock = css.match(/\.bdg__drawer-body--locked\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(lockedBlock).toMatch(/overflow:\s*hidden/)
    expect(lockedBlock).toMatch(/touch-action:\s*none/)
  })

  it('déplié : le corps du tiroir retrouve son défilement natif (verrou levé)', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 67, name: 'X', photos: [] })
    await flushPromises()
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    const body = wrapper.find('[data-test="badge-drawer-body"]')
    await handle.trigger('click')
    expect(body.classes()).not.toContain('bdg__drawer-body--locked')
  })

  it('replié : un glisser vers le haut sur le corps du tiroir bascule vers l’ouverture (même mécanisme que la poignée)', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 68, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const body = wrapper.find('[data-test="badge-drawer-body"]')
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

    body.element.scrollTop = 0
    body.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 30, clientY: 500, bubbles: true }))
    // Même contournement que les tests ci-dessus : il faut un DEUXIÈME `pointermove` pour que le
    // glisser de poignée, démarré par le premier (qui franchit seulement le seuil), reçoive un
    // vrai mouvement.
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 30, clientY: 490, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 30, clientY: 300, bubbles: true }))
    await wrapper.vm.$nextTick()
    // Suit le doigt EN DIRECT, comme un glisser de poignée classique (`dragHeight` posé, appliqué
    // en `:style` inline sur `.bdg__drawer`).
    expect(wrapper.vm.dragHeight).not.toBe(null)
    expect(drawer.attributes('style') || '').toContain('height')

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 30, clientY: 300, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
  })

  // Correctif revue finale (chantier « badge corrections typo/zoom » 19/09) : le même geste de
  // fermeture (Tâche 15, tests ci-dessus) amorcé DANS le champ de texte libre de l'onglet Infos
  // (`<input data-test="badge-text">`, en haut de son propre scroll — celui d'un `<input>` est
  // toujours 0) ne doit PAS être pris pour un candidat fermeture-tiroir : ce serait refermer le
  // tiroir en pleine saisie, alors que l'utilisatrice ne fait que sélectionner du texte ou
  // déplacer son curseur.
  it('tiroir bas : un glissement franc vers le bas amorcé DANS le champ de texte libre ne referme PAS le tiroir', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 64, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    const body = wrapper.find('[data-test="badge-drawer-body"]')

    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    body.element.scrollTop = 0
    // Même garde `atTop` que les tests Tâche 15 ci-dessus : sans cette assertion, un
    // `scrollTop` silencieusement retombé à une autre valeur ferait passer ce test pour la
    // mauvaise raison (la garde `atTop`, pas le garde-fou champ de saisie visé ici).
    expect(body.element.scrollTop).toBe(0)
    const input = wrapper.find('[data-test="badge-text"]')

    input.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 23, clientY: 400, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 23, clientY: 410, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 23, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 23, clientY: 800, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
    expect(wrapper.vm.dragHeight).toBe(null)
  })

  // Non-régression du correctif ci-dessus : le MÊME geste, posé ailleurs dans le corps du
  // tiroir (ici sur le libellé du champ, pas sur le champ lui-même), continue de refermer le
  // tiroir exactement comme avant (Tâche 15) — le garde-fou ne doit filtrer QUE les champs de
  // saisie, jamais le reste du corps.
  it('tiroir bas : le même glissement, posé ailleurs dans le corps de l\'onglet Infos (pas sur le champ), referme toujours le tiroir', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 65, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    const body = wrapper.find('[data-test="badge-drawer-body"]')

    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
    await wrapper.find('[data-test="badge-tab-infos"]').trigger('click')
    body.element.scrollTop = 0
    const label = wrapper.findAll('.bdg__subhead').at(-1)

    label.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 24, clientY: 400, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 24, clientY: 410, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 24, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 24, clientY: 800, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')
  })

  // Tâche 10 (chantier « badge corrections typo/zoom », 19/09) : « le tiroir saute au lieu de
  // suivre le doigt ». Diagnostiqué en direct sur Pixel 7 (CDP) : `dragHeight` et `drawerHeight`
  // restent synchronisés à moins de 15ms/1px l'un de l'autre à chaque `pointermove` (l'hypothèse
  // d'un `ResizeObserver` qui grouperait ses notifications en paliers ne se confirme PAS) — le
  // vrai coupable est `.bdg__preview-frame`, seul des trois calques concernés à avoir gardé sa
  // transition CSS `width/height 220ms ease` active PENDANT le geste (`.bdg__drawer` et
  // `.bdg__preview-layer`, cf. `previewLayerStyle`, la désactivaient déjà) : chaque
  // `pointermove` relance un lissage de 220ms vers une cible déjà dépassée, mesuré en direct
  // à l'origine d'un retard visuel (~50ms au tout début du geste avant que le lissage ne
  // rattrape en accéléré) qui se perçoit comme un saut plutôt qu'un suivi du doigt. Ce test
  // aurait échoué avant le correctif (`previewFrameStyle` ne posait alors jamais `transition`).
  it('prévisu : le cadre du badge suspend sa transition CSS pendant le glisser-tiroir (ne traîne plus derrière le doigt)', async () => {
    const { roInstances, restore } = mockResizeObserver()
    try {
      stubCanvas()
      const { wrapper } = mountComposer({ id: 62, name: 'X', photos: [] })
      await flushPromises()
      await stubPreviewFrameBox(wrapper, roInstances, 400, 800)
      const layer = wrapper.find('[data-test="badge-preview-layer"]')

      // Avant tout geste : la transition CSS de recadrage (bascule au tap, fin de glisser)
      // doit rester active, jamais coupée par défaut.
      expect(wrapper.vm.previewFrameStyle.transition).not.toBe('none')

      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 12, clientY: 800, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 12, clientY: 700, bubbles: true }))
      // PENDANT le geste (`dragHeight` posé) : le cadre doit suivre `dragHeight` sans lissage,
      // exactement comme `.bdg__drawer` et `.bdg__preview-layer` le font déjà.
      expect(wrapper.vm.dragHeight).not.toBe(null)
      expect(wrapper.vm.previewFrameStyle.transition).toBe('none')

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, clientY: 700, bubbles: true }))
      await flushPromises()
      // Une fois le doigt relâché (`dragHeight` remis à `null`) : la transition redevient
      // active pour le recadrage animé du relâché (`settleDrawerResize`).
      expect(wrapper.vm.dragHeight).toBe(null)
      expect(wrapper.vm.previewFrameStyle.transition).not.toBe('none')
    } finally {
      restore()
    }
  })

  // Un second doigt posé sur la prévisu doit annuler PROPREMENT l'effet du premier sur le
  // tiroir (sinon les écouteurs globaux de `onDrawerHandlePointerMove`/`Up`, qui ne filtrent
  // pas par `pointerId`, continueraient de lire la position du premier doigt pendant que le
  // second pince) et démarrer un pincer-zoomer dont l'échelle progresse avec l'écartement.
  it('prévisu : un second doigt annule le glisser-tiroir en cours et démarre un pincer-zoomer', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 61, name: 'X', photos: [] })
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const layer = wrapper.find('[data-test="badge-preview-layer"]')
    layer.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800 })

    // Premier doigt : démarre comme un glissement de tiroir classique (`dragHeight` posé).
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 20, clientX: 100, clientY: 800, bubbles: true }))
    expect(wrapper.vm.dragHeight).not.toBe(null)

    // Second doigt : bascule en pincer, doit annuler `dragHeight` immédiatement.
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, clientX: 300, clientY: 800, bubbles: true }))
    expect(wrapper.vm.dragHeight).toBe(null)

    // Mouvement du PREMIER doigt vers le haut, APRÈS l'arrivée du second : ne doit plus faire
    // varier `dragHeight` ni ouvrir le tiroir, et doit faire progresser `zoomScale` au-dessus
    // de 1 (la distance entre les deux doigts augmente : 200px -> ~447px).
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 20, clientX: 100, clientY: 400, bubbles: true }))
    expect(wrapper.vm.dragHeight).toBe(null)
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')
    expect(wrapper.vm.zoomScale).toBeGreaterThan(1)

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 20, clientX: 100, clientY: 400, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, clientX: 300, clientY: 800, bubbles: true }))
  })

  // Revue FINALE de branche (19/09) : les trois écouteurs globaux posés par
  // `onPreviewPointerDown` ne sont retirés par `onPreviewPointerUpOrCancel` que lorsque le
  // DERNIER doigt se relève. Un démontage PENDANT le geste (Échap, Fermer touché d'un second
  // doigt) les laissait donc sur `window`, refermés sur les refs d'un composant mort — le
  // filet de sécurité d'`onBeforeUnmount` ne couvrait que la poignée du tiroir, pas ce geste
  // ajouté en Task 5. Invisible à une revue de tâche isolée (le filet existait déjà, juste
  // pour l'autre geste).
  it('prévisu : un démontage PENDANT un geste retire aussi les écouteurs globaux du geste de prévisu', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 67, name: 'X', photos: [] })
    await flushPromises()
    const layer = wrapper.find('[data-test="badge-preview-layer"]')

    // Doigt posé et JAMAIS relevé : les trois écouteurs restent en place au démontage.
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 70, clientX: 100, clientY: 800, bubbles: true }))

    const retire = vi.spyOn(window, 'removeEventListener')
    wrappers.pop().unmount()
    const retires = retire.mock.calls.map((c) => c[0])
    expect(retires.filter((e) => e === 'pointermove').length).toBeGreaterThanOrEqual(2)
    expect(retires.filter((e) => e === 'pointerup').length).toBeGreaterThanOrEqual(2)
    expect(retires.filter((e) => e === 'pointercancel').length).toBeGreaterThanOrEqual(2)

    // Simple garde-fou : rejouer la fin du geste après le démontage ne doit rien faire
    // exploser. Ce n'est PAS la preuve du retrait (un écouteur resté en place ne lèverait pas
    // d'exception non plus) — cette preuve, ce sont les trois comptes ci-dessus, vérifiés en
    // rouge avant le correctif.
    expect(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 70, clientX: 300, clientY: 400, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 70, clientX: 300, clientY: 400, bubbles: true }))
    }).not.toThrow()
    retire.mockRestore()
  })

  // Défaut trouvé en revue (19/09) : `startPinch` lisait `previewLayer.value.getBoundingClientRect()`
  // (le calque plein écran) au lieu de `previewCanvas.value.getBoundingClientRect()` (le
  // cadre RÉEL, letterboxé dès que le ratio du badge diffère de celui de l'écran, cf.
  // `previewFrameStyle`) — ce test simule justement ce cas courant : un calque plus grand que
  // le cadre, décalé, pour prouver que `zoomOriginX`/`Y` se calcule contre le CADRE, pas le
  // calque. Même patron déjà utilisé par `onPreviewClick` (déjà dans ce fichier).
  it('prévisu : le pincer s’ancre sur le CADRE letterboxé, pas sur le calque plein écran', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 66, name: 'X', photos: [] })
    await flushPromises()
    const layer = wrapper.find('[data-test="badge-preview-layer"]')
    const canvas = wrapper.find('.bdg__preview')
    // Calque 800x800 depuis (0,0) ; cadre/canevas letterboxé 400x200 DEDANS, décalé à (200,300)
    // — un badge plus large que haut affiché dans un écran plus haut que large, par exemple.
    layer.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 800 })
    canvas.element.getBoundingClientRect = () => ({ left: 200, top: 300, width: 400, height: 200 })

    // Point médian des deux doigts : (200, 350) — bord GAUCHE du cadre, 25% de sa hauteur.
    // Sur le référentiel du CALQUE (800x800 depuis 0,0), ce même point médian donnerait
    // 25%/43.75 %, des valeurs différentes qui trahiraient l'ancrage sur le mauvais référentiel.
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 50, clientX: 150, clientY: 320, bubbles: true }))
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 51, clientX: 250, clientY: 380, bubbles: true }))

    expect(wrapper.vm.zoomOriginX).toBeCloseTo(0, 5)
    expect(wrapper.vm.zoomOriginY).toBeCloseTo(25, 5)

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 50, clientX: 150, clientY: 320, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 51, clientX: 250, clientY: 380, bubbles: true }))
  })

  // Tâche 11 (chantier « badge corrections typo/zoom », retour Julien) : un simple tap sur la
  // prévisu quand le tiroir est DÉPLIÉ le poussait à sa hauteur maximale au lieu de le
  // refermer, et pouvait en plus déclencher « Modifier » sur la photo (double effet). Le tap
  // (pointerdown puis pointerup au MÊME endroit, sans `pointermove` intermédiaire dépassant le
  // seuil de 6px, cf. `dragMoved`) doit désormais refermer le tiroir et avaler le clic natif
  // qui suit.
  it('prévisu : tiroir DÉPLIÉ, un tap sans glisser le referme et avale le clic natif (« Modifier » ne s’ouvre pas)', async () => {
    stubCanvas()
    const project = { id: 95, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper } = mountComposer(project)
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    const layer = wrapper.find('[data-test="badge-preview-layer"]')
    const canvas = wrapper.find('.bdg__preview')
    canvas.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1080, height: canvas.element.height })

    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')

    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 95, clientX: 540, clientY: 540, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 95, clientX: 540, clientY: 540, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

    // Le navigateur synthétise le `click` natif juste après ce relâché (jamais après un
    // pointeur qui a réellement bougé) : simulé ici explicitement, comme un vrai tap le ferait.
    await canvas.trigger('click', { clientX: 540, clientY: 540 })
    expect(wrapper.find('[data-test="badge-preview-fix"]').exists()).toBe(false)
  })

  // Le drapeau qui avale le clic natif (`suppressNextPreviewClick`) est posé sur le CALQUE
  // (`badge-preview-layer`, plus grand que le `<canvas>` dès que le badge est letterboxé, cf.
  // commentaire de `previewFrameStyle`) mais consommé par le `@click` du `<canvas>` seul : un
  // tap qui referme le tiroir dans la MARGE letterboxée (en dehors du canevas) ne produit donc
  // aucun clic pour le consommer. Sans remise à zéro au pointerdown suivant, ce drapeau
  // survivrait et avalerait à tort le PROCHAIN tap, légitime celui-là, sur la photo.
  it('prévisu : un tap qui referme le tiroir sans toucher le canevas n’avale pas le tap suivant, légitime, sur la photo', async () => {
    stubCanvas()
    const project = { id: 99, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper } = mountComposer(project)
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    const layer = wrapper.find('[data-test="badge-preview-layer"]')
    const canvas = wrapper.find('.bdg__preview')
    canvas.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1080, height: canvas.element.height })

    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')

    // Premier tap dans la marge letterboxée du calque, hors du canevas : referme le tiroir
    // sans produire de `click` natif (à la différence du test précédent, qui tape SUR le
    // canevas).
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 200, clientX: 10, clientY: 10, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 200, clientX: 10, clientY: 10, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

    // Second tap, cette fois sur la photo, tiroir déjà replié : geste complet et légitime.
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 201, clientX: 540, clientY: 540, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 201, clientX: 540, clientY: 540, bubbles: true }))
    await flushPromises()
    await canvas.trigger('click', { clientX: 540, clientY: 540 })
    expect(wrapper.find('[data-test="badge-preview-fix"]').exists()).toBe(true)
  })

  // Non-régression : tiroir déjà REPLIÉ, le tap ne doit rien changer au tiroir (il l'était
  // déjà) et « Modifier » continue de s'ouvrir normalement — reprend le scénario du test
  // « un clic sur une photo affiche Modifier » ci-dessus, avec le geste pointerdown/pointerup
  // complet en plus du `click` de test-utils.
  it('prévisu : tiroir REPLIÉ, un tap ne bascule rien et « Modifier » s’ouvre normalement (non-régression)', async () => {
    stubCanvas()
    const project = { id: 96, name: 'X', photos: ['data:image/jpeg;base64,COVER'] }
    const { wrapper } = mountComposer(project)
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const layer = wrapper.find('[data-test="badge-preview-layer"]')
    const canvas = wrapper.find('.bdg__preview')
    canvas.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1080, height: canvas.element.height })
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 96, clientX: 540, clientY: 540, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 96, clientX: 540, clientY: 540, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

    await canvas.trigger('click', { clientX: 540, clientY: 540 })
    expect(wrapper.find('[data-test="badge-preview-fix"]').exists()).toBe(true)
  })

  // Non-régression Task 5/10 : un VRAI glisser (mouvement franc, `dragMoved` devient vrai) sur
  // la prévisu continue de piloter le tiroir comme avant — le nouveau code de fermeture-au-tap
  // ne doit pas interférer. Preuve différenciante : le doigt reste tout du long au-dessus du
  // point médian replié/déplié, donc le CHEMIN GLISSER (`onDrawerHandlePointerUp`) laisse le
  // tiroir DÉPLIÉ ; si le nouveau code de tap s'en mêlait à tort (il ignore la position et
  // referme dès que `drawerExpanded` est vrai), ce test le trahirait en le voyant se refermer.
  it('prévisu : tiroir DÉPLIÉ, un VRAI glisser (mouvement > 6px) garde le comportement de glisser (le nouveau code de tap n’interfère pas)', async () => {
    stubCanvas()
    const project = { id: 97, name: 'X', photos: [] }
    const { wrapper } = mountComposer(project)
    await flushPromises()
    const drawer = wrapper.find('[data-test="badge-drawer"]')
    const handle = wrapper.find('[data-test="badge-drawer-handle"]')
    const layer = wrapper.find('[data-test="badge-preview-layer"]')

    await handle.trigger('click')
    expect(drawer.classes()).toContain('bdg__drawer--expanded')

    // Glisse encore plus haut : reste largement au-dessus du point médian, le tiroir doit
    // rester DÉPLIÉ au relâché (chemin glisser existant), pas fermé par le nouveau code de tap.
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 97, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 97, clientY: 400, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 97, clientY: 400, bubbles: true }))
    await flushPromises()
    expect(drawer.classes()).toContain('bdg__drawer--expanded')
  })

  // Hors périmètre de cette tâche (brief explicite) : un tap pendant un zoom actif ne doit rien
  // changer au tiroir. `zoomScale > 1` fait router `onPreviewPointerDown` vers `startPan` dès le
  // premier doigt (cf. plus haut) : ce scénario est donc atteint via un VRAI pincement (comme
  // les autres tests zoom/pan de ce fichier), pas via une affectation directe du ref.
  it('prévisu : tiroir DÉPLIÉ, un zoom actif (zoomScale > 1) empêche le tap de refermer le tiroir', async () => {
    const { roInstances, restore } = mockResizeObserver()
    try {
      stubCanvas()
      const project = { id: 98, name: 'X', photos: [] }
      const { wrapper } = mountComposer(project)
      await flushPromises()
      await stubPreviewFrameBox(wrapper, roInstances, 400, 800)
      const drawer = wrapper.find('[data-test="badge-drawer"]')
      const handle = wrapper.find('[data-test="badge-drawer-handle"]')
      const layer = wrapper.find('[data-test="badge-preview-layer"]')

      await handle.trigger('click')
      expect(drawer.classes()).toContain('bdg__drawer--expanded')

      // Pincement à deux doigts qui porte le zoom nettement au-dessus de 1 (distance 200 -> 600px).
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 98, clientX: 100, clientY: 800, bubbles: true }))
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, clientX: 300, clientY: 800, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 99, clientX: 700, clientY: 800, bubbles: true }))
      expect(wrapper.vm.zoomScale).toBeGreaterThan(1)

      // Relâche les deux doigts sans autre mouvement (un « tap » une fois zoomé) : le tiroir
      // ne doit PAS se refermer, hors périmètre de cette tâche.
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, clientX: 700, clientY: 800, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 98, clientX: 100, clientY: 800, bubbles: true }))
      await flushPromises()
      expect(drawer.classes()).toContain('bdg__drawer--expanded')
    } finally {
      restore()
    }
  })

  it('prévisu : relâcher les doigts avec un zoom proche de 1 remet le zoom exactement à 1', async () => {
    stubCanvas()
    const { wrapper } = mountComposer({ id: 62, name: 'X', photos: [] })
    await flushPromises()
    const layer = wrapper.find('[data-test="badge-preview-layer"]')
    layer.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800 })

    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 30, clientX: 100, clientY: 800, bubbles: true }))
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 31, clientX: 300, clientY: 800, bubbles: true }))
    // Distance 200px -> 206px : ratio 1.03, sous le seuil de rattrapage à 1 (1.05).
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 31, clientX: 306, clientY: 800, bubbles: true }))
    expect(wrapper.vm.zoomScale).toBeGreaterThan(1)
    expect(wrapper.vm.zoomScale).toBeLessThan(1.05)

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 30, clientX: 100, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, clientX: 306, clientY: 800, bubbles: true }))
    expect(wrapper.vm.zoomScale).toBe(1)
  })

  it('prévisu : changer de gabarit pendant un zoom actif remet le zoom à 1', async () => {
    stubCanvas()
    const project = { id: 65, name: 'X', photos: [], technique: 'crochet' } // pas de couverture -> minimal par défaut
    const { wrapper } = mountComposer(project)
    await flushPromises()
    const layer = wrapper.find('[data-test="badge-preview-layer"]')
    layer.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800 })

    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 40, clientX: 100, clientY: 800, bubbles: true }))
    layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 41, clientX: 300, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 41, clientX: 500, clientY: 800, bubbles: true }))
    expect(wrapper.vm.zoomScale).toBeGreaterThan(1)

    await wrapper.findAll('.bdg__tpl')[3].trigger('click') // TEMPLATE_KEYS[3] === 'double'
    expect(wrapper.vm.zoomScale).toBe(1)

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 40, clientX: 100, clientY: 800, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 41, clientX: 500, clientY: 800, bubbles: true }))
  })

  // Task 7 (chantier « badge corrections typo/zoom », demande de Julien après vérification
  // visuelle de la Task 6 sur Pixel 7) : une fois l'image zoomée, un glisser à un seul doigt
  // doit la déplacer (pan) au lieu de piloter le tiroir. Le scénario réel est un pincement à
  // deux doigts dont on relâche l'un des deux : aucun nouveau `pointerdown` n'est émis pour le
  // doigt restant, donc `onPreviewPointerUpOrCancel` doit lui-même démarrer le panoramique
  // pour ce doigt quand la transition à deux doigts vers un seul le laisse encore zoomé.
  it('prévisu : zoomée, le glisser du doigt restant après un pincement à deux doigts déplace l’image au lieu du tiroir', async () => {
    const { roInstances, restore } = mockResizeObserver()
    try {
      stubCanvas()
      const { wrapper } = mountComposer({ id: 90, name: 'X', photos: [] })
      await flushPromises()
      await stubPreviewFrameBox(wrapper, roInstances, 400, 800)
      const layer = wrapper.find('[data-test="badge-preview-layer"]')
      const drawer = wrapper.find('[data-test="badge-drawer"]')

      // Pincement à deux doigts qui porte le zoom nettement au-dessus de 1 (distance 200 -> 600px).
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 90, clientX: 100, clientY: 800, bubbles: true }))
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 91, clientX: 300, clientY: 800, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 91, clientX: 700, clientY: 800, bubbles: true }))
      expect(wrapper.vm.zoomScale).toBeGreaterThan(1)

      // Relâche un des deux doigts : il n'en reste qu'un, encore posé sur la prévisu.
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 91, clientX: 700, clientY: 800, bubbles: true }))
      expect(wrapper.vm.dragHeight).toBe(null)

      // Glisser ce doigt restant : doit déplacer l'image, jamais rouvrir/fermer le tiroir.
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 90, clientX: 160, clientY: 700, bubbles: true }))
      expect(wrapper.vm.panX).not.toBe(0)
      expect(wrapper.vm.panY).not.toBe(0)
      expect(wrapper.vm.dragHeight).toBe(null)
      expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 90, clientX: 160, clientY: 700, bubbles: true }))
    } finally {
      restore()
    }
  })

  // Non-régression Task 5 déjà couverte par le test « un glissement franc vers le haut sur la
  // prévisu ouvre le tiroir » plus haut (zoomScale reste à sa valeur par défaut, 1, dans ce
  // test) : un glisser à un seul doigt continue de piloter le tiroir tant que l'image n'est
  // pas zoomée, inchangé par cette tâche.

  it('prévisu : un panoramique qui dépasse largement les bornes calculées reste clampé dedans', async () => {
    const { roInstances, restore } = mockResizeObserver()
    try {
      stubCanvas()
      const { wrapper } = mountComposer({ id: 91, name: 'X', photos: [] })
      await flushPromises()
      await stubPreviewFrameBox(wrapper, roInstances, 400, 800)
      const layer = wrapper.find('[data-test="badge-preview-layer"]')

      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 100, clientX: 100, clientY: 800, bubbles: true }))
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 101, clientX: 300, clientY: 800, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 101, clientX: 700, clientY: 800, bubbles: true }))
      expect(wrapper.vm.zoomScale).toBeGreaterThan(1)
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 101, clientX: 700, clientY: 800, bubbles: true }))

      // Glisser de 10000px : très largement au-delà de tout débattement calculable par `panBounds()`.
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 100, clientX: 10100, clientY: 10800, bubbles: true }))

      const w = parseFloat(wrapper.vm.previewFrameStyle.width) || 0
      const h = parseFloat(wrapper.vm.previewFrameStyle.height) || 0
      const overflow = Math.max(0, wrapper.vm.zoomScale - 1)
      const boundsX = (w * overflow) / 2
      const boundsY = (h * overflow) / 2
      expect(wrapper.vm.panX).toBeGreaterThanOrEqual(-boundsX)
      expect(wrapper.vm.panX).toBeLessThanOrEqual(boundsX)
      expect(wrapper.vm.panY).toBeGreaterThanOrEqual(-boundsY)
      expect(wrapper.vm.panY).toBeLessThanOrEqual(boundsY)

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 100, clientX: 10100, clientY: 10800, bubbles: true }))
    } finally {
      restore()
    }
  })

  it('prévisu : terminer le pincement sous le seuil de rattrapage (1.05) remet aussi le panoramique à zéro', async () => {
    const { roInstances, restore } = mockResizeObserver()
    try {
      stubCanvas()
      const { wrapper } = mountComposer({ id: 92, name: 'X', photos: [] })
      await flushPromises()
      await stubPreviewFrameBox(wrapper, roInstances, 400, 800)
      const layer = wrapper.find('[data-test="badge-preview-layer"]')

      // Premier pincement : zoom fortement au-dessus de 1, puis panoramique du doigt restant.
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 110, clientX: 100, clientY: 800, bubbles: true }))
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 111, clientX: 300, clientY: 800, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 111, clientX: 700, clientY: 800, bubbles: true }))
      expect(wrapper.vm.zoomScale).toBeGreaterThan(1.05)
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 111, clientX: 700, clientY: 800, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 110, clientX: 160, clientY: 700, bubbles: true }))
      expect(wrapper.vm.panX).not.toBe(0)

      // Un second doigt reposé ramène l'échelle tout près de 1 (sous le seuil de rattrapage).
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 112, clientX: 260, clientY: 700, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 112, clientX: 162, clientY: 700, bubbles: true }))
      expect(wrapper.vm.zoomScale).toBeLessThan(1.05)

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 110, clientX: 160, clientY: 700, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 112, clientX: 162, clientY: 700, bubbles: true }))

      expect(wrapper.vm.zoomScale).toBe(1)
      expect(wrapper.vm.panX).toBe(0)
      expect(wrapper.vm.panY).toBe(0)
    } finally {
      restore()
    }
  })

  // Revue (19/09) : la première version de ce test ne vérifiait que la structure de
  // `onPreviewPointerMove` (`if (size >= 2) updatePinch() else if (panActive) updatePan()`),
  // qui rend de toute façon la branche pan inatteignable dès qu'un second doigt est posé —
  // vrai même sans `cancelPan()`. Le rôle réel de `cancelPan()` est ailleurs : sans lui,
  // `panActive` reste vrai pendant tout le pincement intercalé, et le garde `!panActive` dans
  // `onPreviewPointerUpOrCancel` empêche `startPan` de RAFRAÎCHIR `panStartClientX`/`panStartY`
  // avec la position et le panX/panY COURANTS à la sortie du pincement. Le doigt restant,
  // glissé ensuite, calcule alors son déplacement depuis un ancrage périmé d'AVANT le
  // pincement — un saut, pas un déplacement cohérent. Ce test couvre cet invariant : pan actif
  // → second doigt (pincement, qui resserre les bornes et RECLAMPE panX via
  // `watch(zoomScale)`, sans toucher `panStartX`) → relâchement du second doigt → glisser du
  // premier doigt restant, dont le déplacement doit suivre sa position ACTUELLE, pas
  // l'accumulation périmée d'avant le pincement (qui saturerait aussitôt les bornes
  // resserrées). Vérifié discriminant : ce test échoue si `cancelPan()` est retiré de
  // `onPreviewPointerDown` (panX se fige à la borne 100 au lieu de suivre le petit glisser
  // final).
  it('prévisu : après un pincement intercalé, le glisser du doigt restant reprend depuis la position courante (pas de saut d’ancrage périmé)', async () => {
    const { roInstances, restore } = mockResizeObserver()
    try {
      stubCanvas()
      const { wrapper } = mountComposer({ id: 93, name: 'X', photos: [] })
      await flushPromises()
      await stubPreviewFrameBox(wrapper, roInstances, 400, 800)
      const layer = wrapper.find('[data-test="badge-preview-layer"]')
      const drawer = wrapper.find('[data-test="badge-drawer"]')

      // Premier pincement : porte le zoom à 3 (distance 200 -> 600px).
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 120, clientX: 100, clientY: 800, bubbles: true }))
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 121, clientX: 300, clientY: 800, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 121, clientX: 700, clientY: 800, bubbles: true }))
      expect(wrapper.vm.zoomScale).toBeCloseTo(3)

      // Relâche le second doigt : il n'en reste qu'un, panoramique démarré pour lui.
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 121, clientX: 700, clientY: 800, bubbles: true }))

      // Panoramique actif : glisser ce doigt jusqu'à (250, 850).
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 120, clientX: 250, clientY: 850, bubbles: true }))
      expect(wrapper.vm.panX).toBeCloseTo(150)
      expect(wrapper.vm.panY).toBeCloseTo(50)

      // Un second doigt se pose PENDANT ce panoramique : déclenche un pincement qui réduit le
      // zoom à 1.5, ce qui resserre `panBounds()` et reclampe panX de 150 à 100.
      layer.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 122, clientX: 400, clientY: 850, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 122, clientX: 325, clientY: 850, bubbles: true }))
      await flushPromises() // laisse tourner le `watch(zoomScale)` qui reclampe panX/panY
      expect(wrapper.vm.zoomScale).toBeCloseTo(1.5)
      expect(wrapper.vm.panX).toBeCloseTo(100) // reclampé, bornes resserrées par le zoom réduit

      // Relâche le second doigt : retour à un seul doigt posé (120), toujours zoomé.
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 122, clientX: 325, clientY: 850, bubbles: true }))
      const panXAfterPinch = wrapper.vm.panX
      const panYAfterPinch = wrapper.vm.panY
      expect(panXAfterPinch).toBeCloseTo(100)

      // Glisser ce doigt restant depuis sa position ACTUELLE (250, 850) d'un petit delta
      // (-10, -10) : le déplacement de panX/panY doit suivre CE delta, pas rejouer le
      // déplacement accumulé depuis la toute première pose du doigt (150, 50, avant le
      // pincement), qui saturerait aussitôt les bornes resserrées (-100/100).
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 120, clientX: 240, clientY: 840, bubbles: true }))
      expect(wrapper.vm.panX).toBeCloseTo(panXAfterPinch - 10)
      expect(wrapper.vm.panY).toBeCloseTo(panYAfterPinch - 10)
      expect(wrapper.vm.dragHeight).toBe(null)
      expect(drawer.classes()).not.toContain('bdg__drawer--expanded')

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 120, clientX: 240, clientY: 840, bubbles: true }))
    } finally {
      restore()
    }
  })

  it('cadre : `.bdg__preview-frame` s’anime (transition CSS) au lieu de sauter d’un coup à sa nouvelle taille', () => {
    const css = styleCss()
    const frameBlock = css.match(/\.bdg__preview-frame\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(frameBlock).toMatch(/transition:[^;]*width[^;]*220ms/)
    expect(frameBlock).toMatch(/transition:[^;]*height[^;]*220ms/)
  })

  // Revue post-implémentation (18/09) : `.bdg__drawer` reste bord à bord (`left: 0; right: 0`,
  // comme `.bdg` lui-même) mais son CONTENU (`.bdg__drawer-body`) doit tenir compte de la zone
  // sûre latérale, sous peine de déborder sous l'encoche en mode paysage. Et `.bdg__drawer`
  // lui-même ne doit PAS porter de padding bas lié à `--sa-bottom` en plus de celui déjà posé
  // sur `.bdg__drawer-body` — sinon la zone sûre basse est comptée deux fois et grignote le
  // plancher en px annoncé par le commentaire du composant (poignée + futur segmented control
  // toujours visibles).
  it('tiroir bas : zone sûre latérale sur le corps, pas de double comptage de la zone sûre basse', () => {
    const css = styleCss()
    const drawerBlock = css.match(/\.bdg__drawer\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(drawerBlock).toMatch(/left:\s*0/)
    expect(drawerBlock).toMatch(/right:\s*0/)
    expect(drawerBlock).not.toMatch(/padding-bottom/)

    const bodyBlock = css.match(/\.bdg__drawer-body\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(bodyBlock).toMatch(/max\(var\(--sp-4\),\s*var\(--sa-right\)\)/)
    expect(bodyBlock).toMatch(/max\(var\(--sp-4\),\s*var\(--sa-left\)\)/)
    expect(bodyBlock).toMatch(/max\(var\(--sp-4\),\s*var\(--sa-bottom\)\)/)
  })

  // Doublet vh/dvh (revue post-implémentation, 18/09) : non vérifiable en jsdom (aucun vrai
  // calcul de `dvh`), seulement par lecture du CSS source — même motif documenté que `.menu`
  // (AppHeader.vue) et `html, body, #app` (tokens.css). L'ORDRE des deux déclarations compte :
  // `vh` doit précéder `dvh` pour que la seconde (mieux supportée, ignorée seulement par une
  // WebView ancienne) l'emporte par cascade sur tout appareil qui comprend les deux.
  it('tiroir bas : doublet vh/dvh sur les deux plafonds de hauteur (repli WebView sans dvh)', () => {
    const css = styleCss()
    const drawerBlock = css.match(/\.bdg__drawer\s*\{([^}]*)\}/s)?.[1] ?? ''
    // `(?<!max-)height:` — pas `max-height:`, qui contient aussi la sous-chaîne « height: » et
    // ferait passer ce test même si `.bdg__drawer` perdait son `height: auto` de base (dont le
    // test « hauteur adaptative » juste après vérifie séparément la présence).
    expect(drawerBlock).toMatch(/(?<!max-)height:\s*auto/)
    expect(drawerBlock).toMatch(/max-height:\s*max\(160px,\s*22vh\)[\s\S]*max-height:\s*max\(160px,\s*22dvh\)/)

    const expandedBlock = css.match(/\.bdg__drawer--expanded\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(expandedBlock).toMatch(/max-height:\s*max\(420px,\s*68vh\)[\s\S]*max-height:\s*max\(420px,\s*68dvh\)/)
  })

  // Retour Julien (18/09, après le relevé de la hauteur dépliée) : « c'est bien pour un
  // maximum, si le contenu tient sur une hauteur plus petite, il faut s'adapter » — le tiroir
  // ne doit plus imposer une hauteur FIXE en mode déplié, seulement un plafond.
  it('tiroir bas : la hauteur s’adapte au contenu (max-height, pas height fixe)', () => {
    const css = styleCss()
    const drawerBlock = css.match(/\.bdg__drawer\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(drawerBlock).toMatch(/(?<!max-)height:\s*auto/)
    const bodyBlock = css.match(/\.bdg__drawer-body\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(bodyBlock).toMatch(/flex:\s*1\s+1\s+auto/)
  })

  // Retour Julien (18/09, après le correctif du blocage à la frappe) : impossible de changer
  // d'onglet sans remonter tout en haut du tiroir déplié, le segmented control défilant avec
  // le reste du contenu de `.bdg__drawer-body`.
  it('tiroir bas : le segmented control reste collé en haut pendant qu’on fait défiler son contenu', () => {
    const css = styleCss()
    const segmentedBlock = css.match(/\.bdg__segmented\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(segmentedBlock).toMatch(/position:\s*sticky/)
    expect(segmentedBlock).toMatch(/top:\s*0/)
  })

  // Charge supplémentaire Task 6 (ruling du contrôleur, revue de Task 3, bug Pixel réel du
  // 17/09 : les boutons flottants Fermer/Partager, `position: absolute` dans `.bdg`, pouvaient
  // défiler hors de vue tant que `.bdg` restait `overflow-y: auto` ET que `.bdg__tabs`/les
  // `<section>` — seul contenu normal-flow de `.bdg` capable de dépasser la hauteur du
  // viewport — y restaient). Cette tâche les fait migrer dans `.bdg__drawer-body` (qui a son
  // PROPRE `overflow-y: auto`) : `.bdg` lui-même n'a donc plus rien à faire défiler, `hidden`
  // remplace `auto` pour ne plus laisser cette possibilité rouverte par erreur.
  it('.bdg : overflow-y hidden désormais (plus rien à faire défiler depuis la migration du tiroir)', () => {
    const css = styleCss()
    const bdgBlock = css.match(/\.bdg\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(bdgBlock).toMatch(/overflow-y:\s*hidden/)
    expect(bdgBlock).not.toMatch(/overflow-y:\s*auto/)
  })

  // Corollaire : les enfants directs de `.bdg` migrés ou déjà en place à l'issue de cette
  // tâche doivent être `position: absolute` (aucun n'a besoin de faire défiler `.bdg`
  // lui-même désormais qu'il est `overflow-y: hidden`). Vérification par énumération
  // explicite des classes concernées plutôt que par parsing du template : une regex sur du
  // HTML imbriqué (plusieurs `<div>` à des profondeurs différentes) ne peut pas distinguer
  // fiablement un enfant DIRECT de `.bdg` d'un descendant plus profond sans un vrai parseur
  // HTML — absent de l'outillage de ce fichier (`styleCss()`/`src()` ne sont que des regex sur
  // la source brute). Écrire ce parsing à la main serait plus fragile que le bug qu'il
  // prétend prévenir, cf. brief de tâche. `.bdg__saved-banner` (Task 7, remplace l'ancien
  // `.bdg__result-block` qui restait volontairement hors de cette liste avant cette tâche) y
  // figure désormais : plus aucun enfant direct de `.bdg` en flux normal. `<BadgePhotoPicker>`
  // (composant enfant) est hors de portée : sa racine `.bpp` porte son propre `position: fixed`
  // dans SON fichier, pas dans le CSS scoped de BadgeComposer.vue vérifié ici.
  it('.bdg : les enfants directs migrés/déjà positionnés sont bien position: absolute', () => {
    const css = styleCss()
    for (const cls of [
      'bdg__preview-layer',
      'bdg__close-btn',
      'bdg__share-btn',
      'bdg__saved-banner',
      'bdg__drawer',
    ]) {
      const block = css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? ''
      expect(block).toMatch(/position:\s*absolute/)
    }
  })
})

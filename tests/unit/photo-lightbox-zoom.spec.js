// Unitaire — le zoom de la visionneuse photo (lot du 09/08/2026).
//
// La visionneuse savait déjà s'ouvrir, se fermer et naviguer ; seul le pincement manquait.
// Il vient du composable partagé (usePinchZoom), déjà éprouvé sur appareil dans les
// diagrammes — ce fichier ne re-teste donc PAS la mécanique du geste (voir
// tests/unit/use-pinch-zoom.spec.js) mais ce qui est PROPRE à la visionneuse : le
// conflit entre le balayage « photo suivante » et le déplacement dans l'image agrandie.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import PhotoLightbox from '@/components/PhotoLightbox.vue'
import { useLightboxStore } from '@/stores/lightbox'

const PHOTOS = ['a.png', 'b.png', 'c.png']

let lb
function mountIt() {
  return mount(PhotoLightbox, { global: { plugins: [createPinia(), i18n] }, attachTo: document.body })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 0 })
})

// Balayage horizontal : deux événements tactiles, comme le composant les attend déjà.
async function balayer(w, dx) {
  const img = w.find('[data-test="lb-img"]')
  await img.trigger('touchstart', { touches: [{ clientX: 200, clientY: 300 }] })
  await img.trigger('touchend', { changedTouches: [{ clientX: 200 + dx, clientY: 300 }] })
}

// `clientX`/`clientY` sont des getters SANS setter sur MouseEvent en jsdom : `.trigger()` de
// @vue/test-utils échoue à les poser (il construit un MouseEvent pour tout event contenant
// ces clés). Un `Event` générique n'a pas ce getter : `Object.assign` s'y pose normalement.
function firePointer(wrapper, type, props) {
  const ev = new Event(type, { bubbles: true })
  Object.assign(ev, props)
  wrapper.element.dispatchEvent(ev)
}

// Revue du 09/08 : `@pointermove="pz.onPointerMove"` et `@pointercancel="pz.onPointerUp"`
// pouvaient disparaitre du gabarit du viewport SANS qu'aucun test ne rougisse — les 12 tests
// existants posent deux doigts aux MEMES coordonnees (aucun mouvement, donc aucun pointermove
// necessaire) puis les relachent, et tous les etats zoomes sont atteints par
// `w.vm.pz.setZoom(...)`, qui court-circuite entierement le DOM. Le cablage qui fait tout le
// lot pour les photos (le pincement lui-meme) n'etait retenu par rien.
describe('visionneuse : le pincement passe vraiment par les evenements du DOM', () => {
  it('deux doigts qui s\'ecartent (pointerdown puis pointermove a des coordonnees differentes) augmentent le zoom', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerdown', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    expect(w.vm.pz.zoom.value).toBe(100) // rien n'a encore bouge
    // Les deux doigts s'ecartent : SEUL `pointermove` peut faire progresser le pincement, jamais
    // `pz.setZoom()` appele directement comme dans les tests ci-dessus.
    firePointer(vp, 'pointermove', { pointerId: 1, clientX: 100, clientY: 300 })
    firePointer(vp, 'pointermove', { pointerId: 2, clientX: 300, clientY: 300 })
    await w.vm.$nextTick()
    expect(w.vm.pz.zoom.value).toBeGreaterThan(100)
  })

  it('un pincement annule par pointercancel libere les deux pointeurs, comme pointerup', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerdown', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    expect(w.vm.pz.activePointers()).toBe(2)
    firePointer(vp, 'pointercancel', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointercancel', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    expect(w.vm.pz.activePointers()).toBe(0) // sans le cablage, les pointeurs restent actifs a vie
  })
})

describe('visionneuse : le balayage ne sert pas à deux choses à la fois', () => {
  it('à taille normale, le balayage change de photo', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    await balayer(w, -120) // vers la gauche = photo suivante
    expect(lb.index).toBe(1)
  })

  // ⚠️ LE TEST CENTRAL DE CETTE TÂCHE. Les deux états sont exercés dans le même fichier :
  // un seul des deux ne discriminerait rien.
  it('AGRANDIE, le même balayage ne change PAS de photo', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    w.vm.pz.setZoom(250) // agrandie
    await w.vm.$nextTick()
    await balayer(w, -120)
    expect(lb.index).toBe(0) // inchangé : le geste a servi à se déplacer
  })

  // Revue du 09/08 : le meme trou que celui trouve sur le fond, non traite au meme endroit.
  // `sx`/`sy` (onTouchStart) sont poses par le PREMIER doigt ; `dx` (onTouchEnd) est mesure
  // depuis le doigt qui se LEVE — potentiellement l'AUTRE doigt d'un pincement qui vient de
  // retomber a 100 % (`isZoomed` redevient donc `false`, seul, il ne protege plus rien). Sans
  // `justPinched`, l'ecart entre les deux doigts peut depasser le seuil de balayage et changer
  // de photo par surprise pendant une simple etude de detail.
  it('un pincement qui revient à 100 % ne fait pas changer de photo au balayage qui suit', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerdown', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    firePointer(vp, 'pointerup', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerup', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    expect(w.vm.pz.zoom.value).toBe(100) // le pincement n'a pas bouge : bien revenu/reste a 100%
    await balayer(w, -120) // le touchend qui peut suivre le relachement du pincement
    expect(lb.index).toBe(0) // inchange : pas de balayage fantome
  })
})

// Revue du 09/08 : `if (pz.activePointers() === 0) justPinched = false` (dans
// onViewportPointerDown) est la SEULE ligne qui rearme `justPinched`. La supprimer laissait les
// 12 tests d'alors tout verts, parce qu'aucun ne verifiait un geste APRES le pincement. Sans
// cette ligne, `justPinched` reste vrai a vie apres le premier pincement : le balayage "photo
// suivante" ET le tap sur le fond restent morts pour tout le reste de la session.
describe('visionneuse : le balayage se rearme apres un pincement', () => {
  it('un balayage a un seul doigt APRES un pincement change de nouveau de photo', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    // Le pincement : deux doigts poses puis relaches, zoom revenu/reste a 100 %.
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerdown', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    firePointer(vp, 'pointerup', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerup', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    // Nouveau geste a UN SEUL doigt (pointerdown puis pointerup) : c'est ce debut de geste qui
    // doit rearmer justPinched, pas le relachement du pincement precedent.
    firePointer(vp, 'pointerdown', { pointerId: 3, clientX: 200, clientY: 300 })
    firePointer(vp, 'pointerup', { pointerId: 3, clientX: 200, clientY: 300 })
    await w.vm.$nextTick()
    await balayer(w, -120) // le balayage du meme geste (touchstart/touchend, comme toujours)
    expect(lb.index).toBe(1) // le balayage fonctionne de nouveau
  })
})

describe('visionneuse : le zoom ne survit pas au changement de photo', () => {
  it('changer de photo remet le zoom à 100', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    w.vm.pz.setZoom(300)
    await w.vm.$nextTick()
    lb.next()
    await w.vm.$nextTick()
    expect(w.vm.pz.zoom.value).toBe(100)
  })

  it('rouvrir la visionneuse repart à 100', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    w.vm.pz.setZoom(400)
    await w.vm.$nextTick()
    lb.close()
    await w.vm.$nextTick()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    expect(w.vm.pz.zoom.value).toBe(100)
  })
})

// `isZoomed` seul ne suffit pas comme garde sur le fond : un pincement qui revient exactement
// a 100 % avant que le dernier doigt se leve laisse `isZoomed` a `false` au moment du tap
// fantome qui peut suivre le relachement (meme classe de defaut que la garde `wasMultiTouch`
// du composable partage). Ce cas ne peut PAS se distinguer d'un vrai tap sur le fond par la
// seule lecture du zoom courant : il faut retenir que la sequence qui vient de se terminer
// avait 2 doigts.
describe('visionneuse : un pincement qui revient a 100% ne ferme pas au relachement sur le fond', () => {
  it('deux doigts poses puis relaches sur le fond, de retour a 100% : la visionneuse reste ouverte', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerdown', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    firePointer(vp, 'pointerup', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerup', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    expect(w.vm.pz.zoom.value).toBe(100) // le pincement n'a pas bouge : bien revenu/reste a 100%
    await w.find('.lb').trigger('click') // le tap fantome qui peut suivre le relachement
    expect(lb.open).toBe(true)
  })
})

// Revue du 09/08 : la ligne `if (pz.isZoomed.value) return` d'`onBackdropClick` (le « second
// filet », pour le cas simple ou le geste se termine ENCORE zoome) n'avait aucun test dedie —
// elle a ete supprimee en revue sans qu'aucun test ne rougisse. Un deplacement a UN doigt
// (jamais 2 : `justPinched` ne s'arme donc pas) qui se termine alors que l'image est agrandie
// ne doit pas fermer la visionneuse.
describe('visionneuse : agrandie, le fond ne ferme pas non plus (le second filet, isZoomed)', () => {
  it('un seul doigt, image agrandie : le clic sur le fond qui suit ne ferme pas', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    await w.vm.$nextTick()
    w.vm.pz.setZoom(250) // agrandie PENDANT le geste (ex. pincement d'un seul doigt qui glisse)
    await w.vm.$nextTick()
    firePointer(vp, 'pointerup', { pointerId: 1, clientX: 150, clientY: 300 })
    await w.vm.$nextTick()
    expect(w.vm.pz.isZoomed.value).toBe(true) // encore agrandie au moment du clic
    await w.find('.lb').trigger('click')
    expect(lb.open).toBe(true)
  })
})

// Correctif du 09/08 (suite a revue) : une petite photo ne doit pas etre agrandie/floutee a
// zoom 100 %, mais doit pouvoir grandir avec le zoom. jsdom ne decode aucune image
// (naturalWidth/Height) ni ne calcule de vraie mise en page (clientWidth/Height) : on force
// ces valeurs sur les vrais noeuds DOM (mêmes limites que use-pinch-zoom.spec.js, qui fait de
// meme sur un faux viewport) pour exercer le VRAI composant avec des dimensions plausibles.
// Ce test prouve la mecanique de canvasStyle ; il ne prouve pas que le navigateur/WebView
// decode et mesure comme jsdom le simule ici (voir src/utils/photo-fit.js et le rapport de
// tache pour la limite exacte).
describe('visionneuse : une petite photo n\'est pas agrandie ni floutee au repos', () => {
  it('a zoom 100%, le canvas ne depasse pas la taille naturelle ; il grandit avec le zoom', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vpEl = w.find('.lb__viewport').element
    Object.defineProperty(vpEl, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(vpEl, 'clientHeight', { value: 800, configurable: true })
    const imgEl = w.find('[data-test="lb-img"]').element
    Object.defineProperty(imgEl, 'naturalWidth', { value: 100, configurable: true })
    Object.defineProperty(imgEl, 'naturalHeight', { value: 50, configurable: true })
    imgEl.dispatchEvent(new Event('load'))
    await w.vm.$nextTick()
    expect(w.vm.canvasStyle).toEqual({ width: '100px', height: '50px' }) // taille naturelle, pas le viewport (1000x800)

    w.vm.pz.setZoom(200)
    await w.vm.$nextTick()
    expect(w.vm.canvasStyle).toEqual({ width: '200px', height: '100px' }) // grandit avec le zoom
  })
})

// Revue du 09/08 : `canvasStyle` lisait `box.clientWidth/clientHeight` (des propriétés DOM, pas
// réactives) SANS aucun écouteur de redimensionnement — après une rotation d'écran, la taille
// "au repos" restait figée sur les dimensions D'AVANT rotation. Conséquence concrète : la photo
// garde une taille trop haute pour le NOUVEAU viewport, ce qui rend `.lb__viewport` défilant
// alors qu'`isZoomed` reste FAUX — le balayage « photo suivante » et le défilement natif
// redeviennent actifs en même temps, exactement le conflit que ce lot voulait éliminer.
describe('visionneuse : la taille de repos survit a une rotation d\'ecran', () => {
  it('un redimensionnement du viewport (rotation) recalcule canvasStyle', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vpEl = w.find('.lb__viewport').element
    Object.defineProperty(vpEl, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(vpEl, 'clientHeight', { value: 800, configurable: true })
    const imgEl = w.find('[data-test="lb-img"]').element
    Object.defineProperty(imgEl, 'naturalWidth', { value: 2000, configurable: true })
    Object.defineProperty(imgEl, 'naturalHeight', { value: 1000, configurable: true })
    imgEl.dispatchEvent(new Event('load'))
    await w.vm.$nextTick()
    expect(w.vm.canvasStyle).toEqual({ width: '1000px', height: '500px' }) // limitee par la largeur

    // Rotation : le viewport devient beaucoup plus etroit (portrait).
    Object.defineProperty(vpEl, 'clientWidth', { value: 300, configurable: true })
    Object.defineProperty(vpEl, 'clientHeight', { value: 800, configurable: true })
    window.dispatchEvent(new Event('resize'))
    await w.vm.$nextTick()
    expect(w.vm.canvasStyle).toEqual({ width: '300px', height: '150px' }) // recalculee, plus limitee par la largeur
  })
})

// Revue du 09/08 : `.lb__close` et les deux `.lb__nav` sont des FRERES de `.lb__viewport`, pas
// des descendants — un doigt de pincement qui se pose sur un chevron (48×48, à 12 px du bord)
// n'est jamais compté par `pz.activePointers()`. Ni `justPinched` ni `isZoomed` ne peuvent voir
// ce cas : au relâchement de ce doigt, le clic sur le bouton part normalement.
describe('visionneuse : un pincement dont un doigt atterrit sur un bouton', () => {
  it('un doigt encore actif sur le viewport : le clic sur le chevron suivant ne change pas de photo', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    // Le doigt qui reste sur le viewport (l'autre moitie du pincement) : toujours actif.
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    await w.vm.$nextTick()
    // Le doigt qui a atterri sur le chevron se releve : le navigateur emet un clic.
    await w.find('.lb__nav--next').trigger('click')
    expect(lb.index).toBe(0) // pas de changement
  })

  it('un doigt encore actif sur le viewport : le clic sur le chevron precedent ne change pas de photo', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 1)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    await w.vm.$nextTick()
    await w.find('.lb__nav--prev').trigger('click')
    expect(lb.index).toBe(1) // pas de changement
  })

  it('un doigt encore actif sur le viewport : le clic sur le bouton fermer ne ferme pas', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    await w.vm.$nextTick()
    await w.find('.lb__close').trigger('click')
    expect(lb.open).toBe(true) // reste ouverte
  })

  it('sans aucun autre doigt actif, un simple tap sur le chevron suivant fonctionne toujours', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    await w.find('.lb__nav--next').trigger('click')
    expect(lb.index).toBe(1)
  })

  it('sans aucun autre doigt actif, un simple tap sur le chevron precedent fonctionne toujours', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 1)
    await w.vm.$nextTick()
    await w.find('.lb__nav--prev').trigger('click')
    expect(lb.index).toBe(0)
  })

  it('sans aucun autre doigt actif, un simple tap sur fermer fonctionne toujours', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    await w.find('.lb__close').trigger('click')
    expect(lb.open).toBe(false)
  })
})

// `justPinched` n'etait remis a zero qu'au prochain geste a un seul doigt (voir
// onViewportPointerDown) -- jamais a la fermeture. Un pincement juste avant de fermer laissait
// donc la garde armee pour la PROCHAINE ouverture, bloquant a tort son premier balayage.
describe('visionneuse : justPinched ne survit pas a une fermeture', () => {
  it('un pincement juste avant de fermer ne bloque pas le balayage de la reouverture', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vp = w.find('.lb__viewport')
    firePointer(vp, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerdown', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    firePointer(vp, 'pointerup', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer(vp, 'pointerup', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    lb.close()
    await w.vm.$nextTick()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    await balayer(w, -120)
    expect(lb.index).toBe(1) // le balayage fonctionne des la reouverture
  })
})

// Coordinateur (09/08) : la formule d'ancrage du composable partage, `(scrollLeft + ax) * ratio
// - ax`, n'est exacte QUE SI le decalage entre l'origine du canvas et l'origine de l'image reste
// PROPORTIONNEL au zoom, a tout instant. `canvasBoxStyle` (le canvas, cale sur le VIEWPORT, pas
// sur l'image) garantit cette proportionnalite ; `canvasStyle` (l'image, cale sur `base`) est
// inchange. Viewport 1000x800, photo naturelle 2000x1000 -> base = 1000x500 (axe largeur
// degenere : base_w = box_w = 1000:  seul l'axe hauteur, ou l'image est plus petite que le
// viewport au repos, discrimine reellement une taille de canvas qui suivrait l'image au lieu du
// viewport).
describe('visionneuse : le canvas suit le viewport (pas l\'image), pour que le zoom reste ancre', () => {
  it('a deux zooms differents, canvasBoxStyle vaut le VIEWPORT multiplie par le zoom (pas l\'image)', async () => {
    const w = mountIt()
    lb = useLightboxStore()
    lb.show(PHOTOS, 0)
    await w.vm.$nextTick()
    const vpEl = w.find('.lb__viewport').element
    Object.defineProperty(vpEl, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(vpEl, 'clientHeight', { value: 800, configurable: true })
    const imgEl = w.find('[data-test="lb-img"]').element
    Object.defineProperty(imgEl, 'naturalWidth', { value: 2000, configurable: true })
    Object.defineProperty(imgEl, 'naturalHeight', { value: 1000, configurable: true })
    imgEl.dispatchEvent(new Event('load'))
    await w.vm.$nextTick()

    // a 100% : canvas = viewport EXACTEMENT (pas l'image, base = 1000x500)
    expect(w.vm.canvasBoxStyle).toEqual({ width: '1000px', height: '800px' })
    expect(w.vm.canvasStyle).toEqual({ width: '1000px', height: '500px' }) // l'image, inchangee

    w.vm.pz.setZoom(200)
    await w.vm.$nextTick()

    // a 200% : canvas = viewport x2 (2000x1600), PAS l'image x2 (qui vaudrait 2000x1000)
    expect(w.vm.canvasBoxStyle).toEqual({ width: '2000px', height: '1600px' })
    expect(w.vm.canvasStyle).toEqual({ width: '2000px', height: '1000px' }) // l'image, x2 comme avant

    // Le rapport canvas/image (le decalage relatif) doit rester constant : c'est la propriete
    // qui annule la derive de l'ancrage. Sur l'axe largeur il vaut 1 (degenere, ne discrimine
    // pas une regression) ; sur l'axe hauteur il vaut 1.6 aux DEUX zooms.
    expect(1600 / 1000).toBeCloseTo(800 / 500) // hauteur : 1.6 = 1.6
  })
})

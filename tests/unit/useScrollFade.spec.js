// @vitest-environment jsdom
// Unitaire — indice de défilement (dégradé de bord) : `active` reflète le débordement
// RÉEL d'un conteneur (scrollWidth/clientWidth/scrollLeft), jamais un état forcé — sinon
// l'indice mentirait (cf. P2). jsdom ne calcule pas de vraie mise en page
// (scrollWidth/clientWidth valent 0 par défaut) : on simule les mesures via
// Object.defineProperty puis on appelle update() nous-mêmes, comme le ferait un vrai
// évènement 'scroll'/'resize'/mutation.
import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useScrollFade } from '@/composables/useScrollFade'

function mountHost() {
  const Comp = defineComponent({
    setup() {
      const elRef = ref(null)
      const { active, update } = useScrollFade(elRef)
      return { elRef, active, update }
    },
    render() {
      return h('div', { ref: 'elRef' }, 'contenu')
    },
  })
  return mount(Comp, { attachTo: document.body })
}

function setMetrics(el, { scrollWidth, clientWidth, scrollLeft = 0 }) {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true })
}

describe('useScrollFade', () => {
  it('actif quand le conteneur déborde réellement', async () => {
    const w = mountHost()
    setMetrics(w.vm.elRef, { scrollWidth: 500, clientWidth: 300 })
    w.vm.update()
    await w.vm.$nextTick()
    expect(w.vm.active).toBe(true)
    w.unmount()
  })

  it('inactif quand tout le contenu tient (pas de mensonge)', async () => {
    const w = mountHost()
    setMetrics(w.vm.elRef, { scrollWidth: 300, clientWidth: 300 })
    w.vm.update()
    await w.vm.$nextTick()
    expect(w.vm.active).toBe(false)
    w.unmount()
  })

  it('redevient inactif une fois défilé jusqu’au bout (pas de mensonge résiduel)', async () => {
    const w = mountHost()
    setMetrics(w.vm.elRef, { scrollWidth: 500, clientWidth: 300, scrollLeft: 200 })
    w.vm.update()
    await w.vm.$nextTick()
    expect(w.vm.active).toBe(false)
    w.unmount()
  })

  it('tolère un pixel d’arrondi sub-pixel sans se déclarer débordant à tort', async () => {
    const w = mountHost()
    setMetrics(w.vm.elRef, { scrollWidth: 301, clientWidth: 300 })
    w.vm.update()
    await w.vm.$nextTick()
    expect(w.vm.active).toBe(false)
    w.unmount()
  })

  it('retire ses écouteurs au démontage (pas de fuite — cf. fuite chrono déjà livrée sur ce chantier)', async () => {
    const w = mountHost()
    const el = w.vm.elRef
    // On espionne les AJOUTS avant la 2e passe du watcher (cf. commentaire ci-dessous) pour
    // capturer la référence EXACTE de la fonction `update` enregistrée. `expect.any(Function)`
    // ne vérifie que le TYPE de l'argument retiré, pas son IDENTITÉ : ça passerait même si
    // detach() retirait un AUTRE handler que celui posé à l'ajout (revue P2,
    // preuve par mutation ci-dessous).
    const addElSpy = vi.spyOn(el, 'addEventListener')
    const addWinSpy = vi.spyOn(window, 'addEventListener')
    // `watch(elRef, ..., { immediate: true })` s'exécute une 1re fois pendant `setup()` avec
    // `elRef.value` encore à `null` (le template ref n'est posé qu'au montage), puis une 2e
    // fois de façon réactive quand Vue affecte le vrai nœud DOM — cette 2e passe (celle qui
    // crée `mo` et pose les VRAIS écouteurs) est planifiée en microtâche (flush "pre"), pas
    // synchrone. Sans ce `await`, `mo` resterait `null` à l'instant du `unmount()` et
    // `disconnect()` ne serait jamais appelé — un faux rouge qui ne prouverait rien sur le
    // vrai comportement de nettoyage.
    await w.vm.$nextTick()
    const [, scrollHandler] = addElSpy.mock.calls.find(([type]) => type === 'scroll')
    const [, resizeHandler] = addWinSpy.mock.calls.find(([type]) => type === 'resize')

    const removeElSpy = vi.spyOn(el, 'removeEventListener')
    const removeWinSpy = vi.spyOn(window, 'removeEventListener')
    // Le MutationObserver (contenu qui change de longueur sans resize, cf. composable) est
    // lui aussi une source de fuite s'il n'est pas déconnecté au démontage — vérifié en plus
    // des deux `removeEventListener` ci-dessus, pas à leur place.
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect')
    w.unmount()
    // Assertions discriminantes : VTU/jsdom retirent AUSSI 'scroll' au démontage pour ~150
    // types d'évènements internes (avec une AUTRE fonction) — un `detach()` qui ne retire
    // RIEN ferait quand même passer `toHaveBeenCalledWith('scroll', expect.any(Function))`.
    // Vérifier l'IDENTITÉ de la fonction retirée (celle capturée à l'ajout, ci-dessus) est ce
    // qui mord vraiment sur un composable qui ne nettoie rien.
    expect(removeElSpy).toHaveBeenCalledWith('scroll', scrollHandler)
    expect(removeWinSpy).toHaveBeenCalledWith('resize', resizeHandler)
    expect(disconnectSpy).toHaveBeenCalledWith()
  })
})

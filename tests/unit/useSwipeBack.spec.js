// Unitaire — geste « retour » au balayage : géométrie du déclenchement.
import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useSwipeBack } from '@/composables/useSwipeBack'

function mountSwipe(onBack, opts) {
  const Comp = defineComponent({
    setup() {
      useSwipeBack(onBack, opts)
      return () => h('div')
    },
  })
  return mount(Comp)
}

// Forge un évènement tactile avec la liste de points attendue par le composable.
function swipe(startX, startY, endX, endY) {
  const start = new Event('touchstart')
  start.touches = [{ clientX: startX, clientY: startY }]
  window.dispatchEvent(start)
  const end = new Event('touchend')
  end.changedTouches = [{ clientX: endX, clientY: endY }]
  window.dispatchEvent(end)
}

describe('useSwipeBack', () => {
  it('déclenche sur un balayage horizontal depuis le bord gauche', () => {
    const onBack = vi.fn()
    const w = mountSwipe(onBack)
    swipe(5, 100, 100, 110) // bord gauche, dx=95, dy=10
    expect(onBack).toHaveBeenCalledOnce()
    w.unmount()
  })

  it('ignore un geste qui ne part pas du bord gauche', () => {
    const onBack = vi.fn()
    const w = mountSwipe(onBack)
    swipe(200, 100, 300, 110)
    expect(onBack).not.toHaveBeenCalled()
    w.unmount()
  })

  it('ignore un geste trop court', () => {
    const onBack = vi.fn()
    const w = mountSwipe(onBack)
    swipe(5, 100, 40, 110) // dx=35 < 70
    expect(onBack).not.toHaveBeenCalled()
    w.unmount()
  })

  it('ignore un geste trop vertical (confondu avec le scroll)', () => {
    const onBack = vi.fn()
    const w = mountSwipe(onBack)
    swipe(5, 100, 100, 220) // dx=95, dy=120 > dx*0.5
    expect(onBack).not.toHaveBeenCalled()
    w.unmount()
  })

  it('retire ses écouteurs au démontage', () => {
    const onBack = vi.fn()
    const w = mountSwipe(onBack)
    w.unmount()
    swipe(5, 100, 100, 110)
    expect(onBack).not.toHaveBeenCalled()
  })
})

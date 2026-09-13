import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChartZoomStore } from '@/stores/chart-zoom'

describe('store chart-zoom', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('show ouvre avec le payload, close referme et purge', () => {
    const s = useChartZoomStore()
    expect(s.open).toBe(false)
    const p = { chart: { rows: 50, img: 'x.png' }, row: 3, rep: 1, frame: null, readOnly: false }
    s.show(p)
    expect(s.open).toBe(true)
    expect(s.payload).toEqual(p)
    s.close()
    expect(s.open).toBe(false)
    expect(s.payload).toBeNull()
  })
})

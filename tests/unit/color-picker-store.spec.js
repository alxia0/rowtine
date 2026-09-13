import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useColorPickerStore } from '@/stores/color-picker'

describe('store color-picker', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('open direct puis close() referme', () => {
    const s = useColorPickerStore()
    expect(s.open).toBe(false)
    s.open = true
    expect(s.open).toBe(true)
    s.close()
    expect(s.open).toBe(false)
  })
})

// Unitaire — store cropper : ouverture, résolution de la promesse (Valider / Annuler).
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCropperStore } from '@/stores/cropper'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('store cropper', () => {
  it('crop() ouvre le recadreur et expose la source', () => {
    const store = useCropperStore()
    expect(store.open).toBe(false)
    store.crop('data:image/jpeg;base64,AAAA')
    expect(store.open).toBe(true)
    expect(store.src).toBe('data:image/jpeg;base64,AAAA')
  })

  it('settle(result) résout la promesse avec le résultat et referme', async () => {
    const store = useCropperStore()
    const p = store.crop('data:image/jpeg;base64,AAAA')
    store.settle('data:image/jpeg;base64,CROP')
    await expect(p).resolves.toBe('data:image/jpeg;base64,CROP')
    expect(store.open).toBe(false)
    expect(store.src).toBe('')
  })

  it('settle(null) résout avec null (annulation)', async () => {
    const store = useCropperStore()
    const p = store.crop('x')
    store.settle(null)
    await expect(p).resolves.toBeNull()
    expect(store.open).toBe(false)
  })
})

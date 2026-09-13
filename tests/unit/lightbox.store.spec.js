// Unitaire — store lightbox : ouverture, navigation cyclique, fermeture.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLightboxStore } from '@/stores/lightbox'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('store lightbox', () => {
  it('show() ouvre sur l’index demandé et expose la photo courante', () => {
    const store = useLightboxStore()
    store.show(['a', 'b', 'c'], 1)
    expect(store.open).toBe(true)
    expect(store.current).toBe('b')
    expect(store.hasMany).toBe(true)
  })

  it('show() ignore une liste vide', () => {
    const store = useLightboxStore()
    store.show([])
    expect(store.open).toBe(false)
  })

  it('next()/prev() naviguent en cycle', () => {
    const store = useLightboxStore()
    store.show(['a', 'b', 'c'], 2)
    store.next()
    expect(store.current).toBe('a') // cycle vers le début
    store.prev()
    expect(store.current).toBe('c') // cycle vers la fin
  })

  it('show() borne un index hors plage et accepte une seule photo', () => {
    const store = useLightboxStore()
    store.show('seule', 5)
    expect(store.current).toBe('seule')
    expect(store.hasMany).toBe(false)
    store.close()
    expect(store.open).toBe(false)
  })
})

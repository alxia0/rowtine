// Unitaire — store photo-source (décision produit du 04/09/2026, option (a)) : la feuille
// maison qui remplace le prompt natif CameraSource.Prompt du plugin @capacitor/camera.
// Motif exact du store cropper (cropper.store.spec.js) : askSource() ouvre, settle()
// résout la promesse avec 'gallery' | 'camera' | null et referme.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePhotoSourceStore } from '@/stores/photo-source'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('store photo-source', () => {
  it('askSource() ouvre la feuille et renvoie une promesse en attente', () => {
    const store = usePhotoSourceStore()
    expect(store.open).toBe(false)
    const p = store.askSource()
    expect(store.open).toBe(true)
    expect(p).toBeInstanceOf(Promise)
  })

  it("settle('gallery') résout la promesse avec 'gallery' et referme", async () => {
    const store = usePhotoSourceStore()
    const p = store.askSource()
    store.settle('gallery')
    await expect(p).resolves.toBe('gallery')
    expect(store.open).toBe(false)
  })

  it("settle('camera') résout la promesse avec 'camera' et referme", async () => {
    const store = usePhotoSourceStore()
    const p = store.askSource()
    store.settle('camera')
    await expect(p).resolves.toBe('camera')
    expect(store.open).toBe(false)
  })

  it('settle(null) résout avec null (annulation) et referme', async () => {
    const store = usePhotoSourceStore()
    const p = store.askSource()
    store.settle(null)
    await expect(p).resolves.toBeNull()
    expect(store.open).toBe(false)
  })

  // Double appel : même sémantique que le store cropper — le resolver est REMPLACÉ, la
  // dernière demande gagne (singleton : une seule feuille, le composant n'en monte qu'une).
  // La première promesse reste pendante ; en pratique cela n'arrive que si deux vues
  // déclenchent pickImage() simultanément, ce que la feuille modale empêche déjà.
  it('double appel : le second askSource remplace le resolver, settle ne résout que lui', async () => {
    const store = usePhotoSourceStore()
    let resolved1 = false
    const p1 = store.askSource().then(() => {
      resolved1 = true
    })
    const p2 = store.askSource()
    expect(store.open).toBe(true)
    store.settle('camera')
    await expect(p2).resolves.toBe('camera')
    await Promise.resolve() // laisse p1 se résoudre si elle devait — elle ne doit pas
    expect(resolved1).toBe(false)
    expect(p1).toBeInstanceOf(Promise) // encore pendante, jamais rejetée
    expect(store.open).toBe(false)
  })

  it('settle() sans demande en cours est un no-op (pas de crash au démontage)', () => {
    const store = usePhotoSourceStore()
    expect(() => store.settle(null)).not.toThrow()
    expect(store.open).toBe(false)
  })
})

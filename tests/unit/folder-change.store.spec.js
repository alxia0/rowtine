// Unitaire — le pont Réglages ↔ porte du dossier (décision produit du
// 05/09/2026). Deux champs, deux directions (cf. src/stores/folder-change.js) :
// `requested` est l'impulsion de demande levée par SafFolderSection et CONSOMMÉE par
// App.vue ; `closeCount` est le compteur de fermetures incrémenté par la porte elle-même
// et observé par SafFolderSection pour recharger son état.
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFolderChangeStore } from '@/stores/folder-change'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('store du pont Réglages → porte', () => {
  it('requestChange() lève la demande, sans toucher au compteur de fermetures', () => {
    const store = useFolderChangeStore()
    expect(store.requested).toBe(false)
    expect(store.closeCount).toBe(0)
    store.requestChange()
    expect(store.requested).toBe(true)
    expect(store.closeCount).toBe(0)
  })

  // La consommation est le fait du CONSOMMATEUR (App.vue remet à faux dans son
  // watch) : le store ne décide rien tout seul, et une demande reste levée tant
  // que personne ne l'a consommée — c'est ce qui permet au test d'App.vue
  // (App.back-precedence.spec.js) de prouver que le watch la consomme bien.
  it('la demande reste levée tant que le consommateur ne l\'a pas remise à faux', () => {
    const store = useFolderChangeStore()
    store.requestChange()
    store.requestChange() // double clic sur le bouton des Réglages : un seul état
    expect(store.requested).toBe(true)
    store.requested = false // ce que fait le watch d'App.vue après ouverture
    expect(store.requested).toBe(false)
  })

  it('notifyGateClosed() remet la demande à faux et incrémente le compteur', () => {
    const store = useFolderChangeStore()
    store.requestChange()
    store.notifyGateClosed()
    expect(store.requested).toBe(false)
    expect(store.closeCount).toBe(1)
  })

  // Pourquoi un COMPTEUR et pas un booléen « porte refermée » : deux fermetures
  // rapprochées laissent le booléen à la même valeur et un watch muet, alors que
  // l'état du dossier a pu changer entre les deux. Le compteur, lui, bouge toujours.
  it('deux fermetures rapprochées incrémentent DEUX FOIS (défaut du booléen évité)', () => {
    const store = useFolderChangeStore()
    store.notifyGateClosed()
    store.notifyGateClosed()
    expect(store.closeCount).toBe(2)
  })
})

// @vitest-environment jsdom
// Unitaire — store stock de laines : CRUD + valeurs par défaut + suppression/restauration.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useYarnsStore, emptyYarn } from '@/stores/yarns'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('store yarns', () => {
  it('ajoute une laine avec les défauts (quantité 1, libre)', async () => {
    const store = useYarnsStore()
    await store.add({ brand: 'Drops', colorName: 'Bleu nuit' })
    expect(store.yarns).toHaveLength(1)
    expect(store.yarns[0]).toMatchObject({ brand: 'Drops', colorName: 'Bleu nuit', quantity: 1, reservations: {} })
  })

  it('met à jour une laine existante', async () => {
    const store = useYarnsStore()
    await store.add({ brand: 'Phildar' })
    const id = store.yarns[0].id
    await store.update(id, { quantity: 4, weight: 'dk' })
    expect(store.yarns[0]).toMatchObject({ quantity: 4, weight: 'dk' })
  })

  it('liste du plus récent au plus ancien', async () => {
    const store = useYarnsStore()
    await store.add({ brand: 'A' })
    await store.add({ brand: 'B' })
    expect(store.yarns.map((y) => y.brand)).toEqual(['B', 'A'])
  })

  it('remove renvoie la laine supprimée, restore la réinsère', async () => {
    const store = useYarnsStore()
    await store.add({ brand: 'Katia' })
    const id = store.yarns[0].id
    const removed = await store.remove(id)
    expect(store.yarns).toHaveLength(0)
    expect(removed.brand).toBe('Katia')
    await store.restore(removed)
    expect(store.yarns).toHaveLength(1)
  })

  it('une laine déjà migrée n’est pas réécrite (idempotent)', async () => {
    await db.yarns.add({ id: 91, brand: 'Drops', colorName: 'Vert', quantity: 3, reservations: { 4: 1 }, consumed: {} })
    const store = useYarnsStore()
    await store.load()
    expect((await db.yarns.get(91)).reservations).toEqual({ 4: 1 })
  })

  it('emptyYarn a une trace de consommation vide', () => {
    expect(emptyYarn().consumed).toEqual({})
  })

  // Modèle distinct de la marque, notes et lieu de rangement : vides par défaut,
  // remplis par l'import Ravelry ou la saisie manuelle (rendu couvert par
  // tests/unit/YarnDetailView.spec.js:339, describe « YarnDetailView, Notes et
  // Lieu de rangement », remise à vide de purchasedAt par YarnEditView.spec.js).
  // Épinglé ici directement sur emptyYarn().
  it('emptyYarn a un modèle, des notes et un lieu de rangement vides par défaut', () => {
    expect(emptyYarn()).toMatchObject({ model: '', notes: '', storedIn: '' })
  })

  it('emptyYarn a un type de coloris "uni" et des notes de couleur vides par défaut', () => {
    expect(emptyYarn()).toMatchObject({ colorType: 'uni', colorNotes: '' })
  })

  // Le piège de ce lot : une laine migrée par la version PRÉCÉDENTE a `reservations`
  // mais pas encore `consumed`. Elle doit être re-migrée UNE fois pour gagner
  // `consumed: {}`, puis plus jamais — preuve directe par comptage des écritures Dexie
  // (pas seulement par la valeur finale, qui resterait verte même en cas de réécriture
  // à chaque lancement).
  it('idempotence de la re-migration consumed : un 2e load() n’écrit plus rien', async () => {
    await db.yarns.add({ id: 96, brand: 'Katia', colorName: 'Rouge', quantity: 4, reservations: { 3: 1 } })
    const store = useYarnsStore()

    await store.load() // 1er load : reservations sans consumed → re-migration, une fois
    const y1 = await db.yarns.get(96)
    expect(y1.reservations).toEqual({ 3: 1 })
    expect(y1.consumed).toEqual({})

    const updateSpy = vi.spyOn(db.yarns, 'update')
    await store.load() // 2e load : reservations ET consumed déjà présents → aucune écriture
    expect(updateSpy).not.toHaveBeenCalled()
    updateSpy.mockRestore()
  })
})

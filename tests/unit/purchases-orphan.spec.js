// tests/unit/purchases-orphan.spec.js
// Arbitrage produit : la dépense survit à la suppression DÉFINITIVE d'une laine.
// Le passage en corbeille, lui, ne doit RIEN casser — la fiche peut revenir.
import { it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useTrashStore } from '@/stores/trash'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

it('mise en corbeille : les achats gardent leur lien', async () => {
  const trash = useTrashStore()
  await db.purchases.add({ yarnId: 5, yarnLabel: 'Drops', quantity: 2, unitPrice: '6', kind: 'buy', currency: 'EUR' })
  await trash.add('yarn', { id: 5, brand: 'Drops', colorName: 'Bleu' })
  expect((await db.purchases.toArray())[0].yarnId).toBe(5)
})

it('élément jeté de la corbeille : achats orphelins mais intacts', async () => {
  const trash = useTrashStore()
  await db.purchases.add({ yarnId: 5, yarnLabel: 'Drops · Bleu', quantity: 2, unitPrice: '6', kind: 'buy', currency: 'EUR' })
  const tid = await trash.add('yarn', { id: 5, brand: 'Drops', colorName: 'Bleu' })
  await trash.drop(tid)
  const line = (await db.purchases.toArray())[0]
  expect(line.yarnId).toBeNull()
  expect(line.yarnLabel).toBe('Drops · Bleu')
  expect(line.quantity).toBe(2) // le budget ne bouge pas
})

it('corbeille vidée : idem pour toutes les laines qu’elle contenait', async () => {
  const trash = useTrashStore()
  await db.purchases.bulkAdd([
    { yarnId: 5, yarnLabel: 'A', quantity: 1, unitPrice: '2', kind: 'buy', currency: 'EUR' },
    { yarnId: 6, yarnLabel: 'B', quantity: 1, unitPrice: '3', kind: 'buy', currency: 'EUR' },
  ])
  await trash.add('yarn', { id: 5, brand: 'A', colorName: 'a' })
  await trash.add('yarn', { id: 6, brand: 'B', colorName: 'b' })
  await trash.empty()
  expect((await db.purchases.toArray()).every((l) => l.yarnId === null)).toBe(true)
  expect(await db.purchases.count()).toBe(2)
})

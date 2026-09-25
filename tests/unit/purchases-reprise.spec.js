// @vitest-environment jsdom
// tests/unit/purchases-reprise.spec.js
// Unitaire — reconstruction de l'historique des fiches existantes. Deux exigences
// opposées se rencontrent ici : reconstruire ce qui existe AU PREMIER lancement, et
// ne JAMAIS ressusciter des lignes que l'utilisateur a délibérément supprimées.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting } from '@/db/db'
import { buildReconstructedPurchase, runReprise, ensureReprise, REPRISE_FLAG } from '@/db/purchases-reprise'
import { useTrashStore } from '@/stores/trash'
import { stockGap } from '@/utils/purchases'
import { usePurchasesStore } from '@/stores/purchases'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('ligne reconstruite', () => {
  it('quantité = restant + déjà tricoté, prix et date repris de la fiche', () => {
    const yarn = { id: 4, brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu ciel',
      quantity: 3, consumed: { 7: 2 }, price: '4,20', purchasedAt: '2026-03-04', bain: 'A12' }
    expect(buildReconstructedPurchase(yarn, 'EUR')).toMatchObject({
      yarnId: 4, kind: 'buy', quantity: 5, unitPrice: '4,20',
      date: '2026-03-04', bain: 'A12', currency: 'EUR', reconstructed: true,
    })
  })
  it('libellé figé lisible : marque · modèle · coloris', () => {
    const l = buildReconstructedPurchase({ id: 1, brand: 'Katia', model: 'Merino', colorName: 'Rouge' }, 'EUR')
    expect(l.yarnLabel).toBe('Katia · Merino · Rouge')
  })
  it('fiche sans prix : achat à prix vide, PAS un cadeau', () => {
    const l = buildReconstructedPurchase({ id: 2, brand: 'X', quantity: 2, price: '' }, 'EUR')
    expect(l.kind).toBe('buy')
    expect(l.unitPrice).toBe('')
  })
  it('fiche sans date d’achat : date vide, jamais inventée', () => {
    expect(buildReconstructedPurchase({ id: 3, quantity: 1 }, 'EUR').date).toBe('')
  })
  // `price` est un nombre JS depuis que StashView.vue le normalise à la saisie — un point
  // décimal repris tel quel dans `unitPrice` casserait la virgule française attendue partout
  // ailleurs dans ce champ (revue finale).
  it('fiche à prix numérique : la virgule française, pas le point JS', () => {
    const l = buildReconstructedPurchase({ id: 5, brand: 'Y', quantity: 1, price: 9.5 }, 'EUR')
    expect(l.unitPrice).toBe('9,5')
  })
})

describe('exécution de la reprise', () => {
  it('crée une ligne par fiche et pose le drapeau', async () => {
    await db.yarns.bulkAdd([
      { id: 1, brand: 'A', colorName: 'x', quantity: 2, price: '5', consumed: {} },
      { id: 2, brand: 'B', colorName: 'y', quantity: 1, price: '3', consumed: { 9: 4 } },
    ])
    expect(await runReprise('EUR')).toBe(2)
    const lines = await db.purchases.toArray()
    expect(lines.map((l) => l.quantity).sort()).toEqual([2, 5]) // 2 · 1+4
    expect(await getSetting(REPRISE_FLAG)).toBe(true)
  })

  it('ensureReprise ne rejoue rien quand le drapeau est posé', async () => {
    await db.yarns.add({ id: 1, brand: 'A', colorName: 'x', quantity: 2, price: '5', consumed: {} })
    await ensureReprise('EUR')
    await db.purchases.clear() // l’utilisateur a supprimé ses lignes reconstruites
    expect(await ensureReprise('EUR')).toBe(0)
    expect(await db.purchases.count()).toBe(0) // le geste de l’utilisateur TIENT
  })

  it('runReprise saute une laine qui a déjà une ligne (garde anti-doublon)', async () => {
    await db.yarns.add({ id: 1, brand: 'A', colorName: 'x', quantity: 2, price: '5', consumed: {} })
    await db.purchases.add({ yarnId: 1, kind: 'buy', quantity: 2, unitPrice: '5', currency: 'EUR' })
    expect(await runReprise('EUR')).toBe(0)
    expect(await db.purchases.count()).toBe(1)
  })

  it('aucune laine : rien à faire, drapeau posé quand même', async () => {
    expect(await runReprise('EUR')).toBe(0)
    expect(await getSetting(REPRISE_FLAG)).toBe(true)
  })
})

// Correctif final (arbitrage) : « le cumul démarre sur ce qui existe au jour de la
// mise à jour, corbeille comprise ». Nombres distincts (id 11, quantité 4, consommé 2,
// acquis 6) — aucun ne coïncide avec les fixtures ci-dessus.
describe('reprise et corbeille', () => {
  it('laine en corbeille au moment de la reprise : reçoit sa ligne, et la restaurer lui rend son historique sans écart', async () => {
    const trash = useTrashStore()
    await trash.add('yarn', { id: 11, brand: 'Bergère', model: 'Sport', colorName: 'Ambre', quantity: 4, consumed: { 3: 2 } })
    // La laine n'est PAS dans db.yarns tant qu'elle est en corbeille.
    expect(await db.yarns.count()).toBe(0)

    expect(await runReprise('EUR')).toBe(1)
    const linesBefore = await db.purchases.toArray()
    expect(linesBefore).toHaveLength(1)
    expect(linesBefore[0]).toMatchObject({ yarnId: 11, quantity: 6, reconstructed: true }) // 4 restantes + 2 tricotées

    // Restauration : la fiche revient avec le MÊME id (stores/trash.js) → le lien se
    // rétablit tout seul, sans repasser par la reprise.
    const trashRow = (await db.trash.toArray())[0]
    await trash.restore(trashRow.id)
    const restoredYarn = (await db.yarns.toArray()).find((y) => y.id === 11)
    expect(restoredYarn).toBeTruthy()

    const purchasesStore = usePurchasesStore()
    await purchasesStore.load()
    expect(stockGap(restoredYarn, purchasesStore.forYarn(11))).toBe(0) // aucune alerte d'écart après restauration
  })

  it('garde anti-doublon tenue aussi côté corbeille : une laine en corbeille qui a déjà une ligne n’en reçoit pas une seconde', async () => {
    const trash = useTrashStore()
    await trash.add('yarn', { id: 12, brand: 'X', colorName: 'y', quantity: 2, consumed: {} })
    await db.purchases.add({ yarnId: 12, kind: 'buy', quantity: 2, unitPrice: '5', currency: 'EUR' })
    expect(await runReprise('EUR')).toBe(0)
    expect(await db.purchases.count()).toBe(1)
  })
})

// @vitest-environment jsdom
// Composant — App.vue, câblage de la reprise du budget au lancement (les travaux sur le
// budget, 31/07). Ce test couvre le CÂBLAGE (la reprise part-elle au montage, avec la bonne
// devise, une seule fois ?), pas le calcul lui-même (couvert par purchases-reprise.spec.js).
// Montage repris tel quel de tests/unit/App.restore-offer.spec.js (mêmes contraintes :
// vue-router mocké, enfants lourds stubbés, base Dexie réelle via fake-indexeddb pour les
// stores Pinia) — pas de second schéma de montage d'App.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  RouterView: { template: '<div />' },
}))

// Garde de permission SAF (backup-service) : `getBackupStorage` résolu à `null` fait
// répondre `maybeOfferRestore()` par `false` immédiatement (aucune restauration
// proposée) — condition nécessaire pour observer la reprise, qui doit tourner APRÈS
// l'offre de restauration.
const backupService = vi.hoisted(() => ({
  getBackupStorage: vi.fn(),
  getBackupPermissionOk: vi.fn(),
}))
vi.mock('@/backup/backup-service', () => backupService)

const restore = vi.hoisted(() => ({ hasBackup: vi.fn() }))
vi.mock('@/backup/restore', () => restore)

// `ensureReprise` enveloppé d'un espion QUI APPELLE l'implémentation réelle (donc les
// assertions d'effet — devise, yarnId, drapeau — restent couvertes), pour pouvoir en plus
// comparer son ordre d'appel à celui de `getBackupStorage` (1er appel fait par
// `maybeOfferRestore`). Un simple test d'effet ne suffit pas : neutraliser l'offre de
// restauration (`getBackupStorage → null`) fait sortir `maybeOfferRestore()` sans rien
// toucher d'observable, donc un test qui ne regarde QUE le résultat final ne peut pas
// distinguer « reprise après l'offre » de « reprise avant l'offre » (en revue).
vi.mock('@/db/purchases-reprise', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ensureReprise: vi.fn(actual.ensureReprise) }
})

import { ensureReprise } from '@/db/purchases-reprise'
import App from '@/App.vue'

function mountApp() {
  return mount(App, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        SnackBar: true,
        PhotoLightbox: true,
        PhotoCropper: true,
        OnboardingFolderPrompt: true,
      },
    },
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('App — reprise du budget au lancement', () => {
  it('au montage de App, la reprise tourne avec la devise des réglages', async () => {
    backupService.getBackupStorage.mockResolvedValue(null) // web : aucune offre de restauration
    restore.hasBackup.mockResolvedValue(false)

    await db.settings.put({ key: 'currency', value: 'CHF' })
    await db.yarns.add({ id: 1, brand: 'A', colorName: 'x', quantity: 2, price: '5', consumed: {} })

    mountApp()

    // La chaîne d'onMounted enchaîne de nombreux await (stores + IndexedDB réelle via
    // fake-indexeddb) ; on attend la condition plutôt qu'un nombre de ticks fixe.
    await vi.waitFor(
      async () => {
        const lines = await db.purchases.toArray()
        expect(lines).toHaveLength(1)
      },
      { timeout: 10000 },
    )

    const lines = await db.purchases.toArray()
    expect(lines[0].currency).toBe('CHF')
    expect(lines[0].yarnId).toBe(1)

    // Une seule fois : le drapeau de réglage doit être posé après le passage.
    const flag = await db.settings.get('purchasesRepriseDone')
    expect(flag?.value).toBe(true)

    // Ordre d'APPEL, pas seulement effet final : `ensureReprise` doit avoir été invoqué
    // APRÈS `getBackupStorage` (1er appel de `maybeOfferRestore`) — l'exigence centrale
    // du cahier des charges. `mock.invocationCallOrder` porte un compteur global
    // partagé par tous les mocks vitest de ce test : le comparer suffit, pas besoin de
    // rejouer la temporalité exacte.
    expect(backupService.getBackupStorage).toHaveBeenCalled()
    expect(ensureReprise).toHaveBeenCalled()
    expect(ensureReprise.mock.invocationCallOrder[0]).toBeGreaterThan(
      backupService.getBackupStorage.mock.invocationCallOrder[0],
    )
  })
})

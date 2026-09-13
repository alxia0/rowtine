// Unitaire — store du dernier incident de restauration (décision produit
// du 05/09/2026). Une seule valeur, écrasée à chaque publication, pas
// d'historique (assumé, cf. en-tête du store) : le test fige ce contrat minimal
// et la forme du rapport consommée par RestoreErrorDialog.vue.
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { useRestoreErrorStore } = await import('@/stores/restore-error')

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useRestoreErrorStore', () => {
  it('démarre à null : aucune modale tant que rien n’a été publié', () => {
    expect(useRestoreErrorStore().report).toBeNull()
  })

  it('setReport publie le rapport tel quel ({ kind, error, path, at })', () => {
    const report = {
      kind: 'error',
      error: 'EIO: read failed',
      path: 'Documents/Rowtine',
      at: '2026-09-05T18:42:10+02:00',
    }
    const store = useRestoreErrorStore()
    store.setReport(report)
    // Vue enrobe la valeur dans un proxy réactif : égalité PAR VALEUR (toStrictEqual),
    // pas par référence — c'est le contenu que consomme RestoreErrorDialog.vue.
    expect(store.report).toStrictEqual(report)
  })

  it('accepte la variante unowned avec écarts optionnels ({ kind: "unowned", details })', () => {
    const report = {
      kind: 'unowned',
      error: null,
      path: 'Documents/Rowtine',
      at: '2026-09-05T18:42:10+02:00',
      details: [{ where: 'Patrons/x [9]', code: 'ENTITY_REJECTED' }],
    }
    const store = useRestoreErrorStore()
    store.setReport(report)
    expect(store.report).toStrictEqual(report)
  })

  it('une nouvelle publication ÉCRASE la précédente (une seule valeur, pas d’historique)', () => {
    const store = useRestoreErrorStore()
    store.setReport({ kind: 'error', error: 'premier', path: 'a', at: '2026-09-05T10:00:00Z' })
    const second = { kind: 'unowned', error: null, path: 'b', at: '2026-09-05T11:00:00Z' }
    store.setReport(second)
    expect(store.report).toStrictEqual(second)
    expect(store.report.kind).toBe('unowned')
  })
})

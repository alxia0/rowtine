// Unitaire — store du dernier échec d'enregistrement automatique (05/09/2026).
// Une seule valeur, écrasée à chaque échec, pas d'historique
// (assumé, cf. en-tête du store) : le test fige ce contrat minimal.
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { useBackupFailureStore } = await import('@/stores/backup-failure')

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useBackupFailureStore', () => {
  it('démarre à null : aucun échec publié tant que rien n’a tourné', () => {
    expect(useBackupFailureStore().failure).toBeNull()
  })

  it('setFailure publie l’échec tel quel ({ error, path, at })', () => {
    const failure = {
      error: 'EIO: write failed',
      path: 'Documents/Rowtine',
      at: '2026-09-05T18:42:10+02:00',
    }
    const store = useBackupFailureStore()
    store.setFailure(failure)
    // Vue enrobe la valeur dans un proxy réactif : égalité PAR VALEUR (toStrictEqual),
    // pas par référence — c'est le contenu que consomme App.vue.
    expect(store.failure).toStrictEqual(failure)
  })

  it('un nouvel échec ÉCRASE le précédent (une seule valeur, pas d’historique)', () => {
    const store = useBackupFailureStore()
    store.setFailure({ error: 'premier', path: 'a', at: '2026-09-05T10:00:00Z' })
    const second = { error: 'second', path: 'b', at: '2026-09-05T11:00:00Z' }
    store.setFailure(second)
    expect(store.failure).toStrictEqual(second)
    expect(store.failure.error).toBe('second')
  })
})

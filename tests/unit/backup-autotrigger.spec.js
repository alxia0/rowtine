// Unitaire — câblage du déclenchement auto de sauvegarde à la mise en pause.
// On vérifie que le listener
// `pause` est bien enregistré et qu'il déclenche `flushAutoBackup` — sans
// monter App.vue ni le plugin natif. La sauvegarde débouncée elle-même
// (armement sur mutation) est couverte par `auto-backup.spec.js`.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flushAutoBackup = vi.hoisted(() => vi.fn())
vi.mock('@/backup/auto-backup', () => ({
  flushAutoBackup: (...a) => flushAutoBackup(...a),
}))

// Lot « restauration lourde » (06/09/2026) : le listener `pause` efface AUSSI le
// drapeau « dossier propre depuis la restauration » (restore-guard.js). Mocké ici
// (et non importé réel) pour prouver l'ORDRE — effacé AVANT le flush — via les
// `invocationCallOrder` des deux doubles, chose impossible avec le module réel.
const clearFolderClean = vi.hoisted(() => vi.fn())
vi.mock('@/backup/restore-guard', () => ({
  clearFolderClean: (...a) => clearFolderClean(...a),
}))

// Les doubles accumulent leurs appels d'un test à l'autre (invocationCallOrder
// compris) : remise à zéro pour que chaque test mesure SEUL son handler.
beforeEach(() => {
  vi.clearAllMocks()
})

const { registerAutoBackupOnPause } = await import('@/backup/auto-trigger')

describe('registerAutoBackupOnPause', () => {
  it("enregistre un listener 'pause' sur l'App fournie", () => {
    const addListener = vi.fn()
    registerAutoBackupOnPause({ addListener })
    expect(addListener).toHaveBeenCalledWith('pause', expect.any(Function))
  })

  it('déclenche flushAutoBackup quand le listener pause est appelé', () => {
    let handler
    const addListener = vi.fn((event, cb) => {
      handler = cb
    })
    registerAutoBackupOnPause({ addListener })

    expect(flushAutoBackup).not.toHaveBeenCalled()
    handler()
    expect(flushAutoBackup).toHaveBeenCalledTimes(1)
  })

  // Lot « restauration lourde » (06/09/2026) : la pause BORNE la fenêtre « dossier
  // propre » à la session foreground (pendant la pause, le PC peut éditer le
  // dossier — au retour, la synchro du lancement doit reprendre son comportement
  // habituel). Effacé AVANT le flush : le flush qui suit devient no-op si rien
  // n'a muté, et jamais un flush « propre-périmé » ne passerait avant l'effacement.
  it('efface le drapeau « dossier propre » AVANT de déclencher le flush', () => {
    let handler
    const addListener = vi.fn((event, cb) => {
      handler = cb
    })
    registerAutoBackupOnPause({ addListener })

    handler()

    expect(clearFolderClean).toHaveBeenCalledTimes(1)
    expect(clearFolderClean.mock.invocationCallOrder[0]).toBeLessThan(flushAutoBackup.mock.invocationCallOrder[0])
  })
})

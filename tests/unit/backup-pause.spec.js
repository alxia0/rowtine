// @vitest-environment jsdom
// Unitaire — le prédicat unique qui met la sauvegarde automatique en pause
// (2026-08-04, §3.1 ; avenant 04/08/2026). Depuis l'avenant, le critère n'est
// plus `isDbRestorable()` mais une DÉCISION explicite (`hasBackupDecision`,
// backup-decision.js) : un prédicat calculé ne distingue pas « elle a décidé » de
// « quelque chose a écrit ».
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hasBackup = vi.hoisted(() => vi.fn())
vi.mock('@/backup/restore', () => ({ hasBackup: (...a) => hasBackup(...a) }))

const hasBackupDecision = vi.hoisted(() => vi.fn())
vi.mock('@/backup/backup-decision', () => ({ hasBackupDecision: (...a) => hasBackupDecision(...a) }))

// Étape 7a — garde de régression : l'AVENANT dit que `isDbRestorable` ne commande
// plus la sauvegarde (elle reste réservée à la RESTAURATION). Sans ce mock, une
// régression qui réintroduirait l'ancien critère (`isDbRestorable` au lieu de
// `hasBackupDecision`) ne ferait rougir AUCUN test de ce fichier — les deux
// prédicats concordent trop souvent par coïncidence pour que ça se voie autrement.
const isDbRestorable = vi.hoisted(() => vi.fn())
vi.mock('@/backup/restore-service', () => ({ isDbRestorable: (...a) => isDbRestorable(...a) }))

// Fiche d'identité (lot du 06/08/2026) : depuis ce lot, une décision prise ne
// suffit plus à lever la pause — encore faut-il qu'un AUTRE appareil n'ait pas écrit dans
// le dossier depuis. `'absent'` par défaut = sauvegarde écrite AVANT ce lot, c'est-à-dire
// l'état de toutes celles qui existent : c'est bien le contexte historique que ce fichier
// décrit, et il ne suspend pas. Le détail des trois états est couvert par
// tests/unit/backup-pause-reason.spec.js.
const readManifest = vi.hoisted(() => vi.fn(async () => ({ state: 'absent' })))
vi.mock('@/backup/backup-manifest', () => ({ readManifest: (...a) => readManifest(...a) }))
const deviceId = vi.hoisted(() => vi.fn(async () => 'cet-appareil'))
vi.mock('@/backup/device-identity', () => ({ deviceId: (...a) => deviceId(...a) }))

const { isBackupPaused } = await import('@/backup/backup-pause')

const storage = { marker: 'stockage factice' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isBackupPaused', () => {
  it('en pause quand le dossier contient une sauvegarde ET qu’aucune décision n’a été prise pour lui', async () => {
    hasBackup.mockResolvedValue(true)
    hasBackupDecision.mockResolvedValue(false)
    expect(await isBackupPaused(storage)).toBe(true)
    expect(hasBackup).toHaveBeenCalledWith(storage)
    expect(isDbRestorable).not.toHaveBeenCalled()
  })

  it("PAS en pause dès qu'une décision a été prise pour ce dossier", async () => {
    hasBackup.mockResolvedValue(true)
    hasBackupDecision.mockResolvedValue(true)
    expect(await isBackupPaused(storage)).toBe(false)
    expect(isDbRestorable).not.toHaveBeenCalled()
  })

  it("n'interroge PAS la décision quand le dossier est déjà vide (chemin de la 1re sauvegarde)", async () => {
    hasBackup.mockResolvedValue(false)
    await isBackupPaused(storage)
    expect(hasBackupDecision).not.toHaveBeenCalled()
  })

  it("PAS en pause sur dossier vide (1re sauvegarde d'une installation neuve), quel que soit l'état de la décision", async () => {
    hasBackup.mockResolvedValue(false)
    expect(await isBackupPaused(storage)).toBe(false)
  })

  it('se referme (pause) si hasBackup lève (permission SAF perdue, erreur E/S)', async () => {
    hasBackup.mockRejectedValue(new Error('SAF indisponible'))
    expect(await isBackupPaused(storage)).toBe(true)
  })

  it('se referme (pause) si hasBackupDecision lève', async () => {
    hasBackup.mockResolvedValue(true)
    hasBackupDecision.mockRejectedValue(new Error('base illisible'))
    expect(await isBackupPaused(storage)).toBe(true)
  })

  it('se referme (pause) sans stockage', async () => {
    expect(await isBackupPaused(null)).toBe(true)
    expect(hasBackup).not.toHaveBeenCalled()
    expect(isDbRestorable).not.toHaveBeenCalled()
  })
})

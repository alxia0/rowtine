// @vitest-environment jsdom
// Unitaire — LE prédicat unique de pause (lot du 06/08/2026). Le critère
// « la sauvegarde est-elle en pause ? » était recalculé à QUATRE endroits ; ce fichier
// couvre la source de vérité désormais unique, `backupPauseReason`, et le mince
// adaptateur booléen `isBackupPaused` qui en découle.
//
// La distinction fiche ABSENTE / fiche ILLISIBLE est le point le plus délicat :
// « absente » = sauvegarde écrite AVANT ce lot, c'est-à-dire TOUTES celles qui
// existent aujourd'hui — les confondre bloquerait toutes les utilisatrices dès
// l'installation.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { hasBackup: true, decided: true, manifest: { state: 'absent' }, myId: 'moi' }
vi.mock('@/backup/restore', () => ({ hasBackup: async () => state.hasBackup }))
vi.mock('@/backup/backup-decision', () => ({ hasBackupDecision: async () => state.decided }))
vi.mock('@/backup/backup-manifest', () => ({ readManifest: async () => state.manifest }))
vi.mock('@/backup/device-identity', () => ({ deviceId: async () => state.myId }))

import { backupPauseReason, isBackupPaused } from '@/backup/backup-pause'

const storage = {}
beforeEach(() => {
  Object.assign(state, { hasBackup: true, decided: true, manifest: { state: 'absent' }, myId: 'moi' })
})

describe('backupPauseReason', () => {
  it('dossier VIDE → null (la première sauvegarde doit passer)', async () => {
    state.hasBackup = false
    expect(await backupPauseReason(storage)).toBeNull()
  })

  it('sauvegarde présente, aucune décision → "no-decision"', async () => {
    state.decided = false
    expect(await backupPauseReason(storage)).toBe('no-decision')
  })

  it('décision prise, fiche absente → null (toutes les sauvegardes d’avant ce lot)', async () => {
    expect(await backupPauseReason(storage)).toBeNull()
  })

  it('décision prise, fiche de CET appareil → null', async () => {
    state.manifest = { state: 'ok', manifest: { appareil: 'moi' } }
    expect(await backupPauseReason(storage)).toBeNull()
  })

  it('décision prise, fiche d’un AUTRE appareil → "other-device"', async () => {
    state.manifest = { state: 'ok', manifest: { appareil: 'autre' } }
    expect(await backupPauseReason(storage)).toBe('other-device')
  })

  it('fiche ILLISIBLE → "other-device" (repli prudent, on n’écrase pas dans le doute)', async () => {
    state.manifest = { state: 'invalid' }
    expect(await backupPauseReason(storage)).toBe('other-device')
  })

  it('pas de stockage → "no-decision" (comportement historique conservé)', async () => {
    expect(await backupPauseReason(null)).toBe('no-decision')
  })

  it('isBackupPaused reste vrai/faux et suit le prédicat', async () => {
    state.hasBackup = false
    expect(await isBackupPaused(storage)).toBe(false)
    state.hasBackup = true
    state.decided = false
    expect(await isBackupPaused(storage)).toBe(true)
  })
})

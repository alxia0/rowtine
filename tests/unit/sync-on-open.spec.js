// @vitest-environment jsdom
// Unitaire — synchro MD ciblée à l'ouverture d'un patron/projet (Lot N3). Toutes les
// dépendances impures sont mockées (Capacitor, backup-service, patron-md-sync,
// sync-report-decision, stores Pinia) : ce test vérifie UNIQUEMENT le câblage des
// gardes (natif / stockage / permission), l'attente de `whenSyncIdle`, le `{ only }`
// transmis et la règle « snackbar supprimée, modale conservée » — pas la logique de
// synchro/réconciliation elle-même (déjà couverte par patron-md-sync.spec.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSyncReportStore } from '@/stores/sync-report'

const capacitor = vi.hoisted(() => ({ isNativePlatform: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

const backupService = vi.hoisted(() => ({
  getBackupStorage: vi.fn(),
  getBackupPermissionOk: vi.fn(),
}))
vi.mock('@/backup/backup-service', () => backupService)

const patronMdSync = vi.hoisted(() => ({
  syncPatronMd: vi.fn(),
  whenSyncIdle: vi.fn(),
}))
vi.mock('@/backup/patron-md-sync', () => patronMdSync)

const syncReportDecision = vi.hoisted(() => ({ classifySyncReport: vi.fn() }))
vi.mock('@/backup/sync-report-decision', () => syncReportDecision)

const patternsStoreInstance = { kind: 'patterns-store' }
const projectsStoreInstance = { kind: 'projects-store' }
vi.mock('@/stores/patterns', () => ({ usePatternsStore: () => patternsStoreInstance }))
vi.mock('@/stores/projects', () => ({ useProjectsStore: () => projectsStoreInstance }))

vi.mock('@/db/db', () => ({ db: { marker: 'fake-db' } }))

const { syncPatronMdOnOpen } = await import('@/backup/sync-on-open')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  patronMdSync.whenSyncIdle.mockResolvedValue(undefined)
  syncReportDecision.classifySyncReport.mockReturnValue({ kind: 'none' })
})

describe('syncPatronMdOnOpen', () => {
  it('web (non natif) : ne fait rien, ni whenSyncIdle ni syncPatronMd jamais appelés', async () => {
    capacitor.isNativePlatform.mockReturnValue(false)

    await syncPatronMdOnOpen({ kind: 'pattern', id: 1 })

    expect(backupService.getBackupStorage).not.toHaveBeenCalled()
    expect(patronMdSync.whenSyncIdle).not.toHaveBeenCalled()
    expect(patronMdSync.syncPatronMd).not.toHaveBeenCalled()
  })

  it('pas de stockage désigné : synchro non lancée', async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    backupService.getBackupStorage.mockResolvedValue(null)

    await syncPatronMdOnOpen({ kind: 'pattern', id: 1 })

    expect(backupService.getBackupPermissionOk).not.toHaveBeenCalled()
    expect(patronMdSync.syncPatronMd).not.toHaveBeenCalled()
  })

  it("natif + stockage OK : n'appelle PLUS getBackupPermissionOk (redondant avec hasFolder déjà vérifié par getBackupStorage), attend whenSyncIdle PUIS appelle syncPatronMd avec { only }", async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    const storage = { kind: 'fake-storage' }
    backupService.getBackupStorage.mockResolvedValue(storage)
    backupService.getBackupPermissionOk.mockResolvedValue(true)

    // Ordre observable : whenSyncIdle DOIT être résolu avant que syncPatronMd ne
    // soit appelé (pas juste « les deux sont appelés », mais bien en séquence).
    const order = []
    patronMdSync.whenSyncIdle.mockImplementation(async () => {
      order.push('idle')
    })
    patronMdSync.syncPatronMd.mockImplementation(async () => {
      order.push('sync')
      return { merged: [], skipped: [], errors: [] }
    })

    await syncPatronMdOnOpen({ kind: 'project', id: 42 })

    // `storage` truthy garantit déjà hasFolder()==vrai (c'est le même appel IPC que
    // getBackupPermissionOk) : le rappeler ici referait inutilement l'appel SAF coûteux.
    expect(backupService.getBackupPermissionOk).not.toHaveBeenCalled()
    expect(order).toEqual(['idle', 'sync'])
    expect(patronMdSync.syncPatronMd).toHaveBeenCalledTimes(1)
    expect(patronMdSync.syncPatronMd).toHaveBeenCalledWith(
      storage,
      {
        db: { marker: 'fake-db' },
        patternsStore: patternsStoreInstance,
        projectsStore: projectsStoreInstance,
      },
      { only: { kind: 'project', id: 42 } },
    )
  })

  it('rapport CLEAN (kind: none/snackbar) : setReport du store NON appelé (pas de snackbar à l’ouverture)', async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    backupService.getBackupStorage.mockResolvedValue({ kind: 'fake-storage' })
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    const report = { merged: [{ kind: 'pattern', id: 1 }], skipped: [], errors: [] }
    patronMdSync.syncPatronMd.mockResolvedValue(report)
    syncReportDecision.classifySyncReport.mockReturnValue({ kind: 'snackbar', count: 1 })

    const setReportSpy = vi.spyOn(useSyncReportStore(), 'setReport')

    await syncPatronMdOnOpen({ kind: 'pattern', id: 1 })

    expect(syncReportDecision.classifySyncReport).toHaveBeenCalledWith(report)
    expect(setReportSpy).not.toHaveBeenCalled()
  })

  it('rapport à signaler (kind: modal — progression perdue/avertissement) : setReport EST appelé', async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    backupService.getBackupStorage.mockResolvedValue({ kind: 'fake-storage' })
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    const report = {
      merged: [{ kind: 'pattern', id: 1, reconcile: { doneLost: 1 }, warnings: [] }],
      skipped: [],
      errors: [],
    }
    patronMdSync.syncPatronMd.mockResolvedValue(report)
    syncReportDecision.classifySyncReport.mockReturnValue({ kind: 'modal' })

    await syncPatronMdOnOpen({ kind: 'pattern', id: 1 })

    expect(useSyncReportStore().report).toEqual(report)
  })

  it('syncPatronMd lève : se résout quand même (ne casse jamais l’ouverture), aucun rapport posé', async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    backupService.getBackupStorage.mockResolvedValue({ kind: 'fake-storage' })
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    patronMdSync.syncPatronMd.mockRejectedValue(new Error('boom'))

    await expect(syncPatronMdOnOpen({ kind: 'pattern', id: 1 })).resolves.toBeUndefined()
    expect(useSyncReportStore().report).toBeNull()
  })

  it('whenSyncIdle lève (ne devrait jamais arriver, whenSyncIdle ne rejette pas) : se résout quand même', async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    backupService.getBackupStorage.mockResolvedValue({ kind: 'fake-storage' })
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    patronMdSync.whenSyncIdle.mockRejectedValue(new Error('boom'))

    await expect(syncPatronMdOnOpen({ kind: 'pattern', id: 1 })).resolves.toBeUndefined()
    expect(patronMdSync.syncPatronMd).not.toHaveBeenCalled()
  })
})

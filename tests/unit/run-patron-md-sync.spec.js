// Unitaire — déclencheur de la synchro MD aux frontières de l'app.
// Toutes les dépendances impures sont mockées (Capacitor, backup-service,
// syncPatronMd, stores Pinia) : ce test vérifie UNIQUEMENT le câblage des gardes
// (natif / stockage / permission) et la remontée du rapport, pas la logique de
// synchro elle-même (déjà couverte par patron-md-sync.spec.js).
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

const patronMdSync = vi.hoisted(() => ({ syncPatronMd: vi.fn() }))
vi.mock('@/backup/patron-md-sync', () => patronMdSync)

// Instances de store bidon (pas besoin de vraies stores Pinia patterns/projects
// pour ce test de câblage — seule leur PRÉSENCE dans `deps` importe côté
// `syncPatronMd`, déjà testé ailleurs).
const patternsStoreInstance = { kind: 'patterns-store' }
const projectsStoreInstance = { kind: 'projects-store' }
vi.mock('@/stores/patterns', () => ({ usePatternsStore: () => patternsStoreInstance }))
vi.mock('@/stores/projects', () => ({ useProjectsStore: () => projectsStoreInstance }))

vi.mock('@/db/db', () => ({ db: { marker: 'fake-db' } }))

const { runPatronMdSync } = await import('@/backup/run-patron-md-sync')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('runPatronMdSync', () => {
  it('web (non natif) : ne fait rien, syncPatronMd jamais appelé', async () => {
    capacitor.isNativePlatform.mockReturnValue(false)

    await runPatronMdSync()

    expect(backupService.getBackupStorage).not.toHaveBeenCalled()
    expect(patronMdSync.syncPatronMd).not.toHaveBeenCalled()
  })

  it('natif + stockage désigné : synchro lancée une fois, rapport remonté au store, getBackupPermissionOk PLUS appelé (redondant avec hasFolder déjà vérifié par getBackupStorage)', async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    const storage = { kind: 'fake-storage' }
    backupService.getBackupStorage.mockResolvedValue(storage)
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    const report = { merged: [{ kind: 'pattern', id: 1 }], skipped: [], errors: [] }
    patronMdSync.syncPatronMd.mockResolvedValue(report)

    await runPatronMdSync()

    expect(backupService.getBackupPermissionOk).not.toHaveBeenCalled()
    expect(patronMdSync.syncPatronMd).toHaveBeenCalledTimes(1)
    expect(patronMdSync.syncPatronMd).toHaveBeenCalledWith(storage, {
      db: { marker: 'fake-db' },
      patternsStore: patternsStoreInstance,
      projectsStore: projectsStoreInstance,
    })
    expect(useSyncReportStore().report).toEqual(report)
  })

  it('pas de stockage désigné (web via getBackupStorage) : synchro non lancée', async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    backupService.getBackupStorage.mockResolvedValue(null)

    await runPatronMdSync()

    expect(backupService.getBackupPermissionOk).not.toHaveBeenCalled()
    expect(patronMdSync.syncPatronMd).not.toHaveBeenCalled()
  })

  it('syncPatronMd lève : runPatronMdSync se résout quand même (ne casse jamais le lancement)', async () => {
    capacitor.isNativePlatform.mockReturnValue(true)
    backupService.getBackupStorage.mockResolvedValue({ kind: 'fake-storage' })
    backupService.getBackupPermissionOk.mockResolvedValue(true)
    patronMdSync.syncPatronMd.mockRejectedValue(new Error('boom'))

    await expect(runPatronMdSync()).resolves.toBeUndefined()
    expect(useSyncReportStore().report).toBeNull() // pas de rapport posé si la synchro a échoué
  })

  it('setReport du store sync-report stocke bien le rapport reçu', () => {
    const store = useSyncReportStore()
    expect(store.report).toBeNull()
    const report = { merged: [], skipped: [], errors: [] }
    store.setReport(report)
    expect(store.report).toEqual(report)
  })
})

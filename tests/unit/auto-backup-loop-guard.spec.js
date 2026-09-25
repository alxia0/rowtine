// @vitest-environment jsdom
// Anti-boucle de bout en bout : l'écriture `setSetting('lastBackupAt')` de `runBackup` est une
// mutation vue par le hook Dexie global ; sans `suppressAutoBackup` autour de `runBackup`, elle
// armerait un second backup, puis un autre, sans fin. Vrai `db`, vrai hook, vrai `auto-backup`,
// vrai `runBackup` ; seules les IO sont mockées. Fake timers pour observer l'ABSENCE de second
// déclenchement après `wait` + `maxWait`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_BACKUP_MAX_WAIT_MS, AUTO_BACKUP_WAIT_MS } from '@/backup/auto-backup'
import { db } from '@/db/db'
import { runBackup } from '@/backup/backup-service'
// `runBackup` fait un `await import('./patron-md-sync')` paresseux. Le premier chargement d'un
// module ES demande un tour réel de la boucle d'événements, que les fake timers gèleraient
// (timeout) : on le charge ici, timers réels, pour que l'`import()` tape ensuite le cache.
import '@/backup/patron-md-sync'
// Même piège pour `./backup-pause`. `restore.js` et `backup-decision.js`, qu'il importe à son
// tour, sont déjà en cache via les imports statiques de `backup-service.js`.
import '@/backup/backup-pause'

const isNativePlatform = vi.hoisted(() => vi.fn())
// `registerPlugin` : la chaîne backup-service → backup-manifest → device-identity → saf-plugin
// l'appelle À L'ÉVALUATION. Sans cet export, le fichier ne se charge plus (« 0 test », aucun
// rouge) et la garde cesse de tourner en silence.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: (...a) => isNativePlatform(...a) },
  registerPlugin: () => ({}),
}))

const hasFolder = vi.hoisted(() => vi.fn())
vi.mock('@/backup/saf-folder', () => ({
  hasFolder: (...a) => hasFolder(...a),
}))

// `runBackup` passe par `isBackupPaused(storage)` → `storage.exists(...)`. Une classe vide
// ferait refermer cette garde (hors sujet ici) : `exists` renvoie `false`, « dossier vide »,
// donc elle laisse passer. Le chemin `recordBackupDecision` qui en découle n'écrit rien (pas de
// `folderKey` dans le mock), et même s'il écrivait, `suppressAutoBackup` couvre toute écriture
// faite pendant `runBackup`.
vi.mock('@/backup/saf-storage', () => ({
  SafBackupStorage: class {
    async exists() {
      return false
    }
  },
}))

const collectBackupData = vi.hoisted(() => vi.fn())
vi.mock('@/backup/collect', () => ({
  collectBackupData: (...a) => collectBackupData(...a),
}))

const backupAll = vi.hoisted(() => vi.fn())
vi.mock('@/backup/orchestrator', () => ({
  backupAll: (...a) => backupAll(...a),
}))

// Mock de `patron-md-sync` : l'`await import()` du vrai module (et le cycle
// backup-service↔patron-md-sync) ne se résoudrait pas sous fake timers, et la garde
// d'exclusion avec la synchro n'est pas le sujet ici (aucune synchro en cours : no-op).
vi.mock('@/backup/patron-md-sync', () => ({
  isSyncRunning: () => false,
  whenSyncIdle: () => Promise.resolve(),
}))

beforeEach(async () => {
  // Ouvrir/vider la DB (fake-indexeddb) AVANT d'activer les fake timers : Dexie
  // s'appuie en interne sur des micro/macro-tâches à l'ouverture, qui restent
  // sinon bloquées (timeout de hook) tant que personne n'avance les timers.
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  vi.useFakeTimers()
  isNativePlatform.mockReturnValue(true)
  hasFolder.mockResolvedValue(true)
  collectBackupData.mockResolvedValue({})
  backupAll.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Lot N3 — anti-boucle (Trap 1)', () => {
  it("l'écriture setSetting('lastBackupAt') dans runBackup n'arme pas un second backup débouncé", async () => {
    const resultPromise = runBackup()
    await vi.advanceTimersByTimeAsync(50)
    const result = await resultPromise
    expect(result).toEqual({ ok: true })
    expect(backupAll).toHaveBeenCalledTimes(1)

    // Sans `suppressAutoBackup`, l'écriture `lastBackupAt` aurait armé le hook Dexie et un
    // second `backupAll` serait parti après `wait` puis `maxWait`.
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS + AUTO_BACKUP_MAX_WAIT_MS)
    expect(backupAll).toHaveBeenCalledTimes(1)
  })

  // Protège : une écriture de l'utilisatrice PENDANT la sauvegarde (après la collecte) en arme une suivante.
  it("une mutation faite pendant l'écriture de la sauvegarde arme un nouveau passage", async () => {
    backupAll.mockClear()
    backupAll.mockImplementationOnce(async () => {
      await db.projects.add({ name: 'Rang 42 coché pendant l’écriture' })
    })
    const resultPromise = runBackup()
    await vi.advanceTimersByTimeAsync(50)
    expect(await resultPromise).toEqual({ ok: true })
    expect(backupAll).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS + AUTO_BACKUP_MAX_WAIT_MS)
    expect(backupAll).toHaveBeenCalledTimes(2)
  })
})

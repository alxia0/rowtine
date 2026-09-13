// Intégration — preuve BOUT EN BOUT de l'anti-boucle (Trap 1,
// cf. Contraintes globales). `runBackup` (backup-service) écrit
// `setSetting('lastBackupAt')`, qui est elle-même une mutation DB vue par le
// hook Dexie global (`src/db/db.js`). Sans la suppression (`suppressAutoBackup`
// enveloppant tout le corps de `runBackup`), cette écriture armerait un second
// backup débouncé qui, une fois déclenché, rappellerait `backupAll` — boucle
// infinie. Ce test exerce le VRAI pipeline (vrai `db`, vrai hook Dexie, vrai
// `auto-backup`, vrai `runBackup`) ; seules les dépendances d'IO (sélection de
// stockage, collecte, écriture réelle) sont mockées — même esprit que
// `backup-service.spec.js`, mais avec les fake timers pour observer l'ABSENCE
// de second déclenchement après `wait`+`maxWait`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_BACKUP_MAX_WAIT_MS, AUTO_BACKUP_WAIT_MS } from '@/backup/auto-backup'
import { db } from '@/db/db'
import { runBackup } from '@/backup/backup-service'
// `runBackup` fait un `await import('./patron-md-sync')` paresseux (garde
// anti-sync, correctif revue finale). Ce module doit être chargé AVANT
// `vi.useFakeTimers()` : le tout premier chargement d'un module ES demande un
// tour réel de la boucle d'événements que les fake timers gèleraient (→ timeout).
// On force le chargement ici (timers réels) pour que l'`import()` de prod tape
// ensuite le cache instantanément.
import '@/backup/patron-md-sync'
// Même piège pour `./backup-pause` (garde anti-écrasement, avenant 04/08/2026) :
// `runBackup` en fait désormais aussi un `await import('./backup-pause')`
// paresseux. `restore.js` et `backup-decision.js`, que `backup-pause.js`
// importe à son tour dynamiquement, n'ont pas besoin du même traitement : ils
// sont déjà importés STATIQUEMENT par `backup-service.js` ci-dessus (donc déjà
// en cache avant `vi.useFakeTimers()`) — seul le tout premier chargement d'un
// module pose problème, pas une résolution depuis le cache.
import '@/backup/backup-pause'

const isNativePlatform = vi.hoisted(() => vi.fn())
// `registerPlugin` (correctif du 06/08/2026) : désormais, `backup-service`
// importe `backup-manifest`, qui importe `device-identity`, qui importe `saf-plugin` —
// lequel appelle `registerPlugin('RowtineSaf')` À L'ÉVALUATION du module. Sans cet
// export, ce fichier entier cessait de se charger : « 0 test », donc AUCUN rouge, donc
// une garde anti-boucle qu'on croyait couverte et qui ne tournait plus du tout.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: (...a) => isNativePlatform(...a) },
  registerPlugin: () => ({}),
}))

const hasFolder = vi.hoisted(() => vi.fn())
vi.mock('@/backup/saf-folder', () => ({
  hasFolder: (...a) => hasFolder(...a),
}))

// Depuis la garde anti-écrasement (avenant 04/08/2026), `runBackup` appelle
// `isBackupPaused(storage)` → `hasBackup(storage)` → `storage.exists(...)`
// avant d'écrire. Une classe vide fait échouer l'appel à `exists` (méthode
// absente), et la garde se referme prudemment (`isBackupPaused` → `true`) —
// ce test ne porte pas sur cette garde (il est antérieur à elle) : `exists`
// renvoie `false` sur les quatre noms testés par `hasBackup`, donc « dossier
// vide, rien à protéger », donc la garde laisse passer, comme avant son
// introduction. Ce dossier « vide » fait aussi emprunter le chemin
// `recordBackupDecision` dans `runBackup` (folderWasEmpty === true) — vérifié
// sans conséquence pour CE test (espionnage temporaire de `db.settings.put`,
// retiré après coup) : `folderKey` n'est pas exporté par le mock de
// `@/backup/saf-folder` ci-dessous, donc `recordBackupDecision` échoue et
// n'écrit rien. Mais même si une version future du mock l'exportait,
// l'argument tiendrait quand même : tout `runBackup` tourne sous
// `suppressAutoBackup` (cf. auto-backup.js), qui couvre TOUTE écriture faite
// pendant son exécution, `lastBackupAt` comme une éventuelle
// `backupDecision` — aucune des deux ne peut réarmer le debounce.
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

// `runBackup` importe désormais dynamiquement `patron-md-sync` (garde d'exclusion
// mutuelle backup↔sync, correctif revue finale #2). On le mocke ici pour deux
// raisons : (1) éviter que l'`await import()` du vrai module — avec sa chaîne de
// dépendances et le cycle backup-service↔patron-md-sync — ne se résolve jamais
// sous fake timers ; (2) le guard n'est pas le sujet de CE test (Trap 1). Aucune
// synchro en cours → la garde est un no-op, le comportement observé est inchangé.
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

    // Sans `suppressAutoBackup` enveloppant runBackup, l'écriture `lastBackupAt`
    // ci-dessus aurait armé le hook Dexie → après `wait` puis `maxWait`, un
    // second `runBackup` (donc un second `backupAll`) aurait fini par se
    // déclencher tout seul. Avec la suppression en place, rien ne se réarme.
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS + AUTO_BACKUP_MAX_WAIT_MS)
    expect(backupAll).toHaveBeenCalledTimes(1)
  })
})

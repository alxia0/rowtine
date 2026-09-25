// @vitest-environment jsdom
// Intégration — preuve BOUT EN BOUT de l'anti-régénération
// (Trap 2, cf. contraintes globales). `syncPatronMd` (N2) écrit en DB
// (transaction projects/patterns + refresh de stores) quand elle fusionne un
// `patron.md` édité en externe. Cette écriture est vue par le hook Dexie
// global (`src/db/db.js`) : sans la suppression (`suppressAutoBackup`
// enveloppant la région d'écriture dans `processFolder`), elle armerait un
// backup débouncé qui, une fois déclenché, régénère `patron.md` depuis la DB
// et écraserait l'édition manuelle que la synchro vient précisément de
// préserver/intégrer. Ce test exerce le VRAI pipeline (vrai `db`, vrais
// stores Pinia, vrai `syncPatronMd`, vrai hook Dexie, vrai `auto-backup`) ;
// seul `runBackup` (backup-service) est mocké en boîte noire, pour observer
// s'il est appelé automatiquement après le merge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore } from '@/stores/projects'
import { collectBackupData } from '@/backup/collect'
import { backupAll } from '@/backup/orchestrator'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { entryFolderName } from '@/backup/naming'
import { patternToMd } from '@/utils/pattern-md'
import { syncPatronMd } from '@/backup/patron-md-sync'
import { AUTO_BACKUP_MAX_WAIT_MS, AUTO_BACKUP_WAIT_MS, flushAutoBackup } from '@/backup/auto-backup'

const runBackup = vi.hoisted(() => vi.fn())
vi.mock('@/backup/backup-service', () => ({
  runBackup: (...a) => runBackup(...a),
  isAutoBackupRunning: () => false,
}))

beforeEach(async () => {
  setActivePinia(createPinia())
  // Ouvrir/vider la DB (fake-indexeddb) AVANT d'activer les fake timers : cf.
  // auto-backup-loop-guard.spec.js — Dexie s'appuie en interne sur des
  // micro/macro-tâches à l'ouverture, bloquées tant que les timers ne sont
  // pas fake ou pas avancés.
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  vi.useFakeTimers()
  runBackup.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

// Le scénario ci-dessous enchaîne PLUSIEURS opérations réelles fake-indexeddb
// (store.add, syncPatronMd → lectures/écritures Dexie) qui restent, comme
// l'ouverture de `db`, tributaires de micro/macro-tâches internes bloquées
// sous fake timers tant que personne ne les avance. On exécute donc tout le
// scénario SOUS un avancement incrémental des fake timers (10 ms par pas,
// jusqu'à ce que le travail se termine) : ceci permet d'observer un backup
// débouncé qui s'armerait pendant le scénario (le but du test) sans pour
// autant bloquer les opérations DB internes qui en dépendent.
async function runDrivingFakeTimers(work) {
  let settled = false
  let result
  let error
  work().then(
    (r) => {
      result = r
      settled = true
    },
    (e) => {
      error = e
      settled = true
    },
  )
  for (let i = 0; i < 500 && !settled; i += 1) {
    await vi.advanceTimersByTimeAsync(10)
  }
  if (!settled) throw new Error('runDrivingFakeTimers: le travail ne s’est pas terminé à temps')
  if (error) throw error
  return result
}

describe('Lot N3 — anti-régénération (Trap 2)', () => {
  it("un merge syncPatronMd réussi n'arme PAS de sauvegarde automatique (n'écraserait pas le patron.md édité à la main)", async () => {
    const patternsStore = usePatternsStore()
    const projectsStore = useProjectsStore()

    const report = await runDrivingFakeTimers(async () => {
      const libId = await patternsStore.add({
        name: 'Écharpe Simple',
        type: 'knitting',
        author: 'Autrice',
        ownerProjectId: null,
        photos: [],
        gallery: [],
        pdf: '',
        reader: {
          sizeLabels: ['Unique'],
          sections: [{ id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'monter 40 mailles' }] }],
        },
      })

      const storage = new MemoryBackupStorage()
      // Sauvegarde initiale réelle (collect + backupAll NON mockés) : écrit
      // patron.md + patron.json avec témoin — le point de départ de la synchro.
      const snapshot = await collectBackupData()
      await backupAll(storage, snapshot)

      const dir = `Patrons/${entryFolderName('Écharpe Simple', libId)}`
      if (!(await storage.exists(`${dir}/patron.md`))) throw new Error('seed backup manquant')

      // La création du patron ci-dessus est une mutation DB ORDINAIRE (hors
      // suppression) : elle arme légitimement le hook Dexie — ce n'est PAS ce
      // que ce test vérifie. On la vide (flush) avant de mesurer l'effet
      // isolé du merge, pour ne pas confondre les deux armements.
      flushAutoBackup()
      await vi.advanceTimersByTimeAsync(0)
      runBackup.mockClear()

      // Édition externe (PC) : renomme la section.
      const seededPattern = await db.patterns.get(libId)
      const edited = {
        ...seededPattern,
        reader: {
          ...seededPattern.reader,
          sections: [{ ...seededPattern.reader.sections[0], title: 'Buste' }],
        },
      }
      const { md: editedMd } = patternToMd(edited, { assetDir: '', galleryPrefix: 'gallery-' })
      await storage.writeFile(`${dir}/patron.md`, editedMd, { encoding: 'utf8' })

      const deps = { db, patternsStore, projectsStore }
      return syncPatronMd(storage, deps)
    })

    expect(report.merged).toHaveLength(1)
    expect(report.errors).toEqual([])

    // Sans `suppressAutoBackup` enveloppant l'écriture DB de `processFolder`,
    // la transaction (projects/patterns) + le refresh de stores ci-dessus
    // auraient armé le hook Dexie → après `wait` puis `maxWait`, un
    // `runBackup` (mocké ici) aurait fini par se déclencher tout seul. Avec
    // la suppression en place, rien ne se réarme.
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS + AUTO_BACKUP_MAX_WAIT_MS)
    expect(runBackup).not.toHaveBeenCalled()
  })
})

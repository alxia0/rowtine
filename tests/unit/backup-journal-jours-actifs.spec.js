// @vitest-environment jsdom
// Unitaire — le JOURNAL DES JOURS ACTIFS survit à un aller-retour de sauvegarde (§7ter).
// Sans ce fichier, réinstaller l'application remettrait la série à ce que les seules séances
// racontent, alors que le guide promet « tu redésignes ce dossier, tout revient comme avant ».
// Chaîne complète, comme tests/unit/backup-restore.spec.js :
//   collectBackupData → backupAll (arbo) → readBackup (dbSnapshot) → writeSnapshotToDb (Dexie).
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/db/db'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { collectBackupData } from '@/backup/collect'
import { backupAll } from '@/backup/orchestrator'
import { readBackup, writeSnapshotToDb } from '@/backup/restore'
import { serializeActiveDays } from '@/backup/serialize'
import { allActiveDays } from '@/db/active-days'
import { currentStreak } from '@/utils/stats-grid'

const LE_11_AOUT = new Date(2026, 7, 11, 12, 0, 0)

beforeEach(async () => {
  await db.activeDays.clear()
  await db.projects.clear()
  await db.sessions.clear()
  await db.patterns.clear()
  await db.yarns.clear()
  await db.purchases.clear()
})

// Sauvegarde complète vers un stockage en mémoire, puis rend ce stockage.
async function sauvegarder() {
  const mem = new MemoryBackupStorage()
  await backupAll(mem, await collectBackupData())
  return mem
}

describe('sauvegarde du journal des jours actifs', () => {
  it("serializeActiveDays écrit `jours-actifs.json` et rien d'autre", () => {
    const f = serializeActiveDays([{ day: '2026-08-09' }, { day: '2026-08-10' }])
    expect(f.path).toBe('jours-actifs.json')
    expect(f.encoding).toBe('utf8')
    expect(JSON.parse(f.data)).toEqual([{ day: '2026-08-09' }, { day: '2026-08-10' }])
  })

  it('ALLER-RETOUR : une base portant trois jours actifs rend la MÊME série après restauration', async () => {
    // Trois jours consécutifs jusqu'au 11/08, sans AUCUNE séance : la série ne peut donc venir
    // que du journal. C'est ce qui fait mordre ce test — avec des séances, la série survivrait
    // même si `jours-actifs.json` n'était jamais écrit.
    await db.activeDays.bulkPut([{ day: '2026-08-09' }, { day: '2026-08-10' }, { day: '2026-08-11' }])
    expect(currentStreak(new Set(await allActiveDays()), LE_11_AOUT)).toBe(3) // garde-fou du test

    const mem = await sauvegarder()
    // Le fichier existe VRAIMENT dans l'arbo — sans cette assertion, un `readBackup` qui
    // retomberait sur un repli `[]` pourrait faire croire que le tour est joué.
    expect(await mem.exists('jours-actifs.json')).toBe(true)

    await db.activeDays.clear() // l'appareil « réinstallé »
    expect(await db.activeDays.count()).toBe(0)

    await writeSnapshotToDb(await readBackup(mem))

    expect((await allActiveDays()).sort()).toEqual(['2026-08-09', '2026-08-10', '2026-08-11'])
    expect(currentStreak(new Set(await allActiveDays()), LE_11_AOUT)).toBe(3)
    // ⚠️ Relecture PAR LA CLÉ, et pas seulement un `count()` : la clé primaire de `activeDays`
    // est `day` (clé « inbound »). Sondé : un `bulkPut(['2026-08-09'])` — des chaînes nues au
    // lieu d'objets `{ day }` — ne s'écrit PAS silencieusement ; IndexedDB lève
    // `DataError: Data provided to an operation does not meet requirements.` (le keyPath ne
    // résout à rien sur une chaîne) et la table reste à 0 ligne. Cette assertion n'est donc pas
    // le seul filet contre une régression de forme, mais elle reste de la défense en
    // profondeur utile : elle épingle la forme exacte de la ligne restaurée, indépendamment de
    // ce que `deserializeActiveDays` (un passe-plat) fait par ailleurs.
    expect(await db.activeDays.get('2026-08-09')).toEqual({ day: '2026-08-09' })
  })

  it('une sauvegarde ANCIENNE (sans `jours-actifs.json`) restaure sans erreur, journal vide', async () => {
    const mem = await sauvegarder()
    await mem.remove('jours-actifs.json') // l'arbo d'avant ces travaux
    expect(await mem.exists('jours-actifs.json')).toBe(false)
    await db.activeDays.bulkPut([{ day: '2026-08-11' }])

    await expect(writeSnapshotToDb(await readBackup(mem))).resolves.toBeUndefined()
    // La table est VIDÉE, pas laissée en place : restaurer remet l'appareil dans l'état de la
    // sauvegarde (décision 1 de cette tâche). La série retombe sur les seules séances.
    expect(await db.activeDays.count()).toBe(0)
  })

  it('restaurer une sauvegarde AVEC journal REMPLACE le journal local, il ne le complète pas', async () => {
    await db.activeDays.bulkPut([{ day: '2026-08-01' }])
    const mem = await sauvegarder()
    await db.activeDays.clear()
    await db.activeDays.bulkPut([{ day: '2026-12-25' }]) // un jour local ABSENT de la sauvegarde

    await writeSnapshotToDb(await readBackup(mem))

    expect(await allActiveDays()).toEqual(['2026-08-01'])
  })
})

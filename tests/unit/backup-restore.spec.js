// @vitest-environment jsdom
// Unitaire — restauration depuis l'arborescence de sauvegarde :
// `readBackup` (arbo → dbSnapshot), `writeSnapshotToDb` (dbSnapshot → Dexie), et
// `hasBackup`. Le test le plus important est le ROUND-TRIP DE BOUT EN BOUT :
// collect (S2) → backupAll (S2) → readBackup (S3) → writeSnapshotToDb (S3) →
// collect à nouveau = snapshot identique. C'est LE test qui prouve la fidélité
// S2 ↔ S3 (critère de succès #1 du lot : réinstallation + restauration retrouve TOUT).
import { describe, it, expect, beforeEach } from 'vitest'
import { db, setSetting } from '@/db/db'
import { collectBackupData } from '@/backup/collect'
import { backupAll } from '@/backup/orchestrator'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { hasBackup, readBackup, writeSnapshotToDb, MAX_BACKUP_FILE_BYTES } from '@/backup/restore'
import { entryFolderName } from '@/backup/naming'

const PHOTO_A = 'data:image/jpeg;base64,AAAA'
const PHOTO_B = 'data:image/png;base64,BBBB'
const PDF = 'data:application/pdf;base64,CCCC'
const YARN_PHOTO = 'data:image/webp;base64,DDDD'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

// Jeu de données riche : 2 projets (dont un projet "libre" relié au patron builtin),
// photos, sections/counters/sessions/diagrams embarqués, une instance de patron
// forkée, un patron de bibliothèque, le patron builtin, une laine avec photo inline,
// un compteur indépendant (projectId 0), plusieurs réglages (dont un secret exclu
// de la sauvegarde).
async function seedRichDb() {
  await db.patterns.bulkAdd([
    {
      id: 100,
      name: 'Modèle SABAI',
      ownerProjectId: null,
      photos: [PHOTO_A],
      pdf: PDF,
      category: 'pull',
      needleMm: '4.5',
      needleUs: '7',
      gaugeStitches: '22',
      gaugeRows: '28',
    },
    { id: 101, name: 'Libre', ownerProjectId: null, builtin: true, photos: [] },
    { id: 9, name: 'Torsade', ownerProjectId: 1, photos: [PHOTO_B], pdf: PDF },
  ])

  await db.projects.bulkAdd([
    {
      id: 1,
      name: 'Pull Torsadé',
      technique: 'aiguilles',
      patternId: 9,
      photos: [PHOTO_A, PHOTO_B],
      coverIndex: 1,
      activeSectionId: 12,
      status: 'in_progress',
    },
    {
      id: 2,
      name: 'Écharpe libre',
      technique: 'aiguilles',
      patternId: 101, // projet "libre" — relié au patron builtin
      photos: [],
      status: 'in_progress',
    },
  ])

  await db.sections.bulkAdd([
    { id: 12, projectId: 1, patternId: 9, name: 'Dos', order: 0 },
    { id: 13, projectId: 2, patternId: 101, name: 'Corps', order: 0 },
  ])

  await db.counters.bulkAdd([
    { id: 20, projectId: 1, name: 'Rangs', value: 5 },
    { id: 21, projectId: 0, name: 'Indépendant', value: 3 }, // compteur indépendant
  ])

  await db.sessions.bulkAdd([{ id: 30, projectId: 1, sectionId: 12, durationSec: 600, date: '2026-07-01' }])

  await db.diagrams.bulkAdd([{ id: 40, projectId: 1, patternId: 9, sectionId: 12 }])

  // Pool (nouveau modèle) : la laine porte reservations:{ [projectId]: qty } et
  // consumed:{ [projectId]: qty } (trace de consommation, K1) — déjà migrée, sinon
  // le round-trip lui ajouterait `consumed: {}` en cours de route et casserait
  // l'égalité snapshotA/snapshotB plus bas (rien à voir avec une vraie perte).
  // NON VIDE délibérément (2 pelotes déjà tricotées sur un ancien projet) : une trace
  // vide survivrait même si `serializeYarns` droppait le champ (readBackup le
  // recrée à {} par migration) — seule une valeur non vide prouve que le contenu
  // RÉEL de `consumed` traverse bien serialize→disque→deserialize sans perte.
  await db.yarns.bulkAdd([
    {
      id: 50,
      brand: 'Drops',
      weight: 'DK',
      quantity: 5,
      reservations: { 1: 2 },
      consumed: { 2: 3 },
      photo: YARN_PHOTO,
      composition: ['laine', 'soie'],
    },
  ])

  // Achat : ligne complète, TOUS les champs renseignés — le round-trip
  // ci-dessous compare le snapshot ENTIER (spread de `normalizeSnapshot`), donc
  // c'est ce fixture, pas une assertion écrite à la main, qui prouve la fidélité
  // champ à champ (date, bain, yarnLabel, kind, reconstructed compris) — revue,
  // point 3 : le test de bout en bout de backup-purchases.spec.js ne
  // vérifiait que 4 champs sur toMatchObject.
  await db.purchases.bulkAdd([
    {
      id: 200,
      yarnId: 50,
      yarnLabel: 'Drops · DK',
      quantity: 3,
      unitPrice: '6,50',
      currency: 'CHF',
      kind: 'buy',
      date: '2026-06-15',
      bain: 'AB123',
      reconstructed: false,
    },
  ])

  await setSetting('theme', 'clay')
  await setSetting('onboarded', true)
  await setSetting('lastBackupAt', '2026-07-02T10:00:00.000Z')
}

// Normalise l'ordre des tableaux (par id) pour une comparaison robuste, y compris
// dans les entités embarquées de chaque projet.
function sortById(arr) {
  return [...(arr || [])].sort((a, b) => a.id - b.id)
}
function normalizeSnapshot(snapshot) {
  return {
    ...snapshot,
    projects: sortById(snapshot.projects).map((p) => ({
      ...p,
      sections: sortById(p.sections),
      counters: sortById(p.counters),
      sessions: sortById(p.sessions),
      diagrams: sortById(p.diagrams),
    })),
    libraryPatterns: sortById(snapshot.libraryPatterns),
    yarns: sortById(snapshot.yarns),
    purchases: sortById(snapshot.purchases),
    independentCounters: sortById(snapshot.independentCounters),
    keepIds: {
      projects: [...(snapshot.keepIds.projects || [])].sort((a, b) => a - b),
      patterns: [...(snapshot.keepIds.patterns || [])].sort((a, b) => a - b),
    },
  }
}

describe('hasBackup', () => {
  it('faux sur un stockage vide', async () => {
    const mem = new MemoryBackupStorage()
    expect(await hasBackup(mem)).toBe(false)
  })

  it('vrai si Projets ou Patrons existe (créés même vides par backupAll)', async () => {
    const mem = new MemoryBackupStorage()
    await backupAll(mem, { projects: [], libraryPatterns: [], yarns: [], independentCounters: [], settings: {}, keepIds: {} })
    expect(await hasBackup(mem)).toBe(true)
  })

  it('vrai si laines.json ou reglages.json existe (sans dossiers Projets/Patrons)', async () => {
    const mem = new MemoryBackupStorage()
    await mem.writeFile('laines.json', '[]', { encoding: 'utf8' })
    expect(await hasBackup(mem)).toBe(true)

    const mem2 = new MemoryBackupStorage()
    await mem2.writeFile('reglages.json', '{}', { encoding: 'utf8' })
    expect(await hasBackup(mem2)).toBe(true)
  })
})

describe('readBackup — reconstruit le dbSnapshot depuis une arbo produite par S2', () => {
  it('reconstruit projets (+ embarqués + instance), patrons, laines, compteurs indépendants, settings', async () => {
    await seedRichDb()
    await setSetting('activeSession', 'peu importe') // exclu de la sauvegarde (serialize.js)
    const snapshot = await collectBackupData()
    const mem = new MemoryBackupStorage()
    await backupAll(mem, snapshot)

    const dbSnapshot = await readBackup(mem)

    expect(dbSnapshot.projects.map((p) => p.id).sort((a, b) => a - b)).toEqual([1, 2])
    const p1 = dbSnapshot.projects.find((p) => p.id === 1)
    expect(p1).toMatchObject({ name: 'Pull Torsadé', patternId: 9, photos: [PHOTO_A, PHOTO_B] })

    expect(dbSnapshot.sections.find((s) => s.id === 12)).toEqual({ id: 12, projectId: 1, patternId: 9, name: 'Dos', order: 0 })
    expect(dbSnapshot.counters.find((c) => c.id === 20)).toEqual({ id: 20, projectId: 1, name: 'Rangs', value: 5 })
    // Compteur indépendant inclus dans la même liste `counters`.
    expect(dbSnapshot.counters.find((c) => c.id === 21)).toEqual({ id: 21, projectId: 0, name: 'Indépendant', value: 3 })
    expect(dbSnapshot.sessions).toEqual([{ id: 30, projectId: 1, sectionId: 12, durationSec: 600, date: '2026-07-01' }])
    expect(dbSnapshot.diagrams).toEqual([{ id: 40, projectId: 1, patternId: 9, sectionId: 12 }])

    // Patrons : bibliothèque (100) + builtin (101) + instance forkée (9).
    const patternIds = dbSnapshot.patterns.map((p) => p.id).sort((a, b) => a - b)
    expect(patternIds).toEqual([9, 100, 101])
    expect(dbSnapshot.patterns.find((p) => p.id === 101).builtin).toBe(true)
    expect(dbSnapshot.patterns.find((p) => p.id === 9)).toMatchObject({ name: 'Torsade', ownerProjectId: 1, pdf: PDF })

    expect(dbSnapshot.yarns).toEqual([
      { id: 50, brand: 'Drops', weight: 'DK', quantity: 5, reservations: { 1: 2 }, consumed: { 2: 3 }, photo: YARN_PHOTO, composition: ['laine', 'soie'] },
    ])

    const settingsMap = Object.fromEntries(dbSnapshot.settings.map((s) => [s.key, s.value]))
    expect(settingsMap).toMatchObject({ theme: 'clay', onboarded: true, lastBackupAt: '2026-07-02T10:00:00.000Z' })
    // L'état volatil n'a jamais été écrit dans reglages.json (serialize.js) → absent ici.
    expect(settingsMap.activeSession).toBeUndefined()
  })

  it('arbo vide → dbSnapshot avec des tableaux vides', async () => {
    const mem = new MemoryBackupStorage()
    const dbSnapshot = await readBackup(mem)
    expect(dbSnapshot).toEqual({
      projects: [],
      patterns: [],
      sections: [],
      counters: [],
      sessions: [],
      diagrams: [],
      yarns: [],
      purchases: [],
      // Journal des jours actifs : `jours-actifs.json` absent → repli `[]`
      // (readBackup, §7ter), au même titre qu'achats.json.
      activeDays: [],
      hasPurchasesFile: false,
      settings: [],
    })
  })
})

describe('readBackup — photo manquante à la restauration : signalée, jamais remplacée en silence', () => {
  it('photo référencée par patron.json mais absente du dossier : consignée dans errors, patron restauré sans elle', async () => {
    const mem = new MemoryBackupStorage()
    const pattern = { id: 1, name: 'Test', photos: [PHOTO_A] }
    await backupAll(mem, {
      projects: [],
      libraryPatterns: [pattern],
      yarns: [],
      independentCounters: [],
      settings: {},
      keepIds: { projects: [], patterns: [1] },
    })

    // La photo a été écrite normalement par backupAll ; on simule sa disparition
    // (effacée à la main, écriture interrompue) en la retirant du disque APRÈS coup.
    const dir = `Patrons/${entryFolderName('Test', 1)}`
    const dirEntries = await mem.readdir(dir)
    const photoFile = dirEntries.find((e) => e.name.startsWith('photo-'))
    expect(photoFile).toBeDefined()
    await mem.remove(`${dir}/${photoFile.name}`)

    const dbSnapshot = await readBackup(mem)

    expect(dbSnapshot.patterns.find((p) => p.id === 1).photos).toEqual([])
    expect(dbSnapshot.errors).toContainEqual({ where: dir, code: 'missing-asset', file: photoFile.name })
  })
})

describe('readBackup — corbeille (items supprimés dont le dossier est conservé) — RÉGRESSION résurrection', () => {
  it("ignore un dossier de projet dont l'id est dans corbeille.json (ne ressuscite pas actif)", async () => {
    const mem = new MemoryBackupStorage()
    const project = {
      id: 7,
      name: 'Pull',
      photos: [],
      sections: [],
      counters: [],
      sessions: [],
      diagrams: [],
      instancePattern: null,
    }
    // 1er backup : projet actif — dossier + projet.json écrits sur disque.
    await backupAll(mem, {
      projects: [project],
      libraryPatterns: [],
      yarns: [],
      independentCounters: [],
      settings: {},
      keepIds: { projects: [7], patterns: [] },
    })
    // 2e backup : le projet passe en corbeille (soft-delete) — plus dans `projects`,
    // mais son id reste dans `keepIds` (dossier conservé, cf. `collect.js`/`orchestrator.js`)
    // ET apparaît maintenant dans `trashIds` → écrit dans corbeille.json.
    await backupAll(mem, {
      projects: [],
      libraryPatterns: [],
      yarns: [],
      independentCounters: [],
      settings: {},
      keepIds: { projects: [7], patterns: [] },
      trashIds: { projects: [7], patterns: [] },
    })
    // Le dossier (et son projet.json d'origine) est bien resté sur disque.
    expect(await mem.exists(`Projets/${entryFolderName('Pull', 7)}/projet.json`)).toBe(true)

    const dbSnapshot = await readBackup(mem)

    expect(dbSnapshot.projects.find((p) => p.id === 7)).toBeUndefined()
  })

  it("ignore un dossier de patron de bibliothèque dont l'id est dans corbeille.json", async () => {
    const mem = new MemoryBackupStorage()
    const pattern = { id: 3, name: 'Twist Loop', photos: [] }
    await backupAll(mem, {
      projects: [],
      libraryPatterns: [pattern],
      yarns: [],
      independentCounters: [],
      settings: {},
      keepIds: { projects: [], patterns: [3] },
    })
    await backupAll(mem, {
      projects: [],
      libraryPatterns: [],
      yarns: [],
      independentCounters: [],
      settings: {},
      keepIds: { projects: [], patterns: [3] },
      trashIds: { projects: [], patterns: [3] },
    })

    const dbSnapshot = await readBackup(mem)

    expect(dbSnapshot.patterns.find((p) => p.id === 3)).toBeUndefined()
  })

  it('tolère une sauvegarde sans corbeille.json (ancienne sauvegarde S2 pré-fix) — comportement inchangé', async () => {
    const mem = new MemoryBackupStorage()
    const project = {
      id: 7,
      name: 'Pull',
      photos: [],
      sections: [],
      counters: [],
      sessions: [],
      diagrams: [],
      instancePattern: null,
    }
    await backupAll(mem, {
      projects: [project],
      libraryPatterns: [],
      yarns: [],
      independentCounters: [],
      settings: {},
      keepIds: { projects: [7], patterns: [] },
    })
    await mem.remove('corbeille.json')

    const dbSnapshot = await readBackup(mem)

    expect(dbSnapshot.projects.find((p) => p.id === 7)).toBeDefined()
  })
})

describe('ROUND-TRIP DE BOUT EN BOUT — collect → backupAll → readBackup → writeSnapshotToDb → collect', () => {
  it('le 2e snapshot est identique au 1er (ids, photos, références patternId/ownerProjectId/reservations, patron builtin résolu)', async () => {
    await seedRichDb()

    const snapshotA = await collectBackupData()

    const mem = new MemoryBackupStorage()
    await backupAll(mem, snapshotA)

    const dbSnapshot = await readBackup(mem)

    // Base vidée entièrement (simule une réinstallation) avant restauration.
    await Promise.all(db.tables.map((t) => t.clear()))

    await writeSnapshotToDb(dbSnapshot)

    const snapshotB = await collectBackupData()

    expect(normalizeSnapshot(snapshotB)).toEqual(normalizeSnapshot(snapshotA))

    // Vérifications ciblées additionnelles (redondantes avec l'égalité globale,
    // mais explicites sur les points de fidélité critiques).
    const freeProject = snapshotB.projects.find((p) => p.id === 2)
    expect(freeProject.patternId).toBe(101)
    expect(snapshotB.libraryPatterns.find((p) => p.id === 101)?.builtin).toBe(true)
    const p1 = snapshotB.projects.find((p) => p.id === 1)
    expect(p1.instancePattern).toMatchObject({ id: 9, ownerProjectId: 1 })
    expect(p1.coverIndex).toBe(1)
    expect(snapshotB.yarns.find((y) => y.id === 50).reservations).toEqual({ 1: 2 })
    // Non vide délibérément (cf. seedRichDb) : prouve que le CONTENU de `consumed`
    // traverse serialize→disque→deserialize, pas seulement sa présence à {}.
    expect(snapshotB.yarns.find((y) => y.id === 50).consumed).toEqual({ 2: 3 })
    expect(snapshotB.yarns.find((y) => y.id === 50).photo).toBe(YARN_PHOTO)
    expect(snapshotB.yarns.find((y) => y.id === 50).composition).toEqual(['laine', 'soie'])
    const sabai = snapshotB.libraryPatterns.find((p) => p.id === 100)
    expect(sabai).toMatchObject({ needleMm: '4.5', needleUs: '7', gaugeStitches: '22', gaugeRows: '28' })
  })

  it('un item mis en corbeille (dossier conservé sur disque par la réconciliation) ne ressuscite PAS actif après restauration', async () => {
    await seedRichDb()
    const mem = new MemoryBackupStorage()

    // 1er backup : tout actif, y compris le projet 2 (Écharpe libre) — son dossier
    // est écrit sur disque.
    await backupAll(mem, await collectBackupData())
    expect(await mem.exists(`Projets/${entryFolderName('Écharpe libre', 2)}/projet.json`)).toBe(true)

    // Le projet 2 passe en corbeille (soft-delete), comme le ferait `useSoftDelete` :
    // retiré de `db.projects`/`db.sections`, ajouté à `db.trash`.
    const trashedProject = await db.projects.get(2)
    await db.projects.delete(2)
    await db.sections.where('projectId').equals(2).delete()
    await db.trash.add({
      type: 'project',
      payload: { project: trashedProject },
      name: trashedProject.name,
      deletedAt: '2026-07-02T00:00:00.000Z',
    })

    // 2e backup : la réconciliation garde le dossier (id encore dans keepIds via la
    // corbeille), et corbeille.json référence désormais son id (S2, ce lot).
    await backupAll(mem, await collectBackupData())
    expect(await mem.exists(`Projets/${entryFolderName('Écharpe libre', 2)}/projet.json`)).toBe(true)

    const dbSnapshot = await readBackup(mem)

    // Base vidée entièrement (simule une réinstallation) avant restauration.
    await Promise.all(db.tables.map((t) => t.clear()))
    await writeSnapshotToDb(dbSnapshot)

    // L'item supprimé par l'utilisateur reste supprimé — il ne doit PAS réapparaître
    // comme projet actif après une restauration (c'était le bug corrigé par ce lot).
    const finalProjects = await db.projects.toArray()
    expect(finalProjects.find((p) => p.id === 2)).toBeUndefined()
  })

  it('la corbeille (trash) est vidée par la restauration (non sauvegardée)', async () => {
    await seedRichDb()
    await db.trash.add({ type: 'pattern', payload: { id: 999 }, name: 'x', deletedAt: '2026-01-01T00:00:00.000Z' })

    const snapshotA = await collectBackupData()
    const mem = new MemoryBackupStorage()
    await backupAll(mem, snapshotA)
    const dbSnapshot = await readBackup(mem)

    await writeSnapshotToDb(dbSnapshot)

    expect(await db.trash.count()).toBe(0)
  })
})

describe('deserializeYarns — sauvegardes ANCIEN FORMAT (pré-migration pool) restent restaurables', () => {
  it('restaure une sauvegarde d’AVANT la migration (laine reservedFor) en la convertissant au pool', async () => {
    // laines.json d'une sauvegarde ancienne : scalaires reservedFor/reservedQty
    // (l'utilisatrice a des sauvegardes réelles sur disque dans ce format — jamais perdre l'info).
    const oldYarns = [{ id: 50, brand: 'Drops', colorName: 'Bleu', quantity: 5, reservedFor: 1, reservedQty: 2 }]
    const { deserializeYarns } = await import('@/backup/restore')
    expect(deserializeYarns(oldYarns)[0].reservations).toEqual({ 1: 2 })
    expect(deserializeYarns(oldYarns)[0].reservedFor).toBeUndefined()
    expect(deserializeYarns(oldYarns)[0].reservedQty).toBeUndefined()
  })

  it('sauvegarde déjà au nouveau format (reservations + consumed) : passthrough, rien à migrer', async () => {
    const newYarns = [{ id: 51, brand: 'Katia', quantity: 3, reservations: { 2: 1 }, consumed: {} }]
    const { deserializeYarns } = await import('@/backup/restore')
    expect(deserializeYarns(newYarns)).toEqual(newYarns)
  })

  // GARDE DE CÂBLAGE — les 2 tests ci-dessus appellent `deserializeYarns` en direct :
  // ils resteraient VERTS si quelqu'un recâblait `readBackup` sur l'import brut (non
  // migré). Celui-ci passe par les VRAIS points d'entrée de la restauration
  // (`readBackup` puis `writeSnapshotToDb`) et échoue si la migration est contournée.
  // C'est la contrainte dure du lot : les sauvegardes existantes de l'utilisatrice, sur disque
  // à l'ANCIEN format, doivent rester restaurables.
  it('une sauvegarde ANCIEN format sur disque se restaure en pool via readBackup → writeSnapshotToDb', async () => {
    await seedRichDb()
    const mem = new MemoryBackupStorage()
    await backupAll(mem, await collectBackupData())

    // On réécrit laines.json tel que l'aurait écrit la version d'AVANT la migration :
    // scalaires reservedFor/reservedQty, aucune clé `reservations`.
    const oldLaines = [{ id: 50, brand: 'Drops', colorName: 'Bleu', quantity: 5, reservedFor: 1, reservedQty: 2 }]
    await mem.writeFile('laines.json', JSON.stringify(oldLaines, null, 2), { encoding: 'utf8' })

    const dbSnapshot = await readBackup(mem)

    // Base vidée entièrement (simule une réinstallation) avant restauration.
    await Promise.all(db.tables.map((t) => t.clear()))
    await writeSnapshotToDb(dbSnapshot)

    const restored = await db.yarns.get(50)
    expect(restored.reservations).toEqual({ 1: 2 })
    expect(restored.reservedFor).toBeUndefined()
    expect(restored.reservedQty).toBeUndefined()
    // Cette sauvegarde est d'AVANT `consumed` (K1) : la migration doit quand même
    // poser le champ (patch minimal), sinon `consumedOf` planterait plus tard sur une
    // laine restaurée sans lui. Passe forcément par le VRAI câblage `readBackup` →
    // `writeSnapshotToDb` (pas `deserializeYarns` en direct, cf. commentaire du describe).
    expect(restored.consumed).toEqual({})
    // Le reste de la laine traverse intact (jamais perdre d'info).
    expect(restored).toMatchObject({ brand: 'Drops', colorName: 'Bleu', quantity: 5 })
  })
})

describe('writeSnapshotToDb — fusion des settings', () => {
  it('préserve une clé locale volatile (activeSession) absente de reglages.json', async () => {
    await setSetting('activeSession', 'ma-session-locale')
    await setSetting('onboarded', false) // sera écrasé par le snapshot restauré

    await writeSnapshotToDb({
      projects: [],
      patterns: [],
      sections: [],
      counters: [],
      sessions: [],
      diagrams: [],
      yarns: [],
      settings: [
        { key: 'theme', value: 'clay' },
        { key: 'onboarded', value: true },
      ],
    })

    expect(await db.settings.get('activeSession')).toEqual({ key: 'activeSession', value: 'ma-session-locale' })
    expect(await db.settings.get('theme')).toEqual({ key: 'theme', value: 'clay' })
    expect(await db.settings.get('onboarded')).toEqual({ key: 'onboarded', value: true })
  })

  it('remplace intégralement les autres tables (clear + bulkPut, ids préservés)', async () => {
    await db.projects.add({ id: 1, name: 'Ancien' })
    await db.yarns.add({ id: 5, brand: 'À remplacer' })

    await writeSnapshotToDb({
      projects: [{ id: 42, name: 'Nouveau' }],
      patterns: [],
      sections: [],
      counters: [],
      sessions: [],
      diagrams: [],
      yarns: [],
      settings: [],
    })

    expect(await db.projects.toArray()).toEqual([{ id: 42, name: 'Nouveau' }])
    expect(await db.yarns.toArray()).toEqual([])
  })
})

// Résidus d'écriture (`<nom>.part` du pont natif, `<nom>.tmp` de l'orchestrateur).
// Depuis que l'atomicité est UNIVERSELLE, un résidu peut porter n'importe quel nom de
// fichier, plus seulement celui d'un fichier lourd. `filesByName` est consulté PAR NOM
// et jamais énuméré : un résidu n'y sert donc à rien — mais sans filtre il est lu
// INTÉGRALEMENT, tranche par tranche, au moment le plus lent de l'app et sur
// l'appareil le plus faible.
describe('les résidus d’écriture ne sont ni lus ni restaurés', () => {
  beforeEach(async () => {
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('ignore <nom>.part et <nom>.tmp dans un dossier d’entrée, sans les lire', async () => {
    const storage = new MemoryBackupStorage()
    await db.projects.bulkAdd([{ id: 1, name: 'Pull', technique: 'aiguilles', photos: [PHOTO_A] }])
    await backupAll(storage, await collectBackupData())

    const dir = `Projets/${entryFolderName('Pull', 1)}`
    // Une photo à moitié écrite et un PDF à moitié copié, tels qu'une interruption les
    // laisse. Contenu volontairement NON décodable en base64 : s'il était lu, la
    // lecture lèverait — le test distingue donc « ignoré » de « lu puis inutilisé ».
    await storage.writeFile(`${dir}/photo-deadbeef.jpg.part`, '@@@ pas du base64 @@@')
    await storage.writeFile(`${dir}/original.pdf.tmp`, '@@@ pas du base64 @@@')

    const lus = []
    const espion = {
      ...storage,
      readdir: (p) => storage.readdir(p),
      exists: (p) => storage.exists(p),
      readFile: (p, o) => {
        lus.push(p)
        return storage.readFile(p, o)
      },
    }

    const snapshot = await readBackup(espion)
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0]).toMatchObject({ id: 1, name: 'Pull' })
    expect(lus.some((p) => /\.(part|tmp)$/i.test(p)), 'un résidu a été lu pour rien').toBe(false)
  })

  // Protège la restauration d'un fichier étranger ou démesuré déposé à la main (plantage WebView).
  it('ne lit ni un fichier étranger (vidéo) ni un fichier au-delà du plafond, et consigne le second', async () => {
    const storage = new MemoryBackupStorage()
    await db.projects.bulkAdd([{ id: 1, name: 'Pull', technique: 'aiguilles', photos: [PHOTO_A] }])
    await backupAll(storage, await collectBackupData())

    const dir = `Projets/${entryFolderName('Pull', 1)}`
    await storage.writeFile(`${dir}/film.mp4`, 'AAAA', { encoding: 'base64' })
    await storage.writeFile(`${dir}/photo-geante.jpg`, 'AAAA', { encoding: 'base64' })
    await storage.writeFile('Laines/film.mov', 'AAAA', { encoding: 'base64' })

    const lus = []
    const espion = {
      ...storage,
      // Taille annoncée par le stockage (readdir) : seule la photo géante dépasse le plafond.
      readdir: async (p) =>
        (await storage.readdir(p)).map((e) =>
          e.name === 'photo-geante.jpg' ? { ...e, size: MAX_BACKUP_FILE_BYTES + 1 } : e,
        ),
      exists: (p) => storage.exists(p),
      readFile: (p, o) => {
        lus.push(p)
        return storage.readFile(p, o)
      },
    }

    const snapshot = await readBackup(espion)
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0].photos).toEqual([PHOTO_A])
    expect(lus.filter((p) => /film\.(mp4|mov)$|photo-geante/.test(p))).toEqual([])
    expect(snapshot.errors).toEqual([expect.objectContaining({ where: dir, code: 'file-too-large', file: 'photo-geante.jpg' })])
  })
})

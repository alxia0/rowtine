// @vitest-environment jsdom
// Unitaire — orchestration impure de la synchro MD→DB. Storage en
// mémoire (`MemoryBackupStorage`) + DB/stores FAKES (maps en mémoire, API alignée sur
// Dexie réel : `.get`, `.filter(fn).toArray()`, store `.update(id, patch)`). Les
// fixtures `patron.md` sont produites par `buildPatternMdFiles` (même fonction que
// N1 utilise réellement à la sauvegarde) pour que le hash témoin et le texte du MD
// soient authentiques, pas des chaînes inventées à la main.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { buildPatternMdFiles } from '@/backup/pattern-md-file'
import { hash8 } from '@/backup/naming'
import { syncPatronMd, isSyncRunning, whenSyncIdle } from '@/backup/patron-md-sync'
import { isAutoBackupSuppressed } from '@/backup/auto-backup'
import { beginImport, endImport } from '@/backup/import-guard'
import { beginRestoreDecision, endRestoreDecision, clearFolderClean, markFolderClean } from '@/backup/restore-guard'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'

// Correctif revue (exclusion mutuelle backup↔sync) : `syncPatronMd`
// consulte `isAutoBackupRunning` (backup-service.js) à l'entrée pour ne jamais
// démarrer une synchro pendant qu'une sauvegarde touche encore le dossier SAF.
// Mocké ici en boîte noire (le reste de backup-service.js — Capacitor, SAF réel
// — n'est jamais sollicité dans ce fichier, qui n'utilise que MemoryBackupStorage).
const isAutoBackupRunning = vi.hoisted(() => vi.fn(() => false))
vi.mock('@/backup/backup-service', () => ({
  isAutoBackupRunning: (...a) => isAutoBackupRunning(...a),
}))

// Sans ce mock, `capReaderAssets` (branché dans patron-md-sync.js après
// `resolveReaderAssets`) appelle `new Image()` sous jsdom : `onload` ne se
// déclenche jamais réellement (pas de vrai décodage d'image), donc chaque
// promesse reste en attente et les tests de ce fichier timeout en cascade
// (et laissent `running` à `true` pour les suivants). Même geste que
// zip-import.spec.js/captures-pattern.spec.js pour la même famille de fonctions.
vi.mock('@/utils/image-resize', () => ({
  resizeDataUrl: async (d) => d,
  capDataUrlIfOversized: async (d) => d,
}))

function pat(id, name, sections, extra = {}) {
  return {
    id,
    name,
    type: 'knitting',
    author: 'Autrice',
    authorUrl: '',
    ownerProjectId: null,
    photos: [],
    gallery: [],
    pdf: '',
    reader: { sizeLabels: ['T'], sections },
    ...extra,
  }
}
const sec = (id, title, steps) => ({ id, kind: 'corps', title, steps })
const st = (t) => ({ t })

// Écrit un dossier « propre » (md + json cohérents, témoin correct) — état d'une
// sauvegarde N1 qui n'a pas encore été éditée en externe.
async function seedFolder(storage, dir, entity) {
  const { mdFile, assetFiles, hash } = buildPatternMdFiles(entity, dir)
  await storage.writeFile(mdFile.path, mdFile.data, { encoding: 'utf8' })
  for (const f of assetFiles) await storage.writeFile(f.path, f.data, { encoding: f.encoding })
  await storage.writeFile(
    `${dir}/patron.json`,
    JSON.stringify({ name: entity.name, patronMd: { hash } }, null, 2),
    { encoding: 'utf8' },
  )
  return hash
}

// Simule une édition externe : réécrit SEULEMENT patron.md (jamais patron.json), au
// format que produirait `editedEntity` — le témoin en base reste donc l'ancien hash.
async function editMdOnDisk(storage, dir, editedEntity) {
  const { mdFile } = buildPatternMdFiles(editedEntity, dir)
  await storage.writeFile(mdFile.path, mdFile.data, { encoding: 'utf8' })
}

// Compteur de lectures de `patron.json` : enveloppe `readFile` pour mesurer
// les lectures du GROS fichier (multi-mégaoctets — images inline en data URLs). Le
// chemin rapide du témoin DB doit en faire ZÉRO par dossier propre ; à installer
// APRÈS le seeding (qui n'écrit que) et avant la passe mesurée.
function countJsonReads(storage) {
  const counter = { jsonReads: 0 }
  const baseRead = storage.readFile.bind(storage)
  storage.readFile = async (path, opts) => {
    if (String(path).endsWith('/patron.json')) counter.jsonReads += 1
    return baseRead(path, opts)
  }
  return counter
}

// Fake DB + stores : maps en mémoire, API alignée sur Dexie (cf. src/db/db.js,
// src/stores/patterns.js, src/stores/projects.js) — `db.<table>.get(id)`,
// `db.<table>.update(id, patch)` (fusionne le patch dans l'entrée existante),
// `db.projects.filter(fn).toArray()` (utilisé pour le fan-out), et `db.transaction`
// (correctif revue — atomicité, cf. patron-md-sync.js) : shim minimal, le dernier
// argument est le callback, exécuté tel quel (`return await cb()`) — pas de vrai
// rollback simulé ici, cf. le test dédié qui vérifie les invariants OBSERVABLES
// dans le fake (témoin non touché, isolation des erreurs par dossier) plutôt que
// le rollback réel (garanti par Dexie en production).
function makeFakeDb(initialPatterns = [], initialProjects = []) {
  const patterns = new Map(initialPatterns.map((p) => [p.id, { ...p }]))
  const projects = new Map(initialProjects.map((p) => [p.id, { ...p }]))
  const db = {
    patterns: {
      get: vi.fn(async (id) => {
        const p = patterns.get(Number(id))
        return p ? { ...p } : undefined
      }),
      update: vi.fn(async (id, patch) => {
        const cur = patterns.get(Number(id))
        if (!cur) throw new Error(`patron ${id} introuvable`)
        patterns.set(Number(id), { ...cur, ...patch })
      }),
    },
    projects: {
      get: vi.fn(async (id) => {
        const p = projects.get(Number(id))
        return p ? { ...p } : undefined
      }),
      filter: (fn) => ({
        toArray: async () => Array.from(projects.values()).filter(fn).map((p) => ({ ...p })),
      }),
      update: vi.fn(async (id, patch) => {
        const cur = projects.get(Number(id))
        if (!cur) throw new Error(`projet ${id} introuvable`)
        projects.set(Number(id), { ...cur, ...patch })
      }),
    },
    transaction: vi.fn(async (...args) => {
      const cb = args[args.length - 1]
      return await cb()
    }),
  }
  const patternsStore = {
    update: vi.fn(async (id, data) => {
      const cur = patterns.get(Number(id)) || {}
      patterns.set(Number(id), { ...cur, ...data })
    }),
    load: vi.fn(async () => {}),
  }
  const projectsStore = {
    update: vi.fn(async (id, data) => {
      const cur = projects.get(Number(id)) || {}
      projects.set(Number(id), { ...cur, ...data })
    }),
    load: vi.fn(async () => {}),
  }
  return { db, patternsStore, projectsStore, patterns, projects }
}

describe('syncPatronMd', () => {
  it('dossier inchangé (hash = témoin) → rien à fusionner', async () => {
    const storage = new MemoryBackupStorage()
    const entity = pat(9, 'Torsade', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    const dir = 'Patrons/torsade [9]'
    await seedFolder(storage, dir, entity)
    const { db, patternsStore, projectsStore } = makeFakeDb([entity], [])

    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report).toEqual({ merged: [], skipped: [], errors: [] })
    expect(db.transaction).not.toHaveBeenCalled() // aucune écriture DB tentée (rien à fusionner)
  })

  it("MD édité d'un projet forké → patron mis à jour + readerState réconcilié + témoin mis à jour (2e passage = no-op)", async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Projets/pull [5]'
    const original = pat(20, 'Pull', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])], {
      ownerProjectId: 5,
    })
    await seedFolder(storage, dir, original)
    // Édition externe : insertion d'un step avant le step coché — la coche doit
    // suivre le TEXTE, pas l'index (cf. reconcile-reader-state.spec.js).
    const edited = pat(
      20,
      'Pull',
      [sec('corps', 'Corps', [st('monter'), st('NOUVEAU'), st('rang endroit')])],
      { ownerProjectId: 5 },
    )
    await editMdOnDisk(storage, dir, edited)

    const project = {
      id: 5,
      patternId: 20,
      readerState: { size: 0, done: { 'corps#1': true }, counters: {}, chartRow: 0 },
    }
    const { db, patternsStore, projectsStore, patterns, projects } = makeFakeDb([original], [project])

    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.errors).toEqual([])
    expect(report.skipped).toEqual([])
    expect(report.merged).toHaveLength(1)
    expect(report.merged[0]).toMatchObject({ kind: 'project', id: 5 })
    expect(report.merged[0].reconcile.doneKept).toBe(1)
    expect(report.merged[0].reconcile.doneLost).toBe(0)

    expect(patterns.get(20).reader.sections[0].steps.map((s) => s.t)).toEqual([
      'monter',
      'NOUVEAU',
      'rang endroit',
    ])
    expect(projects.get(5).readerState.done).toEqual({ 'corps#2': true })

    const patronJsonAfter = JSON.parse(await storage.readFile(`${dir}/patron.json`, { encoding: 'utf8' }))
    const mdAfter = await storage.readFile(`${dir}/patron.md`, { encoding: 'utf8' })
    expect(patronJsonAfter.patronMd.hash).toBe(hash8(mdAfter))

    // 2e passage : le fichier n'a plus bougé depuis, le témoin est à jour → no-op.
    // Et surtout SANS relire patron.json : le témoin DB (posé à la fin du
    // 1er passage, après le témoin disque) court-circuite la lecture lourde.
    db.transaction.mockClear()
    const counter = countJsonReads(storage)
    const report2 = await syncPatronMd(storage, { db, patternsStore, projectsStore })
    expect(report2).toEqual({ merged: [], skipped: [], errors: [] })
    expect(db.transaction).not.toHaveBeenCalled()
    expect(counter.jsonReads).toBe(0) // chemin rapide : zéro lecture du gros fichier
  })

  it("MD édité d'un patron de bibliothèque avec 2 projets liés → fan-out réconcilie les deux", async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Patrons/modele [30]'
    const original = pat(30, 'Modèle', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    await seedFolder(storage, dir, original)
    const edited = pat(30, 'Modèle', [
      sec('corps', 'Corps', [st('monter'), st('NOUVEAU'), st('rang endroit')]),
    ])
    await editMdOnDisk(storage, dir, edited)

    const projA = {
      id: 6,
      patternId: 30,
      readerState: { size: 0, done: { 'corps#1': true }, counters: {}, chartRow: 0 },
    }
    const projB = {
      id: 7,
      patternId: 30,
      readerState: { size: 0, done: { 'corps#1': true }, counters: {}, chartRow: 0 },
    }
    const { db, patternsStore, projectsStore, patterns, projects } = makeFakeDb(
      [original],
      [projA, projB],
    )

    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.merged).toHaveLength(1)
    expect(report.merged[0]).toMatchObject({ kind: 'pattern', id: 30 })
    expect(report.merged[0].reconcile.doneKept).toBe(2)
    expect(report.merged[0].reconcile.doneLost).toBe(0)
    expect(projects.get(6).readerState.done).toEqual({ 'corps#2': true })
    expect(projects.get(7).readerState.done).toEqual({ 'corps#2': true })
    expect(patterns.get(30).reader.sections[0].steps.map((s) => s.t)).toEqual([
      'monter',
      'NOUVEAU',
      'rang endroit',
    ])
  })

  it('fan-out : les pertes d’état de grille sont SOMMÉES dans le rapport agrégé (et plus de chartRowReset)', async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Patrons/modele [50]'
    const original = pat(50, 'Modèle', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    await seedFolder(storage, dir, original)
    // Édition externe quelconque (déclenche la fusion) — aucune grille dans le MD.
    const edited = pat(50, 'Modèle', [
      sec('corps', 'Corps', [st('monter'), st('NOUVEAU'), st('rang endroit')]),
    ])
    await editMdOnDisk(storage, dir, edited)

    // Deux projets liés, chacun avec un calage de grille sur une section qui n'est PAS
    // une grille dans le reader reparsé → chartFramesLost=1 par projet → agrégé à 2.
    const projA = {
      id: 8,
      patternId: 50,
      readerState: { size: 0, done: {}, counters: {}, chartFrames: { grilleFantome: { top: 0, bottom: 100 } } },
    }
    const projB = {
      id: 9,
      patternId: 50,
      readerState: { size: 0, done: {}, counters: {}, chartFrames: { grilleFantome: { top: 0, bottom: 100 } } },
    }
    const { db, patternsStore, projectsStore } = makeFakeDb([original], [projA, projB])

    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.merged).toHaveLength(1)
    expect(report.merged[0].reconcile.chartFramesLost).toBe(2)
    expect(report.merged[0].reconcile.chartRowsLost).toBe(0)
    expect(report.merged[0].reconcile.chartRepsLost).toBe(0)
    // L'ancien booléen n'existe plus dans le rapport agrégé.
    expect(report.merged[0].reconcile).not.toHaveProperty('chartRowReset')
  })

  it('MD tronqué (garde de dégénérescence) → skipped, interne conservé, témoin NON mis à jour', async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Patrons/riche [40]'
    const original = pat(40, 'Riche', [
      sec('corps', 'Corps', [st('monter'), st('rang endroit')]),
      sec('manche', 'Manche', [st('monter manche')]),
    ])
    const originalHash = await seedFolder(storage, dir, original)

    // Simule une édition externe qui tronque le fichier à son seul front-matter
    // (0 section reparsée alors que l'interne en a 2 → garde de dégénérescence).
    const mdBefore = await storage.readFile(`${dir}/patron.md`, { encoding: 'utf8' })
    const truncated = /^---\n[\s\S]*?\n---\n?/.exec(mdBefore)[0]
    await storage.writeFile(`${dir}/patron.md`, truncated, { encoding: 'utf8' })

    const { db, patternsStore, projectsStore, patterns } = makeFakeDb([original], [])
    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.merged).toEqual([])
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0]).toMatchObject({ kind: 'pattern', id: 40 })
    // `reason` est un avertissement STRUCTURÉ (code + params), traduit à l'affichage
    // (warningText) — jamais une chaîne composée ici.
    expect(report.skipped[0].reason).toMatchObject({ code: WARNING_CODES.MERGE_NO_SECTIONS })
    expect(db.transaction).not.toHaveBeenCalled() // garde de dégénérescence : aucune écriture tentée
    expect(patterns.get(40).reader.sections).toHaveLength(2) // interne conservé intact

    const patronJsonAfter = JSON.parse(await storage.readFile(`${dir}/patron.json`, { encoding: 'utf8' }))
    expect(patronJsonAfter.patronMd.hash).toBe(originalHash) // témoin NON touché
  })

  it('entité inconnue en base (dossier orphelin) → skipped, aucune création', async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Patrons/orphelin [999]'
    const entity = pat(999, 'Orphelin', [sec('corps', 'Corps', [st('monter')])])
    await seedFolder(storage, dir, entity)
    // Casse le témoin pour forcer le mismatch sans dépendre du hash réel calculé.
    await storage.writeFile(`${dir}/patron.json`, JSON.stringify({ name: entity.name }), {
      encoding: 'utf8',
    })

    const { db, patternsStore, projectsStore } = makeFakeDb([], []) // base vide : id 999 introuvable
    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.merged).toEqual([])
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0].folder).toBe(dir)
    // Le motif de saut est un CODE structuré (traduit à l'affichage,
    // warningText → SyncReportDialog) — l'ancienne phrase française en dur
    // « patron de bibliothèque inconnu en base (dossier orphelin) » ne voyage plus.
    expect(report.skipped[0].reason).toMatchObject({ code: WARNING_CODES.SYNC_ORPHAN_FOLDER })
    expect(db.transaction).not.toHaveBeenCalled() // dossier orphelin : aucune écriture tentée
  })

  it('projet sans patron lié → skipped avec code structuré SYNC_PROJECT_WITHOUT_PATTERN', async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Projets/sans-liaison [7]'
    const entity = pat(20, 'Orphelin', [sec('corps', 'Corps', [st('monter')])])
    await seedFolder(storage, dir, entity)
    // Casse le témoin (même geste que le test orphelin) : un dossier au témoin à jour est
    // conclu SANS changer de catégorie de rapport, erreur de résolution ou pas.
    await storage.writeFile(`${dir}/patron.json`, JSON.stringify({ name: entity.name }), {
      encoding: 'utf8',
    })

    const project = { id: 7, patternId: null } // projet présent mais sans patron lié
    const { db, patternsStore, projectsStore } = makeFakeDb([], [project])
    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.merged).toEqual([])
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0].reason).toMatchObject({ code: WARNING_CODES.SYNC_PROJECT_WITHOUT_PATTERN })
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('projet non forké (patron.md résiduel) → skipped avec code structuré SYNC_NO_FORKED_PATTERN', async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Projets/residuel [7]'
    const entity = pat(20, 'Bibliothèque', [sec('corps', 'Corps', [st('monter')])]) // ownerProjectId: null
    await seedFolder(storage, dir, entity)
    await storage.writeFile(`${dir}/patron.json`, JSON.stringify({ name: entity.name }), {
      encoding: 'utf8',
    })

    // Le projet pointe le patron 20, mais celui-ci n'est PAS le fork du projet 7
    // (patron de bibliothèque partagé) : le patron.md du dossier n'est l'instance de
    // personne, on ne fusionne pas dessus.
    const project = { id: 7, patternId: 20 }
    const { db, patternsStore, projectsStore } = makeFakeDb([entity], [project])
    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.merged).toEqual([])
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0].reason).toMatchObject({ code: WARNING_CODES.SYNC_NO_FORKED_PATTERN })
    expect(db.transaction).not.toHaveBeenCalled()
  })

  // Libellé `chart.repeat` : le format Rowtine-MD ne peut pas le transporter
  // (serialize.js n'a aucune place pour lui, parse.js le laisse vide), donc une fusion
  // MD→DB remplace le reader ENTIER et perd le libellé porté par l'interne. Préservation
  // exclue (changerait le format sur disque) : la perte doit au minimum cesser d'être
  // silencieuse — un avertissement structuré rejoint le rapport de synchro.
  it('libellé chart.repeat porté par l’interne + fusion effective → avertissement CHART_REPEAT_LABEL_LOST', async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Patrons/demo-de [30]'
    const chart = (repeat) => ({
      rows: 24,
      cols: 8,
      img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      readDir: 'rtl',
      ...(repeat ? { repeat } : {}),
    })
    const build = (steps) => {
      const sections = [sec('corps', 'Corps', steps)]
      return { ...pat(30, 'Demo', sections), reader: { sizeLabels: ['T'], sections, chart: chart('8 M × 24 Reihen') } }
    }
    const original = build([st('monter'), { chart: true }, st('rang endroit')])
    await seedFolder(storage, dir, original)
    // Édition externe sans rapport avec le diagramme : le MD regénéré n'a JAMAIS porté le
    // libellé, donc la fusion le perd — elle doit le dire. L'édité porte repeat: '' (ce que
    // rendrait un aller-retour MD du libellé, cf. parse.js).
    const editedSections = [sec('corps', 'Corps', [st('monter'), { chart: true }, st('NOUVEAU'), st('rang endroit')])]
    const edited = { ...pat(30, 'Demo', editedSections), reader: { sizeLabels: ['T'], sections: editedSections, chart: chart('') } }
    await editMdOnDisk(storage, dir, edited)

    const { db, patternsStore, projectsStore, patterns } = makeFakeDb([original], [])
    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.errors).toEqual([])
    expect(report.merged).toHaveLength(1)
    expect(report.merged[0].warnings).toEqual([expect.objectContaining({ code: WARNING_CODES.CHART_REPEAT_LABEL_LOST })])
    // La perte documentée est RÉELLE : le reader fusionné n'a plus le libellé (l'affichage
    // le reconstruit via chartMotifLabel, src/utils/reader.js).
    expect(patterns.get(30).reader.chart.repeat).toBe('')
  })

  // Protège la synchro d'un gros fichier déposé à la main : seuls les fichiers référencés par le MD sont lus, sous plafond.
  it('ne lit que les images référencées par le MD, et aucune au-delà du plafond', async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Patrons/demo-de [31]'
    const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const build = (steps, chartImg) => {
      const sections = [sec('corps', 'Corps', steps)]
      return { ...pat(31, 'Demo', sections), reader: { sizeLabels: ['T'], sections, chart: { rows: 2, cols: 2, img: chartImg, readDir: '' } } }
    }
    const original = build([st('monter'), { chart: true }], img)
    await seedFolder(storage, dir, original)
    await editMdOnDisk(storage, dir, build([st('monter'), { chart: true }, st('NOUVEAU')], img))
    await storage.writeFile(`${dir}/film.mp4`, 'AAAA', { encoding: 'base64' })
    await storage.writeFile(`${dir}/original.pdf`, 'AAAA', { encoding: 'base64' })

    const lus = []
    const baseRead = storage.readFile.bind(storage)
    storage.readFile = async (path, opts) => {
      lus.push(String(path))
      return baseRead(path, opts)
    }
    const { db, patternsStore, projectsStore, patterns } = makeFakeDb([original], [])
    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.merged).toHaveLength(1)
    expect(patterns.get(31).reader.chart.img).toMatch(/^data:image\/png;base64,/)
    expect(lus.filter((p) => /film\.mp4$|original\.pdf$/.test(p))).toEqual([])

    // Même dossier, image référencée annoncée au-delà du plafond : non lue, signalée manquante.
    const chartFile = (await storage.readdir(dir)).find((e) => /\.png$/.test(e.name)).name
    const baseReaddir = storage.readdir.bind(storage)
    storage.readdir = async (p) =>
      (await baseReaddir(p)).map((e) => (e.name === chartFile ? { ...e, size: 64 * 1024 * 1024 + 1 } : e))
    await editMdOnDisk(storage, dir, build([st('monter'), { chart: true }, st('ENCORE')], img))
    lus.length = 0
    const second = await syncPatronMd(storage, { db, patternsStore, projectsStore })
    expect(lus.filter((p) => p.endsWith(chartFile))).toEqual([])
    expect(second.merged[0].missingAssets).toContain(chartFile)
  })

  it('fusion refusée (MD tronqué) → AUCUN avertissement repeatLabelLost (interne conservé, rien n’est perdu)', async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Patrons/riche-chart [41]'
    const sections = [sec('corps', 'Corps', [st('monter'), st('rang endroit')]), sec('manche', 'Manche', [st('monter manche')])]
    const original = {
      ...pat(41, 'Riche', sections),
      reader: {
        sizeLabels: ['T'],
        sections,
        chart: { rows: 10, cols: 5, img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', repeat: '8 M × 24 Reihen', readDir: '' },
      },
    }
    await seedFolder(storage, dir, original)
    const mdBefore = await storage.readFile(`${dir}/patron.md`, { encoding: 'utf8' })
    await storage.writeFile(`${dir}/patron.md`, /^---\n[\s\S]*?\n---\n?/.exec(mdBefore)[0], { encoding: 'utf8' })

    const { db, patternsStore, projectsStore } = makeFakeDb([original], [])
    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.skipped).toHaveLength(1) // garde de dégénérescence : l'interne est conservé
    expect(report.skipped[0].warnings.filter((w) => w.code === WARNING_CODES.CHART_REPEAT_LABEL_LOST)).toEqual([])
    expect(report.merged).toEqual([])
  })

  it('fusion sans libellé chart.repeat → aucun avertissement repeatLabelLost', async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Patrons/simple [52]'
    const original = pat(52, 'Simple', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    await seedFolder(storage, dir, original)
    const edited = pat(52, 'Simple', [sec('corps', 'Corps', [st('monter'), st('NOUVEAU'), st('rang endroit')])])
    await editMdOnDisk(storage, dir, edited)

    const { db, patternsStore, projectsStore } = makeFakeDb([original], [])
    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.merged).toHaveLength(1)
    expect(report.merged[0].warnings).toEqual([])
  })

  it('un dossier cassé (JSON invalide) → errors[], les autres dossiers sont quand même traités', async () => {
    const storage = new MemoryBackupStorage()
    await storage.writeFile('Patrons/corrompu [50]/patron.md', '---\nrowtine: 1\ntailles: T\n---\n', {
      encoding: 'utf8',
    })
    await storage.writeFile('Patrons/corrompu [50]/patron.json', '{ ceci n’est pas du JSON', {
      encoding: 'utf8',
    })

    const dirSain = 'Patrons/sain [51]'
    const original = pat(51, 'Sain', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    await seedFolder(storage, dirSain, original)
    const edited = pat(51, 'Sain (édité)', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    await editMdOnDisk(storage, dirSain, edited)

    const { db, patternsStore, projectsStore, patterns } = makeFakeDb([original], [])
    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report.errors).toHaveLength(1)
    expect(report.errors[0].folder).toBe('Patrons/corrompu [50]')
    expect(report.merged).toHaveLength(1)
    expect(report.merged[0].id).toBe(51)
    expect(patterns.get(51).name).toBe('Sain (édité)')
  })

  it("écriture DB du patron en échec (transaction) → error consignée, témoin NON mis à jour, les autres dossiers traités quand même", async () => {
    const storage = new MemoryBackupStorage()

    // Dossier dont l'écriture DB va échouer (fake `db.patterns.update` piégé sur cet id).
    const dirEchoue = 'Patrons/echoue [60]'
    const original60 = pat(60, 'Échoue', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    const originalHash60 = await seedFolder(storage, dirEchoue, original60)
    const edited60 = pat(60, 'Échoue', [
      sec('corps', 'Corps', [st('monter'), st('NOUVEAU'), st('rang endroit')]),
    ])
    await editMdOnDisk(storage, dirEchoue, edited60)

    // Dossier sain traité dans le même passage — doit fusionner normalement malgré
    // l'échec du dossier précédent (isolation par dossier, cf. try/catch appelant).
    const dirSain = 'Patrons/sain [61]'
    const original61 = pat(61, 'Sain', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    await seedFolder(storage, dirSain, original61)
    const edited61 = pat(61, 'Sain (édité)', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    await editMdOnDisk(storage, dirSain, edited61)

    const { db, patternsStore, projectsStore, patterns } = makeFakeDb([original60, original61], [])
    const baseUpdate = db.patterns.update.getMockImplementation()
    db.patterns.update = vi.fn(async (id, patch) => {
      if (Number(id) === 60) throw new Error('boom : écriture patron 60 en échec')
      return baseUpdate(id, patch)
    })

    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    // (a) le dossier en échec est consigné dans errors, pas dans skipped/merged.
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0].folder).toBe(dirEchoue)
    expect(report.merged.some((m) => m.id === 60)).toBe(false)

    // (b) le témoin du dossier en échec n'a PAS bougé (pas de fausse progression).
    const patronJsonAfter = JSON.parse(
      await storage.readFile(`${dirEchoue}/patron.json`, { encoding: 'utf8' }),
    )
    expect(patronJsonAfter.patronMd.hash).toBe(originalHash60)

    // (c) l'autre dossier du même passage a bien été fusionné.
    expect(report.merged).toHaveLength(1)
    expect(report.merged[0].id).toBe(61)
    expect(patterns.get(61).name).toBe('Sain (édité)')
  })

  it('garde in-progress : un 2e appel concurrent renvoie { skipped: "running" }', async () => {
    const storage = new MemoryBackupStorage()
    const { db, patternsStore, projectsStore } = makeFakeDb([], [])

    const p1 = syncPatronMd(storage, { db, patternsStore, projectsStore })
    const r2 = await syncPatronMd(storage, { db, patternsStore, projectsStore })
    expect(r2).toEqual({ skipped: 'running' })

    const r1 = await p1
    expect(r1).toEqual({ merged: [], skipped: [], errors: [] })
    expect(isSyncRunning()).toBe(false)
  })

  it('garde exclusion mutuelle : backup en cours (isAutoBackupRunning) → { skipped: "backup-running" }, aucun scan effectué', async () => {
    isAutoBackupRunning.mockReturnValue(true)
    const storage = new MemoryBackupStorage()
    const readdirSpy = vi.spyOn(storage, 'readdir')
    const { db, patternsStore, projectsStore } = makeFakeDb([], [])

    const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

    expect(report).toEqual({ skipped: 'backup-running' })
    expect(readdirSpy).not.toHaveBeenCalled()
    expect(isSyncRunning()).toBe(false) // n'est jamais entrée en section critique
  })

  it('garde import↔synchro : écran d\'import ouvert (isImportRunning) → { skipped: "import-running" }, aucun scan effectué', async () => {
    beginImport()
    try {
      const storage = new MemoryBackupStorage()
      const readdirSpy = vi.spyOn(storage, 'readdir')
      const { db, patternsStore, projectsStore } = makeFakeDb([], [])

      const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

      expect(report).toEqual({ skipped: 'import-running' })
      expect(readdirSpy).not.toHaveBeenCalled()
      expect(isSyncRunning()).toBe(false) // n'est jamais entrée en section critique
    } finally {
      endImport()
    }
  })

  // Garde décision en attente (lot « restauration lourde », 06/09/2026) : la modale
  // Restaurer/Perdre est précédée d'un cycle pause/resume (retour du sélecteur SAF),
  // et le listener `resume` d'App.vue relance une synchro MD PENDANT que la modale
  // attend — sans garde, elle lit intégralement patron.md et patron.json pour rien
  // (~88 s de requêtes SAF mesurées). Symétrique exact du test import-running
  // ci-dessus : drapeau posé → éconduite SANS scanner, et jamais entrée en section
  // critique (isSyncRunning reste faux).
  it('garde décision en attente : modale Restaurer/Perdre ouverte (isRestoreDecisionPending) → { skipped: "decision-pending" }, aucun scan effectué', async () => {
    beginRestoreDecision()
    try {
      const storage = new MemoryBackupStorage()
      const readdirSpy = vi.spyOn(storage, 'readdir')
      const { db, patternsStore, projectsStore } = makeFakeDb([], [])

      const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

      expect(report).toEqual({ skipped: 'decision-pending' })
      expect(readdirSpy).not.toHaveBeenCalled()
      expect(isSyncRunning()).toBe(false) // n'est jamais entrée en section critique
    } finally {
      endRestoreDecision()
    }
  })

  // Garde « dossier propre depuis la restauration » (même lot, 06/09) : la
  // restauration vient de lire TOUT l'arborescence et d'écrire la base à son image ;
  // tant qu'aucune mutation locale n'a eu lieu (toute écriture efface le drapeau via
  // le hook Dexie de db.js), un passage ne lirait que du déjà-lu — mesuré 06/09 :
  // des centaines de secondes de requêtes SAF pour un résultat identique. Symétrique
  // exact des deux gardes ci-dessus : drapeau posé → éconduite SANS scanner, jamais
  // entrée en section critique.
  it('garde dossier propre : restauration terminée cette session (isFolderCleanSinceRestore) → { skipped: "folder-clean" }, aucun scan effectué', async () => {
    markFolderClean()
    try {
      const storage = new MemoryBackupStorage()
      const readdirSpy = vi.spyOn(storage, 'readdir')
      const { db, patternsStore, projectsStore } = makeFakeDb([], [])

      const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

      expect(report).toEqual({ skipped: 'folder-clean' })
      expect(readdirSpy).not.toHaveBeenCalled()
      expect(isSyncRunning()).toBe(false) // n'est jamais entrée en section critique
    } finally {
      clearFolderClean()
    }
  })

  it("{ only } cible un seul dossier : les 2 autres (même racine et racine opposée) ne sont pas touchés", async () => {
    const storage = new MemoryBackupStorage()

    const dirA = 'Patrons/alpha [70]'
    const originalA = pat(70, 'Alpha', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    const hashA = await seedFolder(storage, dirA, originalA)
    await editMdOnDisk(
      storage,
      dirA,
      pat(70, 'Alpha (édité)', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])]),
    )

    const dirB = 'Patrons/beta [71]'
    const originalB = pat(71, 'Beta', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
    const hashB = await seedFolder(storage, dirB, originalB)
    await editMdOnDisk(
      storage,
      dirB,
      pat(71, 'Beta (édité)', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])]),
    )

    const dirP = 'Projets/gamma [72]'
    const originalP = pat(80, 'Gamma', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])], {
      ownerProjectId: 72,
    })
    const hashP = await seedFolder(storage, dirP, originalP)
    await editMdOnDisk(
      storage,
      dirP,
      pat(80, 'Gamma (édité)', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])], {
        ownerProjectId: 72,
      }),
    )
    const projectGamma = { id: 72, patternId: 80, readerState: { size: 0, done: {}, counters: {}, chartRow: 0 } }

    const { db, patternsStore, projectsStore, patterns } = makeFakeDb(
      [originalA, originalB, originalP],
      [projectGamma],
    )
    const readdirSpy = vi.spyOn(storage, 'readdir')

    const report = await syncPatronMd(
      storage,
      { db, patternsStore, projectsStore },
      { only: { kind: 'pattern', id: 70 } },
    )

    // Seul le dossier ciblé est fusionné.
    expect(report.merged).toHaveLength(1)
    expect(report.merged[0]).toMatchObject({ kind: 'pattern', id: 70 })
    expect(patterns.get(70).name).toBe('Alpha (édité)')

    // Les 2 autres dossiers (même racine `Patrons/` ET racine opposée `Projets/`)
    // ne sont pas touchés : ni l'entité DB, ni le témoin sur disque.
    expect(patterns.get(71).name).toBe('Beta')
    expect(patterns.get(80).name).toBe('Gamma')
    const jsonB = JSON.parse(await storage.readFile(`${dirB}/patron.json`, { encoding: 'utf8' }))
    expect(jsonB.patronMd.hash).toBe(hashB)
    const jsonP = JSON.parse(await storage.readFile(`${dirP}/patron.json`, { encoding: 'utf8' }))
    expect(jsonP.patronMd.hash).toBe(hashP)

    // La racine `Projets/` n'est même pas scannée (kind:'pattern' → seul `Patrons/`).
    expect(readdirSpy).not.toHaveBeenCalledWith('Projets')

    const jsonA = JSON.parse(await storage.readFile(`${dirA}/patron.json`, { encoding: 'utf8' }))
    expect(jsonA.patronMd.hash).not.toBe(hashA) // le dossier ciblé, lui, a bien été mis à jour
  })

  it("{ only } côté 'project' : ne scanne que Projets/, pas Patrons/", async () => {
    const storage = new MemoryBackupStorage()
    const dir = 'Projets/pull [90]'
    const original = pat(90, 'Pull', [sec('corps', 'Corps', [st('monter')])], { ownerProjectId: 90 })
    await seedFolder(storage, dir, original)
    await editMdOnDisk(
      storage,
      dir,
      pat(90, 'Pull (édité)', [sec('corps', 'Corps', [st('monter')])], { ownerProjectId: 90 }),
    )
    const project = { id: 90, patternId: 90, readerState: { size: 0, done: {}, counters: {}, chartRow: 0 } }
    const { db, patternsStore, projectsStore, patterns } = makeFakeDb([original], [project])
    const readdirSpy = vi.spyOn(storage, 'readdir')

    const report = await syncPatronMd(
      storage,
      { db, patternsStore, projectsStore },
      { only: { kind: 'project', id: 90 } },
    )

    expect(report.merged).toHaveLength(1)
    expect(patterns.get(90).name).toBe('Pull (édité)')
    expect(readdirSpy).not.toHaveBeenCalledWith('Patrons')
  })

  // -----------------------------------------------------------------------
  // Témoin DB `patronMdSyncHash` + chemin rapide. L'entité porte le
  // hash du dernier `patron.md` auquel CETTE base est alignée : si le hash du
  // md sur disque l'égalé, la synchro retourne sans relire `patron.json`
  // (multi-mégaoctets). Points de sécurité testés ici : ordre d'écriture
  // STRICT (témoin disque PUIS témoin DB, jamais l'inverse — sinon un échec
  // disque ferait skipper à jamais la fusion = perte silencieuse), guérison
  // du témoin DB à l'early-return existant, et toute écriture du témoin sous
  // `suppressAutoBackup` (sinon le hook Dexie armerait un auto-backup inutile).
  describe('témoin DB patronMdSyncHash — chemin rapide', () => {
    it('dossier propre avec témoin DB valide → zéro lecture de patron.json (passe complète ET { only })', async () => {
      const storage = new MemoryBackupStorage()
      const dir = 'Patrons/torsade [11]'
      const entity = pat(11, 'Torsade', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
      const hash = await seedFolder(storage, dir, entity)
      // Témoin DB déjà aligné (état post-guérison / post-fusion d'un passage antérieur).
      const { db, patternsStore, projectsStore } = makeFakeDb(
        [pat(11, 'Torsade', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])], { patronMdSyncHash: hash })],
        [],
      )
      const counter = countJsonReads(storage)

      // Passe complète : le dossier est propre, le témoin DB suffit à le conclure.
      const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })
      expect(report).toEqual({ merged: [], skipped: [], errors: [] })
      expect(counter.jsonReads).toBe(0) // ZÉRO lecture du gros fichier
      expect(db.transaction).not.toHaveBeenCalled()
      expect(db.patterns.update).not.toHaveBeenCalled() // témoin déjà valide : même pas de guérison

      // Passe ciblée ({ only }) : même verdict, même économie.
      const reportOnly = await syncPatronMd(
        storage,
        { db, patternsStore, projectsStore },
        { only: { kind: 'pattern', id: 11 } },
      )
      expect(reportOnly).toEqual({ merged: [], skipped: [], errors: [] })
      expect(counter.jsonReads).toBe(0)
    })

    it('témoin DB absent (vieille sauvegarde) → repli chemin lourd + guérison du témoin DB', async () => {
      const storage = new MemoryBackupStorage()
      const dir = 'Patrons/ancien [12]'
      const entity = pat(12, 'Ancien', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
      const hash = await seedFolder(storage, dir, entity)
      // Entité SANS patronMdSyncHash : état d'une base d'avant la mise à jour.
      const { db, patternsStore, projectsStore, patterns } = makeFakeDb([entity], [])

      // Capture la suppression d'auto-backup au moment de l'écriture du témoin.
      let suppressionAtWitnessWrite = null
      const baseUpdate = db.patterns.update.getMockImplementation()
      db.patterns.update = vi.fn(async (id, patch) => {
        if (patch && 'patronMdSyncHash' in patch) suppressionAtWitnessWrite = isAutoBackupSuppressed()
        return baseUpdate(id, patch)
      })

      const counter = countJsonReads(storage)
      const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

      // Repli : le témoin disque (== hash courant) conclut « rien à fusionner »,
      // mais il a fallu relire patron.json une fois (coût de migration, borné).
      expect(report).toEqual({ merged: [], skipped: [], errors: [] })
      expect(counter.jsonReads).toBe(1)
      expect(db.transaction).not.toHaveBeenCalled() // aucune fusion : pas de transaction
      // Guérison : le témoin DB est posé (une seule écriture, patch ciblé).
      expect(patterns.get(12).patronMdSyncHash).toBe(hash)
      expect(db.patterns.update).toHaveBeenCalledTimes(1)
      expect(suppressionAtWitnessWrite).toBe(true) // guérison sous suppressAutoBackup

      // Le passage suivant est repassé au chemin rapide : plus AUCUNE lecture lourde.
      const jsonReadsAfterHeal = counter.jsonReads
      const report2 = await syncPatronMd(storage, { db, patternsStore, projectsStore })
      expect(report2).toEqual({ merged: [], skipped: [], errors: [] })
      expect(counter.jsonReads).toBe(jsonReadsAfterHeal)
    })

    it('édition PC → fusion + témoin patron.json réécrit PUIS témoin DB posé (ordre strict, sous suppressAutoBackup)', async () => {
      const storage = new MemoryBackupStorage()
      const dir = 'Patrons/edit [13]'
      const original = pat(13, 'Édit', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
      await seedFolder(storage, dir, original)
      const edited = pat(13, 'Édit', [
        sec('corps', 'Corps', [st('monter'), st('NOUVEAU'), st('rang endroit')]),
      ])
      await editMdOnDisk(storage, dir, edited)
      const { db, patternsStore, projectsStore, patterns } = makeFakeDb([original], [])

      // Journal d'événements : écriture du témoin disque vs écritures DB.
      const events = []
      const baseWrite = storage.writeFile.bind(storage)
      storage.writeFile = async (path, data, opts) => {
        if (String(path) === `${dir}/patron.json`) events.push('temoin-disque')
        return baseWrite(path, data, opts)
      }
      const baseUpdate = db.patterns.update.getMockImplementation()
      let suppressionAtWitnessWrite = null
      db.patterns.update = vi.fn(async (id, patch) => {
        if (patch && 'patronMdSyncHash' in patch) {
          suppressionAtWitnessWrite = isAutoBackupSuppressed()
          events.push('temoin-db')
        } else {
          events.push('fusion-db')
        }
        return baseUpdate(id, patch)
      })

      const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

      expect(report.errors).toEqual([])
      expect(report.merged).toHaveLength(1)
      // ORDRE STRICT : fusion d'abord, puis témoin disque, puis SEULEMENT ENSUITE le
      // témoin DB. Poser le témoin DB avant le succès disque ferait skipper à jamais
      // les passages suivants en cas d'échec d'écriture (perte silencieuse, interdite).
      expect(events).toEqual(['fusion-db', 'temoin-disque', 'temoin-db'])
      expect(suppressionAtWitnessWrite).toBe(true)

      // Les deux témoins portent le même hash — celui du md réellement sur disque.
      const mdOnDisk = await storage.readFile(`${dir}/patron.md`, { encoding: 'utf8' })
      const current = hash8(mdOnDisk)
      const jsonAfter = JSON.parse(await storage.readFile(`${dir}/patron.json`, { encoding: 'utf8' }))
      expect(jsonAfter.patronMd.hash).toBe(current)
      expect(patterns.get(13).patronMdSyncHash).toBe(current)
    })

    it("échec d'écriture du témoin patron.json (après commit DB) → témoin DB NON posé, la passe suivante retente le chemin lourd", async () => {
      const storage = new MemoryBackupStorage()
      const dir = 'Patrons/disque-kaput [14]'
      const original = pat(14, 'Kaput', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
      await seedFolder(storage, dir, original)
      const edited = pat(14, 'Kaput', [
        sec('corps', 'Corps', [st('monter'), st('NOUVEAU'), st('rang endroit')]),
      ])
      await editMdOnDisk(storage, dir, edited)
      const { db, patternsStore, projectsStore, patterns } = makeFakeDb([original], [])

      // La PREMIÈRE écriture du témoin patron.json échoue (storage plein, SAF bavard…).
      const baseWrite = storage.writeFile.bind(storage)
      let jsonWriteFailures = 1
      storage.writeFile = async (path, data, opts) => {
        if (jsonWriteFailures > 0 && String(path) === `${dir}/patron.json`) {
          jsonWriteFailures -= 1
          throw new Error('boom : écriture disque en échec')
        }
        return baseWrite(path, data, opts)
      }

      const report = await syncPatronMd(storage, { db, patternsStore, projectsStore })

      // L'échec est consigné ; la transaction DB a commité mais le témoin DB n'est
      // PAS posé — sinon le prochain passage skipperait à jamais (perte silencieuse).
      expect(report.errors).toHaveLength(1)
      expect(report.errors[0].folder).toBe(dir)
      expect(patterns.get(14).patronMdSyncHash).toBeUndefined()

      // Passe suivante (disque réparé) : le chemin LOURD est retenté (patron.json
      // relus), la fusion repart d'un interne intact, et les deux témoins se alignent.
      storage.writeFile = baseWrite
      const counter = countJsonReads(storage)
      const report2 = await syncPatronMd(storage, { db, patternsStore, projectsStore })
      expect(report2.merged).toHaveLength(1)
      expect(counter.jsonReads).toBeGreaterThan(0) // pas de faux no-op
      const mdOnDisk = await storage.readFile(`${dir}/patron.md`, { encoding: 'utf8' })
      expect(patterns.get(14).patronMdSyncHash).toBe(hash8(mdOnDisk))
      const jsonAfter = JSON.parse(await storage.readFile(`${dir}/patron.json`, { encoding: 'utf8' }))
      expect(jsonAfter.patronMd.hash).toBe(hash8(mdOnDisk))
    })

    // Cas de l'entrelacement que l'égalité stricte doit couvrir : dossier guéri
    // (témoin DB = H v1), puis édition PC du md (v2) — le témoin DB devient
    // PRÉSENT mais PÉRIMÉ. Le chemin rapide doit RATER (comparaison de VALEUR,
    // pas un simple « témoin présent ? ») et laisser place à la fusion. Garde
    // anti-régression : un futur refactorisant la comparaison en `!= null` est
    // attrapé PAR CE SEUL test (les autres cas ont un témoin absent ou à jour).
    it('témoin DB PRÉSENT mais PÉRIMÉ (guérison puis édition PC) → le chemin rapide rate, fusion, témoin re-posé au nouveau hash', async () => {
      const storage = new MemoryBackupStorage()
      const dir = 'Patrons/stale [15]'
      const v1 = pat(15, 'Stale', [sec('corps', 'Corps', [st('monter'), st('rang endroit')])])
      await seedFolder(storage, dir, v1)
      const { db, patternsStore, projectsStore, patterns } = makeFakeDb([v1], [])

      // Passe 1 : témoin DB absent (vieille base) → guérison, témoin DB = H(md v1).
      const report1 = await syncPatronMd(storage, { db, patternsStore, projectsStore })
      expect(report1.merged).toEqual([])
      const healedWitness = patterns.get(15).patronMdSyncHash
      expect(healedWitness).toBeTruthy()

      // Édition PC : patron.md passe à v2, le témoin DB (H v1) reste tel quel.
      const v2 = pat(15, 'Stale', [
        sec('corps', 'Corps', [st('monter'), st('NOUVEAU'), st('rang endroit')]),
      ])
      await editMdOnDisk(storage, dir, v2)

      const counter = countJsonReads(storage)
      const report2 = await syncPatronMd(storage, { db, patternsStore, projectsStore })

      // Le témoin périmé ne doit PAS déclencher le chemin rapide : fusion normale.
      expect(report2.merged).toHaveLength(1)
      expect(counter.jsonReads).toBeGreaterThan(0) // divergence → le gros fichier est relu
      expect(patterns.get(15).reader.sections[0].steps.map((s) => s.t)).toEqual([
        'monter',
        'NOUVEAU',
        'rang endroit',
      ])

      // Les DEUX témoins sont re-posés au NOUVEAU hash (celui du md v2 sur disque).
      const mdOnDisk = await storage.readFile(`${dir}/patron.md`, { encoding: 'utf8' })
      const newHash = hash8(mdOnDisk)
      expect(newHash).not.toBe(healedWitness) // sinon le cas n'est pas celui qu'on croit tester
      expect(patterns.get(15).patronMdSyncHash).toBe(newHash)
      const jsonAfter = JSON.parse(await storage.readFile(`${dir}/patron.json`, { encoding: 'utf8' }))
      expect(jsonAfter.patronMd.hash).toBe(newHash)
    })

  })

  describe('whenSyncIdle', () => {
    it('aucune synchro en cours → se résout immédiatement', async () => {
      expect(isSyncRunning()).toBe(false)
      await expect(whenSyncIdle()).resolves.toBeUndefined()
    })

    it('synchro en cours → se résout seulement après son terme', async () => {
      const storage = new MemoryBackupStorage()
      const { db, patternsStore, projectsStore } = makeFakeDb([], [])

      const p1 = syncPatronMd(storage, { db, patternsStore, projectsStore })
      expect(isSyncRunning()).toBe(true)

      let idleResolved = false
      const idle = whenSyncIdle().then(() => {
        idleResolved = true
      })
      // Encore en cours juste après l'appel : whenSyncIdle ne doit pas se résoudre
      // avant que p1 (la synchro en cours) ne se termine.
      expect(idleResolved).toBe(false)

      await p1
      await idle
      expect(idleResolved).toBe(true)
      expect(isSyncRunning()).toBe(false)
    })
  })

  afterEach(() => {
    isAutoBackupRunning.mockReturnValue(false)
  })
})

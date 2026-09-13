// Intégration : preuve BOUT EN BOUT du scénario
// « éditer le patron.md sur PC → relancer l'app ». Contrairement à
// `patron-md-sync.spec.js` (DB/stores FAKES, fixtures construites à la main),
// ce test exerce le VRAI pipeline : `db` Dexie réel (fake-indexeddb, cf.
// tests/unit/setup.js), vrais stores Pinia (`usePatternsStore`/`useProjectsStore`),
// vraie sauvegarde (`collectBackupData` + `backupAll`) puis vraie synchro
// (`syncPatronMd`). Seule l'édition externe du `patron.md` par un tiers (PC) est
// simulée — on ne pilote pas un éditeur de texte, on réécrit juste le fichier.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore } from '@/stores/projects'
import { collectBackupData } from '@/backup/collect'
import { backupAll } from '@/backup/orchestrator'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { entryFolderName, hash8 } from '@/backup/naming'
import { patternToMd } from '@/utils/pattern-md'
import { syncPatronMd } from '@/backup/patron-md-sync'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'

// Sans ce mock, `capReaderAssets` (branché dans patron-md-sync.js après
// `resolveReaderAssets`) appelle `new Image()` sous jsdom : `onload` ne se
// déclenche jamais réellement (pas de vrai décodage d'image), donc chaque
// promesse reste en attente et ce test d'intégration timeout. Même geste que
// zip-import.spec.js/captures-pattern.spec.js pour la même famille de fonctions.
vi.mock('@/utils/image-resize', () => ({
  resizeDataUrl: async (d) => d,
  capDataUrlIfOversized: async (d) => d,
}))

const PHOTO_STEP = 'data:image/jpeg;base64,AAAA'
const PHOTO_GALLERY = 'data:image/png;base64,BBBB'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

// Reader riche à 3 sections : « Buste » porte l'étape illustrée (image + galerie,
// et sera renommée) ; « Manches » porte un step coché qui va être DÉCALÉ par une
// insertion (la coche doit suivre le texte, pas l'index) ; « Finitions » porte un
// step coché dont le TEXTE va être modifié (la coche doit être abandonnée).
function makeReader() {
  return {
    sizeLabels: ['S', 'M'],
    sections: [
      {
        id: 'buste',
        kind: 'corps',
        title: 'Buste',
        steps: [{ t: 'monter 80 mailles' }, { t: 'tricoter en jersey', imgs: [PHOTO_STEP] }],
      },
      {
        id: 'manches',
        kind: 'manche',
        title: 'Manches',
        steps: [{ t: 'monter 40 mailles manche' }, { t: 'tricoter 10 rangs manche' }],
      },
      {
        id: 'finitions',
        kind: 'finitions',
        title: 'Finitions',
        steps: [{ t: 'rabattre les mailles' }],
      },
    ],
  }
}

// Version « éditée sur PC » : « Buste » renommée « Devant » (image identique — même
// contenu, donc même fichier d'asset côté sauvegarde, non retouché) ; un step
// inséré AVANT le step coché de « Manches » ; le texte du step coché de
// « Finitions » modifié.
function makeEditedReader() {
  return {
    sizeLabels: ['S', 'M'],
    sections: [
      {
        id: 'devant',
        kind: 'corps',
        title: 'Devant',
        steps: [{ t: 'monter 80 mailles' }, { t: 'tricoter en jersey', imgs: [PHOTO_STEP] }],
      },
      {
        id: 'manches',
        kind: 'manche',
        title: 'Manches',
        steps: [
          { t: 'monter 40 mailles manche' },
          { t: 'rang de transition' },
          { t: 'tricoter 10 rangs manche' },
        ],
      },
      {
        id: 'finitions',
        kind: 'finitions',
        title: 'Finitions',
        steps: [{ t: 'rabattre les mailles souplement' }],
      },
    ],
  }
}

// Tronque un Rowtine-MD au front-matter + à la PREMIÈRE section de travail
// (coupe juste avant le 2e « ## ») — simule un fichier .md tronqué/mal collé :
// 1 section reparsée sur 3 internes → sous le seuil de sûreté (50 %, cf.
// SHRINK_SAFE_RATIO dans merge-pattern-md.js).
function truncateToFirstSection(md) {
  const first = md.indexOf('\n## ')
  const second = md.indexOf('\n## ', first + 1)
  return second === -1 ? md : md.slice(0, second) + '\n'
}

describe('intégration N2 — éditer le patron.md sur PC puis relancer la synchro', () => {
  it('fusionne le MD édité, réconcilie la progression par contenu (jamais de fausse coche), résout les images, met à jour le témoin (2e passage = no-op), et protège contre un MD tronqué', async () => {
    const patternsStore = usePatternsStore()
    const projectsStore = useProjectsStore()

    // --- Étape 1 : seed — 1 patron de bibliothèque (reader riche) + 1 projet LIÉ
    // (pas forké : patternId = id du patron de biblio, dont l'ownerProjectId reste
    // null) avec des coches de progression sur des steps précis. ---------------
    const libId = await patternsStore.add({
      name: 'Pull Torsadé',
      type: 'knitting',
      author: 'Autrice',
      ownerProjectId: null,
      photos: [],
      gallery: [{ src: PHOTO_GALLERY, page: 1, w: 100, h: 100 }],
      pdf: '',
      reader: makeReader(),
    })

    const projectId = await projectsStore.create({
      name: 'Mon pull torsadé',
      technique: 'knitting',
      patternId: libId,
      readerState: {
        size: 0,
        done: { 'manches#1': true, 'finitions#0': true },
        counters: {},
        chartRow: 0,
      },
    })

    // Sanity check du seed : lien (pas fork).
    const seededPattern = await db.patterns.get(libId)
    expect(seededPattern.ownerProjectId).toBeNull()
    const seededProject = await db.projects.get(projectId)
    expect(seededProject.patternId).toBe(libId)

    // --- Étape 1 (suite) : sauvegarde réelle (collect + backupAll) — écrit
    // patron.md + patron.json (avec témoin) dans Patrons/<slug> [id]. ------------
    const storage = new MemoryBackupStorage()
    const snapshot = await collectBackupData()
    await backupAll(storage, snapshot)

    const patternDir = `Patrons/${entryFolderName('Pull Torsadé', libId)}`
    expect(await storage.exists(`${patternDir}/patron.md`)).toBe(true)
    expect(await storage.exists(`${patternDir}/patron.json`)).toBe(true)
    // Le projet, LIÉ (pas forké), ne porte pas son propre patron.md.
    const projectDir = `Projets/${entryFolderName('Mon pull torsadé', projectId)}`
    expect(await storage.exists(`${projectDir}/patron.md`)).toBe(false)

    const deps = { db, patternsStore, projectsStore }

    // --- Étape 2 : édition externe — réécrit SEULEMENT patron.md (jamais
    // patron.json, dont le témoin reste donc l'ancien hash). --------------------
    const editedEntity = { ...seededPattern, reader: makeEditedReader(), gallery: seededPattern.gallery }
    const { md: editedMd } = patternToMd(editedEntity, { assetDir: '', galleryPrefix: 'gallery-' })
    await storage.writeFile(`${patternDir}/patron.md`, editedMd, { encoding: 'utf8' })

    // --- Étape 3 : synchro. -----------------------------------------------------
    const report = await syncPatronMd(storage, deps)

    expect(report.errors).toEqual([])
    expect(report.skipped).toEqual([])
    expect(report.merged).toHaveLength(1)
    expect(report.merged[0]).toMatchObject({ kind: 'pattern', id: libId })

    // --- Étape 4 : asserts. -------------------------------------------------

    // Le patron DB reflète le MD édité : section renommée présente.
    const patternAfter = await db.patterns.get(libId)
    expect(patternAfter.reader.sections.map((s) => s.title)).toEqual(['Devant', 'Manches', 'Finitions'])
    expect(patternAfter.reader.sections.find((s) => s.id === 'devant')).toBeTruthy()

    // Progression du projet lié RÉCONCILIÉE : la coche « manches » suit le TEXTE
    // (index décalé par l'insertion, mais retrouvé) ; la coche « finitions » est
    // ABANDONNÉE (texte modifié) — jamais de fausse coche, jamais de perte muette
    // (le report en rend compte).
    const projectAfter = await db.projects.get(projectId)
    expect(projectAfter.readerState.done).toEqual({ 'manches#2': true })
    expect(report.merged[0].reconcile.doneKept).toBe(1)
    expect(report.merged[0].reconcile.doneLost).toBe(1)
    expect(report.merged[0].reconcile.sizeReset).toBe(false)

    // Témoin mis à jour : patron.json.patronMd.hash == hash8(MD édité).
    const mdOnDisk = await storage.readFile(`${patternDir}/patron.md`, { encoding: 'utf8' })
    const jsonAfter = JSON.parse(await storage.readFile(`${patternDir}/patron.json`, { encoding: 'utf8' }))
    expect(jsonAfter.patronMd.hash).toBe(hash8(mdOnDisk))

    // 2e passage : rien n'a bougé depuis → no-op (fichier == témoin).
    const report2 = await syncPatronMd(storage, deps)
    expect(report2).toEqual({ merged: [], skipped: [], errors: [] })

    // Images toujours résolues : data URL, pas un chemin nu du dossier.
    const illustratedStep = patternAfter.reader.sections[0].steps.find((s) => s.imgs)
    expect(illustratedStep.imgs[0]).toMatch(/^data:image\//)
    expect(patternAfter.gallery[0].src).toMatch(/^data:image\//)

    // --- Étape 5 : cas dégradé — MD tronqué à 1 section sur 3 → garde de
    // dégénérescence : l'interne n'est PAS écrasé, un avertissement figure au
    // rapport (skipped), et le témoin ne bouge pas (retentera au prochain passage). ---
    const truncated = truncateToFirstSection(mdOnDisk)
    await storage.writeFile(`${patternDir}/patron.md`, truncated, { encoding: 'utf8' })

    const report3 = await syncPatronMd(storage, deps)
    expect(report3.merged).toEqual([])
    expect(report3.skipped).toHaveLength(1)
    expect(report3.skipped[0]).toMatchObject({ kind: 'pattern', id: libId })
    // `reason` est un avertissement STRUCTURÉ (code + params), traduit à l'affichage
    // (warningText) — jamais une chaîne composée ici.
    expect(report3.skipped[0].reason).toMatchObject({ code: WARNING_CODES.MERGE_FEWER_SECTIONS })

    const patternAfterDegraded = await db.patterns.get(libId)
    expect(patternAfterDegraded.reader.sections).toHaveLength(3) // interne conservé intact
    expect(patternAfterDegraded.reader.sections.map((s) => s.title)).toEqual([
      'Devant',
      'Manches',
      'Finitions',
    ])
    // Progression déjà réconciliée à l'étape 4 : toujours intacte (rien retouché).
    const projectAfterDegraded = await db.projects.get(projectId)
    expect(projectAfterDegraded.readerState.done).toEqual({ 'manches#2': true })

    const jsonAfterDegraded = JSON.parse(
      await storage.readFile(`${patternDir}/patron.json`, { encoding: 'utf8' }),
    )
    expect(jsonAfterDegraded.patronMd.hash).toBe(hash8(mdOnDisk)) // témoin NON touché
  })
})

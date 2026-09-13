// Unitaire — la progression émise par le moteur (2026-08-04, §4.2).
// Stockage en mémoire, vrai orchestrateur, vraie lecture : on vérifie la SÉQUENCE
// des événements, pas seulement qu'il y en a.
import { describe, expect, it } from 'vitest'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { backupAll } from '@/backup/orchestrator'
import { readBackup } from '@/backup/restore'
import { syncProgress, beginSyncProgress, endSyncProgress } from '@/backup/progress'

function snapshotWith(nProjects, nPatterns) {
  return {
    projects: Array.from({ length: nProjects }, (_, i) => ({
      id: 100 + i,
      name: `Ouvrage ${i + 1}`,
      sections: [],
      counters: [],
      sessions: [],
      diagrams: [],
    })),
    libraryPatterns: Array.from({ length: nPatterns }, (_, i) => ({
      id: 200 + i,
      name: `Patron ${i + 1}`,
    })),
    yarns: [],
    purchases: [],
    independentCounters: [],
    settings: {},
    trashIds: { projects: [], patterns: [] },
    keepIds: {
      projects: Array.from({ length: nProjects }, (_, i) => 100 + i),
      patterns: Array.from({ length: nPatterns }, (_, i) => 200 + i),
    },
  }
}

describe('backupAll — progression', () => {
  it('annonce le bon total dès le premier événement : ouvrages + patrons', async () => {
    const storage = new MemoryBackupStorage()
    const events = []
    await backupAll(storage, snapshotWith(3, 2), { onProgress: (e) => events.push(e) })

    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.phase === 'backup')).toBe(true)
    expect(events.every((e) => e.total === 5)).toBe(true)
  })

  it('mène `done` de 0 à `total`, sans jamais reculer', async () => {
    const storage = new MemoryBackupStorage()
    const events = []
    await backupAll(storage, snapshotWith(3, 2), { onProgress: (e) => events.push(e) })

    expect(events.at(-1).done).toBe(5)
    const dones = events.map((e) => e.done)
    expect(dones).toEqual([...dones].sort((a, b) => a - b))
  })

  it('fait avancer le compteur de fichiers À L\'INTÉRIEUR d\'une entrée (la barre peut stagner, les chiffres non)', async () => {
    const storage = new MemoryBackupStorage()
    const events = []
    // Un SEUL ouvrage : la barre ne bougera qu'une fois, mais plusieurs fichiers
    // sont écrits — c'est exactement le cas d'un ouvrage à quarante photos.
    await backupAll(storage, snapshotWith(1, 0), { onProgress: (e) => events.push(e) })

    const atDoneZero = events.filter((e) => e.done === 0)
    expect(atDoneZero.length).toBeGreaterThan(1)
    expect(atDoneZero.at(-1).written).toBeGreaterThan(atDoneZero[0].written)
  })

  it("n'émet RIEN quand aucun onProgress n'est fourni (sauvegarde de fond muette)", async () => {
    const storage = new MemoryBackupStorage()
    await expect(backupAll(storage, snapshotWith(2, 1))).resolves.toBeDefined()
  })
})

describe('readBackup — progression', () => {
  it('annonce le total lu et mène `done` jusqu\'à lui', async () => {
    const storage = new MemoryBackupStorage()
    await backupAll(storage, snapshotWith(3, 2))

    const events = []
    await readBackup(storage, { onProgress: (e) => events.push(e) })

    expect(events.every((e) => e.phase === 'read')).toBe(true)
    expect(events[0].total).toBe(5)
    expect(events.at(-1).done).toBe(5)
  })

  it('exclut du total les dossiers en corbeille (sinon `done` n\'atteint jamais `total`)', async () => {
    const storage = new MemoryBackupStorage()
    const snap = snapshotWith(3, 0)
    snap.trashIds = { projects: [101], patterns: [] }
    await backupAll(storage, snap)

    const events = []
    await readBackup(storage, { onProgress: (e) => events.push(e) })

    expect(events[0].total).toBe(2)
    expect(events.at(-1).done).toBe(2)
  })

  it("porte le nom lisible du dossier en cours (`current`), émis à l'ENTRÉE de chaque dossier", async () => {
    const storage = new MemoryBackupStorage()
    await backupAll(storage, snapshotWith(3, 2))

    const events = []
    await readBackup(storage, { onProgress: (e) => events.push(e) })

    // Report initial : `current` vide (rien n'est encore en train d'être lu).
    expect(events[0]).toEqual({ phase: 'read', done: 0, total: 5, current: '' })

    // Premier événement après le report initial : le NOM du dossier 1 (sans l'id),
    // alors que `done` n'a pas encore bougé — c'est le dossier EN COURS de lecture.
    // L'annonce PORTE sub:null : la sous-barre du dossier précédent meurt dès que le
    // nouveau est nommé (sinon elle resterait pleine sous son nom pendant readdir +
    // première tranche, avec le nom de l'ANCIEN fichier).
    expect(events[1]).toEqual({ phase: 'read', done: 0, total: 5, current: 'ouvrage-1', sub: null })

    // La tranche (unique, en mémoire) de projet.json porte la sous-barre du dossier :
    // `current` absent (le reporter garde le nom), sub {file, done, total}
    // en octets — un dossier de snapshotWith ne contient que projet.json, la tranche
    // fait donc déjà atteindre au cumul le total du dossier.
    expect(events[2]).toMatchObject({
      phase: 'read',
      done: 0,
      total: 5,
      sub: { file: 'projet.json' },
    })
    expect(events[2].sub.done).toBe(events[2].sub.total)

    // Le `finally` du dossier 1 émet SANS current ni sub (le reporter garde l'ancien)…
    expect(events[3]).toEqual({ phase: 'read', done: 1, total: 5, current: undefined })
    // …et l'événement suivant porte le nom du dossier 2 (sub:null, même annonce).
    expect(events[4]).toEqual({ phase: 'read', done: 1, total: 5, current: 'ouvrage-2', sub: null })

    // Les DEUX boucles émettent : le dernier dossier est un patron (tête, tranche,
    // finally — trois événements par dossier désormais).
    expect(events.at(-3)).toEqual({ phase: 'read', done: 4, total: 5, current: 'patron-2', sub: null })
    expect(events.at(-2)).toMatchObject({
      phase: 'read',
      done: 4,
      total: 5,
      sub: { file: 'patron.json' },
    })
    expect(events.at(-1)).toEqual({ phase: 'read', done: 5, total: 5, current: undefined })
  })

  // Sous-barre du dossier EN COURS (retour terrain sur marisol-shawl : ~8 Mo
  // figés 10-25 s, « j'ai cru qu'il avait planté »). Chaque tranche réussie de chaque
  // fichier du dossier ré-émet la progression avec `sub` : le fichier nommé et le
  // cumul d'OCTETS DU DOSSIER rapporté au total du dossier (Σ des tailles connues).
  describe('readBackup — sous-barre du dossier en cours (sub, en octets)', () => {
    // Dossier fabriqué à la main : tailles déterministes, et l'ordre d'écriture est
    // l'ordre de readdir (insertion dans la Map mémoire). Le JSON principal d'abord
    // (c'est lui qu'on veut voir porter la première tranche), puis un patron imbriqué
    // (lu en utf8 par readFolderFiles) et une photo (base64). Le projet a un id entier
    // → il se restaure, readFolderFiles va donc AU BOUT de ses lectures.
    const PROJET_JSON = '{"id":1,"name":"Pull","photos":["photo-abcd1234.webp"]}'
    const PATRON_JSON = '{"id":9,"name":"Torsade"}'
    const octets = (str) => new TextEncoder().encode(str).length
    const TAILLE_PROJET = octets(PROJET_JSON)
    const TAILLE_PATRON = octets(PATRON_JSON)
    const TAILLE_PHOTO = 3 // 'AAAA' décode 3 octets
    const TOTAL_DOSSIER = TAILLE_PROJET + TAILLE_PATRON + TAILLE_PHOTO

    async function storageAvecDossierLourd() {
      const storage = new MemoryBackupStorage()
      await storage.writeFile('Projets/pull [1]/projet.json', PROJET_JSON)
      await storage.writeFile('Projets/pull [1]/patron.json', PATRON_JSON)
      await storage.writeFile('Projets/pull [1]/photo-abcd1234.webp', 'AAAA', { encoding: 'base64' })
      return storage
    }

    it('émet sub à CHAQUE lecture du dossier : fichier nommé, cumul du dossier, JSON principal EN PREMIER', async () => {
      const events = []
      await readBackup(await storageAvecDossierLourd(), { onProgress: (e) => events.push(e) })

      expect(events[0]).toEqual({ phase: 'read', done: 0, total: 1, current: '' })
      // Annonce avec sub:null (la sous-barre du précédent meurt à l'entrée du dossier).
      expect(events[1]).toEqual({ phase: 'read', done: 0, total: 1, current: 'pull', sub: null })
      // Le gros JSON : SA tranche (la première) doit déjà faire vivre la sous-barre —
      // c'est lui la majorité des octets du dossier.
      expect(events[2]).toEqual({
        phase: 'read',
        done: 0,
        total: 1,
        current: undefined,
        sub: { file: 'projet.json', done: TAILLE_PROJET, total: TOTAL_DOSSIER },
      })
      // Les fichiers du dossier s'empilent sur le MÊME cumul (octets du DOSSIER).
      expect(events[3]).toEqual({
        phase: 'read',
        done: 0,
        total: 1,
        current: undefined,
        sub: { file: 'patron.json', done: TAILLE_PROJET + TAILLE_PATRON, total: TOTAL_DOSSIER },
      })
      expect(events[4]).toEqual({
        phase: 'read',
        done: 0,
        total: 1,
        current: undefined,
        sub: { file: 'photo-abcd1234.webp', done: TOTAL_DOSSIER, total: TOTAL_DOSSIER },
      })
      // Fin du dossier : sub absent (le reporter garde la dernière valeur jusqu'à ce
      // que le dossier suivant la remplace ou la tue) ; la barre principale avance.
      expect(events[5]).toEqual({ phase: 'read', done: 1, total: 1, current: undefined })
    })

    it('tailles inconnues (fournisseur SAF aveugle) : sub:null ÉMIS EXPLICITEMENT, jamais de sous-barre inventée', async () => {
      const storage = await storageAvecDossierLourd()
      // DocumentFile.length() rend 0 chez certains fournisseurs : readdir ne dit plus
      // AUCUNE taille. La sous-barre doit se taire proprement (repli sur le libellé),
      // pas simuler une progression sur des données absentes.
      const aveugle = {
        exists: (p) => storage.exists(p),
        readdir: async (p) => (await storage.readdir(p)).map((e) => ({ ...e, size: 0 })),
        readFile: (p, o) => storage.readFile(p, o),
      }
      const events = []
      await readBackup(aveugle, { onProgress: (e) => events.push(e) })

      const subs = events.map((e) => e.sub)
      // DEUX null par dossier : l'ANNONCE du nom (tue la sous-barre du précédent dès
      // l'entrée — cf. les annonces dans readBackup) puis le lecteur de dossier
      // (total inconnu → tue à son tour). Le second est redondant tant que l'annonce
      // tue déjà, mais reste la garde du chemin « tailles devenues inconnues ».
      expect(
        subs.filter((s) => s === null),
        'un dossier → DEUX null (annonce + lecteur de dossier)',
      ).toHaveLength(2)
      expect(subs.every((s) => s === null || s === undefined)).toBe(true)
      // Le PREMIER null EST l'annonce du nom (la sous-barre du précédent meurt dès
      // l'entrée du dossier), le second vient du lecteur de dossier (total inconnu).
      expect(events[1]).toEqual({ phase: 'read', done: 0, total: 1, current: 'pull', sub: null })
      expect(events[2]).toEqual({ phase: 'read', done: 0, total: 1, sub: null })
    })

    it('un résidu d’écriture (.part/.tmp) ne compte NI dans le total NI dans les fichiers nommés', async () => {
      const storage = await storageAvecDossierLourd()
      await storage.writeFile('Projets/pull [1]/photo-deadbeef.jpg.part', 'moitié de photo')
      const events = []
      await readBackup(storage, { onProgress: (e) => events.push(e) })

      const subEvents = events.filter((e) => e.sub)
      expect(subEvents.every((e) => !/\.part$/i.test(e.sub.file)), 'un résidu a été nommé').toBe(true)
      expect(subEvents.at(-1).sub.total).toBe(TOTAL_DOSSIER)
    })
  })
})

describe('beginSyncProgress — champ sub (sous-barre du dossier en cours)', () => {
  it("remet sub à null à chaque nouvelle opération (aucune sous-barre héritée de la précédente)", () => {
    const first = beginSyncProgress('read')
    first({ phase: 'read', done: 1, total: 2, sub: { file: 'projet.json', done: 5, total: 10 } })
    endSyncProgress()

    beginSyncProgress('read')
    expect(syncProgress.sub).toBeNull()
    endSyncProgress()
  })

  it('copie evt.sub quand présent, GARDE l’ancien quand absent, et null TUE', () => {
    const report = beginSyncProgress('read')

    report({ phase: 'read', done: 0, total: 2, sub: { file: 'projet.json', done: 10, total: 100 } })
    expect(syncProgress.sub).toEqual({ file: 'projet.json', done: 10, total: 100 })

    report({ phase: 'read', done: 0, total: 2, sub: { file: 'photo-x.webp', done: 40, total: 100 } })
    expect(syncProgress.sub).toEqual({ file: 'photo-x.webp', done: 40, total: 100 })

    // Champ absent du contrat (le `finally` de readBackup, l'entre-deux dossiers) :
    // même sémantique `??` que les autres champs optionnels — on garde.
    report({ phase: 'read', done: 1, total: 2 })
    expect(syncProgress.sub).toEqual({ file: 'photo-x.webp', done: 40, total: 100 })

    // null (tailles inconnues, fournisseur aveugle) : on TUE explicitement.
    report({ phase: 'read', done: 1, total: 2, sub: null })
    expect(syncProgress.sub).toBeNull()

    endSyncProgress()
  })
})

describe('beginSyncProgress — champ `current` (nom de l\'import en cours)', () => {
  it("remet `current` à '' à chaque nouvelle opération (aucun résidu de la précédente)", () => {
    const first = beginSyncProgress('read')
    first({ phase: 'read', done: 1, total: 2, current: 'marisol-shawl' })
    endSyncProgress()

    beginSyncProgress('read')
    expect(syncProgress.current).toBe('')
  })

  it('copie evt.current quand présent, GARDE l\'ancien quand absent (sémantique ?? des autres champs)', () => {
    const report = beginSyncProgress('read')

    report({ phase: 'read', done: 0, total: 2, current: 'marisol-shawl' })
    expect(syncProgress.current).toBe('marisol-shawl')

    // `report?.()` du finally de restore.js : current absent → le libellé du dossier
    // EN COURS reste affiché pendant qu'il se termine.
    report({ phase: 'read', done: 1, total: 2 })
    expect(syncProgress.current).toBe('marisol-shawl')

    report({ phase: 'read', done: 2, total: 2, current: 'patron-2' })
    expect(syncProgress.current).toBe('patron-2')

    endSyncProgress()
  })
})

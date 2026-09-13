// Unitaire — orchestrateur `backupAll` : arborescence, écriture
// incrémentale des photos, renommage, réconciliation des suppressions (corbeille).
import { describe, it, expect, beforeEach } from 'vitest'
import { backupAll } from '@/backup/orchestrator'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { entryFolderName } from '@/backup/naming'
import { MANIFEST_PATH } from '@/backup/backup-manifest'

const PHOTO_A = 'data:image/jpeg;base64,AAAA'
const PHOTO_B = 'data:image/png;base64,BBBB'

// Compte les appels à `writeFile`, groupés par chemin, sans changer le comportement
// de l'instance sous-jacente (monkey-patch minimal, réservé aux tests).
function spyWrites(storage) {
  const calls = []
  const original = storage.writeFile.bind(storage)
  storage.writeFile = async (path, data, opts) => {
    calls.push(path)
    return original(path, data, opts)
  }
  return calls
}

function makeProject(overrides = {}) {
  return {
    id: 7,
    name: 'Pull Torsadé',
    technique: 'aiguilles',
    photos: [PHOTO_A, PHOTO_B],
    updatedAt: '2026-01-01T00:00:00.000Z',
    sections: [{ id: 12, projectId: 7, name: 'Dos' }],
    counters: [{ id: 3, projectId: 7, name: 'Rangs' }],
    sessions: [{ id: 1, projectId: 7, durationSec: 600 }],
    diagrams: [],
    instancePattern: null,
    ...overrides,
  }
}

function baseSnapshot(overrides = {}) {
  const project = makeProject()
  return {
    projects: [project],
    libraryPatterns: [],
    yarns: [],
    independentCounters: [],
    settings: {},
    keepIds: { projects: [project.id], patterns: [] },
    ...overrides,
  }
}

describe('backupAll — écriture de base', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it("écrit projet.json (lisible, refs de noms) et les fichiers photo sous le bon dossier", async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)

    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    const json = JSON.parse(await storage.readFile(`${dir}/projet.json`))
    expect(json.name).toBe('Pull Torsadé')
    expect(json.photos).toHaveLength(2)
    expect(json.photos.every((n) => /^photo-[0-9a-f]{8}\.(jpg|png)$/.test(n))).toBe(true)
    expect(json.sections).toEqual([{ id: 12, projectId: 7, name: 'Dos' }])

    for (const name of json.photos) {
      expect(await storage.exists(`${dir}/${name}`)).toBe(true)
    }
    // instancePattern n'a pas fuité tel quel dans projet.json.
    expect(json.instancePattern).toBeUndefined()
  })

  it('crée les dossiers Projets et Patrons même vides', async () => {
    await backupAll(storage, baseSnapshot({ projects: [], keepIds: { projects: [], patterns: [] } }))
    expect(await storage.exists('Projets')).toBe(true)
    expect(await storage.exists('Patrons')).toBe(true)
  })

  it('renvoie des compteurs written/removed', async () => {
    const stats = await backupAll(storage, baseSnapshot())
    expect(stats.written).toBeGreaterThan(0)
    expect(stats.removed).toBe(0)
  })
})

describe('backupAll — écriture incrémentale des photos', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it("un 2e backupAll identique ne réécrit pas les fichiers photo (seuls les JSON/racine sont réécrits)", async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)

    const calls = spyWrites(storage)
    await backupAll(storage, snapshot)

    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    const photoWrites = calls.filter((p) => p.startsWith(`${dir}/photo-`))
    expect(photoWrites).toHaveLength(0)
    // Le JSON, lui, est réécrit à chaque passage (léger).
    expect(calls).toContain(`${dir}/projet.json`)
  })

  it('un changement de contenu (nom) déclenche bien une réécriture du JSON', async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)

    const renamed = baseSnapshot({ projects: [makeProject({ name: 'Pull Torsadé v2' })] , keepIds: { projects: [7], patterns: [] }})
    const calls = spyWrites(storage)
    await backupAll(storage, renamed)

    const dir = `Projets/${entryFolderName('Pull Torsadé v2', 7)}`
    expect(calls).toContain(`${dir}/projet.json`)
  })
})

describe('backupAll — renommage', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it('projet renommé (même id) : ancien dossier disparu, nouveau contient les mêmes photos non re-écrites', async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)

    const oldDir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    const newDir = `Projets/${entryFolderName('Écharpe', 7)}`

    const renamedSnapshot = baseSnapshot({
      projects: [makeProject({ name: 'Écharpe' })],
      keepIds: { projects: [7], patterns: [] },
    })
    const calls = spyWrites(storage)
    await backupAll(storage, renamedSnapshot)

    expect(await storage.exists(oldDir)).toBe(false)
    expect(await storage.exists(newDir)).toBe(true)

    const json = JSON.parse(await storage.readFile(`${newDir}/projet.json`))
    for (const name of json.photos) {
      expect(await storage.exists(`${newDir}/${name}`)).toBe(true)
    }
    // Les photos n'ont pas été réécrites (déplacées via rename, pas re-téléchargées).
    const photoWrites = calls.filter((p) => p.startsWith(`${newDir}/photo-`))
    expect(photoWrites).toHaveLength(0)
  })

  it('dossier cible déjà existant : ne clobber pas son contenu même si un doublon obsolète du même id traîne', async () => {
    const targetDir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    const staleDir = `Projets/${entryFolderName('Ancien Nom', 7)}`
    // Simule une corruption pré-existante : deux dossiers pour le même id, dont un
    // déjà correctement nommé (cible) et un doublon obsolète. Le doublon est créé
    // en premier pour être trouvé avant la cible par `findExistingFolderName`.
    await storage.writeFile(`${staleDir}/marker.txt`, 'stale', { encoding: 'utf8' })
    await storage.writeFile(`${targetDir}/marker.txt`, 'target-content', { encoding: 'utf8' })

    const snapshot = baseSnapshot({ keepIds: { projects: [7], patterns: [] } })
    await backupAll(storage, snapshot)

    // Le contenu du dossier cible n'a pas été détruit par un rename destructeur.
    expect(await storage.readFile(`${targetDir}/marker.txt`)).toBe('target-content')
    // Le doublon obsolète est laissé tel quel (edge de corruption pré-existante, non géré ici).
    expect(await storage.exists(`${staleDir}/marker.txt`)).toBe(true)
  })
})

describe('backupAll — réconciliation des suppressions', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it('projet retiré de keepIds : son dossier est supprimé', async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)
    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    expect(await storage.exists(dir)).toBe(true)

    await backupAll(storage, baseSnapshot({ projects: [], keepIds: { projects: [], patterns: [] } }))
    expect(await storage.exists(dir)).toBe(false)
  })

  it('projet en corbeille (dans keepIds mais absent de projects) : son dossier est conservé', async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)
    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    expect(await storage.exists(dir)).toBe(true)

    // Le projet n'est plus dans `projects` (corbeille) mais son id reste dans keepIds.
    await backupAll(storage, baseSnapshot({ projects: [], keepIds: { projects: [7], patterns: [] } }))
    expect(await storage.exists(dir)).toBe(true)
  })
})

describe('backupAll — réconciliation des suppressions (patrons de bibliothèque)', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it('patron retiré de keepIds.patterns : son dossier est supprimé', async () => {
    const pattern = { id: 3, name: 'Twist Loop', photos: [PHOTO_A] }
    const snapshot = baseSnapshot({
      libraryPatterns: [pattern],
      keepIds: { projects: [7], patterns: [3] },
    })
    await backupAll(storage, snapshot)
    const dir = `Patrons/${entryFolderName('Twist Loop', 3)}`
    expect(await storage.exists(dir)).toBe(true)

    await backupAll(
      storage,
      baseSnapshot({ libraryPatterns: [], keepIds: { projects: [7], patterns: [] } }),
    )
    expect(await storage.exists(dir)).toBe(false)
  })

  it('patron en corbeille (dans keepIds.patterns mais absent de libraryPatterns) : son dossier est conservé', async () => {
    const pattern = { id: 3, name: 'Twist Loop', photos: [PHOTO_A] }
    const snapshot = baseSnapshot({
      libraryPatterns: [pattern],
      keepIds: { projects: [7], patterns: [3] },
    })
    await backupAll(storage, snapshot)
    const dir = `Patrons/${entryFolderName('Twist Loop', 3)}`
    expect(await storage.exists(dir)).toBe(true)

    // Le patron n'est plus dans `libraryPatterns` (corbeille) mais son id reste dans keepIds.
    await backupAll(
      storage,
      baseSnapshot({ libraryPatterns: [], keepIds: { projects: [7], patterns: [3] } }),
    )
    expect(await storage.exists(dir)).toBe(true)
  })
})

describe('backupAll — nettoyage des photos orphelines', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it('une photo retirée du projet est nettoyée au backup suivant, les autres sont conservées', async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)
    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    const before = JSON.parse(await storage.readFile(`${dir}/projet.json`))
    expect(before.photos).toHaveLength(2)
    const [keptName, removedName] = before.photos

    // Nouveau snapshot : seule la première photo reste.
    const trimmed = baseSnapshot({
      projects: [makeProject({ photos: [PHOTO_A] })],
      keepIds: { projects: [7], patterns: [] },
    })
    await backupAll(storage, trimmed)

    expect(await storage.exists(`${dir}/${keptName}`)).toBe(true)
    expect(await storage.exists(`${dir}/${removedName}`)).toBe(false)
  })

  // Revue du 15/08/2026 : `isManagedHeavyFile` ne connaissait que `photo-`,
  // `patron-photo-` et `original.pdf`. Les fichiers `gallery-*` (écrits par
  // `buildGalleryFiles`, serialize.js) n'étaient donc JAMAIS candidats au nettoyage :
  // chaque modification d'une galerie laissait l'ancienne version sur le disque, pour
  // toujours. Une galerie issue d'un PDF compte des dizaines d'images — c'est
  // exactement le gonflement de sauvegarde qui a fait tomber la tablette le 13/08.
  it('une image de galerie retirée du patron est nettoyée au backup suivant', async () => {
    const patron = (galerie) => ({
      id: 3,
      name: 'Twist Loop',
      photos: [PHOTO_A],
      gallery: [{ src: galerie, page: 1, w: 10, h: 10 }],
    })
    const keepIds = { projects: [], patterns: [3] }
    await backupAll(storage, { libraryPatterns: [patron(PHOTO_B)], keepIds })
    const dir = `Patrons/${entryFolderName('Twist Loop', 3)}`
    const ancien = (await storage.readdir(dir)).map((e) => e.name).find((n) => n.startsWith('gallery-'))
    expect(ancien).toBeDefined()

    // La galerie change de contenu : l'ancien fichier devient orphelin.
    await backupAll(storage, { libraryPatterns: [patron('data:image/png;base64,CCCC')], keepIds })

    expect(await storage.exists(`${dir}/${ancien}`)).toBe(false)
  })

  // Contre-épreuve du test ci-dessus, et la vraie raison de son existence : élargir le
  // nettoyage à un préfixe, c'est risquer de supprimer un fichier ENCORE RÉFÉRENCÉ. Le
  // cas limite est un patron qui porte un `reader` (donc un patron.md, dont les assets
  // sont émis par `patternToMd`) SANS tableau `gallery` — les deux producteurs de
  // fichiers `gallery-*` ne tournent alors pas ensemble. Rien ne doit être perdu.
  it('un patron avec reader mais sans tableau gallery ne perd aucun fichier référencé', async () => {
    const patron = {
      id: 3,
      name: 'Twist Loop',
      photos: [PHOTO_A],
      reader: {
        sizeLabels: ['S'],
        sections: [{ title: 'Dos', steps: [{ t: 'Monter 40 m', imgs: [PHOTO_B] }] }],
      },
    }
    const keepIds = { projects: [], patterns: [3] }
    await backupAll(storage, { libraryPatterns: [patron], keepIds })
    await backupAll(storage, { libraryPatterns: [patron], keepIds }) // 2e passe : le nettoyage tourne

    const dir = `Patrons/${entryFolderName('Twist Loop', 3)}`
    const md = await storage.readFile(`${dir}/patron.md`, { encoding: 'utf8' })
    // Chaque image citée par le patron.md doit encore exister sur le disque.
    const cites = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
    expect(cites.length).toBeGreaterThan(0)
    for (const ref of cites) {
      expect(await storage.exists(`${dir}/${ref}`)).toBe(true)
    }
  })
})

describe('backupAll — instancePattern (patron forké dans le dossier projet)', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it('écrit patron.json + patron-photo-* dans le dossier du projet, incrémental, orphelins nettoyés', async () => {
    const instancePattern = { id: 99, name: 'Twist Loop (copie)', photos: [PHOTO_A, PHOTO_B] }
    const snapshot = baseSnapshot({ projects: [makeProject({ instancePattern })] })
    await backupAll(storage, snapshot)

    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    const patronJson = JSON.parse(await storage.readFile(`${dir}/patron.json`))
    expect(patronJson.name).toBe('Twist Loop (copie)')
    expect(patronJson.photos).toHaveLength(2)
    expect(patronJson.photos.every((n) => n.startsWith('patron-photo-'))).toBe(true)
    for (const name of patronJson.photos) {
      expect(await storage.exists(`${dir}/${name}`)).toBe(true)
    }

    // 2e backup, instancePattern avec une seule photo : l'autre est nettoyée comme
    // orpheline, patron.json réécrit, la photo restante n'est pas re-téléchargée.
    const [keptName, removedName] = patronJson.photos
    const trimmed = baseSnapshot({
      projects: [makeProject({ instancePattern: { ...instancePattern, photos: [PHOTO_A] } })],
    })
    const calls = spyWrites(storage)
    await backupAll(storage, trimmed)

    expect(await storage.exists(`${dir}/${keptName}`)).toBe(true)
    expect(await storage.exists(`${dir}/${removedName}`)).toBe(false)
    expect(calls).not.toContain(`${dir}/${keptName}`)
    expect(calls).toContain(`${dir}/patron.json`)
  })

  it('instancePattern retiré (repassé à null) : patron.json orphelin est nettoyé, projet.json et photos restent', async () => {
    const instancePattern = { id: 99, name: 'Twist Loop (copie)', photos: [PHOTO_A] }
    const snapshot = baseSnapshot({ projects: [makeProject({ instancePattern })] })
    await backupAll(storage, snapshot)

    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    expect(await storage.exists(`${dir}/patron.json`)).toBe(true)
    const projetJsonBefore = JSON.parse(await storage.readFile(`${dir}/projet.json`))
    const photoNames = projetJsonBefore.photos

    // 2e backup : le projet a été relié (relink) à un autre patron de bibliothèque ;
    // l'instance forkée précédente n'existe plus (instancePattern: null).
    const relinked = baseSnapshot({
      projects: [makeProject({ instancePattern: null })],
      keepIds: { projects: [7], patterns: [] },
    })
    await backupAll(storage, relinked)

    expect(await storage.exists(`${dir}/patron.json`)).toBe(false)
    expect(await storage.exists(`${dir}/projet.json`)).toBe(true)
    for (const name of photoNames) {
      expect(await storage.exists(`${dir}/${name}`)).toBe(true)
    }
  })
})

describe('backupAll — écriture atomique des fichiers lourds (temp + rename)', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it('écrit un fichier lourd via un chemin temporaire (.tmp) puis le renomme vers le nom final', async () => {
    const writeCalls = []
    const renameCalls = []
    const originalWrite = storage.writeFile.bind(storage)
    const originalRename = storage.rename.bind(storage)
    storage.writeFile = async (path, data, opts) => {
      writeCalls.push(path)
      return originalWrite(path, data, opts)
    }
    storage.rename = async (from, to) => {
      renameCalls.push([from, to])
      return originalRename(from, to)
    }

    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)

    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    const json = JSON.parse(await storage.readFile(`${dir}/projet.json`))
    const photoTmpWrites = writeCalls.filter((p) => p.startsWith(`${dir}/photo-`) && p.endsWith('.tmp'))
    // Une écriture temporaire par photo (pas d'écriture directe sous le nom final).
    expect(photoTmpWrites).toHaveLength(json.photos.length)
    expect(writeCalls).not.toContain(`${dir}/${json.photos[0]}`)

    for (const name of json.photos) {
      const finalPath = `${dir}/${name}`
      // Chaque .tmp est suivi d'un rename vers le chemin final.
      expect(renameCalls).toContainEqual([`${finalPath}.tmp`, finalPath])
      expect(await storage.exists(finalPath)).toBe(true)
      // Le fichier temporaire ne traîne plus une fois le rename effectué.
      expect(await storage.exists(`${finalPath}.tmp`)).toBe(false)
    }
  })

  it('incrémental : si le fichier FINAL existe déjà, aucune écriture temporaire (pas de re-téléchargement)', async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)

    const calls = spyWrites(storage)
    await backupAll(storage, snapshot)

    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    const tmpWrites = calls.filter((p) => p.startsWith(`${dir}/photo-`) && p.endsWith('.tmp'))
    expect(tmpWrites).toHaveLength(0)
  })

  it('un résidu .tmp orphelin (écriture interrompue avant ce backup) est nettoyé — photo comme original.pdf', async () => {
    const snapshot = baseSnapshot()
    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    // Simule une écriture interrompue lors d'un backup précédent (appli tuée après
    // l'écriture du .tmp, avant le rename) : les résidus traînent dans le dossier.
    await storage.mkdir(dir)
    await storage.writeFile(`${dir}/photo-deadbeef.jpg.tmp`, 'AAAA', { encoding: 'base64' })
    await storage.writeFile(`${dir}/original.pdf.tmp`, 'BBBB', { encoding: 'base64' })

    await backupAll(storage, snapshot)

    expect(await storage.exists(`${dir}/photo-deadbeef.jpg.tmp`)).toBe(false)
    expect(await storage.exists(`${dir}/original.pdf.tmp`)).toBe(false)
  })
})

describe('backupAll — patron de bibliothèque et fichiers racine', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it('écrit un patron de bibliothèque et les fichiers racine (laines/compteurs/reglages)', async () => {
    const pattern = { id: 3, name: 'Twist Loop', photos: [PHOTO_A] }
    const snapshot = baseSnapshot({
      libraryPatterns: [pattern],
      yarns: [{ id: 1, brand: 'Katia', colorName: 'Bleu' }],
      independentCounters: [{ id: 9, projectId: 0, name: 'Rangs libres', value: 4 }],
      settings: { theme: 'clay', activeSession: 'peu importe' },
      keepIds: { projects: [7], patterns: [3] },
    })
    await backupAll(storage, snapshot)

    const patronDir = `Patrons/${entryFolderName('Twist Loop', 3)}`
    const patronJson = JSON.parse(await storage.readFile(`${patronDir}/patron.json`))
    expect(patronJson.name).toBe('Twist Loop')
    expect(patronJson.photos).toHaveLength(1)
    expect(await storage.exists(`${patronDir}/${patronJson.photos[0]}`)).toBe(true)

    const laines = JSON.parse(await storage.readFile('laines.json'))
    expect(laines).toEqual([{ id: 1, brand: 'Katia', colorName: 'Bleu' }])

    const compteurs = JSON.parse(await storage.readFile('compteurs.json'))
    expect(compteurs).toEqual([{ id: 9, projectId: 0, name: 'Rangs libres', value: 4 }])

    const reglages = JSON.parse(await storage.readFile('reglages.json'))
    expect(reglages).toEqual({ theme: 'clay' })
    expect(reglages.activeSession).toBeUndefined()
  })

  // Le fichier a DÉMÉNAGÉ dans `Laines/` le 21/08/2026 (retour terrain) ; `laines.json`,
  // lui, porte toujours le NOM NU — c'est ce qui permet de lire les deux dispositions.
  it('externalise la photo de laine en fichier laine-photo-* dans Laines/', async () => {
    const snapshot = baseSnapshot({
      yarns: [{ id: 1, brand: 'Katia', photo: PHOTO_A }],
    })
    await backupAll(storage, snapshot)

    const laines = JSON.parse(await storage.readFile('laines.json'))
    expect(laines[0].photo).toMatch(/^laine-photo-[0-9a-f]{8}\.jpg$/)
    expect(laines[0].photo).not.toContain('/') // un NOM, pas un chemin
    expect(await storage.exists(`Laines/${laines[0].photo}`)).toBe(true)
    expect(await storage.exists(laines[0].photo)).toBe(false) // plus rien à la racine
    const photoData = await storage.readFile(`Laines/${laines[0].photo}`, { encoding: 'base64' })
    expect(photoData).toBe('AAAA') // octets identiques à PHOTO_A
  })

  // Revue du 15/08/2026 — la MOITIÉ MANQUANTE d'une garantie. `serializeYarns` fournit
  // bien les photos avant `laines.json` (verrouillé par backup-serialize.spec.js), mais
  // rien ne vérifiait que l'orchestrateur les CONSOMME une par une. Remplacer la boucle
  // séquentielle par un `Promise.all` laissait 155 fichiers de tests verts — alors que
  // le commentaire de orchestrator.js désigne nommément cette réécriture comme celle qui
  // « casserait cette garantie silencieusement ».
  //
  // ⚠️ PIÈGE, éprouvé pendant la revue : enregistrer l'ordre des APPELS ne prouve rien —
  // sous `Promise.all`, les appels partent quand même dans l'ordre du tableau. Une
  // première version de ce test, écrite exprès pour attraper ce défaut, restait verte
  // sur le code cassé. Ce qui discrimine, c'est l'ordre des ACHÈVEMENTS, avec des photos
  // plus lentes que le petit JSON — ce qu'elles sont dans la réalité (plusieurs centaines
  // de Ko de base64 contre quelques Ko de texte).
  it("laines.json n'est publié qu'une fois toutes ses photos écrites (écriture séquentielle)", async () => {
    const acheves = []
    const vraiWrite = storage.writeFile.bind(storage)
    storage.writeFile = async (path, data, opts) => {
      await new Promise((r) => setTimeout(r, path.includes('laine-photo-') ? 20 : 0))
      const res = await vraiWrite(path, data, opts)
      acheves.push(path)
      return res
    }

    await backupAll(storage, {
      yarns: [
        { id: 1, brand: 'Katia', photo: PHOTO_A },
        { id: 2, brand: 'Drops', photo: PHOTO_B },
      ],
    })

    const iLaines = acheves.indexOf('laines.json')
    const photos = acheves.filter((p) => p.includes('laine-photo-'))
    expect(photos).toHaveLength(2)
    for (const p of photos) expect(acheves.indexOf(p)).toBeLessThan(iLaines)
  })
})

describe('backupAll — corbeille.json (index des ids en corbeille)', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  it('écrit corbeille.json avec les ids trashIds du snapshot, et compte dans written', async () => {
    const snapshot = baseSnapshot({ trashIds: { projects: [2], patterns: [9, 200] } })
    const stats = await backupAll(storage, snapshot)

    expect(await storage.exists('corbeille.json')).toBe(true)
    const corbeille = JSON.parse(await storage.readFile('corbeille.json'))
    expect(corbeille).toEqual({ projects: [2], patterns: [9, 200] })
    expect(stats.written).toBeGreaterThan(0)
  })

  it("écrit corbeille.json vide ({projects:[],patterns:[]}) si snapshot.trashIds est absent", async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)

    const corbeille = JSON.parse(await storage.readFile('corbeille.json'))
    expect(corbeille).toEqual({ projects: [], patterns: [] })
  })
})

describe('backupAll — la fiche d’identité (racine) est hors d’atteinte de reconcile', () => {
  let storage

  beforeEach(() => {
    storage = new MemoryBackupStorage()
  })

  // Vérifie ce que le commentaire d'en-tête de backup-manifest.js affirme : `reconcile`
  // ne balaie que `Projets/` et `Patrons/`, jamais la racine — donc un fichier posé à la
  // racine (comme sauvegarde.json) survit à une réconciliation qui, elle, supprime
  // réellement un dossier. Sans une suppression RÉELLE dans Projets/, ce test resterait
  // vert même si `reconcile` en venait à balayer la racine (rien ne serait démontré) —
  // d'où l'assertion sur `removeCalls`, en plus de la persistance du fichier de racine.
  it('un fichier de racine survit à une réconciliation qui supprime réellement un dossier Projets/', async () => {
    const snapshot = baseSnapshot()
    await backupAll(storage, snapshot)
    // Simule ce que `writeManifest` dépose à la racine, APRÈS backupAll — ici on
    // l'écrit directement sur le stockage, sans passer par backup-service.js
    // (hors-sujet pour ce test, qui porte sur `reconcile` seul).
    await storage.writeFile(MANIFEST_PATH, JSON.stringify({ ecritLe: 'x' }), { encoding: 'utf8' })

    const dir = `Projets/${entryFolderName('Pull Torsadé', 7)}`
    expect(await storage.exists(dir)).toBe(true)

    const removeCalls = []
    const originalRemove = storage.remove.bind(storage)
    storage.remove = async (path) => {
      removeCalls.push(path)
      return originalRemove(path)
    }

    // 2e backupAll : le projet 7 n'est plus dans keepIds → reconcile doit
    // effectivement supprimer son dossier sous Projets/.
    await backupAll(storage, baseSnapshot({ projects: [], keepIds: { projects: [], patterns: [] } }))

    // La suppression a réellement eu lieu (pas un test qui resterait vert même
    // si reconcile ne supprimait plus rien).
    expect(removeCalls).toContain(dir)
    expect(await storage.exists(dir)).toBe(false)

    // Le fichier de racine, lui, n'a pas été touché.
    expect(await storage.exists(MANIFEST_PATH)).toBe(true)
    expect(removeCalls).not.toContain(MANIFEST_PATH)
  })
})

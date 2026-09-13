// Les photos de laine vivent dans leur propre dossier `Laines/` (demande produit du
// 16/08/2026, arbitrée le 21/08 : « l'app doit classer les photos des laines dans leur
// propre dossier par défaut »).
//
// Avant ce lot, elles étaient posées EN VRAC à la racine de la sauvegarde : 31 photos
// pour 39 entrées, soit quatre entrées sur cinq. Les projets et les patrons avaient
// chacun leur dossier depuis toujours ; les laines étaient la seule exception.
//
// 🔑 Le format de `laines.json` ne change PAS : le champ `photo` garde le NOM NU du
// fichier (`laine-photo-<hash>.jpg`), jamais un chemin. C'est ce qui permet de lire les
// deux dispositions — racine (avant le 21/08) et `Laines/` (après) — avec le même
// `deserializeYarns`, sans une seconde forme de donnée à faire vivre.
//
// ⚠️ La tolérance de LECTURE de la racine est délibérée et n'est PAS provisoire : une
// sauvegarde oubliée sur un support ancien restaurerait sinon des laines **sans leurs
// photos, en silence**. L'ÉCRITURE, elle, ne se fait plus qu'au nouvel endroit.
import { describe, it, expect } from 'vitest'
import { serializeYarns } from '@/backup/serialize'
import { deserializeYarns } from '@/backup/deserialize'
import { readBackup } from '@/backup/restore'
import { backupAll } from '@/backup/orchestrator'
import { MemoryBackupStorage } from '@/backup/memory-storage'

const PHOTO = 'data:image/jpeg;base64,AAAA'

const snapshotAvecLaines = (yarns) => ({
  projects: [],
  patterns: [],
  yarns,
  purchases: [],
  activeDays: [],
  independentCounters: [],
  settings: {},
  trashIds: { projects: [], patterns: [] },
  keepIds: { projects: [], patterns: [] },
})

describe('serializeYarns écrit les photos dans Laines/', () => {
  it('le fichier part sous Laines/, le JSON ne garde que le nom nu', () => {
    const { files } = serializeYarns([{ id: 1, brand: 'Katia', photo: PHOTO }])
    const laines = JSON.parse(files.find((f) => f.path === 'laines.json').data)

    // Le JSON porte le NOM, pas le chemin : c'est la clé de `filesByName`.
    expect(laines[0].photo).toMatch(/^laine-photo-[0-9a-f]{8}\.jpg$/)
    expect(laines[0].photo).not.toContain('/')

    // Le fichier, lui, part dans le dossier.
    const photo = files.find((f) => f.path !== 'laines.json')
    expect(photo.path).toBe(`Laines/${laines[0].photo}`)
    expect(photo.encoding).toBe('base64')
    expect(photo.data).toBe('AAAA') // octets d'origine, aucune recompression
  })

  it('laines.json reste le DERNIER fichier écrit', () => {
    // L'orchestrateur écrit `rootFiles` séquentiellement dans l'ordre du tableau. Une
    // écriture interrompue ne doit jamais publier un laines.json qui pointe vers un
    // fichier pas encore écrit — l'invariant tient quel que soit le dossier.
    const { files } = serializeYarns([{ id: 1, photo: PHOTO }])
    expect(files[files.length - 1].path).toBe('laines.json')
  })
})

describe('la restauration lit les DEUX dispositions', () => {
  it('rend la photo quand le fichier est dans Laines/ (sauvegarde neuve)', async () => {
    const storage = new MemoryBackupStorage()
    await backupAll(storage, snapshotAvecLaines([{ id: 1, brand: 'Katia', photo: PHOTO }]))

    const lu = await readBackup(storage)
    expect(lu.yarns[0].photo).toBe(PHOTO)
    // Et le fichier est bien rangé, pas à la racine.
    const racine = await storage.readdir('')
    expect(racine.some((e) => e.name.startsWith('laine-photo-'))).toBe(false)
    expect((await storage.readdir('Laines')).length).toBe(1)
  })

  it('rend la photo quand le fichier est resté à la racine (sauvegarde d’avant le 21/08)', async () => {
    // Reconstruit à la main l'ANCIENNE disposition : le fichier à la racine, exactement
    // comme les 31 photos mesurées sur les deux appareils le 21/08/2026.
    const storage = new MemoryBackupStorage()
    await storage.writeFile('laine-photo-deadbeef.jpg', 'AAAA', { encoding: 'base64' })
    await storage.writeFile(
      'laines.json',
      JSON.stringify([{ id: 1, brand: 'Katia', photo: 'laine-photo-deadbeef.jpg' }]),
      { encoding: 'utf8' },
    )

    const lu = await readBackup(storage)
    expect(lu.yarns[0].photo).toBe(PHOTO)
  })

  it('une laine sans photo traverse les deux chemins sans y toucher', () => {
    expect(deserializeYarns([{ id: 2, brand: 'Katia', photo: null }], {})).toEqual([
      { id: 2, brand: 'Katia', photo: null },
    ])
  })
})

describe('le ménage emporte les photos de laine orphelines', () => {
  it('supprime de Laines/ un fichier que plus aucune laine ne référence', async () => {
    const storage = new MemoryBackupStorage()
    await backupAll(storage, snapshotAvecLaines([{ id: 1, photo: PHOTO }]))
    const avant = (await storage.readdir('Laines')).map((e) => e.name)
    expect(avant.length).toBe(1)

    // La laine perd sa photo : le fichier n'est plus référencé par personne.
    const stats = await backupAll(storage, snapshotAvecLaines([{ id: 1, photo: null }]))

    expect((await storage.readdir('Laines')).length).toBe(0)
    expect(stats.removed).toBeGreaterThan(0)
  })

  it('ne touche PAS un fichier encore référencé', async () => {
    const storage = new MemoryBackupStorage()
    await backupAll(storage, snapshotAvecLaines([{ id: 1, photo: PHOTO }]))
    const nom = (await storage.readdir('Laines'))[0].name

    // Deuxième sauvegarde identique : rien ne doit disparaître.
    await backupAll(storage, snapshotAvecLaines([{ id: 1, photo: PHOTO }]))
    expect((await storage.readdir('Laines')).map((e) => e.name)).toEqual([nom])
  })

  it('ne touche pas un fichier étranger déposé à la main dans Laines/', async () => {
    // Même prudence que `reconcile` pour Projets/Patrons : un fichier qui ne suit pas la
    // convention `laine-photo-*` n'a pas été écrit par l'app — on le laisse tranquille.
    const storage = new MemoryBackupStorage()
    await storage.writeFile('Laines/notes-alexia.txt', 'AAAA', { encoding: 'base64' })
    await backupAll(storage, snapshotAvecLaines([{ id: 1, photo: PHOTO }]))

    const noms = (await storage.readdir('Laines')).map((e) => e.name)
    expect(noms).toContain('notes-alexia.txt')
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/backup/device-identity', () => ({
  deviceId: async () => 'moi-42',
  deviceName: async () => 'LYA-L29',
}))
const counts = { projects: 6, yarns: 31 }
// Fixtures discriminantes : le mock applique VRAIMENT le prédicat reçu, il ne renvoie pas
// un nombre en dur. Sans ça, un prédicat inversé ou absent (ex. `filter(() => true)`)
// laisserait le test vert — c'est le défaut réel corrigé ici après revue.
const patternFixtures = [
  { id: 1, builtin: false, ownerProjectId: null },   // bibliothèque — compte
  { id: 2, builtin: false, ownerProjectId: null },   // bibliothèque — compte
  { id: 3, builtin: true, ownerProjectId: null },    // patron `builtin` (projet libre) — ne compte pas
  { id: 4, builtin: false, ownerProjectId: 42 },     // instance forkée d'un projet — ne compte pas
]
const LIBRARY_PATTERNS_COUNT = 2
vi.mock('@/db/db', () => ({
  db: {
    projects: { count: async () => counts.projects },
    patterns: { filter: (fn) => ({ count: async () => patternFixtures.filter(fn).length }) },
    yarns: { count: async () => counts.yarns },
  },
}))

import { buildManifest, writeManifest, readManifest, MANIFEST_PATH } from '@/backup/backup-manifest'

function fakeStorage(files = {}) {
  return {
    files,
    exists: async (p) => Object.hasOwn(files, p),
    readFile: async (p) => { if (!Object.hasOwn(files, p)) throw new Error('ENOENT'); return files[p] },
    writeFile: async (p, data) => { files[p] = data },
  }
}

describe('backup-manifest', () => {
  it('la fiche porte l’appareil, le modèle et les décomptes', async () => {
    const m = await buildManifest()
    expect(m.version).toBe(1)
    expect(m.appareil).toBe('moi-42')
    expect(m.modeleAppareil).toBe('LYA-L29')
    expect(m.contenu).toEqual({ projets: 6, patrons: LIBRARY_PATTERNS_COUNT, laines: 31 })
    expect(Date.parse(m.ecritLe)).not.toBeNaN()
  })

  it('les patrons sont comptés AVEC un prédicat, pas par un db.patterns.count() nu', async () => {
    // Le mock applique le prédicat reçu à des fixtures qui discriminent réellement les
    // trois cas (bibliothèque / builtin / instance forkée) : si `backup-manifest.js`
    // inversait le prédicat ou ne filtrait plus rien, ce test rougirait. Le mock de
    // `db.patterns` n'expose QUE `filter` : un `count()` direct lèverait.
    const m = await buildManifest()
    expect(m.contenu.patrons).toBe(LIBRARY_PATTERNS_COUNT)
  })

  it('writeManifest écrit à la racine, en JSON lisible', async () => {
    const s = fakeStorage()
    expect(await writeManifest(s)).toBe(true)
    expect(Object.keys(s.files)).toEqual([MANIFEST_PATH])
    expect(JSON.parse(s.files[MANIFEST_PATH]).appareil).toBe('moi-42')
    expect(s.files[MANIFEST_PATH]).toContain('\n')   // indenté, lisible à l'œil nu
  })

  it('writeManifest renvoie false et NE LÈVE PAS si l’écriture échoue', async () => {
    const s = fakeStorage()
    s.writeFile = async () => { throw new Error('E/S') }
    await expect(writeManifest(s)).resolves.toBe(false)
  })

  it('fiche ABSENTE → state "absent" (sauvegarde antérieure au lot)', async () => {
    expect(await readManifest(fakeStorage())).toEqual({ state: 'absent' })
  })

  it('fiche ILLISIBLE → state "invalid", JAMAIS "absent"', async () => {
    const s = fakeStorage({ [MANIFEST_PATH]: '{ pas du json' })
    expect((await readManifest(s)).state).toBe('invalid')
  })

  it('fiche sans champ `appareil` → "invalid" (on ne devine pas une identité)', async () => {
    const s = fakeStorage({ [MANIFEST_PATH]: JSON.stringify({ version: 1 }) })
    expect((await readManifest(s)).state).toBe('invalid')
  })

  it('fiche valide → state "ok" et la fiche', async () => {
    const s = fakeStorage()
    await writeManifest(s)
    const r = await readManifest(s)
    expect(r.state).toBe('ok')
    expect(r.manifest.appareil).toBe('moi-42')
  })
})

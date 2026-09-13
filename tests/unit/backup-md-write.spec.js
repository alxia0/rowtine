// Rowtine — critère de sortie du lot N1 (MD en écriture).
// Test d'intégration bout-en-bout : lance le vrai orchestrateur (`backupAll`, non
// modifié) contre un `MemoryBackupStorage` et vérifie que le `patron.md` émis par
// serialize est fidèle (toutes ses images référencées existent comme fichiers dans
// le dossier), que le hash témoin dans `patron.json` correspond, et — invariant clé
// de conception — que ces images survivent à un second passage de sauvegarde (le
// balayage des orphelins de l'orchestrateur ne doit rien casser).
import { describe, it, expect } from 'vitest'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { backupAll } from '@/backup/orchestrator'
import { hash8 } from '@/backup/naming'

// Snapshot minimal : 1 patron de bibliothèque avec image d'étape + galerie.
function snapshot() {
  return {
    libraryPatterns: [{ id: 1, name: 'Torsade', reader: { sizeLabels: [], sections: [
      { title: 'Corps', steps: [{ t: 'monter', imgs: ['data:image/jpeg;base64,QUJD'] }] },
    ] }, gallery: [{ src: 'data:image/jpeg;base64,REVG', page: 3 }] }],
    projects: [], yarns: [], independentCounters: [], settings: {},
    keepIds: { projects: [], patterns: [1] }, trashIds: { projects: [], patterns: [] },
  }
}

describe('N1 — écriture du patron.md à la sauvegarde', () => {
  it('CRITÈRE : chaque image référencée par le patron.md existe comme fichier', async () => {
    const s = new MemoryBackupStorage()
    await backupAll(s, snapshot())
    const dir = 'Patrons/torsade [1]'
    const md = await s.readFile(`${dir}/patron.md`)
    const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(await s.exists(`${dir}/${ref}`)).toBe(true)
    }
  })

  it('patron.json porte patronMd.hash == hash8(patron.md)', async () => {
    const s = new MemoryBackupStorage()
    await backupAll(s, snapshot())
    const dir = 'Patrons/torsade [1]'
    const md = await s.readFile(`${dir}/patron.md`)
    const json = JSON.parse(await s.readFile(`${dir}/patron.json`))
    expect(json.patronMd.hash).toBe(hash8(md))
  })

  it('ORCHESTRATEUR INTACT : les images du .md survivent à un 2e passage (pas balayées comme orphelines)', async () => {
    const s = new MemoryBackupStorage()
    await backupAll(s, snapshot())
    await backupAll(s, snapshot()) // 2e passage : le balayage des orphelins ne doit rien casser
    const dir = 'Patrons/torsade [1]'
    const md = await s.readFile(`${dir}/patron.md`)
    const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    // Garantit qu'on exerce bien le balayage des orphelins : une image d'étape
    // (préfixe `photo-`, la SEULE famille candidate à la suppression) doit être
    // référencée — sinon le test passerait sans rien prouver (la galerie
    // `gallery-` n'est jamais balayée, cf. isManagedHeavyFile).
    expect(refs.some((r) => r.startsWith('photo-'))).toBe(true)
    for (const ref of refs) {
      expect(await s.exists(`${dir}/${ref}`)).toBe(true)
    }
  })
})

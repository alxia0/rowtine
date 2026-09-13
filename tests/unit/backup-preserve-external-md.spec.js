// Unitaire — invariant anti-écrasement (revue) : une sauvegarde
// auto (debounce sur mutation, sans synchro en cours) ne doit JAMAIS régénérer
// le `patron.md` d'une entrée dont le témoin (`patron.json.patronMd.hash`) ne
// correspond plus au `patron.md` sur disque — signe qu'une édition externe
// (PC) est en attente de fusion par la prochaine synchro MD. Les gardes
// d'exclusion mutuelle (isAutoBackupRunning/isSyncRunning) protègent contre le
// chevauchement backup↔sync, mais PAS contre ce cas : aucune synchro ne
// tourne, c'est une sauvegarde ordinaire qui écraserait silencieusement
// l'édition externe non encore fusionnée.
import { describe, it, expect } from 'vitest'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { backupAll } from '@/backup/orchestrator'
import { hash8 } from '@/backup/naming'

// Snapshot minimal : 1 patron de bibliothèque avec lecteur interactif (donc un
// patron.md est émis). `sections` paramétrable pour faire varier le rendu du
// .md entre deux sérialisations (cas normal, cf. 2e test).
function snapshot({ title = 'Corps' } = {}) {
  return {
    libraryPatterns: [
      {
        id: 1,
        name: 'Torsade',
        reader: { sizeLabels: [], sections: [{ title, steps: [{ t: 'monter' }] }] },
      },
    ],
    projects: [],
    yarns: [],
    independentCounters: [],
    settings: {},
    keepIds: { projects: [], patterns: [1] },
    trashIds: { projects: [], patterns: [] },
  }
}

const DIR = 'Patrons/torsade [1]'

describe('backupAll — préservation d’une édition externe de patron.md non fusionnée', () => {
  it("N'ÉCRASE PAS un patron.md édité en externe (témoin périmé) — invariant central", async () => {
    const storage = new MemoryBackupStorage()

    // 1) Sauvegarde initiale : disque = A, témoin = hash(A).
    await backupAll(storage, snapshot())
    const mdA = await storage.readFile(`${DIR}/patron.md`)
    const jsonA = JSON.parse(await storage.readFile(`${DIR}/patron.json`))
    expect(jsonA.patronMd.hash).toBe(hash8(mdA))

    // 2) Édition externe (PC) : disque devient B, témoin PAS touché (reste hash(A)).
    const mdB = mdA + '\n\nUn paragraphe ajouté à la main sur PC.\n'
    await storage.writeFile(`${DIR}/patron.md`, mdB, { encoding: 'utf8' })
    expect(hash8(mdB)).not.toBe(jsonA.patronMd.hash)

    // 3) Une sauvegarde auto se déclenche (mutation en base sans rapport, DB
    // toujours = A) — simulée ici par un 2e backupAll avec le MÊME snapshot.
    await backupAll(storage, snapshot())

    // 4) L'édition externe doit survivre intacte, et le témoin ne doit PAS
    // avoir été réaligné sur le contenu régénéré (sinon la prochaine synchro
    // MD croirait, à tort, que rien n'a changé et perdrait B pour de bon).
    const mdAfter = await storage.readFile(`${DIR}/patron.md`)
    const jsonAfter = JSON.parse(await storage.readFile(`${DIR}/patron.json`))
    expect(mdAfter).toBe(mdB)
    expect(jsonAfter.patronMd.hash).toBe(jsonA.patronMd.hash)
  })

  it('cas normal : un dossier dont le disque est cohérent avec son témoin EST régénéré à la sauvegarde', async () => {
    const storage = new MemoryBackupStorage()

    await backupAll(storage, snapshot({ title: 'Corps' }))
    const mdBefore = await storage.readFile(`${DIR}/patron.md`)

    // Changement côté DB (pas d'édition externe entre-temps : disque toujours
    // cohérent avec son propre témoin) → la régénération normale doit avoir lieu.
    await backupAll(storage, snapshot({ title: 'Manches' }))
    const mdAfter = await storage.readFile(`${DIR}/patron.md`)
    const jsonAfter = JSON.parse(await storage.readFile(`${DIR}/patron.json`))

    expect(mdAfter).not.toBe(mdBefore)
    expect(jsonAfter.patronMd.hash).toBe(hash8(mdAfter))
  })

  // Le témoin ne doit JAMAIS être publié avant le patron.md qu'il décrit — même règle
  // que `laines.json` après ses `laine-photo-*` (cf. backup-orchestrator.spec.js), et
  // pour la même raison : un fichier qui en RÉFÉRENCE d'autres ne se publie qu'une fois
  // ceux-ci sur disque. Dans l'ordre inverse, une écriture interrompue entre patron.json
  // et patron.md laissait le NOUVEAU témoin face à l'ANCIEN md : `hasPendingExternalMdEdit`
  // y lisait une édition externe et sautait l'entrée EN ENTIER à chaque sauvegarde
  // suivante — définitivement, puisque plus rien ne réécrivait ce patron.md.
  it("une écriture interrompue avant le patron.md ne fige pas l'entrée (témoin publié en dernier)", async () => {
    const storage = new MemoryBackupStorage()

    // 1) Sauvegarde initiale cohérente : disque = A, témoin = hash(A).
    await backupAll(storage, snapshot({ title: 'Corps' }))
    const mdA = await storage.readFile(`${DIR}/patron.md`)

    // 2) La DB change (le .md régénéré vaudrait B), mais l'app est tuée pile pendant
    //    l'écriture du patron.md — simulé par un writeFile qui lève sur ce seul chemin.
    const vraiWrite = storage.writeFile.bind(storage)
    storage.writeFile = async (path, data, opts) => {
      if (path === `${DIR}/patron.md`) throw new Error('processus tué pendant l’écriture')
      return vraiWrite(path, data, opts)
    }
    await expect(backupAll(storage, snapshot({ title: 'Manches' }))).rejects.toThrow()
    storage.writeFile = vraiWrite

    // Le disque est resté COHÉRENT : le témoin n'a pas pu prendre de l'avance sur le md.
    const mdTorn = await storage.readFile(`${DIR}/patron.md`)
    const jsonTorn = JSON.parse(await storage.readFile(`${DIR}/patron.json`))
    expect(mdTorn).toBe(mdA)
    expect(jsonTorn.patronMd.hash).toBe(hash8(mdTorn))

    // 3) Donc la sauvegarde suivante repart normalement — l'entrée n'est pas figée.
    await backupAll(storage, snapshot({ title: 'Manches' }))
    const mdAfter = await storage.readFile(`${DIR}/patron.md`)
    const jsonAfter = JSON.parse(await storage.readFile(`${DIR}/patron.json`))
    expect(mdAfter).not.toBe(mdA)
    expect(jsonAfter.patronMd.hash).toBe(hash8(mdAfter))
  })

  // MÊME invariant, MÊME correctif, sur l'AUTRE producteur de patron.md : le patron
  // forké d'un projet (`serializeProject`), dont le patron.json vit dans le dossier du
  // PROJET. Sans ce test, seul le chemin `Patrons/` était épinglé et le chemin
  // `Projets/` pouvait se re-casser en silence.
  it("idem pour le patron forké d'un projet (patron.json du dossier Projets publié en dernier)", async () => {
    const storage = new MemoryBackupStorage()
    const projDir = 'Projets/mon-pull [5]'
    const projSnapshot = (title) => ({
      projects: [
        {
          id: 5,
          name: 'Mon pull',
          photos: [],
          instancePattern: {
            id: 9,
            name: 'Torsade',
            ownerProjectId: 5,
            reader: { sizeLabels: [], sections: [{ title, steps: [{ t: 'monter' }] }] },
          },
        },
      ],
      libraryPatterns: [],
      yarns: [],
      independentCounters: [],
      settings: {},
      keepIds: { projects: [5], patterns: [] },
      trashIds: { projects: [], patterns: [] },
    })

    await backupAll(storage, projSnapshot('Corps'))
    const mdA = await storage.readFile(`${projDir}/patron.md`)

    const vraiWrite = storage.writeFile.bind(storage)
    storage.writeFile = async (path, data, opts) => {
      if (path === `${projDir}/patron.md`) throw new Error('processus tué pendant l’écriture')
      return vraiWrite(path, data, opts)
    }
    await expect(backupAll(storage, projSnapshot('Manches'))).rejects.toThrow()
    storage.writeFile = vraiWrite

    // Témoin et md toujours d'accord → l'entrée n'est pas figée.
    const jsonTorn = JSON.parse(await storage.readFile(`${projDir}/patron.json`))
    expect(await storage.readFile(`${projDir}/patron.md`)).toBe(mdA)
    expect(jsonTorn.patronMd.hash).toBe(hash8(mdA))

    await backupAll(storage, projSnapshot('Manches'))
    const mdAfter = await storage.readFile(`${projDir}/patron.md`)
    const jsonAfter = JSON.parse(await storage.readFile(`${projDir}/patron.json`))
    expect(mdAfter).not.toBe(mdA)
    expect(jsonAfter.patronMd.hash).toBe(hash8(mdAfter))
  })
})

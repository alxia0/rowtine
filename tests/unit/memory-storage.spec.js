import { describe, expect, it } from 'vitest'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { runBackupStorageContract } from './backup-storage-contract'

runBackupStorageContract(describe, it, expect, () => new MemoryBackupStorage())

// Restauration lourde : readdir rend la TAILLE des fichiers (l'octet est
// l'unité de la sous-barre de lecture du dossier en cours) et readFile accepte
// `onChunk` — UNE émission, en fin de lecture, avec la longueur réelle en octets.
// Parité de FORME avec le pont natif (qui émet par tranche) : restore.js ne doit
// dépendre d'aucune granularité, et rien ne coûte un découpage ici (un fake en
// mémoire n'a pas d'aller-retour à économiser).
describe('MemoryBackupStorage — size (readdir) et onChunk (readFile)', () => {
  it('readdir rend la taille réelle en OCTETS des fichiers (multi-octets comptés justement), 0 pour un dossier', async () => {
    const s = new MemoryBackupStorage()
    await s.writeFile('a/héllo.txt', 'héllo') // « é » vaut 2 octets en UTF-8 → 6 au total
    await s.writeFile('a/photo.bin', 'AAAA', { encoding: 'base64' }) // 3 octets décodés
    await s.mkdir('a/sub')
    const entries = (await s.readdir('a')).sort((p, q) => p.name.localeCompare(q.name))
    expect(entries).toEqual([
      { name: 'héllo.txt', isDir: false, size: 6 },
      { name: 'photo.bin', isDir: false, size: 3 },
      { name: 'sub', isDir: true, size: 0 },
    ])
  })

  it('readFile appelle onChunk UNE fois à la fin, avec le nombre d’octets du fichier (quel que soit l’encodage demandé)', async () => {
    const s = new MemoryBackupStorage()
    await s.writeFile('gros.txt', 'héllo')

    const vus = []
    expect(await s.readFile('gros.txt', { onChunk: (n) => vus.push(n) })).toBe('héllo')
    expect(vus).toEqual([6])

    const vusB64 = []
    await s.readFile('gros.txt', { encoding: 'base64', onChunk: (n) => vusB64.push(n) })
    expect(vusB64).toEqual([6])
  })

  it('onChunk reste optionnel : sans lui, le contrat de readFile est inchangé', async () => {
    const s = new MemoryBackupStorage()
    await s.writeFile('a.txt', 'coucou')
    expect(await s.readFile('a.txt')).toBe('coucou')
  })
})

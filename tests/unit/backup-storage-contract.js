// Contrat commun à toute implémentation de BackupStorage.
// Réutilisé par memory-storage.spec.js (et, plus tard, validé sur device pour le natif).
export function runBackupStorageContract(describe, it, expect, makeStorage) {
  describe('BackupStorage (contrat)', () => {
    it('écrit puis relit un fichier texte', async () => {
      const s = makeStorage()
      await s.writeFile('a.txt', 'coucou')
      expect(await s.readFile('a.txt')).toBe('coucou')
    })

    it('crée les dossiers parents à l\'écriture', async () => {
      const s = makeStorage()
      await s.writeFile('Projets/x/projet.json', '{}')
      expect(await s.exists('Projets/x/projet.json')).toBe(true)
      expect(await s.exists('Projets/x')).toBe(true)
    })

    it('mkdir est récursif et idempotent', async () => {
      const s = makeStorage()
      await s.mkdir('a/b/c')
      await s.mkdir('a/b/c') // pas d'erreur la 2e fois
      expect(await s.exists('a/b/c')).toBe(true)
    })

    it('readdir liste les enfants immédiats avec isDir et size (octets du fichier, 0 pour un dossier)', async () => {
      const s = makeStorage()
      await s.writeFile('root/f.txt', 'x') // 1 octet
      await s.mkdir('root/sub')
      const entries = (await s.readdir('root')).sort((p, q) => p.name.localeCompare(q.name))
      expect(entries).toEqual([
        { name: 'f.txt', isDir: false, size: 1 },
        { name: 'sub', isDir: true, size: 0 },
      ])
    })

    it('readFile accepte onChunk : au moins un cumul émis, le dernier = la taille du fichier en octets', async () => {
      const s = makeStorage()
      await s.writeFile('root/cumuls.txt', 'coucou') // 6 octets utf8
      const cums = []
      await s.readFile('root/cumuls.txt', { onChunk: (n) => cums.push(n) })
      // Une implémentation qui IGNORerait l'option doit échouer ici : c'est de ces
      // cumuls que vit la sous-barre de lecture (restore.js). Le cumul final doit
      // être lisible par l'appelant (les octets du fichier), pas un simple signal.
      expect(cums.length).toBeGreaterThan(0)
      expect(cums.at(-1)).toBe(6)
    })

    it('exists renvoie false pour un chemin absent', async () => {
      const s = makeStorage()
      expect(await s.exists('nope.txt')).toBe(false)
    })

    it('remove supprime un dossier récursivement et est idempotent', async () => {
      const s = makeStorage()
      await s.writeFile('d/f.txt', 'x')
      await s.remove('d')
      expect(await s.exists('d')).toBe(false)
      await s.remove('d') // idempotent
    })

    it('rename déplace un fichier (crée les parents cibles)', async () => {
      const s = makeStorage()
      await s.writeFile('old.txt', 'v')
      await s.rename('old.txt', 'Projets/new.txt')
      expect(await s.exists('old.txt')).toBe(false)
      expect(await s.readFile('Projets/new.txt')).toBe('v')
    })

    it('gère l\'encodage base64', async () => {
      const s = makeStorage()
      // "hi" en base64 = "aGk="
      await s.writeFile('b.bin', 'aGk=', { encoding: 'base64' })
      expect(await s.readFile('b.bin', { encoding: 'base64' })).toBe('aGk=')
      expect(await s.readFile('b.bin')).toBe('hi') // relu en utf8
    })

    it('préserve fidèlement des octets binaires en base64', async () => {
      const s = makeStorage()
      const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD' // en-tête JPEG, octets non-UTF8
      await s.writeFile('photo.jpg', jpeg, { encoding: 'base64' })
      expect(await s.readFile('photo.jpg', { encoding: 'base64' })).toBe(jpeg)
    })

    it('écraser un dossier par un fichier ne laisse pas d’enfants fantômes', async () => {
      const s = makeStorage()
      await s.writeFile('x/child.txt', 'a')
      await s.writeFile('x', 'maintenant un fichier')
      expect(await s.exists('x')).toBe(true)
      expect(await s.readFile('x')).toBe('maintenant un fichier')
      expect(await s.readdir('x')).toEqual([]) // plus d'enfant fantôme
    })

    it('rename sur une destination existante la remplace (pas de fusion)', async () => {
      const s = makeStorage()
      await s.writeFile('dst/old.txt', 'vieux')
      await s.writeFile('tmp/new.txt', 'neuf')
      await s.rename('tmp', 'dst')
      expect(await s.exists('dst/old.txt')).toBe(false)
      expect(await s.readFile('dst/new.txt')).toBe('neuf')
    })

    it('remove("") / remove(undefined) ne supprime pas la racine', async () => {
      const s = makeStorage()
      await s.writeFile('Projets/p.json', 'x')
      await s.remove('')
      await s.remove(undefined)
      expect(await s.exists('Projets/p.json')).toBe(true)
    })

    it('refuse un chemin qui s’échappe de la racine (..)', async () => {
      const s = makeStorage()
      await expect(s.writeFile('../evil.txt', 'x')).rejects.toThrow()
    })

    it('rename d’un chemin sur lui-même est un no-op sûr', async () => {
      const s = makeStorage()
      await s.writeFile('a/f.txt', 'v')
      await s.rename('a', 'a')
      expect(await s.readFile('a/f.txt')).toBe('v')
    })
  })
}

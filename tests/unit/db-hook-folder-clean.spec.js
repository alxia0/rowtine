// @vitest-environment jsdom
// Unitaire — hook Dexie `auto-backup-on-mutate` (src/db/db.js), volet lot
// « restauration lourde » (06/09/2026) : à chaque mutation réussie, ce hook arme la
// sauvegarde débouncée (couverte indirectement par toute la suite)
// et doit AUSSI effacer le drapeau « dossier propre depuis la restauration »
// (restore-guard.js) : toute écriture locale rend le dossier potentiellement
// divergent de la base, le silence automatique posé par `runRestore` ne survit donc
// pas à la première mutation — quelle qu'elle soit, sur n'importe quelle table (le
// middleware `dbcore` voit TOUTES les écritures).
// Le VRAI middleware est exercé ici contre fake-indexeddb (cf. tests/unit/setup.js) ;
// restore-guard.js est importé réel (module pur, sans dépendance).
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { clearFolderClean, isFolderCleanSinceRestore, markFolderClean } from '@/backup/restore-guard'

beforeEach(async () => {
  await db.open()
  // Le vidage des tables passe LUI-MÊME par le hook (ce sont des mutations) : on
  // remet le drapeau APRÈS, pour que chaque test parte d'un état connu.
  await Promise.all(db.tables.map((t) => t.clear()))
  clearFolderClean()
})

describe('hook auto-backup-on-mutate — drapeau « dossier propre depuis la restauration »', () => {
  it('une mutation (add) efface le drapeau', async () => {
    markFolderClean()
    expect(isFolderCleanSinceRestore()).toBe(true) // précondition

    await db.yarns.add({ brand: 'Une laine' })

    expect(isFolderCleanSinceRestore()).toBe(false)
  })

  it('une mutation (update) efface le drapeau aussi — toute écriture compte, pas seulement les créations', async () => {
    await db.projects.add({ name: 'Écharpe' })
    markFolderClean()
    expect(isFolderCleanSinceRestore()).toBe(true) // précondition

    await db.projects.update(1, { name: 'Écharpe renommée' })

    expect(isFolderCleanSinceRestore()).toBe(false)
  })

  it('une lecture seule ne touche pas au drapeau (seules les mutations effacent)', async () => {
    markFolderClean()

    await db.settings.get('clé-inexistante')
    await db.yarns.toArray()

    expect(isFolderCleanSinceRestore()).toBe(true)
  })
})

// Garde « moteur unique » — REMPLACE l'ancien `tools/check-engine-parity.mjs`
// (convergence du 2026-07-08). Ce script diffait BYTE À BYTE deux copies du moteur entre
// deux WORKTREES (`lab/md-bench` / `lab/md-editor`) ; il a été retiré à la
// convergence mono-branche du 2026-07-12
// car il n'y a plus de second worktree avec lequel diverger.
//
// Dans le monde mono-dépôt actuel, le risque de divergence n'est plus
// "deux copies différent" mais "une copie fantôme réapparaît sous
// l'ancien chemin de l'éditeur Markdown de dev" (le banc réimporte/recopie un fichier déjà promu dans src/,
// au lieu d'importer depuis src/). Cette garde vérifie donc :
//   1. chaque fichier promu (en deux vagues) existe UNIQUEMENT sous son
//      nouveau chemin src/ ;
//   2. aucun fichier de même nom n'existe encore sous son ancien chemin
//      dans l'éditeur Markdown de dev (pas de copie divergente réintroduite).
//
// Si ce test échoue après un futur refactor, c'est probablement qu'un fichier
// moteur a été recopié dans l'ancien chemin de l'éditeur Markdown de dev au lieu d'être importé depuis src/.
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// vitest est toujours lancé depuis la racine du dépôt (yarn vitest run …,
// cf. package.json) : process.cwd() est fiable ici (pas de résolution par
// import.meta.url, qui pointe vers un module virtuel sous vitest v4).
const ROOT = process.cwd()

// [ancien chemin dans l'éditeur Markdown de dev, nouveau chemin src/...] — promotions
// en deux vagues (moteur pur de retag, puis éditeur CM6 + résolution images).
const PROMOTED_FILES = [
  ['tools/mdedit/md-line-type.js', 'src/utils/pattern-md/md-line-type.js'],
  ['tools/mdedit/md-retag.js', 'src/utils/pattern-md/md-retag.js'],
  ['tools/mdedit/md-retag-selection.js', 'src/utils/pattern-md/md-retag-selection.js'],
  ['tools/mdedit/resolve-images.js', 'src/utils/pattern-md/resolve-images.js'],
  ['tools/mdedit/resolve-image-src.js', 'src/utils/pattern-md/resolve-image-src.js'],
  ['tools/mdedit/cm-editor.js', 'src/components/cm/cm-editor.js'],
]

describe('garde moteur unique (remplace check-engine-parity)', () => {
  for (const [oldPath, newPath] of PROMOTED_FILES) {
    it(`${newPath} : promu dans src/, aucune copie fantôme sous ${oldPath}`, () => {
      expect(existsSync(join(ROOT, newPath))).toBe(true)
      expect(existsSync(join(ROOT, oldPath))).toBe(false)
    })
  }
})

// Garde « moteur unique » : chaque fichier moteur promu dans src/ n'existe que là, sans
// copie fantôme réapparue sous son ancien chemin de l'éditeur Markdown de dev (tools/mdedit),
// qui divergerait en silence au lieu d'importer depuis src/.
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

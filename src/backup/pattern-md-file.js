// Rowtine — pont sauvegarde ↔ Rowtine-MD (Lot N1). Pur, sans IO.
// Émet le patron.md d'une entité (patron de bibliothèque ou instancePattern d'un
// projet) DANS son dossier de sauvegarde, avec un nommage d'assets aligné sur la
// sauvegarde (préfixes plats photo-/gallery-, mêmes hash de contenu que naming.js) —
// de sorte que les images référencées par le .md sont les fichiers déjà écrits par
// serialize (dédup par chemin) plus les images d'étapes/diagramme (nouveaux fichiers).
// Le hash témoin (hash8 du md exact) permettra à N2 de détecter une édition externe.
import { patternToMd } from '@/utils/pattern-md'
import { hash8 } from './naming'

export function buildPatternMdFiles(entity, dir) {
  const { md, files } = patternToMd(entity, { assetDir: '', galleryPrefix: 'gallery-' })
  const mdFile = { path: `${dir}/patron.md`, data: md, encoding: 'utf8' }
  // Préfixe les chemins d'assets par le dossier de l'entité (patternToMd les émet
  // relatifs à assetDir='' → noms nus). Dédup par chemin (noms par hash de contenu).
  const seen = new Set()
  const assetFiles = []
  for (const f of files) {
    const path = `${dir}/${f.path}`
    if (seen.has(path)) continue
    seen.add(path)
    assetFiles.push({ path, data: f.data, encoding: f.encoding })
  }
  return { mdFile, assetFiles, hash: hash8(md) }
}

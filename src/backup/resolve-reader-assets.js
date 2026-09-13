// Rowtine — résolution des chemins d'images d'un patron issu du MD.
//
// `mdToPattern` renvoie les images en CHEMINS NUS (`photo-<hash>.jpg`,
// `gallery-<hash>.jpg`, cf. src/utils/pattern-md/parse.js) : ce sont les noms de
// fichiers du dossier de sauvegarde. L'app, elle, stocke des data URLs inline en
// base de données. `resolveReaderAssets` fait le pont : pour chaque chemin nu
// rencontré dans le reader (imgs d'étape — y compris l'intro, qui est une section
// comme les autres — `reader.chart.img` et `section.chart.img` pour les grilles
// multi-diagrammes) et dans la galerie (`gallery[].src`),
// on cherche le fichier correspondant dans `filesByName` et on le remplace par sa
// data URL (via `fileToDataUrl`, déjà écrit dans deserialize.js — mime dérivé de
// l'extension, non réimplémenté ici).
//
// Une valeur déjà en data URL (inline) est laissée intacte : ce n'est pas un
// chemin à résoudre. Un chemin sans fichier correspondant est laissé tel quel et
// signalé dans `missing` (pour le rapport de synchro) — jamais d'erreur
// jetée, jamais de perte silencieuse.
//
// Fonction pure : ne modifie ni `entity` ni `filesByName`, renvoie une copie.

import { fileToDataUrl } from './deserialize'

// Un chemin est « nu » (à résoudre) s'il s'agit d'une chaîne non vide qui n'est
// pas déjà une data URL.
function isBarePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('data:')
}

// Résout un chemin nu contre filesByName ; accumule dans `missing` si introuvable.
function resolvePath(path, filesByName, missing) {
  if (!isBarePath(path)) return path
  // `path` vient du `patron.md`, un fichier que l'utilisatrice peut éditer à la main :
  // `![](__proto__)` rendrait `Object.prototype` sur un objet littéral, donc une image
  // « trouvée » là où aucun fichier n'existe (et un `[object Object]` interpolé dans la
  // data URL). `Object.hasOwn` ne répond que sur ce que l'objet porte vraiment.
  const base64 = filesByName && Object.hasOwn(filesByName, path) ? filesByName[path] : undefined
  if (base64 == null) {
    missing.push(path)
    return path
  }
  return fileToDataUrl(path, base64)
}

function resolveImgsArray(imgs, filesByName, missing) {
  if (!Array.isArray(imgs)) return imgs
  return imgs.map((img) => resolvePath(img, filesByName, missing))
}

function resolveSections(sections, filesByName, missing) {
  if (!Array.isArray(sections)) return sections
  return sections.map((section) => {
    if (!section || typeof section !== 'object') return section
    const out = { ...section }
    if (section.chart) out.chart = resolveChart(section.chart, filesByName, missing)
    if (Array.isArray(section.steps)) {
      out.steps = section.steps.map((step) => {
        if (!step || !Array.isArray(step.imgs)) return step
        return { ...step, imgs: resolveImgsArray(step.imgs, filesByName, missing) }
      })
    }
    return out
  })
}

function resolveChart(chart, filesByName, missing) {
  if (!chart || !chart.img) return chart
  return { ...chart, img: resolvePath(chart.img, filesByName, missing) }
}

function resolveGallery(gallery, filesByName, missing) {
  if (!Array.isArray(gallery)) return gallery
  return gallery.map((g) => {
    if (!g) return g
    return { ...g, src: resolvePath(g.src, filesByName, missing) }
  })
}

// resolveReaderAssets(entity, filesByName) → { entity, missing }
// `entity` : objet patron (ou fragment) avec éventuellement `.reader` et
// `.gallery`. `filesByName` : { '<nomDeFichier>': '<base64>' } (fichiers du
// dossier, déjà lus). Ne lève jamais ; tolère entity/reader/gallery absents ou
// partiellement formés.
export function resolveReaderAssets(entity, filesByName) {
  if (entity == null || typeof entity !== 'object') {
    return { entity, missing: [] }
  }
  const files = filesByName && typeof filesByName === 'object' ? filesByName : {}
  const missing = []
  const out = { ...entity }

  if (entity.reader && typeof entity.reader === 'object') {
    const reader = { ...entity.reader }
    if (Array.isArray(reader.sections)) {
      reader.sections = resolveSections(reader.sections, files, missing)
    }
    if (reader.chart) {
      reader.chart = resolveChart(reader.chart, files, missing)
    }
    out.reader = reader
  }

  if (Array.isArray(entity.gallery)) {
    out.gallery = resolveGallery(entity.gallery, files, missing)
  }

  return { entity: out, missing }
}

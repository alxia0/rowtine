// resolveReaderImages : ré-attache aux chemins d'asset (`img/photo-<hash>.<ext>`,
// non résolvables en <img src>) les data URLs correspondantes, en s'appuyant sur le
// nommage DÉTERMINISTE PAR CONTENU de photoFileName (même data URL → même chemin).
//
// Contexte : `dstReader` vient d'un re-parse du MD vivant de l'éditeur (reflète les
// éditions humaines, ex. requalification d'une ligne en « Étape ») mais ne porte que
// des chemins d'asset. `srcReader` est le snapshot figé au moment de l'import (porte
// les vraies data URLs, mais pas les éditions faites depuis). On mute `dstReader` en
// place pour combiner : structure/éditions à jour + images réelles.
//
// Pur, sans IO. Robuste à tout champ absent/null (jamais de throw).
import { photoFileName } from '@/backup/naming.js'

// Chemin d'asset d'une data-URL, tel qu'émis par serialize.js sur une ligne image
// (`img/photo-<hash>.<ext>`) — nommage déterministe par CONTENU (même data-URL, même
// chemin). SEULE formule : appelée par buildImageMap ci-dessous ET par tout appelant qui a
// besoin d'anticiper le chemin qu'une image prendra une fois dans le texte (ex.
// insertGalleryImageIntoText, CorrectionView.vue) — jamais recopiée en dur ailleurs.
export function assetImagePath(dataUrl) {
  return `img/${photoFileName(dataUrl, 0)}`
}

// Construit chemin d'asset → data URL depuis srcReader (step.imgs + chart.img,
// legacy top-level ET par section). Exportée (Task B1, reader-editable.js) : la
// map d'images de l'éditeur se dérive du reader avec EXACTEMENT cette logique —
// ne pas la dupliquer ailleurs.
export function buildImageMap(srcReader) {
  const map = new Map()
  const sections = srcReader?.sections
  if (Array.isArray(sections)) {
    for (const sec of sections) {
      const steps = sec?.steps
      if (Array.isArray(steps)) {
        for (const step of steps) {
          const imgs = step?.imgs
          if (!Array.isArray(imgs)) continue
          for (const src of imgs) {
            if (typeof src === 'string' && src.startsWith('data:')) {
              map.set(assetImagePath(src), src)
            }
          }
        }
      }
      // Multi-grilles (Lot A) : la grille vit SUR LA SECTION (section.chart.img),
      // pas seulement au niveau global legacy (reader.chart, repli rétrocompat
      // ci-dessous pour les patrons pré-multi-grilles). Sans ce scan, la vignette
      // de la bande « Diagrammes de ce patron » et l'aperçu diagramme de
      // l'éditeur de correction restent cassés pour tout patron moderne.
      const sectionChartImg = sec?.chart?.img
      if (typeof sectionChartImg === 'string' && sectionChartImg.startsWith('data:')) {
        map.set(assetImagePath(sectionChartImg), sectionChartImg)
      }
    }
  }
  const chartImg = srcReader?.chart?.img
  if (typeof chartImg === 'string' && chartImg.startsWith('data:')) {
    map.set(assetImagePath(chartImg), chartImg)
  }
  return map
}

// `extraImages` (optionnel) : map de REPLI chemin -> data-URL pour les images qui
// n'apparaissent dans AUCUNE section de srcReader -- ex. une image de galerie
// (pattern.gallery) tout juste insérée dans le texte de l'éditeur de correction, jamais
// ancrée dans un step. srcReader reste prioritaire en cas de chemin partagé.
export function resolveReaderImages(dstReader, srcReader, extraImages) {
  const map = buildImageMap(srcReader)
  if (extraImages) {
    for (const [path, dataUrl] of extraImages) {
      if (!map.has(path)) map.set(path, dataUrl)
    }
  }
  if (map.size === 0) return dstReader

  const sections = dstReader?.sections
  if (Array.isArray(sections)) {
    for (const sec of sections) {
      const steps = sec?.steps
      if (Array.isArray(steps)) {
        for (const step of steps) {
          const imgs = step?.imgs
          if (!Array.isArray(imgs)) continue
          for (let i = 0; i < imgs.length; i++) {
            const s = imgs[i]
            if (typeof s === 'string') imgs[i] = map.get(s) || s
          }
        }
      }
      // Symétrique du repli legacy ci-dessous, mais PAR SECTION (multi-grilles).
      if (sec?.chart && typeof sec.chart.img === 'string') {
        sec.chart.img = map.get(sec.chart.img) || sec.chart.img
      }
    }
  }
  if (dstReader?.chart && typeof dstReader.chart.img === 'string') {
    dstReader.chart.img = map.get(dstReader.chart.img) || dstReader.chart.img
  }
  return dstReader
}

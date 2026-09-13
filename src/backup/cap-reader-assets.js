// Rowtine — miroir ASYNC de resolve-reader-assets.js (qui reste pure/synchrone —
// 3 sites de test en dépendent, non modifiée ici). Plafonne les images déjà
// résolues en data URL (galerie, chart, steps), seulement celles qui dépassent
// réellement le gabarit des 3 autres portes d'entrée (cf. capDataUrlIfOversized,
// src/utils/image-resize.js) — ferme la 4ᵉ porte (intent
// `quatrieme-porte-images-sans-plafond`) : la synchro du `patron.md` édité à la
// main injectait jusqu'ici une image déposée manuellement sans aucun plafond.
//
// Boucle SÉQUENTIELLE (jamais Promise.all) : même garde mémoire que
// src/utils/zip-import.js — chaque décodage alloue une Image PLUS un canvas de la
// taille de l'image décodée ; en éventail, un dossier à N images les décoderait
// TOUTES en même temps (pic mémoire évité sur les gros dossiers/WebView limités).
import { capDataUrlIfOversized } from '@/utils/image-resize'

async function capImgsArray(imgs, cap) {
  if (!Array.isArray(imgs)) return imgs
  const out = []
  for (const img of imgs) out.push(await cap(img))
  return out
}

async function capChart(chart, cap) {
  if (!chart || !chart.img) return chart
  return { ...chart, img: await cap(chart.img) }
}

async function capSections(sections, cap) {
  if (!Array.isArray(sections)) return sections
  const out = []
  for (const section of sections) {
    if (!section || typeof section !== 'object') {
      out.push(section)
      continue
    }
    const next = { ...section }
    if (section.chart) next.chart = await capChart(section.chart, cap)
    if (Array.isArray(section.steps)) {
      const steps = []
      for (const step of section.steps) {
        if (!step || !Array.isArray(step.imgs)) {
          steps.push(step)
          continue
        }
        steps.push({ ...step, imgs: await capImgsArray(step.imgs, cap) })
      }
      next.steps = steps
    }
    out.push(next)
  }
  return out
}

async function capGallery(gallery, cap) {
  if (!Array.isArray(gallery)) return gallery
  const out = []
  for (const g of gallery) {
    if (!g) {
      out.push(g)
      continue
    }
    out.push({ ...g, src: await cap(g.src) })
  }
  return out
}

// capReaderAssets(entity, { maxDim, quality, maxBytes } = {}) → Promise<entity>
// Ne lève jamais ; tolère entity/reader/gallery absents ou partiellement formés
// (même contrat que resolveReaderAssets).
export async function capReaderAssets(entity, { maxDim = 1280, quality = 0.8, maxBytes } = {}) {
  if (entity == null || typeof entity !== 'object') return entity
  const cap = (dataUrl) => capDataUrlIfOversized(dataUrl, maxDim, quality, maxBytes)
  const out = { ...entity }

  if (entity.reader && typeof entity.reader === 'object') {
    const reader = { ...entity.reader }
    if (Array.isArray(reader.sections)) reader.sections = await capSections(reader.sections, cap)
    if (reader.chart) reader.chart = await capChart(reader.chart, cap)
    out.reader = reader
  }

  if (Array.isArray(entity.gallery)) out.gallery = await capGallery(entity.gallery, cap)

  return out
}

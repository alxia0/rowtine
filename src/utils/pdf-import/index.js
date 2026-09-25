// Orchestrateur navigateur de l'import PDF local (voie par défaut) :
// extraction pdfjs → refus nets (reject.js : scanné, pas un patron, plusieurs patrons) →
// cœur pur (assemble) → images best-effort depuis le PDF de l'utilisatrice.
import { extractPages, extractDocMetaTitle, renderPdfPageToDataUrl, extractImagesWithPos, extractVectorRegions, readFileAsDataUrl } from '@/utils/pdf'
import { buildReaderFromPages } from './assemble'
import { associateImages } from './associate'
import { promoteGridSections } from './promote-grids'
import { detectRejection } from './reject'

const CHART_HINT_RE = /diagramme|chart|grille|legend|légende/i
// Auto-détection d'un compteur de répétition de diagramme : « répéter le diagramme/motif N fois »
// / « repeat the chart/diagram N times ». Best-effort — appelé sur le texte de la page du
// diagramme (déjà filtrée par CHART_HINT_RE), donc un « répéter … N fois » y réfère au diagramme.
const REP_CHART_RE = /(?:répéter|repeat)\b[^.]{0,60}?(?:diagramme|motif|chart|diagram|grille)[^.]{0,20}?(\d+)\s*(?:fois|times)\b|(?:diagramme|motif|chart|diagram|grille)[^.]{0,40}?(?:répéter|repeat)\b[^.]{0,30}?(\d+)\s*(?:fois|times)\b/i
export function detectChartReps(text) {
  const m = REP_CHART_RE.exec(String(text || ''))
  if (!m) return null
  const n = Number(m[1] || m[2])
  return Number.isFinite(n) && n > 0 ? n : null
}

function detectChartPage(pages) {
  for (let i = 1; i < pages.length; i++) {
    const text = pages[i].map((l) => l.text).join(' ')
    if (CHART_HINT_RE.test(text) && text.length < 600) return i + 1
  }
  return 0
}

function fallbackResult(file) {
  const base = (file?.name || 'Patron').replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  const reader = { sizeLabels: ['Taille unique'], sizeSub: [], sizeSubLabel: '', easeHint: '', sections: [], reference: {} }
  const pattern = {
    name: base,
    type: 'knitting',
    category: '',
    categoryCustom: '',
    author: '',
    sizes: [],
    source: `PDF (local) : ${file?.name || ''} (texte non extrait)`,
    photos: [],
    pdf: '',
    gallery: [],
    sections: [],
    reader,
  }
  return {
    pattern,
    reader,
    warnings: [],
    confidence: { global: 0, level: 'low', bySection: {} },
    stats: null,
    scanned: false,
    notPattern: false,
    notPatternReason: null,
    rejected: null,
  }
}

// Résultat d'un refus : aucun patron. Les vues ne lisent que `rejected` ; `scanned`,
// `notPattern` et `notPatternReason` restent posés pour la compatibilité et la spec §4.1.
function rejectedResult(rejected) {
  return {
    pattern: null,
    reader: null,
    warnings: [],
    confidence: null,
    stats: null,
    blocking: null,
    scanned: rejected.reason === 'scanned',
    notPattern: rejected.reason === 'notPattern',
    notPatternReason: rejected.reason === 'notPattern' ? rejected.detail : null,
    rejected,
  }
}

export async function parsePdfLocally(file, { onProgress } = {}) {
  onProgress?.({ phase: 'extract', page: 0, total: 0 })
  let pages
  try {
    pages = await extractPages(file, (page, total) => onProgress?.({ phase: 'extract', page, total }))
  } catch {
    // Repli : extraction impossible (worker indispo…) → patron au nom du
    // fichier, reader vide mais valide, confiance basse. Le PDF est quand même
    // retenu best-effort (lecture fichier indépendante de pdfjs) : c'est tout
    // l'intérêt du filet de sécurité. La galerie reste vide (pdfjs indispo).
    const fb = fallbackResult(file)
    try {
      fb.pattern.pdf = await readFileAsDataUrl(file)
    } catch {
      /* lecture impossible : on garde pdf vide */
    }
    return fb
  }

  const rejected = detectRejection(pages)
  if (rejected) return rejectedResult(rejected)

  onProgress?.({ phase: 'parse' })
  // Fiche d'identité du PDF (best-effort, jamais bloquant) : sert à recoller un titre de
  // couverture écrit lettre par lettre (cf. spaced-title.js). Comme les autres appels
  // best-effort ci-dessous (images, régions vectorielles) : une erreur ne doit jamais
  // faire échouer tout l'import, seulement priver le titre de ce recollage.
  let docMetaTitle
  try {
    docMetaTitle = await extractDocMetaTitle(file)
  } catch {
    docMetaTitle = ''
  }
  const out = buildReaderFromPages(pages, { fileName: file?.name || '', docMetaTitle })

  onProgress?.({ phase: 'images', page: 0, total: 0 })
  try {
    out.pattern.photos = [await renderPdfPageToDataUrl(file, 1, 800)]
  } catch {
    out.pattern.photos = []
  }

  // Rétention du PDF (best-effort, comme les images de page).
  try {
    out.pattern.pdf = await readFileAsDataUrl(file)
  } catch {
    out.pattern.pdf = ''
  }

  // Images raster embarquées (positionnées) + régions vectorielles (toutes pages).
  let imagesWithPos
  let vecRegions
  try {
    const res = await extractImagesWithPos(file, (page, total) =>
      onProgress?.({ phase: 'images', page, total }))
    imagesWithPos = Array.isArray(res) ? res : []
  } catch { imagesWithPos = [] }
  try {
    // Boîtes raster en points PDF pour la dédup (x,y déjà en points ; w,h px CSS → points).
    const rasterBoxes = imagesWithPos.map((im) => ({
      page: im.page, x0: im.x, y0: im.y - im.h * 72 / 96, x1: im.x + im.w * 72 / 96, y1: im.y,
    }))
    const res = await extractVectorRegions(file, (page, total) =>
      onProgress?.({ phase: 'images', page, total }), { rasterBoxes })
    vecRegions = Array.isArray(res) ? res : []
  } catch { vecRegions = [] }

  onProgress?.({ phase: 'assemble' })
  // Grilles dessinées (kind:'grid') : promues en diagrammes INTERACTIFS suivables rang-par-rang
  // (lot #2-B), chacune sa section — donc PAS ancrées comme simples images. Le reste (raster +
  // régions 'reference' : schémas de mesures, légendes) suit l'ancrage habituel (step.imgs/galerie).
  // Grilles vectorielles ET images raster classées grille (E) → diagrammes interactifs.
  const vecGrids = vecRegions.filter((r) => r && r.kind === 'grid')
  const nonGridRegions = vecRegions.filter((r) => !(r && r.kind === 'grid'))
  const imageGrids = imagesWithPos.filter((im) => im && im.kind === 'grid')
  const imageNonGrids = imagesWithPos.filter((im) => !(im && im.kind === 'grid'))
  const gridRegions = [...vecGrids, ...imageGrids]
  // #5 : images (raster + régions 'reference') ancrées sous leur ligne d'instruction ; le reste → galerie.
  const { sections, gallery } = associateImages(out.reader.sections, [...imageNonGrids, ...nonGridRegions], pages)
  out.reader.sections = sections
  out.pattern.gallery = gallery
  out.reader = promoteGridSections(out.reader, gridRegions, pages)

  // Option B : diagramme page-entière SEULEMENT en repli (aucune région vectorielle ni image-grille détectée).
  if (vecRegions.length === 0 && imageGrids.length === 0) {
    const chartPage = detectChartPage(pages)
    if (chartPage) {
      try {
        out.reader.chart = { img: await renderPdfPageToDataUrl(file, chartPage), rows: 0, cols: 0, repeat: '', readDir: '' }
        const chartText = (pages[chartPage - 1] || []).map((l) => l.text).join(' ')
        const reps = detectChartReps(chartText)
        if (reps) out.reader.chart.reps = reps
      } catch {
        // best-effort : pas de diagramme si le rendu échoue
      }
    }
  }

  return { ...out, scanned: false, notPattern: false, notPatternReason: null, rejected: null }
}

// Build « legacy » (pas le build par défaut) : embarque les polyfills core-js dont pdf.js
// a besoin (ex. `Iterator` global) pour tourner sur un WebView ancien. Reproductible sur la
// Nexus 7 (WebView 114, mi-2023) : le build par défaut y plantait au chargement avec
// `ReferenceError: Iterator is not defined`, cassant l'import PDF sans aucun message
// (repro nexus7_2026-08-26) — `Iterator` n'existe qu'à partir de Chrome 122 (2024). Même
// build déjà utilisé côté Node par pdf-import/node.mjs, pour la même raison.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { itemsToLines } from './pdf-import/lines'
import { filterGalleryImages } from './pdf-import/gallery'
import { clusterPathBoxes, splitRegionGuarded, classifyGridStrict } from './pdf-import/vector-regions'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// Extraction structurée : une liste de lignes typées { text, size, bold, y } par page.
// Base de l'import local (segmentation par mise en page).
export async function extractPages(file, onPage) {
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(itemsToLines(content.items, content.styles, { pageWidth: page.view?.[2] || 595 }))
    onPage?.(i, doc.numPages)
  }
  return pages
}

// Fiche d'identité du PDF (doc.getMetadata().info.Title). Sert à recoller un titre de
// couverture écrit lettre par lettre (cf. spaced-title.js) : le PDF n'encode pas la
// coupure entre les mots, seule la fiche d'identité la porte parfois. Best-effort :
// absente/illisible → chaîne vide (jamais bloquant pour l'import). Consommée côté app
// par src/utils/pdf-import/index.js, qui la passe à buildReaderFromPages en docMetaTitle.
export async function extractDocMetaTitle(file) {
  try {
    const data = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data }).promise
    return (await doc.getMetadata())?.info?.Title || ''
  } catch {
    return ''
  }
}

// Rend une page du PDF en image (data URL JPEG). Sert à récupérer un diagramme ou une
// photo « objet fini » directement depuis le PDF (cf. import IA). `pageNumber` est 1-indexé.
export async function renderPdfPageToDataUrl(file, pageNumber = 1, maxWidth = 1100) {
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const n = Math.min(Math.max(1, pageNumber || 1), doc.numPages)
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  let scale = Math.min(2.5, Math.max(0.5, maxWidth / base.width))
  scale = clampRenderScale(base.width, base.height, scale) // filet de sécurité pages grand format
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
  // Libère le buffer du canvas offscreen dès l'extraction faite (cf. RENDER_MAX_DIM).
  canvas.width = 0
  canvas.height = 0
  return dataUrl
}

// Nombre de pages d'un PDF. Sert à la navigation de la visionneuse in-app.
export async function pdfPageCount(file) {
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  return doc.numPages
}

// Taille AFFICHÉE d'une image dans le PDF (px CSS), déduite de sa CTM. L'image est un
// carré unité transformé par la CTM [a,b,c,d,e,f] : la colonne (a,b) porte sa largeur,
// la colonne (c,d) sa hauteur, en points (1 pt = 1/72"). Conversion points → px CSS (96 dpi).
export function displayedImageSize(ctm) {
  return {
    w: Math.hypot(ctm[0], ctm[1]) * (96 / 72),
    h: Math.hypot(ctm[2], ctm[3]) * (96 / 72),
  }
}

// Facteur de réduction pour tenir une image intrinsèque (iw×ih) dans (maxW×maxH), sans
// jamais l'agrandir. Cible absente/≤0 ou dimensions intrinsèques nulles → 1 (inchangé).
export function fitScale(iw, ih, maxW, maxH) {
  if (!iw || !ih) return 1
  if (!maxW || maxW <= 0 || !maxH || maxH <= 0) return 1
  return Math.min(1, maxW / iw, maxH / ih)
}

// Plafond (px) pour tout rendu de PAGE (viewport pdf.js) sur canvas offscreen — pages
// « unique » (renderPdfPageToDataUrl) et rendu par lot (renderPageCanvas, cf.
// extractVectorRegions). Un PDF grand format (poster, patron A3+) rendu à pleine échelle
// peut réclamer un canvas disproportionné ; ce plafond borne le pire cas SANS jamais réduire
// le rendu des PDF déjà dans les tailles normales (cf. `clampRenderScale`, qui ne réduit
// `scale` que si la dimension de base × scale le dépasserait).
const RENDER_MAX_DIM = 4096

// Réduit `scale` (ne l'augmente jamais) pour que `baseWidth×scale` et `baseHeight×scale`
// tiennent sous `maxDim`. Pure/testable sans DOM ni pdfjs.
export function clampRenderScale(baseWidth, baseHeight, scale, maxDim = RENDER_MAX_DIM) {
  if (!baseWidth || !baseHeight || !scale || scale <= 0) return scale
  const limit = Math.min(maxDim / baseWidth, maxDim / baseHeight)
  return Math.min(scale, limit)
}

// Seuils de découpage de région (gouttières/traits, cf. splitRegionGuarded) dérivés de
// l'échelle EFFECTIVE à laquelle une page a été rastérisée — PAS d'une constante nominale.
// `renderPageCanvas` peut réduire l'échelle réelle d'une page (clampRenderScale, page grand
// format au-delà de RENDER_MAX_DIM) : des seuils figés sur l'échelle nominale (ex. 2)
// resteraient calibrés pour des pixels plus grands que ceux réellement rendus, désynchronisant
// la détection de gouttière précisément sur les PDF poster/A3+ que ce plafond vise à protéger.
// `gapMin`/`minLen` sont en px : ils croissent avec l'échelle de rendu (24pt/40pt de référence
// à scale=1, cf. valeurs historiques à scale=2 : 48/80). Pure/testable sans DOM ni pdfjs.
export function pxOptsForScale(effectiveScale) {
  const s = effectiveScale > 0 ? effectiveScale : 1
  return { inkThreshold: 200, step: 3, gapMin: Math.round(24 * s), minLen: Math.round(40 * s), inkFloor: 1, lineCov: 0.5, minLines: 4 }
}

// Plafond ABSOLU (px) de la résolution de décodage d'une image embarquée, appliqué même
// quand l'appelant ne fournit pas de maxW/maxH (ex. extractImages) — sans lui, une image
// embarquée à très haute résolution serait décodée à sa taille native intégrale. Volontairement
// au-delà des plafonds relatifs déjà en place côté appelants (ex. le plafond à 1280px de
// extractImagesWithPos) : ce plafond-ci est un filet de sécurité, pas la borne normale.
const IMAGE_DECODE_MAX_DIM = 2048

// Décode un objet image pdfjs (forme ImageBitmap OU { data, width, height, kind })
// en data URL via canvas. Testable : surchargeable par globalThis.__decodeStub.
// `maxW`/`maxH` (optionnels, px) bornent la sortie : au-delà, l'image est réduite (jamais
// agrandie — cf. `fitScale`), plafonnée dans tous les cas par `IMAGE_DECODE_MAX_DIM`.
// Le plafond est appliqué AVANT le décodage (pas après) : pour la forme ImageBitmap, on
// décode/dessine directement à la taille cible plutôt que de décoder plein format puis
// réduire, ce qui évite le pic mémoire d'un canvas intermédiaire disproportionné sur les
// PDF riches en images haute résolution. Les canvas (à nous, créés ici) sont remis à 0×0
// après usage pour laisser le GC récupérer leur buffer sans attendre la fin du lot en cours.
// NB : on NE ferme PAS `img.bitmap` (pas de `.close()`) — cette fonction n'en est pas
// propriétaire. Raison suffisante à elle seule : extractImagesWithPos relit le MÊME
// `img.bitmap` juste après (imageObjectToRGBA, pour classifyGridStrict) — le fermer ici
// casserait ce 2e lecteur. En prime, pdfjs met en cache les images vues sur plusieurs pages
// (GlobalImageCache côté worker, NUM_PAGES_THRESHOLD=2) : un objet image obtenu sur une page
// ultérieure peut être un clone dérivé de l'entrée mise en cache pour l'image d'origine, pas
// une resynthèse indépendante — fermer un bitmap qu'on ne sait pas relié à cette mise en cache
// est un risque qu'on préfère ne pas courir. Seul le canvas qu'on
// alloue nous-mêmes est sûr à libérer.
function decodeImageObject(img, maxW, maxH) {
  if (globalThis.__decodeStub) return globalThis.__decodeStub(img, maxW, maxH)
  if (!img) return ''
  const w = img.width
  const h = img.height
  if (!w || !h) return ''
  const cappedMaxW = Math.min(maxW ?? IMAGE_DECODE_MAX_DIM, IMAGE_DECODE_MAX_DIM)
  const cappedMaxH = Math.min(maxH ?? IMAGE_DECODE_MAX_DIM, IMAGE_DECODE_MAX_DIM)
  const scale = fitScale(w, h, cappedMaxW, cappedMaxH)
  const outW = scale < 1 ? Math.max(1, Math.round(w * scale)) : w
  const outH = scale < 1 ? Math.max(1, Math.round(h * scale)) : h

  if (img.bitmap) {
    // Décode directement à la taille cible (pas de canvas plein format intermédiaire).
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img.bitmap, 0, 0, outW, outH)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    canvas.width = 0
    canvas.height = 0
    return dataUrl
  }

  if (img.data) {
    // Pixel brut fourni à la résolution NATIVE (w×h) : putImageData exige une correspondance
    // exacte, donc impossible de décoder directement à une taille réduite pour cette forme —
    // seule la forme ImageBitmap (ci-dessus) profite du décodage direct à la taille cible.
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    // img.kind : 1=GRAYSCALE_1BPP, 2=RGB_24BPP, 3=RGBA_32BPP (pdfjs ImageKind)
    const imgData = ctx.createImageData(w, h)
    const src = img.data
    if (img.kind === 3) {
      imgData.data.set(src)
    } else if (img.kind === 2) {
      for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
        imgData.data[j] = src[i]; imgData.data[j + 1] = src[i + 1]; imgData.data[j + 2] = src[i + 2]; imgData.data[j + 3] = 255
      }
    } else {
      // GRAYSCALE_1BPP (kind 1) : 1 bit/pixel, MSB d'abord, lignes alignées à l'octet.
      // Polarité bit 1 -> blanc en best-effort (à confirmer sur device) : une image
      // possiblement inversée mais lisible vaut mieux qu'un rendu corrompu.
      const rowBytes = (w + 7) >> 3
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const byte = src[y * rowBytes + (x >> 3)] ?? 0
          const v = ((byte >> (7 - (x & 7))) & 1) ? 255 : 0
          const j = (y * w + x) * 4
          imgData.data[j] = v
          imgData.data[j + 1] = v
          imgData.data[j + 2] = v
          imgData.data[j + 3] = 255
        }
      }
    }
    ctx.putImageData(imgData, 0, 0)
    if (scale < 1) {
      const out = document.createElement('canvas')
      out.width = outW
      out.height = outH
      out.getContext('2d').drawImage(canvas, 0, 0, outW, outH)
      canvas.width = 0
      canvas.height = 0
      const dataUrl = out.toDataURL('image/jpeg', 0.8)
      out.width = 0
      out.height = 0
      return dataUrl
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    canvas.width = 0
    canvas.height = 0
    return dataUrl
  }

  return ''
}

// Reconstruit le RGBA plat (pixels, PAS dessiné) d'une image pdfjs à sa résolution
// intrinsèque. Sert à classer un diagramme raster à sa résolution native
// (classifyGridStrict a besoin des pixels bruts, pas d'un canvas). Miroir de la
// construction RGBA de `decodeImageObject` (kind 1/2/3) — duplication volontaire plutôt
// que refactor : `decodeImageObject` est en chemin device-validé et non exercé par les
// tests unitaires (toujours court-circuité par `globalThis.__decodeStub`), donc un
// refactor n'aurait aucun filet de test réel. Pour `img.bitmap` (ImageBitmap) : passe par
// un `<canvas>` + `getImageData` si dispo (navigateur) ; sinon `null`. Best-effort :
// entrée invalide → `null`.
export function imageObjectToRGBA(img) {
  if (!img) return null
  const w = img.width
  const h = img.height
  if (!w || !h) return null
  if (img.bitmap) {
    if (typeof document === 'undefined') return null
    // Filet de sécurité mémoire (cf. IMAGE_DECODE_MAX_DIM) : décode à une taille
    // plafonnée plutôt qu'à la résolution native intégrale sur une image embarquée démesurée.
    // Un downscale modéré n'altère pas la détection structurelle de classifyGridStrict (motifs
    // répétés) ; en pratique la quasi-totalité des images de patron reste sous ce plafond, donc
    // inchangé pour elles — seul le pire cas (scan haute résolution) est borné. Le canvas créé
    // ici est purement local (jamais relu après retour de la fonction) : remis à 0×0 avant de
    // rendre la main, contrairement à `img.bitmap` (cf. commentaire de `decodeImageObject`).
    const scale = fitScale(w, h, IMAGE_DECODE_MAX_DIM, IMAGE_DECODE_MAX_DIM)
    const outW = scale < 1 ? Math.max(1, Math.round(w * scale)) : w
    const outH = scale < 1 ? Math.max(1, Math.round(h * scale)) : h
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx || typeof ctx.getImageData !== 'function') {
      canvas.width = 0
      canvas.height = 0
      return null
    }
    ctx.drawImage(img.bitmap, 0, 0, outW, outH)
    const imgData = ctx.getImageData(0, 0, outW, outH)
    canvas.width = 0
    canvas.height = 0
    return { data: imgData.data, width: outW, height: outH }
  }
  if (img.data) {
    const data = new Uint8ClampedArray(w * h * 4)
    const src = img.data
    if (img.kind === 3) {
      // miroir de decodeImageObject (kind 3 = RGBA_32BPP) : copie directe
      data.set(src)
    } else if (img.kind === 2) {
      // miroir de decodeImageObject (kind 2 = RGB_24BPP) : expansion RGB -> RGBA, alpha=255
      for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
        data[j] = src[i]; data[j + 1] = src[i + 1]; data[j + 2] = src[i + 2]; data[j + 3] = 255
      }
    } else {
      // miroir de decodeImageObject (kind 1 = GRAYSCALE_1BPP) : 1 bit/pixel, MSB d'abord,
      // lignes alignées à l'octet ; même polarité best-effort (bit 1 -> blanc).
      const rowBytes = (w + 7) >> 3
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const byte = src[y * rowBytes + (x >> 3)] ?? 0
          const v = ((byte >> (7 - (x & 7))) & 1) ? 255 : 0
          const j = (y * w + x) * 4
          data[j] = v
          data[j + 1] = v
          data[j + 2] = v
          data[j + 3] = 255
        }
      }
    }
    return { data, width: w, height: h }
  }
  return null
}

// Compose deux CTM affines packées [a,b,c,d,e,f] (m1 puis m2, convention pdfjs Util.transform).
function mulCtm(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

// Récupère un objet image de pdfjs de façon BORNÉE : `page.objs.get(name, cb)` peut
// ne jamais rappeler son callback (image résidant dans commonObjs, objet non résolu…),
// ce qui gèlerait l'import. On borne par un timeout → `null` (image sautée) si dépassé.
export function resolveImageObj(page, name, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      page.objs.get(name, (img) => finish(img))
    } catch {
      finish(null)
    }
  })
}

// Extrait les images embarquées d'un PDF → [{ src, page, w, h }] filtré/dédupliqué/plafonné.
// Best-effort : toute erreur (worker, décodage) est absorbée, on renvoie ce qu'on a.
export async function extractImages(file) {
  const candidates = []
  try {
    const data = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data }).promise
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      let ops
      try {
        ops = await page.getOperatorList()
      } catch {
        continue
      }
      const seenOnPage = new Set()
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i]
        if (fn !== pdfjs.OPS.paintImageXObject && fn !== pdfjs.OPS.paintInlineImageXObject) continue
        const name = ops.argsArray[i]?.[0]
        if (typeof name !== 'string' || seenOnPage.has(name)) continue
        seenOnPage.add(name)
        try {
          const img = await resolveImageObj(page, name)
          const src = decodeImageObject(img)
          if (src) candidates.push({ src, page: p, w: img.width || 0, h: img.height || 0 })
        } catch {
          /* image illisible : on ignore */
        }
      }
    }
    return filterGalleryImages(candidates)
  } catch {
    return []
  }
}

// Comme extractImages, mais en suivant la CTM (pile save/restore + transform) pour situer
// chaque image → [{ src, page, x, y, w, h }]. `y` = bord HAUT de l'image (points PDF, origine
// bas-gauche). `w`/`h` = dimensions intrinsèques (px) pour le filtre taille. Best-effort → [].
export async function extractImagesWithPos(file, onPage) {
  const candidates = []
  try {
    const data = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data }).promise
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      let ops
      try {
        ops = await page.getOperatorList()
      } catch {
        onPage?.(p, doc.numPages)
        continue
      }
      let ctm = [1, 0, 0, 1, 0, 0]
      const stack = []
      const seenOnPage = new Set()
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i]
        if (fn === pdfjs.OPS.save) {
          stack.push(ctm)
          continue
        }
        if (fn === pdfjs.OPS.restore) {
          ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
          continue
        }
        if (fn === pdfjs.OPS.transform) {
          const a = ops.argsArray[i]
          if (Array.isArray(a) && a.length >= 6) ctm = mulCtm(ctm, a)
          continue
        }
        if (fn !== pdfjs.OPS.paintImageXObject && fn !== pdfjs.OPS.paintInlineImageXObject) continue
        const name = ops.argsArray[i]?.[0]
        if (typeof name !== 'string' || seenOnPage.has(name)) continue
        seenOnPage.add(name)
        try {
          const disp = displayedImageSize(ctm)
          const img = await resolveImageObj(page, name)
          // Plafond ABSOLU à 1280px (15/08/2026, spec compression images importées), en plus
          // du plafond relatif existant (2× la taille affichée) : le plus contraignant des deux
          // s'applique. Sans lui, un grand diagramme affiché en pleine largeur pouvait dépasser
          // 1280px alors que toute autre image entrante y était déjà bornée.
          const src = decodeImageObject(
            img,
            Math.min(Math.round(disp.w * 2), 1280),
            Math.min(Math.round(disp.h * 2), 1280),
          )
          if (!src) continue
          // Classe l'image en diagramme (kind:'grid') à sa résolution INTRINSÈQUE (pas le src
          // downsamplé ci-dessus, hormis le filet de sécurité IMAGE_DECODE_MAX_DIM sur les
          // images démesurées — cf. imageObjectToRGBA) — corrige E : les diagrammes Cella sont
          // des JPEG embarqués, invisibles au pipeline vectoriel. Défauts calibrés de
          // classifyGridStrict (pas d'opts ici). Best-effort : image non classable
          // → reste une image simple.
          let kind
          try {
            const rgba = imageObjectToRGBA(img)
            if (rgba && classifyGridStrict(rgba.data, rgba.width, { x0: 0, y0: 0, x1: rgba.width, y1: rgba.height })) kind = 'grid'
          } catch { /* best-effort : image non classée reste une image simple */ }
          candidates.push({
            src,
            page: p,
            x: ctm[4],
            y: ctm[5] + Math.abs(ctm[3]), // inchangé : coordonnée PDF (points) pour l'ancrage
            w: Math.round(disp.w), // taille AFFICHÉE (px CSS), pas la résolution intrinsèque
            h: Math.round(disp.h),
            ...(kind ? { kind } : {}),
          })
        } catch {
          /* image illisible : on ignore */
        }
      }
      onPage?.(p, doc.numPages)
    }
    return filterGalleryImages(candidates)
  } catch {
    return []
  }
}

// Transforme les 4 coins d'une boîte [minX,minY,maxX,maxY] par la CTM → bbox englobante.
function boxFromMinMax(minMax, ctm) {
  const pts = [
    [minMax[0], minMax[1]], [minMax[2], minMax[1]],
    [minMax[2], minMax[3]], [minMax[0], minMax[3]],
  ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]])
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

// Parcourt une operatorList (déjà obtenue) et renvoie les boîtes de tracés en points page.
// Pur vis-à-vis du DOM (testable). `OPS` injecté pour éviter le couplage au build.
export function collectPathBoxes(ops, OPS) {
  const out = []
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    if (fn === OPS.save) { stack.push(ctm); continue }
    if (fn === OPS.restore) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue }
    if (fn === OPS.transform) {
      const a = ops.argsArray[i]
      if (Array.isArray(a) && a.length >= 6) ctm = mulCtm(ctm, a)
      continue
    }
    if (fn !== OPS.constructPath) continue
    const minMax = ops.argsArray[i]?.[2]
    if (!minMax || minMax.length < 4) continue
    out.push(boxFromMinMax(Array.from(minMax), ctm))
  }
  return out
}

// Lit un File/Blob en data URL complete (data:<mime>;base64,<...>). Best-effort cote
// appelant : rejette si la lecture echoue.
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error || new Error('lecture du fichier echouee'))
    r.readAsDataURL(file)
  })
}

const PT2CSS = 96 / 72
const REGION_MAX = 24 // plafond de régions rastérisées (perf mobile)
// Fraction de marge blanche horizontale ajoutée de chaque côté des crops de GRILLE
// (diagrammes suivables) pour que les numéros de rangs ne collent pas au bord de l'écran.
const GRID_CROP_PAD_FRAC = 0.08

// Rend une page entière sur un canvas et expose ses pixels (RGBA) pour la projection.
async function renderPageCanvas(pdfjs, doc, pageNo, scale) {
  if (globalThis.__renderPageStub) return globalThis.__renderPageStub(pageNo, scale)
  const p = await doc.getPage(pageNo)
  const base = p.getViewport({ scale: 1 })
  const cappedScale = clampRenderScale(base.width, base.height, scale) // filet pages grand format
  const viewport = p.getViewport({ scale: cappedScale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  await p.render({ canvasContext: ctx, viewport }).promise
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { canvas, viewport, data, width: canvas.width, height: canvas.height }
}

// Crop un rectangle pixel d'un canvas déjà rendu → data URL JPEG.
// padXFrac > 0 ajoute une marge blanche de `round(w·padXFrac)` px de chaque côté
// (fond blanc obligatoire : le JPEG n'a pas d'alpha → sinon bandes noires).
// `maxDim`/`quality` (15/08/2026, compression des images importées) : même plafond que toute
// autre image entrante (1280px de long côté, JPEG 0,8), y compris pour les diagrammes de patron
// — décision produit, cohérence avant tout. Un crop de région vectorielle (grille, schéma de
// mesure) rendu à l'échelle « retina » (scale=2, cf. extractVectorRegions) peut largement
// dépasser 1280px sur une page pleine largeur ; rien ne le bornait avant ce lot.
export function cropCanvas(canvas, cell, padXFrac = 0, maxDim = 1280, quality = 0.8) {
  const w = cell.x1 - cell.x0, h = cell.y1 - cell.y0
  if (w < 1 || h < 1) return ''
  const padX = Math.round(w * padXFrac)
  const outW = w + 2 * padX
  const out = document.createElement('canvas')
  out.width = outW; out.height = h
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(canvas, cell.x0, cell.y0, w, h, padX, 0, w, h)
  const scale = Math.min(1, maxDim / Math.max(outW, h))
  if (scale < 1) {
    const final = document.createElement('canvas')
    final.width = Math.round(outW * scale)
    final.height = Math.round(h * scale)
    final.getContext('2d').drawImage(out, 0, 0, final.width, final.height)
    return final.toDataURL('image/jpeg', quality)
  }
  return out.toDataURL('image/jpeg', quality)
}

// Bboxes des mots (px viewport) d'une page, pour masquer le texte à la mesure des gouttières.
async function pageTextBoxesPx(pdfjs, doc, pageNo, viewport) {
  if (globalThis.__pageTextBoxesStub) return globalThis.__pageTextBoxesStub(pageNo)
  try {
    const p = await doc.getPage(pageNo)
    const tc = await p.getTextContent()
    const boxes = []
    for (const item of tc.items) {
      if (!item.str || !item.str.trim()) continue
      const tx = pdfjs.Util.transform(viewport.transform, item.transform)
      const hgt = Math.hypot(tx[2], tx[3]) || 0            // hauteur de glyphe (px device)
      const wdt = (item.width || 0) * (viewport.scale || 1) // largeur du run (px device)
      const x = tx[4], yBase = tx[5]
      boxes.push({ x0: x - 1, y0: yBase - hgt - 1, x1: x + wdt + 1, y1: yBase + hgt * 0.3 + 1 }) // pad 1px
    }
    return boxes
  } catch { return [] } // pas de texte / erreur → aucun masquage (garde-fou : comportement actuel)
}

// Copie de `data` (RGBA plat) où les zones de texte sont peintes en blanc (R=255), pour que
// computeInkProfile ne les compte pas. Sert UNIQUEMENT à mesurer les gouttières ; le crop final
// vient toujours du canvas d'origine. N'altère jamais l'original.
export function maskTextData(data, width, height, boxes) {
  const out = new Uint8ClampedArray(data) // copie
  for (const b of boxes || []) {
    const x0 = Math.max(0, Math.floor(b.x0)), y0 = Math.max(0, Math.floor(b.y0))
    const x1 = Math.min(width, Math.ceil(b.x1)), y1 = Math.min(height, Math.ceil(b.y1))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[(y * width + x) * 4] = 255
  }
  return out
}

// Extrait les diagrammes vectoriels d'un PDF par région : regroupe les boîtes de tracés
// (collectPathBoxes) par proximité (clusterPathBoxes), puis rastérise chaque région en
// croppant le rendu de sa page. Convention IDENTIQUE à extractImagesWithPos : `y` = bord
// HAUT (points PDF, y vers le haut), `w`/`h` en px CSS. Best-effort : toute erreur → [].
export async function extractVectorRegions(file, onPage, opts = {}) {
  if (opts.__testSingleRegion && globalThis.__renderPageStub) {
    const rendered = globalThis.__renderPageStub(1, 2)
    // gapMin 48 = Math.round(24*scale) de la voie de production (scale=2), reproduit ici en dur pour le test.
    // Volontairement PAS une petite valeur arbitraire : un gapMin trop petit (ex. 6) fait interpréter
    // les blancs COURTS de part et d'autre d'un titre (gouttière réelle) comme des coupures, ce qui casse
    // le pontage attendu sans masquage (cf. pdf-vector-mask-wiring.spec.js).
    const PXOPTS = { inkThreshold: 200, step: 3, gapMin: 48, minLen: 8, inkFloor: 1, lineCov: 0.4, minLines: 3 }
    let measureData = rendered.data
    const tBoxes = (globalThis.__pageTextBoxesStub && globalThis.__pageTextBoxesStub(1)) || []
    if (tBoxes.length) measureData = maskTextData(rendered.data, rendered.width, rendered.height, tBoxes)
    const region = { x0: 0, y0: 0, x1: rendered.width, y1: rendered.height }
    const blocks = splitRegionGuarded(measureData, rendered.width, region, PXOPTS)
    return blocks.map((cell) => {
      // kind FINAL décidé par le classifieur strict (structurel), pas par le drapeau `cell.grid`
      // d'isGridCell (seuils lâches, sert uniquement au DÉCOUPAGE en amont) — cf. D.
      // NB : on classifie sur `rendered.data` (NON masqué = les pixels réels du crop), PAS sur
      // `measureData` (texte masqué). Le masquage sert au DÉCOUPAGE des gouttières (splitRegionGuarded)
      // mais dilue la couverture des lignes d'une grille fusionnée avec sa légende → faux `reference`.
      // classifyGridStrict a été calibré (11/11) sur les crops non masqués : on lui donne ces mêmes pixels.
      // PAS de 4ᵉ arg : le classifieur utilise ses propres défauts calibrés (GRID_STRICT, lineCov 0.5,
      // cvMax 0.4) — DÉCOUPLÉ de PXOPTS (config de découpage dont lineCov diffère selon la voie).
      const isGrid = classifyGridStrict(rendered.data, rendered.width, { x0: cell.x0, y0: cell.y0, x1: cell.x1, y1: cell.y1 })
      return {
        src: (globalThis.__cropCanvasStub || cropCanvas)(rendered.canvas, cell, isGrid ? GRID_CROP_PAD_FRAC : 0),
        page: 1, x: cell.x0, y: cell.y0,
        w: cell.x1 - cell.x0, h: cell.y1 - cell.y0,
        kind: isGrid ? 'grid' : 'reference',
      }
    }).filter((r) => r.src)
  }
  try {
    const data = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data }).promise
    const allBoxes = []
    const pageDims = {}
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const view = page.view || [0, 0, 595, 842]
      pageDims[p] = { x0: view[0], y0: view[1], x1: view[2], y1: view[3], w: view[2] - view[0], h: view[3] - view[1] }
      let ops
      try { ops = await page.getOperatorList() } catch { onPage?.(p, doc.numPages); continue }
      for (const b of collectPathBoxes(ops, pdfjs.OPS)) allBoxes.push({ page: p, ...b })
      onPage?.(p, doc.numPages)
    }
    const pageArea = Object.fromEntries(Object.entries(pageDims).map(([p, d]) => [p, d.w * d.h]))
    const regions = clusterPathBoxes(allBoxes, { ...opts, pageArea }).slice(0, REGION_MAX)
    const scale = 2 // « retina » nominal — borné PAR PAGE par renderPageCanvas (clampRenderScale)
    const out = []
    // Regrouper les régions par page pour ne rendre chaque page qu'une fois.
    const byPage = new Map()
    for (const r of regions) {
      if (!byPage.has(r.page)) byPage.set(r.page, [])
      byPage.get(r.page).push(r)
    }
    for (const [pageNo, pageRegions] of byPage) {
      let rendered
      try {
        rendered = await renderPageCanvas(pdfjs, doc, pageNo, scale) // { canvas, viewport, data, width, height }
      } catch { continue }
      // Échelle EFFECTIVE de CETTE page (peut différer du `scale` nominal si clampRenderScale
      // l'a réduite) : les seuils de découpage doivent suivre, pas rester calibrés sur le nominal.
      const PXOPTS = pxOptsForScale(rendered.viewport?.scale ?? scale)
      let measureData = rendered.data
      try {
        const tBoxes = await pageTextBoxesPx(pdfjs, doc, pageNo, rendered.viewport)
        if (tBoxes.length) measureData = maskTextData(rendered.data, rendered.width, rendered.height, tBoxes)
      } catch { /* garde-fou : on garde rendered.data non masqué */ }
      for (const r of pageRegions) {
        try {
          // Clip aux bornes de la page : un patron réel place des tracés hors-CropBox
          // (observé sur Phildar : région débordant à x<0 / au-dessus), ce qui donnerait
          // un crop avec des bandes vides. On borne la région à la page avant rastérisation.
          const pd = pageDims[r.page] || { x0: 0, y0: 0, x1: r.x1, y1: r.y1 }
          const cx0 = Math.max(r.x0, pd.x0), cy0 = Math.max(r.y0, pd.y0)
          const cx1 = Math.min(r.x1, pd.x1), cy1 = Math.min(r.y1, pd.y1)
          if (cx1 - cx0 < 1 || cy1 - cy0 < 1) continue // région entièrement hors-page
          // Région (points) clippée à la page → bbox pixels via le viewport. Le mapping
          // du viewport intègre l'origine de la MediaBox ET la rotation /Rotate de la
          // page, que le calcul naïf `x0*scale` ignorerait (page décalée/pivotée → crop
          // hors-cible, silencieux).
          const [ax, ay] = rendered.viewport.convertToViewportPoint(cx0, cy1)
          const [bx, by] = rendered.viewport.convertToViewportPoint(cx1, cy0)
          const regionPx = {
            x0: Math.max(0, Math.floor(Math.min(ax, bx))), y0: Math.max(0, Math.floor(Math.min(ay, by))),
            x1: Math.min(rendered.width, Math.ceil(Math.max(ax, bx))), y1: Math.min(rendered.height, Math.ceil(Math.max(ay, by))),
          }
          const blocks = splitRegionGuarded(measureData, rendered.width, regionPx, PXOPTS)
          for (const cell of blocks) {
            // Pixels → points page (convention y = bord HAUT).
            const [px0, py0] = rendered.viewport.convertToPdfPoint(cell.x0, cell.y1) // bas-gauche
            const [px1, py1] = rendered.viewport.convertToPdfPoint(cell.x1, cell.y0) // haut-droite
            const rx0 = Math.min(px0, px1), rx1 = Math.max(px0, px1)
            const ry0 = Math.min(py0, py1), ryTop = Math.max(py0, py1)
            // kind FINAL décidé par le classifieur strict (structurel), pas par le drapeau `cell.grid`
            // d'isGridCell (seuils lâches, sert uniquement au DÉCOUPAGE en amont) — cf. D (faux positifs Bonnet).
            // NB : on classifie sur `rendered.data` (NON masqué = les pixels réels du crop), PAS sur
            // `measureData` (texte masqué). Le masquage sert au DÉCOUPAGE des gouttières (splitRegionGuarded)
            // mais dilue la couverture des lignes d'une grille fusionnée avec sa légende → faux `reference`.
            // classifyGridStrict a été calibré (11/11) sur les crops non masqués : on lui donne ces mêmes pixels.
            // PAS de 4ᵉ arg : le classifieur utilise ses propres défauts calibrés (GRID_STRICT, lineCov 0.5,
            // cvMax 0.4) — DÉCOUPLÉ de PXOPTS (config de découpage dont lineCov diffère selon la voie).
            const isGrid = classifyGridStrict(rendered.data, rendered.width, { x0: cell.x0, y0: cell.y0, x1: cell.x1, y1: cell.y1 })
            const src = (globalThis.__cropCanvasStub || cropCanvas)(rendered.canvas, cell, isGrid ? GRID_CROP_PAD_FRAC : 0) // crop depuis l'ORIGINE
            if (!src) continue
            out.push({
              src, page: pageNo,
              x: rx0, y: ryTop,
              w: Math.round((rx1 - rx0) * PT2CSS),
              h: Math.round((ryTop - ry0) * PT2CSS),
              kind: isGrid ? 'grid' : 'reference',
            })
          }
        } catch { /* région illisible : ignorée */ }
      }
      // Libère le canvas offscreen de CETTE page avant de passer à la suivante (rendu par
      // lot séquentiel, cf. RENDER_MAX_DIM) : ne pas attendre la fin de tout le lot pour que
      // le GC récupère le buffer — potentiellement nombreuses pages sur un PDF riche en régions.
      rendered.canvas.width = 0
      rendered.canvas.height = 0
    }
    return out
  } catch {
    return []
  }
}

// Cœur pur de l'import d'un patron par .zip (format de sauvegarde de l'app) :
// dézip fflate en mémoire → mdToPattern → résolution des images par chemin/basename.
// Aucune dépendance Vue ni réseau. Ne jette QUE des Error à code stable ('bad-zip',
// 'no-md') pour un zip inexploitable ; toute perte partielle (image manquante)
// devient un warning structuré (code + params, cf. pattern-md/warning-codes.js)
// — règle « jamais perdre d'info ».
//
// Depuis le 15/08/2026 (compression des images importées), ce module dépend du DOM
// (`Image`/canvas, via `resizeDataUrl` de image-resize.js) pour plafonner chaque image du
// kit à 1280px/JPEG 0,8 — ce n'est donc plus « sans IO » au sens strict. ⚠️ Sous jsdom, une
// `Image` réelle ne déclenche JAMAIS `load`/`error` pour un `src` en `data:` : tout futur
// test qui importe un zip avec une vraie image DOIT mocker `@/utils/image-resize` (cf.
// `tests/unit/zip-import.spec.js` et `tests/unit/captures-pattern.spec.js`), sous peine
// d'un test qui reste bloqué jusqu'au délai d'expiration, sans aucun diagnostic.
import { unzipSync, strFromU8 } from 'fflate'
import { mdToPattern } from '@/utils/pattern-md'
import { fileToDataUrl } from '@/backup/deserialize'
import { W, WARNING_CODES } from '@/utils/pattern-md/warning-codes'
import { isSingleSize } from '@/utils/reader'
import { resizeDataUrl } from '@/utils/image-resize'
// bytesToBase64 vit désormais dans son propre module (src/utils/base64.js, partagé avec
// src/backup/saf-storage.js, memory-storage.js et PdfViewer.vue) — corps CHUNKÉ inchangé.
// Réexportée : des appelants existants (tests/unit/zip-import.spec.js notamment) l'importent
// encore depuis ce module.
import { bytesToBase64 } from '@/utils/base64'

export { bytesToBase64 }

const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
const COVER_RE = /^cover\.(jpg|jpeg|png|webp)$/i

function extOf(path) {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}
function baseOf(path) {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

// Mute `pattern` en place : remplace chaque ref-chemin d'image par sa dataURL
// (match chemin relatif exact d'abord, puis basename). Ref non résolue → warning +
// on retire la ref (jamais d'<img> cassé), sans toucher au texte de l'étape.
//
// ASYNCHRONE depuis la revue du 15/08/2026, et c'est tout l'objet du changement : une
// image écrite DIRECTEMENT dans le texte du patron.md (forme `data:image/…;base64,…`)
// repartait auparavant telle quelle, sans plafond. Le correctif du 15/08 avait fermé ce trou
// pour les images FICHIERS du kit, pas pour cette variante-là — un kit fabriqué à la
// main (et l'import .zip est justement la porte prévue pour ceux-là) passait donc
// entièrement à côté de « un entonnoir unique pour toute image entrante ». Les images
// venues d'un fichier du zip, elles, sont déjà plafonnées en amont (`unzipToPattern`
// remplit byPath/byBase avec des dataURL redimensionnées) : les repasser ici leur
// infligerait une seconde compression avec perte, donc seule la branche `data:` appelle
// `resizeDataUrl`.
export async function resolvePatternImagesFromZip(pattern, byPath, byBase) {
  const warnings = []
  const resolve = async (ref) => {
    if (typeof ref !== 'string') return ref
    if (ref.startsWith('data:')) return await resizeDataUrl(ref) // inline : plafonnée comme le reste
    const hit = byPath.get(ref) || byBase.get(baseOf(ref))
    if (hit) return hit
    warnings.push(W(WARNING_CODES.ZIP_MISSING_IMAGE, { ref }))
    return null
  }
  const reader = pattern?.reader
  const sections = reader?.sections
  if (Array.isArray(sections)) {
    for (const sec of sections) {
      const steps = sec?.steps
      if (Array.isArray(steps)) {
        for (const step of steps) {
          if (!Array.isArray(step?.imgs)) continue
          step.imgs = (await Promise.all(step.imgs.map(resolve))).filter((x) => x != null)
        }
      }
      if (sec?.chart && typeof sec.chart.img === 'string') {
        sec.chart.img = (await resolve(sec.chart.img)) || undefined
        if (sec.chart.img == null) delete sec.chart.img
      }
    }
  }
  if (reader?.chart && typeof reader.chart.img === 'string') {
    reader.chart.img = (await resolve(reader.chart.img)) || undefined
    if (reader.chart.img == null) delete reader.chart.img
  }
  if (Array.isArray(pattern?.gallery)) {
    const kept = []
    for (const g of pattern.gallery) {
      const src = await resolve(g?.src)
      if (src != null) kept.push({ ...g, src })
    }
    pattern.gallery = kept
  }
  return warnings
}

// Entrée : octets du .zip. Sortie : { pattern, warnings }. Jette Error(.code).
// ASYNCHRONE (depuis le 15/08/2026, compression des images importées) : chaque image du
// kit passe par resizeDataUrl (plafond 1280px/JPEG 0,8, même règle que tout autre point
// d'entrée) avant d'entrer dans le patron — ce plafond exige un décodage canvas, intrinsèquement
// asynchrone. Auparavant, une image de kit .zip entrait SANS AUCUN plafond, quelle que soit
// sa taille ou son format (PNG compris) : c'était le trou principal identifié.
// Plafonds de DÉCOMPRESSION (« zip bomb »). `unzipSync` alloue un tampon de la taille
// ANNONCÉE par chaque entrée, sans jamais la questionner : un .zip de 400 Ko fait de zéros
// atteint un ratio de 1024:1 et force 400 Mo d'allocation d'un coup — sur le WebView d'une
// tablette, c'est l'onglet qui meurt, pas une erreur qu'on rattrape.
//
// Le `filter` de fflate reçoit `originalSize` AVANT décompression, c'est-à-dire avant
// l'allocation : c'est le seul endroit où l'on peut refuser sans avoir déjà payé. Trois
// plafonds, parce qu'un seul se contourne — 4 000 entrées de 49 Mo passent un plafond
// par entrée de 50 Mo.
//
// Aucun de ces plafonds n'écarte un kit légitime : le format est un `patron.md` (quelques
// dizaines de Ko) plus ses photos, que `resizeDataUrl` replafonne de toute façon à
// 1280px/JPEG juste après l'extraction. Ils ne protègent QUE la décompression elle-même.
const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024
const MAX_ZIP_TOTAL_BYTES = 150 * 1024 * 1024
const MAX_ZIP_ENTRIES = 4096

export async function unzipToPattern(zipBytes) {
  let entries
  // Le filtre ne peut que REFUSER une entrée, et un refus est SILENCIEUX : filtrer sans
  // rien noter ferait ressortir un `patron.md` écarté sous le code 'no-md' (« ce zip ne
  // contient aucun patron »), un diagnostic faux. On note donc le refus et on le relève
  // APRÈS `unzipSync`, sous son propre code, avant toute autre interprétation du contenu.
  let refused = false
  let totalBytes = 0
  let entryCount = 0
  try {
    entries = unzipSync(zipBytes, {
      filter: (file) => {
        entryCount += 1
        const size = Number(file.originalSize) || 0
        if (entryCount > MAX_ZIP_ENTRIES || size > MAX_ZIP_ENTRY_BYTES) {
          refused = true
          return false
        }
        totalBytes += size
        if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
          refused = true
          return false
        }
        return true
      },
    })
  } catch {
    const e = new Error('bad-zip')
    e.code = 'bad-zip'
    throw e
  }
  if (refused) {
    // Code NOUVEAU, non traduit à dessein : `LocalPdfImportView.vue` traite tout code
    // inconnu par `importZip.failed` (« L'import a échoué. Vérifie le fichier. »), un
    // message déjà juste pour ce cas. Poser une clé i18n dédiée demanderait les quatre
    // langues et sort du périmètre visé ici ; le code, lui, reste stable et exploitable.
    const e = new Error('zip-too-big')
    e.code = 'zip-too-big'
    throw e
  }
  const names = Object.keys(entries)
  // 1) Trouver le MD : préférer patron.md à la racine, sinon la première *.md.
  const mdName =
    names.find((n) => n === 'patron.md') || names.find((n) => extOf(n) === 'md')
  if (!mdName) {
    const e = new Error('no-md')
    e.code = 'no-md'
    throw e
  }
  // 2) Décoder + parser.
  const md = strFromU8(entries[mdName])
  const { pattern, warnings } = mdToPattern(md)

  // 3) Table image : chemin relatif → dataURL PLAFONNÉE, indexée AUSSI par basename.
  const byPath = new Map()
  const byBase = new Map()
  const imageNames = names.filter((name) => name !== mdName && IMG_EXT.has(extOf(name)))
  // SÉQUENTIEL, pas `Promise.all` : chaque `resizeDataUrl` alloue une `Image` PLUS un canvas de
  // la taille de l'image décodée. En éventail, un kit à N images les décode TOUTES en même temps
  // — c'est exactement le pic mémoire que le décodage d'images du PDF évite déjà, un fichier plus
  // loin (`decodeImageObject`/`extractImagesWithPos`, src/utils/pdf.js : une image à la fois, et
  // `canvas.width = 0` derrière chacune). Le mode de défaillance ne serait pas une exception mais
  // un SILENCE : `resizeDataUrl` avale tout échec de décodage/encodage et renvoie la dataURL
  // D'ORIGINE — donc, sur un WebView à court de mémoire (Nexus 7, WebView 114), une image NON
  // PLAFONNÉE entrerait dans le patron, ruinant sans bruit le plafond que ce chemin existe pour
  // poser. Le coût est nul en pratique : le dézip est en mémoire et un kit porte quelques images.
  for (const name of imageNames) {
    const resized = await resizeDataUrl(fileToDataUrl(name, bytesToBase64(entries[name])))
    byPath.set(name, resized)
    byBase.set(baseOf(name), resized)
  }
  // 4) Résoudre les images (mute pattern) + collecter les warnings.
  warnings.push(...(await resolvePatternImagesFromZip(pattern, byPath, byBase)))

  // 5) Cover : cover.{jpg,jpeg,png,webp} à la racine → photos[0] (plafonnée), sinon [].
  const coverName = names.find((n) => COVER_RE.test(n))
  pattern.photos = coverName
    ? [await resizeDataUrl(fileToDataUrl(coverName, bytesToBase64(entries[coverName])))]
    : []

  // 6) Sizes : aligné sur LocalPdfImportView.currentPattern — « Taille unique » ne
  // s'affiche PAS comme une taille sur la fiche/carte (sizes vide plutôt que
  // ['Taille unique']). mdToPattern renvoie pattern.sizes = [...sizeLabels] (inclut
  // 'Taille unique') ; on normalise ici, dans la couche zip (jamais dans mdToPattern,
  // partagé avec l'éditeur/correction). patternsStore.add ne normalise pas.
  const sl = pattern.reader?.sizeLabels
  if (Array.isArray(sl)) pattern.sizes = isSingleSize(sl) ? [] : [...sl]

  return { pattern, warnings }
}

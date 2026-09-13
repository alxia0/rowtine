// Rowtine — helpers de nommage (slug, dossier d'entrée, data URL) pour la sérialisation
// de sauvegarde en arborescence de fichiers (Lot S2). Purs, sans IO ni dépendance Vue.

const MAX_SLUG_LENGTH = 60

// Caractères interdits dans un nom de fichier/dossier (Windows + contrôle) ainsi que
// les espaces : tous sont convertis en tiret. (Plage de contrôle volontaire.)
// oxlint-disable-next-line no-control-regex
const ILLEGAL_CHARS_RE = /[/\\:*?"<>|\s\x00-\x1f\x7f]/g

// Translittère les accents (é→e…), met en minuscules, retire les caractères illégaux
// pour un système de fichiers, remplace les espaces par des tirets, collapse les tirets
// répétés et borne la longueur. Renvoie 'sans-nom' si le résultat est vide.
export function slugify(name) {
  if (typeof name !== 'string') return 'sans-nom'

  let s = name
    .normalize('NFD') // sépare lettre + diacritique (é → e + ´)
    .replace(/[\u0300-\u036f]/g, '') // retire les marques diacritiques (U+0300-U+036F)
    .toLowerCase()
    .replace(ILLEGAL_CHARS_RE, '-') // caractères interdits / espaces → tiret
    .replace(/-+/g, '-') // collapse les tirets répétés
    .replace(/^-+|-+$/g, '') // trim des tirets en début/fin

  if (s.length > MAX_SLUG_LENGTH) {
    // Borne la longueur par POINT DE CODE (pas unité UTF-16) pour ne jamais couper
    // un caractère astral (emoji) en deux → nom de fichier valide.
    s = Array.from(s).slice(0, MAX_SLUG_LENGTH).join('').replace(/-+$/g, '')
  }

  return s || 'sans-nom'
}

// Nom de dossier pour une entrée (projet, patron…) : slug + id entre crochets,
// ex. "pull-torsade [7]".
export function entryFolderName(name, id) {
  return `${slugify(name)} [${id}]`
}

// Extrait l'id numérique d'un nom de dossier généré par entryFolderName.
// Renvoie null si le nom ne se termine pas par "[<digits>]".
export function parseEntryId(folderName) {
  if (typeof folderName !== 'string') return null
  const m = folderName.match(/\[(\d+)\]\s*$/)
  return m ? Number(m[1]) : null
}

// Nom d'affichage d'une entrée de dossier : le suffixe « [id] » est un détail de
// stockage (cf. parseEntryId), jamais un nom montré. Jumeau inverse de parseEntryId :
// même ancrage, même tolérance aux espaces — les deux évoluent ensemble.
export function displayEntryName(folderName) {
  if (typeof folderName !== 'string') return folderName
  return folderName.replace(/\s*\[\d+\]\s*$/, '')
}

// Table de correspondance mime → extension de fichier. Exportée : deserialize.js
// en dérive EXT_TO_MIME par inversion, pour que les deux tables ne puissent pas
// diverger.
export const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

// Découpe une data URL base64 en { mime, ext, base64 }. Renvoie null si ce n'est pas
// une data URL base64 valide (ex. data URL au format texte brut, ou chaîne quelconque).
export function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null
  const m = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s)
  if (!m) return null
  const mime = m[1]
  const base64 = m[2]
  const ext = MIME_TO_EXT[mime] || 'bin'
  return { mime, ext, base64 }
}

// Hash non-cryptographique à 2 mots de 32 bits (variante cyrb53). Utilisé uniquement
// pour générer un nom de fichier déterministe et discriminant — aucune propriété
// cryptographique requise.
// Référence : https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return [h1 >>> 0, h2 >>> 0]
}

// Hash court (8 hex = 32 bits) déterministe d'une chaîne, pour nommer les fichiers
// photo. On combine les deux mots du hash (XOR) pour ne perdre aucun bit de mixage.
export function hash8(str) {
  const [h1, h2] = cyrb53(str)
  return ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0')
}

// Nom de fichier pour une photo : "photo-<hash8>.<ext>", déterministe (même contenu
// base64 → même nom) et discriminant (contenus différents → noms différents).
// Si la data URL est invalide, on retombe sur "photo-<fallbackIndex>.bin".
export function photoFileName(dataUrl, fallbackIndex) {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return `photo-${fallbackIndex}.bin`
  return `photo-${hash8(parsed.base64)}.${parsed.ext}`
}

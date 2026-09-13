// Rowtine — redimensionnement/recompression d'une data URL image, pur (canvas + Image du
// navigateur), sans dépendance native. Extrait de photo.js le 15/08/2026 (spec compression
// images importées) pour être réutilisable par zip-import.js sans tirer @capacitor/camera.

// Redimensionne une data URL d'image côté JS (canvas), bornée à `maxDim` sur le grand côté,
// puis ré-encode TOUJOURS en JPEG — même si l'image est déjà assez petite. Avant le 15/08/2026,
// une image déjà sous le plafond repartait intacte (PNG compris) : c'est ce trou qui laissait
// passer, sans plafond, toute photo déjà petite choisie en galerie — camée compris. Renvoie la
// data URL d'origine si `document` est indisponible, si `dataUrl` est vide, ou en cas d'échec de
// décodage/encodage (jamais d'exception qui casserait l'appelant).
export function resizeDataUrl(dataUrl, maxDim = 1280, quality = 0.8) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !dataUrl) return resolve(dataUrl)
    const img = new Image()
    img.onload = () => {
      const { width, height } = img
      const scale = Math.min(1, maxDim / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(dataUrl)
      // Fond blanc obligatoire AVANT le dessin : le JPEG n'a pas d'alpha, et le canvas
      // naît transparent (donc NOIR une fois composité sans ce remplissage) — même règle
      // que cropCanvas (pdf.js), documentée là-bas dans les mêmes termes. Sans lui, un PNG
      // transparent importé (croquis d'un kit .zip, capture avec fond alpha) devenait un
      // rectangle noir silencieux : `toDataURL('image/jpeg')` ne jette jamais d'erreur.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      try {
        resolve(canvas.toDataURL('image/jpeg', quality))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// Ajoutée à la suite de resizeDataUrl ci-dessus, SANS la modifier (3 sites de test
// dépendent de son réencodage systématique). Plafonne une data URL SEULEMENT si ses
// dimensions OU son poids réels (mesurés après décodage) dépassent le plafond des 3
// autres portes d'entrée d'images (galerie, PDF, kit .zip — toutes 1280px/JPEG q0.8).
// Contrairement à resizeDataUrl, ne touche PAS une image déjà conforme : nécessaire
// ici, ce chemin (synchro `patron.md`) tourne à CHAQUE édition externe du fichier —
// recompresser une image déjà JPEG 0.8 écrite par l'app la dégraderait un peu plus
// à chaque passage (dégradation cumulative, jamais désirée).
// `maxBytes` par défaut (600 Ko) : décision produit posée dans l'intent
// `quatrieme-porte-images-sans-plafond` faute de constante de poids existante
// ailleurs dans le dépôt pour ce cas — pas une mesure, à faire valider par Julien
// si le seuil s'avère mal calibré en usage réel.
function base64ByteLength(dataUrl) {
  const i = dataUrl.indexOf(',')
  const b64 = i === -1 ? '' : dataUrl.slice(i + 1)
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

export function capDataUrlIfOversized(dataUrl, maxDim = 1280, quality = 0.8, maxBytes = 600_000) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !dataUrl || !dataUrl.startsWith('data:')) {
      return resolve(dataUrl)
    }
    if (base64ByteLength(dataUrl) > maxBytes) return resolve(resizeDataUrl(dataUrl, maxDim, quality))
    const img = new Image()
    img.onload = () => {
      if (Math.max(img.width, img.height) <= maxDim) return resolve(dataUrl)
      resolve(resizeDataUrl(dataUrl, maxDim, quality))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

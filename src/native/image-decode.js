import { registerPlugin } from '@capacitor/core'

// Pont vers ImageDecodePlugin (Android natif) : sélection ET décodage d'une image de
// galerie côté OS. Remplace <input type="file"> + resizeDataUrl côté WebView pour le
// geste « galerie » sur plateforme native. La WebView Android ne sait pas décoder le
// HEIC/HEIF, l'OS oui (ImageDecoder, API 28+). Voir utils/photo.js pour l'appelant.
const ImageDecode = registerPlugin('ImageDecode')

// Ouvre le sélecteur système, décode et normalise (≤1280px, JPEG fond blanc q0.8) côté
// natif. Renvoie une data URL, ou null si l'utilisatrice annule le sélecteur. Rejette
// si un fichier A été choisi mais n'a pas pu être décodé, à distinguer d'une
// annulation par l'appelant (utils/photo.js affiche un message dans ce cas précis).
export async function pickAndDecodeGalleryImage() {
  const { dataUrl } = await ImageDecode.pickAndDecode()
  return dataUrl || null
}

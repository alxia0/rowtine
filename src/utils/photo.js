import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { resizeDataUrl } from './image-resize'
import { usePhotoSourceStore } from '@/stores/photo-source'

// Réexportée pour compatibilité : `resizeDataUrl` vit maintenant dans image-resize.js
// (module pur, sans dépendance @capacitor/camera — cf. zip-import.js).
export { resizeDataUrl }

// POURQUOI un input fichier pour la galerie, et plus le plugin @capacitor/camera
// (décision produit du 04/09/2026, option (a)) : sur le chemin galerie du plugin v8.2.2,
// LegacyCameraFlow.java (compress JPEG, lignes 463/570/603 de node_modules) ré-encode
// TOUT en JPEG côté natif SANS remplissage — un PNG transparent devient un JPEG opaque
// fond noir AVANT d'atteindre la webview (mesuré sur appareil le 04/09 : photo de laine
// stockée fond (0,0,0) ; octets identiques avec et sans fillRect en aval, l'alpha est
// cuite dans les pixels, aucune retouche JS en aval ne peut rattraper). Le sélecteur
// système ouvert par <input type="file"> livre lui les octets D'ORIGINE, PNG alpha
// compris ; c'est resizeDataUrl qui borne (1280 px) puis aplatit sur fond blanc (JPEG
// opaque par construction). L'appareil photo RESTE au plugin natif : ses photos sont
// opaques, aucun problème d'alpha, et on garde le bornage natif (width 1600).
//
// ⚠️ Piège mémoire assumé et documenté : le plugin bornait CÔTÉ NATIF (width 1600) avant
// de livrer sa dataUrl ; l'input fichier livre le fichier ORIGINAL et le décodage
// pleine résolution se fait maintenant DANS la webview (Image de resizeDataUrl).
// Acceptable pour des photos de pelotes/patrons (≤ ~12 Mpx, ~48 Mo de bitmap RGBA) :
// décodage ponctuel, canvas borné juste après, rien n'est conservé plein format.

// Lecture d'un File choisi via l'input fichier en data URL. Exportée (en plus d'être le
// seam DOM unique du chemin galerie) pour être couverte directement par photo.spec.js
// avec un FileReader stubé — jsdom ne lit pas les vrais octets.
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Ouvre le sélecteur système via un <input type="file"> dynamique (jamais inséré dans le
// DOM, cliqué directement) et résout avec le File choisi, ou null si l'utilisatrice
// referme le sélecteur sans choisir — événement `cancel` (navigateurs récents/WebView),
// et `change` sans fichier par sécurité (certains sélecteurs renvoient un change vide).
// ⚠️ Caveat assumé : les WebView Chromium < 113 ne tiraient AUCUN événement quand le
// sélecteur était refermé sans choix — la promesse y reste pendante. Conséquence bénigne
// (aucun appelant ne verrouille l'UI à travers l'await : un nouveau tap relance le flux,
// seule la fermeture input+promesse fuit, quelques octets), et l'app vise des WebView
// récents ; documenté ici plutôt que corrigé en surface pour un cas disparu.
function pickGalleryFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.addEventListener('change', () => resolve(input.files?.[0] || null))
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

// Capture/sélection d'une photo : feuille maison « galerie / appareil photo » puis, selon
// le geste, input fichier (octets d'origine) ou plugin natif. Renvoie une data URL
// redimensionnée (≤ 1280 px, JPEG fond blanc), ou null si l'utilisatrice annule (ou en
// cas d'échec — l'appelant reste fonctionnel).
export async function pickImage() {
  // Seam e2e : en build de test (VITE_E2E défini), on renvoie une photo déterministe
  // injectée par Playwright sans toucher au plugin natif NI à la feuille. Tree-shaké en
  // prod (VITE_E2E est undefined → la condition est éliminée au build). Voir tests/e2e/.
  if (import.meta.env.VITE_E2E && typeof window !== 'undefined' && '__E2E_PHOTO__' in window) {
    return window.__E2E_PHOTO__ // data URL, ou null pour simuler une annulation
  }
  // 1. Demander le geste à l'utilisatrice via la feuille maison (remplace le prompt
  //    natif — ses promptLabel* ont sauté avec lui, les libellés vivent maintenant dans
  //    PhotoSourceSheet.vue via vue-i18n). `usePhotoSourceStore()` est appelé ICI, à
  //    l'exécution (pas au niveau du module) : l'import ne doit exiger aucune instance
  //    Pinia active, seuls les appels réels en ont une.
  const choice = await usePhotoSourceStore().askSource()
  if (!choice) return null

  if (choice === 'camera') {
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        // PAS de `allowEditing` : sur Android récent, l'éditeur/recadrage natif
        // (FilterShowActivity de la Galerie) plante (« column '_data' does not exist » —
        // colonne legacy disparue avec le stockage cantonné), ce qui fait planter le flux
        // d'ajout de photo. On s'en passe : le recadrage in-app existe (pickAndCropImage).
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        quality: 80,
        // Bornage NATIF de la taille : le plugin réduit côté natif (évite aussi de
        // décoder une image pleine résolution dans la WebView).
        width: 1600,
      })
      if (!photo?.dataUrl) return null
      // Affinage côté JS : garantit un grand côté ≤ 1280 px même si le plugin n'a pas
      // réduit. S'applique sur une image déjà bornée par le plugin → décodage canvas
      // sans risque mémoire.
      return await resizeDataUrl(photo.dataUrl, 1280, 0.8)
    } catch {
      // Annulation utilisateur ou indisponibilité : on ne casse rien.
      return null
    }
  }

  // 2. Geste « galerie » : input fichier → octets d'origine → borne 1280 px + fond blanc
  //    (cf. bloc POURQUOI/piège mémoire en tête de module).
  try {
    const file = await pickGalleryFile()
    if (!file) return null
    const dataUrl = await fileToDataUrl(file)
    if (!dataUrl) return null
    return await resizeDataUrl(dataUrl, 1280, 0.8)
  } catch {
    // Fichier illisible ou FileReader en échec : annulation silencieuse, comme avant.
    return null
  }
}

// Prend une photo PUIS propose un recadrage in-app (remplace l'éditeur natif désactivé).
// Renvoie la data URL recadrée, ou null (annulation à la prise OU au recadrage).
// `cropFn` est injecté par l'appelant (cropperStore.crop) pour éviter un import circulaire
// store↔util. Le module dépend désormais du store photo-source (feuille maison du 04/09) :
// sans cycle possible, ce store n'importe rien de photo.js ; l'injection reste pour le
// CROPPER, dont l'import direct recréerait le couplage que ce paramètre évite.
export async function pickAndCropImage(cropFn) {
  // Seam e2e : on court-circuite la modale de recadrage (sinon le test bloquerait).
  if (import.meta.env.VITE_E2E && typeof window !== 'undefined' && '__E2E_PHOTO__' in window) {
    return window.__E2E_PHOTO__
  }
  const picked = await pickImage()
  if (!picked) return null
  if (typeof cropFn !== 'function') return picked
  const cropped = await cropFn(picked)
  return cropped || null
}

// Partage natif d'une image de badge déjà générée (dataURL) — même montage que `sharePhoto()`
// dans src/views/ProjectDetailView.vue (Filesystem + Share, tous deux déjà des dépendances du
// projet) : la Web Share API (`navigator.share`) n'est PAS disponible dans la WebView Android
// de Capacitor, contrairement à un vrai navigateur — s'y fier exclusivement laissait le
// partage échouer en silence sur appareil (retour Julien, test réel Pixel, 17/09). Un data:
// URI n'étant pas partageable tel quel par le plugin Share, on l'écrit d'abord en fichier
// cache pour obtenir un vrai URI.
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { writeDataUrlToCacheFile } from './cache-file'

export async function shareImageDataUrl(dataUrl, { title = '', filename = 'badge.jpg' } = {}) {
  try {
    if (Capacitor.isNativePlatform()) {
      const uri = await writeDataUrlToCacheFile(dataUrl, filename)
      await Share.share({ files: [uri], title })
    } else {
      await Share.share({ url: dataUrl, title })
    }
    return true
  } catch {
    // partage annulé (feuille système fermée par l'utilisatrice) ou indisponible : rien à
    // signaler, même convention que sharePhoto() ci-dessus référencé.
    return false
  }
}

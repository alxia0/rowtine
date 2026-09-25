// Écrit une dataURL en fichier cache Capacitor et renvoie son URI — étape commune à
// l'ouverture externe d'un PDF (open-pdf.js) et au partage d'image (share-badge.js) : ni
// FileOpener ni Share n'acceptent un data: URI tel quel, il leur faut un vrai URI de
// fichier.
import { Filesystem, Directory } from '@capacitor/filesystem'

export async function writeDataUrlToCacheFile(dataUrl, filename) {
  const base64 = dataUrl.split(',')[1] || ''
  await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache })
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
  return uri
}

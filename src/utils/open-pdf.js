// Ouvre un PDF (data URL) dans une appli externe. Natif : écrit en cache Capacitor puis
// ouvre via FileOpener (intent Android, FileProvider fourni par le plugin — cf. README).
// Web/dev : nouvel onglet. Best-effort : lève en cas d'échec, l'appelant affiche un snackbar.
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { FileOpener } from '@capacitor-community/file-opener'

export async function openPdfExternally(dataUrl, fileName = 'patron.pdf') {
  if (!Capacitor.isNativePlatform()) {
    window.open(dataUrl, '_blank')
    return
  }
  const base64 = dataUrl.split(',')[1] || ''
  await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache })
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache })
  // `contentType` (pas `mimeType`) : nom du champ dans FileOpenerOptions du plugin installé.
  await FileOpener.open({ filePath: uri, contentType: 'application/pdf' })
}

// Reconnaissance du type d'un fichier importé, par son CONTENU et jamais par son nom.
//
// Pourquoi pas l'extension : sur Android, le sélecteur de fichiers rend un `content://`
// dont le nom n'est pas toujours exploitable. Un aiguillage sur `file.name` échouerait,
// pour un .zip comme pour un .rowtine (même format d'archive, extension propre à Rowtine).
// Décision du 23/09 : l'import au format Rowtine est une porte visible et documentée
// (option de la feuille d'ajout), il n'est plus caché derrière l'import PDF.
export const SNIFF_BYTES = 4

// Filtres des sélecteurs de fichiers, partagés par la feuille d'ajout (LibraryView.vue) et
// l'écran d'import (LocalPdfImportView.vue). Le WebView Android traduit `accept` en types
// MIME et ignore une extension inconnue : sans les types zip et `octet-stream`, un .rowtine
// serait grisé dans le sélecteur. Le contenu reste seul juge (cf. sniffImportKind).
export const PDF_ACCEPT = 'application/pdf,.pdf'
export const ROWTINE_ACCEPT = '.rowtine,.zip,application/zip,application/x-zip-compressed,application/octet-stream'

const PDF_SIG = [0x25, 0x50, 0x44, 0x46] // "%PDF"
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04] // "PK\x03\x04"

function startsWith(bytes, sig) {
  if (!bytes || bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

// `head` = les premiers octets du fichier (SNIFF_BYTES suffisent).
// Tout ce qui n'est ni l'un ni l'autre rend 'unknown' : par la porte PDF, l'appelant retombe
// alors sur la voie PDF (la porte Rowtine, elle, refuse tout ce qui n'est pas un zip).
// C'est volontaire — certains PDF portent des octets avant `%PDF-`, qu'une
// reconnaissance sur 4 octets peut légitimement manquer ; retomber sur la voie PDF absorbe
// ce cas sans créer de mode de défaillance nouveau.
// ⚠️ Ne pas « corriger » ce repli en message d'erreur : ce serait rendre inimportables des
// PDF qui passent aujourd'hui.
export function sniffImportKind(head) {
  if (startsWith(head, ZIP_SIG)) return 'zip'
  if (startsWith(head, PDF_SIG)) return 'pdf'
  return 'unknown'
}

// `file.slice(0, 4)` ne charge pas le fichier : la lecture est bon marché même sur un PDF
// de plusieurs mégaoctets.
export async function sniffFile(file) {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
  return sniffImportKind(head)
}

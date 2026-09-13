// Reconnaissance du type d'un fichier importé, par son CONTENU et jamais par son nom.
//
// Pourquoi pas l'extension : sur Android, le sélecteur de fichiers rend un `content://`
// dont le nom n'est pas toujours exploitable. Un aiguillage sur `file.name` échouerait
// précisément dans la situation de dépannage que la porte de service doit servir (un .zip
// préparé pour une utilisatrice, choisi sur SON téléphone).
export const SNIFF_BYTES = 4

const PDF_SIG = [0x25, 0x50, 0x44, 0x46] // "%PDF"
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04] // "PK\x03\x04"

function startsWith(bytes, sig) {
  if (!bytes || bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

// `head` = les premiers octets du fichier (SNIFF_BYTES suffisent).
// Tout ce qui n'est ni l'un ni l'autre rend 'unknown' : l'appelant retombe alors sur la
// voie PDF. C'est volontaire — certains PDF portent des octets avant `%PDF-`, qu'une
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

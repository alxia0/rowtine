// Conversions octets <-> base64, PARTAGÉES par les deux implémentations de BackupStorage
// (mémoire et SAF, src/backup/), par l'import .zip (zip-import.js) et par PdfViewer.vue.
// Vit dans src/utils/ (pas src/backup/) précisément parce qu'un COMPOSANT en a besoin —
// pas seulement le sous-système de sauvegarde. Pas de Buffer : ces fonctions doivent rester
// utilisables aussi bien côté app/WebView que par les fakes de test. btoa/atob sont dispo
// partout.

// Uint8Array → base64. Découpe en tranches de 0x8000 (PAS le spread `String.fromCharCode(…bytes)`,
// ni une boucle caractère par caractère) : MESURÉ sur le V8 de Node, 98 304 arguments passent,
// 131 072 lèvent « Maximum call stack size exceeded » — et la limite dépend du moteur ET de la
// profondeur de pile déjà consommée au point d'appel. Une tranche pleine du pont (384 Kio de
// saf-storage.js, soit 393 216 arguments) passerait 3 à 4 fois AU-DELÀ de cette limite : le
// découpage à taille fixe — indépendant de la tranche du pont — supprime la question pour les
// GROS fichiers (photos, PDF), tout en restant nettement plus rapide qu'une boucle caractère par
// caractère sur les petits.
export function bytesToBase64(u8) {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

// base64 → octets. `atob` rend une chaîne binaire (un caractère = un octet) : c'est bien
// cette chaîne qu'il faut repasser en octets, PAS traiter comme du texte.
export function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

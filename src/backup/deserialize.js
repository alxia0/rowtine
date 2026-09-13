// Rowtine — désérialiseurs d'entités (purs, sans IO) pour la restauration depuis
// l'arborescence de fichiers de sauvegarde. Inverses exacts des
// sérialiseurs de serialize.js : round-trip serialize → deserialize
// = entité d'origine.
//
// Convention `filesByName` (contrat avec readBackup) :
//   { [nomDeFichier]: contenu } pour les fichiers d'un même dossier (Projets/<...>
//   ou Patrons/<...>), à l'EXCLUSION du fichier JSON principal du dossier
//   (projet.json / patron.json) : celui-ci est fourni séparément, déjà parsé (JSON.parse
//   fait par l'appelant), en premier argument des fonctions ci-dessous.
//   Contenu selon le type de fichier :
//     - fichiers `*.json` imbriqués (ex. patron.json d'une instance dans un dossier
//       Projets/<...>) : chaîne UTF8 (texte JSON brut, PAS encore parsé — c'est
//       `deserializeProject` qui s'en charge en interne) ;
//     - fichiers `photo-*` / `patron-photo-*` / `original.pdf` : chaîne base64 (même
//       forme que la partie après la virgule d'une data URL).

import { MIME_TO_EXT } from './naming'
import { sanitizeUrl } from '../utils/safe-url'

// Dérivée par inversion de MIME_TO_EXT (naming.js), pour que les deux tables ne
// puissent pas diverger (ajouter un type mime supporté ne se fait qu'à un seul
// endroit).
// PROTOTYPE NUL (correctif sécurité) : l'extension interrogée ci-dessous vient d'un NOM
// DE FICHIER trouvé sur le disque, donc d'une chaîne que personne ne contrôle. Sur un
// objet ordinaire, `EXT_TO_MIME['constructor']` rend une fonction — interpolée telle
// quelle dans la data URL — et `EXT_TO_MIME['__proto__']` rend `Object.prototype`. Un
// objet sans prototype n'a rien à rendre d'autre que ce qu'on y a mis.
const EXT_TO_MIME = Object.assign(
  Object.create(null),
  Object.fromEntries(Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])),
)

// extension de fichier → type mime. Défaut 'application/octet-stream' pour une
// extension inconnue (ex. 'bin', cf. le repli de `photoFileName` sur data URL
// invalide).
export function extToMime(ext) {
  return EXT_TO_MIME[ext] || 'application/octet-stream'
}

// Reconstruit une data URL à partir d'un nom de fichier (dont on tire l'extension)
// et de son contenu base64. Inverse de `parseDataUrl` combiné à `photoFileName`.
// `fileName` non-chaîne (item de galerie sans `src` NI `name` — un JSON écrit à la
// main, cf. `deserializePattern`) : extension vide plutôt qu'un `TypeError` qui ferait
// échouer la restauration ENTIÈRE (principe cardinal : un dossier abîmé n'emporte
// jamais les autres).
export function fileToDataUrl(fileName, base64) {
  const name = typeof fileName === 'string' ? fileName : ''
  const dot = name.lastIndexOf('.')
  const ext = dot === -1 ? '' : name.slice(dot + 1)
  return `data:${extToMime(ext)};base64,${base64 || ''}`
}

// Lecture SÛRE d'un `filesByName` : ses clés sont des noms de fichiers lus sur le
// disque. `filesByName['__proto__']` sur un objet littéral rendrait `Object.prototype`
// (puis `String(Object.prototype)` dans la data URL) sans qu'aucun fichier de ce nom
// existe. `Object.hasOwn` est appliqué ICI, au point de lecture, et pas seulement là où
// l'objet est construit : ces fonctions sont exportées, appelées par les tests et par
// `resolve-reader-assets.js` avec un `{}` par défaut — on ne peut pas supposer que
// l'appelant a construit un objet sans prototype.
function lookupFile(filesByName, name) {
  if (!filesByName || typeof name !== 'string') return undefined
  return Object.hasOwn(filesByName, name) ? filesByName[name] : undefined
}

// Une entrée est de l'une des DEUX formes produites par `buildPhotoFiles` OU par
// `serializeYarns` (serialize.js — même discriminant, même mécanisme, juste un tableau
// d'ENTITÉS plutôt que de photos) :
//   - un nom de fichier (`photo-<hash>.<ext>`, `patron-photo-…`, `laine-photo-…`) → la
//     data URL se reconstruit depuis le contenu base64 du fichier ;
//   - une data URL conservée telle quelle, parce que `parseDataUrl` ne savait pas
//     l'analyser (forme non base64, ex. `data:image/svg+xml;utf8,…`) → elle est rendue
//     IDENTIQUE, sans passer par un fichier.
// Le discriminant, le préfixe `data:`, est le MIROIR EXACT de celui de la sérialisation :
// un nom de fichier produit par serialize.js ne commence jamais par `data:`.
// `missing` (tableau, optionnel) reçoit le nom de chaque fichier référencé mais absent
// de `filesByName` — jamais une data URL fabriquée sur un base64 vide (ancien défaut :
// `data:image/jpeg;base64,` sans un mot, qui se gravait à la sauvegarde suivante).
// Renvoie `null` pour une entrée manquante : à FILTRER par l'appelant (photosFromNames,
// la galerie), jamais à conserver telle quelle dans le tableau final.
// Politique opposée à `resolvePath` de resolve-reader-assets.js pour la même situation
// (fichier absent de `filesByName`) : ici la restauration ZIP/dossier peut se permettre de
// perdre la photo, alors que là-bas le chemin nu vient du `patron.md` écrit à la main —
// le réécrire serait modifier silencieusement le texte de l'utilisatrice.
function photoFromEntry(entry, filesByName, missing) {
  if (typeof entry === 'string' && entry.startsWith('data:')) return entry
  const base64 = lookupFile(filesByName, entry)
  if (base64 == null) {
    missing?.push(entry)
    return null
  }
  return fileToDataUrl(entry, base64)
}

// Reconstitue un tableau de data URLs à partir d'une liste d'entrées (noms de fichiers,
// avec doublons éventuels alignés sur l'index d'origine — cf. `buildPhotoFiles` côté
// serialize.js — ou data URLs conservées telles quelles) et du filesByName du dossier
// contenant ces photos.
// `names` non-tableau (JSON restauré abîmé : `photos: null`, `photos: {}`) → `[]`.
// Laisser passer la valeur telle quelle plantait ici même (`.map` n'existe pas) et
// aurait de toute façon écrit en base une entité dont `photos` n'est pas itérable —
// chaque écran qui la parcourt lèverait à son tour.
function photosFromNames(names, filesByName, missing) {
  return (Array.isArray(names) ? names : [])
    .map((entry) => photoFromEntry(entry, filesByName, missing))
    .filter((v) => v != null)
}

// Repli sûr pour tout champ que l'app lit comme un TABLEAU : `null`, un objet ou une
// chaîne y deviennent `[]`. Validation MINIMALE et volontairement bête — on évite le
// `TypeError`, on ne juge pas le contenu.
function asArray(value) {
  return Array.isArray(value) ? value : []
}

// Désérialise un patron (bibliothèque OU instance imbriquée dans un projet) :
// photos `photo-*`/`patron-photo-*` → data URLs, `original.pdf` (si présent dans
// filesByName) → `pattern.pdf` en data URL. Inverse de `serializePattern`.
export function deserializePattern(patronJson, filesByName = {}, missing = []) {
  const json = patronJson && typeof patronJson === 'object' && !Array.isArray(patronJson) ? patronJson : {}
  const { photos, gallery, ...rest } = json
  const pattern = { ...rest, photos: photosFromNames(photos, filesByName, missing) }
  // `authorUrl` traverse le disque : il vient d'un `patron.json` qu'on peut ouvrir dans
  // un éditeur de texte, et il finit dans un `href` (PatternView.vue). Même règle qu'à
  // l'import d'un `.md`/`.zip` — liste blanche http/https, et une URL refusée DISPARAÎT
  // (cf. src/utils/safe-url.js). Réécrit UNIQUEMENT si la clé existe : l'ajouter partout
  // casserait le round-trip `serialize → deserialize = entité d'origine` que ce module
  // annonce en tête de fichier.
  if ('authorUrl' in pattern) pattern.authorUrl = sanitizeUrl(pattern.authorUrl)
  if (Array.isArray(gallery)) {
    pattern.gallery = gallery
      // Un item non-objet (un `null` laissé par une édition à la main) n'a ni `src` ni
      // `page` : il est écarté, pas déréférencé.
      .filter((g) => g && typeof g === 'object')
      .map((g) => ({
        // `src` n'est présent que pour une image conservée telle quelle (pas de fichier
        // écrit pour elle) ; sinon c'est `name` qui porte le nom du fichier gallery-*.
        src: photoFromEntry(g.src ?? g.name, filesByName, missing),
        page: g.page || 0,
        w: g.w || 0,
        h: g.h || 0,
      }))
      .filter((g) => g.src != null)
  }
  const pdfBase64 = lookupFile(filesByName, 'original.pdf')
  if (pdfBase64 != null) {
    pattern.pdf = fileToDataUrl('original.pdf', pdfBase64)
  }
  return pattern
}

// Désérialise un projet : photos → data URLs, ré-extrait les tableaux embarqués
// (sections/counters/sessions/diagrams), et si patron.json est présent dans
// filesByName (patron d'instance forké pour ce projet — cf. serializeProject),
// reconstruit `instancePattern` (+ ses photos `patron-photo-*` + `original.pdf`,
// partageant le même filesByName que le projet puisqu'ils vivent dans le même
// dossier). Inverse de `serializeProject`.
export function deserializeProject(projetJson, filesByName = {}, missing = []) {
  const json = projetJson && typeof projetJson === 'object' && !Array.isArray(projetJson) ? projetJson : {}
  const { photos, sections, counters, sessions, diagrams, ...rest } = json
  const project = { ...rest, photos: photosFromNames(photos, filesByName, missing) }

  let instancePattern = null
  const patronText = lookupFile(filesByName, 'patron.json')
  if (patronText != null) {
    instancePattern = deserializePattern(JSON.parse(patronText), filesByName, missing)
  }

  return {
    project,
    sections: asArray(sections),
    counters: asArray(counters),
    sessions: asArray(sessions),
    diagrams: asArray(diagrams),
    instancePattern,
  }
}

// Laines : chaque entité peut porter SOIT une photo inline (ancien format, avant le
// 15/08/2026), SOIT un nom de fichier laine-photo-* à résoudre via `filesByName` (nouveau
// format — cf. serializeYarns). Même discriminant que photoFromEntry pour patrons/projets :
// le préfixe `data:`. `filesByName` est indexé par NOM DE FICHIER, jamais par chemin : il
// fusionne les photos rangées sous `Laines/` (depuis le 21/08/2026) et celles restées à la
// RACINE (avant) — cf. restore.js pour sa construction. C'est parce que `laines.json` n'a
// jamais porté que le nom que cette fonction n'a pas eu à changer d'un octet.
export function deserializeYarns(json, filesByName = {}) {
  return asArray(json).map((yarn) => {
    // `laines.json` réduit à `[null]` par une édition à la main : la ligne est rendue
    // telle quelle, la validation d'entité (restore.js) l'écartera avec un rapport —
    // ici on ne fait que ne pas lever.
    if (!yarn || typeof yarn !== 'object' || !yarn.photo) return yarn
    return { ...yarn, photo: photoFromEntry(yarn.photo, filesByName) }
  })
}

// Compteurs indépendants : le JSON parsé (compteurs.json) EST déjà le tableau
// d'entités. Fournie pour symétrie/API uniforme.
export function deserializeIndependentCounters(json) {
  return asArray(json)
}

// Achats : le JSON parsé (achats.json) EST déjà le tableau d'entités — registre
// plat, symétrique de serializePurchases. `json` vaut `null`/`undefined` quand
// l'appelant n'a pas pu distinguer "fichier absent" de son repli (cf. restore.js,
// qui tranche lui-même via `storage.exists('achats.json')` pour déclencher la reprise).
export function deserializePurchases(json) {
  return asArray(json)
}

// Journal des jours actifs : le JSON parsé (jours-actifs.json) EST déjà le tableau de lignes
// `{ day }` — registre plat, symétrique de serializeActiveDays. Fichier absent → `[]`, et non
// une erreur : une sauvegarde antérieure au lot 2 doit se restaurer proprement.
export function deserializeActiveDays(json) {
  return asArray(json)
}

// Réglages : reglages.json est un objet { clé: valeur } → lignes { key, value }
// (forme table `db.settings`). Inverse de `serializeSettings` (à ceci près que les
// clés exclues de la sauvegarde n'y figurent naturellement pas).
export function deserializeSettings(json) {
  // `reglages.json` est un OBJET. Un tableau y donnerait des clés « 0 », « 1 »… et une
  // chaîne, une clé par caractère : deux façons de polluer `db.settings` à partir d'un
  // fichier édité à la main. Tout ce qui n'est pas un objet simple vaut « pas de
  // réglages » — la fusion de `writeSnapshotToDb` préserve alors ceux déjà en base.
  const obj = json && typeof json === 'object' && !Array.isArray(json) ? json : {}
  return Object.entries(obj).map(([key, value]) => ({ key, value }))
}

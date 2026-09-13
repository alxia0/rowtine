// Rowtine — sérialiseurs d'entités (purs, sans IO) pour la sauvegarde en arborescence
// de fichiers. Chaque fonction décrit les fichiers à écrire ;
// l'écriture réelle (via BackupStorage) est faite par l'orchestrateur.

import { entryFolderName, parseDataUrl, photoFileName } from './naming'
import { buildPatternMdFiles } from './pattern-md-file'

// Clés de reglages.json à ne JAMAIS sauvegarder : état volatil, propre à cet
// appareil et à cette installation.
const EXCLUDED_SETTINGS_KEYS = [
  // Session de lecture/correction en cours : n'a de sens que sur CET appareil,
  // à cet instant. La restaurer ferait rouvrir une session qui n'existe plus.
  'activeSession',
  // Décision de sauvegarde (avenant du 04/08/2026) : état LOCAL à cet appareil et à
  // CE dossier. S'il partait dans la sauvegarde, `writeSnapshotToDb` (qui fait primer
  // les réglages du snapshot) le remplacerait par celui de l'ancien téléphone — le
  // nouvel appareil se croirait acquitté sur un dossier qu'il n'a jamais vu.
  'backupDecision',
  // Identité de l'appareil (lot du 06/08/2026) : LOCALE, comme la décision juste
  // au-dessus et pour la même raison. Restaurée depuis l'ancien téléphone, elle ferait
  // croire au nouveau qu'il est l'auteur de la sauvegarde du dossier — l'alerte
  // « un autre appareil a écrit ici » ne se déclencherait jamais.
  'deviceId',
  // Libellé d'affichage du dossier (lot du 09/08/2026) : LOCAL à cet appareil, comme
  // les deux réglages juste au-dessus. S'il partait dans la sauvegarde, la restauration
  // sur un nouveau téléphone (le scénario même que ce réglage sert) afficherait dans les
  // Réglages le chemin de l'ANCIEN appareil (« Documents/Rowtine ») — un dossier qui
  // n'existe pas ici, et pour toujours puisqu'il ne s'écrit qu'à la désignation.
  'safFolderLabel',
]

// Une data URL que `parseDataUrl` REFUSE (il n'accepte que la forme base64) ne peut pas
// être extraite en fichier : son contenu n'est pas du base64. Jusqu'au 12/08/2026 on
// écrivait quand même un fichier, VIDE, nommé `photo-<index>.bin` ; la restauration en
// refaisait `data:application/octet-stream;base64,` — une image cassée, silencieusement.
// Le cas n'était pas théorique : le semis des patrons d'exemple ne rejoue jamais
// (patterns.js), donc toute installation antérieure à ce lot garde en base les anciens
// croquis `data:image/svg+xml;utf8,…` et perdait trois images à chaque sauvegarde.
//
// Ces valeurs sont désormais CONSERVÉES TELLES QUELLES dans le JSON, à la place du nom de
// fichier, et rendues identiques à la restauration (cf. `photoFromEntry`, deserialize.js)
// — la promesse d'aller-retour exact de deserialize.js redevient vraie pour toute data URL.
//
// LE DISCRIMINANT EST LE MÊME DES DEUX CÔTÉS : le préfixe `data:`. Un nom de fichier
// produit ici commence toujours par `photo-`, `patron-photo-` ou `gallery-`, jamais par
// `data:` : les deux classes ne peuvent pas se confondre, dans un sens comme dans l'autre.
// Ce qui n'est pas une data URL (null, chaîne quelconque) garde l'ancien repli `.bin` :
// ce n'est pas une image, l'inliner élargirait le miroir sans rien réparer.
function isInlineDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:') && parseDataUrl(value) === null
}

// Construit les fichiers photo (dédupliqués par nom) pour un tableau de data URLs,
// et renvoie { names, files } où `names` est le tableau (avec doublons éventuels,
// aligné sur l'index d'origine) à mettre dans le JSON, et `files` la liste dédupliquée
// des fichiers à écrire (chemins relatifs à `dir`, pas encore préfixés).
function buildPhotoFiles(photos, dir, { prefix = 'photo-' } = {}) {
  const names = []
  const seen = new Map() // nom -> fichier déjà construit (dédup)
  const files = []
  photos.forEach((dataUrl, index) => {
    // Non analysable : la valeur elle-même prend la place du nom dans le JSON, et aucun
    // fichier n'est écrit. `names` reste aligné index pour index sur `photos`.
    if (isInlineDataUrl(dataUrl)) {
      names.push(dataUrl)
      return
    }
    // photoFileName renvoie toujours "photo-<suffixe>" (hash ou index de repli) :
    // on substitue juste le préfixe pour distinguer les photos de patron embarqué.
    const baseName = photoFileName(dataUrl, index)
    const name = prefix + baseName.slice('photo-'.length)
    names.push(name)
    if (seen.has(name)) return
    const parsed = parseDataUrl(dataUrl)
    const data = parsed ? parsed.base64 : ''
    const file = { path: `${dir}/${name}`, data, encoding: 'base64' }
    seen.set(name, file)
    files.push(file)
  })
  return { names, files }
}

// Galerie : chaque item { src, page, w, h } → nom de fichier (préfixe gallery-) +
// fichier base64 dédupliqué ; les métadonnées (page/w/h) restent dans le JSON.
function buildGalleryFiles(gallery, dir) {
  const items = []
  const seen = new Map()
  const files = []
  ;(gallery || []).forEach((g, index) => {
    // Même défaut, même correction que `buildPhotoFiles` : une image de galerie non
    // analysable reste dans le JSON (`src` au lieu de `name`), sans fichier vide.
    if (isInlineDataUrl(g.src)) {
      items.push({ src: g.src, page: g.page || 0, w: g.w || 0, h: g.h || 0 })
      return
    }
    const baseName = photoFileName(g.src, index)
    const name = 'gallery-' + baseName.slice('photo-'.length)
    items.push({ name, page: g.page || 0, w: g.w || 0, h: g.h || 0 })
    if (seen.has(name)) return
    const parsed = parseDataUrl(g.src)
    const file = { path: `${dir}/${name}`, data: parsed ? parsed.base64 : '', encoding: 'base64' }
    seen.set(name, file)
    files.push(file)
  })
  return { items, files }
}

// Ne garde que les fichiers dont le chemin n'est pas déjà présent dans `existing` —
// les noms de fichiers d'assets sont dérivés du hash de leur contenu (naming.js), donc
// un même chemin garantit un même contenu : la dédup par chemin est sûre.
function dedupByPath(newFiles, existing) {
  const have = new Set(existing.map((f) => f.path))
  return newFiles.filter((f) => !have.has(f.path))
}

// Sérialise un projet : dossier Projets/<slug> [id], projet.json (photos → noms,
// sections/counters/sessions/diagrams embarqués) + un fichier base64 par photo.
// Si `instancePattern` est fourni (patron forké/copié pour ce projet), ajoute
// patron.json + ses photos dans le même dossier, préfixées "patron-photo-" pour ne
// pas collisionner avec les photos du projet.
export function serializeProject(
  project,
  { sections, counters, sessions, diagrams, instancePattern } = {},
) {
  const dir = `Projets/${entryFolderName(project.name, project.id)}`
  const { names: photoNames, files: photoFiles } = buildPhotoFiles(project.photos || [], dir)

  const projectJson = {
    ...project,
    photos: photoNames,
    sections: sections || [],
    counters: counters || [],
    sessions: sessions || [],
    diagrams: diagrams || [],
  }

  // 🔑 `projet.json` N'EST PAS ici : il est poussé EN DERNIER, tout en bas de cette
  // fonction — même règle que `patron.json` (cf. la note détaillée plus bas) et que
  // `laines.json` (cf. serializeYarns). Il PUBLIE les noms des fichiers photo qu'il
  // référence ; écrit AVANT eux, une écriture interrompue entre les deux laisse sur
  // disque un `projet.json` qui pointe vers des photos absentes. À la restauration,
  // `fileToDataUrl` (deserialize.js) fabrique alors une data URL VALIDE EN APPARENCE
  // (`data:image/jpeg;base64,` sur un base64 vide) au lieu de signaler le manque, et la
  // sauvegarde suivante recalcule un nom de fichier depuis ce contenu vide : la vraie
  // photo, devenue « non référencée », est effacée par la réconciliation.
  const files = [...photoFiles]

  let allPhotoNames = [...photoNames]

  if (instancePattern) {
    const { names: patternPhotoNames, files: patternPhotoFiles } = buildPhotoFiles(
      instancePattern.photos || [],
      dir,
      {
        prefix: 'patron-photo-',
      },
    )
    const { pdf, gallery, ...patternRest } = instancePattern
    const patternJson = { ...patternRest, photos: patternPhotoNames }
    // Symétrie avec isInlineDataUrl (photos/galerie, cf. commentaire en tête de fichier) :
    // un pdf non-base64-analysable disparaissait silencieusement (ni JSON ni fichier écrit).
    // Conservé tel quel dans le JSON, comme une data URL de photo non analysable.
    if (isInlineDataUrl(pdf)) patternJson.pdf = pdf
    let patternGalleryFiles = []
    if (gallery !== undefined) {
      const built = buildGalleryFiles(gallery, dir)
      patternJson.gallery = built.items
      patternGalleryFiles = built.files
    }
    // Patron.md (Lot N1) : émis uniquement si le patron forké a un lecteur interactif.
    // Le hash témoin est calculé AVANT le stringify du JSON pour que patron.json écrit
    // sur disque contienne bien patronMd (pas seulement l'objet en mémoire).
    let patronMdFiles = []
    if (instancePattern.reader) {
      const { mdFile, assetFiles, hash } = buildPatternMdFiles(instancePattern, dir)
      patternJson.patronMd = { hash }
      patronMdFiles = [mdFile, ...dedupByPath(assetFiles, [...files, ...patternPhotoFiles, ...patternGalleryFiles])]
    }
    files.push(...patternPhotoFiles)
    files.push(...patternGalleryFiles)
    files.push(...patronMdFiles)
    // 🔑 patron.json APRÈS patron.md, jamais avant — même règle que `laines.json`
    // après ses `laine-photo-*` (cf. serializeYarns) : patron.json PUBLIE le témoin
    // `patronMd.hash`, et `hasPendingExternalMdEdit` (orchestrator.js) conclut à une
    // édition externe dès que le patron.md du disque ne correspond plus à ce témoin.
    // Publié AVANT le patron.md qu'il décrit, une écriture interrompue entre les deux
    // laisse le nouveau témoin face à l'ANCIEN md : chaque sauvegarde suivante saute
    // alors l'entrée EN ENTIER (skip total), et la prochaine synchro MD fusionne ce md
    // périmé dans la base — le travail plus récent est reverti, en silence.
    files.push({
      path: `${dir}/patron.json`,
      data: JSON.stringify(patternJson, null, 2),
      encoding: 'utf8',
    })
    // Le pdf du patron forké suit la même règle que serializePattern : extrait en
    // fichier base64 (ici dans le dossier du PROJET, puisque l'instance y vit).
    const parsedPdf = parseDataUrl(pdf)
    if (parsedPdf) {
      files.push({ path: `${dir}/original.pdf`, data: parsedPdf.base64, encoding: 'base64' })
    }
    allPhotoNames = [...allPhotoNames, ...patternPhotoNames]
  }

  // 🔑 `projet.json` EN DERNIER, après TOUS les fichiers qu'il référence (photos du
  // projet, et le dossier de l'instance de patron qui vit ici aussi) — cf. la note en
  // tête de cette fonction.
  files.push({
    path: `${dir}/projet.json`,
    data: JSON.stringify(projectJson, null, 2),
    encoding: 'utf8',
  })

  return { dir, files, photoNames: allPhotoNames }
}

// Sérialise un patron de bibliothèque : dossier Patrons/<slug> [id], patron.json
// (photos → noms, pdf retiré du JSON) + photos + original.pdf si `pattern.pdf` est
// une data URL.
export function serializePattern(pattern) {
  const dir = `Patrons/${entryFolderName(pattern.name, pattern.id)}`
  const { names: photoNames, files: photoFiles } = buildPhotoFiles(pattern.photos || [], dir)

  const { pdf, gallery, ...rest } = pattern
  const patternJson = { ...rest, photos: photoNames }
  // Même garde que serializeProject ci-dessus : un pdf non-base64 survit dans le JSON
  // plutôt que de disparaître (cf. commentaire isInlineDataUrl en tête de fichier).
  if (isInlineDataUrl(pdf)) patternJson.pdf = pdf
  let galleryFiles = []
  if (gallery !== undefined) {
    const built = buildGalleryFiles(gallery, dir)
    patternJson.gallery = built.items
    galleryFiles = built.files
  }

  // Patron.md (Lot N1) : émis uniquement si le patron a un lecteur interactif. Le hash
  // témoin est calculé AVANT le stringify du JSON pour que patron.json écrit sur disque
  // contienne bien patronMd (pas seulement l'objet en mémoire).
  let patronMdFiles = []
  if (pattern.reader) {
    const { mdFile, assetFiles, hash } = buildPatternMdFiles(pattern, dir)
    patternJson.patronMd = { hash }
    patronMdFiles = [mdFile, ...dedupByPath(assetFiles, [...photoFiles, ...galleryFiles])]
  }

  // 🔑 patron.json EN DERNIER, après le patron.md qu'il décrit — cf. la note détaillée
  // dans `serializeProject` : il publie le témoin `patronMd.hash`, et l'écrire avant son
  // md expose une fenêtre où une interruption fige l'entrée (skip total à chaque
  // sauvegarde) puis fait reverter la base sur un md périmé à la synchro suivante.
  const files = [
    ...photoFiles,
    ...galleryFiles,
    ...patronMdFiles,
    { path: `${dir}/patron.json`, data: JSON.stringify(patternJson, null, 2), encoding: 'utf8' },
  ]

  const parsedPdf = parseDataUrl(pdf)
  if (parsedPdf) {
    files.push({ path: `${dir}/original.pdf`, data: parsedPdf.base64, encoding: 'base64' })
  }

  return { dir, files, photoNames }
}

// Laines : chaque photo (data URL) est externalisée en fichier séparé à la racine de la
// sauvegarde (préfixe laine-photo-), comme pour les patrons/projets — laines.json ne garde
// que le nom de fichier. Décision du 15/08/2026 (spec compression images importées) :
// laines.json à 5,75 Mo était la cause structurelle du plantage mémoire du 13/08 (il faut
// tout charger en mémoire d'un bloc pour lire une seule photo). Pas de `buildPhotoFiles`
// (conçue pour un TABLEAU de photos d'une même entité) : ici c'est un tableau d'ENTITÉS
// portant chacune UNE photo — mécanisme dédié, même nommage/dédup (photoFileName).
//
// `files` renvoie les photos AVANT laines.json (l'orchestrateur écrit dans cet ordre,
// séquentiellement — cf. orchestrator.js) : une écriture interrompue en cours de route ne
// doit jamais laisser sur disque un laines.json qui pointe vers des laine-photo-* absents.
// laines.json en dernier garantit qu'il n'est publié qu'une fois tous les fichiers qu'il
// référence déjà écrits.
// Depuis le 21/08/2026 les fichiers partent sous `Laines/` (demande d'usage du 16/08,
// arbitrée le 21 : « leur propre dossier par défaut »). Ils étaient jusque-là posés en vrac
// à la racine — 31 photos pour 39 entrées sur les deux appareils, quatre entrées sur cinq.
// 🔑 `laines.json` ne change PAS de format : le champ `photo` garde le NOM NU, jamais le
// chemin. C'est ce qui laisse `deserializeYarns` lire les DEUX dispositions sans une
// seconde forme de donnée à faire vivre (cf. restore.js, qui fusionne les deux endroits).
export const YARN_PHOTOS_DIR = 'Laines'

export function serializeYarns(yarns) {
  const seen = new Map() // nom -> fichier déjà construit (dédup par contenu)
  const files = []
  const photoNames = [] // noms référencés, dans l'ordre : sert au ménage des orphelines
  const yarnsJson = (yarns || []).map((yarn, index) => {
    // Pas de photo, ou data URL non analysable (cf. isInlineDataUrl) : champ inchangé,
    // aucun fichier écrit — même garde que buildPhotoFiles pour patrons/projets.
    if (!yarn.photo || isInlineDataUrl(yarn.photo)) return yarn
    const baseName = photoFileName(yarn.photo, index)
    const name = 'laine-photo-' + baseName.slice('photo-'.length)
    if (!seen.has(name)) {
      const parsed = parseDataUrl(yarn.photo)
      const file = {
        path: `${YARN_PHOTOS_DIR}/${name}`,
        data: parsed ? parsed.base64 : '',
        encoding: 'base64',
      }
      seen.set(name, file)
      files.push(file)
      photoNames.push(name)
    }
    return { ...yarn, photo: name }
  })
  return {
    files: [
      ...files,
      { path: 'laines.json', data: JSON.stringify(yarnsJson, null, 2), encoding: 'utf8' },
    ],
    photoNames,
  }
}

// Achats : registre plat, aucun fichier annexe. C'est le SEUL endroit où l'historique
// complet est sauvegardé (l'export CSV du stock, lui, agrège par fiche).
export function serializePurchases(purchases) {
  return { path: 'achats.json', data: JSON.stringify(purchases, null, 2), encoding: 'utf8' }
}

// Journal des jours actifs : registre plat d'une ligne par jour, aucun
// fichier annexe. Table GLOBALE (pas rattachée à un projet) ⇒ son propre fichier à la racine,
// exactement comme `achats.json` de la v2. C'est le SEUL endroit où l'historique des jours de
// progression est sauvegardé : `lastWorkedAt` sur le projet ne dit que le DERNIER.
export function serializeActiveDays(activeDays) {
  return { path: 'jours-actifs.json', data: JSON.stringify(activeDays, null, 2), encoding: 'utf8' }
}

// Compteurs indépendants (projectId === 0), à la racine.
export function serializeIndependentCounters(counters) {
  return { path: 'compteurs.json', data: JSON.stringify(counters, null, 2), encoding: 'utf8' }
}

// Index de corbeille : ids projet/patron supprimés (soft-delete) au moment de la
// sauvegarde. Leur dossier reste sur disque (réconciliation calée sur `keepIds`,
// cf. orchestrator.js) mais ne doit PAS être restauré comme actif par S3 — c'est ce
// fichier qui le lui permet de le reconnaître (cf. `readBackup`, restore.js).
export function serializeTrashIndex(trashIds) {
  return { path: 'corbeille.json', data: JSON.stringify(trashIds, null, 2), encoding: 'utf8' }
}

// Réglages : objet clé → valeur, en excluant secrets & état volatil (non sauvegardés).
export function serializeSettings(settingsObj) {
  const filtered = {}
  for (const [key, value] of Object.entries(settingsObj || {})) {
    if (EXCLUDED_SETTINGS_KEYS.includes(key)) continue
    filtered[key] = value
  }
  return { path: 'reglages.json', data: JSON.stringify(filtered, null, 2), encoding: 'utf8' }
}

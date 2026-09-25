// Table d'alias par champ CIBLE rowtine → en-têtes Ravelry acceptés, comparés après
// normalisation (jamais par position de colonne : un fichier réordonné reste importable).
// Volontairement absents : ID Ravelry, Has photo, Photo, Total/Remaining yards·meters·grams,
// Échantillon(s) fabricant, hors mapping, cf. spec section « Mapping des colonnes ».
export const FIELD_ALIASES = {
  status: ['status'],
  brand: ['brand'],
  model: ['yarn'],
  colorway: ['colorway'],
  colorFamily: ['color family'],
  colorAttributes: ['color attributes'],
  weight: ['weight'],
  gramsPerSkein: ['grams/skein'],
  yardsPerSkein: ['yards/skein'],
  metersPerSkein: ['meters/skein'],
  skeins: ['skeins'],
  remainingSkeins: ['remaining skeins'],
  dyeLot: ['dye lot'],
  storedIn: ['stored in'],
  purchaseDate: ['purchase date'],
  pricePaid: ['price paid'],
  purchasedAt: ['purchased at'],
  comments: ['comments'],
  tagList: ['tag list'],
}

// Minuscules, accents retirés, tirets/soulignés réduits à un espace, espaces superflus
// compressés, trim, même stratégie de normalisation que `constants/swatch.js#normalize`.
export function normalizeHeader(header) {
  return String(header || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// en-tête normalisé → champ cible, construite une seule fois au chargement du module.
const FIELD_BY_HEADER = (() => {
  const out = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) out[normalizeHeader(alias)] = field
  }
  return out
})()

// Résout un en-tête de fichier vers son champ cible rowtine, ou '' si inconnu, un en-tête
// inconnu n'est PAS une erreur, la colonne est simplement ignorée (cf. parse.js).
export function fieldForHeader(header) {
  return FIELD_BY_HEADER[normalizeHeader(header)] || ''
}

// Colonnes de l'export stash Ravelry volontairement NON importées (totaux dérivés, présence
// de photo) : ni mappées ni signalées comme « non reconnues », elles figurent dans chaque
// export réel et ne feraient que du bruit dans le résumé.
const IGNORED_HEADERS = new Set(
  ['total yards', 'total meters', 'total grams', 'remaining yards', 'remaining meters', 'remaining grams', 'has photo'],
)

export function isIgnoredHeader(header) {
  return IGNORED_HEADERS.has(normalizeHeader(header))
}

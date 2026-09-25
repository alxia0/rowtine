// minuscule, accents retirés, trim, même stratégie que field-aliases.js#normalizeHeader.
function normalizeKeyPart(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
}

// Clé de correspondance « même laine » entre deux imports (ou entre un import et le stock
// existant) : marque + modèle + coloris, normalisés (cf. spec, décision « Dédoublonnage »).
export function yarnKey(yarn) {
  return [normalizeKeyPart(yarn?.brand), normalizeKeyPart(yarn?.model), normalizeKeyPart(yarn?.colorName)].join('|')
}

export function isInStash(status) {
  return normalizeKeyPart(status) === 'in stash'
}

// Classe les lignes déjà mappées ({ status, yarn, purchase }) en 3 groupes. Comportement
// « ignorer si déjà présent » : append-only, jamais de fusion, une ligne qui correspond à
// une fiche existante OU à une autre ligne déjà classée `created` dans CE MÊME fichier
// rejoint `alreadyPresent`, jamais une seconde fiche.
export function classifyRows(mappedRows, existingYarns) {
  const existingKeys = new Set((existingYarns || []).map(yarnKey))
  const created = []
  const alreadyPresent = []
  const excludedStatus = []
  const seenInFile = new Set()
  for (const row of mappedRows || []) {
    if (!isInStash(row.status)) {
      excludedStatus.push(row)
      continue
    }
    const key = yarnKey(row.yarn)
    // Nom de couleur de repli (Closest color, Colorway vide) : une fiche importée avant ce
    // repli porte un nom VIDE pour la même laine, on la reconnaît aussi sous cette clé-là.
    const legacyKey = row.colorNameFromFamily ? yarnKey({ ...row.yarn, colorName: '' }) : null
    if (existingKeys.has(key) || (legacyKey && existingKeys.has(legacyKey)) || seenInFile.has(key)) {
      alreadyPresent.push(row)
      continue
    }
    seenInFile.add(key)
    created.push(row)
  }
  return { created, alreadyPresent, excludedStatus }
}

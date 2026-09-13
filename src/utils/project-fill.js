// Préremplissage des champs du projet à partir du patron sélectionné (Lot U2).
// Helper pur (pas de Vue) : renvoie un patch PARTIEL, testable indépendamment du composant.

const FIELDS = [
  { patternKey: 'name', formKey: 'name' },
  { patternKey: 'gaugeStitches', formKey: 'gaugeStitches' },
  { patternKey: 'gaugeRows', formKey: 'gaugeRows' },
]

// Un champ « form » est considéré vide s'il est falsy ou (pour un tableau) sans éléments.
function isEmpty(v) {
  if (Array.isArray(v)) return v.length === 0
  return !v
}

// La liste d'aiguilles du form est « vide » si aucune entrée n'a de mm ni d'US
// (une entrée { mm:'', us:'' } par défaut compte comme vide).
function needlesEmpty(needles) {
  return !Array.isArray(needles) || needles.every((n) => !n?.mm && !n?.us)
}

// `technique` est le seul champ dont la valeur par défaut de emptyProject() n'est PAS
// falsy (`'knitting'`) : sans ce cas particulier, il ne serait jamais préremplable sur un
// formulaire fraîchement créé. On traite donc 'knitting' comme « pas encore choisi ».
function isEmptyTechnique(v) {
  return isEmpty(v) || v === 'knitting'
}

/**
 * Calcule les champs à préremplir dans `form` depuis `pattern`.
 * Ne renvoie que les clés (a) non vides sur le patron ET (b) vides sur le form.
 * @param {object|null|undefined} pattern
 * @param {object} form
 * @returns {object} patch partiel
 */
export function fillProjectFromPattern(pattern, form) {
  if (!pattern) return {}
  const patch = {}

  // technique : depuis pattern.type
  if (!isEmpty(pattern.type) && isEmptyTechnique(form.technique)) {
    patch.technique = pattern.type
  }

  // sizes : depuis pattern.sizes (tableau)
  if (!isEmpty(pattern.sizes) && isEmpty(form.sizes)) {
    patch.sizes = [...pattern.sizes]
  }

  // aiguilles : le patron garde des scalaires (needleMm/needleUs) → on en fait une
  // liste à une entrée si le patron en a une ET que le form n'a pas encore d'aiguille.
  if ((!isEmpty(pattern.needleMm) || !isEmpty(pattern.needleUs)) && needlesEmpty(form.needles)) {
    patch.needles = [{ mm: pattern.needleMm || '', us: pattern.needleUs || '' }]
  }

  // champs scalaires simples (name, gaugeStitches, gaugeRows)
  for (const { patternKey, formKey } of FIELDS) {
    if (!isEmpty(pattern[patternKey]) && isEmpty(form[formKey])) {
      patch[formKey] = pattern[patternKey]
    }
  }

  return patch
}

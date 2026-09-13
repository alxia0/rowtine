// Le lien entre le premier signe d'activité sur un projet et sa date de début.
// PUR : aucune dépendance, le jour courant entre par paramètre.
//
// Symétrique de `project-finished-at.js`, mais à sens unique : `finishedAt` se redate à
// CHAQUE clôture (on peut terminer un ouvrage plusieurs fois), `startedAt` ne se pose
// qu'une SEULE fois — la première. Une valeur déjà présente (saisie à la main dans la
// fiche, ou héritée d'un projet plus ancien) l'emporte toujours et n'est jamais écrasée.
//
// Rend `null` (rien à faire) ou `{ startedAt }` à fusionner dans le patch.
export function startedAtPatch(before, today) {
  if (before?.startedAt) return null
  return { startedAt: today }
}

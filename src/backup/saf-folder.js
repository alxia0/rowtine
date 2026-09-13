// API de désignation du dossier SAF. La désignation ET la persistance de l'URI
// sont côté natif (SharedPreferences) : le JS reste sans état, l'interface est
// booléenne/nom/faits bruts — la politique (base) vit dans folder-base.js.
import { RowtineSaf } from './saf-plugin'
import { PROBES } from './folder-base'

// Phase 1 : ouvre le sélecteur, prend la permission côté natif et SONDE
// l'arbre accordé avec PROBES — le plugin rend des faits bruts, la décision
// (base) appartient à folder-base.js. SANS persister : la persistance/creation
// attend confirmFolder (après confirmation de l'utilisatrice).
export async function chooseFolder() {
  const r = await RowtineSaf.chooseFolder({ probes: PROBES })
  return {
    granted: !!r.granted,
    name: r.name ?? null,
    probeHits: r.probeHits ?? [],
  }
}

// Phase 2 — validation : `base` est décidée côté JS (decideBase) ; « Rowtine »
// → find-or-create du sous-dossier, `''` → rien à créer. Persiste dans tous
// les cas.
export async function confirmFolder(base) {
  const { granted } = await RowtineSaf.confirmFolder({ base })
  return { granted: !!granted }
}

// Phase 2 — annulation : relâche la permission prise en phase 1, rien persisté.
export async function discardFolder() {
  await RowtineSaf.discardFolder()
}

// Vrai si un dossier est désigné ET la permission persistée est toujours valide.
export async function hasFolder() {
  const { granted } = await RowtineSaf.hasFolder()
  return !!granted
}

// Nom lisible du dossier désigné, ou null si aucun/invalide.
export async function folderName() {
  const { granted, name } = await RowtineSaf.hasFolder()
  return granted ? (name ?? null) : null
}

// Identifiant DISCRIMINANT du dossier désigné : l'URI de l'arbre SAF, telle que
// persistée côté natif. `folderName()` ne convient pas pour identifier un dossier —
// elle renvoie le nom de la racine effective, qui depuis l'adoption (folder-base.js)
// peut porter le nom du dossier choisi et non plus la constante « Rowtine » :
// deux dossiers choisis différents peuvent avoir le même nom. L'URI reste le seul
// identifiant discriminant. Utilisée par `backup-decision.js`, où une comparaison
// qui ne discrimine pas laisserait une décision prise sur un dossier acquitter
// le suivant.
export async function folderKey() {
  const { granted, uri } = await RowtineSaf.hasFolder()
  return granted && uri ? uri : null
}

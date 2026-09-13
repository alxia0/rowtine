// Politique de l'emplacement effectif des données, déménagée du natif
// (`computeBase`, RowtineSafPlugin.java) pour devenir testable ici : le plugin
// ne rend plus que des faits bruts (`name`, existence d'un enfant « Rowtine »,
// `probeHits` — sondes passées avec `chooseFolder`, cf. saf-folder.js), et
// `decideBase` tranche. La constante PROBES vit donc ICI : le natif ne connaît
// aucune liste en dur.
//
// Règle à 4 branches, DANS L'ORDRE (06/09/2026) :
// 1. dossier choisi nommé « Rowtine » (casse ignorée) → pris tel quel ;
// 2. un enfant « Rowtine » existe → on travaille dedans (comportement
//    historique, préserve les installations existantes) ;
// 3. marqueurs complets — `reglages.json` en FICHIER et (`Projets` ou
//    `Patrons`) en DOSSIER — → ADOPTION : le dossier choisi EST un dossier de
//    données Rowtine (cas observé : copie renommée « Rowtine2 » ignorée avant
//    cette règle) ;
// 4. sinon → sous-dossier « Rowtine », créé au confirm (inchangé).
//
// DISTINCT de `hasBackup` (restore.js:44) tout en le couvrant : l'adoption ⇒
// hasBackup vrai (`reglages.json` + Projets/Patrons suffisent largement à
// hasBackup, qui se contente d'UN marqueur) ⇒ l'offre de restauration à la
// désignation suit toujours l'adoption. Mais les deux prédicats ne se
// confondent pas : hasBackup dit « il y a une sauvegarde » (un marqueur suffit
// — logique d'avertissement) ; l'adoption dit « ce dossier EST un dossier
// Rowtine » (logique de revendication, plus stricte : nature attendue de
// chaque marqueur exigée, `laines.json` n'y compte pas).
//
// Risque résiduel accepté (06/09/2026) : un dossier étranger contenant À
// LA FOIS un fichier `reglages.json` et un dossier `Projets/` (ou `Patrons/`)
// serait adopté à tort. Fenêtre jugée négligeable (coordonner ces deux noms
// exacts hors Rowtine), conséquence bénigne : l'app y écrit sa structure, et
// l'offre de restauration le révèle aussitôt.

// Sondes factuelles envoyées au natif avec `chooseFolder` : chaque nom est
// recherché sur l'arbre accordé, le résultat brut revient en `probeHits`.
// « Rowtine » est une sonde STRUCTURELLE (l'enfant établi, branche 2 — à
// dériver en `rowtineChildExists` par l'appelant, cf. designate-folder.js) ;
// les trois autres sont les MARQUEURS DE DONNÉES de la branche 3, les seuls
// que lit `decideBase` pour l'adoption.
export const PROBES = ['Rowtine', 'Projets', 'Patrons', 'reglages.json']

// Les deux bases possibles : `''` (le dossier choisi EST la base) ou ce
// sous-dossier — constante privée, l'API du module est PROBES/decideBase/composeLabel.
const ROWTINE = 'Rowtine'

// Pur : faits bruts → base, l'une des deux valeurs ci-dessus. `probeHits` ne
// contient que les sondes qui ont répondu (Array<{name, isDir}>, cf. PROBES).
export function decideBase({ name, rowtineChildExists, probeHits }) {
  if (name && name.toLowerCase() === 'rowtine') return ''
  if (rowtineChildExists) return ROWTINE
  const hit = {}
  for (const h of probeHits) hit[h.name] = h
  // Preuve complète : un fichier de réglages ET au moins un dossier de
  // données, chacun en la nature attendue — un marqueur seul ou de traverse
  // ne revendique rien.
  const dossierDonnees = (hit['Projets']?.isDir || hit['Patrons']?.isDir) && hit['reglages.json'] && !hit['reglages.json'].isDir
  if (dossierDonnees) return ''
  return ROWTINE
}

// Libellé montré à l'utilisatrice : le dossier choisi seul s'il EST la base,
// sinon le chemin effectif <choisi>/Rowtine.
export function composeLabel(name, base) {
  return base === '' ? name : `${name}/${ROWTINE}`
}

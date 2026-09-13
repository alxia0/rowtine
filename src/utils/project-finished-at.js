// Le lien bidirectionnel entre le statut « Terminé » et la date de fin.
// PUR : aucune dépendance, le jour courant entre par paramètre.
//
// ⛔ DEUX FONCTIONS, ET ELLES NE VIVENT PAS AU MÊME ENDROIT.
// `finishedAtPatch` (règle 1) est appelée par projectsStore.update() : écrire une date n'a aucun
// effet de bord, et un seul point couvre les TROIS sites de changement de statut.
// `shouldDeriveDone` (règle 2) est appelée UNIQUEMENT par ProjectEditView.save(). La mettre dans
// update() ferait passer un projet à 'done' par effet de bord d'une écriture en base : le
// dialogue « combien de pelotes as-tu utilisées ? » ne s'ouvrirait jamais et le stock resterait
// faux en silence (cf. useProjectConsumption.js, qui centralise les trois points d'entrée).
//
// Règle de préséance commune : UNE VALEUR EXPLICITEMENT SAISIE L'EMPORTE TOUJOURS SUR UNE
// VALEUR DÉDUITE. Les deux fonctions raisonnent sur des TRANSITIONS et non sur des valeurs,
// parce que le formulaire d'édition renvoie TOUJOURS les deux champs, même inchangés.

function jour(v) {
  return String(v || '').slice(0, 10)
}

// RÈGLE 1 — entrer dans 'done' écrit le jour courant, y compris PAR-DESSUS une date existante :
// `finishedAt` est la date de la DERNIÈRE clôture. Un projet terminé, rouvert, re-terminé garderait
// sinon la date de sa première clôture, et la tuile « projets terminés » le rangerait dans la
// mauvaise fenêtre sans qu'aucun reliquat n'alerte.
// Rend `null` (rien à faire) ou `{ finishedAt }` à fusionner dans le patch.
export function finishedAtPatch(before, patch, today) {
  if (!patch || patch.status !== 'done') return null
  if (before?.status === 'done') return null // pas une ENTRÉE dans 'done'
  // Préséance : une date explicitement modifiée dans le même enregistrement gagne.
  if ('finishedAt' in patch && jour(patch.finishedAt) !== jour(before?.finishedAt)) return null
  return { finishedAt: today }
}

// RÈGLE 2 — renseigner une date de fin termine le projet. Vaut depuis N'IMPORTE quel statut
// autre que 'done' (En cours, En pause, En attente, À venir), portée assumée côté produit.
// Ne vaut QUE dans le sens « renseigner » : effacer une date ne dé-termine jamais un projet.
export function shouldDeriveDone(before, patch) {
  const now = jour(patch?.finishedAt)
  if (!now || now === jour(before?.finishedAt)) return false
  // Préséance, même règle que pour la date : un statut explicitement CHANGÉ dans cet
  // enregistrement l'emporte sur toute déduction. Sans cette garde, rouvrir un projet
  // terminé en corrigeant sa date le refermerait aussitôt, et la pastille « En cours »
  // que l'utilisatrice vient de choisir serait sans effet. Conditionnée à `before` : à la
  // création (before === null), il n'y a pas de statut antérieur à comparer — et c'est
  // justement le cas que couvre « un projet neuf créé avec une date est terminé ».
  if (before && patch?.status && patch.status !== before.status) return false
  return (patch?.status ?? before?.status) !== 'done'
}

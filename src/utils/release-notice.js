// Décision pure du pop-up « Nouveautés » après une mise à jour (aucun store, aucun I/O).
//
// Seule l'entrée du journal dont `version` égale la version COURANTE compte : si Alexia a
// sauté plusieurs versions, on ne lui déroule pas l'historique, on lui montre ce qui est
// vrai de l'app qu'elle a sous les yeux. Une entrée absente ou sans note n'affiche jamais
// de pop-up (jamais de liste vide) : on enregistre simplement la version.
//
// Retour : `advance` vrai = enregistrer `currentVersion` tout de suite, sans pop-up ;
// `show` vrai et `advance` faux = l'enregistrer à la fermeture du pop-up ;
// les deux faux = déjà à jour, rien à faire.
export function decideReleaseNotice({ onboarded, lastSeenVersion, currentVersion, entries }) {
  if (lastSeenVersion === currentVersion) return { show: false, advance: false, entry: null }
  // Installation neuve : rien de nouveau à annoncer, on note la version.
  if (!onboarded && lastSeenVersion == null) return { show: false, advance: true, entry: null }
  const entry = (entries || []).find((e) => e.version === currentVersion)
  if (!entry || !Array.isArray(entry.notes) || entry.notes.length === 0) {
    return { show: false, advance: true, entry: null }
  }
  return { show: true, advance: false, entry }
}

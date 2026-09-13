// Le bouton retour du téléphone face au garde-fou de version (round de correction
// finale, 13/08/2026).
//
// Extrait dans son propre module pour la même raison que `folder-gate-back.js` :
// App.vue possède DEUX chaînes de retour distinctes — `onBack` (balayage de bord +
// repli web) et le handler natif `backButton` — qui ne s'appellent pas l'une l'autre.
// Une condition recopiée aux deux endroits diverge.
//
// `versionGuardState` PRIME sur la porte du dossier et sur tout le reste de la chaîne
// de retour (cf. src/db/version-guard.js, commentaire sur `versionGuardState`) : ce
// dialogue ne se ferme volontairement pas sur le voile, il n'a qu'une seule sortie, le
// bouton « Compris ». Le geste retour doit donc être AVALÉ SANS RIEN FAIRE tant qu'il
// est affiché — ni navigation, ni sortie de l'app, ni fermeture du message. Le laisser
// passer navigue en arrière ou quitte l'app, et le message réapparaît sur l'écran
// suivant : c'est exactement le défaut que ce module ferme.
//
// Renvoie `true` si le geste a été consommé — l'appelant ne doit alors rien faire
// d'autre (pas même appeler `App.exitApp()` : contrairement à `folderGateHandlesBack`,
// il n'y a ici RIEN à faire, le silence est la réponse).
export function versionGuardHandlesBack(state) {
  return !!state?.triggered
}

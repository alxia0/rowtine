// Le bouton retour du téléphone face à LA PORTE du dossier (lot du 09/08/2026).
//
// Extrait dans son propre module parce que App.vue possède DEUX chaînes de retour
// distinctes — `onBack` (balayage de bord + repli web) et le handler natif `backButton`
// — qui ne s'appellent pas l'une l'autre. Une condition recopiée aux deux endroits
// diverge : c'est exactement ce que documente `interceptBackupPrompt`, écrite pour la
// même raison.
//
// La porte n'a AUCUN bouton de fermeture : le geste retour est sa seule sortie, et cette
// sortie est de quitter l'app. Il passe donc AVANT toute autre interception.
//
// (décision produit du 05/09/2026) : la porte a un SECOND mode — « change »,
// ouvert DEPUIS LES RÉGLAGES (`openForChange`). Là, quitter l'app est inacceptable :
// l'utilisatrice gère ses données depuis une app qui fonctionne, la fermer sous son
// geste serait une punition. En mode change, le retour REFERME la porte
// (`gate.closeFromBack()`, qui refuse de fermer pendant qu'une opération de dossier
// tient l'écran) et le geste reste CONSOMMÉ — jamais `exitApp`, jamais de navigation
// derrière la porte. Le mode est lu sur l'instance de la porte (`gate.mode`, exposé par
// son `defineExpose`) au moment du geste ; `undefined` (substitut de test, instance
// ancienne) vaut le mode d'origine « onboarding », donc la sortie de l'app — jamais
// plus permissif que l'ancien comportement.
//
// CONTRAT (après correction A3) :
//   - porte absente ou invisible → `false`, le geste passe à la suite de la chaîne ;
//   - visible + mode 'change'    → `gate.closeFromBack()` (si présent), `true`,
//                                  JAMAIS `exitApp` ;
//   - visible sinon (premier lancement) → `exitApp` au mieux, `true` (geste avalé
//     même sans plugin natif : laisser passer relancerait la navigation derrière
//     la porte).
export function folderGateHandlesBack(gate, capacitorApp) {
  if (!gate?.visible) return false
  if (gate.mode === 'change') {
    gate.closeFromBack?.()
    return true
  }
  // Le plugin peut être absent : sur web/dev il n'existe pas, et sur appareil
  // `onBack` (balayage de bord) peut l'appeler avant que l'import dynamique n'ait
  // résolu. Dans ces cas, on ne peut pas quitter, mais on AVALE quand même le
  // geste. Laisser passer relancerait la navigation derrière la porte.
  capacitorApp?.exitApp?.()
  return true
}

// Valeur de `sectionId` qui signifie « cette session n'est rattachée à AUCUNE section ».
//
// Elle vaut 0 depuis l'origine, mais elle vivait en dur dans ReaderView.vue. Depuis le lot
// « chrono hors lecteur » (17/08/2026), DEUX écrans ouvrent le chrono — l'écran de suivi et
// l'onglet Sections de la fiche projet. C'est le fait qu'ils passent la MÊME valeur qui rend
// leur chrono identique : `openFor` ne rouvre rien quand le couple (projet, section) ne change
// pas, il poursuit. Deux fichiers qui écriraient `0` chacun de leur côté, c'est la garantie
// qu'un jour l'un des deux changera seul et qu'on se retrouvera avec deux chronos concurrents.
export const SESSION_NO_SECTION = 0

// Rowtine — garde anti-écrasement de la sauvegarde (avenant du 04/08/2026, qui a
// remplacé le critère de réveil — lire ce fichier en entier avant d'y toucher,
// l'ancienne conception avait l'air correcte elle aussi).
//
// LE PROBLÈME QU'ELLE FERME. `backupAll` termine par une réconciliation qui
// supprime du dossier tout ce que la base locale ne connaît pas (orchestrator.js,
// `reconcile`) — c'est le mécanisme voulu de propagation des suppressions. Sur une
// base locale vierge, ce même mécanisme efface l'intégralité de la sauvegarde. Le
// 04/08/2026, il a écrasé trois fois le dossier de 34 Mo d'une utilisatrice réelle.
//
// LA RÈGLE ACTUELLE (avenant). Ce n'est PLUS `isDbRestorable()` qui gouverne le
// réveil de la sauvegarde — voir ci-dessous pourquoi ce prédicat calculé a été
// abandonné pour ce rôle. Le critère est désormais une DÉCISION explicite
// (`hasBackupDecision()`, backup-decision.js), posée par l'un des deux gestes qui
// l'enregistrent : « Restaurer » ou « Repartir de zéro ». `isDbRestorable` reste
// utilisée par la RESTAURATION (garde finale de `runRestore`), où elle est
// correcte et à sa place ; elle a simplement cessé de commander la SAUVEGARDE.
//
// POURQUOI L'ANCIEN CRITÈRE (`isDbRestorable`) A ÉTÉ ABANDONNÉ. La revue a montré
// ce que « la garde s'éteint d'elle-même dès qu'elle crée quoi que
// ce soit de réel » recouvrait en pratique : toucher une taille sur le patron
// d'exemple écrit un `readerState` de sept clés (ReaderView, `selectSize`) SANS
// qu'aucun rang n'ait été tricoté ; et `syncPatronMd` écrit la même coquille toute
// seule, à chaque lancement, sans qu'aucune invite ne soit affichée. Dans les deux
// cas, un prédicat calculé ne pouvait pas distinguer « elle a décidé » de « quelque
// chose a écrit » — c'était pourtant exactement la distinction qui comptait : la
// garde s'éteignait et le dossier était écrasé huit secondes plus tard. Détail
// complet dans backup-decision.js.
//
// CE QUE ÇA COÛTE, ET COMMENT C'EST PAYÉ. Le risque est maintenant l'inverse :
// tant qu'elle n'a pas décidé, RIEN N'EST ÉCRIT, même si elle s'est mise à
// tricoter pour de bon — perdre son travail par silence vaudrait alors perdre son
// dossier par écrasement. Ce coût est payé par les trois contreparties de l'avenant
// (pas dans ce fichier) : l'invite de restauration revient à CHAQUE lancement
// tant qu'aucune décision n'est prise pour ce dossier (`shouldOfferRestore`,
// restore-service.js), le bandeau porte les DEUX gestes qui décident, et la ligne
// des Réglages dit ce qui est en jeu (`saf.backupPaused`).
//
// IMPORTS DYNAMIQUES, PAS STATIQUES. `restore-service.js` importe `backup-service.js`
// (getBackupStorage, getBackupPermissionOk), et `backup-service.js` importera ce
// module : un import statique refermerait le cycle dès l'ÉVALUATION des modules. Même
// motif que `callRunBackup` (auto-backup.js) et que la résolution de `isSyncRunning`
// (backup-service.js) — repris, pas inventé.
//
// ORDRE DES TESTS, VOULU (inversé depuis l'avenant). `hasBackup()` est testée EN
// PREMIER, pas `hasBackupDecision()` : un dossier SANS sauvegarde (installation
// neuve, dossier vide) est la SEULE condition qui autorise l'écriture sans décision
// — la tester en premier évite l'aller-retour vers `backup-decision.js` (qui
// consulte Dexie) dans ce cas. Avant l'avenant, l'ordre inverse se justifiait par
// la VITESSE (Dexie local d'abord, SAF plus lent ensuite) ; ce n'est plus l'ordre
// le plus rapide qui prime, mais l'ordre qui reflète la seule dérogation possible.
//
// LA DÉROGATION EST AUTO-REFERMANTE (correctif, re-revue finale du 04/08).
// « dossier vide » n'autorise l'écriture qu'UNE fois : `runBackup` (backup-service.js)
// relit `hasBackup()` avant d'écrire et, si le dossier était bien vide, enregistre
// lui-même la décision juste après le succès de l'écriture — c'est cet appareil qui
// vient de remplir ce dossier, la décision ne fait qu'acter ce qui est déjà vrai.
// Sans cet enregistrement automatique, la dérogation ne jouerait qu'à la toute
// première sauvegarde : dès la mutation suivante, `hasBackup()` deviendrait vrai
// sans qu'aucune décision n'existe, et `isBackupPaused` refuserait pour toujours en
// silence — exactement la « pause définitive » que la re-revue a prouvée en exécutant
// du code. Ce fichier reste néanmoins celui qui décide QUAND autoriser l'écriture ;
// c'est `backup-service.js` qui décide quand ACQUITTER le dossier.
//
// AJOUT DU 06/08/2026 — POURQUOI UNE *RAISON* ET PLUS UN BOOLÉEN.
// Le critère de pause était recalculé à QUATRE endroits : ici, `shouldOfferRestore`
// (restore-service.js), la ligne « en pause » de SafFolderSection, et le `v-if` qui rend
// le bouton de sortie. Ajouter la règle « un autre appareil a écrit ici » au seul premier
// aurait arrêté les écritures SANS afficher ni bandeau, ni ligne rouge, ni bouton pour
// s'en sortir — la troisième occurrence de ce cul-de-sac dans ce fichier. D'où un
// prédicat unique, que les quatre consomment. Sa valeur de retour sert en prime à choisir
// le message affiché : le bandeau n'a plus à re-dériver le cas.
export async function backupPauseReason(storage) {
  // Repli PRUDENT partout : toute erreur (base illisible, permission SAF perdue, E/S)
  // renvoie une raison, jamais `null`. Ne pas sauvegarder est récupérable ; détruire ne
  // l'est pas. `'no-decision'` est le repli historique — c'est celui dont le message et
  // les boutons sont déjà en place.
  if (!storage) return 'no-decision'
  try {
    // Dossier sans sauvegarde (installation neuve, dossier vide) : rien à protéger.
    // Testé EN PREMIER — seule condition qui autorise l'écriture sans décision.
    const { hasBackup } = await import('./restore')
    if (!(await hasBackup(storage))) return null

    const { hasBackupDecision } = await import('./backup-decision')
    if (!(await hasBackupDecision())) return 'no-decision'

    // Nouveau (06/08) : la décision existe, mais un AUTRE appareil a-t-il écrit depuis ?
    // Fiche ABSENTE = sauvegarde d'avant l'ajout de cette fiche → on ne suspend pas (sinon toutes les
    // utilisatrices existantes seraient bloquées dès l'installation). Fiche ILLISIBLE =
    // on ne sait pas → on suspend.
    const { readManifest } = await import('./backup-manifest')
    const { deviceId } = await import('./device-identity')
    const read = await readManifest(storage)
    if (read.state === 'absent') return null
    if (read.state === 'invalid') return 'other-device'
    return read.manifest.appareil === (await deviceId()) ? null : 'other-device'
  } catch {
    return 'no-decision'
  }
}

// Conservée : de nombreux appelants ne veulent qu'un booléen. Mince adaptateur, JAMAIS
// une seconde implémentation du critère.
export async function isBackupPaused(storage) {
  return (await backupPauseReason(storage)) !== null
}

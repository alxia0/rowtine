// Les TROIS décisions pures de « la séance visible dès la pause » :
// combien committer (chunk), dans quelle ligne fusionner (adoption), quand repartir à zéro
// (split — lu sur le `null` de l'adoption, pas de fonction séparée : l'ancien double
// `isSplit` a été retiré). Tirées à part du
// store chrono PRÉCISÉMENT pour être éprouvées sans base ni
// horloge : ici aucun Date.now(), aucun Dexie — le temps entre par paramètre, les lignes
// sortent de la base telles quelles (forme {id, projectId, sectionId, date, durationSec,
// rowsDone, manual?}, plus `lastWriteAt` pour celles qu'écrit le chrono à partir de ce lot).
// Le store activeSession branche ses pause()/play() sur ces seules fonctions :
// une seule définition de la règle des 2 h, pas de copie dans les écrans.

// Fenêtre de fusion : une reprise à moins de 2 h de la dernière écriture chrono du projet
// continue le même épisode. Valeur métier (entrée intend du lot), pas un réglage.
export const SESSION_MERGE_GAP_MS = 2 * 60 * 60 * 1000

// Temps non écrit au journal, en secondes entières : floor(elapsedSec − committedSec).
// Renvoie null sous 1 s — le store n'ouvre alors AUCUNE transaction : une double pause,
// ou une fermeture juste après une pause, ne doit rien écrire du tout (ni ligne vide, ni
// lastWriteAt rafraîchi pour rien). Le floor (jamais round) suit le même principe de
// prudence : on n'inscrit jamais une seconde qui n'a pas entièrement couru ; et NaN ou un
// négatif (état recollé, horloge en arrière) sortent en null car « >= 1 » est faux pour eux.
export function chunkToCommit(elapsedSec, committedSec) {
  const diff = Math.floor(elapsedSec - committedSec)
  return diff >= 1 ? diff : null
}

// Cible de fusion pour une reprise : l'id de `lastLine` si le chrono peut y écrire, sinon
// null. `lastLine` est la dernière ligne NON manuelle du projet (à l'appelant de la
// sélectionner), `now` un epoch ms (Date.now() au store, repère fixe en test).
// Refus (null) dans les trois cas qui suivent, chacun protecteur d'une donnée :
// - ligne absente : projet neuf ou lignes supprimées — rien à fusionner ;
// - `manual` : une saisie main (et les rangs corrigés inline qui vivent dessus)
//   appartient à l'utilisatrice, le chrono ne grossit jamais une ligne qu'il n'a pas
//   écrite ;
// - écart `now − (lastWriteAt || date)` >= 2 h : l'épisode est mort. L'âge se mesure au
//   DERNIER CONTACT (`lastWriteAt`, la mèche redémarre à chaque commit), pas à `date`
//   qui est l'acte de naissance de la ligne ; le repli sur `date` couvre les lignes
//   écrites avant ce lot, qui n'ont pas encore de `lastWriteAt`. Bord 2 h pile = refus :
//   la fenêtre est strictement ouverte. Un âge illisible (champs absents ou foutus)
//   donne NaN, donc faux, donc refus — le côté sûr est le split, jamais grossir une
//   ligne peut-être fossile.
export function adoptMergeTarget(lastLine, now) {
  if (lastLine == null) return null
  if (lastLine.manual) return null
  const lastContact = new Date(lastLine.lastWriteAt || lastLine.date).getTime()
  return now - lastContact < SESSION_MERGE_GAP_MS ? lastLine.id : null
}

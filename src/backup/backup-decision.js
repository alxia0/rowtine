// Rowtine — la décision de sauvegarder sur CE dossier (avenant du 04/08/2026).
//
// POURQUOI UN DRAPEAU PERSISTÉ, alors que la conception d'origine s'en passait.
// Elle faisait dépendre le réveil de la sauvegarde d'un prédicat calculé
// (`isDbRestorable`), c'est-à-dire de l'état de la base. Deux chemins l'ont mise en
// défaut : toucher une taille sur le patron d'exemple écrit un `readerState` de sept
// clés (ReaderView, `selectSize`), et `syncPatronMd` écrit la même coquille toute
// seule, à chaque lancement, sans qu'aucune invite ne soit affichée. Dans les deux
// cas la garde s'éteignait et le dossier était écrasé huit secondes plus tard.
//
// Un prédicat calculé ne sait pas distinguer « elle a décidé » de « quelque chose a
// écrit ». C'est pourtant toute la question. La décision est donc enregistrée, et
// seuls deux gestes explicites l'enregistrent : « Restaurer » et « Repartir de zéro ».
//
// LE DOSSIER N'EST PAS UN ORNEMENT. Sans lui, une décision prise sur un dossier
// vaudrait acquittement pour tous les suivants : elle change de téléphone, désigne
// un nouveau dossier contenant une vraie sauvegarde, et l'ancienne décision
// autoriserait l'écrasement immédiat — le sinistre du 04/08, une couche plus bas.
//
// ⚠️ IDENTIFIANT (correctif du 04/08/2026) : ce champ portait d'abord le NOM du
// dossier (`folderName()`), qui ne discrimine rien — et moins que jamais depuis
// l'adoption (folder-base.js, `decideBase`) : la racine effective peut porter le nom
// du dossier choisi, et deux dossiers distincts peuvent porter le même nom. Sur ce
// nom, la deuxième barrière de l'avenant (« un dossier ne vaut pas pour un autre »)
// était creuse. Remplacé par `folderKey()` (saf-folder.js), qui expose l'URI de
// l'arbre SAF — persistée côté natif, elle discrimine réellement.
//
// ⚠️ `folderKey()` peut renvoyer `null` (permission perdue, lecture en échec). Une
// comparaison `null === null` rendrait vraie une décision sans rapport. D'où les deux
// gardes symétriques ci-dessous : on n'enregistre jamais sans identifiant, et un
// identifiant absent ne satisfait jamais la comparaison.
//
// ⚠️ DÉGRADATION : une décision enregistrée par une version antérieure porte un NOM
// (« Rowtine ») là où on compare désormais une URI — la comparaison échoue toujours,
// donc `hasBackupDecision` renvoie `false`, donc la sauvegarde reste en pause jusqu'à
// un geste explicite. C'est le bon sens de dégradation : jamais plus permissif que
// l'ancien code, seulement plus prudent le temps qu'une nouvelle décision soit prise.
import { getSetting, setSetting } from '@/db/db'
import { folderKey } from './saf-folder'

const KEY = 'backupDecision'

// Enregistre la décision pour le dossier actuellement désigné. Renvoie `false` sans
// rien écrire si le dossier ne peut pas être identifié — mieux vaut redemander que
// d'acquitter un dossier qu'on n'a pas su identifier.
export async function recordBackupDecision() {
  let key
  try {
    key = await folderKey()
  } catch {
    return false
  }
  if (!key) return false
  await setSetting(KEY, { folder: key, at: new Date().toISOString() })
  return true
}

// Vrai si une décision a été prise POUR LE DOSSIER ACTUELLEMENT DÉSIGNÉ.
// Repli prudent : toute erreur, tout identifiant absent, toute forme inattendue du
// réglage (installation antérieure, donnée corrompue) → `false`, c'est-à-dire « pas
// de décision », c'est-à-dire la sauvegarde reste en pause. Ne pas sauvegarder est
// récupérable ; détruire ne l'est pas.
export async function hasBackupDecision() {
  try {
    const key = await folderKey()
    if (!key) return false
    const raw = await getSetting(KEY)
    if (!raw || typeof raw !== 'object') return false
    return raw.folder === key
  } catch {
    return false
  }
}

// Efface la décision : la sauvegarde repasse en pause tant qu'aucune nouvelle
// décision n'est prise. Appelée à la désignation d'un dossier (le nouveau dossier
// n'a pas encore été acquitté) et par les tests.
export async function clearBackupDecision() {
  await setSetting(KEY, null)
}

// Rowtine — d'où vient la sauvegarde du dossier (depuis le 06/08/2026).
//
// Partagé par les DEUX écrans qui posent la question : la section des Réglages et le
// bandeau de décision. Ils doivent conclure la même chose de la même fiche — deux
// grilles de messages divergent tôt ou tard, c'est la règle que porte déjà l'en-tête de
// BackupDecisionPrompt.vue.
//
// `unknown` recouvre exprès DEUX cas côté fiche (« absente » et « illisible ») : à
// l'écran, ils disent la même chose — on ne sait pas d'où vient cette sauvegarde, donc
// on ne conseille rien. La distinction, elle, compte pour la SAUVEGARDE (absente
// n'interrompt pas, illisible interrompt) : c'est `backupPauseReason` qui la porte, pas
// ce module.
import { readManifest } from './backup-manifest'
import { deviceId } from './device-identity'

export async function describeOrigin(storage) {
  if (!storage) return { origin: 'unknown', manifest: null }
  try {
    const read = await readManifest(storage)
    if (read.state !== 'ok') return { origin: 'unknown', manifest: null }
    const mine = await deviceId()
    return { origin: read.manifest.appareil === mine ? 'self' : 'other', manifest: read.manifest }
  } catch {
    // Ne lève JAMAIS : cette réponse alimente un écran d'information. Une lecture qui
    // échoue doit produire « je ne sais pas » — donc aucun conseil — et non faire
    // planter la section des Réglages, qui porte aussi la seule porte de sortie de la
    // garde anti-écrasement.
    return { origin: 'unknown', manifest: null }
  }
}

// Les DEUX phrases que les deux écrans affichent. Elles vivent ici, avec le prédicat qui
// les alimente, et non dans l'un des deux composants : la section des Réglages les avait
// écrites en premier, le bandeau de décision devait les redire mot pour mot. Recopier
// deux `computed` identiques, c'est promettre que deux grilles de messages resteront
// d'accord — la seule promesse que ce fichier existe pour ne pas avoir à tenir.
//
// Fonctions PURES (le `t` de vue-i18n est passé en argument) : aucun accès au composant,
// donc testables seules, et utilisables aussi bien depuis un `computed` que hors de Vue.

// Le conseil n'existe QUE dans les cas où l'app sait de quoi elle parle. Origine inconnue
// ⇒ `null`, donc aucune ligne affichée : conseiller à l'aveugle pourrait envoyer quelqu'un
// écraser la sauvegarde qui était justement la bonne.
//
// `restorable` — la réponse d'`isDbRestorable()` (restore-service.js), telle que l'écran
// appelant l'a déjà calculée (décision produit, 07/08). Savoir qu'un AUTRE appareil a
// écrit ne suffit pas à conseiller : la fiche ne dit pas lequel des deux cas on vit.
//
//   • MIGRATION (`true`) — ancien téléphone vers le neuf, base locale encore vierge :
//     restaurer est exactement le bon geste, et il aboutira.
//   • DOSSIER PARTAGÉ (`false`) — deux appareils en usage : restaurer effacerait le travail
//     local, et `runRestore` le REFUSERA (garde `not-empty`). Le remède n'est pas un des
//     deux boutons, c'est de désigner un AUTRE dossier pour cet appareil — et ça, on le
//     sait, donc on le dit (`saf.adviceOtherDeviceBlocked`, correctif de revue 07/08 :
//     « ne pas conseiller de restaurer » ne voulait pas dire « ne rien dire »).
//
// ⚠️ TROIS ÉTATS, PAS DEUX — et c'est le cœur du correctif de revue du 07/08.
// `null`/`undefined` = LA SONDE N'A PAS SU RÉPONDRE (elle a levé). Ce n'est ni « migration »
// ni « dossier partagé » : c'est « on ne sait pas », donc AUCUN conseil. Un booléen ne
// pouvait pas porter ce troisième cas, et les deux écrans divergeaient précisément là — le
// bandeau retombait sur `true` (repli conçu pour un BOUTON : ne pas offrir la sortie de
// secours sans raison) et conseillait de restaurer sur une sonde en échec, les Réglages
// retombaient sur `false`. Deux conclusions opposées à partir du même module partagé, dont
// c'est exactement la raison d'être d'empêcher.
//
// Ne concerne QUE les conseils `'other'` : celui de `'self'` ne recommande aucun geste, il
// constate que les données sont déjà là. Il ne dépend donc pas de la restaurabilité.
//
// `manifest` n'est pas pris en argument — contrairement à `originSentence` ci-dessous, le
// conseil ne dépend pas du CONTENU de la fiche. Un paramètre inutilisé serait un mensonge
// de signature (il laisserait croire qu'un jour la fiche change le conseil).
export function adviceSentence(t, origin, restorable) {
  if (origin === 'self') return t('saf.adviceThisDevice')
  if (origin === 'other' && restorable === true) return t('saf.adviceOtherDevice')
  if (origin === 'other' && restorable === false) return t('saf.adviceOtherDeviceBlocked')
  return null
}

// La phrase de FAIT : qui a écrit cette sauvegarde, et quand. Toujours une phrase, y
// compris quand on ne sait pas — ne rien savoir est en soi une information utile ici,
// alors que ne rien savoir n'autorise aucun conseil.
export function originSentence(t, origin, manifest) {
  if (origin === 'unknown') return t('saf.originUnknown')
  const date = manifest?.ecritLe ? new Date(manifest.ecritLe).toLocaleString() : ''
  if (origin === 'self') return t('saf.originThisDevice', { date })
  // `modeleAppareil` est FACULTATIF par construction (device-identity.js : `null` sur
  // web/dev, sur un build antérieur à l'ajout de cette fiche, ou sur erreur) — d'où la phrase de repli,
  // plutôt qu'un « un autre appareil (null) ». ⚠️ MESURÉ : vue-i18n interpole un
  // paramètre manquant en chaîne VIDE, jamais en `{model}` — sans ce repli, la phrase
  // afficherait « un autre appareil () », pas d'accolades visibles.
  const model = manifest?.modeleAppareil
  return model
    ? t('saf.originOtherDevice', { model, date })
    : t('saf.originOtherUnnamed', { date })
}

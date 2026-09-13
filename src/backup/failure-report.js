// Rowtine — rapport COPIABLE d'un échec de l'enregistrement automatique
// (décision produit du 05/09/2026). Le snackbar ne peut porter qu'une phrase
// courte : le RAPPORT COMPLET — ce que l'utilisatrice colle tel quel dans son
// signalement — part dans le presse-papiers (action « Copier l'erreur », App.vue).
//
// GÉNÉRALISÉ (même décision du 05/09) : le compositeur sert désormais
// AUSSI les échecs de restauration et la « reprise du dossier non confirmée »
// (RestoreErrorDialog.vue), qui ont exactement le même besoin — un texte collable
// disant QUAND, SUR QUEL DOSSIER, avec QUELLE erreur. D'où les paramètres
// `title` (la première ligne, le contexte de l'échec — défaut inchangé pour les
// appelants historiques) et `details` (écarts consignés en plus de
// l'erreur principale — les `errors` du snapshot `readBackup`, cf. restore.js :
// une restauration partiellement réussie doit dire ce qu'elle a écarté, sans
// quoi le rapport suggère un sinistre intégral là où il n'y a que des écarts).
//
// Fonction PURE : ni i18n ni DOM, tout passe par les paramètres (`at`,
// `version`, `build` surchargeables) — testable sans horloge ni montage.
//
// Libellés volontairement en français, NON traduits : ce texte est destiné à un
// rapport de bug lu côté développement, pas affiché comme prose d'interface.
// Vocabulaire conforme à la consigne du dépôt : « enregistrement des données »,
// jamais « sauvegarde » ; « restauration des données » pour les échecs de restauration.
import { APP_BUILD, APP_VERSION } from '@/constants/app-info'

// Titre par défaut : l'échec de l'enregistrement automatique. Posé en
// constante EXPORTÉE plutôt qu'en littéral inline : les appelants de restauration composent LEUR
// titre à partir des leurs ci-dessous, et un titre mal retapé chez l'un ou l'autre
// brouillerait le diagnostic (le rapport dirait « enregistrement automatique » pour
// un échec de restauration).
const AUTO_BACKUP_FAILURE_TITLE = 'Enregistrement automatique des données Rowtine — échec'

// Contextes de restauration — même raison d'être que la constante ci-dessus :
// un seul endroit qui sait libeller chaque variante, RestoreErrorDialog.vue les
// choisit par `kind` sans les recopier.
export const RESTORE_FAILURE_REPORT_TITLE = 'Restauration des données — échec'
export const RESTORE_UNOWNED_REPORT_TITLE = 'Restauration des données — reprise du dossier non confirmée'

// Date/heure LOCALE au format ISO 8601 avec décalage (2026-09-05T18:42:10+02:00).
// `toISOString()` serait trompeur : il tranche en UTC et fabrique des
// « échecs à une heure impossible » qui coûtent du temps de diagnostic — le
// décalage explicite dit à la fois l'heure locale ET le fuseau de l'appareil.
function localIso(at) {
  const d = at instanceof Date ? at : new Date(at)
  // Valeur illisible reçue : la recopier telle quelle plutôt que « Invalid
  // Date » — un rapport doit toujours rester collable et dire quelque chose.
  if (Number.isNaN(d.getTime())) return String(at)
  const pad = (n) => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

// Compose le texte multi-lignes à copier. `failure` est l'objet publié par le
// store `backup-failure` ({ error, path, at }) ou par le store `restore-error`
// ({ kind, error, path, at, details? }) ; `path` peut valoir null (réglage et nom
// tous deux illisibles — cf. publishAutoBackupFailure) : le rapport dit
// « (inconnu) » au lieu de trous silencieux. Le message d'erreur est repris
// INTÉGRAL, retours à la ligne compris : une erreur tronquée ou aplatie par le
// compositeur ferait perdre précisément le détail qu'on veut recevoir.
// `details` : écarts OPTIONNELS (restauration incomplète) ; chacun est soit une
// chaîne déjà formée, soit l'objet TEL QUEL consigné par `readBackup`
// ({ where, error } | { where, table, code } — cf. restore.js) : la
// normalisation vit ICI, une seule fois, plutôt que dupliquée chez chaque
// appelant (porte du dossier, bandeau de décision) où elle divergerait.
// Chaque écart devient une ligne préfixée « - » pour rester lisible une fois
// collé dans un champ de texte brut.
function detailLine(d) {
  if (d && typeof d === 'object') {
    const where = d.where || d.folder || '(destination inconnue)'
    const why = d.error || d.code || '(raison non consignée)'
    return `${where} : ${why}`
  }
  return String(d)
}

// `title`/`version`/`build` surchargeables uniquement pour les tests (et le choix
// de contexte pour `title`, cf. les constantes ci-dessus).
export function composeBackupFailureReport({
  title = AUTO_BACKUP_FAILURE_TITLE,
  error,
  path,
  at = new Date(),
  version = APP_VERSION,
  build = APP_BUILD,
  details,
} = {}) {
  const lines = [
    title,
    `Date : ${localIso(at)}`,
    `Version de l'app : ${version} (build ${build})`,
    `Dossier : ${path || '(inconnu)'}`,
    'Erreur :',
    String(error ?? ''),
  ]
  if (details?.length) {
    lines.push('Écarts :', ...details.map((d) => `- ${detailLine(d)}`))
  }
  return lines.join('\n')
}

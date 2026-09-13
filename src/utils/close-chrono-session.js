// Fermeture CANONIQUE d'une session chrono (lot « chrono unifié », 2026-08-30) : pause +
// clôture + snackbar. Extraite de l'ancienne saveChronoSession de ReaderView pour être
// partagée par les DEUX seuls gestes qui ferment une session : le garde « sortie de bulle »
// du routeur (src/router/index.js) et le bouton œil « masquer le chrono » (lecteur et fiche
// projet). Une seule définition, pas de ré-implémentation au fil des écrans : la façon de
// fermer une session ne doit pas dépendre de l'endroit d'où on la clôt.
// Depuis le lot « la séance visible dès la pause » (30/08), ce helper NE JOURNALISE PLUS :
// la pause du store est COMMITTANTE — elle écrit elle-même le temps non commis dans la ligne
// de l'épisode (fusion < 2 h ou création). Un sessionsStore.add ici écrirait une DEUXIÈME
// ligne au plein elapsed : la journalisation appartient au store, le helper ferme et signale.
import i18n from '@/i18n'
import { useActiveSessionStore, fmtDuration } from '@/stores/activeSession'
import { useSnackbarStore } from '@/stores/snackbar'

// Idempotente : chrono inactif → ne touche à rien (ni écriture, ni snackbar). Renvoie
// l'instantané fermé (durationSec compris), ou null si la session n'existait pas — l'appelant
// n'a normalement rien à en faire, la fermeture est complète au retour.
export async function closeChronoSession() {
  const active = useActiveSessionStore()
  if (!active.isActive) return null
  // Pause commitante : c'est elle qui écrit le solde au journal — ou ne trouve rien à
  // commettre si une pause vient de passer (filigrane committedSec) : la fermeture qui
  // suit une pause n'écrit donc RIEN de plus, quel que soit l'endroit d'où elle vient.
  await active.pause()
  // L'instantané de stopAndClear porte le FULL elapsed de l'épisode, pris AVANT que son
  // étape en file ne remette le triplet à zéro : la pause vient d'y verser le live, la
  // photo vaut donc exactement le total affiché à l'instant où l'utilisatrice quitte sa
  // session — c'est CE total que le snackbar doit annoncer, pas un solde résiduel.
  const snap = await active.stopAndClear()
  if (snap.durationSec > 0) {
    // i18n.global (et non le composable useI18n) : cette fermeture vit hors composant —
    // dans le garde du routeur notamment. Le préfixe de locale est déjà posé au démarrage
    // par le même routeur (i18n.global.locale.value), les deux voient la même langue.
    useSnackbarStore().show(i18n.global.t('reader.timeSaved', { time: fmtDuration(snap.durationSec) }))
  }
  return snap
}

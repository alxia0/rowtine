// Filet de sécurité : traduit les erreurs de stockage « non rattrapées » en snackbar,
// pour éviter une perte silencieuse (l'UI avance alors que l'écriture a échoué).
// Ce n'est PAS un rollback d'UI — juste un signal visible (le durcissement complet
// des écritures viendra si besoin ; ici on couvre le cas critique : disque plein).
import { isQuotaError } from '@/db/storage-health'
import i18n from '@/i18n'
import { useSnackbarStore } from '@/stores/snackbar'

// `snackbar` est injecté (testabilité). Renvoie true si l'erreur a été traitée.
export function handleStorageError(reason, snackbar) {
  if (!isQuotaError(reason)) return false
  snackbar.show(i18n.global.t('storage.writeFailed'))
  return true
}

// Gestionnaire d'erreurs Vue : Vue capte les rejets des handlers async (clic,
// cycle de vie, watchers) et les route vers app.config.errorHandler — PAS vers
// window.unhandledrejection. On y branche donc aussi le filet stockage : une
// erreur de quota devient un snackbar, tout le reste part dans la console.
// `snackbar` injectable pour la testabilité (sinon résolu à la volée).
//
// ⚠️ `isQuotaError(err)` EN PREMIER, et le court-circuit n'est pas cosmétique : sans lui,
// `useSnackbarStore()` était résolu pour CHAQUE erreur de composant, y compris celles qui
// n'ont rien à voir avec le stockage. Si cette résolution lève (Pinia inactif — démontage,
// rechargement à chaud, test qui pose le filet sans magasin), l'exception remplace l'erreur
// d'origine et le `console.error(err)` ci-dessous ne s'exécute JAMAIS : le filet censé rendre
// une panne visible la ferait disparaître. Le comportement nominal est inchangé (le magasin
// n'est résolu que sur une erreur de quota, seul cas où `handleStorageError` s'en sert).
export function storageAwareErrorHandler(snackbar = null) {
  return (err) => {
    if (!isQuotaError(err) || !handleStorageError(err, snackbar || useSnackbarStore())) console.error(err)
  }
}

// Pose le filet au niveau window. À appeler une fois au démarrage (après Pinia).
export function installStorageGuard() {
  if (typeof window === 'undefined') return
  window.addEventListener('unhandledrejection', (event) => {
    // useSnackbarStore() est résolu à la volée : Pinia est déjà actif à ce stade. Mais SEULEMENT
    // sur une erreur de quota (même court-circuit que `storageAwareErrorHandler` ci-dessus) : une
    // résolution qui lèverait ici transformerait n'importe quel rejet non traité en une SECONDE
    // erreur, dans un écouteur global, en masquant la première.
    if (isQuotaError(event.reason) && handleStorageError(event.reason, useSnackbarStore())) {
      event.preventDefault()
    }
  })
}

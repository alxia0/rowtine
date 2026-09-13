// Santé du stockage local (IndexedDB) — persistance OS, quota, détection d'erreurs.
// 100 % pur/testable : aucune dépendance à Vue ni à Dexie.

// Une écriture IndexedDB qui échoue par manque de place lève une erreur « quota ».
// Selon le navigateur/Dexie elle se présente sous plusieurs noms → on ratisse large.
export function isQuotaError(err) {
  if (!err) return false
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'QuotaExceeded' ||
    err.inner?.name === 'QuotaExceededError' ||
    err.inner?.name === 'QuotaExceeded' ||
    err.code === 22
  )
}

// Demande à l'OS de NE PAS évincer notre base sous pression de stockage.
// Sans support (vieux navigateur, jsdom de test) → { supported:false }.
export async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { supported: false, persisted: false }
  }
  try {
    const persisted = await navigator.storage.persist()
    return { supported: true, persisted }
  } catch {
    return { supported: true, persisted: false }
  }
}

// Estime l'occupation du stockage. ratio ∈ [0,1] ou null si inconnu.
export async function estimateStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { supported: false, usage: 0, quota: 0, ratio: null }
  }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    const ratio = quota > 0 ? usage / quota : null
    return { supported: true, usage, quota, ratio }
  } catch {
    // L'API existe (le typeof/? plus haut l'a validé) mais l'appel a échoué :
    // c'est bien « supporté », juste indisponible ponctuellement (cf. requestPersistentStorage).
    return { supported: true, usage: 0, quota: 0, ratio: null }
  }
}

// Niveau d'alerte à partir du ratio d'occupation.
export function quotaWarningLevel(ratio) {
  if (ratio == null) return 'none'
  if (ratio >= 0.9) return 'near'
  return 'none'
}

// Déclenche `warn()` (ex. snackbar) si l'estimation indique un stockage presque plein.
export function maybeWarnQuota(estimate, warn) {
  if (quotaWarningLevel(estimate?.ratio) === 'near') warn()
}

// Anti-matraquage : au plus une alerte quota toutes les 24 h.
// `lastWarnIso` : ISO string de la dernière alerte (setting persisté), ou falsy si jamais alertée.
const QUOTA_WARN_THROTTLE_MS = 24 * 60 * 60 * 1000
export function shouldWarnQuotaNow(lastWarnIso, nowMs) {
  if (!lastWarnIso) return true
  const last = new Date(lastWarnIso).getTime()
  if (Number.isNaN(last)) return true
  return nowMs - last >= QUOTA_WARN_THROTTLE_MS
}

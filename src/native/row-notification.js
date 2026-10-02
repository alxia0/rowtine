import { registerPlugin, Capacitor } from '@capacitor/core'

// Pont du plugin natif RowNotification (android/.../RowNotificationPlugin.java) :
// notification permanente du rang en cours, bouton « Cocher le rang » (ou moins et plus d'un
// compteur, avec `delta`) renvoyé en événement rowAction, retour au lecteur par openProject /
// takeLaunchProject, appui retenu par le natif (read/clear/ack), que l'app ait été fermée par
// Android ou que l'événement n'ait pas encore été acquitté par le JS.
// Hors natif, ou plugin absent (ancienne APK) : chaque fonction se résout sans effet,
// aucune promesse rejetée ne fuit. Le lecteur reste intact.
const RowNotification = registerPlugin('RowNotification')

const noop = () => {}

export function isRowNotificationAvailable() {
  return Capacitor.isNativePlatform()
}

async function call(method, ...args) {
  if (!isRowNotificationAvailable()) return undefined
  try {
    return await RowNotification[method](...args)
  } catch {
    return undefined
  }
}

// Le natif rend l'état Capacitor de l'alias `notifications` ; `prompt-with-rationale`
// (refus une fois, redemandable) se lit comme `prompt` côté app.
function permissionState(result) {
  const state = result?.notifications
  if (state === 'granted') return 'granted'
  if (state === 'prompt' || state === 'prompt-with-rationale') return 'prompt'
  return 'denied'
}

export async function showRowNotification(payload) {
  await call('show', payload)
}

export async function cancelRowNotification() {
  await call('cancel')
}

export async function checkRowNotificationPermission() {
  return permissionState(await call('checkPermissions'))
}

export async function requestRowNotificationPermission() {
  return permissionState(await call('requestPermissions'))
}

export async function openRowNotificationSettings() {
  await call('openSettings')
}

// Exclusion des optimisations de batterie (spec 2026-10-01) : l'état qui rend le bouton de
// la notification fiable en arrière-plan. Hors natif, plugin d'avant ce lot (le call rend
// undefined) ou rejet : {ignoring:true} — la contrainte n'existe pas là, jamais de blocage
// fantôme. `fallback` (demande passée par un écran de repli) : le résultat immédiat n'est
// pas fiable, seule la relecture au retour au premier plan décide (cf. spec, service
// d'activation).
export async function isBatteryOptimizationIgnored() {
  const result = await call('isIgnoringBatteryOptimizations')
  if (!result || typeof result.ignoring !== 'boolean') return { ignoring: true }
  return { ignoring: result.ignoring }
}

export async function requestIgnoreBatteryOptimizations() {
  const result = await call('requestIgnoreBatteryOptimizations')
  if (!result || typeof result.ignoring !== 'boolean') return { ignoring: true, fallback: false }
  return { ignoring: result.ignoring, fallback: !!result.fallback }
}

// Appui retenu par le natif : processus mort (spec 2026-09-30-notification-appui-attente),
// ou processus vivant, où le receiver écrit l'entrée avant d'émettre l'événement rowAction
// (spec 2026-10-01 appui-webview-gele). {projectId, stepId, delta, tapId?}, ou null. Hors
// natif, plugin absent ou rejet : null, aucune promesse rejetée ne fuit.
export async function readPendingRowAction() {
  const result = await call('readPendingRowAction')
  if (!result || result.stepId === null || result.stepId === undefined) return null
  const tap = {
    projectId: Number(result.projectId),
    stepId: String(result.stepId),
    delta: Number(result.delta) === -1 ? -1 : 1,
  }
  // Identifiant d'appui (spec 2026-10-01 appui-webview-gele) : absent des entrées retenues
  // par un processus mort d'avant ce lot, la clé reste alors absente.
  if (typeof result.tapId === 'string' && result.tapId) tap.tapId = result.tapId
  return tap
}

// Acquittement d'un appui reçu en événement `rowAction` (spec 2026-10-01
// appui-webview-gele) : dit au natif que le JS a pris sa décision, donc qu'il ne doit pas
// annoncer « Appui retenu ». `keep` : ne pas effacer l'entrée retenue (appui non traité,
// à rejouer plus tard). Sans tapId, hors natif, plugin absent ou rejet : sans effet.
export async function ackRowAction(tapId, { keep = false } = {}) {
  if (!tapId) return
  await call('ackRowAction', { tapId, keep: !!keep })
}

export async function clearPendingRowAction() {
  await call('clearPendingRowAction')
}

async function listen(eventName, cb) {
  if (!isRowNotificationAvailable()) return noop
  try {
    const handle = await RowNotification.addListener(eventName, cb)
    return () => {
      Promise.resolve(handle?.remove?.()).catch(noop)
    }
  } catch {
    return noop
  }
}

export function onRowAction(cb) {
  return listen('rowAction', cb)
}

export function onOpenProject(cb) {
  return listen('openProject', cb)
}

export async function takeLaunchProject() {
  const result = await call('takeLaunchProject')
  const id = result?.projectId
  return id === null || id === undefined ? null : Number(id)
}

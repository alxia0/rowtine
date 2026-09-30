import { registerPlugin, Capacitor } from '@capacitor/core'

// Pont du plugin natif RowNotification (android/.../RowNotificationPlugin.java) :
// notification permanente du rang en cours, bouton « Cocher le rang » (ou moins et plus d'un
// compteur, avec `delta`) renvoyé en événement rowAction, retour au lecteur par openProject /
// takeLaunchProject.
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

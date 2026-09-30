import { registerPlugin, Capacitor } from '@capacitor/core'

// Pont du plugin natif KeepAwake (android/.../KeepAwakePlugin.java) : garde l'écran allumé
// (FLAG_KEEP_SCREEN_ON de la fenêtre, sans permission). Hors natif, ou plugin absent
// (ancienne APK) : sans effet, aucune promesse rejetée ne fuit.
const KeepAwake = registerPlugin('KeepAwake')

export function isKeepScreenOnAvailable() {
  return Capacitor.isNativePlatform()
}

export async function setKeepScreenOn(on) {
  if (!isKeepScreenOnAvailable()) return
  try {
    await KeepAwake.set({ on: !!on })
  } catch {
    // Plugin absent ou fenêtre indisponible : l'écran garde son comportement normal.
  }
}

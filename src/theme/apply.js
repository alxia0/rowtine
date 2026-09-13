// Applique un réglage de thème : attribut data-theme (choix explicite), miroir
// localStorage (lu par le script pré-paint de index.html), <meta theme-color>, barre
// d'état native, et la palette d'accent dérivée de la teinte choisie. L'état « system » ne pose
// PAS data-theme (la media query CSS décide) mais écoute l'OS pour re-synchroniser
// meta + barre d'état + accent en direct.
import { resolveEffective } from './resolve'
import { generatePalette, bgHex, defaultHueFor } from './palette'

export const STORAGE_KEY = 'rowtine.theme'

let mq = null
let mqHandler = null
// Teinte actuellement appliquée — lue par le gestionnaire de changement d'OS (watchSystem),
// qui se déclenche de façon asynchrone bien après l'appel qui l'a enregistré : un `hue`
// capturé par fermeture à ce moment-là resterait figé si l'utilisatrice change ensuite de
// teinte via applyAccent() seul (SettingsView.vue, aperçu en direct du glissé), sans
// repasser par applyTheme().
// Trois formes possibles (T2, 31/08) :
// - `null` : aucune teinte fournie → défaut DYNAMIQUE selon le thème effectif
//   (rose 320 en sombre, bleu 230 en clair) — un changement de mode fait suivre la couleur ;
// - un nombre : teinte explicite (choix ColorPicker ou aperçu en direct) ;
// - une fonction (effective) => hue : fournie par les appelants qui savent si la teinte
//   est un choix explicite (store settings::effectiveAccentHue) — elle est RÉ-ÉVALUÉE à
//   chaque changement de thème/OS, pour que le défaut dynamique suive.
let currentHue = null

function resolveHue(effective) {
  if (typeof currentHue === 'function') return currentHue(effective)
  return currentHue ?? defaultHueFor(effective)
}

// Pas de miroir localStorage pour la teinte (contrairement à data-theme ci-dessus) : elle
// s'applique au même moment que le reste de applyTheme (meta, barre d'état), pas avant —
// même compromis déjà accepté pour ces deux-là, qui ne sont pas non plus pré-peints.
// Pose les tokens de palette — SANS toucher à `currentHue` : applyTheme() l'a déjà fixée
// (éventuellement à une FONCTION de fourniture, cf. plus haut) avant d'appeler ceci, et il
// ne faut pas l'écraser par le nombre résolu, sinon le défaut dynamique ne suivrait plus
// le prochain changement de thème/OS.
function setTokens(hue, effectiveTheme) {
  const root = document.documentElement
  const tokens = generatePalette(hue, effectiveTheme)
  for (const [prop, value] of Object.entries(tokens)) {
    root.style.setProperty(prop, value)
  }
}

// Appel externe (SettingsView.vue, aperçu en direct du glissé) : mémorise la teinte
// FOURNIE comme teinte courante — c'est le contrat historique de watchSystem.
export function applyAccent(hue, effectiveTheme) {
  currentHue = hue
  setTokens(hue, effectiveTheme)
}

export function applyTheme(setting, hue = null) {
  const root = document.documentElement
  if (setting === 'light' || setting === 'dark') root.setAttribute('data-theme', setting)
  else root.removeAttribute('data-theme') // 'system' → la media query CSS décide

  try {
    localStorage.setItem(STORAGE_KEY, setting)
  } catch {
    /* stockage indisponible : sans le miroir, léger flash possible au prochain démarrage, pas bloquant */
  }

  currentHue = hue
  const effective = resolveEffective(setting)
  const resolvedHue = resolveHue(effective)
  syncChrome(effective, resolvedHue)
  watchSystem(setting)
  setTokens(resolvedHue, effective)
  return effective
}

// <meta theme-color> + barre d'état Android, ensemble : les trois sites qui resynchronisent
// le chrome natif (ici, syncNativeChrome, et le handler OS de watchSystem ci-dessous) le font
// toujours pour la même paire (effective, hue).
function syncChrome(effective, hue) {
  syncMeta(effective, hue)
  syncStatusBar(effective, hue)
}

// hue : couleur de fond réellement affichée pour ce thème/cette teinte, dérivée du même
// générateur que le reste de la palette (bgHex) — plus un littéral figé qui ne suivait que
// la teinte par défaut.
function syncMeta(effective, hue) {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', bgHex(hue, effective))
}

// Barre d'état Android (Capacitor). Guardée : sur le web / au banc / en test, l'import
// échoue ou isNativePlatform() est faux → no-op silencieux.
async function syncStatusBar(effective, hue) {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor?.isNativePlatform?.()) return
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: effective === 'dark' ? Style.Dark : Style.Light })
    if (Capacitor.getPlatform?.() === 'android') {
      await StatusBar.setBackgroundColor({ color: bgHex(hue, effective) })
    }
  } catch {
    /* plugin absent (web/test) — ignoré */
  }
}

// À appeler après un changement de teinte SEUL (sans changement de thème clair/sombre) —
// resynchronise <meta theme-color> et la barre d'état Android sur le nouveau --bg. Ne PAS
// appeler depuis applyAccent() : elle tourne à chaque tick d'un glissé (aperçu en direct),
// et syncStatusBar() est un appel natif Capacitor asynchrone — la déclencher à cette
// fréquence rouvrirait le problème de rafale déjà corrigé côté persistance Dexie
// (cf. SettingsView.vue::previewAccentHue vs setAccentHue).
export function syncNativeChrome(hue, effectiveTheme) {
  syncChrome(effectiveTheme, hue)
}

function watchSystem(setting) {
  if (mq && mqHandler) mq.removeEventListener('change', mqHandler)
  mq = null
  mqHandler = null
  if (setting !== 'system') return
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  mq = window.matchMedia('(prefers-color-scheme: dark)')
  mqHandler = () => {
    const effective = resolveEffective('system')
    const resolvedHue = resolveHue(effective)
    syncChrome(effective, resolvedHue)
    // setTokens (et PAS applyAccent) : applyAccent écraserait `currentHue` — potentiellement
    // un fournisseur de défaut dynamique — par le nombre résolu, et le basculement OS
    // SUIVANT repartirait de ce nombre figé au lieu de re-suire le thème.
    setTokens(resolvedHue, effective)
  }
  mq.addEventListener('change', mqHandler)
}

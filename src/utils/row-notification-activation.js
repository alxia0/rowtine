// Flux d'activation de la notification du rang en cours (spec 2026-10-01) : fonction PURE
// sur des ports injectés — aucune importation de Vue, de store ni de pont natif ici, les
// appelants (pop-up d'onboarding) passent les fonctions réelles. Invariant visé :
// `rowNotification === true` ⇔ POST_NOTIFICATIONS accordée ET optimisations de batterie
// désactivées — le service est le SEUL demandeur de POST (l'ancien askPermissionOnce du
// lecteur est retiré avec ce lot).
//
// Le chemin repli (liste système/infos app, `requestBattery` → `fallback: true`) revient
// presque aussitôt : son résultat « pas encore autorisé » ne vaut rien. Le service n'écrit
// JAMAIS false sur ce chemin (`battery-pending`) — l'attente se conclut à la relecture au
// retour au premier plan (la pop-up la porte). En revanche une réponse repli qui lit
// l'exemption VRAIE au PowerManager vaut accord : c'est la relecture qui décide, jamais le
// résultat de l'écran.

// Codes de raison, en constantes nommées : le garde « aucun avertissement en français en
// dur » (tests/unit/warnings-no-french.spec.js) interdit tout littéral de chaîne dans un
// champ raison, y compris un code machine — et nommer les quatre issues ne coûte rien.
const RAISON_ACCORDEE = 'granted'
const RAISON_PERMISSION = 'permission'
const RAISON_BATTERIE = 'battery'
const RAISON_BATTERIE_EN_ATTENTE = 'battery-pending'

export async function activateRowNotification(ports) {
  let permission = await ports.checkPermission()
  if (permission === 'prompt') {
    permission = await ports.requestPermission()
    await ports.markAsked()
  }
  if (permission !== 'granted') {
    await ports.saveEnabled(false)
    return { enabled: false, reason: RAISON_PERMISSION }
  }
  let battery = await ports.checkBattery()
  if (!battery.ignoring) {
    battery = await ports.requestBattery()
    if (!battery.ignoring) {
      if (battery.fallback) return { enabled: false, reason: RAISON_BATTERIE_EN_ATTENTE }
      await ports.saveEnabled(false)
      return { enabled: false, reason: RAISON_BATTERIE }
    }
  }
  await ports.saveEnabled(true)
  return { enabled: true, reason: RAISON_ACCORDEE }
}

// État effectif relu aux moments qui comptent (lecteur prêt, Réglages, retour au premier
// plan) : la base du rattrapage « autorisation retirée plus tard » (spec §Principe).
export async function verifyRowNotificationAuthorization({ checkPermission, checkBattery }) {
  const permission = await checkPermission()
  const battery = await checkBattery()
  return { ok: permission === 'granted' && battery.ignoring, permission, battery }
}

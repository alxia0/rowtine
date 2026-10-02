<script setup>
// Pop-up d'onboarding de la notification du rang en cours (spec 2026-10-01) : le SEUL
// chemin d'activation. Elle explique pourquoi l'autorisation d'arrière-plan est
// nécessaire (Android ferme l'app → le bouton de la notification ne répond plus) et mène
// au réglage via le service d'activation (src/utils/row-notification-activation.js), au
//quel elle passe les fonctions réelles du pont natif. Le réglage ne devient vrai qu'à la
// fin du flux ; « Désactiver la notification » est l'issue explicite (boutons à
// conséquence). Pas de fermeture hors boutons (ni dehors, ni Échap) : un état divergent
// se referme par un choix.
//
// Deux détenteurs l'instancient : les Réglages (activation depuis l'interrupteur) et le
// lecteur (rattrapage d'un réglage vrai sans autorisation — restauration sur appareil
// neuf, autorisation retirée plus tard). Les deux émits ne portent aucune donnée : les
// parents relisent l'état effectif.
//
// L'écouteur `resume` est armé PENDANT TOUTE l'ouverture, pas seulement pendant
// l'attente : c'est lui qui conclut une activation suspendue au chemin repli (la liste
// système ne dit rien), et il débloque aussi un appel d'activité perdu (callback natif
// jamais revenu, boutons restés occupés) — dans les deux cas, c'est la relecture de
// l'État effectif (permission + exemption) qui décide, jamais le résultat d'un écran.
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useSnackbarStore } from '@/stores/snackbar'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import {
  checkRowNotificationPermission,
  requestRowNotificationPermission,
  isBatteryOptimizationIgnored,
  requestIgnoreBatteryOptimizations,
  isRowNotificationAvailable,
} from '@/native/row-notification'
import {
  activateRowNotification,
  verifyRowNotificationAuthorization,
} from '@/utils/row-notification-activation'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['authorized', 'disabled'])

const { t } = useI18n()
const settings = useSettingsStore()
const snackbar = useSnackbarStore()
const allowBtn = ref(null)
const panel = ref(null)
useDialogFocusReturn(() => props.open)
const busy = ref(false)
// Vraie tant que l'état effectif n'est pas revenu accordé : « pas encore autorisé »
// (dialogue direct refusé) ou attente du retour du réglage système (chemin repli).
const waiting = ref(false)

// Import dynamique : le module @capacitor/app n'existe pas côté web (même règle que
// useRowNotification.js). L'écouteur ne vit que le temps de l'ouverture. Déclaré AVANT
// le watch `immediate` ci-dessous : son premier appel part du setup, la déclaration ne
// doit pas être en TDZ à ce moment (fonctions déclarées plus bas, elles se hissent).
// `resumeGeneration` referme la course armement/retrait : un pont qui se charge pendant
// un retrait voit sa génération dépassée et retire aussitôt l'écouteur reçu trop tard.
let removeResume = null
let resumeGeneration = 0
// Une pop-up ne conclut qu'UNE fois : le `resume` peut conclure pendant qu'un
// « Autoriser » est en vol (dialogue POST ouvert, retour au premier plan) — le service
// finirait sinon par conclure à son tour, un second emit du même signal.
let conclu = false
const LOST_CALL_GRACE_MS = 800
let graceTimer = null

// Les deux boutons désactivés pendant `busy` perdraient le focus (retombé sur body, hors
// de l'overlay : le piège de Tab ne le capte plus) : il passe au panneau, puis revient à
// « Autoriser » quand l'occupation cesse.
watch(busy, async (b) => {
  if (!props.open) return
  await nextTick()
  if (b) panel.value?.focus()
  else allowBtn.value?.focus()
})

let verrouPose = false
watch(
  () => props.open,
  async (v) => {
    if (v) {
      waiting.value = false
      busy.value = false
      conclu = false
      verrouPose = true
      lockBodyScroll()
      armerResume()
      await nextTick()
      allowBtn.value?.focus()
    } else if (verrouPose) {
      verrouPose = false
      unlockBodyScroll()
      retirerResume()
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
  clearTimeout(graceTimer)
  retirerResume()
})

// Import dynamique : le module @capacitor/app n'existe pas côté web (même règle que
// useRowNotification.js). L'écouteur ne vit que le temps de l'ouverture. Déclaré AVANT
// le watch `immediate` ci-dessus : le premier appel d'armerResume part du setup.
async function armerResume() {
  if (removeResume || !isRowNotificationAvailable()) return
  const generation = ++resumeGeneration
  try {
    const { App } = await import('@capacitor/app')
    const handle = await App.addListener('resume', surRetourAuPremierPlan)
    if (generation !== resumeGeneration) {
      // Retrait passé pendant le chargement du pont : l'écouteur reçu trop tard est
      // retiré aussitôt, la pop-up croit déjà être à l'écoute libre.
      Promise.resolve(handle?.remove?.()).catch(() => {})
      return
    }
    removeResume = handle
  } catch {
    // Pont indisponible : la pop-up reste sur ses boutons, rien ne se conclut tout seul.
  }
}
function retirerResume() {
  resumeGeneration++
  Promise.resolve(removeResume?.remove?.()).catch(() => {})
  removeResume = null
}

async function surRetourAuPremierPlan() {
  if (!props.open) return
  const state = await verifyRowNotificationAuthorization({
    checkPermission: checkRowNotificationPermission,
    checkBattery: isBatteryOptimizationIgnored,
  })
  if (!props.open) return
  if (state.ok) {
    // L'autorisation est venue pendant l'absence (dialogue système accepté, réglage
    // Android touché à la main) : l'activation se conclut ici, quelle que soit l'attente.
    await settings.saveRowNotification(true)
    conclure(true)
    return
  }
  if (busy.value) {
    // Le retour d'un dialogue système en vol (POST, puis batterie) déclenche aussi `resume`
    // alors que `onAllow` va enchaîner : on laisse un court délai à l'appel pour répondre.
    // Passé ce délai, c'est un appel d'activité perdu : débloquer les boutons et dire
    // honnêtement où on en est.
    clearTimeout(graceTimer)
    graceTimer = setTimeout(() => {
      if (!props.open || !busy.value) return
      busy.value = false
      waiting.value = true
    }, LOST_CALL_GRACE_MS)
  }
}

function conclure(enabled) {
  if (conclu) return
  conclu = true
  clearTimeout(graceTimer)
  retirerResume()
  waiting.value = false
  emit(enabled ? 'authorized' : 'disabled')
}

async function onAllow() {
  if (busy.value) return
  busy.value = true
  try {
    const result = await activateRowNotification({
      checkPermission: checkRowNotificationPermission,
      requestPermission: requestRowNotificationPermission,
      markAsked: () => settings.markRowNotificationAsked(),
      checkBattery: isBatteryOptimizationIgnored,
      requestBattery: requestIgnoreBatteryOptimizations,
      saveEnabled: (enabled) => settings.saveRowNotification(enabled),
    })
    if (result.enabled) {
      conclure(true)
      return
    }
    if (result.reason === 'permission') {
      // Refus POST (deux refus Android 13+ → denied immédiat) : un bouton « Autoriser »
      // qui n'ouvre plus rien est une boucle morte — on referme, le snackbar le dit, la
      // reprise passe par les Réglages.
      snackbar.show(t('rowNotif.onboardingPermissionRefused'))
      conclure(false)
      return
    }
    // 'battery' (dialogue direct refusé) ou 'battery-pending' (repli) : la pop-up reste
    // ouverte ; sur repli, la relecture au premier plan conclut.
    waiting.value = true
  } finally {
    busy.value = false
  }
}

async function onDisable() {
  if (busy.value) return
  busy.value = true
  try {
    await settings.saveRowNotification(false)
    conclure(false)
  } finally {
    busy.value = false
  }
}

function onKeydown(e) {
  if (e.key === 'Escape') e.preventDefault() // pas de fermeture hors boutons
  else trapTabFocus(e)
}
</script>

<template>
  <div
    v-if="open"
    class="rno-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="rno-title"
    data-test="row-notif-onboarding"
    @keydown="onKeydown"
  >
    <div ref="panel" class="rno-overlay__panel" tabindex="-1">
      <h2 id="rno-title" class="rno__title">{{ t('rowNotif.onboardingTitle') }}</h2>
      <p class="rno__body">{{ t('rowNotif.onboardingText') }}</p>
      <p class="rno__note">{{ t('rowNotif.onboardingBrands') }}</p>
      <p v-if="waiting" class="rno__notyet" data-test="row-notif-onboarding-notyet">
        {{ t('rowNotif.onboardingNotYet') }}
      </p>
      <div class="rno__actions">
        <button class="btn" data-test="row-notif-onboarding-disable" :disabled="busy" @click="onDisable">
          {{ t('rowNotif.onboardingDisable') }}
        </button>
        <button ref="allowBtn" class="btn btn--primary" data-test="row-notif-onboarding-allow" :disabled="busy" @click="onAllow">
          {{ t('rowNotif.onboardingAllow') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Même facture que RestoreErrorDialog (overlay 1300, panneau 460px) : la primauté
   à l'écran tient au z-index seul. */
.rno-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom));
}
.rno-overlay__panel {
  position: relative;
  width: 100%;
  max-width: 460px;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--bg);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  box-shadow: var(--clay-sm);
}
.rno__title {
  font-size: 18px;
  margin-bottom: var(--sp-2);
}
.rno__body {
  color: var(--ink);
  font-size: 14px;
  margin-bottom: var(--sp-2);
}
.rno__note {
  color: var(--ink-55);
  font-size: 12.5px;
  margin-bottom: var(--sp-3);
}
.rno__notyet {
  background: var(--surface);
  border-radius: var(--r-sm);
  font-size: 13px;
  margin: 0 0 var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
}
.rno__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  justify-content: flex-end;
}
</style>

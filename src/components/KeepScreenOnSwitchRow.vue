<script setup>
// Rangée interrupteur « Garder l'écran allumé pendant le suivi » (spec 2026-10-01) :
// partagée par les Réglages et le volet d'aide-mémoire du lecteur — UN seul réglage
// global (stores/settings.js, actif par défaut depuis le 30/09), deux endroits qui
// l'écrivent. Le lecteur l'applique réactivement (composables/useKeepScreenOn.js) :
// un appui ici change le comportement immédiatement, sans quitter le projet ni
// toucher au chrono.
// Rend false hors natif : le pont keep-awake y est un no-op, ne rien montrer qui ne
// ferait rien (les instantanés a11y du web ne voient pas de switch de plus).
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { isKeepScreenOnAvailable } from '@/native/keep-awake'

defineProps({ headingId: { type: String, required: true } })
const { t } = useI18n()
const settings = useSettingsStore()

function toggle() {
  settings.saveKeepScreenOn(!settings.keepScreenOn)
}
</script>

<template>
  <div v-if="isKeepScreenOnAvailable()" class="ksos-row">
    <h2 :id="headingId" class="ksos-row__title">{{ t('settings.keepScreenOn') }}</h2>
    <button
      type="button"
      class="switch"
      :class="{ 'switch--on': settings.keepScreenOn }"
      role="switch"
      :aria-checked="settings.keepScreenOn ? 'true' : 'false'"
      :aria-labelledby="headingId"
      data-test="keep-screen-switch"
      @click="toggle"
    >
      <span class="switch__thumb"></span>
    </button>
  </div>
</template>

<style scoped>
/* Règles reprises telles quelles de la rangée équivalente de SettingsView.vue
   (qui les garde pour sa section notification). Zone tactile 48 px via ::after. */
.ksos-row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
.ksos-row__title { font-size: 17px; margin: 0; }
.switch { flex: none; position: relative; overflow: visible; width: 48px; height: 28px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--bg); padding: 0; }
.switch::after { content: ''; position: absolute; inset: -10px -4px; }
.switch__thumb { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--ink-55); transition: transform 0.15s; }
.switch--on { background: var(--sage); border-color: var(--sage); }
.switch--on .switch__thumb { transform: translateX(20px); background: var(--on-solid); }
</style>

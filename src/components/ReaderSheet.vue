<script setup>
// Panneau « Aide-mémoire » : bottom-sheet à onglets rendant des blocs déclaratifs
// (paragraphes, listes, tableau de tailles, valeurs par taille, tuto vidéo, ouverture diagramme).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatSizes, isBlankCount, sizeLabelText } from '@/utils/reader'
import AppIcon from '@/components/AppIcon.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

const props = defineProps({
  reference: { type: Object, required: true }, // { tabs, abbrFull, ... }
  sizeLabels: { type: Array, default: () => [] },
  sizeIndex: { type: Number, default: null },
  open: { type: Boolean, default: false },
  activeTab: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'update:activeTab', 'open-chart'])
const { t } = useI18n()

const tabs = computed(() => props.reference.tabs || [])
const current = computed(() => tabs.value.find((x) => x.id === props.activeTab) || tabs.value[0])

// Libellé réservé (onglet/h3) localisé si buildReference a émis une clé i18n stable,
// repli sur le libellé FR figé sinon (contenu patron — ex. h3 du tab techniques — n'a pas
// de clé et ressort donc tel quel, dans la langue source).
const lbl = (o, keyField, fallbackField) => (o && o[keyField] ? t(o[keyField]) : o?.[fallbackField])

const perSizeText = (row) =>
  props.sizeIndex == null ? formatSizes(row.values) + ' ' + (row.unit || '') : row.values[props.sizeIndex] + ' ' + (row.unit || '')

// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé). Le keydown est posé sur la CARTE (`<aside role="dialog">`),
// jamais sur le voile, qui garde le clic de fermeture.
useDialogFocusReturn(() => props.open)
</script>

<template>
  <div>
    <div class="rs-scrim" :class="{ 'rs-scrim--on': open }" @click="emit('update:open', false)"></div>
    <aside class="rs" :class="{ 'rs--on': open }" role="dialog" aria-modal="true" :aria-label="$t('reader.help')" @keydown="trapTabFocus">
      <div class="rs__grip"></div>
      <div class="rs__head">
        <h2>{{ $t('reader.help') }}</h2>
        <button class="rs__close" :aria-label="$t('common.close')" @click="emit('update:open', false)"><AppIcon name="close" :size="18" /></button>
      </div>
      <div class="rs__tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="rs__tab"
          :class="{ 'rs__tab--on': current && current.id === tab.id }"
          role="tab"
          :aria-selected="current && current.id === tab.id"
          @click="emit('update:activeTab', tab.id)"
        >
          {{ lbl(tab, 'labelKey', 'label') }}
        </button>
      </div>
      <div v-if="current" class="rs__scroll">
        <div v-for="(b, i) in current.blocks" :key="i" class="rs__block">
          <h3 v-if="b.h3">{{ lbl(b, 'h3Key', 'h3') }}</h3>
          <p v-for="(p, j) in b.p || []" :key="'p' + j">{{ p }}</p>
          <p v-for="(m, j) in b.muted || []" :key="'m' + j" class="rs__muted">{{ m }}</p>

          <!-- valeurs par taille — on masque les vecteurs tout-zéro (artefact d'import,
               même règle que les rangs du lecteur via isBlankCount) -->
          <template v-for="(row, j) in b.perSize || []" :key="'ps' + j">
            <p v-if="!isBlankCount(row.values)" class="rs__persize">
              <strong v-if="row.label">{{ row.label }} :</strong>
              <span v-if="sizeIndex != null" class="rs__psval">{{ perSizeText(row) }}</span>
              <span v-else class="rs__muted"> {{ perSizeText(row) }}</span>
            </p>
          </template>

          <!-- tableau de tailles (colonne active surlignée) -->
          <div v-if="b.sizeTable" class="rs__tablewrap">
            <table class="rs__sizes">
              <thead>
                <tr>
                  <th></th>
                  <th v-for="(lab, k) in sizeLabels" :key="k" :class="{ 'rs__col--on': sizeIndex === k }">{{ sizeLabelText(lab, t) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, r) in b.sizeTable.rows" :key="r">
                  <td class="rs__rowlab">{{ row.label }}</td>
                  <td v-for="(v, k) in row.values" :key="k" :class="{ 'rs__col--on': sizeIndex === k }">{{ v }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- liste complète d'abréviations -->
          <dl v-if="b.abbrFull" class="rs__abbr">
            <template v-for="([k, v]) in reference.abbrFull" :key="k">
              <dt>{{ k }}</dt>
              <dd>{{ v }}</dd>
            </template>
          </dl>

          <a v-if="b.yt" class="rs__yt" :href="b.yt.url" target="_blank" rel="noopener"><AppIcon name="play" :size="16" aria-hidden="true" /> {{ b.yt.label }}</a>
          <button v-if="b.openChart" class="rs__yt" type="button" @click="emit('open-chart')"><AppIcon name="chart" :size="17" /> {{ $t('reader.chart.open') }}</button>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.rs-scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(58, 46, 40, 0.42);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--motion-base), visibility var(--motion-base);
}
.rs-scrim--on {
  opacity: 1;
  visibility: visible;
}
.rs {
  position: fixed;
  z-index: 51;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0 auto;
  max-width: 480px;
  background: var(--bg);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--e-3);
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  transform: translateY(100%);
  transition: transform var(--motion-base);
  padding-bottom: var(--sa-bottom);
}
.rs--on {
  transform: translateY(0);
}
.rs__grip {
  width: 44px;
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--ink-25);
  margin: var(--sp-3) auto var(--sp-2);
  flex: none;
}
.rs__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-4) var(--sp-2);
}
.rs__head h2 {
  font-size: 18px;
}
.rs__close {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--clay-sm);
  font-size: 18px;
}
.rs__tabs {
  display: flex;
  gap: var(--sp-2);
  padding: 0 var(--sp-4) var(--sp-3);
  overflow-x: auto;
  flex: none;
}
.rs__tab {
  flex: none;
  padding: 8px 14px;
  border-radius: var(--r-pill);
  background: var(--surface);
  box-shadow: var(--clay-sm);
  border: 1px solid var(--line);
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-70);
}
.rs__tab--on {
  background: var(--brand);
  color: var(--on-accent);
  border-color: transparent;
}
.rs__scroll {
  overflow-y: auto;
  padding: 0 var(--sp-4) var(--sp-6);
  -webkit-overflow-scrolling: touch;
}
.rs__block {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--clay-sm);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
}
.rs__block h3 {
  font-size: 15px;
  margin: 0 0 var(--sp-1);
}
.rs__block p {
  margin: var(--sp-1) 0;
  font-size: 14px;
  /* les longues séries de valeurs par taille (« 300 (300) 350 (350)… ») ne
     doivent jamais déborder du panneau, même à 360 px */
  overflow-wrap: anywhere;
}
.rs__muted {
  color: var(--ink-70);
  font-size: 13px;
}
.rs__persize {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.rs__psval {
  color: var(--sage-deep);
  font-weight: 700;
  overflow-wrap: anywhere;
}
.rs__yt {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--sp-2);
  padding: 9px 14px;
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: var(--clay-sm);
  border: 1px solid var(--line);
  font-weight: 700;
  font-size: 13.5px;
  color: var(--brand-deep);
  text-decoration: none;
}
.rs__tablewrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.rs__sizes {
  width: auto;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: var(--sp-2);
}
.rs__sizes th,
.rs__sizes td {
  padding: 8px 6px;
  text-align: center;
  border-bottom: 1px solid var(--line-soft);
}
.rs__rowlab {
  text-align: left !important;
  font-weight: 700;
  color: var(--ink-55);
  white-space: nowrap;
}
.rs__col--on {
  background: var(--sage-tile-bg);
  color: var(--sage-deep);
}
.rs__abbr {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px var(--sp-3);
}
.rs__abbr dt {
  font-weight: 800;
  color: var(--brand-deep);
  white-space: nowrap;
}
.rs__abbr dd {
  margin: 0;
  color: var(--ink-70);
  font-size: 13.5px;
}
</style>

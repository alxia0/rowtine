<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ThumbImage from '@/components/ThumbImage.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import { formatLength, formatWeight } from '@/utils/units'
import { parseDecimal } from '@/utils/decimal'
import { coverPhotoOf } from '@/utils/yarn-photos'
import { ENGAGEMENTS, LABEL_ICONS, orderedLabels } from '@/constants/yarn-labels'

const props = defineProps({
  yarn: { type: Object, required: true },
  usage: { type: Object, required: true },
})
const emit = defineEmits(['view'])
const { t, locale } = useI18n()
const settings = useSettingsStore()

function weightLabel(w) {
  return w ? t(`yarn.weights.${w}`) : ''
}
// Métrage d'UNE pelote (yarn.lengthM) : profil 'detail', jamais de bascule km — un
// écheveau ne se mesure pas en kilomètres.
const lengthText = computed(() =>
  props.yarn.lengthM
    ? formatLength(props.yarn.lengthM, { locale: locale.value, system: settings.unitSystem, profile: 'detail' })
    : null,
)
const weightText = computed(() => {
  const total = (Number(props.yarn.quantity) || 0) * (parseDecimal(props.yarn.grams) || 0)
  // Cumul du lot, pas poids unitaire : profil 'total', donc bascule autorisée en kg / lb.
  return total ? formatWeight(total, { locale: locale.value, system: settings.unitSystem, profile: 'total' }) : null
})
// Seuls les quatre engagements ont une icône (LABEL_ICONS) : les certifications ne
// remontent jamais dans la carte, quatre sigles au trait à 16 px seraient indiscernables.
// Ordre canonique (YARN_LABELS) via orderedLabels, même helper que l'export tableur et la
// fiche détaillée (revue finale, correction 1, 06/08/2026) — les engagements arrivent
// toujours en tête de YARN_LABELS, le filtre ENGAGEMENTS ne fait donc que restreindre le
// sous-ensemble affiché ici, pas son ordre.
const engagements = computed(() => {
  const l = orderedLabels(props.yarn?.labels)
  return l.filter((k) => ENGAGEMENTS.includes(k))
})
// Même calcul que `usageLabel` dans YarnDetailView.vue (fiche détaillée) : le
// détail « X/Y » ne s'affiche que pour un usage partiel, jamais pour un stock libre
// ou entièrement consommé.
const usageDetail = computed(() =>
  props.usage.state !== 'free' && props.usage.used < props.usage.total
    ? ` · ${props.usage.used}/${props.usage.total}`
    : '',
)
</script>

<template>
  <div class="ycard">
    <ThumbImage class="ycard__thumb" :src="coverPhotoOf(yarn)" kind="yarn" :color="yarn.color" :seed="yarn.colorName || yarn.brand" :alt="`${yarn.brand} ${yarn.colorName}`" />
    <button type="button" class="ycard__view" :aria-label="t('yarn.viewLabel')" @click="emit('view', yarn)">
      <div class="ycard__top">
        <span class="ycard__name">{{ yarn.brand || '—' }}<template v-if="yarn.model"> · {{ yarn.model }}</template><template v-if="yarn.colorName"> · {{ yarn.colorName }}</template></span>
        <!-- Sur la ligne du nom, pas sa propre ligne : la vue grille qui justifiait une
             ligne toujours rendue (pour ne pas faire sautiller la grille) a disparu avec
             le tiroir/kebab de liste (refonte 22/09) ; le titre se tronque au besoin. -->
        <div v-if="engagements.length" class="ycard__labels">
          <AppIcon v-for="k in engagements" :key="k" :name="LABEL_ICONS[k]" :size="16" :label="t(`yarn.labels.${k}`)" />
        </div>
      </div>
      <div class="ycard__meta">
        <span v-if="yarn.weight" class="tag">{{ weightLabel(yarn.weight) }}</span>
        <span v-if="yarn.colorType && yarn.colorType !== 'uni'" class="tag">{{ t(`yarn.colorTypes.${yarn.colorType}`) }}</span>
        <span>×{{ yarn.quantity }}<template v-if="lengthText"> · {{ lengthText.text }} {{ t(lengthText.unitKey) }}</template><template v-if="weightText"> · {{ weightText.text }} {{ t(weightText.unitKey) }}</template></span>
        <span class="tag" :class="`tag--${usage.state}`">{{ t(`yarn.usage.${usage.state}`) }}{{ usageDetail }}</span>
      </div>
    </button>
  </div>
</template>

<style scoped>
.ycard { position: relative; display: flex; align-items: center; gap: var(--sp-3); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); box-shadow: var(--clay-sm); }
.ycard__thumb { width: 46px; height: 46px; }
.ycard__view { flex: 1; min-width: 0; border: none; background: transparent; text-align: left; padding: 0; cursor: pointer; }
.ycard__view:focus-visible { outline: 2px solid var(--brand-deep); outline-offset: 2px; border-radius: var(--r-sm); }
.ycard__top { display: flex; align-items: center; gap: var(--sp-2); }
/* `min-width: 0` : sans lui, un flex item ne rétrécit jamais sous son contenu — le nom
   pousserait les icônes d'engagement hors de la carte au lieu de se tronquer.
   `flex: 0 1 auto` (pas `flex: 1`) : le nom ne s'étire plus pour occuper tout l'espace
   restant, donc les icônes d'engagement ne sont plus repoussées à l'extrémité droite de
   la carte — elles collent directement après le titre (retour Julien, 22/09). Le nom
   continue de se tronquer en premier (flex-shrink hérité de `auto` = 1) si la carte est
   trop étroite pour les deux, les icônes elles ne rétrécissent jamais (`flex-shrink: 0`
   sur .ycard__labels, inchangé). */
.ycard__name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--ink); }
.ycard__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin-top: var(--sp-2); color: var(--ink-55); font-size: 13px; }
.ycard__labels { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--sp-2); flex-shrink: 0; color: var(--ink-55); }
.tag { font-size: 11px; font-weight: 700; border-radius: var(--r-pill); padding: 2px 9px; border: 1px solid var(--line); color: var(--ink-55); }
/* --mustard en texte sur --tile = 1,83:1, illisible ; --mustard-deep (5,60:1 en clair,
   déjà utilisé par STATUS_META.pause) passe en gardant la famille ambre. En sombre
   --mustard-deep vaut --mustard (déjà conforme) : zéro changement visuel là. */
.tag--reserved { color: var(--mustard-deep); }
.tag--free { color: var(--sage); }
.tag--used { color: var(--sage-deep); }
.tag--usedPartial { color: var(--ink-55); }
</style>

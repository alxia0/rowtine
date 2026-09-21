<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDismissMenu } from '@/composables/useDismissMenu'
import ThumbImage from '@/components/ThumbImage.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import { formatLength, formatWeight } from '@/utils/units'
import { parseDecimal } from '@/utils/decimal'
import { ENGAGEMENTS, LABEL_ICONS, orderedLabels } from '@/constants/yarn-labels'

const props = defineProps({
  yarn: { type: Object, required: true },
  usage: { type: Object, required: true },
})
const emit = defineEmits(['view', 'edit', 'duplicate', 'delete'])
const { t, locale } = useI18n()
const settings = useSettingsStore()
const { open: menuOpen, triggerRef, menuRef } = useDismissMenu()

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
// Toujours l'objet laine complet : openDetail/openEdit/openDuplicate en ont besoin,
// c'est l'appelant (StashView) qui extrait .id pour remove(id).
function act(name) {
  menuOpen.value = false
  emit(name, props.yarn)
}
// Même calcul que `usageLabel` dans YarnDetailDialog.vue (fiche détaillée) : le
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
    <ThumbImage class="ycard__thumb" :src="yarn.photo" kind="yarn" :color="yarn.color" :seed="yarn.colorName || yarn.brand" :alt="`${yarn.brand} ${yarn.colorName}`" />
    <button type="button" class="ycard__view" :aria-label="t('yarn.viewLabel')" @click="emit('view', yarn)">
      <div class="ycard__top">
        <span class="ycard__name">{{ yarn.brand || '—' }}<template v-if="yarn.model"> · {{ yarn.model }}</template><template v-if="yarn.colorName"> · {{ yarn.colorName }}</template></span>
      </div>
      <div class="ycard__meta">
        <span v-if="yarn.weight" class="tag">{{ weightLabel(yarn.weight) }}</span>
        <span v-if="yarn.colorType && yarn.colorType !== 'uni'" class="tag">{{ t(`yarn.colorTypes.${yarn.colorType}`) }}</span>
        <span>×{{ yarn.quantity }}<template v-if="lengthText"> · {{ lengthText.text }} {{ t(lengthText.unitKey) }}</template><template v-if="weightText"> · {{ weightText.text }} {{ t(weightText.unitKey) }}</template></span>
        <span class="tag" :class="`tag--${usage.state}`">{{ t(`yarn.usage.${usage.state}`) }}{{ usageDetail }}</span>
      </div>
      <!-- Ligne TOUJOURS rendue, même sans engagement : en vue grille les cartes sont
           côte à côte, une ligne qui n'apparaît que parfois ferait sautiller la grille. -->
      <div class="ycard__labels">
        <AppIcon v-for="k in engagements" :key="k" :name="LABEL_ICONS[k]" :size="16" :label="t(`yarn.labels.${k}`)" />
      </div>
    </button>
    <button ref="triggerRef" class="ycard__kebab" :aria-label="t('common.actions')" aria-haspopup="true" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><AppIcon name="kebab" :size="20" /></button>

    <Transition name="menu">
      <nav v-if="menuOpen" ref="menuRef" class="menu">
        <button class="menu__item" @click="act('edit')">{{ t('common.edit') }}</button>
        <button class="menu__item" @click="act('duplicate')">{{ t('common.duplicate') }}</button>
        <button class="menu__item menu__item--danger" @click="act('delete')">{{ t('common.delete') }}</button>
      </nav>
    </Transition>
    <div v-if="menuOpen" class="menu__scrim" @click="menuOpen = false"></div>
  </div>
</template>

<style scoped>
.ycard { position: relative; display: flex; align-items: center; gap: var(--sp-3); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); box-shadow: var(--clay-sm); }
.ycard__thumb { width: 46px; height: 46px; }
.ycard__view { flex: 1; min-width: 0; border: none; background: transparent; text-align: left; padding: 0; cursor: pointer; }
.ycard__view:focus-visible { outline: 2px solid var(--brand-deep); outline-offset: 2px; border-radius: var(--r-sm); }
.ycard__top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
.ycard__name { font-weight: 600; color: var(--ink); }
.ycard__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin-top: var(--sp-2); color: var(--ink-55); font-size: 13px; }
/* `min-height` et non `height` : la ligne garde sa place quand elle est vide, sans écraser
   les icônes si le thème augmente leur taille. */
.ycard__labels { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--sp-2); min-height: 20px; margin-top: var(--sp-2); color: var(--ink-55); }
.tag { font-size: 11px; font-weight: 700; border-radius: var(--r-pill); padding: 2px 9px; border: 1px solid var(--line); color: var(--ink-55); }
/* --mustard en texte sur --tile = 1,83:1, illisible ; --mustard-deep (5,60:1 en clair,
   déjà utilisé par STATUS_META.pause) passe en gardant la famille ambre. En sombre
   --mustard-deep vaut --mustard (déjà conforme) : zéro changement visuel là. */
.tag--reserved { color: var(--mustard-deep); }
.tag--free { color: var(--sage); }
.tag--used { color: var(--sage-deep); }
.tag--usedPartial { color: var(--ink-55); }
.ycard__kebab { flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--ink-55); min-width: 44px; min-height: 44px; }
.menu { position: absolute; top: 44px; right: var(--sp-2); z-index: 60; background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--e-3); padding: var(--sp-2); min-width: 180px; display: flex; flex-direction: column; }
.menu__item { text-align: left; border: none; background: transparent; color: var(--ink); font-weight: 600; padding: 11px 13px; border-radius: var(--r-sm); }
.menu__item--danger { color: var(--danger); }
.menu__scrim { position: fixed; inset: 0; z-index: 50; }
.menu-enter-active, .menu-leave-active { transition: all var(--motion-fast); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-6px); }
</style>

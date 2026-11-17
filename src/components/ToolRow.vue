<script setup>
// Ligne compacte de la liste « Mes outils » (spec interne,
// §4) : ligne 1 marque et gamme puis taille, ligne 2 type, longueur, matière, ×n puis l'état,
// toujours dit. Chaque ligne tient sur une ligne, coupée par une ellipse (écran de 360 px).
// Jamais de photo ici (anti-objectif de la spec) : la photo vit sur la fiche détail.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { TOOL_TYPES } from '@/constants/tools'
import { toolSizeText, cableLabel, cents } from '@/utils/tool-list'
import { formatDecimalText } from '@/utils/decimal'

const props = defineProps({
  tool: { type: Object, required: true },
  // Taille sous laquelle la ligne est rangée (regroupement « Par taille ») : un kit y
  // montre CETTE taille, pas tout son intervalle.
  sizeMm: { type: Number, default: null },
  viaKit: { type: Boolean, default: false },
  // Nom du projet en cours qui utilise l'outil (`inUseProjectName`) : « en cours : <nom> » à la
  // place de « disponible ». `null` : aucun projet en cours ; '' : projet sans nom.
  inUseBy: { type: String, default: null },
  // Kit : tailles prises par les projets en cours (`kitTakenLive`), [{ sizeMm, projectName }].
  // Ligne 2 : « en cours : 4 mm (Bonnet), 5 mm (Pull) ». Jamais de câble ici (décision du 16/11).
  kitTaken: { type: Array, default: () => [] },
  // Prise d'un kit (tuile de la fiche projet) : { sizeMm, cableCm, cableJoin } ; titre « marque · 4 mm + 80 cm ».
  pick: { type: Object, default: null },
  // 'span' : simple étiquette, non interactive (la feuille de sélection la place dans le
  // libellé d'une case à cocher, où un bouton imbriqué serait un contrôle dans un contrôle).
  as: { type: String, default: 'button' },
})
const emit = defineEmits(['open'])
const { t, locale } = useI18n()

const def = computed(() => TOOL_TYPES[props.tool.type] || TOOL_TYPES.other)
const num = (n) => formatDecimalText(String(n), locale.value)
const typeLabel = computed(() => t(`tools.types.${props.tool.type}`))
const lengthText = computed(() => {
  const cm = props.tool.lengthCm
  if (cm != null && cm !== '') return t('tools.lengthCm', { cm: num(cm) })
  return props.tool.lengthKind ? t(`tools.lengthKinds.${props.tool.lengthKind}`) : ''
})

const brandLine = computed(() => [props.tool.brand, props.tool.line].map((s) => String(s || '').trim()).filter(Boolean).join(' '))

const title = computed(() => {
  if (props.pick) {
    const size = t('tools.sizeMm', { mm: num(props.pick.sizeMm) })
    const text = props.pick.cableCm == null ? size : t('tools.kitPick', { size, cable: cableLabel({ cm: props.pick.cableCm, join: props.pick.cableJoin ?? null }, t, num) })
    return [brandLine.value, text].filter(Boolean).join(' · ')
  }
  // Un câble n'a pas de taille : sa longueur le nomme. Sinon, le type.
  const size = toolSizeText(props.tool, t, num, props.sizeMm) || (props.tool.type === 'cable' && lengthText.value) || typeLabel.value
  return [brandLine.value, size].filter(Boolean).join(' · ')
})

const details = computed(() => {
  if (props.viaKit) return t(props.tool.type === 'hookKit' ? 'tools.fromHookKit' : 'tools.fromKit', { name: brandLine.value || typeLabel.value })
  // `typesShort` reste distinct de `types` : les textes diffèrent (fr « circ. » / « Circulaires »,
  // « DP », « flex. ») et la liste a besoin de mots courts, donc pas de fusion.
  const typePart = [t(`tools.typesShort.${props.tool.type}`), props.tool.type === 'cable' ? '' : lengthText.value]
    .filter(Boolean)
    .join(' ')
  const material = props.tool.material ? t(`tools.materials.${props.tool.material}`) : ''
  const qty = Number(props.tool.quantity)
  const count = qty > 1 ? t('tools.countTimes', { n: qty }) : ''
  return [typePart, material, count].filter(Boolean).join(' · ')
})

// Toujours un état. L'état réel prime : une aiguille prêtée reste « prêtée », même liée à un
// projet en cours. Libellés en minuscules (`statusesInline`) : ils suivent un « · » en milieu de ligne.
// Un kit range ses tailles prises après un éventuel lien ancien au kit entier (projet sans
// taille) ; rangé sous une taille (ou ligne d'une prise), il ne dit que celle-là.
const takenParts = computed(() => {
  const only = props.pick?.sizeMm ?? props.sizeMm
  return props.kitTaken
    .filter((s) => only == null || cents(s.sizeMm) === cents(only))
    .map((s) => {
      const size = t('tools.sizeMm', { mm: num(s.sizeMm) })
      return s.projectName ? t('tools.kitTakenSize', { size, name: s.projectName }) : size
    })
})
const status = computed(() => {
  const s = props.tool.status
  if (s && s !== 'available') return t(`tools.statusesInline.${s}`)
  const parts = [props.inUseBy, ...takenParts.value].filter(Boolean)
  if (parts.length) return t('tools.inUseBy', { name: parts.join(', ') })
  if (props.inUseBy != null) return t('tools.inUse')
  return t('tools.statusesInline.available')
})
const isButton = computed(() => props.as === 'button')
function onClick() {
  if (isButton.value) emit('open', props.tool)
}
</script>

<template>
  <component :is="as" :type="isButton ? 'button' : undefined" class="trow" :class="{ 'trow--static': !isButton }" @click="onClick">
    <span class="trow__icon"><AppIcon :name="def.icon" :size="24" /></span>
    <span class="trow__body">
      <span class="trow__title">{{ title }}</span>
      <!-- Le résumé cède la place ; l'état garde la sienne (voir .trow__status). -->
      <span class="trow__sub">
        <span v-if="details" class="trow__meta">{{ details }}</span><span v-if="details" class="trow__sep">{{ ' · ' }}</span><span class="trow__status">{{ status }}</span>
      </span>
    </span>
  </component>
</template>

<style scoped>
/* Mêmes surfaces que la carte de laine (YarnCard.vue) : tuile, filet, rayon moyen, ombre
   « clay ». Ligne entière cliquable, au moins 48 px de haut (cible tactile). */
.trow { display: flex; align-items: center; gap: var(--sp-3); width: 100%; min-height: 48px; background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); box-shadow: var(--clay-sm); text-align: left; color: var(--ink); font: inherit; cursor: pointer; }
.trow--static { cursor: inherit; }
.trow:focus-visible { outline: 2px solid var(--brand-deep); outline-offset: 2px; }
.trow__icon { display: inline-flex; flex-shrink: 0; color: var(--brand-deep); }
.trow__body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.trow__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.trow__sub { display: flex; min-width: 0; margin-top: var(--sp-1); color: var(--ink-55); font-size: 13px; white-space: nowrap; }
.trow__meta { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.trow__sep { flex-shrink: 0; white-space: pre; }
/* L'état ne rétrécit pas : c'est le résumé qui cède. Un nom de projet très long s'arrête à 60 %
   de la ligne, coupé à son tour par une ellipse. */
.trow__status { flex: 0 0 auto; max-width: 60%; overflow: hidden; text-overflow: ellipsis; }
</style>

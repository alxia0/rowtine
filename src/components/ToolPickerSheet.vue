<script setup>
// Feuille « Choisir des outils » de la fiche projet (spec interne
// phase2-design.md, lot 4) : d'abord les outils aux tailles du projet, puis les autres, chacun
// derrière une case à cocher. Rien n'est écrit avant « Enregistrer » : le parent reçoit `save`
// avec `{ toolIds, kitPicks }`. Un kit n'a jamais de case à lui (spec interne
// tailles-prises-design.md) : il se déplie en ses tailles, et une taille cochée d'un kit à câbles
// propose un câble. Seul un lien ancien au kit entier garde une case, pour être décoché. Fermeture légère, idiome de YarnSortDialog.vue : voile, Échap, bouton
// Fermer ; le geste retour passe par le parent (handleBackPressed de la fiche projet).
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import ToolRow from '@/components/ToolRow.vue'
import { pickerOrder, inUseProjectName, kitTakenLive, kitPickerSizes, kitPickerCables, pruneKitPicks } from '@/utils/tool-links'
import { cents, cableLabel, cableValue, parseCableValue } from '@/utils/tool-list'
import { TOOL_TYPES } from '@/constants/tools'
import { formatDecimalText } from '@/utils/decimal'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

const props = defineProps({
  open: { type: Boolean, default: false },
  tools: { type: Array, default: () => [] },
  // Tailles du projet en mm (déjà lues par requestedSizeMm).
  requestedMm: { type: Array, default: () => [] },
  // Ids liés à l'ouverture.
  selected: { type: Array, default: () => [] },
  // Technique du projet : seuls ses outils (aiguilles et kits, ou crochets) passent en tête.
  technique: { type: String, default: 'knitting' },
  // Tous les projets : chaque ligne dit, comme dans « Mes outils », le projet en cours qui l'utilise.
  projects: { type: Array, default: () => [] },
  // Prises de kit à l'ouverture (`kitPicks` du projet) et id du projet (ses propres prises ne
  // sont pas « prises par un autre projet »).
  selectedPicks: { type: Array, default: () => [] },
  projectId: { type: Number, default: null },
})
const emit = defineEmits(['close', 'save'])
const { t, locale } = useI18n()
const num = (n) => formatDecimalText(String(n), locale.value)
const isKit = (tool) => TOOL_TYPES[tool.type]?.size === 'kit'

useDialogFocusReturn(() => props.open)

// Brouillon des cases : repris des liens actuels à chaque ouverture. Le focus entre dans la
// feuille sur le bouton Fermer, comme ConfirmDialog (sans quoi il reste sur le déclencheur, sous le voile).
const checked = ref(new Set())
// Prises cochées : clé « kit|taille au centième » -> { toolId, sizeMm, cableCm, cableJoin }.
const picks = ref(new Map())
// Kits liés en entier à l'ouverture (lien ancien) : seuls à garder une case « kit entier ».
const legacyKits = ref(new Set())
const pickKey = (toolId, mm) => `${toolId}|${cents(Number(mm))}`
const closeBtn = ref(null)
watch(
  () => props.open,
  async (v) => {
    if (!v) return
    checked.value = new Set(props.selected.map(Number))
    // Seules les prises encore valables des kits affichés sont cochées ; une prise périmée (taille
    // ou câble retiré du kit) part à l'enregistrement, celles d'un kit en corbeille passent par `hiddenPicks`.
    picks.value = new Map(pruneKitPicks(props.selectedPicks, props.tools).map((p) => [pickKey(p.toolId, p.sizeMm), p]))
    const kitIds = new Set(props.tools.filter(isKit).map((tool) => tool.id))
    legacyKits.value = new Set([...checked.value].filter((id) => kitIds.has(id)))
    await nextTick()
    closeBtn.value?.focus()
  },
  { immediate: true },
)
function toggle(id, on) {
  const next = new Set(checked.value)
  if (on) next.add(id)
  else next.delete(id)
  checked.value = next
}
// Cocher une taille d'un kit lié en entier remplace ce lien ancien par la taille.
function togglePick(tool, mm, on) {
  const next = new Map(picks.value)
  const key = pickKey(tool.id, mm)
  if (on) {
    next.set(key, { toolId: tool.id, sizeMm: mm, cableCm: null, cableJoin: null })
    if (checked.value.has(tool.id)) toggle(tool.id, false)
  } else next.delete(key)
  picks.value = next
}
function setCable(tool, mm, value) {
  const key = pickKey(tool.id, mm)
  const pick = picks.value.get(key)
  if (!pick) return
  const cable = parseCableValue(value)
  picks.value = new Map(picks.value).set(key, { ...pick, cableCm: cable ? cable.cm : null, cableJoin: cable ? cable.join : null })
}
const isPicked = (tool, mm) => picks.value.has(pickKey(tool.id, mm))
const cableOf = (tool, mm) => {
  const pick = picks.value.get(pickKey(tool.id, mm))
  return pick?.cableCm == null ? '' : cableValue({ cm: pick.cableCm, join: pick.cableJoin ?? null })
}
const sizeLabel = (mm) => t('tools.sizeMm', { mm: num(mm) })
const takenText = (names) => t('tools.picker.takenBy', { name: names.join(', ') })

const groups = computed(() => {
  const { matching, others } = pickerOrder(props.tools, props.requestedMm, props.technique)
  const kitOf = (tool) =>
    isKit(tool)
      ? {
          sizes: kitPickerSizes(tool, props.requestedMm, props.projects, props.projectId),
          cables: kitPickerCables(tool, props.projects, props.projectId).map(({ cm, join, value, takenBy }) => {
            const label = cableLabel({ cm, join }, t, num)
            return { value, text: takenBy.length ? `${label} (${takenText(takenBy)})` : label }
          }),
          taken: kitTakenLive(tool, props.projects),
        }
      : null
  return [
    { key: 'matching', items: matching },
    { key: 'others', items: others },
  ]
    .filter((g) => g.items.length)
    .map((g) => ({ ...g, items: g.items.map((tool) => ({ tool, kit: kitOf(tool) })) }))
})

// Ordre d'enregistrement : celui de la liste affichée, puis les liens (et prises) à des outils
// absents de la liste (en corbeille), qui n'ont pas de case et doivent survivre à l'enregistrement.
// Un kit ne donne son id que par la case d'un lien ancien.
function save() {
  const items = groups.value.flatMap((g) => g.items)
  const ids = items.filter(({ tool }) => checked.value.has(tool.id) && (!isKit(tool) || legacyKits.value.has(tool.id))).map(({ tool }) => tool.id)
  const kitPicks = items.flatMap(({ tool, kit }) => (kit ? kit.sizes.filter((s) => isPicked(tool, s.sizeMm)).map((s) => picks.value.get(pickKey(tool.id, s.sizeMm))) : []))
  const shown = new Set(props.tools.map((tool) => tool.id))
  const hidden = props.selected.map(Number).filter((id) => !shown.has(id))
  const hiddenPicks = props.selectedPicks.filter((p) => !shown.has(Number(p.toolId)))
  emit('save', { toolIds: [...ids, ...hidden], kitPicks: [...kitPicks, ...hiddenPicks] })
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
watch(
  () => props.open,
  (v) => {
    if (v) document.addEventListener('keydown', onKey)
    else document.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="tps">
      <div class="tps__scrim" @click="emit('close')"></div>
      <div class="tps__card" role="dialog" aria-modal="true" aria-labelledby="tps-title" data-test="tool-picker" @keydown="trapTabFocus">
        <header class="tps__head">
          <h2 id="tps-title" class="tps__title">{{ t('project.chooseTools') }}</h2>
          <button ref="closeBtn" class="tps__close" type="button" :aria-label="t('common.close')" @click="emit('close')">
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <div class="tps__body">
          <section v-for="g in groups" :key="g.key" class="tps__group" data-test="tool-picker-group">
            <h3 class="tps__h3">{{ t(`tools.picker.${g.key}`) }}</h3>
            <template v-for="{ tool, kit } in g.items" :key="tool.id">
              <!-- Un kit : sa ligne, puis une case par taille ; jamais de case pour le kit entier,
                   sauf lien ancien à décocher. -->
              <div v-if="kit" class="tps__row tps__kit" data-test="tool-picker-kit">
                <ToolRow :tool="tool" :in-use-by="inUseProjectName(tool.id, projects)" :kit-taken="kit.taken" as="span" />
                <AppCheckbox
                  v-if="legacyKits.has(tool.id)"
                  class="tps__sub"
                  data-test="tool-picker-whole-kit"
                  :model-value="checked.has(tool.id)"
                  @update:model-value="(on) => toggle(tool.id, on)"
                >{{ t('tools.picker.wholeKit') }}</AppCheckbox>
                <div v-for="s in kit.sizes" :key="s.sizeMm" class="tps__sub" data-test="tool-picker-kit-size" :data-value="String(s.sizeMm)">
                  <AppCheckbox :model-value="isPicked(tool, s.sizeMm)" @update:model-value="(on) => togglePick(tool, s.sizeMm, on)">
                    <span class="tps__size">{{ sizeLabel(s.sizeMm) }}</span>
                    <span v-if="s.takenBy.length" class="tps__taken">{{ takenText(s.takenBy) }}</span>
                  </AppCheckbox>
                  <label v-if="isPicked(tool, s.sizeMm) && kit.cables.length" class="tps__cable">
                    <span class="tps__cable-k">{{ t('tools.picker.cable') }}</span>
                    <select class="input tps__select" :aria-label="t('tools.picker.cableFor', { size: sizeLabel(s.sizeMm) })" :value="cableOf(tool, s.sizeMm)" @change="setCable(tool, s.sizeMm, $event.target.value)">
                      <option value="">{{ t('tools.picker.noCable') }}</option>
                      <option v-for="c in kit.cables" :key="c.value" :value="c.value">{{ c.text }}</option>
                    </select>
                  </label>
                </div>
              </div>
              <AppCheckbox
                v-else
                class="tps__row"
                :model-value="checked.has(tool.id)"
                @update:model-value="(on) => toggle(tool.id, on)"
              >
                <ToolRow :tool="tool" :in-use-by="inUseProjectName(tool.id, projects)" as="span" />
              </AppCheckbox>
            </template>
          </section>
        </div>
        <button class="btn btn--primary btn--block tps__save" type="button" data-test="tool-picker-save" @click="save">{{ t('common.save') }}</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Idiome YarnSortDialog.vue : feuille du bas, voile, carte aux tokens du projet, même rang (80). */
.tps { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
.tps__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.tps__card { position: relative; width: 100%; max-width: 480px; max-height: 82vh; display: flex; flex-direction: column; background: var(--bg); border-radius: var(--r-lg) var(--r-lg) 0 0; box-shadow: var(--e-3); padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom)); }
.tps__head { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
.tps__title { flex: 1; font-family: var(--font-display); font-size: 20px; margin: 0; }
.tps__close { flex-shrink: 0; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); background: var(--tile); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-sm); }
.tps__body { overflow-y: auto; min-height: 0; margin-top: var(--sp-3); }
.tps__group + .tps__group { margin-top: var(--sp-4); }
.tps__h3 { font-size: 13px; font-weight: 700; color: var(--ink-55); margin: 0 0 var(--sp-2); }
.tps__row + .tps__row { margin-top: var(--sp-2); }
/* La ligne d'outil occupe toute la place restante du libellé de la case. */
.tps__row :deep(.chk__label) { flex: 1; min-width: 0; }
/* Kit : ses tailles en retrait sous sa ligne ; la mention « pris » cède la place (ellipse). */
.tps__sub { margin-left: var(--sp-4); }
.tps__sub :deep(.chk__label) { display: flex; align-items: baseline; gap: var(--sp-2); flex: 1; min-width: 0; }
.tps__size { flex-shrink: 0; font-weight: 600; }
.tps__taken { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-55); font-size: 13px; }
.tps__cable { display: flex; align-items: center; gap: var(--sp-2); margin: var(--sp-1) 0 var(--sp-2) calc(var(--sp-4) + var(--sp-2)); min-width: 0; }
.tps__cable-k { flex-shrink: 0; font-size: 13px; color: var(--ink-55); }
.tps__select { flex: 1; min-width: 0; min-height: 44px; }
.tps__save { flex-shrink: 0; margin-top: var(--sp-3); }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

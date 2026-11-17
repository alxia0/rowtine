<script setup>
// Contenu d'un kit interchangeable (spec interne, « Kit
// interchangeable ») : tailles de tricot présentes et câbles présents, cochés en pastilles qui
// passent à la ligne (jamais en tableau, illisible sur téléphone). Un câble est un objet
// { cm, join } (diamètre de la fixation : 's' | 'l' | 'mini' | null, spec 2026-11-17) ; un choix à
// segments fixe le diamètre que les pastilles lisent et modifient, une ligne de résumé dit tout le
// contenu. Entrée : objets ou nombres anciens (lus par `cablesOf`). Émet toujours un tableau trié ;
// les tailles sont sans doublon, les câbles gardent un élément par exemplaire.
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppIcon from '@/components/AppIcon.vue'
import { CABLE_LENGTHS_CM, CABLE_JOINS } from '@/constants/tools'
import { sizesFor, sizeEquivalents } from '@/constants/needle-sizes'
import { formatDecimalText } from '@/utils/decimal'
import { sizeTemplateKey, cablesOf, cableSort, cableLabel, cableCountLabel } from '@/utils/tool-list'

const props = defineProps({
  sizes: { type: Array, default: () => [] },
  cables: { type: Array, default: () => [] },
  // Échelle des tailles : tricot (kit d'aiguilles) ou crochet (kit de crochets).
  scale: { type: String, default: 'knitting', validator: (v) => ['knitting', 'hook'].includes(v) },
  // Matière du kit : l'acier ajoute les crochets fins (sous 2 mm) et leur numéro acier.
  material: { type: String, default: '' },
  // Câbles du kit : masqués pour un kit de crochets qui n'est pas tunisien.
  showCables: { type: Boolean, default: true },
})
const emit = defineEmits(['update:sizes', 'update:cables'])
const { t, locale } = useI18n()

// Sous 2 mm, ce sont des aiguilles à dentelle : aucun kit interchangeable ne descend si bas.
// Les crochets fins n'existent qu'en acier : ils ne sont proposés que pour cette matière.
const sizeChoices = computed(() => sizesFor(props.scale).filter((mm) => mm >= 2 || (props.scale === 'hook' && props.material === 'steel')))

function sizeLabel(mm) {
  const text = formatDecimalText(String(mm), locale.value)
  const { us } = sizeEquivalents(mm, props.scale, props.material)
  if (us == null) return t('tools.sizeMm', { mm: text })
  return t(sizeTemplateKey(props.scale === 'hook' ? 'standard' : 'interchangeable', us, { option: true }), { mm: text, us })
}

const sizeSet = computed(() => new Set(props.sizes.map(Number)))
// Câbles du kit lus sous forme d'objets, quelle que soit la forme reçue.
const allCables = computed(() => cablesOf({ kitCables: props.cables }))
// Diamètre que les pastilles lisent et modifient : null = « Non précisé » (choix par défaut).
const join = ref(null)
// Tant que l'utilisateur n'a pas choisi de segment, on ouvre sur le diamètre du premier câble
// (les S d'un kit existant se voient tout de suite) ; les câbles d'une fiche rouverte arrivent
// après le montage (liste vide puis pleine), d'où la surveillance.
let joinChosen = false
watch(
  allCables,
  (list, before) => {
    if (joinChosen || !list.length || before?.length) return
    join.value = list[0].join
  },
  { immediate: true },
)
const JOIN_CHOICES = [null, ...CABLE_JOINS]
const joinLabel = (j) => (j == null ? t('tools.form.unset') : cableLabel({ cm: '', join: j }, () => '').trim())
// Nombre d'exemplaires par longueur, pour le diamètre choisi ; absente = pas cochée.
const cableCount = computed(() => {
  const counts = new Map()
  for (const c of allCables.value) if (c.join === join.value) counts.set(c.cm, (counts.get(c.cm) || 0) + 1)
  return counts
})
// Le contenu entier, groupé par couple (longueur, diamètre) : « 20 cm S ×2, 80 cm L, 100 cm ».
const summary = computed(() => {
  const groups = []
  for (const c of allCables.value) {
    const last = groups[groups.length - 1]
    if (last && cableSort(last, c) === 0) last.count += 1
    else groups.push({ ...c, count: 1 })
  }
  return groups.map((g) => cableCountLabel(g, g.count, (key, p) => t(key, p))).join(', ')
})
const MAX_CABLES = 9

// Le tableau de câbles avec `count` exemplaires de `cm` au diamètre choisi (0 : décoché) ; les
// câbles des autres diamètres ne bougent pas.
function withCables(cm, count) {
  const others = allCables.value.filter((c) => !(c.cm === cm && c.join === join.value))
  return [...others, ...Array(count).fill({ cm, join: join.value })].map((c) => ({ ...c })).sort(cableSort)
}

const segs = ref(null)
function chooseJoin(j) {
  joinChosen = true
  join.value = j
}
// Boutons radio au clavier : flèches = choix voisin (avec retour à la ligne), une seule étape de tabulation.
function onSegKey(event) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
  if (!step) return
  event.preventDefault()
  const next = JOIN_CHOICES[(JOIN_CHOICES.indexOf(join.value) + step + JOIN_CHOICES.length) % JOIN_CHOICES.length]
  chooseJoin(next)
  nextTick(() => segs.value?.querySelector('[aria-checked="true"]')?.focus())
}

// Région d'annonce toujours montée (une région créée avec son texte n'est pas lue) : dit la
// longueur et le nombre d'exemplaires après chaque pas du compteur.
const announcement = ref('')
const root = ref(null)

async function stepCable(cm, delta) {
  const count = (cableCount.value.get(cm) || 0) + delta
  emit('update:cables', withCables(cm, count))
  announcement.value = count > 0 ? cableCountLabel({ cm, join: join.value }, count, (key, p) => t(key, p)) : ''
  if (count > 0) return
  // Le compteur disparaît avec la dernière décoche : le focus revient à la case de la longueur.
  await nextTick()
  root.value?.querySelector(`[data-test="kit-cable"][data-value="${cm}"] input`)?.focus()
}

function toggled(set, value, on) {
  const next = new Set(set)
  if (on) next.add(value)
  else next.delete(value)
  return [...next].sort((a, b) => a - b)
}
</script>

<template>
  <div ref="root" class="kitpick">
    <p class="kitpick__live" role="status" data-test="cable-announce">{{ announcement }}</p>
    <fieldset class="kitpick__group">
      <legend class="kitpick__title">{{ t('tools.fields.kitSizes') }}</legend>
      <div class="kitpick__pills">
        <div v-for="mm in sizeChoices" :key="mm" class="kitpick__pill" :class="{ 'kitpick__pill--on': sizeSet.has(mm) }" data-test="kit-size" :data-value="mm">
          <AppCheckbox :model-value="sizeSet.has(mm)" @update:model-value="(on) => emit('update:sizes', toggled(sizeSet, mm, on))">{{ sizeLabel(mm) }}</AppCheckbox>
        </div>
      </div>
    </fieldset>
    <fieldset v-if="showCables" class="kitpick__group">
      <legend class="kitpick__title">{{ t('tools.fields.kitCables') }}</legend>
      <p id="kitpick-join-title" class="kitpick__subtitle">{{ t('tools.fields.cableJoin') }}</p>
      <div ref="segs" class="kitpick__segs" role="radiogroup" aria-labelledby="kitpick-join-title" @keydown="onSegKey">
        <button
          v-for="j in JOIN_CHOICES"
          :key="j ?? 'none'"
          type="button"
          role="radio"
          class="kitpick__seg"
          :class="{ 'kitpick__seg--on': join === j }"
          data-test="cable-join"
          :data-value="j ?? ''"
          :aria-checked="String(join === j)"
          :tabindex="join === j ? 0 : -1"
          @click="chooseJoin(j)"
        >{{ joinLabel(j) }}</button>
      </div>
      <div class="kitpick__pills">
        <div v-for="cm in CABLE_LENGTHS_CM" :key="cm" class="kitpick__pill" :class="{ 'kitpick__pill--on': cableCount.has(cm) }" data-test="kit-cable" :data-value="cm">
          <AppCheckbox :model-value="cableCount.has(cm)" @update:model-value="(on) => emit('update:cables', withCables(cm, on ? 1 : 0))">{{ t('tools.lengthCm', { cm }) }}</AppCheckbox>
          <span v-if="cableCount.has(cm)" class="kitpick__count">
            <button type="button" class="kitpick__pm" data-test="cable-minus" :aria-label="t('tools.form.cableLess', { cm })" @click="stepCable(cm, -1)"><AppIcon name="minus" :size="16" /></button>
            <span class="kitpick__n" data-test="cable-count">{{ cableCount.get(cm) }}</span>
            <button type="button" class="kitpick__pm" data-test="cable-plus" :disabled="cableCount.get(cm) >= MAX_CABLES" :aria-label="t('tools.form.cableMore', { cm })" @click="stepCable(cm, 1)"><AppIcon name="plus" :size="16" /></button>
          </span>
        </div>
      </div>
      <p v-if="summary" class="kitpick__summary" data-test="cable-summary">{{ summary }}</p>
    </fieldset>
  </div>
</template>

<style scoped>
.kitpick { position: relative; }
.kitpick__group { border: 0; margin: 0; padding: 0; min-width: 0; }
.kitpick__title { padding: 0; margin: var(--sp-3) 0 var(--sp-1); font-size: 12.5px; font-weight: 700; color: var(--ink-55); }
.kitpick__subtitle { margin: var(--sp-1) 0; font-size: 12.5px; color: var(--ink-55); }
.kitpick__segs { display: flex; margin-bottom: var(--sp-2); border: 1px solid var(--line); border-radius: var(--r-pill); overflow: hidden; }
.kitpick__seg { flex: 1 1 0; min-height: 44px; padding: 0 var(--sp-2); border: 0; background: var(--bg); color: var(--ink); font: inherit; cursor: pointer; }
.kitpick__seg + .kitpick__seg { border-left: 1px solid var(--line); }
.kitpick__seg--on { background: var(--sage-tile-bg); color: var(--sage-deep); font-weight: 700; }
.kitpick__summary { margin: var(--sp-2) 0 0; font-size: 13px; color: var(--ink-55); }
.kitpick__pills { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.kitpick__pill { display: flex; align-items: center; gap: var(--sp-1); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 0 12px 0 8px; background: var(--bg); }
.kitpick__count { display: inline-flex; align-items: center; gap: 2px; }
.kitpick__pm { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border: 0; background: none; color: var(--ink); cursor: pointer; }
.kitpick__pm:disabled { color: var(--ink-55); cursor: default; }
.kitpick__live { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.kitpick__n { min-width: 1.2em; text-align: center; font-variant-numeric: tabular-nums; }
.kitpick__pill--on { border-color: var(--brand); }
</style>

<script setup>
// Sommaire du lecteur de patron : une rangée horizontale défilante de puces, une par
// section, TOUJOURS visible (plus de bouton dépliant, plus d'état open) — voir la même
// hauteur que l'ancien état replié (~44 px), l'écran où l'on tricote garde sa hauteur de
// contenu quel que soit le nombre de sections, et la structure coûte zéro clic.
// Chaque puce émet `navigate` avec l'id de section : la vue parente réutilise l'ancre
// existante (`?section=<id>` + scroll vers `#rsec-<id>`), le composant ne connaît ni le
// routeur ni le store — c'est ce qui le rend testable unitairement.
// Le seul DOM manipulé est la rangée elle-même : le centrage de la puce active passe par
// un `scrollLeft` calculé (JAMAIS de `scrollIntoView` nu, qui ferait défiler la page
// entière verticalement), au montage puis à chaque changement d'`activeId`.
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sectionTitleLabel } from '@/utils/reader'

const props = defineProps({
  // Sections brutes du lecteur ({ id, title, … }) : le libellage (traduction du titre
  // de l'intro, reconnu par id d'abord — cf. sectionTitleLabel, reader.js) se fait ici,
  // comme pour les titres de section rendus.
  sections: { type: Array, required: true },
  // Id de la section courante (celle de `?section=`), pour marquer la puce active —
  // puce également exposée aux lecteurs d'écran via `aria-current`.
  activeId: { type: String, default: '' },
})
const emit = defineEmits(['navigate'])

const { t } = useI18n()

// La rangée défilante : seule cible DOM du composant, pour le centrage par scrollLeft.
const rowEl = ref(null)

// Masqué si ≤ 1 section : rien à sommairer.
const visible = computed(() => props.sections.length > 1)
const items = computed(() =>
  props.sections.map((sec) => ({ id: sec.id, label: sectionTitleLabel(sec, t) })),
)

// Centre la puce active dans la rangée : delta de rectangle converti en coordonnée de
// contenu (+ scrollLeft), moins la moitié de l'espace vide autour — l'assignation à
// `scrollLeft` ne touche QUE la rangée, jamais le défilement vertical de la page.
// getBoundingClientRect plutôt que offsetLeft : insensible à l'offsetParent (aucun
// ancêtre positionné requis). Repli silencieux sous banc de test (rects à zéro).
function centerActive() {
  const row = rowEl.value
  if (!row) return
  const chip = row.querySelector('.rtoc__chip--on')
  if (!chip) return
  const rowRect = row.getBoundingClientRect()
  const chipRect = chip.getBoundingClientRect()
  const target = chipRect.left - rowRect.left + row.scrollLeft - (row.clientWidth - chipRect.width) / 2
  row.scrollLeft = Math.max(0, target)
}

onMounted(centerActive)
// flush: 'post' : la classe `--on` est posée avant le calcul (DOM à jour).
watch(() => props.activeId, centerActive, { flush: 'post' })
</script>

<template>
  <nav v-if="visible" class="rtoc" :aria-label="t('reader.toc')">
    <ul ref="rowEl" class="rtoc__row">
      <li v-for="item in items" :key="item.id" class="rtoc__item">
        <button
          type="button"
          class="rtoc__chip"
          :class="{ 'rtoc__chip--on': item.id === activeId }"
          :aria-current="item.id === activeId ? 'true' : null"
          @click="emit('navigate', item.id)"
        >
          {{ item.label }}
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
/* Même famille visuelle que l'ancien sommaire dépliant (tuile --tile bordée --line,
   ombre --clay-sm, tokens du projet) et que les onglets de l'Aide-mémoire
   (ReaderSheet.vue .rs__tab : puces pilules --r-pill sur fond --surface). */
.rtoc {
  margin: var(--sp-5) 0;
}
.rtoc__row {
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px; /* une seule rangée, hauteur de l'ancien état replié */
  padding: var(--sp-2) var(--sp-3);
  margin: 0;
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--clay-sm);
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}
.rtoc__item {
  flex: none;
  scroll-snap-align: center;
}
.rtoc__chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  background: var(--surface);
  box-shadow: var(--clay-sm);
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  color: var(--ink-70);
}
.rtoc__chip--on {
  background: var(--surface-lin);
  color: inherit;
}
</style>

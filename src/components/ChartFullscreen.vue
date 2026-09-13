<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChartZoomStore } from '@/stores/chart-zoom'
import AppIcon from '@/components/AppIcon.vue'
import ChartStage from '@/components/ChartStage.vue'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import { trapTabFocus } from '@/composables/useFocusTrap'

const zoom = useChartZoomStore()
const { t } = useI18n()

const stage = ref(null)
let lastFocused = null // élément focalisé avant ouverture, restauré à la fermeture

// Payload normalisé : `zoom.payload` peut être `null` (dialog fermé) ou incomplet selon
// l'appelant — un seul point où chaque champ retombe sur son défaut, au lieu des six
// `zoom.payload?.X || défaut` répétés dans le template.
const view = computed(() => ({
  chart: zoom.payload?.chart || {},
  row: zoom.payload?.row || 1,
  rep: zoom.payload?.rep || 1,
  frame: zoom.payload?.frame || null,
  curtain: zoom.payload?.curtain || null,
  readOnly: !!zoom.payload?.readOnly,
}))

// Verrou du scroll d'arrière-plan + focus initial (a11y clavier) : mémorise
// l'élément focalisé avant ouverture pour le restaurer à la fermeture, et déplace le focus
// dans le dialog une fois son contenu rendu (`await nextTick()` — motif ConfirmDialog.vue :
// sans lui, le viewport de <ChartStage> n'existe pas encore, le v-if n'ayant pas fini de
// patcher le DOM). Pas de réinitialisation d'état ici : le v-if REMONTE <ChartStage> à
// chaque ouverture, il repart donc d'un état neuf tout seul.
//
// Verrou posé via le compteur partagé (refermer ICI ne doit plus
// déverrouiller le fond tant qu'une autre modale le tient). `verrouPose` : on ne libère
// que ce qu'on a posé — au `watch` comme au démontage (plus bas).
let verrouPose = false
watch(
  () => zoom.open,
  async (v) => {
    if (v) {
      verrouPose = true
      lockBodyScroll()
    } else if (verrouPose) {
      verrouPose = false
      unlockBodyScroll()
    }
    if (!v) {
      lastFocused?.focus?.()
      lastFocused = null
      return
    }
    lastFocused = document.activeElement
    await nextTick()
    stage.value?.focusViewport()
  },
)
function onKey(e) {
  if (zoom.open && e.key === 'Escape') zoom.close()
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
  window.removeEventListener('keydown', onKey)
})

// Piège de focus (Tab/Shift+Tab boucle dans le dialog) : version PARTAGÉE
// (composables/useFocusTrap.js), généralisation du motif né ICI (puis recopié dans
// cm-editor.js) à tous les dialogues du projet — posée en @keydown sur la racine
// role="dialog", voir le template. (La restitution du focus d'ouverture reste le
// `lastFocused` local du watch ci-dessus, antérieur au composable.)

</script>

<template>
  <Transition name="cfs-fade">
    <div v-if="zoom.open" class="cfs" role="dialog" aria-modal="true" :aria-label="t('reader.chart.fullTitle')" @keydown="trapTabFocus">
      <ChartStage
        ref="stage"
        variant="full"
        :chart="view.chart"
        :row="view.row"
        :rep="view.rep"
        :frame="view.frame"
        :curtain="view.curtain"
        :read-only="view.readOnly"
        @update:row="(r) => zoom.payload?.onRow?.(r)"
        @update:rep="(k) => zoom.payload?.onRep?.(k)"
        @update:frame="(f) => zoom.payload?.onFrame?.(f)"
        @update:curtain="(c) => zoom.payload?.onCurtain?.(c)"
      >
        <template #tools>
          <button class="cfs__tool cfs__close" :aria-label="t('common.close')" @click="zoom.close()"><AppIcon name="close" :size="20" /></button>
        </template>
      </ChartStage>
    </div>
  </Transition>
</template>

<style scoped>
/* Fond OPAQUE, pas 96 % : la tricoteuse peut lire son titre de patron dans le bandeau
   `.rhdr` (position: sticky) du lecteur, juste derrière ce voile — malgré le z-index
   (1100 > 30), les 4 % de transparence restants laissaient ce titre transparaître en
   fantôme derrière « Diagramme », à la même position. Confirmé le 06/08 : ce n'est PAS un
   défaut de timing d'animation (le fondu `cfs-fade` est bien terminé, `attendreStabilite`
   ne voit plus rien tourner) — l'artefact est permanent tant que la transparence existe. */
.cfs { position: fixed; inset: 0; z-index: 1100; display: flex; flex-direction: column; background: rgb(20, 18, 16); }
.cfs > .cstage { flex: 1; min-height: 0; }
/* Copie de la règle homonyme de ChartStage.vue : la croix de fermeture est rendue ICI (slot
   `tools`), donc le style `scoped` de ChartStage ne l'atteint pas — le contenu d'un slot
   porte le scope du composant qui l'écrit, pas celui qui l'affiche. 5 propriétés sans
   logique : la recopie coûte moins qu'un `:deep()` qui percerait l'encapsulation.
   Toute retouche ici doit être reportée à l'identique dans ChartStage.vue. */
.cfs__tool { width: 44px; height: 44px; border: none; border-radius: var(--r-pill); background: rgba(255, 255, 255, 0.14); color: #fff; display: grid; place-items: center; }
.cfs-fade-enter-active, .cfs-fade-leave-active { transition: opacity var(--motion-fast); }
.cfs-fade-enter-from, .cfs-fade-leave-to { opacity: 0; }
</style>

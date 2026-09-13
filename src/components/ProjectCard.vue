<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import StatusBadge from './StatusBadge.vue'
import ThumbImage from './ThumbImage.vue'
import StitchProgress from './StitchProgress.vue'
import YarnConsumptionDialog from './YarnConsumptionDialog.vue'
import { resolveCover } from '@/utils/project-cover'
import { useProjectsStore } from '@/stores/projects'
import { useYarnsStore } from '@/stores/yarns'
import { useProjectConsumption } from '@/composables/useProjectConsumption'
import { isProjectVegan } from '@/utils/yarn-usage'
import { formatLocalDate } from '@/utils/date-format'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps({
  project: { type: Object, required: true },
  progress: { type: Object, default: null }, // { done, total } optionnel
  pattern: { type: Object, default: null }, // patron lié (repli couverture si le projet n'a pas de photo)
})
defineEmits(['open'])
const { t, locale } = useI18n()
const projectsStore = useProjectsStore()
// Pas de yarnsStore.load() ici : HomeView (seul appelant, cf. router) le charge déjà à
// son propre montage, et `yarnsStore.yarns` est un ref — le computed ci-dessous se
// recalcule tout seul dès qu'il atterrit. Un load() par carte dupliquerait la lecture
// ET la boucle de migration de yarns.js (db.yarns.update) en concurrence, une fois par
// carte affichée à l'accueil.
const yarnsStore = useYarnsStore()
const projectConsumption = useProjectConsumption()

// Changement de statut rapide (popover du badge) : mis à jour direct en base, la carte
// connaît déjà le projet complet. `update()` recharge la liste. Passer à 'done' OU
// 'abandoned' pose d'abord « combien de pelotes as-tu utilisées/perdues ? » SI ce projet
// réserve des pelotes (sinon comportement inchangé) — logique partagée avec
// ProjectDetailView et ProjectEditView via le composable useProjectConsumption.
async function onStatus(status) {
  await projectConsumption.requestStatusChange(props.project, status, () =>
    projectsStore.update(props.project.id, { status }),
  )
}

const techniqueLabel = computed(() => t(`technique.${props.project.technique}`))
// Repli sur la 1re photo du patron lié (prop `pattern`) si le projet n'a pas de photo propre.
const cover = computed(() => resolveCover(props.project, props.pattern))
const isDone = computed(() => props.project.status === 'done')
// Progression connue (sections avec total de rangs) ou non.
const known = computed(() => !!(props.progress && props.progress.total > 0))
// Signature de l'app : la progression rendue comme des mailles. On ne la rend que si elle
// dit quelque chose : connue ET avancée (pct > 0), ou projet terminé (signature pleine,
// même à progression inconnue). Inconnue (total 0 : sans sections ou sans rowsTotal) ou
// nulle (0 %) → pas de visuel du tout plutôt qu'une rangée de mailles vides.
const showStitch = computed(() => isDone.value || (known.value && pct.value > 0))
const stitchTotal = computed(() => (known.value ? props.progress.total : 24))
const stitchDone = computed(() =>
  known.value ? props.progress.done : isDone.value ? stitchTotal.value : 0,
)
const pct = computed(() =>
  known.value ? Math.round((100 * props.progress.done) / props.progress.total) : null,
)
// Icône vegan (ajout du 06/08/2026) : vraie seulement si CE projet a au moins une laine
// rattachée et qu'elles portent TOUTES le label 'vegan' — cf. isProjectVegan. Aucune laine
// rattachée → false → aucune icône (on ne sait pas, donc on se tait, décision produit).
const vegan = computed(() => isProjectVegan(props.project.id, yarnsStore.yarns))
// Date de fin sur la tuile — seulement pour un projet TERMINÉ portant une date.
// Un projet abandonné peut porter une date de fin : l'afficher dirait « Terminé le… » sur un
// projet qui ne l'est pas.
const finishedLabel = computed(() =>
  props.project.status === 'done' && props.project.finishedAt
    ? t('project.finishedOn', { date: formatLocalDate(props.project.finishedAt, locale.value) })
    : '',
)
</script>

<template>
  <div class="pcard">
    <!-- Le badge de statut est éditable (popover propre) : il doit rester un élément à part
    du bouton d'ouverture du projet (pas de <button> imbriqué). -->
    <button class="pcard__main" @click="$emit('open', project.id)">
      <ThumbImage class="pcard__thumb" :src="cover" kind="project" :seed="project.name" :alt="project.name" />
      <div class="pcard__body">
        <div class="pcard__top">
          <span class="pcard__name">{{ project.name }}</span>
          <!-- Toutes les laines rattachées (réservées OU consommées, cf. isProjectVegan)
          sont vegan : même motif que YarnCard (AppIcon + `label` = aria-label i18n), sans
          laine rattachée l'icône est absente plutôt qu'une ligne vide (pas de risque de
          gigue ici, contrairement à la grille de YarnCard : pcard__stars/pcard__pct sont
          déjà optionnels sur cette carte). Libellé DÉDIÉ (project.allYarnsVegan), pas
          `yarn.labels.vegan` : « Vegan » seul ne dit pas de quoi on parle au lecteur
          d'écran sur une carte de PROJET (décision produit, 06/08). -->
          <AppIcon v-if="vegan" name="labelVegan" :size="15" class="pcard__vegan" :label="t('project.allYarnsVegan')" />
        </div>
        <div class="pcard__meta">
          <span>{{ techniqueLabel }}<template v-if="project.activeSize"> · {{ project.activeSize }}</template><template v-if="finishedLabel"> · {{ finishedLabel }}</template></span>
          <span v-if="project.stars" class="pcard__stars" role="img" :aria-label="t('project.starsValue', { n: project.stars })"><AppIcon v-for="n in project.stars" :key="n" name="starFilled" :size="13" /></span>
        </div>
        <div class="pcard__foot">
          <StitchProgress v-if="showStitch" class="pcard__stitch" :technique="project.technique" :done="stitchDone" :total="stitchTotal" :tone="isDone ? 'sage' : 'brand'" />
          <!-- Même intention que showStitch : pas de « 0 % » orphelin une fois le visuel
          masqué ; un projet Terminé garde son affichage complet (pct 0 % inclus). -->
          <span v-if="pct !== null && (pct > 0 || isDone)" class="pcard__pct">{{ pct }} %</span>
        </div>
      </div>
    </button>
    <StatusBadge class="pcard__badge" :status="project.status" editable @change="onStatus" @click.stop />
  </div>

  <!-- « Combien de pelotes as-tu réellement utilisées/perdues ? » (Terminé ou Abandonné,
  si des laines sont réservées — R3 : le mode pilote le défaut du dialogue). -->
  <YarnConsumptionDialog
    :open="projectConsumption.open"
    :yarns="projectConsumption.yarns"
    :mode="projectConsumption.mode"
    @confirm="projectConsumption.confirm"
  />
</template>

<style scoped>
.pcard {
  position: relative;
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  box-shadow: var(--clay-sm);
  transition: box-shadow var(--motion-fast);
}
/* Bouton d'ouverture : occupe toute la carte sauf le badge de statut (élément à part,
cf. commentaire du template). */
.pcard__main {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  transition: transform var(--motion-fast);
}
.pcard__main:active {
  transform: scale(0.99);
}
.pcard__thumb {
  width: 52px;
  height: 52px;
}
.pcard__body {
  flex: 1;
  min-width: 0;
}
.pcard__top {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-2);
  /* réserve la place du badge de statut (positionné en absolu, cf. .pcard__badge) */
  padding-right: 92px;
}
.pcard__name {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 16px;
  color: var(--ink);
}
/* Même teinte que la ligne d'engagements de YarnCard (.ycard__labels) : pas de vert
   dédié, aucune couleur en dur — jeton du thème pour rester lisible en sombre. */
.pcard__vegan {
  color: var(--ink-55);
  flex-shrink: 0;
}
.pcard__badge {
  position: absolute;
  top: var(--sp-4);
  right: var(--sp-4);
}
.pcard__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  color: var(--ink-55);
  font-size: 13px;
}
.pcard__stars {
  color: var(--mustard);
  letter-spacing: 1px;
}
.pcard__foot {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-top: var(--sp-2);
}
.pcard__stitch {
  flex: 1;
}
.pcard__pct {
  flex: none;
  min-width: 42px;
  text-align: right;
  font-size: 12px;
  color: var(--ink-55);
}
</style>

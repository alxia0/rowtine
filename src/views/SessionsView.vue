<script setup>
// Écran Sessions : TOUTES les sessions de travail, tous
// projets confondus, du plus récent au plus ancien. Chaque ligne porte le nom du projet,
// la date et la durée ; un appui ouvre la fiche du projet (seul endroit où une session se
// rectifie ou s'efface — cet écran ne fait que CONSULTER). Première version simple :
// ni filtre ni regroupement (la fiche projet et l'écran Statistiques couvrent déjà ces
// angles). Le tri et la jointure du nom vivent dans le store (`recentSessions`), pas ici.
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import EmptyStateArt from '@/components/EmptyStateArt.vue'
import BackToTop from '@/components/BackToTop.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useSessionsStore } from '@/stores/sessions'
import { fmtDuration } from '@/stores/activeSession'
import { formatLocalDate } from '@/utils/date-format'

const { t, locale } = useI18n()
const router = useRouter()
const sessionsStore = useSessionsStore()

const rows = ref([])
onMounted(async () => {
  rows.value = await sessionsStore.recentSessions()
})

// La ligne sait où aller : `projectId` est porté par chaque session en base, la route
// `project` (cf. src/router/index.js) prend l'id en paramètre. Le nom lui vient du store
// (`projectName`, '' si le projet a disparu) : repli sur un libellé discret plutôt qu'un
// blanc inexpliqué — la session reste vraie même si sa fiche n'existe plus.
function openProject(row) {
  router.push({ name: 'project', params: { id: row.projectId } })
}
function projectName(row) {
  return row.projectName || t('sessions.unknownProject')
}
// Session sans date (`date: ''`) : on n'affiche QUE la durée — jamais un « Invalid Date »
// ni un séparateur « · » orphelin. formatLocalDate('') rend déjà '', c'est la ligne
// complète qu'on évite de composer avec un creux.
function sessionMeta(row) {
  const duration = fmtDuration(row.durationSec || 0)
  return row.date ? `${formatLocalDate(row.date, locale.value)} · ${duration}` : duration
}
</script>

<template>
<div>
  <AppHeader :title="t('sessions.title')" back />
  <main class="screen">
    <template v-if="rows.length">
      <ul class="ses-list">
        <li v-for="row in rows" :key="row.id" class="ses-list__row">
          <button type="button" class="ses-list__btn" :data-test="`sessions-row-${row.id}`" @click="openProject(row)">
            <span class="ses-list__name">{{ projectName(row) }}</span>
            <span class="ses-list__meta">{{ sessionMeta(row) }}</span>
          </button>
          <AppIcon name="chevronRight" :size="16" class="ses-list__chev" />
        </li>
      </ul>
    </template>

    <EmptyStateArt v-else :size="120">
      {{ t('sessions.empty') }}
      <template #hint>{{ t('sessions.emptyHint') }}</template>
    </EmptyStateArt>
  </main>
  <!-- Écran à défilement de page (document) : pas de cible, même câblage que les autres
       écrans longs (dépenses, stock, biblio). -->
  <BackToTop />
</div>
</template>

<style scoped>
.ses-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.ses-list__row {
  display: flex;
  align-items: stretch;
  gap: var(--sp-1);
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--clay-sm);
  overflow: hidden;
}
/* Le BOUTON est la ligne entière (pas seulement un libellé) : la cible tactile est
   maximale, même motif que les tuiles de l'accueil. Il fléchit pour laisser le chevron
   immobile à droite. */
.ses-list__btn {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: none;
  background: transparent;
  text-align: left;
  padding: var(--sp-3);
  color: var(--ink);
}
.ses-list__btn:active {
  background: var(--surface);
}
.ses-list__name {
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ses-list__meta {
  font-size: 12.5px;
  color: var(--ink-55);
}
.ses-list__chev {
  flex-shrink: 0;
  align-self: center;
  color: var(--ink-55);
  margin-right: var(--sp-3);
}
</style>

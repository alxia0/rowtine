<script setup>
// Écran de statistiques de temps tricoté (device-gated).
// Consomme l'agrégation pure (src/utils/time-periods.js) : ne réimplémente aucune
// logique de regroupement/reset ici. Rendu 100 % maison (aucune lib de charts, hors-ligne).
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import EmptyStateArt from '@/components/EmptyStateArt.vue'
import StatsHeatmap from '@/components/StatsHeatmap.vue'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { useSettingsStore } from '@/stores/settings'
import { allActiveDays } from '@/db/active-days'
import { aggregateByPeriod, ymdLocal, weekdayNames as pureWeekdayNames } from '@/utils/time-periods'
import { formatLocalDate, formatDayMonth } from '@/utils/date-format'
import { generateHeatColors } from '@/theme/palette'
import { useEffectiveTheme } from '@/theme/useEffectiveTheme'
import {
  buildWindow, buildGrid, sessionsByDay, totalSeconds, dayKeyOf, DEFAULT_WINDOW,
  weekdayTotals, bestWeekdayAllTime, currentStreak, longestStreakInWindow,
  activeDays, bestDay, averageSecondsPerActiveDay, topProject, finishedInWindow, wipCount,
  filterByTechnique, filterProjectsByTechnique, sessionsByDayAndProject, showTechniqueFilter,
} from '@/utils/stats-grid'
import { fmtDuration } from '@/stores/activeSession'

const { t, locale } = useI18n()
const sessionsStore = useSessionsStore()
const projectsStore = useProjectsStore()
const settingsStore = useSettingsStore()

// Évolution du 11/08 — premier jour de la semaine, réglé dans les Réglages. Lu UNE FOIS ici (au
// bord du composant) et transmis PAR PARAMÈTRE à chaque fonction pure ci-dessous : les modules
// `stats-grid.js`/`time-periods.js` restent purs, aucune date ni réglage implicite. Défaut 1
// (lundi) si le store n'est pas encore chargé (le garde de route le charge normalement avant
// toute navigation, mais un composant testé isolément n'a pas cette garantie).
const firstDay = computed(() => settingsStore.weekStart ?? 1)

// Retour terrain 26/08 : le calendrier suit la teinte d'accent choisie dans Réglages, comme
// --brand ailleurs dans l'app — plus un dégradé orange figé quelle que soit la teinte choisie.
// Depuis le 31/08 : sans choix explicite, c'est le défaut DYNAMIQUE par thème effectif
// (rose en sombre, bleu en clair) — la grille suit la bascule clair/sombre.
const effectiveTheme = useEffectiveTheme()
const heatColors = computed(() => generateHeatColors(settingsStore.effectiveAccentHue(effectiveTheme.value)))

// Une SEULE notion de période pour tout l'écran (§4) : ce sélecteur ne choisit plus une
// granularité de barre mais une FENÊTRE D'OBSERVATION, à laquelle se soumettent le total, les
// barres, la grille, les barres par jour de semaine et les tuiles.
const PERIODS = ['month', 'quarter', 'semester', 'year']
const period = ref(DEFAULT_WINDOW)
const sessions = ref([])

// Deux onglets (décision produit, 11/08) : la grille (gauche → aujourd'hui) et les
// barres de période (récent → ancien, `aggregateByPeriod` trie décroissant) portaient deux axes
// de temps OPPOSÉS à quatre lignes d'écart. Les séparer en onglets fait disparaître la
// contradiction — les deux blocs ne sont plus côte à côte — sans inverser aucun tri existant.
// « Calendrier » (défaut) : la grille + sa légende, puis les neuf tuiles. « Rythme » : les barres
// de période, puis les sept barres par jour de semaine et leur phrase.
// NON PERSISTÉ, comme le filtre technique ci-dessous : un `ref()` local, pas un store.
// ⛔ AU CLIC UNIQUEMENT — aucun écouteur de geste. Les onglets de la fiche projet réagissent au
// balayage horizontal ; la grille défile aussi horizontalement en Semestre/Année : un balayage
// ici servirait deux fonctions à la fois. Ce projet a déjà payé cher une collision de gestes
// (chantier « galeries zoomables », 09/08) — on ne rouvre pas ce dossier.
const TABS = ['calendar', 'rhythm']
const activeTab = ref('calendar')
// Instant de référence figé à l'entrée dans l'écran (comme l'Accueil calcule au montage).
const now = new Date()

// Journal des jours actifs : chargé UNE FOIS au montage, comme les sessions. Lu
// directement en base et non via un store — il n'a ni écriture ni état à partager, ses deux
// seules opérations vivent dans src/db/active-days.js.
const journalDays = ref([])

onMounted(async () => {
  sessions.value = await sessionsStore.allSessions()
  if (!projectsStore.loaded) await projectsStore.load()
  journalDays.value = await allActiveDays()
})

// Filtre NON PERSISTÉ : il vaut le temps de la consultation, comme le décrochage du volet du
// Lecteur. Il gouverne TOUT l'écran, pas seulement la grille — un écran dont le haut ignore un
// filtre que le bas applique est une source de confusion classique (§8, écart assumé).
const TECHNIQUES = ['all', 'knitting', 'crochet']
const technique = ref('all')

// Évolution du 11/08 — le sélecteur ne s'affiche QUE si la bibliothèque ENTIÈRE contient les deux
// techniques. ⛔ Lit `projectsStore.projects` (la base BRUTE), jamais `filteredProjects` ci-
// dessous : le même piège que `hasAnyActivity` — sous « Crochet » sur une base sans
// crochet, une liste déjà filtrée serait vide et ferait disparaître le sélecteur qui vient
// pourtant de servir à choisir « Crochet ». Ne dépend NI de `win` NI de `activeTab` : c'est ce
// qui garantit que le sélecteur ne bouge jamais au fil d'une période ou d'un onglet.
const showFilter = computed(() => showTechniqueFilter(projectsStore.projects))

// « Filtre EFFECTIF » : correct par construction plutôt que par un watcher qui remettrait
// `technique.value` à 'all'. Si le sélecteur est masqué, TOUT ce qui consomme le filtre doit
// se comporter comme « Tout », même si `technique.value` vaut encore 'crochet' en mémoire —
// cas réel : filtrer sur Crochet, puis (en théorie) perdre le dernier projet de crochet
// pendant la même visite ferait disparaître le sélecteur ; sans cette indirection, le filtre
// resterait actif et INVISIBLE, et l'écran semblerait vide sans raison visible. En ne branchant
// JAMAIS `technique.value` directement sur les calculs ci-dessous — seulement `effectiveTechnique`
// — ce cas ne peut pas se produire, par construction : aucun état à resynchroniser, rien à
// oublier de remettre à zéro.
const effectiveTechnique = computed(() => (showFilter.value ? technique.value : 'all'))

const filtered = computed(() => filterByTechnique(sessions.value, projectsStore.projects, effectiveTechnique.value))
// Jumelle côté PROJETS (§8, les neuf tuiles) : « terminés » et « en cours » lisent des
// projets, pas des sessions — elles ont donc besoin de leur propre liste filtrée, pas de
// `filtered.value` (qui reste des sessions).
const filteredProjects = computed(() => filterProjectsByTechnique(projectsStore.projects, effectiveTechnique.value))

const win = computed(() => buildWindow(now, period.value, firstDay.value))
const byDay = computed(() => sessionsByDay(filtered.value))
const grid = computed(() => buildGrid(win.value, byDay.value))

// L'état vide GLOBAL de l'écran : « aucune ACTIVITÉ du tout », et non « aucune session ».
// Une utilisatrice qui coche des rangs sans jamais chronométrer a bel et bien une série à
// montrer — l'écran la cachait. Se juge toujours HORS fenêtre et HORS filtre technique :
// ⛔ NE JAMAIS lire `filtered.value` ici (choisir « Crochet » sur une base 100 % tricot doit
// montrer une fenêtre vide, pas faire disparaître l'écran).
const hasAnyActivity = computed(() => sessions.value.length > 0 || journalDays.value.length > 0)

// L'UNION « journal des jours actifs + jours de session » (§7ter). C'est l'ensemble
// que la couche d'agrégation avait prévu de recevoir : aucune ligne de stats-grid.js ne change de règle.
// ⚖️ D2 (décision produit, 11/08) : les jours du journal comptent QUEL QUE SOIT le filtre technique — le
// journal ne retient qu'un jour, ni projet ni technique (§7ter, « rien de plus »). Un jour
// dans les deux sources ne compte qu'une fois : c'est un `Set`.
const daySet = computed(() => new Set([...byDay.value.keys(), ...journalDays.value]))

// Sept barres par jour de semaine, SUR LA FENÊTRE (§6) — voir la phrase d'historique
// (`bestWeekday`) plus bas pour le seul chiffre hors période de cette section.
const wd = computed(() => weekdayTotals(win.value, byDay.value, firstDay.value))
const wdMax = computed(() => Math.max(1, ...wd.value))
const bestWeekday = computed(() => bestWeekdayAllTime(byDay.value, firstDay.value))

// ⚠️ Les séries sont calculées en `computed`, JAMAIS appelées depuis le template : une fonction
// appelée dans un template se réévalue à chaque tick réactif, et `longestStreakInWindow` parcourt
// la fenêtre jour par jour (jusqu'à 371 itérations, et bien plus pour le record d'historique).
const serieEnCours = computed(() => currentStreak(daySet.value, now))
const serieFenetre = computed(() => longestStreakInWindow(daySet.value, win.value))

// Record d'HISTORIQUE : la plus longue série jamais tenue, toutes fenêtres confondues.
const recordStreak = computed(() => {
  const joursTries = [...daySet.value].sort()
  if (!joursTries.length) return 0
  return longestStreakInWindow(daySet.value, { startDay: joursTries[0], endDay: ymdLocal(now) })
})

const jours = computed(() => activeDays(win.value, daySet.value))
const meilleur = computed(() => bestDay(win.value, byDay.value))
// ⚖️ Décision produit du 11/08, prise APRÈS avoir vu le cas sur l'appareil — la moyenne se
// tait quand le filtre technique rend son calcul bancal. Le journal ne retient qu'un JOUR, ni
// projet ni technique (§7ter) : sous « Crochet », son dénominateur compte donc des jours que
// le numérateur — le temps de crochet — ne peut pas expliquer.
// Mesuré sur le Huawei, vraies données d'Alexia : filtre Crochet, un rang de TRICOT coché faisait
// passer les jours actifs de 8 à 9 et la moyenne de 1:11:03 à 1:03:09, alors que son temps de
// crochet, lui, n'avait pas bougé d'une seconde. Un chiffre exact qui ne répond à aucune question.
//
// ⚠️ La garde est CONDITIONNELLE, et c'est tout son intérêt : elle ne se déclenche que s'il existe
// RÉELLEMENT, dans la fenêtre, un jour de l'union que les sessions filtrées n'expliquent pas. Un
// filtre actif sur un journal vide (ou dont les jours portent aussi une session de la technique
// retenue) garde son chiffre — remplacer un nombre honnête par un tiret serait une perte gratuite.
// ⛔ Ne PAS étendre la garde à « Tout » : là, un jour du seul journal fait légitimement baisser la
// moyenne (D1, acceptée en connaissance de cause). L'y étendre annulerait la décision que cette
// garde est censée compléter.
const moyenneBancale = computed(
  () =>
    effectiveTechnique.value !== 'all' &&
    [...daySet.value].some((d) => d >= win.value.startDay && d <= win.value.endDay && !byDay.value.has(d)),
)
// `null` — pas 0 — quand la moyenne n'a rien à afficher : aucun jour actif, un total nul (fenêtre
// pleine de sessions à rangs seuls, ou de jours du seul journal), ou le cas bancal ci-dessus.
// Le template rend alors « — » : une ignorance ne se présente jamais comme un temps mesuré.
const moyenne = computed(() =>
  moyenneBancale.value ? null : averageSecondsPerActiveDay(win.value, byDay.value, daySet.value),
)
const top = computed(() => topProject(filtered.value, win.value))
// ⚠️ Cherche dans la liste COMPLÈTE des projets, PAS `filteredProjects.value` : `top` vient déjà
// de sessions filtrées (`filtered.value`), donc son `projectId` désigne forcément un projet de la
// technique retenue (ou n'importe quel projet sous « Tout »). Le restreindre une seconde fois
// n'ajouterait rien et risquerait un nom vide si jamais l'ordre d'évaluation changeait.
const topName = computed(() => projectsStore.projects.find((p) => p.id === top.value?.projectId)?.name || '')

// Évolution du 11/08 : la liste des projets d'un jour, sous la case sélectionnée de la grille.
// `stats-grid.js` rend des IDENTIFIANTS (comme `topProject` ci-dessus) ; c'est ICI, comme pour
// `topName`, que l'identifiant devient un texte affichable — jamais dans le module pur.
// Construit pour TOUS les jours de `filtered.value` en un seul passage (même ordre de grandeur
// que `byDay` ci-dessus) : bien moins coûteux que de recalculer à chaque clic sur une case, et
// ça garde la sélection ENTIÈREMENT locale à StatsHeatmap (pas d'aller-retour d'événement).
const dayProjects = computed(() => {
  const raw = sessionsByDayAndProject(filtered.value)
  const out = {}
  for (const [day, byProject] of raw) {
    const rows = [...byProject.entries()].map(([projectId, { seconds, count }]) => {
      const project = projectsStore.projects.find((p) => p.id === projectId)
      return { projectId, name: project?.name || '', orphan: !project, seconds, count }
    })
    // Temps décroissant : le projet qui pèse le plus dans le total du jour se lit en premier —
    // la même logique de lecture que la grille elle-même (plus foncé = plus de temps).
    // Égalité départagée par le nom pour un ordre STABLE, plutôt que l'ordre d'itération d'une
    // Map (qui suivrait l'ordre d'insertion des sessions, un détail d'implémentation sans sens
    // pour l'utilisatrice).
    rows.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
    out[day] = rows
  }
  return out
})
const finis = computed(() => finishedInWindow(filteredProjects.value, win.value))
const enCours = computed(() => wipCount(filteredProjects.value))

// « — » et non « 0 h » : une ignorance ne doit pas se présenter comme un zéro mesuré (même
// règle que le coût de projet, 08/08).
const DASH = '—'
function dureeOuTiret(seconds) {
  return seconds > 0 ? fmtDuration(seconds) : DASH
}

// Initiales/noms localisés des jours, PREMIER JOUR CHOISI EN TÊTE (jamais getDay() brut, qui
// met toujours dimanche à 0 quel que soit le réglage). `weekdayNames` (time-periods.js,
// 11/08, mécanisme partagé avec `StatsHeatmap.vue`) fait le calcul pur ; ce wrapper reste ICI
// pour fermer sur `locale`/`firstDay` et rester réactif (`computed`).
// ⚠️ ABRÉGÉ, pour les SEPT BARRES seulement — là où le court est juste et voulu (peu de place,
// une ligne par jour). NE JAMAIS le réutiliser pour la phrase d'historique juste dessous (voir
// `weekdayNamesLong` ci-dessous) : les deux besoins sont opposés, un seul format ne peut pas
// servir les deux (revue finale du 11/08 — « …est le mer.. » au lieu de « …est le dimanche »).
function makeWeekdayNames(style) {
  return computed(() => pureWeekdayNames(locale.value, firstDay.value, style))
}
const weekdayNames = makeWeekdayNames('short')
// EN TOUTES LETTRES, pour la SEULE phrase d'historique (« Sur tout l'historique, ton jour le
// plus assidu est le dimanche. », §6 et §12.3) — jamais pour les sept barres, qui gardent
// l'abrégé ci-dessus.
const weekdayNamesLong = makeWeekdayNames('long')

// Le total est une SOMME SUR LA FENÊTRE. L'ancienne version dérivait la clé de la période
// courante puis cherchait sa ligne dans un tableau trié, parce que `rows[0]` pouvait être une
// période PASSÉE un lundi matin sans session — un faux total. Avec une fenêtre, il n'y a plus
// d'indexation dans un tableau : cette classe de défaut disparaît par construction, et c'est
// pourquoi la garde d'alors n'a plus lieu d'être.
const currentTotal = computed(() => totalSeconds(win.value, byDay.value))

// Le libellé du sélecteur arrondit (« Trimestre » vaut 13 semaines) ; la plage exacte écrite
// dessous porte la vérité.
const rangeLabel = computed(() =>
  t('stats.range', {
    from: formatLocalDate(win.value.startDay, locale.value),
    to: formatLocalDate(win.value.endDay, locale.value),
  }),
)

// Au-delà de 13 semaines, une barre par SEMAINE deviendrait illisible : on passe au mois.
const barGranularity = computed(() => (win.value.weeks > 13 ? 'month' : 'week'))

// Les barres de période sont bornées PAR LA FENÊTRE, donc aucune coupe arbitraire : le
// `slice(0, 12)` d'avant rognerait le mois le plus ancien d'une année, qui en touche 13 ou 14.
const displayRows = computed(() => {
  const dans = filtered.value.filter((s) => {
    const jour = dayKeyOf(s)
    return jour && jour >= win.value.startDay && jour <= win.value.endDay
  })
  // `firstDay` ne joue que pour la granularité 'week' (voir time-periods.js) : les
  // barres restent alignées sur le MÊME premier jour que la fenêtre/la grille juste au-dessus,
  // au lieu de bucketer par semaines-lundi alors que la fenêtre, elle, aurait démarré un
  // dimanche — une incohérence de la même famille que les deux axes de temps opposés déjà
  // corrigés par les onglets (§6bis).
  return aggregateByPeriod(dans, barGranularity.value, firstDay.value)
})
const maxSeconds = computed(() => Math.max(1, ...displayRows.value.map((r) => r.seconds)))

// Libellé lisible d'une barre de période, selon la granularité de barre active (dérivée de la
// fenêtre, jamais choisie directement : cf. barGranularity).
function periodLabel(row) {
  if (!row) return ''
  if (barGranularity.value === 'week') {
    const d = row.startDate
    return t('stats.weekOf', { date: formatDayMonth(d, locale.value) })
  }
  return row.startDate.toLocaleDateString(locale.value, { month: 'long', year: 'numeric' })
}

// Longueur de barre proportionnelle au temps, avec un minimum visible pour les PETITES valeurs
// NON NULLES (le plancher de 2 % existe pour qu'elles restent visibles). Une valeur nulle ne
// doit RIEN peindre — sans la garde `seconds > 0`, une barre à zéro dessinerait un moignon
// coloré de 2 % tout en affichant « — » à côté, deux signaux contraires sur la même barre.
function pctOf(seconds, max) {
  return seconds > 0 ? Math.max(2, Math.round((seconds / max) * 100)) : 0
}
function barPct(seconds) {
  return pctOf(seconds, maxSeconds.value)
}

// Même règle que `barPct` ci-dessus, pour les SEPT BARRES PAR JOUR DE SEMAINE — un second site
// indépendant qui dessinait le même moignon de 2 % sur un jour à zéro (revue finale du 11/08 :
// une exigence sur deux sites veut deux tests).
function wdPct(seconds) {
  return pctOf(seconds, wdMax.value)
}
</script>

<template>
<div>
  <AppHeader :title="t('stats.title')" back />
  <main class="screen">
    <div class="toggle" role="group" :aria-label="t('stats.periodLabel')">
      <button
        v-for="p in PERIODS"
        :key="p"
        class="toggle__opt"
        :class="{ 'toggle__opt--on': period === p }"
        :aria-pressed="period === p"
        @click="period = p"
      >
        {{ t(`stats.period.${p}`) }}
      </button>
    </div>
    <!-- Évolution du 11/08 — n'existe QUE si la bibliothèque contient les deux techniques
         (`showFilter`, dérivé de TOUTE la bibliothèque, jamais de la fenêtre/l'onglet actifs) :
         un sélecteur dont un seul choix donnerait un résultat non vide n'apporte rien et
         occupe une ligne précieuse à 360 px. `v-if` (pas `v-show`) : rien à cacher à moitié,
         et surtout rien qui laisserait croire qu'un filtre reste actionnable. -->
    <div v-if="showFilter" class="toggle" role="group" :aria-label="t('stats.techniqueLabel')">
      <button
        v-for="tk in TECHNIQUES"
        :key="tk"
        class="toggle__opt"
        :class="{ 'toggle__opt--on': technique === tk }"
        :aria-pressed="technique === tk"
        @click="technique = tk"
      >
        {{ tk === 'all' ? t('stats.technique.all') : t(`technique.${tk}`) }}
      </button>
    </div>
    <p class="range">{{ rangeLabel }}</p>

    <template v-if="hasAnyActivity">
      <section class="current">
        <span class="current__eyebrow">{{ t('stats.onPeriod') }}</span>
        <span class="current__value">{{ dureeOuTiret(currentTotal) }}</span>
      </section>

      <!-- Deux onglets (11/08) : la grille (ancien → aujourd'hui) et les barres de période
           (récent → ancien) portaient deux axes de temps OPPOSÉS à quatre lignes d'écart — les
           séparer fait disparaître la contradiction sans inverser aucun tri. ⛔ CLIC UNIQUEMENT,
           aucun écouteur de geste (cf. commentaire du script : collision avec le défilement
           horizontal de la grille en Semestre/Année). -->
      <div class="tabs" role="tablist" :aria-label="t('stats.tabsLabel')">
        <button
          v-for="tb in TABS"
          :id="`stats-tab-${tb}`"
          :key="tb"
          class="tab"
          :class="{ 'tab--on': activeTab === tb }"
          role="tab"
          :aria-selected="activeTab === tb"
          :aria-controls="`stats-panel-${tb}`"
          @click="activeTab = tb"
        >
          {{ t(`stats.tab.${tb}`) }}
        </button>
      </div>

      <!-- v-if (pas v-show) : StatsHeatmap s'ancre à droite dans `onMounted` ET dans un `watch`
           sur `grid` (StatsHeatmap.vue) — masqué en `v-show`, `scrollWidth` y vaudrait 0 tant que
           l'élément reste `display:none`, et rien ne le corrigerait au retour puisque `grid` n'a
           pas forcément changé pendant l'absence. Démonter/remonter revient exactement au premier
           montage : `onMounted` s'y rejoue et ré-ancre correctement à chaque retour sur l'onglet. -->
      <div v-if="activeTab === 'calendar'" id="stats-panel-calendar" role="tabpanel" aria-labelledby="stats-tab-calendar">
        <StatsHeatmap :grid="grid" :locale="locale" :day-projects="dayProjects" :first-day="firstDay" :heat-colors="heatColors" />

        <div class="stats-grid">
          <div class="stat" data-stat="total">
            <span class="stat__k">{{ t('stats.tiles.total') }}</span>
            <span class="stat__v">{{ dureeOuTiret(currentTotal) }}</span>
          </div>
          <div class="stat" data-stat="activeDays">
            <span class="stat__k">{{ t('stats.tiles.activeDays') }}</span>
            <span class="stat__v">{{ jours.active ? t('stats.tiles.activeDaysValue', jours, jours.active) : '—' }}</span>
          </div>
          <!-- ⚠️ Portée HISTORIQUE, assumée : une série est un fait continu, la borner au bord de
               la fenêtre la rendrait FAUSSE (20 jours à cheval s'afficheraient « 6 jours »). -->
          <div class="stat" data-stat="streak">
            <span class="stat__k">{{ t('stats.tiles.streak') }}</span>
            <span class="stat__v">{{ t('stats.tiles.days', { n: serieEnCours }, serieEnCours) }}</span>
          </div>
          <!-- Les DEUX nombres côte à côte : c'est ce qui rend la différence de portée visible. -->
          <div class="stat" data-stat="longest">
            <span class="stat__k">{{ t('stats.tiles.longest') }}</span>
            <span class="stat__v">{{ t('stats.tiles.days', { n: serieFenetre }) }}</span>
            <span class="stat__sub">{{ t('stats.tiles.record', { n: recordStreak }, recordStreak) }}</span>
          </div>
          <div class="stat" data-stat="topProject">
            <span class="stat__k">{{ t('stats.tiles.topProject') }}</span>
            <span class="stat__v">{{ topName || '—' }}</span>
            <!-- `dureeOuTiret`, comme partout ailleurs sur cet écran : `topProject` retient le
                 premier projet rencontré sans exiger seconds > 0, or une session saisie à rangs
                 seuls vaut durationSec: 0. La tuile affichait alors « 0:00 » — un zéro MESURÉ —
                 juste sous une tuile « Total » qui, sur les mêmes données, affiche « — ». -->
            <span v-if="top" class="stat__sub">{{ dureeOuTiret(top.seconds) }}</span>
          </div>
          <div class="stat" data-stat="bestDay">
            <span class="stat__k">{{ t('stats.tiles.bestDay') }}</span>
            <span class="stat__v">{{ meilleur ? formatLocalDate(meilleur.day, locale) : '—' }}</span>
            <span v-if="meilleur" class="stat__sub">{{ fmtDuration(meilleur.seconds) }}</span>
          </div>
          <div class="stat" data-stat="average">
            <span class="stat__k">{{ t('stats.tiles.average') }}</span>
            <span class="stat__v">{{ moyenne !== null ? fmtDuration(moyenne) : '—' }}</span>
          </div>
          <div class="stat" data-stat="finished">
            <span class="stat__k">{{ t('stats.tiles.finished') }}</span>
            <span class="stat__v">{{ finis.count }}</span>
            <!-- Le passé ne se reconstruit pas ; il se DÉCLARE. Sans cette mention, un projet
                 marqué Terminé sans date serait invisible et le compte faux par omission. -->
            <span v-if="finis.withoutDate" class="stat__sub">{{ t('stats.tiles.withoutDate', { n: finis.withoutDate }) }}</span>
          </div>
          <!-- ⚠️ Compte au PRÉSENT, pas une mesure de période : un projet est en cours
               MAINTENANT. La borner n'aurait aucun sens. -->
          <div class="stat" data-stat="wip">
            <span class="stat__k">{{ t('stats.tiles.wip') }}</span>
            <span class="stat__v">{{ enCours }}</span>
          </div>
        </div>
      </div>

      <div v-else id="stats-panel-rhythm" role="tabpanel" aria-labelledby="stats-tab-rhythm">
        <ul class="bars">
          <li v-for="row in displayRows" :key="row.key" class="bar">
            <span class="bar__label">{{ periodLabel(row) }}</span>
            <div class="bar__track">
              <div class="bar__fill" :style="{ width: barPct(row.seconds) + '%' }"></div>
            </div>
            <span class="bar__value">{{ fmtDuration(row.seconds) }}</span>
          </li>
        </ul>

        <section class="wd">
          <h2 class="wd__title">{{ t('stats.weekdays.title') }}</h2>
          <ul class="bars">
            <li v-for="(sec, i) in wd" :key="i" class="bar">
              <span class="bar__label">{{ weekdayNames[i] }}</span>
              <div class="bar__track"><div class="bar__fill" :style="{ width: wdPct(sec) + '%' }"></div></div>
              <span class="bar__value">{{ dureeOuTiret(sec) }}</span>
            </li>
          </ul>
          <!-- UNE SEULE phrase porte le fait d'historique : sur 5 semaines, chaque jour de la
               semaine n'est observé que 5 fois, ce qui est trop mince pour affirmer « je tricote
               surtout le dimanche ». Une ligne, un chiffre hors période, pas d'exception ailleurs. -->
          <p v-if="bestWeekday !== null" class="wd__alltime">
            {{ t('stats.weekdays.allTime', { day: weekdayNamesLong[bestWeekday] }) }}
          </p>
        </section>
      </div>
    </template>

    <EmptyStateArt v-else :size="120">
      {{ t('stats.empty') }}
      <template #hint>{{ t('stats.emptyHint') }}</template>
    </EmptyStateArt>
  </main>
</div>
</template>

<style scoped>
.toggle { display: flex; gap: var(--sp-2); background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 4px; }
/* Second groupe (filtre technique), sous le premier : même composant visuel, deux
   instances distinctes. */
.toggle + .toggle { margin-top: var(--sp-2); }
/* 4 cases (avant : 3) à 360 px : ~85 px chacune, d'où la police et le padding resserrés. */
.toggle__opt { flex: 1; border: none; background: transparent; color: var(--ink-55); font-weight: 600; font-size: 13px; padding: 10px 4px; border-radius: var(--r-pill); }
.toggle__opt--on { background: var(--brand); color: var(--on-accent); }
.range { margin: var(--sp-2) 0 0; text-align: center; font-size: 12.5px; color: var(--ink-55); }
/* `rangeLabel` (ex. « du 18/05/2026 au 11/08/2026 ») commence en minuscule en français, espagnol
   et allemand — pensé pour s'insérer après un label, mais ici il forme une phrase AUTONOME sous
   le sélecteur (§4 : « le sous-titre dit la vérité », une seule mention, à cet endroit).
   `capitalize` mettrait une majuscule à CHAQUE mot (« Du 18/05/2026 Au 11/08/2026 ») : on ne veut
   que l'initiale. */
.range::first-letter { text-transform: uppercase; }

.current {
  margin-top: var(--sp-4);
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: var(--sp-5);
  box-shadow: var(--clay-sm);
  text-align: center;
}
.current__eyebrow { display: block; font-size: 11.5px; font-weight: 600; color: var(--ink-55); text-transform: uppercase; letter-spacing: 0.4px; }
.current__value { display: block; font-family: var(--font-display); font-size: 36px; font-weight: 600; line-height: 1.1; color: var(--brand-deep); margin: 6px 0 2px; }

/* Deux onglets seulement, libellés courts (les 4 langues) : PAS de `overflow-x: auto` façon
   ProjectDetailView.vue (4 onglets, qui en ont besoin) — ici, un débordement doit rester VISIBLE
   au conteneur/à la page (piège déjà mesuré sur `.toggle` : un `flex: 1` sans `min-width: 0`
   grossit pour épouser le libellé au lieu de le contenir ou de déborder ; `min-width: 0` fait
   remonter le débordement là où le protocole de mesure à 3 niveaux peut le voir). Aucun
   `@touchstart`/`@touchend` sur ce bloc : les onglets changent au CLIC uniquement. */
.tabs { display: flex; gap: var(--sp-2); margin-top: var(--sp-4); }
.tab { flex: 1; min-width: 0; border: 1px solid var(--line); background: var(--tile); color: var(--ink-55); font-weight: 600; font-size: 13.5px; padding: 10px 12px; border-radius: var(--r-pill); box-shadow: var(--clay-sm); text-align: center; }
.tab--on { background: var(--brand-grad); color: var(--on-accent); border-color: transparent; }

.bars { list-style: none; margin: var(--sp-4) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.bar { display: flex; align-items: center; gap: var(--sp-3); }
.bar__label { flex: 0 0 96px; font-size: 12.5px; color: var(--ink-70); }
.bar__label::first-letter { text-transform: uppercase; }
.bar__track { flex: 1; background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-pill); height: 14px; overflow: hidden; }
.bar__fill { height: 100%; background: var(--brand); border-radius: var(--r-pill); }
.bar__value { flex: 0 0 56px; text-align: right; font-size: 12.5px; font-weight: 600; color: var(--ink); }

.wd { margin-top: var(--sp-5); }
.wd__title { font-size: 14px; font-weight: 600; color: var(--ink-70); margin: 0 0 var(--sp-3); }
.wd__alltime { margin: var(--sp-3) 0 0; font-size: 12.5px; color: var(--ink-55); }
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); margin-top: var(--sp-5); }
.stat { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-lg); padding: var(--sp-4); box-shadow: var(--clay-sm); }
.stat__k { display: block; font-size: 11.5px; font-weight: 600; color: var(--ink-55); text-transform: uppercase; letter-spacing: 0.4px; }
.stat__v { display: block; font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--brand-deep); margin-top: 4px; }
.stat__sub { display: block; font-size: 12px; color: var(--ink-55); margin-top: 2px; }
</style>

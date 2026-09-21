<script setup>
// Grille calendaire d'intensité. Rendu 100 % maison, aucune bibliothèque :
// l'application fonctionne hors ligne et cela ne change pas.
//
// ⚠️ DÉFILEMENT NATIF UNIQUEMENT (overflow-x + overscroll-behavior-x: contain). Aucun
// gestionnaire de geste maison : ce projet a déjà payé cher les collisions de gestes lors
// du chantier des galeries zoomables (09/08) et on ne rouvre pas ce dossier pour un tableau.
import { ref, computed, onMounted, nextTick, watch, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { HEAT_COLORS, monthGroups } from '@/utils/stats-grid'
import { fmtDuration } from '@/stores/activeSession'
import { formatLocalDate, localDayToDate } from '@/utils/date-format'
import { weekdayNames } from '@/utils/time-periods'

const props = defineProps({
  grid: { type: Object, required: true },
  locale: { type: String, default: 'fr' },
  // ÉVO C (11/08) : jour -> liste de { projectId, name, orphan, seconds, count }, déjà
  // RÉSOLUE (noms, reliquat orphelin) par la vue parente — voir StatsView.vue, même voie que
  // `topName`. Ce composant ne connaît que des jours et des chaînes à afficher, jamais le
  // store des projets : il reste un pur rendu de ce qu'on lui donne.
  dayProjects: { type: Object, default: () => ({}) },
  // ÉVO E (11/08) — premier jour de la semaine (convention `Date.getDay()` : 1 = lundi,
  // 0 = dimanche), réglé dans les Réglages. Reçu en PROP, comme `locale` : ce composant ne lit
  // jamais le store des réglages lui-même, il reste un pur rendu de ce qu'on lui donne. Défaut
  // 1 (lundi) : un appelant qui ne le passe pas garde EXACTEMENT le rendu d'avant ce lot.
  firstDay: { type: Number, default: 1 },
  // Nuanciers clair/sombre du calendrier (retour terrain 26/08 : suivre la teinte d'accent
  // choisie dans Réglages, pas rester figé en orange) — calculés par StatsView.vue via
  // generateHeatColors(settingsStore.accentHue), même convention que locale/firstDay
  // ci-dessus : ce composant ne lit jamais le store des réglages lui-même. Défaut HEAT_COLORS
  // (teinte par défaut) : un appelant qui ne le passe pas garde le rendu d'avant ce lot.
  heatColors: { type: Object, default: () => HEAT_COLORS },
})
const { t } = useI18n()

const scroller = useTemplateRef('scroller')
// On retient le JOUR sélectionné (une chaîne), jamais l'objet `cell` lui-même : `grid` est
// entièrement reconstruit à chaque recalcul de `byDay` côté StatsView — un changement de
// FENÊTRE, mais AUSSI un changement du FILTRE technique (ÉVO C exige que la liste des projets
// suive le filtre). Un objet `cell` capturé au clic deviendrait donc obsolète (temps/compte
// d'AVANT le filtre) au prochain recalcul, quelle qu'en soit la cause.
const selectedDay = ref(null)
// La case CORRESPONDANTE est relue dans le grid COURANT à chaque rendu, jamais mise en cache :
// c'est ce qui fait qu'un changement de FILTRE (même jour, fenêtre inchangée) affiche des
// données à jour, ET qu'un changement de FENÊTRE qui exclut ce jour désélectionne tout seul —
// sans watcher dédié, simplement parce que `cellByDay` ne contient plus ce jour.
const cellByDay = computed(() => {
  const m = new Map()
  for (const col of props.grid.columns) for (const cell of col.cells) m.set(cell.day, cell)
  return m
})
const selected = computed(() => (selectedDay.value ? cellByDay.value.get(selectedDay.value) || null : null))

// Au-delà de 13 semaines, la bande s'allonge et glisse. La taille de case ne diminue JAMAIS :
// une case qui rétrécirait à 9 px cesserait d'être une cible tactile.
const scrolls = computed(() => props.grid.columns.length > 13)

// ÉVO A (11/08) — un rectangle par mois, encadrant SES colonnes et les 7 lignes. Calculé en
// JS (pas de magie CSS) à partir des mêmes constantes que la feuille de style ci-dessous
// (cellule 20 px, écart 2 px, étiquette de mois 14 px) : si ces valeurs changent un jour, les
// deux doivent changer ensemble — elles sont regroupées ici, commentées, plutôt que dupliquées
// en dur dans le CSS.
const CELL_PX = 20 // .hm__cell width/height
const GAP_PX = 2 // .hm__cols / .hm__col gap
const LABEL_H_PX = 14 // .hm__month / .hm__month-spacer height
const FRAME_TOP_PX = LABEL_H_PX + GAP_PX // le rectangle englobe les 7 LIGNES, pas l'étiquette
const FRAME_HEIGHT_PX = 7 * CELL_PX + 6 * GAP_PX
const monthFrames = computed(() =>
  monthGroups(props.grid).map((g) => ({
    key: g.key,
    left: g.startIndex * (CELL_PX + GAP_PX),
    width: g.count * CELL_PX + (g.count - 1) * GAP_PX,
  })),
)

// Les huit couleurs entrent en variables CSS, les deux palettes à la fois : c'est la feuille de
// style qui choisit laquelle s'applique, donc une bascule de thème n'a rien à recalculer ici.
const heatVars = computed(() => {
  const vars = {}
  for (let i = 1; i <= 4; i++) {
    vars[`--heat-l${i}`] = props.heatColors.light[i]
    vars[`--heat-d${i}`] = props.heatColors.dark[i]
  }
  return vars
})

// Initiales localisées des jours, PREMIER JOUR CHOISI en tête (ÉVO E, 11/08). `weekdayNames`
// (time-periods.js, mécanisme partagé avec `StatsView.vue` — `weekdayNames`/`weekdayNamesLong`)
// : les DEUX doivent tourner ENSEMBLE avec le même réglage, sinon la gouttière (ici) et les
// lignes de la grille juste à droite (dérivées de `props.grid`, construit par
// `buildGrid`/`buildWindow` avec le MÊME `firstDay` côté StatsView) se contrediraient —
// exactement la classe de défaut que la séparation en onglets a déjà réglée une fois sur cet
// écran (§6bis).
const weekdayInitials = computed(() => weekdayNames(props.locale, props.firstDay, 'narrow'))

// Même patron que `weekdayInitials` ci-dessus : un seul formateur mémoïsé, réutilisé pour
// chaque colonne du mois plutôt qu'un `new Intl.DateTimeFormat` par appel.
const monthFormatter = computed(() => new Intl.DateTimeFormat(props.locale, { month: 'short' }))
function monthLabel(monday) {
  return monthFormatter.value.format(localDayToDate(monday))
}

// La MÊME phrase à l'écran et en accessibilité : l'information ne repose jamais sur la seule
// couleur.
//
// ⚠️ Trois cas, pas deux. Une session à RANGS SEULS (`saveManualSession`, ProjectDetailView.vue)
// s'enregistre avec `durationSec: 0` : le jour porte alors `count > 0` mais `seconds === 0`. Le
// niveau 0 (couleur) reste correct — c'est bien « rien » EN TEMPS TRICOTÉ — mais dire
// « rien de tricoté » tout court serait trompeur puisqu'une session existe réellement ce jour-là.
// `cellEmpty` reste réservée au jour VRAIMENT vide (`count === 0`) ; `cellNoTime` dit la vérité
// pour l'autre cas, sans changer le niveau/la couleur de la case (qui restent ceux du temps).
//
// ⚠️ Limitation connue (journal des jours actifs) : cette grille ne mesure que le TEMPS
// (`seconds`/`count` viennent des sessions). Le journal des jours actifs peut porter un jour
// que ces deux champs ignorent totalement — un compteur avancé ou un rang coché sans aucune
// session ce jour-là. Pour un tel jour, `cell` arrive ici avec `count === 0` ET `seconds === 0` :
// `cellPhrase` retombe dans le premier cas et dit « rien de tricoté », alors que les tuiles
// « Jours actifs » et « Série en cours » (alimentées par le journal, pas par cette grille)
// comptent ce même jour comme actif. Le correctif propre — faire connaître au composant les
// jours du journal, pour un liseré dédié plutôt qu'un niveau de couleur — est HORS PÉRIMÈTRE
// ici.
function cellPhrase(cell) {
  const date = formatLocalDate(cell.day, props.locale)
  if (!cell.seconds && !cell.count) return t('stats.heatmap.cellEmpty', { date })
  if (!cell.seconds) return t('stats.heatmap.cellNoTime', { date, count: t('stats.heatmap.sessions', { n: cell.count }, cell.count) })
  return t('stats.heatmap.cell', {
    date,
    duration: fmtDuration(cell.seconds),
    count: t('stats.heatmap.sessions', { n: cell.count }, cell.count),
  })
}

const tip = computed(() => (selected.value ? cellPhrase(selected.value) : ''))

// ÉVO B (11/08) — appuyer une SECONDE fois sur la case déjà sélectionnée la DÉSÉLECTIONNE.
// Décision : la case fonctionne comme les boutons de bascule
// déjà présents sur cet écran (période, technique — `aria-pressed`), sauf qu'ici presser et
// re-presser la MÊME case doit pouvoir effacer la phrase/la liste sans qu'il faille en
// sélectionner une autre pour « faire de la place ». Comparaison par `day` (chaîne), jamais
// par référence d'objet : `grid` est reconstruit à chaque changement de fenêtre, donc l'ancien
// objet `cell` ne serait plus jamais `===` à une case du nouveau `grid` même pour le même jour.
function selectCell(cell) {
  selectedDay.value = selectedDay.value === cell.day ? null : cell.day
}
function isSelected(cell) {
  return selectedDay.value === cell.day
}

// ÉVO C (11/08) — la liste des projets du jour sélectionné, déjà résolue par le parent
// (StatsView.vue) : ce composant se contente d'un lookup par jour, puis met en mots ce que
// `stats-grid.js` n'exprime jamais lui-même (noms, reliquat orphelin, absence de mesure).
// Lue sur `selectedDay` (pas sur `selected.value?.day`, équivalent mais direct) : elle doit
// suivre le filtre technique elle aussi, exactement comme `selected` ci-dessus.
const projectRows = computed(() => (selectedDay.value ? props.dayProjects[selectedDay.value] || [] : []))

// Une session à RANGS SEULS (durée 0, `saveManualSession`) ne doit jamais s'afficher comme un
// « 0:00 » qui SEMBLERAIT mesuré (même règle que le reste de cet écran) — y compris
// pour un projet SUPPRIMÉ (son nom n'est plus résolvable, mais son temps réel, lui, reste vrai
// et s'affiche normalement).
function projectLine(row) {
  const name = row.orphan ? t('stats.heatmap.projectDeleted') : row.name
  if (row.seconds > 0) return t('stats.heatmap.projectLine', { name, duration: fmtDuration(row.seconds) })
  return t('stats.heatmap.projectLineNoTime', { name })
}

// La bande est positionnée à DROITE : la semaine en cours est ce qu'on regarde. `nextTick`
// avant de lire `scrollWidth` : sans lui, la largeur mesurée est celle d'AVANT le rendu des
// nouvelles colonnes (0 au 1er montage, l'ANCIENNE largeur à un changement de fenêtre).
//
// Ce composant n'est jamais démonté/remonté quand StatsView change de fenêtre (le sélecteur
// Mois/Trimestre/Semestre/Année ne fait que faire recalculer `grid`, sans `:key`) : `onMounted`
// seul ne s'exécuterait donc qu'une fois, au premier Trimestre (13 semaines, PAS scrollable) —
// passer ensuite à Semestre ou Année laisserait la bande immobile au bord GAUCHE, la semaine en
// cours hors champ. Le `watch` sur `grid` (une fenêtre différente crée un nouvel objet grid, y
// compris à nombre de colonnes égal) réanchore à chaque changement, pas seulement au montage.
async function scrollToEnd() {
  await nextTick()
  if (scroller.value) scroller.value.scrollLeft = scroller.value.scrollWidth
}
onMounted(scrollToEnd)
watch(() => props.grid, scrollToEnd)
// ⚠️ Aucun watcher pour EFFACER `selectedDay` sur un changement de `grid` : ce serait TROP
// large. `grid` change aussi bien à un changement de FENÊTRE (la sélection doit alors se
// perdre si le jour n'y est plus) qu'à un changement du seul FILTRE technique (ÉVO C exige au
// contraire que la sélection SURVIVE, pour que la liste de projets se rafraîchisse au lieu de
// disparaître). La désélection « automatique » vient donc d'ailleurs : `selected` et
// `projectRows` ci-dessus relisent `cellByDay`/`props.dayProjects` À CHAQUE rendu — si le jour
// sélectionné n'existe plus dans le grid COURANT (fenêtre qui ne le couvre plus), le lookup
// rend `null`/`[]` tout seul, sans code dédié à écrire ni à tester séparément.
</script>

<template>
  <div class="hm" :style="heatVars">
    <div class="hm__body">
      <div class="hm__gutter" aria-hidden="true">
        <span class="hm__month-spacer"></span>
        <span v-for="(ini, i) in weekdayInitials" :key="i" class="hm__day">{{ ini }}</span>
      </div>
      <div ref="scroller" class="hm__scroll" :class="{ 'hm__scroll--scrolls': scrolls }">
        <div class="hm__cols">
          <!-- ÉVO A : un rectangle par mois, décoratif et hors du flux (position absolue) —
               il n'ajoute ni ne retire aucun pixel à la taille/position des cases.
               `pointer-events: none` : jamais d'interception du clic sur les cases dessous,
               quelle que soit sa position dans l'empilement. -->
          <div
            v-for="f in monthFrames"
            :key="f.key"
            class="hm__month-frame"
            :style="{ left: f.left + 'px', top: FRAME_TOP_PX + 'px', width: f.width + 'px', height: FRAME_HEIGHT_PX + 'px' }"
            aria-hidden="true"
          ></div>
          <div v-for="col in grid.columns" :key="col.monday" class="hm__col">
            <span class="hm__month">{{ col.monthStart ? monthLabel(col.monday) : '' }}</span>
            <template v-for="cell in col.cells" :key="cell.day">
              <span v-if="cell.future" class="hm__cell hm__cell--future" :data-day="cell.day"></span>
              <button
                v-else
                class="hm__cell"
                :class="[`hm__cell--l${cell.level}`, { 'hm__cell--selected': isSelected(cell) }]"
                :data-day="cell.day"
                :data-level="String(cell.level)"
                :aria-label="cellPhrase(cell)"
                :aria-current="isSelected(cell) ? 'date' : null"
                @click="selectCell(cell)"
              ></button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <p v-if="tip" class="hm__tip" role="status">{{ tip }}</p>
    <!-- ÉVO C : la liste des projets du jour sélectionné, un par ligne avec le temps qui lui
         revient CE jour-là — la somme des lignes recoupe le total porté par `tip` ci-dessus.
         `role="list"` explicite : certains lecteurs d'écran ne l'infèrent plus d'un <ul> stylé
         (list-style: none le supprime dans quelques navigateurs). -->
    <ul v-if="projectRows.length" class="hm__day-projects" role="list" :aria-label="t('stats.heatmap.projectsLabel')">
      <li v-for="row in projectRows" :key="row.projectId" class="hm__day-project">{{ projectLine(row) }}</li>
    </ul>

    <div class="hm__legend" role="group" :aria-label="t('stats.heatmap.legendLabel')">
      <span class="hm__legend-word">{{ t('stats.heatmap.less') }}</span>
      <span
        v-for="n in 5"
        :key="n"
        class="hm__swatch"
        :class="`hm__cell--l${n - 1}`"
        role="img"
        :aria-label="t(`stats.heatmap.level${n - 1}`)"
      ></span>
      <span class="hm__legend-word">{{ t('stats.heatmap.more') }}</span>
    </div>
  </div>
</template>

<style scoped>
.hm { margin-top: var(--sp-4); }
.hm__body { display: flex; gap: 4px; }
.hm__gutter { display: flex; flex-direction: column; gap: 2px; flex: 0 0 auto; }
/* L'étiquette peut DÉBORDER de sa colonne de 20 px sans la pousser : `.hm__col` est désormais à
   largeur fixe (voir son commentaire), donc un mot large — « sept. », « mars », plus long encore
   en allemand — s'écrit par-dessus la gouttière de droite au lieu d'élargir la colonne et de
   désaligner les rectangles de mois. `overflow: visible` est le défaut, on l'écrit pour que
   personne ne le « corrige » en `hidden` : la tronquer rendrait les mois illisibles. */
.hm__month-spacer, .hm__month { display: block; height: 14px; font-size: 10px; color: var(--ink-55); white-space: nowrap; overflow: visible; }
.hm__day { display: flex; align-items: center; height: 20px; font-size: 10px; color: var(--ink-55); }

/* Défilement NATIF. `overscroll-behavior-x: contain` empêche le geste de déborder sur la page
   qui défile verticalement — c'est le seul garde-fou, aucun gestionnaire maison. */
.hm__scroll { overflow-x: hidden; }
.hm__scroll--scrolls { overflow-x: auto; overscroll-behavior-x: contain; }
/* `position: relative` : ancre les rectangles de mois (position absolue) sur CE conteneur,
   qui défile avec la bande — un rectangle n'est donc jamais laissé en arrière au défilement. */
.hm__cols { display: flex; gap: 2px; position: relative; }
/* ⚠️ Largeur FIXÉE à celle des cases, et c'est structurel, pas cosmétique. Sans elle, la colonne
   est dimensionnée par son contenu — dont l'étiquette de mois en `white-space: nowrap` : un mot
   large (« sept. », « mars », pire en allemand) élargissait sa colonne à 21-23 px, ce que le
   calcul arithmétique des rectangles de mois (`startIndex × (CELL_PX + GAP_PX)`) ignore. L'écart
   se cumulait colonne après colonne et atteignait 7-8 px sur le dernier groupe en fenêtre Année,
   si bien que le cadre ne coïncidait plus avec les colonnes qu'il prétend regrouper.
   `flex: 0 0 20px` interdit à la fois l'étirement et le rétrécissement : la géométrie devient
   exacte PAR CONSTRUCTION, et `tests/e2e/stats-heatmap-month-frames.spec.js` la vérifie en vrai
   navigateur (jsdom ne calcule aucune disposition). L'étiquette, elle, peut déborder sans
   pousser personne — cf. `.hm__month` plus bas. */
.hm__col { display: flex; flex-direction: column; gap: 2px; flex: 0 0 20px; width: 20px; }
.hm__cell { width: 20px; height: 20px; border-radius: 4px; padding: 0; border: none; background: transparent; }

/* ÉVO A — un rectangle par mois. Position ABSOLUE (hors du flux) : ni les cases ni les
   colonnes n'en tiennent compte pour leur propre taille/position (exigence de cible
   tactile 20×20 px). `border` (et non `outline`/`box-shadow`) est sans risque ici PARCE QUE
   l'élément n'est pas dans le flux — contrairement à un `border` posé directement sur
   `.hm__cell`, celui-ci ne pousse jamais aucun voisin. `z-index: 1` + `pointer-events: none` :
   la case reste au-dessus pour le clic (test d'atteinte), le rectangle ne fait que la border.
   `var(--ink-40)` — jeton de couleur, pas une valeur en dur — reste lisible sur les deux
   thèmes ET sur les cinq niveaux (il varie en OPACITÉ d'ink/crème, jamais dans la teinte de la
   marque utilisée par l'échelle de chaleur, donc il ne s'y confond jamais). */
.hm__month-frame {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  border: 2px solid var(--ink-40);
  border-radius: 6px;
}

/* Niveau 0 : le fond de page et un liseré — c'est un jour SANS tricot, il se voit. */
.hm__cell--l0 { background: var(--bg); border: 1px solid var(--line); }
.hm__cell--l1 { background: var(--heat-l1); }
.hm__cell--l2 { background: var(--heat-l2); }
.hm__cell--l3 { background: var(--heat-l3); }
.hm__cell--l4 { background: var(--heat-l4); }

/* Un jour À VENIR est ABSENT : ni fond, ni liseré. Il ne doit surtout pas ressembler à un
   jour sans tricot. */
.hm__cell--future { background: none; border: none; }

/* ÉVO B — la case sélectionnée. DEUX anneaux INSET (jamais de `outline`/`box-shadow` SORTANT :
   ça déborderait de la case de 20×20 px, qui se ferait alors rogner par `overflow-x: hidden`
   du conteneur en mode Mois/Trimestre — ou, en mode Semestre/Année, se retrouverait tronqué en
   haut/bas des lignes 1 et 7 pour la MÊME raison). En restant DEDANS, aucun risque de
   troncature quel que soit le mode, et la taille/position de la case ne change JAMAIS.
   Un halo à deux couleurs plutôt qu'une seule : un niveau 0 (presque blanc) et un niveau 4
   (très foncé) n'ont AUCUNE couleur unique qui contraste avec les deux à la fois — `var(--bg)`
   (presque blanc en clair, presque noir en sombre) forme l'anneau extérieur, `var(--ink)`
   (l'inverse) l'anneau intérieur : l'un des deux tranche TOUJOURS sur la couleur du niveau,
   quel qu'il soit, dans les deux thèmes — les mêmes jetons qui définissent déjà le fond de
   page et le texte, jamais une couleur choisie à l'œil. */
.hm__cell--selected { box-shadow: inset 0 0 0 2px var(--bg), inset 0 0 0 4px var(--ink); }

/* Mode sombre : les paliers sont CALCULÉS depuis la teinte or sur le fond sombre, jamais un
   inversement des paliers clairs. Les deux formes du thème sont couvertes — l'attribut
   explicite ET la préférence système (même convention que SnackBar.vue /
   ReaderChart.vue / ReaderTextEditor.vue : sélecteur `:root[data-theme]`/`html[data-theme]`
   direct, PAS de `:global()` — ce dépôt ne s'en sert pas), faute de quoi la moitié des
   appareils garderait les couleurs claires sur fond sombre. */
:root[data-theme='dark'] .hm__cell--l1,
html[data-theme='dark'] .hm__cell--l1 { background: var(--heat-d1); }
:root[data-theme='dark'] .hm__cell--l2,
html[data-theme='dark'] .hm__cell--l2 { background: var(--heat-d2); }
:root[data-theme='dark'] .hm__cell--l3,
html[data-theme='dark'] .hm__cell--l3 { background: var(--heat-d3); }
:root[data-theme='dark'] .hm__cell--l4,
html[data-theme='dark'] .hm__cell--l4 { background: var(--heat-d4); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .hm__cell--l1 { background: var(--heat-d1); }
  :root:not([data-theme='light']) .hm__cell--l2 { background: var(--heat-d2); }
  :root:not([data-theme='light']) .hm__cell--l3 { background: var(--heat-d3); }
  :root:not([data-theme='light']) .hm__cell--l4 { background: var(--heat-d4); }
}

.hm__tip { margin: var(--sp-3) 0 0; text-align: center; font-size: 13px; color: var(--ink-70); }
/* ÉVO C — beaucoup de projets le même jour : hauteur PLAFONNÉE (~4 lignes) puis défilement
   VERTICAL NATIF (`overflow-y: auto`), jamais un JS qui tronque la liste — la somme affichée
   doit toujours pouvoir recouper le total, même quand il faut faire défiler pour tout lire.
   Aucun geste maison : c'est un défilement de PAGE ordinaire, pas une collision avec la bande
   horizontale de la grille (axes perpendiculaires, jamais le même geste). */
.hm__day-projects { list-style: none; margin: var(--sp-2) 0 0; padding: 0; max-height: 108px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.hm__day-project { font-size: 12.5px; color: var(--ink-70); text-align: center; }
.hm__legend { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: var(--sp-3); }
.hm__legend-word { font-size: 11.5px; color: var(--ink-55); margin: 0 4px; }
.hm__swatch { width: 14px; height: 14px; border-radius: 3px; display: inline-block; }
</style>

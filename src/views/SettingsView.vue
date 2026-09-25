<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import i18n from '@/i18n'
import { useSettingsStore } from '@/stores/settings'
import { useTrashStore } from '@/stores/trash'
import { useProjectsStore } from '@/stores/projects'
import { useYarnsStore } from '@/stores/yarns'
import { usePurchasesStore } from '@/stores/purchases'
import { usePatternsStore } from '@/stores/patterns'
import { useSnackbarStore } from '@/stores/snackbar'
import { TECHNIQUES } from '@/constants/status'
import { LANGUAGES } from '@/constants/languages'
import { CURRENCIES } from '@/constants/currencies'
import { currencySymbol } from '@/utils/units'
import { toCsv, downloadCsv } from '@/utils/csv'
import { yarnExportTable } from '@/utils/yarn-filter'
import { projectExportTable, patternExportTable } from '@/utils/export-tables'
import SafFolderSection from '@/components/settings/SafFolderSection.vue'
import { KOFI_URL, GITHUB_ISSUES_URL } from '@/constants/app-links'
import { applyTheme, applyAccent, syncNativeChrome } from '@/theme/apply'
import { generatePalette, hueGradientCss, presetHuesFor } from '@/theme/palette'
import { useEffectiveTheme } from '@/theme/useEffectiveTheme'
import { ymdLocal } from '@/utils/time-periods'
import { useStartTour } from '@/composables/useStartTour'

const { t } = useI18n()
const settings = useSettingsStore()
const { startTour } = useStartTour()
const effectiveTheme = useEffectiveTheme()
const hueGradient = computed(() => hueGradientCss(effectiveTheme.value))
// Nuancier PAR THÈME (08/09) : la liste suit le thème effectif. Listes distinctes
// assumées : une teinte choisie absente de la liste du thème courant → aucune pastille
// allumée, le curseur la montre.
const presetHues = computed(() => presetHuesFor(effectiveTheme.value))
// Teinte AFFICHÉE (curseur du glissé, pastille active du nuancier) : le défaut dynamique
// tant que rien n'a été choisi, le choix explicite ensuite.
const hueDisplay = computed(() => settings.effectiveAccentHue(effectiveTheme.value))
function accentSwatchColor(hue) {
  return generatePalette(hue, effectiveTheme.value)['--brand']
}
function previewAccentHue(hue) {
  applyAccent(hue, effectiveTheme.value)
}
function setAccentHue(hue) {
  settings.saveAccentHue(hue)
  applyAccent(hue, effectiveTheme.value)
  syncNativeChrome(hue, effectiveTheme.value)
}
const trash = useTrashStore()
const projectsStore = useProjectsStore()
const yarnsStore = useYarnsStore()
const purchasesStore = usePurchasesStore()
const patternsStore = usePatternsStore()
const snackbar = useSnackbarStore()

const firstName = ref(settings.firstName)
const technique = ref(settings.defaultTechnique)
const showTrash = ref(false)

onMounted(() => {
  trash.load()
})

async function saveProfile() {
  await settings.saveProfile({ firstName: firstName.value, technique: technique.value })
  snackbar.show(t('settings.saved'))
}
async function setLocale(e) {
  const loc = e.target.value
  await settings.saveProfile({ locale: loc })
  i18n.global.locale.value = loc
}
function setTheme(v) {
  settings.saveTheme(v)
  // Fournisseur (T2, 31/08) : basculer clair/sombre fait SUIVRE la teinte par défaut
  // (rose/bleu) tant qu'aucun choix explicite n'a été fait — un choix explicite est un
  // nombre fixe et prime.
  applyTheme(v, (effective) => settings.effectiveAccentHue(effective))
}

// Premier jour de la semaine (11/08) : effet immédiat comme le thème ci-dessus, aucune
// confirmation nécessaire — ce réglage ne touche aucune donnée déjà écrite (contrairement à la
// devise, qui affiche un avertissement s'il existe déjà des prix).
function setWeekStart(v) {
  settings.saveWeekStart(v)
}

// Unités : effet immédiat, aucune donnée touchée — on ne change que des lunettes.
function setUnitSystem(v) {
  settings.saveUnits({ unitSystem: v })
}

// Devise : une devise est une ÉTIQUETTE, pas un taux de change. Changer de devise ne
// convertit AUCUN montant déjà saisi — on le dit explicitement, mais seulement si des prix
// existent (sinon l'avertissement inquiéterait pour rien).
const pendingCurrency = ref(null)
const currencyOptions = computed(() =>
  CURRENCIES.map((c) => ({ code: c, label: `${c} (${currencySymbol(c, settings.locale)})` })),
)
function hasAnyPrice() {
  return yarnsStore.yarns.some((y) => String(y.price ?? '').trim() !== '')
}
async function onCurrencyChange(e) {
  const next = e.target.value
  if (next === settings.currency) return
  if (!yarnsStore.loaded) await yarnsStore.load()
  if (hasAnyPrice()) {
    pendingCurrency.value = next
    return
  }
  await settings.saveUnits({ currency: next })
}
async function confirmCurrency() {
  await settings.saveUnits({ currency: pendingCurrency.value })
  pendingCurrency.value = null
}
function cancelCurrency() {
  // Referme le dialogue ET remet le sélecteur sur la valeur réelle. Le 2e effet n'a PAS besoin
  // d'écriture DOM manuelle : `:value` est lié à settings.currency (jamais modifié tant qu'on
  // n'a pas confirmé), et Vue resynchronise déjà le <select> à CHAQUE rendu en comparant sa
  // valeur DOM réelle à la prop `value` (patchDOMProp dans @vue/runtime-dom) — pas seulement
  // quand la prop change depuis le rendu précédent. Vérifié par mutation : un reset manuel via
  // une ref serait un no-op mort. Cette ligne reste nécessaire pour
  // refermer le dialogue lui-même — sans elle, `pendingCurrency` resterait non nul et
  // ConfirmDialog ne se fermerait jamais.
  pendingCurrency.value = null
}

// --- Export tableur (CSV) ---
// Les en-têtes des trois tables passent par `t(...)` (clés `settings.export.*`), et non plus
// par un booléen anglais/français figé : avec 4 langues (allemand, espagnol en plus), ce
// booléen répondait toujours « non » pour les langues tierces et sortait des en-têtes en
// français quelle que soit la langue réelle de l'utilisatrice (passage multilingue, 29/07).
//
// Les trois tables sont désormais des fonctions PURES hors de cette vue — `yarnExportTable`
// (utils/yarn-filter.js), `projectExportTable` et `patternExportTable` (utils/export-tables.js,
// extraites à la revue finale, 29/07). Écrites en ligne ici, les deux dernières étaient
// hors de portée d'un test de module : 19 clés de traduction que rien ne vérifiait, alors
// qu'une clé mal orthographiée sort le chemin de clé brut en en-tête de colonne du tableur.
// La vue ne garde que ce qui lui revient : lire le store, nommer le fichier, le télécharger.
// Jour LOCAL : `toISOString()` datait le fichier de la veille pour toute
// exportation faite entre minuit et le décalage du fuseau — le nom du fichier contredisait alors
// la date affichée par l'app juste à côté.
const today = () => ymdLocal(new Date())

async function exportYarns() {
  if (!yarnsStore.loaded) await yarnsStore.load()
  // `purchasesStore.forYarn` (les travaux sur le budget) : bain et date d'achat viennent
  // désormais du registre d'achats, plus des champs `yarn.bain`/`yarn.purchasedAt` (retirés
  // du formulaire auparavant) — sans ce branchement l'export sortirait ces deux
  // colonnes silencieusement vides pour toute laine créée depuis.
  if (!purchasesStore.loaded) await purchasesStore.load()
  // system/currency/locale explicites : l'export est un chemin séparé des
  // vues qui construit ses propres en-têtes — sans ce passage, il resterait silencieusement
  // en métrique/euro quels que soient les réglages réels de l'utilisatrice.
  const { head, rows } = yarnExportTable(yarnsStore.yarns, {
    t, system: settings.unitSystem, currency: settings.currency, locale: settings.locale,
    linesFor: purchasesStore.forYarn,
  })
  downloadCsv(`rowtine-stock-${today()}.csv`, toCsv(head, rows))
  snackbar.show(t('settings.exportDone'))
}

async function exportProjects() {
  if (!projectsStore.loaded) await projectsStore.load()
  const { head, rows } = projectExportTable(projectsStore.projects, { t })
  downloadCsv(`rowtine-projets-${today()}.csv`, toCsv(head, rows))
  snackbar.show(t('settings.exportDone'))
}

async function exportPatterns() {
  if (!patternsStore.loaded) await patternsStore.load()
  const { head, rows } = patternExportTable(patternsStore.libraryPatterns, { t })
  downloadCsv(`rowtine-patrons-${today()}.csv`, toCsv(head, rows))
  snackbar.show(t('settings.exportDone'))
}

// Vider la corbeille est définitif (aucune annulation) : une confirmation avant d'effacer.
const confirmEmptyTrash = ref(false)
async function doEmptyTrash() {
  confirmEmptyTrash.value = false
  await trash.empty()
}

async function restoreTrash(id) {
  const result = await trash.restore(id)
  await Promise.all([projectsStore.load(), yarnsStore.load(), patternsStore.load()])
  if (result?.shortfalls?.length) snackbar.show(t('settings.restoreShortfall'))
}
// `deletedAt` est un INSTANT (`new Date().toISOString()`, stores/trash.js) : tronquer la chaîne
// donnerait le jour à Greenwich, pas le jour local — une suppression faite entre minuit et le
// décalage du fuseau s'affichait datée de la veille. C'est le piège documenté en tête de
// utils/date-format.js, et le même que celui déjà corrigé plus haut pour le nom du fichier CSV.
function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : ymdLocal(d)
}
</script>

<template>
<div>
  <AppHeader :title="t('nav.settings')" />
  <main class="screen">
    <!-- Profil -->
    <section class="block">
      <h2 class="block__title">{{ t('settings.profile') }}</h2>
      <label class="field-label" for="fn">{{ t('onboarding.firstName') }}</label>
      <input id="fn" v-model="firstName" class="input" :placeholder="t('onboarding.firstNamePlaceholder')" />
      <p class="field-label mt">{{ t('settings.defaultTechnique') }}</p>
      <div class="toggle">
        <button v-for="tech in TECHNIQUES" :key="tech" class="toggle__opt" :class="{ 'toggle__opt--on': technique === tech }" @click="technique = tech">
          {{ t(`technique.${tech}`) }}
        </button>
      </div>
      <button class="btn btn--primary btn--block mt" @click="saveProfile">{{ t('common.save') }}</button>
    </section>

    <!-- Apparence -->
    <section class="block">
      <h2 class="block__title">{{ t('settings.appearance') }}</h2>
      <div class="toggle">
        <button
          v-for="opt in ['system', 'light', 'dark']"
          :key="opt"
          class="toggle__opt"
          :class="{ 'toggle__opt--on': settings.theme === opt }"
          :data-test="`theme-${opt}`"
          @click="setTheme(opt)"
        >
          {{ t(`theme.${opt}`) }}
        </button>
      </div>
    </section>

    <!-- Couleur d'ambiance : nuancier + barre de teinte continue -->
    <section class="block">
      <h2 class="block__title">{{ t('accent.label') }}</h2>
      <div class="accent-swatches">
        <button
          v-for="hue in presetHues"
          :key="hue"
          type="button"
          class="accent-swatch"
          :class="{ 'accent-swatch--on': hueDisplay === hue }"
          :style="{ background: accentSwatchColor(hue) }"
          :aria-label="t('accent.preset', { hue })"
          :aria-pressed="hueDisplay === hue"
          @click="setAccentHue(hue)"
        ></button>
      </div>
      <input
        class="accent-hue"
        type="range"
        min="0"
        max="359"
        step="1"
        :value="hueDisplay"
        :style="{ backgroundImage: hueGradient }"
        :aria-label="t('accent.custom')"
        @input="previewAccentHue(Number($event.target.value))"
        @change="setAccentHue(Number($event.target.value))"
      />
    </section>

    <!-- Premier jour de la semaine (11/08) — deux choix seulement (lundi/dimanche) :
         les sept jours dans un contrôle à 360 px reproduirait le piège de débordement déjà
         mesuré deux fois sur ce projet (sélecteurs de période/technique de l'écran
         Statistiques), et un premier jour autre que lundi/dimanche casserait la lecture « quel
         jour de semaine suis-je la plus assidue » que la grille calendaire existe pour servir.
         Portée : la grille calendaire, les sept barres par jour de semaine et le total
         hebdomadaire de l'Accueil (§stats + §home). -->
    <section class="block">
      <h2 class="block__title">{{ t('settings.weekStart') }}</h2>
      <div class="toggle">
        <button
          v-for="opt in [1, 0]"
          :key="opt"
          class="toggle__opt"
          :class="{ 'toggle__opt--on': settings.weekStart === opt }"
          :data-test="`weekstart-${opt}`"
          @click="setWeekStart(opt)"
        >
          {{ opt === 1 ? t('weekStart.monday') : t('weekStart.sunday') }}
        </button>
      </div>
    </section>

    <!-- Langue -->
    <section class="block">
      <h2 class="block__title" id="language-title">{{ t('settings.language') }}</h2>
      <!-- Liste déroulante (retour ergonomie device, 29/07) : remplace la bascule à 4 boutons
           (cf. commentaire détaillé dans OnboardingView.vue, même motif que le sélecteur de
           devise ci-dessous). Libellés non traduits, cf. LANGUAGES (chacun reste dans SA
           langue). -->
      <!-- `aria-labelledby` vers le titre du bloc, et non un `<label>` comme pour la devise :
           ce bloc ne contient QUE ce select, le h2 « Langue » EST donc son libellé visible,
           un second libellé ferait doublon à l'écran. Choix volontairement différent de la
           devise (bloc à plusieurs contrôles → `<label for>` nécessaire là-bas) et de
           OnboardingView (pas de h2 par champ → `<label for>` seul disponible) : chaque
           select garde un nom accessible dérivé de son texte visible, par le mécanisme que
           le balisage environnant permet. Sans ce lien le select n'a AUCUN nom accessible
           (violation axe `select-name`, critical) — gardé par
           `tests/e2e/a11y-select-name.spec.js`. -->
      <select
        id="language"
        class="input"
        data-test="language-select"
        aria-labelledby="language-title"
        :value="settings.locale"
        @change="setLocale"
      >
        <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.label }}</option>
      </select>
    </section>

    <!-- Unités et devise (25/07) -->
    <section class="block">
      <h2 class="block__title">{{ t('settings.unitsAndCurrency') }}</h2>
      <div class="toggle">
        <button
          class="toggle__opt"
          :class="{ 'toggle__opt--on': settings.unitSystem === 'metric' }"
          data-test="units-metric"
          @click="setUnitSystem('metric')"
        >
          {{ t('settings.unitsMetric') }}
        </button>
        <button
          class="toggle__opt"
          :class="{ 'toggle__opt--on': settings.unitSystem === 'imperial' }"
          data-test="units-imperial"
          @click="setUnitSystem('imperial')"
        >
          {{ t('settings.unitsImperial') }}
        </button>
      </div>

      <label class="field-label mt2" for="currency">{{ t('settings.currencyLabel') }}</label>
      <select
        id="currency"
        class="input"
        data-test="currency-select"
        :value="settings.currency"
        @change="onCurrencyChange"
      >
        <option v-for="o in currencyOptions" :key="o.code" :value="o.code">{{ o.label }}</option>
      </select>
    </section>

    <!-- Données -->
    <section class="block">
      <h2 class="block__title">{{ t('settings.data') }}</h2>
      <p class="muted small">{{ t('settings.dataHint') }}</p>

      <p class="field-label mt">{{ t('settings.exportCsv') }}</p>
      <div class="exports">
        <button class="btn" @click="exportYarns">{{ t('nav.stash') }}</button>
        <button class="btn" @click="exportProjects">{{ t('settings.exportProjects') }}</button>
        <button class="btn" @click="exportPatterns">{{ t('nav.library') }}</button>
      </div>

      <button class="trash-toggle mt2" @click="showTrash = !showTrash">
        <AppIcon name="trash" :size="17" />
        {{ t('settings.trash') }} ({{ trash.items.length }})
      </button>
      <div v-if="showTrash" class="trash">
        <div v-for="it in trash.items" :key="it.id" class="trash-row">
          <span>{{ it.name || t(`settings.types.${it.type}`) }} <span class="muted small">· {{ fmtDate(it.deletedAt) }}</span></span>
          <button class="link" @click="restoreTrash(it.id)">{{ t('settings.restoreItem') }}</button>
        </div>
        <p v-if="!trash.items.length" class="muted small">{{ t('settings.trashEmpty') }}</p>
        <button v-if="trash.items.length" class="btn btn--block mt2 danger" @click="confirmEmptyTrash = true">{{ t('settings.emptyTrash') }}</button>
      </div>
    </section>

    <!-- Dossier de sauvegarde (SAF) — mode nominal : la sauvegarde
         écrit en continu (débouncée sur mutation), plus de boutons explicites
         « Sauvegarder »/« Restaurer ». Le composant affiche lui-même l'état de
         synchro (dernière sauvegarde, « Synchroniser maintenant » en secours). -->
    <SafFolderSection />

    <!-- Aide (lot « visite guidée », 23/09/2026) : relance à la demande de la visite
         guidée du lecteur, sur le projet d'exemple retrouvé ou recréé au besoin par
         `useStartTour`. Bouton SECONDAIRE (`btn btn--block`, jamais
         `btn--primary`) : cf. tests/e2e/settings-single-primary.spec.js, un seul bouton
         plein par écran (déjà pris par « Enregistrer » dans le bloc Profil). -->
    <section class="block">
      <h2 class="block__title">{{ t('settings.help.title') }}</h2>
      <button class="btn btn--block" data-test="replay-tour" @click="startTour">
        {{ t('settings.help.replayTour') }}
      </button>
      <p class="muted small mt2">{{ t('settings.help.replayTourHint') }}</p>
    </section>

    <!-- Contribuer -->
    <section class="block">
      <h2 class="block__title">{{ t('settings.contribute') }}</h2>
      <!-- « Suggérer une amélioration » mène aux TICKETS du dépôt public depuis le 10/08/2026
           (décision produit). Elle ouvrait jusque-là le client mail, comme « Nous contacter »
           (À propos) — les deux menaient au même endroit, ce qui n'aidait personne.
           POURQUOI ICI ET PAS SUR « NOUS CONTACTER » : mesuré sur un Pixel 7 le 10/08, ouvrir un
           lien github.com sur un téléphone où l'app GitHub est installée affiche
           « Sign in to GitHub.com » — écrire un ticket exige un compte, et même la simple
           consultation passe par cet écran. Cette rangée-ci s'adresse à quelqu'un qui propose
           une amélioration, donc plus susceptible d'en avoir un ; « Nous contacter » garde le
           mail, seule porte qui ne demande rien à une tricoteuse qui ne code pas.
           ⚠️ `curl` recevait pourtant la page publique en 200 : la vérification en ligne de
           commande ne voit PAS ce que voit l'appareil. C'est l'essai sur device qui a tranché.
           `target`/`rel` comme la rangée Ko-fi ci-dessous : sur Android, Capacitor voit un hôte
           étranger à l'app et ouvre le navigateur système (la page de l'app n'est jamais
           remplacée) ; côté web, `rel` coupe l'accès `window.opener`.
           Plus de `v-if` : l'adresse est une constante non vide. -->
      <a
        class="link-row"
        data-test="settings-link-suggest"
        :href="GITHUB_ISSUES_URL"
        target="_blank"
        rel="noopener"
      >
        {{ t('settings.suggest') }}
      </a>
      <!-- Don « offrez-moi un café » : page Ko-fi ouverte le 05/08, adresse dans
           src/constants/app-links.js (avec la note sur la politique Play). Sur Android,
           `target="_blank"` n'ouvre pas d'onglet — Capacitor n'active pas les fenêtres
           multiples — mais `Bridge.launchIntent` voit un hôte étranger à l'app et lance le
           navigateur système ; la page de l'app n'est donc jamais remplacée. `target`/`rel`
           restent utiles côté web (aperçu navigateur) et coupent l'accès `window.opener`. -->
      <a
        class="link-row link-row--icon"
        data-test="settings-link-support"
        :href="KOFI_URL"
        target="_blank"
        rel="noopener"
      >
        <AppIcon name="kofiCup" :size="16" />
        {{ t('settings.support') }}
      </a>
    </section>

    <ConfirmDialog
      :open="pendingCurrency !== null"
      :title="t('settings.currencyChangeTitle')"
      :message="t('settings.currencyChangeMessage', { currency: pendingCurrency || '' })"
      :confirm-label="t('settings.currencyChangeConfirm')"
      :cancel-label="t('common.cancel')"
      @confirm="confirmCurrency"
      @cancel="cancelCurrency"
    />
    <ConfirmDialog
      :open="confirmEmptyTrash"
      :title="t('settings.emptyTrashTitle')"
      :message="t('settings.emptyTrashMessage')"
      :confirm-label="t('settings.emptyTrash')"
      :cancel-label="t('common.cancel')"
      danger
      @confirm="doEmptyTrash"
      @cancel="confirmEmptyTrash = false"
    />
  </main>
</div>
</template>

<style scoped>
.block { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-4); margin-bottom: var(--sp-4); box-shadow: var(--clay-sm); }
.block__title { font-size: 17px; margin-bottom: var(--sp-3); }
.mt { margin-top: var(--sp-3); }
.mt2 { margin-top: var(--sp-2); }
.small { font-size: 12.5px; }
.exports { display: flex; gap: var(--sp-2); margin-top: var(--sp-1); }
.exports .btn { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.muted { color: var(--ink-55); }
.toggle { display: flex; gap: var(--sp-2); background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 4px; }
.toggle__opt { flex: 1; border: none; background: transparent; color: var(--ink-55); font-weight: 600; padding: 9px; border-radius: var(--r-pill); }
/* fond --sage : solide, ne suit PAS la teinte → texte clair statique --on-solid (jamais
   le --on-accent flippant de la bande chaude claire) */
.toggle__opt--on { background: var(--sage); color: var(--on-solid); }
.accent-swatches { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.accent-swatch { width: 36px; height: 36px; border-radius: 50%; border: 2px solid var(--line); padding: 0; cursor: pointer; }
.accent-swatch--on { border-color: var(--ink); box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--ink); }
/* Barre de teinte : vrai <input type=range> habillé en dégradé — même convention que
   .cpick__hue (ColorPickerDialog.vue) : natif = clavier accessible gratuitement. */
.accent-hue { width: 100%; height: 32px; -webkit-appearance: none; appearance: none; border-radius: var(--r-pill); }
.accent-hue::-webkit-slider-thumb { -webkit-appearance: none; width: 24px; height: 24px; border-radius: 50%; background: #fff; border: 2px solid var(--ink); box-shadow: var(--clay-sm); }
.trash-toggle { display: flex; align-items: center; gap: var(--sp-2); width: 100%; text-align: left; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font-weight: 600; padding: 11px 13px; border-radius: var(--r-sm); }
.trash { margin-top: var(--sp-2); }
.trash-row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: 10px 0; border-bottom: 1px solid var(--line-soft); font-size: 14px; }
.link { border: none; background: transparent; color: var(--brand-deep); font-weight: 600; }
.danger { color: var(--danger); }
.link-row { display: block; padding: 11px 0; color: var(--brand-deep); font-weight: 600; text-decoration: none; border-bottom: 1px solid var(--line-soft); }
.link-row--icon { display: flex; align-items: center; gap: var(--sp-2); }
</style>

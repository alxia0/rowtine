<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useProjectsStore } from '@/stores/projects'
import { usePatternsStore } from '@/stores/patterns'
import { applyTheme } from '@/theme/apply'
import { defaultsForLocale } from '@/utils/locale-defaults'
import { LANGUAGES } from '@/constants/languages'
import { CURRENCIES } from '@/constants/currencies'
import { currencySymbol } from '@/utils/units'
import { getSetting, setSetting } from '@/db/db'
import { detectDeviceLocale } from '@/utils/app-locale'
import { recordSeededSamples } from '@/utils/seeded-samples'

const router = useRouter()
const { t, locale } = useI18n()
const settings = useSettingsStore()
const projectsStore = useProjectsStore()
const patternsStore = usePatternsStore()

const firstName = ref(settings.firstName)
const technique = ref(settings.defaultTechnique || 'knitting')
// Langue pré-sélectionnée d'après l'appareil (PRÉ-SÉLECTION, pas imposition : la liste
// déroulante reste au-dessus et modifiable) — même logique que les unités et la devise
// juste en dessous.
const lang = ref(settings.locale || detectDeviceLocale())
const theme = ref(settings.theme || 'system')

// Pré-sélection d'après la langue de l'appareil — PRÉ-SÉLECTION, pas imposition : les deux
// champs sont visibles et modifiables avant de valider.
//
// NB : `settings.unitSystem`/`settings.currency` ne peuvent PAS servir de garde ici — le store
// les initialise à 'metric'/EUR par défaut (toujours vrais au sens JS), donc
// `settings.unitSystem || guessed.unitSystem` choisirait TOUJOURS la valeur du store et ne
// laisserait jamais passer la déduction, y compris en production. On lit donc la valeur brute
// persistée (Dexie) : un réglage déjà enregistré (retour sur l'écran après un kill de l'appli
// en cours d'onboarding, une fois le premier toggle touché) l'emporte sur la déduction ;
// tant que rien n'est persisté, la déduction s'applique.
const guessed = defaultsForLocale(navigator.language)
const unitSystem = ref(guessed.unitSystem)
const currency = ref(guessed.currency)
const currencyOptions = computed(() =>
  CURRENCIES.map((c) => ({ code: c, label: `${c} (${currencySymbol(c, lang.value)})` })),
)

onMounted(async () => {
  // Garde défensive, PAS un correctif nécessaire au flux normal de l'app — mesuré en revue
  // (30/07) : dans le parcours réel, le garde `beforeEach` de `router/index.js`
  // aligne déjà `i18n.global.locale` sur `settings.locale || detectDeviceLocale()` AVANT que
  // cet écran ne soit monté (le calcul de `lang` juste au-dessus utilise les mêmes sources) —
  // `locale.value` et `lang.value` sont donc déjà égaux ici, et cette ligne ne fait rien sur
  // ce chemin. Elle protège les montages qui CONTOURNENT ce garde : un montage isolé du
  // composant (comme le fait `tests/unit/onboarding-view.spec.js`, describe « pré-sélection
  // de la langue »), où le singleton i18n peut avoir démarré sur une AUTRE langue que celle
  // calculée ici. Preuve par le test : la locale i18n suit bien la pré-sélection quand elles
  // divergent, alors qu'un montage via le flux normal ne l'exercerait jamais.
  if (locale.value !== lang.value) locale.value = lang.value
  const [savedUnitSystem, savedCurrency] = await Promise.all([getSetting('unitSystem'), getSetting('currency')])
  if (savedUnitSystem === 'metric' || savedUnitSystem === 'imperial') unitSystem.value = savedUnitSystem
  if (CURRENCIES.includes(savedCurrency)) currency.value = savedCurrency
})

// Persistés en direct, exactement comme la langue et le thème.
function setUnitSystem(v) {
  unitSystem.value = v
  settings.saveUnits({ unitSystem: v })
}
function setCurrency(e) {
  currency.value = e.target.value
  settings.saveUnits({ currency: currency.value })
}

// Change la langue en direct (et la persiste) dès le 1er écran.
function setLang(e) {
  lang.value = e.target.value
  locale.value = lang.value
  settings.saveProfile({ locale: lang.value })
}

// Applique le thème en direct (aperçu immédiat) et le persiste dès le 1er écran,
// à l'identique de setLang() pour la langue.
function setTheme(v) {
  theme.value = v
  applyTheme(v)
  settings.saveTheme(v)
}

// Texte adaptatif selon la technique (feedback 28/06, point 17).
const startLabel = computed(() =>
  technique.value === 'crochet' ? t('onboarding.startCrochet') : t('onboarding.startKnitting'),
)

// Garde anti double-tap, DISTINCTE de la garde `settings.onboarded` ci-dessous et nécessaire
// en plus d'elle : `onboarded` ne passe à vrai qu'à `completeOnboarding`, donc APRÈS
// `saveUnits` et `saveProfile` — trois écritures Dexie en file pendant lesquelles le bouton
// reste actif. Deux taps rapprochés franchissent tous deux la garde, et `seedSamplesIfEmpty` /
// `seedExamplesIfEmpty` sont des lire-puis-écrire hors transaction : les deux exécutions voient
// une base vide et sèment SIX patrons de démonstration et QUATRE projets démo au lieu de trois
// et deux, à supprimer à la main. Même forme que StashView.save() / ProjectEditView.save().
const starting = ref(false)
async function start() {
  if (starting.value) return
  starting.value = true
  try {
    await runStart()
  } finally {
    starting.value = false
  }
}

async function runStart() {
  // Garde (bloquants avant diffusion, 01/08) : sur une base restaurée depuis une
  // sauvegarde, cet écran peut rester monté alors que `settings.onboarded` vient de passer à
  // vrai en cours de session (le routeur ne se ré-évalue que sur une navigation, pas sur ce
  // changement réactif — cf. la restauration proposée par App.vue). Sans cette garde,
  // toucher « Commencer » ici écraserait six réglages ET ressèmerait trois patrons de
  // démonstration par-dessus une bibliothèque déjà restaurée. Preuve : tests/unit/
  // onboarding-view-onboarded-guard.spec.js.
  if (settings.onboarded) {
    router.replace({ name: 'home' })
    return
  }
  // La pré-sélection doit être enregistrée même si l'utilisatrice n'a rien changé : sinon une
  // Américaine qui valide directement retomberait sur le métrique par défaut du store.
  await settings.saveUnits({ unitSystem: unitSystem.value, currency: currency.value })
  // Même raison, cf. juste au-dessus (régression trouvée en revue finale du 31/07, dans mon
  // propre correctif du point 2 de cette même revue) : `setLang()` ne persiste la langue
  // qu'EN DIRECT, quand l'utilisatrice TOUCHE le sélecteur (@change) — celle qui valide la
  // pré-sélection sans y toucher (le cas normal, puisque c'est tout l'objet de la
  // pré-sélection) ne produisait aucune clé `locale` en base. `settings.js::load()` traite
  // alors une utilisatrice onboardée sans `locale` comme une installation ANTÉRIEURE au
  // chantier multilingue (repli sur 'fr', cf. son commentaire) — donc une Allemande qui
  // valide directement l'accueil repassait en français au 2e démarrage. Appel idempotent
  // avec `setLang()` (même valeur si elle a changé la langue, sinon la pré-sélection).
  await settings.saveProfile({ locale: lang.value })
  await settings.completeOnboarding({ firstName: firstName.value, technique: technique.value, theme: theme.value })
  await seedExamples()
  router.replace({ name: 'home' })
}

// Pré-remplit la bibliothèque (3 patrons exemples) et crée DEUX projets démo, chacun lié à
// un patron exemple : un « en cours » (le bonnet) et une « idée » (l'écharpe, depuis le
// 11/08), sans progression (aucune section/compteur/session créés par le semis — corrigé le
// 04/08/2026, l'ancien commentaire ici était périmé). Tolérant aux erreurs : un échec du
// seed ne doit jamais bloquer l'entrée dans l'app.
async function seedExamples() {
  try {
    const { loadDemoContent, DEMO_PATTERN_DEMO_ID, DEMO_PATTERN_IDEA_ID } = await import('@/constants/demo')
    // La langue VALIDÉE à cet écran, pas celle de l'appareil : l'utilisatrice a pu en
    // choisir une autre dans la liste déroulante juste au-dessus.
    const content = await loadDemoContent(lang.value)
    const ids = await patternsStore.seedSamplesIfEmpty(lang.value)
    const demoPattern = content.patterns.find((p) => p.demoId === DEMO_PATTERN_DEMO_ID)
    const demoPatternId = ids[DEMO_PATTERN_DEMO_ID]
    const demo =
      demoPattern && demoPatternId
        ? { name: demoPattern.name, patternId: demoPatternId, sizes: demoPattern.sizes, activeSize: 'M' }
        : null

    // Le projet « idée » est rattaché au patron de démonstration de l'écharpe (11/08) : sa
    // fiche gagne ainsi une image et des instructions par ricochet (photo et sections DU
    // PATRON), là où elle était vide. Aiguilles et échantillon suivent le même patron.
    const ideaPattern = content.patterns.find((p) => p.demoId === DEMO_PATTERN_IDEA_ID)
    const ideaPatternId = ids[DEMO_PATTERN_IDEA_ID]
    const ideaDemo =
      ideaPattern && ideaPatternId
        ? {
            patternId: ideaPatternId,
            needleMm: ideaPattern.needleMm,
            gaugeStitches: ideaPattern.gaugeStitches,
            gaugeRows: ideaPattern.gaugeRows,
          }
        : null

    const seededProjects = await projectsStore.seedExamplesIfEmpty(
      technique.value,
      demo,
      content.projects,
      ideaDemo,
    )

    // Identité du projet sur lequel lancer la visite guidée du lecteur (lot du
    // 23/09/2026) : le projet « en cours » qu'on vient de semer, celui lié au bonnet.
    // `ensureTourProject`
    // (src/utils/tour-sample.js) sait le retrouver — ou le recréer — même sans cette
    // écriture (installations antérieures à cette fonctionnalité), mais l'enregistrer dès
    // le semis évite un aller-retour Dexie superflu au premier lancement de la visite.
    if (seededProjects?.wipId != null) await setSetting('tourProjectId', seededProjects.wipId)

    // Le patron libre reste créé ici (il sert de repli à toute création de projet sans
    // patron, cf. ProjectEditView), mais les DEUX projets semés portent désormais leur
    // patron : `migrateFreeProjects` ne touche que `patternId == null` et les laisse donc
    // tranquilles. L'appel est conservé — il sert encore aux projets libres de
    // l'utilisatrice, et App.vue le rejoue à chaque démarrage.
    await patternsStore.ensureFreePattern(lang.value)
    await projectsStore.migrateFreeProjects(patternsStore.freePatternId)

    // Mémorise ce que CE semis a créé : c'est ce qui permettra plus tard de
    // reconnaître une base « neuve avec ses exemples » et d'y proposer une
    // restauration (cf. src/utils/seeded-samples.js). Fait en dernier, une fois
    // les identifiants tous connus.
    await recordSeededSamples({
      patterns: Object.values(ids),
      projects: [seededProjects?.ideaId, seededProjects?.wipId],
    })
  } catch (e) {
    console.error('Seed des exemples impossible', e)
  }
}
</script>

<template>
  <main class="screen onb">
    <h1 class="onb__title">{{ t('onboarding.welcome') }}</h1>
    <p class="onb__baseline">{{ t('app.baseline') }}</p>

    <div class="card onb__card">
      <!-- Liste déroulante (retour ergonomie device, 29/07) : remplace la bascule à 4 boutons,
           trop encombrante sur deux rangées et moins lisible qu'une liste (retour d'usage sur
           Nexus 7). Même facture que le sélecteur de devise juste en dessous : label associé par
           `for`/`id`, `<select class="input">`, `:value` + `@change`. Libellés non traduits,
           cf. LANGUAGES (chacun reste dans SA langue, jamais une clé i18n). -->
      <label class="field-label" for="onb-language">{{ t('onboarding.language') }}</label>
      <select id="onb-language" class="input" data-test="onb-language" :value="lang" @change="setLang">
        <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.label }}</option>
      </select>

      <label class="field-label onb__tech-label" for="fn">{{ t('onboarding.firstName') }}</label>
      <input
        id="fn"
        v-model="firstName"
        class="input"
        type="text"
        :placeholder="t('onboarding.firstNamePlaceholder')"
      />

      <p class="field-label onb__tech-label">{{ t('onboarding.technique') }}</p>
      <div class="toggle">
        <button
          class="toggle__opt"
          :class="{ 'toggle__opt--on': technique === 'knitting' }"
          @click="technique = 'knitting'"
        >
          {{ t('onboarding.knitting') }}
        </button>
        <button
          class="toggle__opt"
          :class="{ 'toggle__opt--on': technique === 'crochet' }"
          @click="technique = 'crochet'"
        >
          {{ t('onboarding.crochet') }}
        </button>
      </div>

      <p class="field-label onb__tech-label">{{ t('theme.label') }}</p>
      <div class="toggle">
        <button
          v-for="opt in ['system', 'light', 'dark']"
          :key="opt"
          class="toggle__opt"
          :class="{ 'toggle__opt--on': theme === opt }"
          @click="setTheme(opt)"
        >
          {{ t(`theme.${opt}`) }}
        </button>
      </div>

      <p class="field-label onb__tech-label">{{ t('settings.unitsAndCurrency') }}</p>
      <div class="toggle">
        <button
          class="toggle__opt"
          :class="{ 'toggle__opt--on': unitSystem === 'metric' }"
          data-test="onb-units-metric"
          @click="setUnitSystem('metric')"
        >
          {{ t('settings.unitsMetric') }}
        </button>
        <button
          class="toggle__opt"
          :class="{ 'toggle__opt--on': unitSystem === 'imperial' }"
          data-test="onb-units-imperial"
          @click="setUnitSystem('imperial')"
        >
          {{ t('settings.unitsImperial') }}
        </button>
      </div>

      <label class="field-label mt2" for="onb-currency">{{ t('settings.currencyLabel') }}</label>
      <select id="onb-currency" class="input" data-test="onb-currency" :value="currency" @change="setCurrency">
        <option v-for="o in currencyOptions" :key="o.code" :value="o.code">{{ o.label }}</option>
      </select>
    </div>

    <div class="onb__cta-bar">
      <button class="btn btn--primary btn--block" :disabled="starting" @click="start">{{ startLabel }}</button>
    </div>
  </main>
</template>

<style scoped>
.onb {
  /* Zone sûre du HAUT (retour device Pixel 7, 09/08) : depuis targetSdk 35 la WebView
     s'affiche bord à bord, barre d'état comprise. Toutes les autres vues réservent ce haut
     dans leur en-tête (AppHeader.vue, mais aussi les en-têtes propres de PatternView,
     ProjectDetailView et ReaderView) ; `.screen` ne le fait PAS, et l'écran de bienvenue est
     le seul sans en-tête — son titre passait donc sous la barre d'état.
     `calc()` et non `max()` comme AppHeader : ici --sp-6 n'est pas une marge technique mais
     l'air voulu au-dessus d'un grand titre. Avec `max()`, sur un appareil dont l'inset
     dépasse 24px, ce blanc disparaîtrait et le titre collerait à la barre d'état.
     Clavier OUVERT (retour du 31/08/2026, capture : le champ prénom derrière l'horloge), ce
     padding ordinaire ne suffit plus : le défilement demandé par keyboard-avoidance.js
     l'emporte au focus du champ prénom. Le dégagement y est PLANCHÉ sur --sa-top dans
     measureStickyTopHeight() (sticky-top.js) — aucun bandeau collant à découvrir sur
     cette vue — : le champ focalisé reste au-dessous de la barre d'état, comme sur les
     écrans à en-tête collant. */
  padding-top: calc(var(--sp-6) + var(--sa-top));
  /* Le bas n'est plus géré par .screen (qui réserve calc(--sp-8 + safe-area)) : c'est
     désormais la barre collante .onb__cta-bar qui gère sa propre zone sûre, comme le fait
     .correct__actions dans CorrectionView.vue. */
  padding-bottom: 0;
}
.onb__title {
  font-size: 34px;
  line-height: 1.1;
}
.onb__baseline {
  color: var(--ink-55);
  margin: var(--sp-2) 0 var(--sp-5);
}
.onb__card {
  margin-bottom: var(--sp-5);
}
.onb__tech-label {
  margin-top: var(--sp-4);
}
.mt2 {
  margin-top: var(--sp-2);
}
.toggle {
  display: flex;
  gap: var(--sp-2);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  padding: 4px;
}
.toggle__opt {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--ink-55);
  font-weight: 600;
  font-size: 15px;
  padding: 10px;
  border-radius: var(--r-pill);
}
.toggle__opt--on {
  background: var(--sage);
  /* fond solide ne suivant pas la teinte : texte clair statique --on-solid (jamais
     le --on-accent flippant de la bande chaude claire) */
  color: var(--on-solid);
}
/* Bouton de validation collant en bas de la zone de défilement (un arbitrage,
   25/07) : l'écran a grandi de 2 champs et ne tient plus sans défilement sur petit
   viewport (mesuré 393×727). Motif repris à l'identique de .correct__actions
   (CorrectionView.vue) : fond opaque + bordure prises dans les variables du projet
   (jamais de couleur écrite en dur), zone sûre du bas respectée comme le fait déjà
   AppHeader pour le haut. */
.onb__cta-bar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  margin: 0 calc(-1 * var(--sp-4));
  padding: var(--sp-3) var(--sp-4);
  padding-bottom: calc(var(--sp-3) + var(--sa-bottom));
  background: var(--bg);
  border-top: 1px solid var(--line);
}
</style>

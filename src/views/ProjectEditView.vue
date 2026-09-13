<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import FieldHelp from '@/components/FieldHelp.vue'
import { useProjectsStore, emptyProject, needlesPatch } from '@/stores/projects'
import { useYarnsStore } from '@/stores/yarns'
import { usePatternsStore } from '@/stores/patterns'
import { useSettingsStore } from '@/stores/settings'
import { useSnackbarStore } from '@/stores/snackbar'
import { useProjectConsumption } from '@/composables/useProjectConsumption'
import { STATUS_ORDER, TECHNIQUES } from '@/constants/status'
import { fillProjectFromPattern } from '@/utils/project-fill'
import { shouldDeriveDone } from '@/utils/project-finished-at'
import { reservationsOf, availableForProject, setProjectReservation } from '@/utils/yarn-usage'
import { matchesBrand, NO_BRAND } from '@/utils/yarn-filter'
import AppIcon from '@/components/AppIcon.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppToggle from '@/components/AppToggle.vue'
import YarnConsumptionDialog from '@/components/YarnConsumptionDialog.vue'
import PatternPriceFields from '@/components/PatternPriceFields.vue'
import { priceOwnerId } from '@/utils/pattern-price'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectsStore = useProjectsStore()
const yarnsStore = useYarnsStore()
const patternsStore = usePatternsStore()
const settings = useSettingsStore()
const snackbar = useSnackbarStore()
const projectConsumption = useProjectConsumption()

const isEdit = computed(() => !!route.params.id)
const pid = computed(() => (isEdit.value ? Number(route.params.id) : null))
const form = reactive(emptyProject())
const nameInput = ref(null) // pour focus auto si erreur de validation
const nameError = ref('') // message d'erreur inline sous le champ Nom
// Plus de champ visible ici (11/09) : sizesText n'est plus alimenté QUE par le patron lié
// (hydratation + applyPatternPatch ci-dessous). Il reste nécessaire pour peupler le menu
// « Taille tricotée » (sizeOptions) et pour form.sizes à l'enregistrement.
const sizesText = ref('')
const selectedYarnIds = ref([]) // laines liées (source unique : yarn.reservations[pid])
const yarnQty = reactive({}) // yarnId -> nb de pelotes utilisées par ce projet
const patternSel = ref('') // id du patron lié (chaîne du <select>) ; '' = aucun
const originalPatternId = ref(null) // pour détecter un changement de patron
const hydrating = ref(true) // true tant que le montage initial n'est pas fini (ignore le watch de préremplissage)

// Prix du patron (depuis le 07/08). Il vit sur le PATRON, pas sur le projet : un patron acheté 18 €
// et tricoté trois fois n'a coûté 18 €, pas 54 €. Ce formulaire n'est donc qu'un point de
// SAISIE — l'écriture va dans la fiche du patron sélectionné (cf. `save()`).
const priceForm = reactive({ price: '', purchasedAt: '' })
// N'écrire QUE si l'utilisatrice a touché aux champs. Sans ce garde, ouvrir puis enregistrer
// un projet sans rien changer réécrirait la fiche du patron — donc ré-estamperait
// `priceCurrency` avec la devise du MOMENT, qui peut avoir changé depuis l'achat.
const priceDirty = ref(false)

const selectedPattern = computed(() =>
  patternSel.value ? patternsStore.patterns.find((p) => p.id === Number(patternSel.value)) || null : null,
)
// Le porteur du prix : le patron lui-même s'il vient de la bibliothèque, son ORIGINE si c'est
// une copie de travail, `null` s'il n'y a nulle part où écrire.
const priceOwner = computed(() => priceOwnerId(selectedPattern.value))
// La raison affichée ne vaut QUE pour le patron libre (gabarit partagé) — seul cas où le champ
// reste visible mais fermé, avec une explication. Même motif que `PatternForm.vue:41`.
const priceHiddenReason = computed(() => (selectedPattern.value?.builtin ? 'builtin' : null))
// Le composant n'est présenté DU TOUT que s'il y a quelque part où écrire (le patron libre,
// bien que sans porteur, reste présenté pour SON message via priceHiddenReason ci-dessus).
// Sans cette garde, un patron sans porteur (aucun patron sélectionné, ou une copie de travail
// sans `sourcePatternId` — cas jugé impossible aujourd'hui, ménage pré-1.0) affichait un champ
// de saisie normal dont la valeur se perdait en silence à l'enregistrement (`priceOwner.value
// != null` dans `save()` refusait déjà l'écriture, mais rien ne le disait à l'écran).
const showPriceFields = computed(() => !!selectedPattern.value?.builtin || priceOwner.value != null)

// Recharge les champs depuis le patron qui PORTE le prix. Distinct d'`applyPatternPatch`, qui
// ne préremplit que les champs DU PROJET : le prix n'est pas un champ du projet, il ne peut
// pas passer par ce chemin.
function loadPatternPrice() {
  const owner = priceOwner.value
  const holder = owner != null ? patternsStore.patterns.find((p) => p.id === owner) : null
  priceForm.price = holder?.price || ''
  priceForm.purchasedAt = holder?.purchasedAt || ''
  priceDirty.value = false
}

// Libellés adaptés à la technique (aiguilles vs crochet, taille tricotée vs crochetée).
const isCrochet = computed(() => form.technique === 'crochet')
const sizeLabel = computed(() => (isCrochet.value ? t('project.activeSizeCrochet') : t('project.activeSize')))
const sizeHint = computed(() => (isCrochet.value ? t('project.activeSizeCrochetHint') : t('project.activeSizeHint')))
// Options du menu « taille tricotée » : parse EN DIRECT la saisie libre des tailles
// (form.sizes n'est calculé qu'à l'enregistrement) + on garde la valeur courante même si
// elle n'y figure pas, pour ne jamais l'écraser en éditant un projet existant.
const sizeOptions = computed(() => {
  const list = sizesText.value.split(',').map((s) => s.trim()).filter(Boolean)
  if (form.activeSize && !list.includes(form.activeSize)) list.push(form.activeSize)
  return list
})

// Pool : une laine est proposable dès qu'il lui reste des pelotes une fois déduites les
// réservations des AUTRES projets (sa propre allocation est en cours d'édition ici).
const selectableYarns = computed(() => yarnsStore.yarns.filter((y) => availableForProject(y, pid.value) > 0))
const brandFilter = ref('')
// Marques proposées : uniquement celles des laines réellement disponibles pour CE projet — un
// menu qui proposerait une marque sans laine disponible mènerait à une liste vide.
const yarnBrandOptions = computed(() => {
  const set = new Set()
  for (const y of selectableYarns.value) if (y.brand && y.brand.trim()) set.add(y.brand.trim())
  return [...set].sort((a, b) => a.localeCompare(b))
})
const hasUnbrandedSelectable = computed(() => selectableYarns.value.some((y) => !String(y.brand || '').trim()))
// Laines montrées : celles déjà cochées pour ce projet (TOUJOURS visibles, quelle que soit la
// marque filtrée — jamais l'impression d'une sélection perdue) + celles de la marque choisie.
// Contrairement à StashView, une marque vide n'affiche PAS tout le catalogue : c'est le but
// même de ce chantier (raccourcir l'écran par défaut).
const visibleYarns = computed(() => {
  const checkedIds = new Set(selectedYarnIds.value)
  const checked = selectableYarns.value.filter((y) => checkedIds.has(y.id))
  if (!brandFilter.value) return checked
  const filtered = selectableYarns.value.filter((y) => !checkedIds.has(y.id) && matchesBrand(y, brandFilter.value))
  return [...checked, ...filtered]
})
function toggleYarn(id) {
  const i = selectedYarnIds.value.indexOf(id)
  if (i === -1) {
    selectedYarnIds.value.push(id)
    if (yarnQty[id] == null) {
      const y = yarnsStore.yarns.find((v) => v.id === id)
      // Par défaut : 1 pelote (décision produit, 16/07). Prendre tout le disponible par
      // défaut réservait la laine entière en silence — l'usage partiel devenait invisible
      // (used === total ⇒ pas de « x/N » sur le badge du stock).
      yarnQty[id] = Math.min(1, availableForProject(y, pid.value)) || 1
    }
  } else {
    selectedYarnIds.value.splice(i, 1)
  }
}
function setYarnQty(id, e) {
  const y = yarnsStore.yarns.find((v) => v.id === id)
  const max = availableForProject(y, pid.value) || 1
  yarnQty[id] = Math.min(max, Math.max(1, Number(e.target.value) || 1))
}

onMounted(async () => {
  // Réglages (unitSystem) : nécessaires pour choisir le libellé de l'échantillon (mailles/
  // rangs par 10 cm vs par 4 po) — cf. section « mesures » plus bas. En usage réel le garde
  // de route (router/index.js) a déjà chargé les réglages ; ce filet couvre le montage direct
  // (tests). Attendu comme HomeView/StashView (décision produit, revue du 26/07) : on ne
  // façonne pas le code de production pour arranger un test — la contention observée en
  // suite était un délai fixe côté test trop court, pas une raison de rendre ce chargement
  // non bloquant ici.
  if (!settings.loaded) await settings.load()
  if (!yarnsStore.loaded) await yarnsStore.load()
  if (!patternsStore.loaded) await patternsStore.load()
  await patternsStore.ensureFreePattern(settings.locale)
  if (isEdit.value) {
    const p = await projectsStore.get(route.params.id)
    if (p) {
      Object.assign(form, p)
      // Vieux projet sans showTimer en base : le défaut est « affiché » (emptyProject()).
      // Sans ce garde, Object.assign poserait undefined dans le formulaire et la case
      // s'afficherait DÉCOCHEE — une simple ouverture + enregistrement écrirait alors
      // showTimer:false sous les pieds de l'utilisatrice, sans aucun geste de masquage.
      form.showTimer = p.showTimer ?? true
      // Vieux projet (scalaires needleMm/needleUs) : reconstruire la liste + retirer les scalaires.
      const np = needlesPatch(p)
      if (np) {
        form.needles = np.needles
        delete form.needleMm
        delete form.needleUs
      }
      // Toujours au moins une ligne (un projet enregistré sans aiguille a needles: []).
      if (!form.needles.length) form.needles.push({ mm: '', us: '' })
      sizesText.value = (p.sizes || []).join(', ')
      selectedYarnIds.value = yarnsStore.yarns.filter((y) => reservationsOf(y)[p.id] != null).map((y) => y.id)
      for (const y of yarnsStore.yarns) {
        const q = reservationsOf(y)[p.id]
        if (q != null) yarnQty[y.id] = q
      }
      patternSel.value = p.patternId != null ? String(p.patternId) : ''
      originalPatternId.value = p.patternId ?? null
    }
  } else if (route.query.pattern) {
    // Création « à partir d'un patron » : pré-remplir depuis le patron.
    const pat = patternsStore.patterns.find((p) => p.id === Number(route.query.pattern))
    if (pat) {
      patternSel.value = String(pat.id)
      applyPatternPatch(pat)
    }
  }
  if (!isEdit.value && !patternSel.value && patternsStore.freePatternId) {
    patternSel.value = String(patternsStore.freePatternId)
  }
  // Premier chargement : le `watch` ci-dessus est inhibé pendant l'hydratation, il ne l'a donc
  // pas fait. Sans cette ligne, ouvrir un projet dont le patron porte un prix afficherait un
  // champ vide — et l'enregistrer l'effacerait si l'utilisatrice y touchait.
  loadPatternPrice()
  // Laisse le watch (déclenché par les assignations de patternSel ci-dessus) se vider
  // AVANT de baisser le flag, sinon il s'exécuterait juste après avec hydrating déjà à false.
  await nextTick()
  hydrating.value = false
})

const patternOptions = computed(() => patternsStore.selectablePatterns)

// Applique le préremplissage calculé par le helper pur, met à jour form + sizesText.
function applyPatternPatch(pattern) {
  const patch = fillProjectFromPattern(pattern, form)
  Object.assign(form, patch)
  if (patch.sizes) sizesText.value = patch.sizes.join(', ')
}

// Sélection d'un patron (par l'utilisateur) : préremplit les champs vides du formulaire.
// Ignoré pendant l'hydratation initiale (montage) pour ne jamais écraser un projet existant.
watch(patternSel, (val) => {
  if (hydrating.value) return
  // Le prix se recharge à CHAQUE changement de sélection, y compris vers « aucun patron » —
  // d'où sa place AVANT le `return` ci-dessous, qui ne concerne que le préremplissage des
  // champs du projet.
  loadPatternPrice()
  if (!val) return
  const pattern = patternsStore.patterns.find((p) => p.id === Number(val))
  // Le patron libre builtin est un simple gabarit vide ("Patron libre") : pas de contenu
  // pertinent à reprendre (son nom ne doit pas écraser celui du projet).
  if (pattern && !pattern.builtin) applyPatternPatch(pattern)
})

// Une seule fonction plutôt que deux expressions dans le gabarit : la mutation de l'objet
// réactif et le marquage « touché » vont toujours ensemble, les séparer inviterait à en
// oublier une.
function onPriceInput(next) {
  Object.assign(priceForm, next)
  priceDirty.value = true
}

function setStars(n) {
  form.stars = form.stars === n ? n - 1 : n
}

// Applique les liaisons de laines : écrit/retire l'allocation de CE projet dans le pool
// de chaque laine (les allocations des autres projets ne sont jamais touchées).
async function applyYarnLinks(projectId) {
  for (const y of selectableYarns.value) {
    const linked = selectedYarnIds.value.includes(y.id)
    const before = reservationsOf(y)[projectId] ?? null
    const max = availableForProject(y, projectId) || 1
    const want = linked ? Math.min(max, Math.max(1, Number(yarnQty[y.id]) || max)) : null
    if (before === want) continue
    await yarnsStore.update(y.id, { reservations: setProjectReservation(y, projectId, want) })
  }
}

function addNeedle() {
  form.needles.push({ mm: '', us: '' })
}
function removeNeedle(i) {
  form.needles.splice(i, 1)
  if (!form.needles.length) form.needles.push({ mm: '', us: '' })
}

// 3ᵉ point d'entrée vers Terminé/Abandonné (R2) : les pastilles de statut
// (`.chips` ci-dessous) ne font que poser `form.status` — le statut n'est réel qu'à
// l'ENREGISTREMENT. La question « combien de pelotes as-tu utilisées/perdues ? » (R3)
// est donc posée ICI, dans `save()`, APRÈS `applyYarnLinks` (les réservations doivent
// exister avant de demander combien en a été utilisé) — jamais au clic sur une pastille,
// sinon on consommerait pour un statut que l'utilisateur peut encore changer avant de
// valider. Couvre aussi la création directe d'un projet en Terminé/Abandonné avec des
// laines liées : les réservations viennent tout juste d'être créées par `applyYarnLinks`.
async function finishSave(projectId) {
  snackbar.show(isEdit.value ? t('project.saved') : t('project.created'))
  router.replace({ name: 'project', params: { id: projectId } })
}

// Garde anti double-tap — même défaut et même forme que StashView.save() (constaté en
// revue), qui n'avait pas été reportée ici : entre le clic et la navigation de `finishSave`,
// la branche CRÉATION enchaîne `projectsStore.create()` puis `applyYarnLinks()`, deux écritures
// Dexie pendant lesquelles le bouton reste actif et non désarmé. Deux taps rapprochés (fenêtre
// mesurable sur la tablette) créent DEUX projets identiques et DEUX jeux de réservations de
// laine. Enveloppe plutôt que try/finally autour du corps : même garantie, sans réindenter les
// soixante-dix lignes de `saveProject()` ni ses retours anticipés.
const saving = ref(false)
async function save() {
  if (saving.value) return
  saving.value = true
  try {
    await saveProject()
  } finally {
    saving.value = false
  }
}

async function saveProject() {
  if (!form.name.trim()) {
    nameError.value = t('project.nameRequired')
    nameInput.value?.focus()
    return
  }
  nameError.value = ''
  form.sizes = sizesText.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  // Champ « Tailles » retiré de cet écran (11/09) : les tailles vivent désormais sur le
  // patron, corrigées depuis SON écran. `form.sizes` ne peut donc plus qu'être vide ou hérité
  // du patron — la garde ne doit effacer la taille tricotée que si une VRAIE liste existe et
  // ne la contient pas, sinon toute saisie libre (pas de patron, ou patron sans tailles)
  // serait effacée en silence à chaque enregistrement.
  if (form.sizes.length && form.activeSize && !form.sizes.includes(form.activeSize)) form.activeSize = ''

  // Patron lié : détecter un changement.
  const newPatternId = patternSel.value ? Number(patternSel.value) : null
  const patternChanged = newPatternId !== (originalPatternId.value ?? null)
  const willReplaceSections = patternChanged && newPatternId !== null
  form.patternId = newPatternId
  // Évite un activeSectionId (et un chrono) pointant vers une section supprimée.
  if (willReplaceSections) form.activeSectionId = null

  // Aiguilles : ne garder que les entrées renseignées. (Les scalaires hérités
  // needleMm/needleUs sont déjà purgés de la base par la migration au load du store.)
  const payload = { ...form, needles: form.needles.filter((n) => n.mm?.trim() || n.us?.trim()) }
  // JOURNAL DES JOURS ACTIFS (§7ter) — cet écran est un RÉGLAGE, jamais un geste de
  // progression. En édition, `form.lastWorkedAt` porte la valeur EXISTANTE du projet
  // (Object.assign(form, p) au montage, plus haut) : la renvoyer telle quelle dans le patch
  // ferait passer un simple renommage/réglage par le goulot de projectsStore.update(), qui
  // inscrirait au journal un jour où aucun tricot n'a eu lieu — contredisant le contrat de
  // `lastWorkedAt` (emptyProject(), src/stores/projects.js) et reconstruisant une partie du
  // passé (fermé par cette règle). Retirée sur les DEUX branches (update et create) pour que
  // la règle « ce champ ne se réécrit jamais depuis ce formulaire » soit uniforme — `create()`
  // ne la porte de toute façon jamais (emptyProject() la pose à ''), mais un formulaire de
  // réglage ne doit structurellement jamais reporter ce témoin.
  delete payload.lastWorkedAt
  // RÈGLE 2 (§7bis) — renseigner une date de fin termine le projet. ICI et pas dans
  // projectsStore.update() : la clôture doit passer par requestStatusChange (plus bas), sinon
  // le dialogue « combien de pelotes as-tu utilisées ? » ne s'ouvre pas et le stock reste faux.
  // AVANT l'update ci-dessous, pas seulement avant requestStatusChange : la règle 1 estamperait
  // sinon la date du jour par-dessus la date qui vient d'être tapée.
  // Ne vaut que dans le sens « renseigner » : effacer une date ne dé-termine pas un projet.
  const avant = isEdit.value ? await projectsStore.get(route.params.id) : null
  if (shouldDeriveDone(avant, payload)) payload.status = 'done'
  let projectId
  if (isEdit.value) {
    await projectsStore.update(route.params.id, payload)
    projectId = Number(route.params.id)
  } else {
    projectId = await projectsStore.create(payload)
  }
  await applyYarnLinks(projectId)
  // Le prix va dans la fiche du PATRON, jamais dans le projet. Écrit seulement si
  // l'utilisatrice y a touché (cf. `priceDirty`), et la devise n'est estampillée que s'il y a
  // un montant — sinon un prix effacé garderait la devise d'un achat qui n'existe plus.
  if (priceDirty.value && priceOwner.value != null) {
    await patternsStore.update(priceOwner.value, {
      price: priceForm.price,
      priceCurrency: String(priceForm.price || '').trim() ? settings.currency : '',
      purchasedAt: priceForm.purchasedAt,
    })
  }
  // Ordre voulu : la question (si nécessaire) est posée APRÈS que les réservations
  // existent bel et bien. `requestStatusChange` ne bloque jamais en attendant la réponse
  // de l'utilisateur (cf. useProjectConsumption.js) — c'est pourquoi la suite (message +
  // navigation) est déléguée à `finishSave`, exécuté immédiatement s'il n'y a pas de
  // question à poser (statut ni 'done' ni 'abandoned', ou aucune laine réservée), ou en
  // différé une fois la consommation appliquée (Valider, ou l'un de ses défauts croix/
  // scrim/Échap/Retour Android).
  await projectConsumption.requestStatusChange({ id: projectId }, payload.status, () => finishSave(projectId))
}
</script>

<template>
<div>
  <AppHeader :title="isEdit ? t('project.editTitle') : t('project.newTitle')" back />
  <main class="screen">
    <section class="card">
      <h2 class="card__title">{{ t('project.sectionIdentity') }}</h2>
      <label class="field-label" for="name">{{ t('project.name') }} <span class="req">*</span></label>
      <input
        id="name"
        ref="nameInput"
        v-model="form.name"
        class="input"
        :class="{ 'input--err': nameError }"
        type="text"
        :aria-invalid="!!nameError"
        :placeholder="t('project.namePlaceholder')"
        @input="nameError = ''"
      />
      <p v-if="nameError" class="field-err" role="alert">{{ nameError }}</p>

      <FieldHelp class="mt" for="project-pattern" :label="t('project.pattern')" :hint="t('project.patternHint')" />
      <select id="project-pattern" v-model="patternSel" class="input pattern-sel">
        <option v-for="p in patternOptions" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
      </select>

      <!-- Pas de `v-model` ici : `PatternPriceFields` émet un OBJET NEUF à chaque frappe, et
           `v-model="priceForm"` compilerait en RÉAFFECTATION de la variable — `priceForm`
           cesserait alors d'être l'objet réactif que le reste du script lit, et l'affichage
           se figerait sans qu'aucun test ne le voie. `Object.assign` MUTE l'objet réactif au
           lieu de le remplacer. Même correctif que dans `PatternForm.vue`. -->
      <PatternPriceFields
        v-if="showPriceFields"
        :model-value="priceForm"
        :hidden-reason="priceHiddenReason"
        shared-hint
        @update:model-value="onPriceInput"
      />

      <p class="field-label mt">{{ t('project.status') }}</p>
      <div class="chips">
        <button
          v-for="s in STATUS_ORDER"
          :key="s"
          class="chip"
          :class="{ 'chip--on': form.status === s }"
          @click="form.status = s"
        >
          {{ t(`status.${s}`) }}
        </button>
      </div>

      <!-- Interrupteur « Chrono » (08/09, porte de retour durable du chrono masqué) :
           lit et persiste project.showTimer (défaut true). Le chevron de la pastille et le
           kebab de la fiche restent les gestes RAPIDES ; celui-ci est le réglage posé, qui
           survit à tout. -->
      <AppToggle v-model="form.showTimer" class="mt" :aria-label="t('project.timerField')">
        {{ t('project.timerField') }}
      </AppToggle>
      <p class="muted-hint">{{ t('project.timerFieldHint') }}</p>
    </section>

    <section class="card">
      <h2 class="card__title">{{ t('project.yarns') }}</h2>
      <p v-if="!selectableYarns.length" class="muted-hint">{{ t('project.yarnsEmpty') }}</p>
      <template v-else>
        <label class="sort ypick__brandfilter">
          <span class="sort__lbl">{{ t('yarn.brand') }}</span>
          <select v-model="brandFilter" class="input sort__sel">
            <option value="">{{ t('project.yarnsBrandPlaceholder') }}</option>
            <option v-for="b in yarnBrandOptions" :key="b" :value="b">{{ b }}</option>
            <option v-if="hasUnbrandedSelectable" :value="NO_BRAND">{{ t('yarn.brandNone') }}</option>
          </select>
        </label>
        <p v-if="!visibleYarns.length" class="muted-hint">{{ t('project.yarnsPickBrand') }}</p>
        <div v-else class="ypick">
          <div v-for="y in visibleYarns" :key="y.id" class="ypick__row" :class="{ 'ypick__row--on': selectedYarnIds.includes(y.id) }">
            <AppCheckbox class="ypick__pick" :model-value="selectedYarnIds.includes(y.id)" @update:model-value="toggleYarn(y.id)">
              {{ y.brand || '—' }}<template v-if="y.colorName"> · {{ y.colorName }}</template>
            </AppCheckbox>
            <span v-if="selectedYarnIds.includes(y.id)" class="ypick__qty">
              <input
                class="ypick__qtyin"
                type="number"
                min="1"
                :max="availableForProject(y, pid)"
                :aria-label="(y.brand || y.colorName) ? `${t('yarn.quantity')} — ${y.brand || y.colorName}` : t('yarn.quantity')"
                :value="yarnQty[y.id]"
                @input="setYarnQty(y.id, $event)"
              />
              <span class="ypick__unit">/ {{ availableForProject(y, pid) }} {{ t('project.yarnSkeins') }}</span>
            </span>
            <span v-else class="ypick__meta">×{{ availableForProject(y, pid) }}</span>
          </div>
        </div>
      </template>
    </section>

    <!-- `technique` reste dans CE bloc, avec les aiguilles/crochet : isCrochet pilote les
    libellés juste en dessous (t('project.hooks') vs t('project.needles'), placeholders
    différents) — les séparer dans un bloc « Identité » couperait la cause de son effet. -->
    <section class="card">
      <h2 class="card__title">{{ t('project.sectionGear') }}</h2>
      <p class="field-label">{{ t('project.technique') }}</p>
      <div class="toggle">
        <button
          v-for="tech in TECHNIQUES"
          :key="tech"
          class="toggle__opt"
          :class="{ 'toggle__opt--on': form.technique === tech }"
          @click="form.technique = tech"
        >
          {{ t(`technique.${tech}`) }}
        </button>
      </div>

      <label class="field-label mt">{{ isCrochet ? t('project.hooks') : t('project.needles') }}</label>
      <div v-for="(n, i) in form.needles" :key="i" class="needle-row">
        <input v-model="n.mm" class="input" inputmode="decimal" :placeholder="isCrochet ? t('project.hookMm') : t('project.needleMm')" :aria-label="isCrochet ? t('project.hookMm') : t('project.needleMm')" />
        <input v-model="n.us" class="input" :placeholder="isCrochet ? 'H / 5,0' : 'US 7'" :aria-label="isCrochet ? t('project.hookUs') : t('project.needleUs')" />
        <button v-if="form.needles.length > 1" type="button" class="needle-del" :aria-label="t('common.delete')" @click="removeNeedle(i)"><AppIcon name="close" :size="16" /></button>
      </div>
      <button type="button" class="btn btn--block mt2" @click="addNeedle"><AppIcon name="plus" :size="17" /> {{ isCrochet ? t('project.addHook') : t('project.addNeedle') }}</button>
    </section>

    <section class="card">
      <h2 class="card__title">{{ t('project.sectionMeasurements') }}</h2>
      <div class="row">
        <div class="col">
          <FieldHelp
            for="gs"
            :label="settings.unitSystem === 'imperial' ? t('project.gaugeStitchesImperial') : t('project.gaugeStitches')"
            :hint="settings.unitSystem === 'imperial' ? t('project.gaugeHintImperial') : t('project.gaugeHint')"
          />
          <input id="gs" v-model="form.gaugeStitches" class="input" inputmode="numeric" placeholder="20" />
        </div>
        <div class="col">
          <label class="field-label" for="gr">{{ settings.unitSystem === 'imperial' ? t('project.gaugeRowsImperial') : t('project.gaugeRows') }}</label>
          <input id="gr" v-model="form.gaugeRows" class="input" inputmode="numeric" placeholder="28" />
        </div>
      </div>

      <div class="mt">
        <FieldHelp for="asize" :label="sizeLabel" :hint="sizeHint" />
        <select v-if="sizeOptions.length" id="asize" v-model="form.activeSize" class="input">
          <option value="">{{ t('project.activeSizeNone') }}</option>
          <option v-for="s in sizeOptions" :key="s" :value="s">{{ s }}</option>
        </select>
        <input v-else id="asize" v-model="form.activeSize" class="input" placeholder="M" />
      </div>
    </section>

    <section class="card">
      <h2 class="card__title">{{ t('project.sectionDates') }}</h2>
      <div class="row">
        <div class="col">
          <label class="field-label" for="start">{{ t('project.startedAt') }}</label>
          <input id="start" v-model="form.startedAt" class="input" type="date" />
        </div>
        <div class="col">
          <label class="field-label" for="end">{{ t('project.finishedAt') }}</label>
          <input id="end" v-model="form.finishedAt" class="input" type="date" />
        </div>
      </div>

      <p class="field-label mt">{{ t('project.stars') }}</p>
      <div class="stars">
        <button v-for="n in 5" :key="n" class="star" :class="{ 'star--on': n <= form.stars }" :aria-label="t('project.starsValue', { n })" @click="setStars(n)">
          <AppIcon :name="n <= form.stars ? 'starFilled' : 'star'" :size="22" />
        </button>
      </div>

      <label class="field-label mt" for="notes">{{ t('project.notes') }}</label>
      <textarea id="notes" v-model="form.notes" class="input notes" rows="4"></textarea>
    </section>

    <div class="actions">
      <button class="btn" @click="router.back()">{{ t('common.cancel') }}</button>
      <button class="btn btn--primary" :disabled="saving" @click="save">{{ t('common.save') }}</button>
    </div>
  </main>

  <!-- « Combien de pelotes as-tu réellement utilisées/perdues ? » (3ᵉ point d'entrée,
  posée à l'enregistrement si le statut choisi est Terminé/Abandonné et que des laines
  sont réservées — R2 + R3, cf. commentaire de `save()`). -->
  <YarnConsumptionDialog
    :open="projectConsumption.open"
    :yarns="projectConsumption.yarns"
    :mode="projectConsumption.mode"
    @confirm="projectConsumption.confirm"
  />
</div>
</template>

<style scoped>
.mt {
  margin-top: var(--sp-5);
}
/* Blocs titrés : `.card` est la classe globale existante
   (src/styles/tokens.css) — on la réutilise telle quelle, on ajoute seulement l'espacement
   entre cartes consécutives et le style du titre, comme le fait déjà `.block__title` dans
   SettingsView.vue/SafFolderSection.vue pour leur propre carte. */
.card + .card {
  margin-top: var(--sp-4);
}
.card__title {
  font-size: 17px;
  margin-bottom: var(--sp-3);
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
  padding: 10px;
  border-radius: var(--r-pill);
}
.toggle__opt--on {
  background: var(--sage);
  /* fond solide ne suivant pas la teinte : texte clair statique --on-solid (jamais
     le --on-accent flippant de la bande chaude claire) */
  color: var(--on-solid);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.chip {
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--ink-55);
  font-weight: 600;
  font-size: 13px;
  /* Cible tactile du projet (44 px, cf. PatternForm/StashView) : hauteur pilotée par
     min-height, centrage flex, padding vertical nul pour garder la pilule équilibrée. */
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: 0 13px;
  border-radius: var(--r-pill);
}
.chip--on {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--on-accent);
}
.row {
  display: flex;
  gap: var(--sp-3);
}
.col {
  flex: 1;
  /* Sans min-width: 0, une colonne flexible refuse de descendre sous la largeur minimale
     de son contenu — et un champ de saisie de date en impose une, fixée par le navigateur,
     plus large que la demi-colonne à 360px. Même correctif que .needle-row .input ci-dessous.
     NB : ne pas écrire ici la balise input de type date en toutes lettres — le garde-fou
     de tests/unit/select-arrow.spec.js scanne le CONTENU des fichiers et compterait ce
     commentaire comme un champ de date de plus. */
  min-width: 0;
}
.needle-row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  margin-bottom: var(--sp-2);
}
.needle-row .input {
  flex: 1;
  min-width: 0;
}
.needle-del {
  flex: none;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--ink-55);
  cursor: pointer;
}
.notes {
  resize: vertical;
  font-family: var(--font-ui);
}
.stars {
  display: flex;
  gap: var(--sp-1);
}
.star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  border: none;
  background: transparent;
  font-size: 28px;
  color: var(--ink-25);
  padding: 0;
}
.star--on {
  color: var(--mustard);
}
.actions {
  display: flex;
  gap: var(--sp-3);
  margin-top: var(--sp-6);
}
.actions .btn {
  flex: 1;
}
.muted-hint {
  color: var(--ink-55);
  font-size: 14px;
  margin: var(--sp-2) 0 0;
}
/* Menu « Marque » du sélecteur de laine — mêmes classes que StashView.vue (styles scoped,
   donc non partagées : redéfinies ici, PAS à l'identique — flex: 1 est volontairement omis,
   cet écran n'a qu'un seul filtre, pas une rangée de plusieurs côte à côte). */
.sort {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sort__lbl {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-55);
}
.sort__sel {
  font-family: var(--font-ui);
  max-width: 200px;
}
.ypick__brandfilter {
  margin-top: var(--sp-2);
}
.ypick {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin-top: var(--sp-2);
}
.ypick__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  box-shadow: var(--clay-sm);
}
.ypick__row--on {
  border-color: var(--brand);
}
.ypick__pick {
  flex: 1;
  min-width: 0;
}
.ypick__qty {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: none;
}
.ypick__qtyin {
  width: 52px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg);
  padding: 6px;
  text-align: center;
  font-family: var(--font-ui);
  color: var(--ink);
}
.ypick__unit {
  color: var(--ink-55);
  font-size: 12.5px;
}
.ypick__meta {
  color: var(--ink-55);
  font-size: 13px;
}
</style>

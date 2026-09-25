<script setup>
// Import du stock Ravelry :
// bloc explicatif fixe, sélecteur de fichier, analyse (planRavelryImport, aucune écriture),
// résumé, confirmation. Motif simplifié de LocalPdfImportView.vue : pas de synchro MD
// concernée ici, donc pas de import-guard.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useYarnsStore } from '@/stores/yarns'
import { usePurchasesStore } from '@/stores/purchases'
import { useSettingsStore } from '@/stores/settings'
import { planRavelryImport } from '@/utils/ravelry-import'

const router = useRouter()
const { t } = useI18n()
const yarnsStore = useYarnsStore()
const purchasesStore = usePurchasesStore()
const settingsStore = useSettingsStore()

const file = ref(null)
const busy = ref(false)
const error = ref('')
const plan = ref(null)
const confirming = ref(false)
const done = ref(null)

function onFile(e) {
  file.value = e.target.files?.[0] || null
  e.target.value = ''
  plan.value = null
  error.value = ''
}

async function analyze() {
  if (!file.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (!yarnsStore.loaded) await yarnsStore.load()
    plan.value = await planRavelryImport(file.value, yarnsStore.yarns)
  } catch {
    // Erreur SheetJS brute jamais montrée telle quelle (anglaise, illisible côté France) :
    // même convention que LocalPdfImportView.vue, un message générique traduit à la place.
    error.value = t('ravelryImport.parseError')
  } finally {
    busy.value = false
  }
}

function reset() {
  file.value = null
  plan.value = null
  error.value = ''
}

// Écrit chaque laine retenue PUIS sa ligne d'achat reconstruite, même ordre et même
// convention (`reconstructed: true`) que la reprise d'existant (src/db/purchases-reprise.js)
// et que YarnEditView.vue#save() en création.
async function confirmImport() {
  if (!plan.value?.toCreate.length || confirming.value) return
  confirming.value = true
  error.value = ''
  let created = 0
  try {
    if (!purchasesStore.loaded) await purchasesStore.load()
    if (!settingsStore.loaded) await settingsStore.load()
    for (const row of plan.value.toCreate) {
      // Même convention que YarnEditView.vue#save() en création (payload.price /
      // unitPrice sur la même valeur) : sans ce champ, la tuile "valeur du stock" de
      // StashView.vue lit un prix nul pour chaque laine importée.
      row.yarn.price = row.purchase.unitPrice
      const yarnId = await yarnsStore.add(row.yarn)
      await purchasesStore.add({
        yarnId,
        yarnLabel: [row.yarn.brand, row.yarn.model, row.yarn.colorName].filter(Boolean).join(' · '),
        kind: 'buy',
        quantity: row.purchase.quantity,
        unitPrice: row.purchase.unitPrice,
        currency: settingsStore.currency,
        date: row.purchase.date,
        bain: row.purchase.bain,
        purchasedFrom: row.purchase.purchasedFrom,
        reconstructed: true,
      })
      created++
    }
    done.value = created
  } catch (err) {
    // Écriture partielle possible (quota, base fermée en cours de route) : `created` ne
    // compte que les lignes ENTIÈREMENT écrites (laine + achat), jamais une laine orpheline
    // sans sa ligne d'achat (le même écart que `purchases.gapMessage` sait déjà afficher
    // ailleurs). Poser `done` malgré l'erreur retire le bouton de confirmation du DOM : plus
    // moyen de re-cliquer et de dédoublonner sur un plan déjà périmé par les écritures faites.
    error.value = err?.message || String(err)
    done.value = created
  } finally {
    confirming.value = false
  }
}
</script>

<template>
<div>
  <AppHeader :title="t('ravelryImport.title')" back />
  <main class="screen">
    <template v-if="done == null">
      <p class="lead">{{ t('ravelryImport.lead1') }}</p>
      <ol class="steps">
        <li>{{ t('ravelryImport.step1') }}</li>
        <li>{{ t('ravelryImport.step2') }}</li>
        <li>{{ t('ravelryImport.step3') }}</li>
      </ol>
      <p class="lead">{{ t('ravelryImport.lead2') }}</p>

      <label class="btn file-pick">
        <AppIcon name="import" :size="18" /> {{ file ? file.name : t('ravelryImport.pick') }}
        <input type="file" accept=".xls,.xlsx,.csv" class="file-pick__input" @change="onFile" />
      </label>

      <button
        v-if="!plan"
        type="button"
        class="btn btn--primary btn--block mt2"
        data-test="ravelry-analyze"
        :disabled="!file || busy"
        @click="analyze"
      >{{ busy ? t('ravelryImport.analyzing') : t('ravelryImport.analyze') }}</button>

      <p v-if="error" class="err">{{ error }}</p>

      <section v-if="plan" class="res mt3" data-test="ravelry-summary">
        <p v-if="plan.totalRows === 0">{{ t('ravelryImport.summaryEmpty') }}</p>
        <template v-else>
          <p>{{ t('ravelryImport.summaryTotal', { n: plan.totalRows }) }}</p>
          <p>{{ t('ravelryImport.summaryCreate', { n: plan.toCreate.length }) }}</p>
          <p v-if="plan.alreadyPresentCount">{{ t('ravelryImport.summaryAlready', { n: plan.alreadyPresentCount }) }}</p>
          <p v-if="plan.statusColumnMissing" class="err">{{ t('ravelryImport.summaryNoStatusColumn') }}</p>
          <p v-else-if="plan.excludedStatusCount">{{ t('ravelryImport.summaryExcluded', { n: plan.excludedStatusCount }) }}</p>
        </template>
        <p v-if="plan.unmappedHeaders.length" class="muted">{{ t('ravelryImport.summaryUnmapped', { list: plan.unmappedHeaders.join(', ') }) }}</p>
        <button
          type="button"
          class="btn btn--primary btn--block mt2"
          data-test="ravelry-confirm"
          :disabled="!plan.toCreate.length || confirming"
          @click="confirmImport"
        >{{ confirming ? t('ravelryImport.confirming') : t('ravelryImport.confirm', { n: plan.toCreate.length }) }}</button>
        <button type="button" class="btn btn--block mt2" data-test="ravelry-restart" @click="reset">
          {{ t('ravelryImport.pickAnother') }}
        </button>
      </section>
    </template>

    <section v-else class="res mt3 done" data-test="ravelry-done">
      <p class="done__title"><AppIcon name="check" :size="18" /> {{ t('ravelryImport.doneTitle', { n: done }) }}</p>
      <p v-if="error" class="err">{{ error }}</p>
      <button type="button" class="btn btn--primary btn--block mt2" @click="router.replace({ name: 'stash' })">
        {{ t('ravelryImport.backToStash') }}
      </button>
    </section>
  </main>
</div>
</template>

<style scoped>
.lead { color: var(--ink-70); font-size: 14px; margin-bottom: var(--sp-3); }
.steps { margin: 0 0 var(--sp-3); padding-left: 1.2em; color: var(--ink-70); font-size: 14px; display: flex; flex-direction: column; gap: var(--sp-1); }
.file-pick { cursor: pointer; margin-bottom: var(--sp-2); display: flex; align-items: center; gap: var(--sp-2); }
.file-pick__input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.file-pick:focus-within { outline: 2px solid var(--brand-deep); outline-offset: 2px; border-radius: var(--r-md); }
.mt2 { margin-top: var(--sp-2); }
.mt3 { margin-top: var(--sp-4); }
.muted { color: var(--ink-55); font-size: 13px; }
.err { color: var(--danger); font-size: 14px; font-weight: 600; }
.res { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--clay-sm); padding: var(--sp-4); }
.done__title { display: flex; align-items: center; gap: var(--sp-2); font-weight: 700; color: var(--success); margin: 0; }
</style>

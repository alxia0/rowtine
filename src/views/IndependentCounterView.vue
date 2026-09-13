<script setup>
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import CounterForm from '@/components/CounterForm.vue'
import CounterCard from '@/components/CounterCard.vue'
import { useCountersStore } from '@/stores/counters'
import { useSnackbarStore } from '@/stores/snackbar'

const { t } = useI18n()
const countersStore = useCountersStore()
const snackbar = useSnackbarStore()

// Compteurs indépendants = projet « 0 » (hors projet) : tricot/crochet libre, sans patron.
const PID = 0
onMounted(() => countersStore.loadForProject(PID))

function onSubmit({ name, extra }) {
  countersStore.add(PID, name || t('counter.default'), extra)
}
function setVal(id, v) {
  countersStore.setValue(id, v)
}
function update(id, patch) {
  countersStore.update(id, patch)
}
async function remove(id) {
  const removed = await countersStore.remove(id)
  snackbar.show(t('icounter.deleted'), { actionLabel: t('common.undo'), onAction: () => countersStore.restore(removed) })
}
</script>

<template>
<div>
  <AppHeader :title="t('icounter.title')" back />
  <main class="screen">
    <CounterForm @submit="onSubmit" />
    <div class="clist">
      <CounterCard v-for="c in countersStore.counters" :key="c.id" :counter="c" @set="setVal" @update="update" @remove="remove" />
    </div>
    <p v-if="!countersStore.counters.length" class="muted">{{ t('icounter.empty') }}</p>
  </main>
</div>
</template>

<style scoped>
.clist { display: flex; flex-direction: column; gap: var(--sp-3); margin-top: var(--sp-4); }
.muted { color: var(--ink-55); margin-top: var(--sp-4); }
</style>

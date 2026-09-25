<script setup>
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import PatternForm from '@/components/PatternForm.vue'
import { usePatternsStore } from '@/stores/patterns'

const router = useRouter()
const { t } = useI18n()
const patternsStore = usePatternsStore()

// Garde anti double appui (même forme que ProjectEditView.save) : `patternsStore.add()`
// attend un rechargement complet des patrons, fenêtre où un 2e appui créait un doublon.
let saving = false
async function onCreate(data) {
  if (saving) return
  saving = true
  try {
    const id = await patternsStore.add(data)
    router.replace({ name: 'pattern', params: { id } })
  } finally {
    saving = false
  }
}
</script>

<template>
<div>
  <AppHeader :title="t('pattern.addManual')" back />
  <main class="screen">
    <PatternForm :initial="null" :submit-label="t('common.save')" @submit="onCreate" @cancel="router.back()" />
  </main>
</div>
</template>

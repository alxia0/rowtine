<script setup>
// Saisie du prix d'un patron acheté (lot 07/08). Un seul endroit décrit à quoi ressemble
// cette saisie ; deux écrans l'affichent (la fiche du patron et le formulaire du projet).
//
// Le composant ne connaît NI la base NI les magasins : il présente et remonte. C'est
// l'appelant qui décide QUAND et OÙ écrire — et qui estampille la devise à ce moment-là.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { currencySymbol } from '@/utils/units'
import { filtrerSaisieDecimale } from '@/utils/decimal'
import { ymdLocal } from '@/utils/time-periods'

const props = defineProps({
  modelValue: { type: Object, required: true }, // { price, purchasedAt }
  // Pourquoi la saisie est masquée, ou null si elle est ouverte :
  //  'builtin' — le « Patron libre » est un gabarit UNIQUE PARTAGÉ par tous les projets sans
  //              patron ; un prix dessus serait recompté par projet.
  // C'est la SEULE valeur qui masque le champ (ménage pré-1.0, 13/08) : le gabarit d'affichage
  // ne sait plus rendre qu'un seul message, pour ce seul cas — plus de repli générique pour
  // une autre valeur, qui afficherait un texte faux à l'écran, pire que pas de texte.
  hiddenReason: { type: String, default: null },
  // Mention « ce prix appartient au patron » : utile depuis un PROJET (on modifie une donnée
  // partagée par d'autres projets), inutile sur la fiche du patron où c'est une évidence.
  sharedHint: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const { t, locale } = useI18n()
const settings = useSettingsStore()

const symbol = computed(() => currencySymbol(settings.currency, locale.value))

function patch(over) {
  emit('update:modelValue', { ...props.modelValue, ...over })
}

// Pré-remplissage de la date : seulement quand on ARRIVE sur un prix non vide alors que la
// date l'est encore. Effacer le prix ne touche à rien, et une date déjà saisie n'est jamais
// écrasée — l'app PROPOSE, visiblement et corrigeable, elle n'écrit pas dans le dos.
function onPrice(event) {
  // Filtré AVANT tout le reste : ce qui remonte au parent, et finit en base, ne peut plus être
  // qu'un nombre. Un « 18,90 € » tapé ici donnait NaN, donc 0, donc « Gratuit » sur la fiche
  // patron, la fiche projet et l'écran Dépenses.
  // Réécrit dans le champ lui-même : `:value` seul ne suffit pas quand la valeur filtrée est
  // identique à la précédente — Vue ne repasse alors pas, et le caractère refusé resterait à
  // l'écran.
  const price = filtrerSaisieDecimale(event.target.value)
  event.target.value = price
  const filled = !!String(price).trim()
  const purchasedAt = filled && !String(props.modelValue.purchasedAt || '').trim() ? ymdLocal(new Date()) : props.modelValue.purchasedAt
  patch({ price, purchasedAt })
}

function setFree() {
  const purchasedAt = String(props.modelValue.purchasedAt || '').trim() ? props.modelValue.purchasedAt : ymdLocal(new Date())
  patch({ price: '0', purchasedAt })
}
</script>

<template>
  <p v-if="hiddenReason" class="ppf__hint" data-test="pattern-price-hidden">
    {{ t('pattern.priceFreePatternHint') }}
  </p>
  <template v-else>
    <label class="field-label mt2" for="pat-price">{{ t('pattern.price', { symbol }) }}</label>
    <div class="ppf__row">
      <input
        id="pat-price"
        class="input ppf__price"
        inputmode="decimal"
        data-test="pattern-price"
        :value="modelValue.price"
        placeholder="—"
        @input="onPrice"
      />
      <button type="button" class="btn ppf__free" data-test="pattern-price-free" @click="setFree">
        {{ t('pattern.priceFree') }}
      </button>
    </div>

    <label class="field-label mt2" for="pat-purchased-at">{{ t('pattern.purchasedAt') }}</label>
    <input
      id="pat-purchased-at"
      class="input"
      type="date"
      data-test="pattern-purchased-at"
      :value="modelValue.purchasedAt"
      @input="patch({ purchasedAt: $event.target.value })"
    />

    <p v-if="sharedHint" class="ppf__hint">{{ t('pattern.priceSharedHint') }}</p>
  </template>
</template>

<style scoped>
.ppf__row {
  display: flex;
  gap: var(--sp-2);
  align-items: stretch;
}
.ppf__price {
  flex: 1;
  min-width: 0;
}
.ppf__free {
  flex-shrink: 0;
}
.ppf__hint {
  font-size: 12px;
  color: var(--ink-55);
  margin: var(--sp-1) 0 0;
}
.mt2 {
  margin-top: var(--sp-2);
}
</style>

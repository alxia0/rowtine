<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useSnackbarStore } from '@/stores/snackbar'

// `embedded` : instance montée DANS une surface plein écran opaque (composeur de badge) qui
// recouvre la barre globale. Elle réclame l'affichage (claimHost) pour toute sa vie : la barre
// globale se tait, celle-ci montre le même message, la même action, le même minuteur.
const props = defineProps({ embedded: { type: Boolean, default: false } })
const snackbar = useSnackbarStore()
let release = null
onMounted(() => {
  if (props.embedded) release = snackbar.claimHost()
})
onBeforeUnmount(() => release?.())
const shown = computed(() => snackbar.visible && (props.embedded || snackbar.hosts === 0))
</script>

<template>
  <Transition name="snack">
    <div v-if="shown" class="snack" :class="{ 'snack--embedded': embedded }" role="status">
      <span class="snack__msg">{{ snackbar.message }}</span>
      <button v-if="snackbar.actionLabel" class="snack__action" @click="snackbar.runAction()">
        {{ snackbar.actionLabel }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.snack {
  position: fixed;
  left: 50%;
  bottom: calc(var(--sp-5) + var(--sa-bottom));
  transform: translateX(-50%);
  width: min(440px, calc(100vw - 2 * var(--sp-4)));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  background: var(--ink);
  color: var(--bg);
  border-radius: var(--r-md);
  padding: 12px 14px;
  box-shadow: var(--e-3);
  z-index: 100;
}
/* Dans l'hôte (`.bdg`, `position: fixed; inset: 0`, sans padding) : absolue, jamais un second
   `position: fixed` imbriqué (cf. BadgeComposer.vue). Son z-index se résout dans le contexte
   d'empilement de l'hôte : 100 passe devant la pop-up photo (90) et le sélecteur de couleur
   (85), d'où part l'échec d'import qu'elle doit montrer. En HAUT, sous les boutons Fermer et
   Partager (même hauteur que la bannière « enregistré ») : en bas, elle masquait le bouton
   galerie de la pop-up photo, celui qu'on touche pour réessayer (vu en capture, 26/09). */
.snack--embedded {
  position: absolute;
  top: max(64px, calc(var(--sa-top) + 56px));
  bottom: auto;
}
.snack__msg {
  font-size: 14px;
}
.snack__action {
  border: none;
  background: transparent;
  color: var(--mustard);
  font-weight: 700;
  font-size: 14px;
  padding: 4px 6px;
}
/* .snack a une polarité INVERSÉE par construction (background: var(--ink), qui
   s'inverse en sombre et devient clair) : --mustard, pensé pour un fond sombre,
   n'est plus lisible sur ce fond clair-en-sombre (1,51:1 mesuré). Couleur fixe,
   indépendante du thème (le fond de .snack ne change pas de polarité) — mesuré
   ≥ 4,5:1 sur le fond crème réel de .snack en sombre (#f2e9dc). */
:root[data-theme='dark'] .snack__action,
html[data-theme='dark'] .snack__action {
  color: #925212;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .snack__action {
    color: #925212;
  }
}
.snack-enter-active,
.snack-leave-active {
  transition: all var(--motion-base);
}
.snack-enter-from,
.snack-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>

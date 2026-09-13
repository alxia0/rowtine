<script setup>
// Bouton flottant « retour en haut ». Présentationnel, sans connaissance des écrans.
//
// La cible est un PARAMÈTRE, pas `window` en dur : ça rend le composant honnête et
// réutilisable pour un écran qui défilerait un volet interne plutôt que le document.
// Vérifié (pose sur les six écrans longs) : AUCUN écran de l'app n'est dans ce
// cas aujourd'hui, le lecteur compris — il défile lui aussi le document (le bandeau
// compact du lecteur, livré et validé sur device, se pilote par `window.scrollY` ;
// `ReaderSheet.vue` est le tiroir « Aide-mémoire », `ReaderChart.vue` une zone de
// diagramme, ni l'un ni l'autre n'est le corps défilant du lecteur). Tous les écrans,
// lecteur compris, posent donc `<BackToTop />` SANS cible (repli document). Si un futur
// écran acquiert un volet interne qui défile, cette prop est prête à le recevoir.
//
// Branchement tardif : `watch(..., { immediate: true })` et non `onMounted`, parce que la
// cible peut apparaître APRÈS le montage (volet sous un `v-if` qui attend un chargement).
// Même schéma que useScrollFade.js:46-67, volontairement repris.
//
// Remontée douce : `behavior: 'smooth'` par défaut, MAIS PAS en dur. Passé explicitement à
// `scrollTo`, il l'emporte sur la règle `scroll-behavior: auto !important` que tokens.css
// impose sous `@media (prefers-reduced-motion: reduce)` — cette règle ne gouverne que le
// défilement laissé au navigateur, jamais une valeur JS explicite. La préférence est donc
// lue par `scrollBehavior()` (src/utils/scroll-behavior.js), qui porte le piège au long.
import { ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
// Importée, plus recopiée : la copie locale se justifiait tant qu'ils n'étaient que deux
// (ce composant reste présentationnel et ne veut pas dépendre d'un module « clavier »).
// `scroll-behavior.js` ne dépend de rien et ne gère rien : l'importer ne coûte pas cette
// indépendance-là.
import { scrollBehavior } from '@/utils/scroll-behavior'

const props = defineProps({
  target: { type: [Object, null], default: null },
  threshold: { type: Number, default: 0 }, // 0 = « une hauteur d'écran et demie »
})

const { t } = useI18n()
const visible = ref(false)
let el = null
let onWindow = false

function limit() {
  return props.threshold || (typeof window !== 'undefined' ? window.innerHeight * 1.5 : 600)
}
function scroller() {
  // `|| document.documentElement` : jsdom (banc de test unitaire) n'implémente pas
  // `scrollingElement` (toujours `undefined`, jamais un élément) — même repli que
  // `findScrollContainer` dans keyboard-avoidance.js:259, pour la même raison.
  return (
    props.target || (typeof document !== 'undefined' ? document.scrollingElement || document.documentElement : null)
  )
}
function update() {
  const s = scroller()
  visible.value = !!s && (s.scrollTop || 0) > limit()
}
function detach() {
  if (el) el.removeEventListener('scroll', update)
  if (onWindow) {
    window.removeEventListener('scroll', update)
    onWindow = false
  }
  // `resize` sans condition, cible posée ou non : le seuil (limit()) dépend de
  // window.innerHeight DANS LES DEUX CAS, pas seulement en repli fenêtre. Retirer un
  // écouteur jamais posé est sans effet — même schéma que useScrollFade.js, qui attache
  // `resize` inconditionnellement lui aussi.
  if (typeof window !== 'undefined') window.removeEventListener('resize', update)
  el = null
}

function toTop() {
  const behavior = scrollBehavior()
  if (props.target) props.target.scrollTo({ top: 0, behavior })
  else window.scrollTo({ top: 0, behavior })
}

watch(
  () => props.target,
  (next) => {
    detach()
    el = next || null
    if (el) el.addEventListener('scroll', update, { passive: true })
    else if (typeof window !== 'undefined') {
      window.addEventListener('scroll', update, { passive: true })
      onWindow = true
    }
    if (typeof window !== 'undefined') window.addEventListener('resize', update)
    update()
  },
  { immediate: true },
)

onUnmounted(detach)
</script>

<template>
  <button v-if="visible" class="btt" type="button" :aria-label="t('common.backToTop')" @click="toTop">
    <AppIcon name="chevronUp" :size="20" />
  </button>
</template>

<style scoped>
/* Bas-droite, au-dessus de la marge système (plugin SafeArea maison : SystemBars y injecte
   zéro sur la tablette de test). z-index sous les feuilles et dialogues (80 et plus) —
   ce bouton ne doit jamais flotter par-dessus un dialogue ouvert.
   Dans le lecteur, `.actionbar` est ELLE AUSSI à z-index 40, fixe en bas-droite
   (justify-content: flex-end) — même coin d'écran, chevauchement quasi certain.
   Arbitrage rendu : le bouton est NICHÉ dans `.actionbar`, en dernière position du DOM, et
   `.actionbar :deep(.btt)` (ReaderView.vue) remplace ce `position: fixed` par un
   `position: absolute` qui le pose AU-DESSUS du bouton aide-mémoire — hors du flux de la
   rangée, donc sans prendre de largeur au chrono (retour d'usage du 01/08 : en pause, son
   libellé « Reprendre » se faisait tronquer sur téléphone). En lecture seule (`.actionbar`
   absent), le bouton garde ce style flottant ; `.reader--split > :deep(.btt)`
   (ReaderView.vue, même fichier) le décale alors pour ne pas passer sous le volet diagramme
   épinglé — sélecteur enfant DIRECT, l'exemplaire du suivi étant déjà décalé par sa barre. */
.btt {
  position: fixed;
  right: max(var(--sp-4), var(--sa-right));
  bottom: calc(max(var(--sp-4), var(--sa-bottom)) + var(--sp-2));
  z-index: 40;
  width: 44px;   /* cible tactile minimale */
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  background: var(--surface);
  color: var(--ink-70);
  box-shadow: var(--e-2);
}
</style>

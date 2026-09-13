import { ref, watch, onUnmounted } from 'vue'

// Indice de défilement (dégradé de bord) pour une bande défilante horizontalement :
// `active` est vrai SEULEMENT quand l'élément déborde réellement, et redevient faux une
// fois défilé jusqu'au bout — sinon l'indice mentirait (audit UX 17/07).
// Réutilisé tel quel par toute barre défilante à un seul rang (onglets de la fiche projet,
// filtres de la bibliothèque…) : passer le template ref de l'élément scrollable, poser
// `:class="{ '<xxx>--fade': fade.active }"` sur ce même élément, et copier la règle CSS
// `mask-image` (voir ProjectDetailView.vue, `.tabs--fade`).
//
// `watch(elRef, ..., { immediate: true })` plutôt qu'un simple `onMounted` : l'élément
// référencé peut apparaître APRÈS le montage du composant (ex. sous un `v-if` qui attend un
// chargement async) — un `onMounted` figé aurait manqué l'élément et laissé `active` bloqué
// à `false` pour toujours.
//
// Pas de ResizeObserver : la largeur de ces conteneurs suit entièrement la largeur de
// viewport (`.screen { max-width: var(--w-content) }`, 480 à 840px selon l'appareil, pas de
// layout indépendant type sidebar), donc l'évènement `resize` de `window` suffit à capter les
// changements d'orientation/de fenêtre. Ça évite aussi une dépendance absente de jsdom en test
// unitaire.
export function useScrollFade(elRef) {
  const active = ref(false)
  let el = null
  let mo = null

  function update() {
    if (!el) {
      active.value = false
      return
    }
    // Marge de 1px : tolère l'arrondi sub-pixel des navigateurs (sinon un conteneur pile
    // ajusté peut se déclarer « débordant » à tort — un mensonge de moins d'un pixel).
    active.value = el.scrollWidth - el.scrollLeft - el.clientWidth > 1
  }

  function detach() {
    if (el) el.removeEventListener('scroll', update)
    window.removeEventListener('resize', update)
    if (mo) {
      mo.disconnect()
      mo = null
    }
    el = null
  }

  watch(
    elRef,
    (next) => {
      detach()
      el = next
      if (!el) {
        active.value = false
        return
      }
      update()
      el.addEventListener('scroll', update, { passive: true })
      window.addEventListener('resize', update)
      // Le contenu peut changer de longueur (ex. chips de filtres selon les données) sans
      // que la fenêtre se redimensionne : MutationObserver couvre ce cas. Absent de jsdom ?
      // Non — contrairement à ResizeObserver, il y est bien présent.
      if (typeof MutationObserver !== 'undefined') {
        mo = new MutationObserver(update)
        mo.observe(el, { childList: true, subtree: true, characterData: true })
      }
    },
    { immediate: true },
  )

  onUnmounted(detach)

  return { active, update }
}

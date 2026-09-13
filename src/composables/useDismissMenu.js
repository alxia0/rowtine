import { ref, watch, nextTick, onUnmounted } from 'vue'

// A11y des menus déroulants (burger, kebab) : état ouvert/fermé + bonnes pratiques clavier.
//  - Escape ferme le menu (écouteur global tant qu'il est ouvert).
//  - À l'ouverture, le focus va sur le 1er élément du menu.
//  - À la fermeture, le focus revient sur le bouton déclencheur.
// À câbler : `:aria-expanded="open"` + `ref="triggerRef"` sur le bouton, `ref="menuRef"` sur le <nav>.
export function useDismissMenu() {
  const open = ref(false)
  const triggerRef = ref(null)
  const menuRef = ref(null)

  function onKey(e) {
    if (e.key === 'Escape') open.value = false
  }

  watch(open, async (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onKey)
      await nextTick()
      menuRef.value?.querySelector('button, [href], input, [tabindex]')?.focus()
    } else {
      window.removeEventListener('keydown', onKey)
      triggerRef.value?.focus?.()
    }
  })

  onUnmounted(() => window.removeEventListener('keydown', onKey))

  return { open, triggerRef, menuRef }
}

// Unitaire — suppression douce : envoie en corbeille + snackbar « Annuler » qui restaure.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { useSoftDelete } from '@/composables/useSoftDelete'
import { useTrashStore } from '@/stores/trash'
import { useSnackbarStore } from '@/stores/snackbar'

// Monte un composant minimal pour exécuter le composable dans un vrai setup().
function mountSoftDelete() {
  const pinia = createPinia()
  const Comp = defineComponent({
    setup: () => ({ softDelete: useSoftDelete() }),
    render: () => h('div'),
  })
  const wrapper = mount(Comp, { global: { plugins: [pinia, i18n] } })
  return wrapper
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('useSoftDelete', () => {
  it('place l’objet en corbeille et affiche un snackbar annulable', async () => {
    const w = mountSoftDelete()
    await w.vm.softDelete('yarn', { id: 1, brand: 'Drops' }, { message: 'Laine supprimée.' })

    const trash = useTrashStore()
    const snackbar = useSnackbarStore()
    expect(trash.items).toHaveLength(1)
    expect(snackbar.visible).toBe(true)
    expect(snackbar.message).toBe('Laine supprimée.')
    expect(snackbar.actionLabel).toBe('Annuler')
  })

  it('l’action « Annuler » restaure l’objet et le sort de la corbeille', async () => {
    const w = mountSoftDelete()
    await w.vm.softDelete('yarn', { id: 7, brand: 'Katia' }, { message: 'Supprimée.' })

    const snackbar = useSnackbarStore()
    const trash = useTrashStore()
    snackbar.runAction() // déclenche onAction (restauration, asynchrone)

    // La restauration enchaîne plusieurs opérations IndexedDB : on attend l’état final.
    await vi.waitFor(async () => {
      expect(await db.yarns.get(7)).toMatchObject({ brand: 'Katia' })
      expect(trash.items).toHaveLength(0)
    }, { timeout: 10000 })
  })
})

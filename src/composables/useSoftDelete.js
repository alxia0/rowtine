// Suppression « douce » : envoie l'objet à la corbeille + snackbar « Annuler ».
// Si l'utilisateur n'annule pas, l'élément reste récupérable dans la corbeille (Réglages).
import { useI18n } from 'vue-i18n'
import { useTrashStore } from '@/stores/trash'
import { useSnackbarStore } from '@/stores/snackbar'

export function useSoftDelete() {
  const { t } = useI18n()
  const trash = useTrashStore()
  const snackbar = useSnackbarStore()

  // `trashId` : entrée de corbeille déjà créée par `trash.moveToTrash` (retrait et mise en
  // corbeille dans une même transaction) ; on n'en crée alors pas une seconde.
  return async function softDelete(type, obj, { message, reload, trashId } = {}) {
    const tid = trashId ?? (await trash.add(type, obj))
    snackbar.show(message, {
      actionLabel: t('common.undo'),
      onAction: async () => {
        await trash.restore(tid)
        if (reload) await reload()
      },
    })
  }
}

// @vitest-environment jsdom
// Unitaire — modale singleton d'incident de restauration (décision produit
// du 05/09/2026 : « informer l'utilisateur qu'une erreur technique a été
// rencontrée à la restauration et donner un moyen de voir le détail de l'erreur,
// et de copier l'erreur pour la faire remonter »).
//
// Couvre : les DEUX variantes (kind 'error' / 'unowned') avec leur titre et leur
// phrase ; le détail technique affiché EST le rapport copié (une seule grille) ;
// « Copier le rapport » et son échec annoncé (snackbar backupFailure.copyFailed,
// clé existante réutilisée) ; « Fermer » et Échap ; le piège de focus et le
// verrou de défilement ; et — LE point de conception du lot — le fait qu'elle
// s'affiche MÊME quand la file des messages (notice-queue) tient l'écran avec la
// porte du dossier ou le bandeau de décision : elle est volontairement HORS file,
// sa primauté tient au z-index seul (cf. en-tête du composant).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import { useRestoreErrorStore } from '@/stores/restore-error'
import { useSnackbarStore } from '@/stores/snackbar'
import { useNoticeQueueStore } from '@/stores/notice-queue'
import { NOTICE } from '@/constants/notice-queue'
import RestoreErrorDialog from '@/components/RestoreErrorDialog.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr, en } })

let wrapper
const mountIt = () => {
  wrapper = mount(RestoreErrorDialog, { global: { plugins: [i18n] }, attachTo: document.body })
  return wrapper
}

// jsdom : `navigator.clipboard` n'existe pas par défaut — même précaution que
// tests/unit/copy-to-clipboard.spec.js : descripteur conservé pour restaurer
// l'état EXACT entre tests (undefined compris).
let clipboardDescriptor
let execCommandOriginal
const stubClipboard = (writeText) =>
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
const writeText = vi.fn().mockResolvedValue(undefined)

const publierErreur = () =>
  useRestoreErrorStore().setReport({
    kind: 'error',
    error: 'EIO: read failed',
    path: 'Documents/Rowtine',
    at: '2026-09-05T18:42:10+02:00',
  })

beforeEach(() => {
  setActivePinia(createPinia())
  // Le verrou de défilement s'écrit sur `document.body`, partagé par tout le fichier :
  // sans cette remise à zéro, un test hériterait de l'état laissé par le précédent.
  document.body.style.overflow = ''
  // Copie : on observe les écritures sans toucher au vrai presse-papiers.
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  execCommandOriginal = document.execCommand
  stubClipboard(writeText)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else delete navigator.clipboard
  if (execCommandOriginal) document.execCommand = execCommandOriginal
  else delete document.execCommand
})

const detailTexte = () => wrapper.find('[data-test="restore-error-detail"]').element.textContent

describe('RestoreErrorDialog', () => {
  it('aucun rapport publié : la modale ne s’affiche PAS', async () => {
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('variante error : titre, phrase et DÉTAIL intégral (erreur + dossier + date)', async () => {
    const w = mountIt()
    publierErreur()
    await flushPromises()

    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain(fr.restoreFailure.errorTitle)
    expect(w.text()).toContain(fr.restoreFailure.errorBody)
    const detail = detailTexte()
    expect(detail).toContain('Restauration des données — échec')
    expect(detail).toContain('EIO: read failed')
    expect(detail).toContain('Dossier : Documents/Rowtine')
    expect(detail).toContain('2026-09-05T18:42:10')
  })

  it('variante unowned : formulation « données restaurées mais… », PAS un libellé d’échec', async () => {
    const w = mountIt()
    useRestoreErrorStore().setReport({
      kind: 'unowned',
      error: null,
      path: 'Documents/Rowtine',
      at: '2026-09-05T18:42:10+02:00',
    })
    await flushPromises()

    expect(w.text()).toContain(fr.restoreFailure.unownedTitle)
    expect(w.text()).toContain(fr.restoreFailure.unownedBody)
    expect(w.text()).not.toContain(fr.restoreFailure.errorTitle)
    // Le rapport copiable porte le libellé A1 de la variante (pas « échec »).
    expect(detailTexte()).toContain('Restauration des données — reprise du dossier non confirmée')
    // `error` null : le compositeur ne laisse pas de trou silencieux.
    expect(detailTexte()).toContain('Erreur :\n')
  })

  // Protège le message d'une restauration incomplète : elle ne doit pas se dire complète.
  it('variante unowned avec écarts : formulation « restaurées en partie », écarts dans le rapport', async () => {
    const w = mountIt()
    useRestoreErrorStore().setReport({
      kind: 'unowned',
      error: null,
      path: 'Documents/Rowtine',
      at: '2026-09-05T18:42:10+02:00',
      details: [{ where: 'Projets/Marisol [3]', error: 'Unexpected end of JSON input' }],
    })
    await flushPromises()

    expect(w.text()).toContain(fr.restoreFailure.partialTitle)
    expect(w.text()).toContain(fr.restoreFailure.partialBody)
    expect(w.text()).not.toContain(fr.restoreFailure.unownedBody)
    expect(detailTexte()).toContain('Restauration des données, incomplète')
    expect(detailTexte()).toContain('Projets/Marisol [3]')
  })

  it('« Copier le rapport » copie EXACTEMENT le texte affiché dans le détail', async () => {
    const w = mountIt()
    publierErreur()
    await flushPromises()

    await w.find('[data-test="restore-error-copy"]').trigger('click')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(detailTexte())
  })

  it('échec de copie : snackbar « Copie impossible. » (clé backupFailure.copyFailed réutilisée)', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('permission refusée')))
    // Le repli execCommand échoue aussi : la copie est vraiment impossible.
    document.execCommand = vi.fn().mockReturnValue(false)
    const w = mountIt()
    publierErreur()
    await flushPromises()
    const snackbar = useSnackbarStore()

    await w.find('[data-test="restore-error-copy"]').trigger('click')
    await flushPromises()

    expect(snackbar.message).toBe(fr.backupFailure.copyFailed)
  })

  it('« Fermer » vide le rapport et referme la modale', async () => {
    const w = mountIt()
    publierErreur()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)

    await w.find('[data-test="restore-error-close"]').trigger('click')
    await flushPromises()

    expect(useRestoreErrorStore().report).toBeNull()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('Échap referme la modale (comme « Fermer »)', async () => {
    const w = mountIt()
    publierErreur()
    await flushPromises()

    await w.find('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(useRestoreErrorStore().report).toBeNull()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('piège de focus : focus initial sur « Fermer », Tab reboucle sur « Copier », Maj+Tab au dernier', async () => {
    // Depuis le lot « dette juillet » (07/09), le piège est le composable partagé
    // useFocusTrap : il n'agit qu'aux BORNES (Tab sur le dernier → premier, Maj+Tab sur
    // le premier → dernier) ; le pas intermédiaire est natif au navigateur.
    const w = mountIt()
    publierErreur()
    await flushPromises()

    const copyBtn = w.find('[data-test="restore-error-copy"]').element
    const closeBtn = w.find('[data-test="restore-error-close"]').element
    expect(document.activeElement).toBe(closeBtn)

    // Tab depuis le DERNIER focusable (Fermer) reboucle au premier (Copier).
    await w.find('[role="dialog"]').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(copyBtn)

    // Maj+Tab depuis le PREMIER (Copier) renvoie au dernier (Fermer).
    await w.find('[role="dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(closeBtn)
  })

  it('verrou de défilement posé à l’ouverture, relâché à la fermeture', async () => {
    const w = mountIt()
    publierErreur()
    await flushPromises()
    expect(document.body.style.overflow).toBe('hidden')

    await w.find('[data-test="restore-error-close"]').trigger('click')
    await flushPromises()
    expect(document.body.style.overflow).toBe('')
  })

  // Même garde que SyncReportDialog (`verrouPose`) : le watch immédiat fait un
  // PREMIER appel avec `visible` faux au montage — sans garde, il effacerait un
  // verrou posé par un AUTRE composant (visionneuse, porte du dossier). On ne
  // relâche que le verrou QU'ON A posé.
  it("ne touche PAS au verrou d'un autre composant tant qu'elle n'a rien verrouillé", async () => {
    document.body.style.overflow = 'hidden' // un autre composant tient le fond

    mountIt()
    await flushPromises()

    expect(document.body.style.overflow).toBe('hidden')
  })

  // LE point de conception du lot : la modale est HORS file des messages. Sa
  // variante la placerait DERRIÈRE la porte (rang 2) et le bandeau (rang 3) —
  // elle doit au contraire s'afficher pendant qu'ils tiennent l'écran. Ce test
  // rougit si un futur lot la file « par cohérence » dans useNoticeSlot.
  it('s’affiche MÊME quand un message plus FORT tient la file (porte, bandeau)', async () => {
    const q = useNoticeQueueStore()
    q.request(NOTICE.FOLDER_GATE)
    q.request(NOTICE.BACKUP_DECISION)
    expect(q.active).toBe(NOTICE.FOLDER_GATE) // précondition : la file est occupée en tête

    const w = mountIt()
    publierErreur()
    await flushPromises()

    expect(w.find('[data-test="restore-error-dialog"]').exists()).toBe(true)
    expect(w.find('[role="dialog"]').exists()).toBe(true)

    // Contre-épreuve : la modale n'a PAS pris la file pour s'afficher.
    expect(q.requesters).toEqual([NOTICE.FOLDER_GATE, NOTICE.BACKUP_DECISION])
  })

  it('aucune emoji dans le template rendu', async () => {
    const w = mountIt()
    publierErreur()
    await flushPromises()
    // Plage Unicode couvrant emoji/pictos/symboles usuels (convention du dépôt).
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    expect(emojiRe.test(w.text())).toBe(false)
  })
})

describe('i18n restoreFailure — clés et parité FR/EN', () => {
  it('mêmes clés dans fr.json et en.json', () => {
    expect(Object.keys(fr.restoreFailure).sort()).toEqual(Object.keys(en.restoreFailure).sort())
  })

  it('toutes les clés attendues sont présentes', () => {
    const expected = ['errorTitle', 'errorBody', 'unownedTitle', 'unownedBody', 'partialTitle', 'partialBody', 'copyAction']
    for (const key of expected) {
      expect(fr.restoreFailure).toHaveProperty(key)
      expect(en.restoreFailure).toHaveProperty(key)
    }
  })
})

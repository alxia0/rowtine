// Unitaire — LE VERROU DE DÉFILEMENT À COMPTEUR (deux modales successives, fond
// déverrouillé). Deux étages :
//   1. le module `src/utils/body-scroll-lock.js` lui-même (comptage, sécurité au
//      déséquilibre, remise à '' à la dernière libération) ;
//   2. le scénario DEUX MODALES sur de VRAIS composants — le bug d'origine : la
//      fermeture de la première ne doit plus déverrouiller le fond sous la seconde.
// Le couple choisi (SyncReportDialog + RestoreErrorDialog) est piloté par magasins
// Pinia, donc montable sans mock natif — et c'est une succession réellement
// possible : l'incident de restauration est DÉLIBÉRÉMENT hors file des messages
// (cf. RestoreErrorDialog.vue) et se peint par-dessus une modale déjà à l'écran.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, h } from 'vue'
import fr from '@/i18n/fr.json'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import SyncReportDialog from '@/components/SyncReportDialog.vue'
import RestoreErrorDialog from '@/components/RestoreErrorDialog.vue'
import { useSyncReportStore } from '@/stores/sync-report'
import { useRestoreErrorStore } from '@/stores/restore-error'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

beforeEach(() => {
  // Le verrou s'écrit sur `document.body`, partagé par tout le fichier : sans cette
  // remise à zéro, un test hériterait de l'état laissé par le précédent. Le COMPTEUR
  // du module, lui, ne survit qu'aux tests déséquilibrés — chaque test ci-dessous
  // rééquilibre ses acquisitions, et les libérations en trop sont des no-ops.
  document.body.style.overflow = ''
})

describe('le module body-scroll-lock', () => {
  it('une acquisition verrouille, sa libération déverrouille', () => {
    lockBodyScroll()
    expect(document.body.style.overflow).toBe('hidden')
    unlockBodyScroll()
    expect(document.body.style.overflow).toBe('')
  })

  it('deux acquisitions : la première libération laisse le fond verrouillé', () => {
    lockBodyScroll()
    lockBodyScroll()
    unlockBodyScroll()
    // LE point du compteur : le fond ne retombe pas à '' tant qu'un détenteur reste.
    expect(document.body.style.overflow).toBe('hidden')
    unlockBodyScroll()
    expect(document.body.style.overflow).toBe('')
  })

  it('trois acquisitions imbriquées : seules la première pose et la dernière retire', () => {
    lockBodyScroll()
    lockBodyScroll()
    lockBodyScroll()
    unlockBodyScroll()
    unlockBodyScroll()
    expect(document.body.style.overflow).toBe('hidden')
    unlockBodyScroll()
    expect(document.body.style.overflow).toBe('')
  })

  it('libération DÉSÉQUILIBRÉE sans détention : ne déverrouille pas un fond tenu par un autre', () => {
    // Simule un verrou posé par un autre composant (idiome direct, ou — après
    // migration — un `lockBodyScroll` d'ailleurs, non représentable ici puisque le
    // compteur est interne). L'appel en trop ne doit NI l'effacer NI plafonner à
    // une valeur fausse.
    document.body.style.overflow = 'hidden'
    unlockBodyScroll()
    expect(document.body.style.overflow).toBe('hidden')
    document.body.style.overflow = ''
  })

  it('double libération : la seconde est sans effet et le verrou reste utilisable', () => {
    lockBodyScroll()
    unlockBodyScroll()
    unlockBodyScroll() // déséquilibré : no-op, jamais de compteur négatif
    expect(document.body.style.overflow).toBe('')
    // Preuve que le compteur n'a pas plongé sous zéro : une acquisition suivante
    // re-verrouille normalement, et sa libération déverrouille — pas de décalage.
    lockBodyScroll()
    expect(document.body.style.overflow).toBe('hidden')
    unlockBodyScroll()
    expect(document.body.style.overflow).toBe('')
  })
})

// ─── Le scénario du bug d'origine, sur de VRAIS composants ──────────────────────────
// L'ancien idiome (`overflow = v ? 'hidden' : ''` dans chaque composant) faisait de la
// fermeture de A un déverrouillage INCONDITIONNEL : B encore ouverte, fond défilable.
// Avec le compteur, la fermeture de A ne décompte que SA part.

const rapportASignaler = () => ({
  merged: [
    {
      kind: 'pattern',
      id: 1,
      name: 'SABAI',
      reconcile: {
        doneKept: 0,
        doneLost: 1,
        countersKept: 0,
        countersLost: 0,
        sizeReset: false,
        chartRowsLost: 0,
        chartRepsLost: 0,
        chartFramesLost: 0,
        chartCurtainsLost: 0,
      },
      warnings: [],
      missingAssets: [],
    },
  ],
  skipped: [],
  errors: [],
})

describe('deux modales successives : le fond reste verrouillé jusqu à la dernière fermeture', () => {
  let wrapper
  // Montés ensemble, comme App.vue les monte tous les deux une fois pour toutes.
  const mountDeuxModales = () => {
    const Host = defineComponent({
      setup() {
        return () => h('div', [h(SyncReportDialog), h(RestoreErrorDialog)])
      },
    })
    wrapper = mount(Host, { global: { plugins: [i18n] }, attachTo: document.body })
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('ouvre A, ouvre B, ferme A : le fond RESTE verrouillé ; ferme B : déverrouillé', async () => {
    const w = mountDeuxModales()

    // A — le rapport de synchro s'ouvre : le verrou se pose.
    useSyncReportStore().setReport(rapportASignaler())
    await flushPromises()
    expect(w.find('.srd-overlay').exists()).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')

    // B — l'incident de restauration se peint PAR-DESSUS (hors file, z-index 1300) :
    // second détenteur, le compteur passe à deux.
    useRestoreErrorStore().setReport({
      kind: 'error',
      error: 'EIO',
      path: null,
      at: new Date().toISOString(),
    })
    await flushPromises()
    expect(w.find('[data-test="restore-error-dialog"]').exists()).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')

    // LE CŒUR DU SCÉNARIO : A se ferme la première — par son propre bouton « Compris »,
    // seule sortie réelle (une fois ouvert, le rapport est DÉCOUPLÉ du magasin, cf.
    // SyncReportDialog.vue). L'ancien idiome remettait ici `body.style.overflow = ''`
    // — le fond redéfilait sous B encore ouverte.
    await w.find('[data-test="close"]').trigger('click')
    await flushPromises()
    expect(w.find('.srd-overlay').exists()).toBe(false)
    expect(document.body.style.overflow).toBe('hidden')

    // B se ferme à son tour : la DERNIÈRE libération déverrouille.
    useRestoreErrorStore().setReport(null)
    await flushPromises()
    expect(w.find('[data-test="restore-error-dialog"]').exists()).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })
})

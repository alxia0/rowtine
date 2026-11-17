// @vitest-environment jsdom
// Les paires de messages qui peuvent RÉELLEMENT s'afficher ensemble, et que la file ordonne.
// Seules les paires plausibles sont testées (neuf messages font trente-six paires). Les autres
// paires réelles vivent au plus près de leur écran : porte du dossier × astuce de balayage dans
// first-detail-tip-bandeau-import.spec.js, avertissement d'import × astuce dans
// library-import-caveat.spec.js.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeQueueStore } from '@/stores/notice-queue'
import { useNoticeSlot } from '@/composables/useNoticeSlot'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('paire 1 — garde-fou de version x porte du dossier', () => {
  // Le garde-fou de version PRIME sur la porte du dossier ; cette primauté tient au rang
  // dans la file, plus à un z-index.
  it('le garde-fou parle, la porte attend — puis la porte parle', () => {
    const q = useNoticeQueueStore()
    q.request(NOTICE.FOLDER_GATE)
    q.request(NOTICE.VERSION_GUARD)

    // PRÉCONDITION : les deux sont bien demandeurs en même temps.
    expect(q.requesters).toHaveLength(2)

    expect(q.active).toBe(NOTICE.VERSION_GUARD)

    // Et la porte n'est PAS perdue : elle prend la parole au retrait du garde-fou.
    q.withdraw(NOTICE.VERSION_GUARD)
    expect(q.active).toBe(NOTICE.FOLDER_GATE)
  })
})

describe('paire 2 — porte du dossier x bienvenue de l accueil', () => {
  // Deux pop-up superposées au premier lancement, vues seulement sur l'appareil : la porte pose
  // `welcomeDue` ALORS QU'ELLE EST ENCORE À L'ÉCRAN, avec l'accueil déjà monté derrière elle.
  it('la porte parle, la bienvenue attend — puis la bienvenue parle', () => {
    const q = useNoticeQueueStore()
    q.request(NOTICE.FOLDER_GATE)
    q.request(NOTICE.WELCOME)

    // PRÉCONDITION : les deux demandent la parole EN MÊME TEMPS ; sans elle, un magasin qui
    // n'enregistre pas la bienvenue passerait.
    expect(q.requesters).toHaveLength(2)
    expect(q.requesters).toContain(NOTICE.WELCOME)

    expect(q.active).toBe(NOTICE.FOLDER_GATE)

    q.withdraw(NOTICE.FOLDER_GATE)
    expect(q.active).toBe(NOTICE.WELCOME)
  })
})

describe('paire 3 — nouveautés de la version x bienvenue, visite guidée, avertissement d import, astuce', () => {
  // Les nouveautés (rang 7) cèdent aux messages d'accueil et gagnent contre les deux
  // messages d'apprentissage qui peuvent attendre.
  it.each([
    [NOTICE.WELCOME],
    [NOTICE.READER_TOUR],
  ])('%s parle, les nouveautés attendent — puis les nouveautés parlent', (fort) => {
    const q = useNoticeQueueStore()
    q.request(NOTICE.NEW_VERSION_NOTES)
    q.request(fort)

    // PRÉCONDITION : les deux demandent la parole en même temps.
    expect(q.requesters).toHaveLength(2)
    expect(q.requesters).toContain(NOTICE.NEW_VERSION_NOTES)

    expect(q.active).toBe(fort)
    q.withdraw(fort)
    expect(q.active).toBe(NOTICE.NEW_VERSION_NOTES)
  })

  it.each([
    [NOTICE.IMPORT_CAVEAT],
    [NOTICE.SWIPE_HINT],
  ])('les nouveautés parlent, %s attend — puis il parle', (faible) => {
    const q = useNoticeQueueStore()
    q.request(faible)
    q.request(NOTICE.NEW_VERSION_NOTES)

    expect(q.requesters).toHaveLength(2)
    expect(q.requesters).toContain(faible)

    expect(q.active).toBe(NOTICE.NEW_VERSION_NOTES)
    q.withdraw(NOTICE.NEW_VERSION_NOTES)
    expect(q.active).toBe(faible)
  })
})

// Garde-fous du composable useNoticeSlot, ciblés directement : aucun composant ne monte avec sa
// condition DÉJÀ vraie (OnboardingFolderPrompt part de `visible = ref(false)`), donc aucun test
// de montage ne rougirait si `{ immediate: true }` disparaissait du `watch`.
function mountWanting(id, wants) {
  return mount(
    defineComponent({
      setup() {
        const hasSlot = useNoticeSlot(id, wants)
        return () => h('div', hasSlot.value ? 'VISIBLE' : 'HIDDEN')
      },
    }),
  )
}

describe('useNoticeSlot — garde-fous du branchement', () => {
  it('condition DÉJÀ vraie au montage : demande quand même (immediate)', () => {
    const q = useNoticeQueueStore()
    const w = mountWanting(NOTICE.WELCOME, ref(true))
    // PRÉCONDITION : le composant est bien monté avec sa condition déjà vraie, pas
    // amenée à vrai après coup — c'est précisément le cas que `immediate: true` couvre.
    expect(w.text()).toBe('VISIBLE')
    expect(q.requesters).toContain(NOTICE.WELCOME)
  })

  // Sans `onBeforeUnmount`, le premier composant démonté resterait demandeur fantôme et le
  // second s'ajouterait par-dessus.
  it('un composant démonté libère la file : deux montages successifs ne laissent pas de résidu', () => {
    const q = useNoticeQueueStore()
    const w1 = mountWanting(NOTICE.WELCOME, ref(true))
    // PRÉCONDITION : le premier montage a bien demandé le message.
    expect(q.requesters).toContain(NOTICE.WELCOME)

    w1.unmount()
    expect(q.requesters).not.toContain(NOTICE.WELCOME)

    const w2 = mountWanting(NOTICE.WELCOME, ref(true))
    expect(q.requesters).toHaveLength(1)
    w2.unmount()
  })
})

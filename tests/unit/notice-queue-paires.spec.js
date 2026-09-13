// Unitaire — les paires de messages qui peuvent RÉELLEMENT se produire (§4.1 bis).
//
// Sept messages font vingt et une paires. Les tester toutes diluerait celles qui comptent.
// Les quatre messages du niveau application (App.vue) peuvent apparaître sur n'importe quel
// écran. Des trois messages d'écran, `welcome` reste seul sur l'accueil ; `swipeHint`, lui,
// a quitté la fiche patron pour la Bibliothèque ET le Stock (décision produit du
// 19/08/2026) — il cohabite donc désormais, POUR DE VRAI, avec `importCaveat`
// sur le même écran (Bibliothèque), et ce dernier est câblé depuis peu (LibraryView).
// « Trois écrans différents qui ne se croisent jamais » n'est donc plus vrai pour l'écran
// Bibliothèque — seulement pour l'accueil, qui reste isolé. Restent DEUX paires PROUVÉES
// ici, toutes au dossier.
//
// La troisième (porte du dossier × astuce de balayage) N'EST PAS ici : elle vit dans
// `tests/unit/first-detail-tip-bandeau-import.spec.js` (« G5 bis »), au plus près du
// composant qu'elle concerne, depuis le 19/08/2026. La QUATRIÈME (avertissement d'import
// × astuce de balayage, RÉELLE depuis peu) vit dans
// `tests/unit/library-import-caveat.spec.js`, au plus près de l'écran où les deux se
// croisent — `first-detail-tip-bandeau-import.spec.js` garde en plus un détecteur de
// mutation nommé sur cette même paire, qui vérifie le VAINQUEUR PAR SON NOM pour distinguer
// un mauvais câblage de `NOTICE.SWIPE_HINT` vers un autre identifiant valide du registre.
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
  // Elles s'ouvrent ENSEMBLE aujourd'hui, et c'est voulu : le commentaire d'App.vue dit que
  // le garde-fou « PRIME sur la porte du dossier et la bienvenue ». Avant ce lot, la
  // primauté tenait à un z-index. Elle tient maintenant au rang.
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
  // C'EST L'INCIDENT DU 10/08 : deux pop-up superposées au premier lancement, invisibles à
  // toute revue de code, vues seulement sur l'appareil. Le mécanisme est resté : la porte
  // pose `welcomeDue` (OnboardingFolderPrompt.vue::onChooseNow) ALORS QU'ELLE EST ENCORE À
  // L'ÉCRAN, et l'accueil est déjà monté derrière elle. Le lot du 10/08 a réglé l'ordre à
  // la main ; la file le règle par construction.
  it('la porte parle, la bienvenue attend — puis la bienvenue parle', () => {
    const q = useNoticeQueueStore()
    q.request(NOTICE.FOLDER_GATE)
    q.request(NOTICE.WELCOME)

    // PRÉCONDITION : les deux demandent la parole EN MÊME TEMPS. C'est la situation du
    // 10/08 ; sans cette assertion, un magasin qui n'enregistre pas la bienvenue passerait.
    expect(q.requesters).toHaveLength(2)
    expect(q.requesters).toContain(NOTICE.WELCOME)

    expect(q.active).toBe(NOTICE.FOLDER_GATE)

    q.withdraw(NOTICE.FOLDER_GATE)
    expect(q.active).toBe(NOTICE.WELCOME)
  })
})

// Garde-fous du composable useNoticeSlot (étape 6 : prouvés par mutation).
//
// ⚠️ On pensait initialement que retirer `{ immediate: true }` du `watch`
// ferait rougir les tests de montage de la porte et du rapport. FAUX, vérifié par
// mutation : `OnboardingFolderPrompt` déclare `visible = ref(false)` dans son PROPRE
// `setup()`, juste avant d'appeler `useNoticeSlot` — la condition est donc TOUJOURS
// fausse au premier passage du watch, jamais « déjà vraie ». Les tests existants ne
// font passer `visible`/`displayedReport` à vrai qu'APRÈS le montage (via `evaluate()`
// ou `setReport()` appelé après `mountIt()`) : c'est un changement, pas un état déjà là,
// et un `watch` sans `immediate` le voit très bien. Aucun test existant, dans ce fichier
// ou ailleurs, ne montait un composant alors que sa condition était DÉJÀ vraie — donc
// aucun ne pouvait rougir. Le garde-fou ci-dessous cible directement le composable, à
// l'endroit où le piège existe réellement.
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

  // Deuxième mutation testée (`onBeforeUnmount` vidé) : deux montages successifs du MÊME
  // message doivent laisser la file dans le même état qu'un seul montage — le premier
  // composant démonté doit s'être retiré, sinon le second s'ajoute par-dessus un
  // demandeur fantôme qui ne se retirera plus jamais de la session.
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

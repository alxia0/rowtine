// Unitaire — « Comment corriger » NE BRÛLE PAS l'astuce de balayage (revue du 19/08/2026,
// critique 1).
//
// POURQUOI CE FICHIER EXISTE À CÔTÉ DE `library-import-caveat.spec.js` : celui-là mocke
// entièrement `vue-router`, donc `router.push` n'y est qu'un espion — la Bibliothèque n'est
// JAMAIS démontée et le défaut d'ordre décrit ici ne peut pas s'y voir. Ici, un VRAI routeur
// et une vraie `<RouterView/>` : quitter `/library` démonte réellement l'écran, avec tout ce
// que ça entraîne (retrait des deux demandeurs de la file, `scope.stop()` de l'astuce).
// C'est la seule façon d'observer l'entrelacement réel.
//
// LE DÉFAUT MESURÉ : à la première visite de la Bibliothèque, l'avertissement d'import
// (rang 6) et l'astuce de balayage (rang 7) sont demandeurs EN MÊME TEMPS. Effacer le
// drapeau d'import AVANT de naviguer libère le rang 6 alors que l'écran est encore monté :
// la file promeut aussitôt l'astuce, dont le `watch` écrit `swipeHintSeen` en mémoire ET en
// base — sur une pop-up que personne n'a jamais vue, puisqu'on part au guide dans le même
// battement. L'astuce ne revenait alors JAMAIS, ni ici, ni sur le Stock, ni sur la fiche
// projet.
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import fr from '@/i18n/fr.json'
import { db, getSetting } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'
import { useNoticeQueueStore } from '@/stores/notice-queue'
import { NOTICE } from '@/constants/notice-queue'
import { GUIDE_SECTION_BIBLIOTHEQUE } from '@/constants/guide-sections'
import LibraryView from '@/views/LibraryView.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

// Coquille minimale du guide : ce test ne dit rien du contenu du guide, seulement du fait
// qu'on y arrive et que la Bibliothèque est démontée en partant.
const GuideStub = { name: 'GuideStub', template: '<div class="guide-stub" />' }

function creerRouteur() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/library', name: 'library', component: LibraryView },
      { path: '/guide', name: 'guide', component: GuideStub },
    ],
  })
}

const App = { template: '<RouterView />' }

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

// Les écritures Dexie franchissent un vrai tour d'horloge (fake-indexeddb) : `flushPromises`
// seul ne vide que les microtâches. Même repli que le reste des specs de ce lot.
async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
}

function dialogueParTitre(w, titre) {
  return w.findAllComponents(ConfirmDialog).find((d) => d.props('title') === titre)
}

describe('Bibliothèque — « Comment corriger » et l astuce de balayage', () => {
  it("n'écrit PAS « astuce vue » en partant au guide, et l'astuce revient à la visite suivante", async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setImportCaveatDue()

    const router = creerRouteur()
    router.push('/library')
    await router.isReady()
    const w = mount(App, { global: { plugins: [i18n, router] } })
    await settle()

    const q = useNoticeQueueStore()
    // PRÉCONDITION 1 — la SITUATION du défaut existe vraiment : les deux messages sont
    // demandeurs en même temps, l'avertissement tient l'écran, l'astuce attend derrière.
    // Sans elle, la suite serait verte pour la mauvaise raison (aucune promotion possible).
    expect(q.requesters).toContain(NOTICE.IMPORT_CAVEAT)
    expect(q.requesters).toContain(NOTICE.SWIPE_HINT)
    expect(q.active).toBe(NOTICE.IMPORT_CAVEAT)
    // PRÉCONDITION 2 — l'astuce n'a jamais été vue, ni en mémoire ni en base : c'est ce
    // qu'on va vérifier après coup, il faut donc partir de l'état contraire.
    expect(s.swipeHintSeen).toBe(false)
    expect((await getSetting('swipeHintSeen')) ?? false).toBe(false)

    const caveat = dialogueParTitre(w, fr.importCaveat.title)
    expect(caveat.props('open')).toBe(true)

    await caveat.find('[data-test="confirm-cancel"]').trigger('click')
    await settle()

    // La navigation a bien eu lieu, sur la bonne section — sans ça, tout le reste du test
    // parlerait d'un chemin qui n'est pas celui de l'utilisatrice.
    expect(router.currentRoute.value.name).toBe('guide')
    expect(router.currentRoute.value.query.section).toBe(GUIDE_SECTION_BIBLIOTHEQUE)
    // Et la Bibliothèque est réellement partie : le démontage est ce qui doit retirer les
    // deux demandeurs de la file.
    expect(w.findComponent(LibraryView).exists()).toBe(false)

    // LE CŒUR : l'astuce n'a jamais été peinte, elle ne doit pas être marquée vue.
    expect(s.swipeHintSeen).toBe(false)
    expect((await getSetting('swipeHintSeen')) ?? false).toBe(false)
    // L'avertissement d'import, lui, EST acquitté : le clic était délibéré.
    expect(s.importCaveatDue).toBe(false)
    expect((await getSetting('importCaveatDue')) ?? false).toBe(false)

    // Ce que ça donne pour l'utilisatrice : au retour à la Bibliothèque, l'astuce prend la parole,
    // cette fois seule (l'avertissement est acquitté pour de bon).
    router.push('/library')
    await settle()
    const astuce = dialogueParTitre(w, fr.onboarding.tipTitle)
    expect(astuce.props('open')).toBe(true)
  })
})

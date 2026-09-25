// @vitest-environment jsdom
// Le menu burger d'AppHeader.vue est la SEULE navigation de l'app (décision design du
// 28/06 : pas de barre basse). Il porte 9 entrées (Sessions depuis le 31/08), le lot du
// 12/08 y ayant fait entrer Statistiques, Dépenses et le Guide utilisateur — ce dernier
// ayant quitté l'écran À propos. Ce test couvre le CONTENU et l'ORDRE ; que le panneau tienne dans
// la fenêtre est couvert côté e2e (tests/e2e/menu-items.spec.js), un montage jsdom ne
// mesurant aucune géométrie réelle.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import AppHeader from '@/components/AppHeader.vue'
import { createTestRouter } from './helpers/i18n-router'

const ROUTES = ['home', 'stash', 'library', 'stats', 'sessions', 'expenses', 'guide', 'settings', 'about']

function makeRouter() {
  return createTestRouter(ROUTES.map((name) => ({
    path: `/${name === 'home' ? '' : name}`,
    name,
    component: { template: '<div/>' },
  })))
}

// Le routeur est RENDU avec le wrapper, plutôt que relu via `wrapper.vm.$router` : c'est
// l'instance qu'on interroge après chaque clic, sans dépendre de ce que `<script setup>`
// expose sur `vm`.
async function mountHeader() {
  const router = makeRouter()
  router.push('/')
  await router.isReady()
  const wrapper = mount(AppHeader, {
    props: { title: 'Test' },
    global: { plugins: [router, i18n] },
  })
  return { wrapper, router }
}

// Ouvre le menu et REQUÊTE les entrées à cet instant. Indispensable : `go()` referme le
// menu (`open.value = false`), le `v-if` du <nav> détruit tout le sous-arbre, et une
// collection relevée avant le clic pointerait ensuite sur des éléments détachés du DOM.
async function ouvrirEtLire(wrapper) {
  await wrapper.get('.hdr__burger').trigger('click')
  return wrapper.findAll('.menu__item')
}

describe('AppHeader — menu à 9 entrées', () => {
  it('affiche les 9 entrées DANS L’ORDRE : faire, consulter, aide', async () => {
    const { wrapper } = await mountHeader()
    const items = await ouvrirEtLire(wrapper)

    const fr = i18n.global.messages.value.fr.nav
    expect(items.map((i) => i.text())).toEqual([
      fr.home,
      fr.stash,
      fr.library,
      fr.stats,
      fr.sessions,
      fr.expenses,
      fr.guide,
      fr.settings,
      fr.about,
    ])
  })

  it('mène aux 9 routes attendues, dans le même ordre', async () => {
    const { wrapper, router } = await mountHeader()

    for (let i = 0; i < ROUTES.length; i++) {
      // Le menu est rouvert ET relu à chaque tour : le clic précédent l’a refermé et a
      // détruit le sous-arbre, une collection gardée d’un tour à l’autre serait détachée.
      const items = await ouvrirEtLire(wrapper)
      await items[i].trigger('click')
      // `go()` n'attend pas `router.push()`, et `isReady()` ne couvre que la navigation
      // INITIALE (vue-router 5) — pas les suivantes : lu dans
      // node_modules/vue-router/dist/vue-router.cjs, `isReady()` résout tout de suite dès
      // que `ready` est vrai. Même course déjà mesurée et outillée dans
      // onboarding-view-onboarded-guard.spec.js : « un nombre fixe de flushPromises()
      // s'est révélé instable », on y attend la conséquence observable via `vi.waitFor`.
      await vi.waitFor(() => {
        if (router.currentRoute.value.name !== ROUTES[i])
          throw new Error(`entrée ${i} : encore sur ${router.currentRoute.value.name}`)
      })
      expect(router.currentRoute.value.name, `entrée ${i}`).toBe(ROUTES[i])
    }
  })

  it('porte un séparateur décoratif, invisible pour les lecteurs d’écran et non cliquable', async () => {
    // Un séparateur qui se rendrait comme une 9e entrée serait annoncé « bouton » par un
    // lecteur d’écran et focalisable au clavier : il doit être un élément à part.
    const { wrapper } = await mountHeader()
    await ouvrirEtLire(wrapper)

    const sep = wrapper.get('.menu__sep')
    expect(sep.attributes('aria-hidden')).toBe('true')
    expect(sep.element.tagName).not.toBe('BUTTON')
  })

  it('nomme les 3 nouvelles entrées dans les 4 langues', async () => {
    // Parité : une clé oubliée dans une seule langue ferait afficher « nav.stats » brut.
    for (const lang of ['fr', 'en', 'de', 'es']) {
      const nav = i18n.global.messages.value[lang].nav
      for (const key of ['stats', 'sessions', 'expenses', 'guide']) {
        expect(typeof nav[key], `${lang}.nav.${key}`).toBe('string')
        expect(nav[key].trim(), `${lang}.nav.${key}`).not.toBe('')
      }
    }
  })
})

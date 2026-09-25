// @vitest-environment jsdom
// Unitaire — l'accueil ne dit JAMAIS « aucun projet » avant d'avoir lu la base.
//
// Défaut connu, photographié deux fois sur appareil (16/08 puis 17/08 à 20 h 39, Nexus 7) :
// pendant les premières secondes après le lancement — 8 secondes mesurées, pas une fraction —
// l'accueil affichait « EN COURS 0 », « CETTE SEMAINE 0 h » et « Aucun projet pour l'instant.
// Crée ton premier projet pour commencer. » sur un appareil contenant 8 projets et 4 ouvrages en
// cours. Rien n'était perdu (base à 43 Mo, sauvegarde intacte) : l'écran parlait trop tôt.
//
// Ce qui rend le défaut sérieux, c'est le TEXTE : il n'annonce pas un chargement, il affirme
// qu'il n'y a rien ET invite à repartir de zéro — le geste exactement inverse de celui qu'il
// faudrait faire. La personne au courant du défaut a elle-même interrompu son travail pour
// vérifier que les données de l'utilisatrice n'avaient pas disparu.
//
// Cause racine : `v-if="!groups.length"` ne distinguait pas « la base n'a pas encore répondu »
// de « la base a répondu, et elle est vide ». Le remède est ce drapeau-là, pas un délai.
//
// Le montage suit tests/unit/home-view.spec.js (Pinia réelle, base Dexie réelle, routeur simulé).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRouter: () => nav.router }))

import HomeView from '@/views/HomeView.vue'

function mountHome() {
  return mount(HomeView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { ProjectCard: true, StitchProgress: true },
    },
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.settings.put({ key: 'onboarded', value: true })
})

describe('l’accueil pendant que la base répond', () => {
  it('n’affirme PAS « aucun projet » alors que la base en contient', async () => {
    await db.projects.add({ name: 'Châle Brume', status: 'wip', technique: 'knitting', createdAt: '2026-08-01T10:00:00.000Z' })
    const w = mountHome()
    // Aucun `flushPromises` : c'est EXACTEMENT la fenêtre du défaut — le composant est monté,
    // `onMounted` n'a pas fini ses lectures Dexie. Sur appareil, cette fenêtre dure 8 secondes.
    expect(w.text()).not.toContain(fr.home.noProjects)
    await flushPromises()
    w.unmount()
  })

  it('annonce un chargement au lieu de se taire', async () => {
    await db.projects.add({ name: 'Châle Brume', status: 'wip', technique: 'knitting', createdAt: '2026-08-01T10:00:00.000Z' })
    const w = mountHome()
    // La convention du projet pour « ça charge » est déjà posée : SkeletonScreen.vue, `aria-busy`
    // + une annonce `role="status"`. L'accueil la réutilise plutôt que d'inventer un texte.
    expect(w.find('[aria-busy="true"]').exists()).toBe(true)
    await flushPromises()
    w.unmount()
  })

  it('les tuiles chiffrées ne montrent pas un zéro qu’elles n’ont pas mesuré', async () => {
    await db.projects.add({ name: 'Châle Brume', status: 'wip', technique: 'knitting', createdAt: '2026-08-01T10:00:00.000Z' })
    const w = mountHome()
    const tuiles = w.findAll('.tile__v').map((n) => n.text())
    expect(tuiles.length).toBeGreaterThan(0)
    for (const v of tuiles) expect(v).toBe('—')
    await flushPromises()
    w.unmount()
  })
})

describe('l’accueil une fois la base lue', () => {
  it('affiche bien l’invitation quand il n’y a RÉELLEMENT aucun projet', async () => {
    const w = mountHome()
    await vi.waitFor(() => expect(w.text()).toContain(fr.home.noProjects), { timeout: 10000 })
    expect(w.find('[aria-busy="true"]').exists()).toBe(false)
    w.unmount()
  })

  it('affiche les projets, et jamais l’invitation, quand la base en contient', async () => {
    await db.projects.add({ name: 'Châle Brume', status: 'wip', technique: 'knitting', createdAt: '2026-08-01T10:00:00.000Z' })
    const w = mountHome()
    await vi.waitFor(() => expect(w.find('[aria-busy="true"]').exists()).toBe(false), { timeout: 10000 })
    expect(w.text()).not.toContain(fr.home.noProjects)
    // Les chiffres sont mesurés, plus en attente : la tuile « en cours » dit 1.
    expect(w.findAll('.tile__v').map((n) => n.text())).toContain('1')
    w.unmount()
  })
})

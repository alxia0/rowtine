// @vitest-environment jsdom
// Suppression d'un projet dont le chrono tourne — plus de séance orpheline (revue de code
// du 31/08, entrée §2 du chrono unifié). Le défaut : la cascade de
// projectsStore.remove purge les sessions du projet, puis le router.replace vers l'accueil
// déclenche le garde « sortie de bulle », dont la pause commitante RÉÉCRIVAIT une ligne
// pour un projet disparu — une séance sans fiche où vivre. La fiche vide désormais le
// chrono SANS journaliser avant la cascade (store activeSession.discard), sous garde
// d'identité : seul le chrono du projet supprimé est vidé.
// On monte la VRAIE vue sur le VRAI routeur (même choix que router-chrono-bubble.spec.js,
// qui importe le singleton) : c'est le seul moyen d'éprouver l'enchaînement complet
// remove() -> discard -> cascade -> router.replace -> garde.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import router from '@/router'
import i18n from '@/i18n'
import { db, setSetting } from '@/db/db'
import { useActiveSessionStore } from '@/stores/activeSession'
import { useSettingsStore } from '@/stores/settings'
import { SESSION_NO_SECTION } from '@/constants/session'
import ProjectDetailView from '@/views/ProjectDetailView.vue'

const T0 = 1_700_000_000_000
const atTime = (ms) => Date.now.mockReturnValue(ms)

// Pinia « garde armé » (motif router-chrono-bubble.spec.js) : les réglages sont DÉJÀ
// chargés, le bloc de démarrage du beforeEach du routeur ne rejouera pas et le garde
// chrono est actif pour la navigation de remove().
async function armedPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)
  await useSettingsStore().load()
  return pinia
}

async function seedProject(name) {
  return db.projects.add({ name, technique: 'knitting', status: 'wip' })
}

// Monte la fiche du projet `pid` sur le routeur réel, chrono NON ouvert.
async function mountDetail(pid) {
  await router.push(`/project/${pid}`)
  await router.isReady()
  const w = mount(ProjectDetailView, { global: { plugins: [router, i18n] } })
  await vi.waitFor(() => expect(w.find('.phdr__title').exists()).toBe(true), { timeout: 10000 })
  return w
}

// Le geste complet de suppression : menu ⋮ puis l'item destructeur, puis attente du fait
// observable « le routeur est rentré à l'accueil » (le garde a forcément passé la main).
async function removeViaMenu(w) {
  await w.find('.phdr__kebab').trigger('click')
  await vi.waitFor(() => expect(w.find('.menu__item--danger').exists()).toBe(true), { timeout: 10000 })
  await w.find('.menu__item--danger').trigger('click')
  await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'), { timeout: 10000 })
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  await setSetting('onboarded', true) // sinon le beforeEach du routeur détourne vers l'onboarding
  vi.spyOn(Date, 'now').mockReturnValue(T0)
})

afterEach(async () => {
  // Coupe l'intervalle réel du chrono de LA pinia active du test (sinon il fuit sur les
  // fichiers suivants — motif documenté dans project-detail-chrono.spec.js).
  const active = useActiveSessionStore()
  await active.pause()
  await active.stopAndClear()
  vi.restoreAllMocks()
})

describe('suppression d’un projet dont le chrono tourne', () => {
  it('chrono DU projet supprimé : vidé sans journaliser — AUCUNE ligne en base, pas même par le garde', async () => {
    await armedPinia()
    const pid = await seedProject('Pull condamné')
    const w = await mountDetail(pid)
    // Chrono en marche sur le projet, 5 s non commises (les pauses commitantes n'ont pas
    // encore passé) : c'est le solde que l'ancien flux réécrivait en ligne orpheline.
    const active = useActiveSessionStore()
    await active.openFor(pid, SESSION_NO_SECTION, 0)
    await active.play()
    atTime(T0 + 5_000)
    await removeViaMenu(w)
    // Mutation interceptée : sans le discard pré-cascade dans ProjectDetailView.remove,
    // la cascade purge les sessions puis le garde « sortie de bulle » (router.replace
    // home) ferme le chrono ENCORE ACTIF du projet mort : sa pause commitante écrirait
    // 1 ligne projectId=pid -> orpheline. Ici : rien, nulle part.
    expect(await db.projects.count()).toBe(0) // la cascade a bien supprimé le projet
    expect(await db.sessions.count()).toBe(0) // AUCUNE ligne, orpheline comprise
    expect(active.isActive).toBe(false) // le chrono est vide, pas seulement en pause
    expect(active.running).toBe(false)
  })

  it('chrono d’un AUTRE projet : pas touché par la suppression — le garde l’écrit en sortant, comme avant', async () => {
    await armedPinia()
    const deadId = await seedProject('Pull condamné')
    const liveId = await seedProject('Pull qui vit')
    const w = await mountDetail(deadId)
    // Chrono en marche SUR L'AUTRE projet (état que le garde rend rare mais pas impossible
    // — un deep-link, un retour arrière) : la suppression du premier ne doit pas le vider.
    const active = useActiveSessionStore()
    await active.openFor(liveId, SESSION_NO_SECTION, 0)
    await active.play()
    atTime(T0 + 5_000)
    await removeViaMenu(w)
    // Mutation interceptée : discard inconditionnel dans remove() (sans la garde
    // d’identité projectId === projet supprimé) -> le chrono du projet vivant serait vidé
    // AVANT la sortie, le garde ne trouverait rien à fermer et 0 ligne serait écrite :
    // les 5 s tricotées auraient disparu avec la fiche d’un AUTRE projet.
    const rows = await db.sessions.toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].projectId).toBe(liveId) // le temps part sur le projet tricoté
    expect(rows[0].durationSec).toBe(5) // écrit par le GARDE à la sortie, comme avant
    expect((await db.projects.toArray()).map((p) => p.id)).toEqual([liveId])
    expect(active.isActive).toBe(false) // fermé par le garde, jamais par la suppression
  })
})

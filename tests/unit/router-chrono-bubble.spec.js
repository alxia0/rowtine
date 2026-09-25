// @vitest-environment jsdom
// Garde « sortie de bulle » du chrono (chantier « chrono unifié », 2026-08-30) : la séance ne se
// ferme plus à la sortie du LECTEUR (défaut connu : « aller voir le patron ferme la
// séance ») mais en SORTANT du projet, quel que soit l'écran d'où l'on part. La décision se
// prend sur la ROUTE DE DESTINATION, dans le beforeEach global — jamais sur l'ordre
// montage/démontage : deux écritures Dexie asynchrones (pause, stopAndClear) lâchées pendant
// un démontage se coursent (17/08). Ici, le beforeEach est attendu (await) par
// vue-router : la séance est clos et journalisée AVANT que l'écran quitté ne se démonte.
//
// On teste le VRAI routeur (même choix que router-scroll-behavior.spec.js, qui importe le
// singleton) : c'est le seul moyen de couvrir aussi la navigation initiale de démarrage,
// où le garde ne doit PAS tirer (un chrono qui a survécu à un arrêt forcé reprend).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import router from '@/router'
import { db, setSetting } from '@/db/db'
import { useActiveSessionStore } from '@/stores/activeSession'
import { useSettingsStore } from '@/stores/settings'
import { useSnackbarStore } from '@/stores/snackbar'
import { SESSION_NO_SECTION } from '@/constants/session'

const T0 = 1_700_000_000_000
const atTime = (ms) => Date.now.mockReturnValue(ms)

// Pinia « garde armé » : les réglages sont DÉJÀ chargés (loaded vrai), donc le prochain
// passage du beforeEach est une navigation ORDINAIRE — le bloc de démarrage (chargement
// settings + restauration du chrono persistant) ne rejouera pas, et le garde chrono est
// actif. Chaque test prépare ainsi sa propre pinia : le store actif de test n'a jamais
// subi la restauration de démarrage, il ne contient QUE ce que le test y met.
async function armedPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)
  await useSettingsStore().load()
  return pinia
}

// Séance en marche sur `projectId`, ouverte directement dans le store (aucun écran monté :
// le garde ne lit ni la base ni l'écran de départ, seulement la destination).
async function runningChronoOn(projectId) {
  const active = useActiveSessionStore()
  await active.openFor(projectId, SESSION_NO_SECTION, 0)
  await active.play()
  return active
}

beforeEach(async () => {
  await db.settings.clear()
  await db.sessions.clear()
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

describe('router — garde chrono : sortir de la bulle du projet ferme la séance', () => {
  it('vers l’accueil : pause + clôture + UNE séance écrite + snackbar « Temps enregistré »', async () => {
    await armedPinia()
    await runningChronoOn(7)
    // Position de départ : le lecteur du projet 7 (dans la bulle — la navigation qui suit
    // ne doit rien fermer, c'est aussi la pré-condition du test).
    await router.push('/project/7/read')
    const active = useActiveSessionStore()
    expect(active.isActive).toBe(true)

    atTime(T0 + 5000)
    await router.push('/')

    expect(active.isActive).toBe(false) // la séance est close, pas seulement en pause
    const rows = await db.sessions.toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].projectId).toBe(7)
    expect(rows[0].durationSec).toBe(5)
    expect(rows[0].sectionId).toBe(SESSION_NO_SECTION)
    const snackbar = useSnackbarStore()
    expect(snackbar.visible).toBe(true)
    expect(snackbar.message).toContain('0:05') // fmtDuration(5) — stable dans toutes les langues
  })

  // Une fermeture qui échoue (écriture refusée) ne doit pas murer la navigation hors du projet.
  it('échec de la fermeture : la navigation aboutit quand même', async () => {
    await armedPinia()
    const active = await runningChronoOn(7)
    await router.push('/project/7/read')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(active, 'pause').mockRejectedValueOnce(new Error('écriture refusée'))
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')
    expect(err).toHaveBeenCalled()
  })

  it('ouvrir un AUTRE projet ferme la séance du premier et l’écrit SUR CE projet', async () => {
    await armedPinia()
    await runningChronoOn(7)
    atTime(T0 + 5000)
    await router.push('/project/8')
    const rows = await db.sessions.toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].projectId).toBe(7) // le temps part sur le projet tricoté, pas sur celui ouvert
    expect(useActiveSessionStore().isActive).toBe(false)
  })

  it('la fiche patron en bibliothèque (pattern) sort de la bulle : ferme + enregistre', async () => {
    await armedPinia()
    await runningChronoOn(7)
    atTime(T0 + 5000)
    await router.push('/pattern/12')
    expect((await db.sessions.toArray()).length).toBe(1)
    expect(useActiveSessionStore().isActive).toBe(false)
  })

  it('une séance restée à 0 s se ferme sans écrire au journal ni signaler', async () => {
    await armedPinia()
    const active = useActiveSessionStore()
    await active.openFor(7, SESSION_NO_SECTION, 0) // ouverte mais jamais lancée : 0 s
    await router.push('/stash')
    expect(active.isActive).toBe(false) // close quand même (rien ne doit traîner dans Dexie)
    expect(await db.sessions.count()).toBe(0)
    expect(useSnackbarStore().visible).toBe(false)
  })

  it('après une fermeture, naviguer ENCORE hors bulle n’écrit pas deux fois (idempotent)', async () => {
    await armedPinia()
    await runningChronoOn(7)
    atTime(T0 + 5000)
    await router.push('/') // 1re sortie : ferme
    await router.push('/settings') // 2e navigation hors bulle : chrono déjà inactif → no-op
    const rows = await db.sessions.toArray()
    expect(rows.length).toBe(1)
  })

  it('sortir de bulle APRÈS une pause : le journal garde sa ligne unique, rien de plus n’est écrit', async () => {
    // Chemin du geste « Corriger » : la pause est DÉJÀ passée quand la séance quitte la
    // bulle — et depuis « séances live », cette pause a commis le temps au journal. La
    // fermeture qui suit ne doit RIEN rajouter : le solde est vide (filigrane committedSec),
    // la ligne de l'épisode reste UNIQUE à la durée exacte, et le snackbar annonce le TOTAL
    // de l'épisode fermé. Mutation interceptée : réintroduire un sessionsStore.add au plein
    // elapsed dans closeChronoSession (l'ancien helper) doublerait la ligne → rouge ici.
    await armedPinia()
    await runningChronoOn(7)
    atTime(T0 + 5000)
    const active = useActiveSessionStore()
    await active.pause() // pause commitante : les 5 s sont déjà au journal
    expect(await db.sessions.count()).toBe(1)
    await router.push('/')
    const rows = await db.sessions.toArray()
    expect(rows.length).toBe(1) // UNE ligne : la fermeture n'en rajoute pas
    expect(rows[0].durationSec).toBe(5) // …à la durée exacte de l'épisode
    expect(rows[0].projectId).toBe(7)
    expect(useSnackbarStore().message).toContain('0:05') // le TOTAL de l'épisode, pas un solde
  })
})

describe('router — garde chrono : rester dans la bulle poursuit la séance', () => {
  it('non-régression : quitter le LECTEUR vers la fiche du MÊME projet ne ferme rien', async () => {
    // Le défaut connu (« aller voir le patron ferme la séance ») : le bouton
    // Retour du lecteur. Désormais la fiche est DANS la bulle — la séance poursuit.
    await armedPinia()
    await runningChronoOn(7)
    await router.push('/project/7/read')
    atTime(T0 + 5000)
    await router.push('/project/7') // le geste « Retour » du lecteur
    const active = useActiveSessionStore()
    expect(active.isActive).toBe(true) // toujours ouverte…
    expect(active.running).toBe(true) // …et toujours en marche : aucune pause sauvage
    expect(await db.sessions.count()).toBe(0) // aucune écriture
    expect(useSnackbarStore().visible).toBe(false)
  })

  it('l’écran de correction porte l’id du PATRON : il reste dans la bulle quelle que soit sa valeur', async () => {
    await armedPinia()
    await runningChronoOn(7)
    atTime(T0 + 5000)
    await router.push('/pattern/99/correct') // 99 = id patron, ≠ 7 = id projet
    const active = useActiveSessionStore()
    expect(active.isActive).toBe(true)
    expect(active.running).toBe(true) // le garde ne touche pas à la marche
    expect(await db.sessions.count()).toBe(0)
  })

  it('l’édition du même projet reste dans la bulle', async () => {
    await armedPinia()
    await runningChronoOn(7)
    atTime(T0 + 5000)
    await router.push('/project/7/edit')
    expect(useActiveSessionStore().isActive).toBe(true)
    expect(await db.sessions.count()).toBe(0)
  })
})

describe('router — garde chrono : navigation initiale de démarrage', () => {
  it('un chrono qui a survécu à un arrêt forcé REPREND : le garde ne tire pas au démarrage', async () => {
    // Séance persistée par la session précédente (chrono en marche à l’arrêt de l’app),
    // directement en base : le beforeEach du routeur la restaure via activeSession.load().
    await setSetting('activeSession', {
      projectId: 7,
      sectionId: SESSION_NO_SECTION,
      accumulatedSec: 30,
      runningSince: T0,
      rowsAtStart: 0,
    })
    // Pinia VIERGE (settings jamais chargés) : le prochain passage EST la navigation
    // initiale — même en atterrissant directement HORS bulle, rien ne doit se fermer.
    setActivePinia(createPinia())
    await router.push('/counters')

    const active = useActiveSessionStore()
    expect(active.isActive).toBe(true)
    expect(active.projectId).toBe(7)
    expect(active.running).toBe(true) // restaurée EN MARCHE, pas seulement en pause
    expect(active.elapsedSec).toBeGreaterThanOrEqual(30)
    expect(await db.sessions.count()).toBe(0)
  })
})

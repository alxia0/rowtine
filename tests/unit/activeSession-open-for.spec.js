// Cycle de vie du chrono — openFor. Le magasin n'avait qu'un test de formatage avant ces travaux.
// Depuis l'ajout des « séances live » : openFor ne rend PLUS d'instantané `previous` — la
// fermeture de l'ancien chrono vit DANS le store (commit du temps au journal + reset),
// silencieuse ; l'appelant n'a plus rien à journaliser lui-même.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useActiveSessionStore } from '@/stores/activeSession'
import { db } from '@/db/db'

// ⚠️ PAS de vi.useFakeTimers() : il fige Dexie (fake-indexeddb s'appuie sur setTimeout) et
// tout `await` sur la base expire. On ne truque que `Date.now`, seule source de temps du chrono.
const T0 = 1_700_000_000_000
const atTime = (ms) => Date.now.mockReturnValue(ms)
// Le journal d'un projet, trié par id croissant = ordre de NAISSANCE des lignes (Dexie ++id).
const journal = async (pid) =>
  (await db.sessions.where('projectId').equals(Number(pid)).toArray()).sort((a, b) => a.id - b.id)

describe('activeSession — openFor', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    vi.spyOn(Date, 'now').mockReturnValue(T0)
  })
  afterEach(async () => {
    await useActiveSessionStore().pause() // arrête le setInterval réel, sinon il fuit
    vi.restoreAllMocks()
  })

  it('changer de PROJET ferme SILENCIEUSEMENT l’ancien chrono : temps au journal, pas d’instantané rendu', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5000)
    const returned = await s.openFor(2, 0, 0)
    // Mutation interceptée : réintroduire le retour `previous` (l'appelant devait journaliser
    // lui-même) -> un écran qui n'écrit pas l'instantané perd le temps. La fermeture est
    // DANS le store maintenant : le temps du projet 1 est EN BASE, le retour est vide.
    expect(returned).toBeUndefined()
    const lines = await journal(1)
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(5)
    expect(lines[0].projectId).toBe(1)
    expect(await journal(2)).toHaveLength(0)
    expect(s.projectId).toBe(2)
    expect(s.elapsedSec).toBe(0)
    expect(s.committedSec).toBe(0)
    expect(s.mergeIntoId).toBe(null)
  })

  it('changer de SECTION ferme tout autant la séance (la ligne porte l’ANCIENNE section)', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 3, 0)
    await s.play()
    atTime(T0 + 5000)
    await s.openFor(1, 7, 0)
    const lines = await journal(1)
    // Mutation interceptée : mutation du NOUVEAU slot avant le commit -> la ligne naîtrait
    // avec sectionId 7 : le temps couru appartenait pourtant à la section 3.
    expect(lines).toHaveLength(1)
    expect(lines[0].sectionId).toBe(3)
    expect(lines[0].durationSec).toBe(5)
    expect(s.sectionId).toBe(7)
    expect(s.elapsedSec).toBe(0)
  })

  it('rouvrir le MÊME couple poursuit la séance : rien de fermé, rien de rendu', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5000)
    const returned = await s.openFor(1, 0, 0)
    // Mutation interceptée : perte de la garde sur le COUPLE (projet, section) -> le temps
    // accumulé serait remis à zéro à chaque remontée d'écran, jamais journalisé. La garde
    // rend openFor idempotent : même couple = poursuite.
    expect(returned).toBeUndefined()
    expect(s.elapsedSec).toBe(5)
    expect(s.running).toBe(true)
    expect(await journal(1)).toHaveLength(0) // le chrono poursuit : rien à fermer, rien à écrire
  })

  it('changement de slot : le live est plié AU GESTE — la ligne porte le temps du geste, pas celui du passage en file', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 2000)
    const opening = s.openFor(2, 0, 0) // le geste : le chrono doit s'arrêter ICI
    // Le chrono est arrêté à l'instant du geste, avant tout await sur l'étape en file —
    // même exigence que pause() : l'écran (la pastille) bascule au geste, pas au commit.
    // Mutation interceptée : sans le pli synchrone, runningSince resterait armé et le
    // commit lirait l'horloge AU PASSAGE de l'étape.
    expect(s.running).toBe(false)
    // La file est occupée / le WebView est lent : l'horloge AVANCE entre le geste et le
    // passage de l'étape. Entrelace de la revue du 31/08 (Minor 3) : une pause tapée dans
    // ce délai (onMounted du lecteur contre un tap sur la pastille) pliait son live dans
    // l'accumulé, que le reset de l'étape éjectait sans commit.
    atTime(T0 + 5000)
    await s.pause() // le tap : le chrono est déjà arrêté, sa step ne trouve rien à commettre
    await opening
    const lines = await journal(1)
    // Mutation interceptée (retour à un commit mesuré au passage de l'étape) -> la ligne
    // porterait 5 s (l'horloge du passage) au lieu de 2 s (celle du geste) : du temps
    // compté « en vol » puis éjecté au reset, ou perdu selon qui arrive en dernier.
    expect(lines).toHaveLength(1)
    expect(lines[0].projectId).toBe(1)
    expect(lines[0].durationSec).toBe(2)
    expect(s.projectId).toBe(2)
    expect(s.committedSec).toBe(0) // épisode neuf sur le slot 2 : triplet remis à zéro
    expect(s.mergeIntoId).toBe(null)
  })
})

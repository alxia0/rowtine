// Unitaire — le chrono JOURNALISANT (lot « la séance visible dès la pause », 30/08).
// Avant ce lot, ce fichier ne testait que le formatage ; depuis, chaque pause commet son
// temps AU JOURNAL (table sessions) et chaque reprise décide fusion ou split. Ces specs
// frappent une vraie base (fake-indexeddb, comme les autres specs store) : le contrat
// éprouvé est « ce qui atterrit en base », pas seulement l'état en mémoire. Chaque garde
// porte en commentaire LA mutation qui doit la faire passer au rouge.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import Dexie from 'dexie'
import { useActiveSessionStore, fmtDuration } from '@/stores/activeSession'
import { useSessionsStore } from '@/stores/sessions'
import { db, getSetting, setSetting } from '@/db/db'

// ⚠️ PAS de vi.useFakeTimers() : il fige Dexie (fake-indexeddb s'appuie sur setTimeout) et
// tout `await` sur la base expire. On ne truque que `Date.now`, seule source de temps du chrono.
const T0 = 1_700_000_000_000
const atTime = (ms) => Date.now.mockReturnValue(ms)
const iso = (ms) => new Date(ms).toISOString()
// Le journal d'un projet, trié par id croissant = ordre de NAISSANCE des lignes (Dexie ++id).
const journal = async (pid) =>
  (await db.sessions.where('projectId').equals(Number(pid)).toArray()).sort((a, b) => a.id - b.id)

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

describe('fmtDuration', () => {
  it('formate en m:ss sous une heure', () => {
    expect(fmtDuration(0)).toBe('0:00')
    expect(fmtDuration(5)).toBe('0:05')
    expect(fmtDuration(65)).toBe('1:05')
    expect(fmtDuration(599)).toBe('9:59')
  })

  it('formate en h:mm:ss à partir d’une heure', () => {
    expect(fmtDuration(3600)).toBe('1:00:00')
    expect(fmtDuration(3661)).toBe('1:01:01')
  })

  it('tronque les fractions et borne les négatifs à zéro', () => {
    expect(fmtDuration(65.9)).toBe('1:05')
    expect(fmtDuration(-10)).toBe('0:00')
  })
})

describe('pause — le journal', () => {
  it('pause écrit une ligne neuve sur projet vierge : floor du temps couru, filigrane posé', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5_500)
    await s.pause()
    const lines = await journal(1)
    expect(lines).toHaveLength(1)
    // Mutation interceptée : pause non commitante (l'ANCIEN contrat — seul l'écran écrivait)
    // -> 0 ligne en base. Filigrane jamais avancé -> committedSec 0 et la fermeture qui
    // suit réécrirait les 5 s une deuxième fois.
    const line = lines[0]
    expect(line.durationSec).toBe(5) // floor de 5,5 s — jamais 6 (chunkToCommit)
    expect(line.manual).toBeUndefined() // ligne du chrono, pas une saisie main
    expect(line.date).toBe(iso(T0 + 5_500))
    expect(line.lastWriteAt).toBe(iso(T0 + 5_500))
    expect(s.committedSec).toBe(5)
    expect(s.mergeIntoId).toBe(line.id)
    expect(s.elapsedSec).toBe(5)
  })

  it('une seconde pause n’ouvre AUCUNE transaction : rien à committer, rien à rafraîchir', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5_500)
    await s.pause()
    const first = (await journal(1))[0]
    const tx = vi.spyOn(db, 'transaction')
    atTime(T0 + 60_000) // le temps passe, mais le chrono est ARRÊTÉ : rien ne s'accumule
    await s.pause()
    // Mutation interceptée : ouvrir la transaction avant le test du chunk (ou committer 0)
    // -> l'espion verrait un appel ; une ligne vide naîtrait, lastWriteAt rafraîchi pour rien.
    expect(tx).not.toHaveBeenCalled()
    const lines = await journal(1)
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(5)
    expect(lines[0].lastWriteAt).toBe(first.lastWriteAt)
    tx.mockRestore()
  })

  it('le solde fractionnaire est rattrapé à la pause suivante (5,5 s puis 1,6 s -> 7 en base)', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5_500)
    await s.pause() // écrit 5 ; il reste 0,5 s non écrites en réserve
    await s.play() // reprise immédiate : la ligne vient d'être touchée -> fusion
    atTime(T0 + 5_500 + 1_600) // 7,1 s écoulées au total
    await s.pause() // chunk = floor(7,1 - 5) = 2
    const lines = await journal(1)
    // Mutation interceptée : chunk mesuré sur elapsedSec seul (filigrane ignoré) -> 7 écrits
    // une première fois PUIS encore 7 -> 14. C'est le filigrane qui rend la pause idempotente.
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(7)
    expect(s.committedSec).toBe(7)
  })
})

describe('reprise — fusion ou split', () => {
  it('reprise sous 2 h : fusion par UPDATE PARTIEL — date et sectionId de la cible intacts', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 3, 0)
    await s.play()
    atTime(T0 + 5_000)
    await s.pause() // naissance de la ligne (sectionId 3, date = T0+5 s)
    const born = (await journal(1))[0]
    atTime(T0 + 10 * 60_000) // reprise 10 min plus tard : dernier contact à T0+5 s -> adoption
    await s.play()
    atTime(T0 + 10 * 60_000 + 3_000)
    await s.pause() // chunk = floor(8 - 5) = 3
    const lines = await journal(1)
    // Mutation interceptée : put complet (ou update emportant d'autres champs) -> `date`
    // deviendrait l'heure de la fusion, sectionId retomberait. La fusion ne touche QUE
    // durationSec et lastWriteAt.
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(8)
    expect(lines[0].lastWriteAt).toBe(iso(T0 + 10 * 60_000 + 3_000))
    expect(lines[0].date).toBe(born.date)
    expect(lines[0].sectionId).toBe(3)
  })

  it('reprise à 3 h : split — épisode neuf, NOUVELLE ligne, triplet remis à zéro', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5_000)
    await s.pause()
    atTime(T0 + 3 * 3_600_000) // 3 h depuis le dernier contact : l'épisode est mort
    await s.play()
    atTime(T0 + 3 * 3_600_000 + 2_000)
    await s.pause()
    const lines = await journal(1)
    // Mutation interceptée : split omis (fusion systématique) -> 1 ligne de 7 s, et la
    // pastille jamais remise à zéro (elapsedSec 7 au lieu de 2).
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.durationSec)).toEqual([5, 2])
    expect(lines[1].date).toBe(iso(T0 + 3 * 3_600_000 + 2_000))
    expect(s.mergeIntoId).toBe(lines[1].id)
    expect(s.elapsedSec).toBe(2)
  })

  it('dernière ligne du projet MANUELLE : jamais fusion — ligne neuve, la saisie intacte', async () => {
    await db.sessions.add({
      projectId: 1, sectionId: 9, date: iso(T0 - 60_000), durationSec: 999, rowsDone: 4, manual: true,
    })
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 2_000)
    await s.pause()
    const lines = await journal(1)
    // Mutation interceptée : filtre `!s.manual` retiré de la requête de dernière ligne ->
    // adoption de la saisie main -> une seule ligne à 1001. Une ligne saisie à la main
    // appartient à l'utilisatrice : le chrono ne la grossit jamais.
    expect(lines).toHaveLength(2)
    expect(lines.find((l) => l.manual).durationSec).toBe(999)
    expect(lines.find((l) => !l.manual).durationSec).toBe(2)
  })

  it('pause PENDANT la requête d’écart du play : le commit attend la décision et fusionne dans la ligne adoptée', async () => {
    // La ligne adoptable existe déjà (touchée il y a 10 min). Sans sérialisation des étapes
    // Dexie, le commit de la pause lirait mergeIntoId AVANT que le play l'ait décidée
    // (null) : il créerait une ligne neuve pendant que l'épisode devait fusionner.
    await db.sessions.add({
      projectId: 1, sectionId: 5,
      date: iso(T0 - 10 * 60_000), lastWriteAt: iso(T0 - 10 * 60_000), durationSec: 100,
    })
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    s.play() // SANS await : sa requête d'écart part en file
    atTime(T0 + 2_000)
    await s.pause() // pause pendant ladite requête
    const lines = await journal(1)
    // Mutation interceptée : étapes Dexie jouées en parallèle (commit hors file sérielle)
    // -> 2 lignes (la neuve + l'adoptée restée à 100). La file garantit l'ordre : décision
    // d'abord, commit ensuite.
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(102)
    expect(s.mergeIntoId).toBe(lines[0].id)
  })

  it('pause pendant la requête d’écart d’un play qui SPLIT : le solde non commis part au journal AVANT le reset', async () => {
    // La dernière ligne du projet est fossile (3 h) : le play décidera split. Le temps
    // couru entre le play et la pause (accumulé SYNC par la pause avant sa mise en file)
    // appartient à l'ANCIEN épisode : il doit être commis, pas éjecté par le reset.
    await db.sessions.add({
      projectId: 1, sectionId: 5,
      date: iso(T0 - 3 * 3_600_000), lastWriteAt: iso(T0 - 3 * 3_600_000), durationSec: 100,
    })
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    s.play() // SANS await
    atTime(T0 + 2_000)
    await s.pause()
    const lines = await journal(1)
    // Mutation interceptée : reset du triplet sans commit défensif -> 1 seule ligne (la
    // fossile), les 2 s courues évaporées. Règle : un split ne jette JAMAIS de temps non
    // écrit — il le commet d'abord, puis repart à zéro.
    expect(lines).toHaveLength(2)
    expect(lines[0].durationSec).toBe(100) // la fossile n'a PAS grossi : c'était un split
    expect(lines[1].durationSec).toBe(2)
    expect(s.mergeIntoId).toBe(null) // l'épisode neuf repart nu
    expect(s.elapsedSec).toBe(0)
    expect(s.committedSec).toBe(0)
  })

  it('split d’un chrono migré (payload sans filigrane, temps jamais écrit) : le temps devient une ligne close à part', async () => {
    await setSetting('activeSession', {
      projectId: 1, sectionId: 0, accumulatedSec: 6, runningSince: null, rowsAtStart: 0,
    })
    const s = useActiveSessionStore()
    await s.load()
    await s.play() // projet sans ligne -> split : les 6 s non écrites partent au journal d'abord
    atTime(T0 + 2_000)
    await s.pause() // l'épisode neuf écrit ses 2 s dans SA ligne à lui
    const lines = await journal(1)
    // Mutation interceptée : reset sans commit défensif -> les 6 s migrées disparaissent,
    // il ne reste que la ligne de 2 s. Le temps ancien devient une ligne CLOSE (dernière
    // écriture = maintenant), l'épisode neuf démarre à zéro — la décision de split a été
    // prise AVANT ce commit, elle ne doit pas en être influencée.
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.durationSec)).toEqual([6, 2])
    expect(s.elapsedSec).toBe(2)
    expect(s.committedSec).toBe(2)
    expect(s.mergeIntoId).toBe(lines[1].id)
  })

  it('la décision d’écart frappe Dexie, pas la liste réactive du store sessions (qui porte un autre projet)', async () => {
    await db.sessions.add({ projectId: 2, sectionId: 0, date: iso(T0 - 5 * 60_000), durationSec: 50 })
    const sess = useSessionsStore()
    await sess.loadForProject(2) // la liste réactive ne voit QUE le projet 2
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0) // chrono du projet 1, qui n'a AUCUNE ligne
    await s.play()
    atTime(T0 + 2_000)
    await s.pause()
    const mine = await journal(1)
    // Mutation interceptée : décision prise sur `sess.sessions` (liste réactive du projet 2)
    // -> adoption de SA ligne -> elle grossirait du temps du projet 1. La requête est
    // directe sur Dexie, projet par projet.
    expect(mine).toHaveLength(1)
    expect(mine[0].durationSec).toBe(2)
    expect((await journal(2))[0].durationSec).toBe(50)
  })
})

describe('fermetures — cible disparue, stopAndClear', () => {
  it('cible de fusion disparue de la base (supprimée à la main) : création d’une ligne neuve, pas de crash', async () => {
    await setSetting('activeSession', {
      projectId: 1, sectionId: 0, accumulatedSec: 4.5, committedSec: 0,
      runningSince: null, rowsAtStart: 0, mergeIntoId: 999, // 999 n'existe pas en base
    })
    const s = useActiveSessionStore()
    await s.load()
    await s.pause() // pas de rejet : l'épisode repart dans une ligne neuve
    const lines = await journal(1)
    // Mutation interceptée : update sur id absent sans recréation -> l'update no-op de Dexie
    // résout silencieusement -> 0 ligne, le temps est perdu SANS erreur personne.
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(4)
    expect(lines[0].id).not.toBe(999)
    expect(s.mergeIntoId).toBe(lines[0].id)
  })

  it('stopAndClear sans pause préalable : le solde part au journal AVANT la destruction', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 4_000)
    const snap = await s.stopAndClear()
    // Mutation interceptée : reset du triplet avant le commit défensif -> 0 ligne, les 4 s
    // disparaissent avec l'état. La fermeture est la DERNIÈRE chance d'écrire.
    expect(snap.durationSec).toBe(4)
    const lines = await journal(1)
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(4)
    expect(s.isActive).toBe(false)
    expect(await getSetting('activeSession')).toBe(null)
  })

  it('stopAndClear juste après pause : pas de double écriture', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 4_000)
    await s.pause()
    await s.stopAndClear()
    const lines = await journal(1)
    // Mutation interceptée : fermeture qui recommitte le PLEIN elapsed au lieu du solde
    // (filigrane ignoré) -> 8 s en base pour 4 s tricotées.
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(4)
  })
})

describe('fermeture — « Arrêter » puis « Démarrer » très vite', () => {
  // Double-tap réel : « Arrêter » (œil ou garde → closeChronoSession : pause ATTENDUE puis
  // stopAndClear) et « Démarrer » (pastille → play, posé SANS await). La pause vide l'état
  // en marche TOUT DE SUITE (sync), l'écriture de l'arrêt traîne en file, le Démarrer
  // réarme runningSince — puis l'étape tardive de stopAndClear efface tout : redémarrage
  // avalé, 0:00 + « Temps enregistré ». Contrat voulu : le redémarrage GAGNE, la séance
  // fermée reste enregistrée — les deux effets survivent.
  it('Démarrer pendant que l’écriture de l’arrêt est en attente : le chrono REPART et la séance fermée reste au journal', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5_000)
    // Geste « Arrêter », fidèle à closeChronoSession : pause attendue, PUIS stopAndClear.
    const pausing = s.pause()
    const closing = pausing.then(() => s.stopAndClear())
    await pausing // l'écriture de la pause est passée, stopAndClear est APPELÉE (étape en file)
    s.play() // SANS await — le Démarrer tapé pendant que l'écriture de l'arrêt est pending
    atTime(T0 + 5_500)
    await closing
    // Mutation interceptée (le défaut) : l'étape de stopAndClear écrase le runningSince
    // que le Démarrer vient de poser -> chrono au repos, 0:00, « Temps enregistré » :
    // le redémarrage a été avalé.
    expect(s.running).toBe(true)
    // La séance FERMÉE est intacte : committée par la pause du geste, pas grossie par le
    // live du redémarrage (qui appartient à l'épisode neuf).
    const lines = await journal(1)
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(5)
    // Le chrono reparti est orphelin (projectId null) : sémantique existante d'un play()
    // sans openFor sur session fermée — l'écran (openFor au montage, fiche projet) le
    // rattache. Ce qui compte ici : il COURT, le geste n'est pas avalé.
    expect(s.projectId).toBe(null)
  })

  it('Démarrer pendant l’écriture de la PAUSE (avant même l’appel de stopAndClear) gagne aussi', async () => {
    // Seconde fenêtre du double-tap (écran de suivi) : la pastille est tapée pendant que
    // la pause du geste commet — openFor+play de toggleChrono s'enchaînent AVANT que
    // stopAndClear soit appelée. Au passage de son étape, stopAndClear doit reconnaître
    // un armement posé APRÈS le début du geste, pas le confondre avec le chrono d'origine.
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5_000)
    const pausing = s.pause() // l'écriture de la pause est en vol
    s.play() // SANS await — le Démarrer, AVANT que stopAndClear soit même appelée
    await pausing
    const closing = s.stopAndClear() // instantané AU GESTE : 5 s, le live du play ne compte pas
    atTime(T0 + 5_500)
    await closing
    // Mutation interceptée : l'étape voit runningSince armé et l'efface comme le chrono
    // « d'origine » -> même avalage que l'autre fenêtre.
    expect(s.running).toBe(true)
    const lines = await journal(1)
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(5)
  })
})

describe('commit — liste réactive du store sessions', () => {
  it('chaque commit rafraîchit la liste déjà chargée (fusion comme création), sans reload manuel', async () => {
    const sess = useSessionsStore()
    await sess.loadForProject(1) // la liste est en place AVANT tout commit
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 3_000)
    await s.pause() // création de ligne
    // Mutation interceptée : pas de reload après le commit -> la liste réactive (et
    // l'onglet Séances qui la lira) ne verrait JAMAIS la ligne commise tant
    // qu'un autre geste ne recharge pas le projet.
    expect(sess.sessions).toHaveLength(1)
    expect(sess.sessions[0].durationSec).toBe(3)
    atTime(T0 + 5_000)
    await s.play() // reprise à 2 s de la dernière écriture -> fusion
    atTime(T0 + 7_000)
    await s.pause() // fusion : 3 + 2
    expect(sess.sessions).toHaveLength(1)
    expect(sess.sessions[0].durationSec).toBe(5)
  })
})

describe('commit — atomicité de la transaction', () => {
  it('l’écriture du réglage vit DANS la transaction du commit : la zone couvre sessions ET settings', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 3_000)
    // On épie le put du réglage (setSetting -> db.settings.put) et on capture SA zone au
    // moment où il frappe : Dexie.currentTransaction ne dit vrai que dans la zone synchrone
    // de l'appel. Un put HORS de db.transaction vivrait dans une transaction IMPLICITE qui
    // ne couvre que `settings` (ou hors zone) — l'avance du filigrane ne serait plus
    // atomique avec l'écriture de ligne.
    const zones = []
    const realPut = db.settings.put.bind(db.settings)
    const put = vi.spyOn(db.settings, 'put').mockImplementation(async (row) => {
      zones.push(Dexie.currentTransaction?.storeNames?.slice() ?? null)
      return realPut(row)
    })
    await s.pause()
    put.mockRestore()
    // Mutation interceptée : sortir le setSetting de db.transaction (l'appeler après le
    // await) -> le put capturé couvrirait au mieux ['settings'] seul : un kill entre la
    // ligne et le réglage laisserait une ligne écrite avec un filigrane resté en arrière,
    // et le redémarrage recommettrait le temps déjà en base (ni doublon ni perte, sinon).
    expect(zones.some((z) => z?.includes('sessions') && z.includes('settings'))).toBe(true)
    expect(await journal(1)).toHaveLength(1) // le commit a bien eu lieu au passage
  })

  it('commit rejeté une fois (quota, WebView) : refs restées EN ARRIÈRE, RIEN en base, et la pause SUIVANTE rattrape le chunk', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5_000)
    // Rejet simulé au plus près du réel : c'est l'ÉCRITURE qui échoue (quota, WebView) et
    // entraîne l'annulation de TOUTE la transaction. On fait rejeter le put du réglage —
    // dernière écriture du callback — UNE seule fois : le callback a eu le temps de faire
    // ce qu'il veut (c'est le moment où l'ancien code mutait déjà les refs), et la base
    // doit rester vide. Mocker db.transaction en entier ne prouverait rien : le callback
    // ne courrait pas du tout.
    vi.spyOn(db.settings, 'put').mockImplementationOnce(() => Promise.reject(new Error('quota')))
    await expect(s.pause()).rejects.toThrow('quota')
    // Mutation interceptée : muter mergeIntoId/committedSec DANS le callback (l'ancien
    // code) -> le rejet laisse la base annulée mais les refs AVANCÉES : chunkToCommit
    // rendrait null à la pause suivante et le chunk serait perdu pour l'app vivante
    // (seul un redémarrage réparerait). Ici le filigrane doit être resté en arrière.
    expect(s.committedSec).toBe(0)
    expect(s.mergeIntoId).toBe(null)
    expect(await journal(1)).toHaveLength(0) // rollback Dexie : RIEN n'a survécu au rejet
    // Rattrapage promis par le commentaire de pause() : la pause suivante recommet le
    // chunk ENTIER (les 5 s, le pli de la première pause est dans l'accumulé).
    atTime(T0 + 6_000) // le chrono est arrêté depuis la première pause : rien de neuf
    await s.pause()
    const lines = await journal(1)
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(5)
    expect(s.committedSec).toBe(5)
    expect(s.mergeIntoId).toBe(lines[0].id)
  })
})

describe('discard — clôture sans journal', () => {
  it('vide le chrono SANS écrire : ni ligne ni solde, payload null — même avec du temps non commis', async () => {
    const s = useActiveSessionStore()
    await s.openFor(1, 0, 0)
    await s.play()
    atTime(T0 + 5_000)
    await s.discard()
    // Mutation interceptée : implémenter discard via stopAndClear (son commitChunk
    // défensif) ou closeChronoSession -> une ligne de 5 s naîtrait. Ce geste existe pour
    // NE PAS écrire : la suppression d'un projet cascade ses sessions, une ligne neuve
    // serait orpheline (revue du 31/08).
    expect(await journal(1)).toHaveLength(0)
    expect(s.isActive).toBe(false)
    expect(s.running).toBe(false)
    expect(s.committedSec).toBe(0)
    expect(s.mergeIntoId).toBe(null)
    expect(await getSetting('activeSession')).toBe(null)
  })
})

describe('persistance du triplet', () => {
  it('load() tolère un payload d’avant le lot (ni committedSec ni mergeIntoId)', async () => {
    await setSetting('activeSession', {
      projectId: 1, sectionId: 0, accumulatedSec: 6, runningSince: null, rowsAtStart: 2,
    })
    const s = useActiveSessionStore()
    await s.load()
    // Mutation interceptée : lecture sans défaut (`s.committedSec` tel quel) -> undefined
    // -> chunkToCommit(6, undefined) = NaN -> null -> AUCUNE ligne, perte silencieuse.
    expect(s.committedSec).toBe(0)
    expect(s.mergeIntoId).toBe(null)
    await s.pause() // 6 s en réserve, jamais écrites par l'ancien code : elles partent maintenant
    const lines = await journal(1)
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(6)
  })

  it('le filigrane et la cible survivent à un rechargement du store', async () => {
    const s1 = useActiveSessionStore()
    await s1.openFor(1, 0, 0)
    await s1.play()
    atTime(T0 + 5_500)
    await s1.pause()
    const line = (await journal(1))[0]
    // Nouveau store (redémarrage), MÊME base : le triplet doit revenir de Dexie.
    setActivePinia(createPinia())
    const s2 = useActiveSessionStore()
    await s2.load()
    // Mutation interceptée : payload persisté sans committedSec/mergeIntoId -> au retour
    // committedSec 0, et la pause suivante recommitterait 7 s -> 12 en base (double comptage).
    expect(s2.committedSec).toBe(5)
    expect(s2.mergeIntoId).toBe(line.id)
    expect(s2.elapsedSec).toBe(5)
    atTime(T0 + 3_600_000) // reprise une heure plus tard : la ligne a été touchée à la pause -> fusion
    await s2.play()
    atTime(T0 + 3_600_000 + 2_000)
    await s2.pause()
    const lines = await journal(1)
    expect(lines).toHaveLength(1)
    expect(lines[0].durationSec).toBe(7)
  })
})

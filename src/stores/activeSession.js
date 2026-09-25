// Chrono persistant de la « Session en cours » (PRD §7.6 + risque chrono).
// Basé sur des horodatages → survit à la sortie d'écran, à la veille et au redémarrage.
// Un seul chrono actif à la fois ; persisté dans Dexie (réglage 'activeSession').
// Depuis le lot « la séance visible dès la pause » (30/08) : le chrono est JOURNALISANT.
// Chaque pause commet son temps au journal des sessions (table `sessions`), chaque reprise
// décide fusion (même ligne si le dernier contact du projet date de moins de 2 h) ou split
// (épisode neuf, compteur à zéro). Les décisions pures vivent dans utils/chrono-episode.js
// — ici, uniquement leur mise en œuvre : une seule définition de la règle des 2 h dans le dépôt.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db, getSetting, setSetting } from '@/db/db'
import { chunkToCommit, adoptMergeTarget } from '@/utils/chrono-episode'
import { useSessionsStore } from '@/stores/sessions'

export const useActiveSessionStore = defineStore('activeSession', () => {
  const projectId = ref(null)
  const sectionId = ref(null)
  const accumulatedSec = ref(0)
  const runningSince = ref(null) // epoch ms quand le chrono tourne, sinon null
  const rowsAtStart = ref(0)
  const loaded = ref(false)
  const tick = ref(0) // forcé chaque seconde pour recalculer elapsed
  // Filigrane du journal : secondes DÉJÀ écrites dans la ligne de l'épisode en cours. La
  // différence floor(elapsed − committed) est le chunk que la prochaine fermeture commettra ;
  // c'est lui qui rend la pause idempotente — double pause, pause puis fermeture : la
  // deuxième écriture ne trouve rien à committer (chunkToCommit rend null, aucune transaction).
  const committedSec = ref(0)
  // Ligne du journal où l'épisode en cours fusionne (null : la prochaine écriture crée une ligne).
  const mergeIntoId = ref(null)
  let interval = null
  // Marque du geste d'arrêt (défaut « Arrêter puis Démarrer très vite avale le
  // redémarrage ») : la pause d'une fermeture y note l'horodatage
  // qu'elle vient de vider ; stopAndClear le relit pour reconnaître, au passage de SON
  // étape en file, un play() posé APRÈS le début du geste — la fenêtre du double-tap
  // est double (pendant l'écriture de la pause, puis pendant celle de la clôture) et
  // sans ce marqueur, un Démarrer intercalé dans la première serait indiscernable du
  // chrono d'origine au moment de la clôture.
  let stoppedArmAt = null

  const isActive = computed(() => projectId.value != null)
  const running = computed(() => runningSince.value != null)
  // Temps écoulé réel, hors réactivité : le commit au journal DOIT lire l'horloge à
  // l'instant où il s'exécute. Le computed elapsedSec ci-dessous est invalidated par le
  // tick (1/s) : sa valeur peut dater d'une seconde — acceptable pour un affichage, PAS
  // pour écrire le journal (et encore moins en test, où le tick réel n'avance jamais
  // entre deux sauts de l'horloge simulée : une lecture de trop figerait le cache).
  function currentElapsedSec() {
    const live = runningSince.value ? (Date.now() - runningSince.value) / 1000 : 0
    return Math.floor(accumulatedSec.value + live)
  }
  const elapsedSec = computed(() => {
    void tick.value
    return currentElapsedSec()
  })

  function startTicking() {
    if (!interval) interval = setInterval(() => (tick.value += 1), 1000)
  }
  function stopTicking() {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
  }

  // ── File sérielle des étapes Dexie ──
  // pause()/play()/openFor()/stopAndClear() ont chacun une étape asynchrone sur la base
  // (commit de chunk, requête d'écart, fermeture). Exigence du plan : une pause pendant
  // la requête d'écart d'un play() ne doit pas committer avant que `mergeIntoId` soit
  // décidé — sinon le chunk atterrirait dans une ligne neuve pendant que le play en adopte
  // une autre, deux écritures divergentes du même épisode. Toutes les étapes sont donc
  // chaînées sur une seule promesse in-flight : FIFO stricte, chaque étape relit l'état
  // laissé par la précédente. Depuis le lot « séance visible dès la pause », presque tous
  // les sites ATTENDENT leurs appels (pause du lecteur et de ses départs en correction,
  // pause et openFor de la fiche projet, closeChronoSession du garde et de l'œil) — seul
  // le play() du toggle du lecteur reste lancé sans await : la file reste la garantie,
  // précisément pour lui et pour tout site futur distrait. Les mutations d'état SYNCHRONES
  // (accumulation, runningSince) restent hors file, AVANT tout await : l'écran doit
  // basculer à l'instant du geste.
  let inflight = Promise.resolve()
  function enqueue(step) {
    const run = inflight.then(step)
    // La chaîne survit à l'échec d'une étape : une écriture Dexie rejetée ne doit pas
    // empoisonner les suivantes (le chrono doit pouvoir continuer à journaliser après).
    inflight = run.catch(() => {})
    return run
  }

  async function persist() {
    const payload =
      projectId.value == null
        ? null
        : {
            projectId: projectId.value,
            sectionId: sectionId.value,
            accumulatedSec: accumulatedSec.value,
            committedSec: committedSec.value,
            mergeIntoId: mergeIntoId.value,
            runningSince: runningSince.value,
            rowsAtStart: rowsAtStart.value,
          }
    await setSetting('activeSession', payload)
  }

  async function load() {
    const s = await getSetting('activeSession')
    if (s) {
      projectId.value = s.projectId
      sectionId.value = s.sectionId
      accumulatedSec.value = s.accumulatedSec || 0
      runningSince.value = s.runningSince || null
      rowsAtStart.value = s.rowsAtStart || 0
      // Défauts obligés : committedSec/mergeIntoId naissent avec ce lot, les chronos déjà
      // persistés par l'ancien code ne les portent pas. Sans défaut, `undefined` filtrait
      // jusqu'à chunkToCommit (NaN -> null) et le temps en réserve ne serait jamais écrit.
      committedSec.value = s.committedSec || 0
      mergeIntoId.value = s.mergeIntoId ?? null // ?? : un id est un nombre, 0 serait falsy
      if (runningSince.value) startTicking()
    }
    loaded.value = true
  }

  // Instantané du chrono, INTERNE au module : seul stopAndClear l'appelle (le temps fermé,
  // rendu AVANT la destruction). Anciennement exposé par le store, retiré de son retour :
  // aucun usage extérieur n'existe, et
  // un export mort invite à lire l'état hors des gestes qui l'écrivent.
  function snapshot() {
    return {
      projectId: projectId.value,
      sectionId: sectionId.value,
      // currentElapsedSec (et pas le computed) : un instantané pris à une frontière doit
      // porter le temps RÉEL au moment où on le prend, pas une valeur d'affichage qui
      // peut dater du dernier tick.
      durationSec: currentElapsedSec(),
      rowsAtStart: rowsAtStart.value,
    }
  }

  // Commit du chunk au journal — LE geste d'écriture du chrono. Renvoie true s'il a écrit.
  // Le chunk se calcule par défaut sur le temps écoulé TOTAL (accumulé + live) : tous les
  // appelants (pause, fermetures) y vont quand le chrono se STOPPE — le live est la partie
  // qui vient de finir de courre. Le split de play() passe un chunk EXPLICITE mesuré sur
  // le seul accumulé (voir là-bas). Une seule transaction rw [sessions, settings] couvre
  // l'écriture de ligne, l'avance du filigrane ET le persist : setSetting frappe
  // `db.settings` en direct (src/db/db.js), il rejoint donc la zone de transaction tant
  // qu'il est attendu DANS le callback. Sortir ensemble ou ne pas sortir : jamais une
  // ligne écrite avec un filigrane resté en arrière — au redémarrage qui suivrait, le
  // temps déjà en base serait committé une deuxième fois.
  // ⚠️ Ce persist passe un payload EXPLICITE (valeurs SUIVANTES du couple
  // committedSec/mergeIntoId, valeurs courantes pour le reste) : persist() lit les refs,
  // et les refs n'ont pas encore bougé. Elles ne mutent qu'APRÈS résolution de la
  // transaction — un rejet au commit (quota, WebView) laisse la base annulée ET le
  // filigrane en arrière : la pause suivante retrouve le solde entier à recommettre (le
  // rattrapage que promet pause()), au lieu de perdre le chunk pour la vie de l'app —
  // un filigrane avancé en mémoire ne se répare qu'en tuant l'app. La file sérielle
  // garantit qu'aucune autre étape ne s'intercale entre la transaction et l'avance.
  async function commitChunk(chunk = chunkToCommit(currentElapsedSec(), committedSec.value)) {
    if (projectId.value == null) return false
    if (chunk == null) return false // rien à écrire → AUCUNE transaction ouverte pour rien
    const nowIso = new Date(Date.now()).toISOString()
    const pid = projectId.value
    const sid = sectionId.value
    // Valeurs absolues capturées avant la transaction (pas de `+=` dans le callback) : si
    // Dexie rejouait le callback sur un conflit d'écriture, une incrémentation doublerait.
    const nextCommitted = committedSec.value + chunk
    // Décidé DANS la transaction (la cible a pu disparaître), appliqué DEHORS (ci-dessous).
    let targetId
    await db.transaction('rw', [db.sessions, db.settings], async () => {
      targetId = mergeIntoId.value
      // `target` : la ligne à mettre à jour, ou `null` si aucune cible n'était posée OU si
      // la cible a disparu de la base (ligne supprimée à la main pendant l'épisode) — les
      // deux cas convergent sur la même écriture ci-dessous : ouvrir une ligne neuve plutôt
      // que de crasher (l'update sur un id absent est un no-op silencieux chez Dexie, il
      // faut le détecter ou le temps s'évapore sans erreur).
      const target = targetId != null ? await db.sessions.get(targetId) : null
      if (target) {
        // UPDATE PARTIEL, volontairement réduit à durationSec et lastWriteAt. La cible a
        // pu être éditée inline depuis sa naissance (rangs corrigés…) : un put complet
        // écraserait ces champs ; `date` est l'acte de naissance de la ligne — le mentir
        // déplacerait le tricot sur un autre jour ; `sectionId` dit où il a eu lieu.
        await db.sessions.update(targetId, {
          durationSec: (target.durationSec || 0) + chunk,
          lastWriteAt: nowIso,
        })
      } else {
        targetId = await db.sessions.add({
          projectId: pid, sectionId: sid, date: nowIso, lastWriteAt: nowIso,
          durationSec: chunk,
        })
      }
      // Persist explicite (voir le bloc-commentaire ci-dessus) : les refs vivantes sont
      // encore à leurs valeurs d'avant-commit, c'est le SUIVANT qu'il faut figer en base.
      await setSetting('activeSession', {
        projectId: pid, sectionId: sid,
        accumulatedSec: accumulatedSec.value,
        committedSec: nextCommitted,
        mergeIntoId: targetId,
        runningSince: runningSince.value,
        rowsAtStart: rowsAtStart.value,
      })
    })
    // Filigrane et cible avancés seulement ici, transaction résolue : en cas de rejet,
    // elles restent en arrière et le chunk reste à commettre.
    mergeIntoId.value = targetId
    committedSec.value = nextCommitted
    // HORS transaction, dans le même corps de queue (commitChunk n'est appelé que depuis
    // une étape en file) : la liste réactive du store sessions doit montrer la ligne qui
    // vient d'être commise — l'onglet Sessions la lira telle quelle, et rien
    // d'autre ne rechargera le projet tant qu'il reste affiché. Via reload() → loadGuard :
    // une lecture partie avant le commit ne réaffiche pas la liste d'avant.
    await useSessionsStore().reload()
    return true
  }

  // ⚠️ La garde porte sur le COUPLE (projet, section), pas sur la seule section. Avec la seule
  // section, un chrono ouvert sur le projet A que l'on croisait en ouvrant B n'était ni
  // enregistré ni réaffecté : le temps de B finissait écrit sur A (défaut trouvé le 17/08 —
  // atteignable dès que l'app est tuée pendant qu'un chrono tourne, cas prévu puisque le chrono
  // est persisté exprès pour y survivre). Depuis le lot « chrono hors lecteur », DEUX écrans
  // ouvrent le chrono avec la même sentinelle de section : sans cette garde, le défaut devient
  // courant.
  // Depuis « séances live » : le changement de slot ferme SANS instantané `previous` — le
  // temps de l'ancien chrono part au journal ICI (avec fusion), le triplet est remis à zéro,
  // sans snackbar : la fermeture visible appartient aux écrans, l'écriture au store.
  async function openFor(pid, sid, rowsDone) {
    // Frontière d'épisode : sur un changement de slot, le live est plié dans l'accumulé
    // AU GESTE, avant l'enfilement — le même geste que pause(). Pourquoi synchrone :
    // l'étape en file commet un accumulé STABLE ; lire le live au passage de l'étape
    // (l'ancien openFor) laissait deux fenêtres de perte — une pause tapée pendant le
    // délai (entrelace ouvert par la revue du 31/08 : la pastille pendant l'openFor du
    // onMounted du lecteur) pliait son live dans l'accumulé, que le reset de l'étape
    // éjectait sans commit ; et le live couru pendant la transaction elle-même partait
    // au reset avec lui. Ici le chrono S'ARRÊTE à l'instant du changement de slot :
    // l'écran bascule au geste, et le temps après le geste appartient au nouveau slot.
    const sameSlotNow =
      isActive.value && projectId.value === Number(pid) && sectionId.value === Number(sid)
    if (!sameSlotNow && runningSince.value) {
      accumulatedSec.value += (Date.now() - runningSince.value) / 1000
      runningSince.value = null
      stopTicking()
    }
    return enqueue(async () => {
      const sameSlot =
        isActive.value && projectId.value === Number(pid) && sectionId.value === Number(sid)
      if (!sameSlot) {
        if (isActive.value) {
          // Commit AVANT de muter le slot : la ligne doit porter l'ANCIEN couple (projet,
          // section), celui pendant lequel le temps a couru.
          await commitChunk()
          // Défensif : un play() tapé entre le pli et cette étape aurait réarmé
          // l'intervalle — le reset qui suit arrête le chrono, l'intervalle doit mourir.
          stopTicking()
        }
        projectId.value = Number(pid)
        sectionId.value = Number(sid)
        accumulatedSec.value = 0 // reset du TRIPLET — changement de slot = frontière d'épisode
        committedSec.value = 0
        mergeIntoId.value = null
        runningSince.value = null
        rowsAtStart.value = rowsDone
      }
      await persist()
    })
  }
  async function play() {
    if (!runningSince.value) {
      runningSince.value = Date.now() // sync AVANT tout await : le lecteur appelle play() sans await
      startTicking()
      return enqueue(async () => {
        if (projectId.value == null) {
          // Play sans openFor (chrono orphelin) : rien à décider, mais l'état courant doit
          // être persisté — runningSince vient de bouger.
          await persist()
          return
        }
        // Requête Dexie DIRECTE (jamais la liste réactive du store sessions : elle peut
        // porter un autre projet) puis décision fusion/split — les deux seules fonctions
        // de chrono-episode.js, unique définition de la règle des 2 h.
        const last = await useSessionsStore().lastChronoSession(projectId.value)
        const target = adoptMergeTarget(last, Date.now())
        if (target == null) {
          // Split (écart ≥ 2 h, dernière ligne manuelle, aucune ligne, âge illisible) :
          // épisode neuf. Mais un split ne jette JAMAIS de temps non écrit — le solde
          // éventuel part d'abord au journal (chrono migré d'un payload sans filigrane,
          // commit échoué, temps accumulé pendant la requête d'écart), dans la ligne de
          // l'ANCIEN épisode s'il en avait une, en ligne close à part sinon. La décision
          // de split est déjà prise AVANT ce commit défensif : volontairement, la ligne
          // qu'il écrit (et son lastWriteAt tout neuf) ne doit pas l'influencer.
          // ⚠️ Le chunk se mesure sur le SEUL accumulé (temps en pause), pas sur le temps
          // écoulé total : le live écoulé depuis le play appartient au NOUVEL épisode —
          // runningSince traverse le reset, le commettre ici le compterait deux fois.
          await commitChunk(chunkToCommit(accumulatedSec.value, committedSec.value))
          accumulatedSec.value = 0
          committedSec.value = 0
          mergeIntoId.value = null
        } else {
          mergeIntoId.value = target // adoption : l'épisode continue dans la dernière ligne
        }
        await persist()
      })
    }
  }
  async function pause() {
    if (runningSince.value) {
      stoppedArmAt = runningSince.value // pour stopAndClear : le bras vidé par CE geste
      accumulatedSec.value += (Date.now() - runningSince.value) / 1000 // sync, avant tout await
      runningSince.value = null
      stopTicking()
    }
    // Toujours mis en file, même déjà en pause : une écriture échouée ayant laissé du temps
    // non committé, la pause suivante est la seule chance de le rattraper — commitChunk
    // recalcule le solde et ne fait rien quand il est vide.
    return enqueue(async () => {
      const wrote = await commitChunk()
      // Même sans chunk (pause sous 1 s), l'arrêt DOIT être persisté : un runningSince
      // resté en base ferait repartir le chrono au prochain démarrage comme s'il n'avait
      // jamais été mis en pause.
      if (!wrote && projectId.value != null) await persist()
    })
  }
  async function stopAndClear() {
    const snap = snapshot() // rendu AVANT la destruction — l'appelant affiche le temps fermé
    // Le bras du chrono AU DÉBUT du geste d'arrêt : la marque posée par la pause de la
    // fermeture (tous les appelants passent par pause() d'abord), sinon — fermeture
    // directe sur chrono en marche — l'armement courant. Au passage de l'étape, tout
    // runningSince QUI DIFFÈRE est donc un Démarrer posé après le début du geste.
    const armAtGesture = stoppedArmAt ?? runningSince.value
    stoppedArmAt = null
    return enqueue(async () => {
      // Fermeture ordinaire : le commit défensif (solde resté en réserve — fermeture
      // directe pendant la marche, ou commit de la pause rejeté). Sauf Démarrer déjà posé
      // pendant l'écriture de la pause : la séance fermée est déjà au journal (la pause du
      // geste a committé AVANT cette étape, file sérielle) et le live du play appartient
      // au NOUVEL épisode — le commettre ici l'écrirait dans la ligne de l'ANCIENNE séance
      // puis le recommterait au filigrane remis à zéro.
      const armedAtEntry = runningSince.value
      if (armedAtEntry == null || armedAtEntry === armAtGesture) await commitChunk()
      // Re-décidé APRÈS le commit : un Démarrer peut se poser PENDANT l'écriture — c'est
      // précisément la fenêtre du double-tap. Là, le redémarrage GAGNE :
      // qui relance le chrono doit le voir repartir pour de bon. On détruit l'identité
      // (projet, triplet) mais on épargne l'armement et le tick : le chrono repart de
      // 0:00, orphelin comme tout play() sur session fermée, l'écran le rattache.
      const restarted = runningSince.value != null && runningSince.value !== armAtGesture
      if (!restarted) stopTicking()
      projectId.value = null
      sectionId.value = null
      accumulatedSec.value = 0 // reset du TRIPLET — la fermeture est une frontière d'épisode
      committedSec.value = 0
      mergeIntoId.value = null
      rowsAtStart.value = 0
      if (!restarted) runningSince.value = null // sinon le Démarrer posé pendant le geste survit
      await persist()
    }).then(() => snap)
  }

  // Clôture SANS journalisation, pour UN seul appelant : la suppression d'un projet dont
  // le chrono vit (ProjectDetailView.remove). La cascade purge les sessions du projet,
  // puis le router.replace vers l'accueil déclencherait le garde « sortie de bulle »,
  // dont la pause commitante RÉÉCRIRAIT une ligne pour un projet disparu — une session
  // orpheline, sans fiche où vivre. Ici le chrono se vide AVANT la cascade : le temps
  // non commis part avec le projet, délibérément. PAS closeChronoSession (elle journalise
  // via pause() et annonce un snackbar « Temps enregistré » de trop) ni stopAndClear
  // (son commitChunk défensif écrit au journal) : ce geste existe précisément pour NE PAS
  // écrire. La garde d'identité (chrono du projet supprimé, et pas d'un autre) appartient
  // à l'appelant — lui seul connaît le projet en train de mourir.
  async function discard() {
    return enqueue(async () => {
      stopTicking()
      projectId.value = null
      sectionId.value = null
      accumulatedSec.value = 0
      committedSec.value = 0
      mergeIntoId.value = null
      runningSince.value = null
      rowsAtStart.value = 0
      await persist()
    })
  }

  return {
    projectId, sectionId, rowsAtStart, loaded,
    committedSec, mergeIntoId,
    isActive, running, elapsedSec,
    load, openFor, play, pause, stopAndClear, discard,
  }
})

export function fmtDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

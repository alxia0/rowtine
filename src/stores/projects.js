// Projets — CRUD local (Dexie) + valeurs par défaut. Suppression annulable (snackbar).
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, plain } from '@/db/db'
import { reservationsOf, consumedOf, setProjectReservation } from '@/utils/yarn-usage'
import { refreshYarnsIfLoaded } from '@/stores/yarns'
import { finishedAtPatch } from '@/utils/project-finished-at'
import { startedAtPatch } from '@/utils/project-started-at'
import { ymdLocal } from '@/utils/time-periods'
import { recordActiveDay } from '@/db/active-days'
import { createLoadGuard } from '@/stores/load-guard'

// Rétro-compat aiguilles : un projet ancien porte les scalaires needleMm/needleUs ;
// les nouveaux portent une liste needles:[{mm,us}]. Renvoie { needles } dérivé si besoin,
// ou null si le projet est déjà au nouveau format (rien à migrer). Pur & idempotent.
export function needlesPatch(project) {
  if (Array.isArray(project?.needles)) return null
  return { needles: [{ mm: project?.needleMm || '', us: project?.needleUs || '' }] }
}

// Horodatage d'une session de tricot. Centralisé ici (plutôt qu'un `new Date().toISOString()`
// disséminé) pour que tous les points d'écriture de `lastWorkedAt` parlent le même format.
export function workedNow() {
  return new Date().toISOString()
}

export function emptyProject() {
  return {
    name: '',
    technique: 'knitting', // 'knitting' | 'crochet'
    patternId: null, // patron lié (conditionne les sections du projet)
    status: 'waiting', // waiting (défaut, à la création) | wip | pause | done | future | abandoned
    needles: [{ mm: '', us: '' }], // liste d'aiguilles ; chaque entrée { mm, us } (optionnels)
    gaugeStitches: '',
    gaugeRows: '',
    sizes: [], // ex. ['S','M','L']
    activeSize: '',
    startedAt: '', // 'YYYY-MM-DD'
    finishedAt: '',
    stars: 0, // 0..5
    notes: '',
    photos: [], // data URLs
    coverIndex: 0, // index de la photo de couverture dans `photos` (PAS une dataURL, cf. project-cover.js)
    activeSectionId: null, // section « En cours » (dernière lancée)
    // Dernière session de TRICOT (ISO 8601) — armé par les seuls gestes de progression (rang ou
    // section coché, grille avancée, compteur bougé), jamais par une écriture de réglage
    // (renommage, taille, statut, photos, synchro). Distinct d'`updatedAt`, qui bouge à CHAQUE
    // écriture : c'est lui qui classe la tuile « Reprendre » de l'accueil. Cf. markWorked().
    lastWorkedAt: '',
    showTimer: true, // chrono affiché par défaut ; bascule via le chevron de la pastille/le kebab/le formulaire (spec 08/09)
  }
}

// Réinjecte l'allocation d'UN projet dans chaque laine mémorisée par `remove()` ci-dessous,
// sans jamais toucher celles des autres projets (setProjectReservation) — partagée par
// `restore()` ci-dessous et par `trash.js` (restauration d'un projet depuis la corbeille,
// même cascade). ATTENTION : entre la suppression et la restauration, un autre projet a pu
// prendre la place laissée libre — setProjectReservation borne alors au disponible
// (possiblement 0) plutôt que d'inventer des pelotes.
// `collectShortfalls` (trash.js seul) : signale, sans corriger (setProjectReservation a déjà
// borné correctement), les liens où l'allocation obtenue est inférieure à celle demandée.
export async function reinjectYarnLinks(yarnLinks, projectId, { collectShortfalls = false } = {}) {
  const shortfalls = []
  for (const l of yarnLinks || []) {
    let y = await db.yarns.get(l.id)
    if (!y) continue
    // Trace de consommation (K3) : indépendante de la réservation ci-dessous — une
    // laine consommée n'a PLUS de réservation active (`consumeProjectReservation`
    // l'a retirée avant), donc ce lien peut porter `consumedQty` SEUL, sans `qty`.
    // Réinjectée avant tout, sinon le `continue` du garde `!qty` la sauterait pour
    // ces liens-là.
    if (l.consumedQty != null) {
      const nextConsumed = { ...consumedOf(y), [projectId]: l.consumedQty }
      await db.yarns.update(l.id, { consumed: nextConsumed })
      y = await db.yarns.get(l.id)
    }
    if (l.qty == null) continue
    const key = projectId
    const qty = l.qty
    if (!qty || !key) continue
    const next = setProjectReservation(y, key, qty)
    if (collectShortfalls) {
      const got = next[key] ?? 0
      if (got < qty) shortfalls.push({ yarnId: l.id, requested: qty, got })
    }
    // L'effacement des scalaires hérités reservedFor/reservedQty (ancien modèle
    // « 1 laine = 1 projet ») a été retiré le 07/09/2026 (ménage pré-1.0) :
    // cette écriture ne pose plus que la map `reservations` du modèle courant.
    await db.yarns.update(l.id, { reservations: next })
  }
  return shortfalls
}

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref([])
  const loaded = ref(false)

  // Jeton de rechargement (cf. `stores/load-guard.js`). C'est ici que le motif était le
  // plus exposé : `markWorked()` recharge à CHAQUE geste de progression du tricot, donc deux
  // gestes rapprochés suffisaient à ce qu'une lecture partie avant revienne après et
  // réaffiche l'état d'AVANT. La progression restait bien en base, mais disparaissait de
  // l'écran jusqu'au redémarrage de l'application.
  const loadGuard = createLoadGuard()
  function load() {
    return loadGuard.run(async (isCurrent) => {
      const rows = await db.projects.orderBy('id').reverse().toArray()
      if (!isCurrent()) return
      projects.value = rows
      // Migration aiguilles (scalaire → liste) pour les projets antérieurs, une seule fois.
      const toMigrate = rows.filter((p) => !Array.isArray(p.needles))
      if (toMigrate.length) {
        for (const p of toMigrate) {
          const patch = needlesPatch(p)
          if (patch) {
            // `undefined` supprime la clé côté Dexie → on retire les scalaires hérités.
            await db.projects.update(p.id, { ...patch, needleMm: undefined, needleUs: undefined })
            Object.assign(p, patch)
            delete p.needleMm
            delete p.needleUs
          }
        }
      }
      loaded.value = true
    })
  }

  async function get(id) {
    return db.projects.get(Number(id))
  }

  async function create(data) {
    const now = new Date().toISOString()
    const payload = { ...emptyProject(), ...plain(data) }
    // RÈGLE 1 aussi À LA CRÉATION : `create()` ne passe pas par `update()`, et un projet créé
    // d'emblée en « Terminé » est bel et bien une ENTRÉE dans ce statut. Sans cette ligne, il
    // n'aurait aucune date de fin et serait invisible dans la tuile des projets terminés — un
    // compte faux par omission. `before` vaut null : il n'y a pas d'état antérieur.
    Object.assign(payload, finishedAtPatch(null, payload, ymdLocal(new Date())) || {})
    const id = await db.projects.add({ ...payload, createdAt: now, updatedAt: now })
    await load()
    return id
  }

  async function update(id, data) {
    const patch = { ...plain(data) }
    // RÈGLE 1 — entrer dans « Terminé » date la clôture. Ici plutôt que dans les
    // trois écrans qui changent le statut : écrire une date n'a aucun effet de bord, et un
    // quatrième site futur en hériterait sans qu'on y pense.
    // ⛔ La règle INVERSE (une date renseignée termine le projet) ne doit JAMAIS vivre ici :
    // un statut passé à 'done' par effet de bord contournerait requestStatusChange, donc le
    // dialogue des pelotes ne s'ouvrirait pas et le stock resterait faux en silence. Elle vit
    // dans ProjectEditView.save(), seul écran qui porte un champ de date de fin.
    // Le `get` n'a lieu QUE sur un passage à 'done' : markWorked() écrit à chaque geste de
    // progression, il ne doit pas payer une lecture de plus.
    // Un seul `get` couvre les deux règles ci-dessous : les sites qui écrivent `status` et
    // `lastWorkedAt` dans le MÊME patch (rare) ne paient pas deux lectures, et surtout, un
    // appelant qui ne garde pas le tableau réactif `projects` chargé (le lecteur, qui ne lit
    // les projets que par `get()` direct — piège trouvé en test, `projects.value` y restait
    // vide) ne voit plus jamais la garde échouer en silence.
    if (patch.status === 'done' || patch.lastWorkedAt) {
      const before = await db.projects.get(Number(id))
      // RÈGLE 1 — entrer dans « Terminé » date la clôture. Ici plutôt que dans les
      // trois écrans qui changent le statut : écrire une date n'a aucun effet de bord, et un
      // quatrième site futur en hériterait sans qu'on y pense.
      // ⛔ La règle INVERSE (une date renseignée termine le projet) ne doit JAMAIS vivre ici :
      // un statut passé à 'done' par effet de bord contournerait requestStatusChange, donc le
      // dialogue des pelotes ne s'ouvrirait pas et le stock resterait faux en silence. Elle vit
      // dans ProjectEditView.save(), seul écran qui porte un champ de date de fin.
      if (patch.status === 'done') Object.assign(patch, finishedAtPatch(before, patch, ymdLocal(new Date())) || {})
      // Première date de DÉBUT : posée au premier geste de progression si le projet n'en a
      // encore aucune — décision produit du 12/09 (une utilisatrice qui ne renseigne jamais
      // « Début » ne doit pas voir un projet sans date de début pour autant).
      if (patch.lastWorkedAt) Object.assign(patch, startedAtPatch(before, ymdLocal(new Date())) || {})
    }
    await db.projects.update(Number(id), { ...patch, updatedAt: new Date().toISOString() })
    // JOURNAL DES JOURS ACTIFS — `update()` est le goulot par lequel passent
    // les QUATRE sites qui arment `lastWorkedAt` : markWorked() ci-dessous, la case « section
    // faite » et le compteur de la fiche projet (ProjectDetailView.vue), et le snapshot de
    // progression du lecteur (ReaderView.vue::writeSnap). Instrumenter ici plutôt que les quatre
    // sites, c'est se rendre insensible à l'ajout d'un cinquième.
    // ⚠️ APRÈS l'écriture du projet, et `recordActiveDay` ne jette jamais : un souci de journal
    // ne doit pas faire perdre un geste de progression. Le risque de ce raccourci — un site
    // futur qui écrirait `lastWorkedAt` sans passer par ici serait muet — sera couvert
    // par tests/unit/journal-jours-actifs-sites.spec.js, un test par site EXISTANT.
    // ⚠️⚠️ Risque INVERSE, déjà réalisé une fois (revue du 11/08) : un écran de RÉGLAGE qui
    // renverrait tel quel un `lastWorkedAt` déjà présent sur le projet (et non un geste neuf)
    // ferait inscrire un jour où personne n'a tricoté. `update()` ne peut pas s'en protéger lui-
    // même (il ne sait pas distinguer un report d'un geste) : c'est à CHAQUE appelant de ne
    // jamais renvoyer ce champ hors d'un geste réel. ProjectEditView.save() est le premier
    // exemple corrigé — son payload ne doit JAMAIS reporter le témoin.
    if (patch.lastWorkedAt) await recordActiveDay(patch.lastWorkedAt)
    await load()
  }

  // Horodate une session de TRICOT sur ce projet (cf. `lastWorkedAt` dans emptyProject).
  // À n'appeler que depuis un geste de progression. Quand le geste écrit DÉJÀ sur le projet
  // (le suivi persiste son readerState, la case « section faite » de la fiche), on ajoute plutôt
  // `lastWorkedAt: workedNow()` au patch existant : une seule écriture, un seul rechargement.
  async function markWorked(id) {
    await update(id, { lastWorkedAt: workedNow() })
  }

  // Pose `startedAt` au premier LANCEMENT d'une session de chrono — symétrique du bloc
  // `startedAtPatch` de `update()` ci-dessus, mais SANS `lastWorkedAt` : démarrer un chrono
  // n'est pas en soi un geste de tricot (rien n'empêche de le lancer puis de ne rien faire),
  // même distinction que celle documentée sur `lastWorkedAt` dans `emptyProject`. Appelé une
  // seule fois par lancement (pas à chaque tick) : le `get` Dexie direct, plutôt que le
  // tableau réactif, n'a pas le coût que `update()` évite sur le chemin chaud.
  async function ensureStarted(id) {
    const before = await db.projects.get(Number(id))
    const patch = startedAtPatch(before, ymdLocal(new Date()))
    if (patch) await update(id, patch)
  }

  // Suppression EN CASCADE (décision produit 30/06) : on supprime le projet ET tout ce
  // qui en dépend (sections, diagrammes, compteurs, sessions) + on libère les laines
  // réservées. Renvoie un « bundle » complet pour une annulation/corbeille fidèle.
  // R1 (retrait du dialogue « pelotes tricotées ? ») : la suppression ne déduit PLUS
  // JAMAIS `quantity` — soit le projet était Terminé et la consommation réelle a déjà
  // été traitée à la clôture (`consumeProjectReservation`), soit il ne l'était pas et
  // les pelotes reviennent simplement au stock. `remove()` n'a donc plus besoin d'un
  // paramètre `consumed`.
  async function remove(id) {
    const pid = Number(id)
    const project = await db.projects.get(pid)
    const sections = await db.sections.where('projectId').equals(pid).toArray()
    const diagrams = await db.diagrams.where('projectId').equals(pid).toArray()
    const counters = await db.counters.where('projectId').equals(pid).toArray()
    const sessions = await db.sessions.where('projectId').equals(pid).toArray()
    // Pool : on retire l'allocation de CE projet dans chaque laine et on la mémorise
    // pour l'annulation (les allocations des autres projets ne sont jamais touchées).
    // On retire aussi sa TRACE de consommation (`consumed[pid]`, lot K3) : le projet
    // n'existe plus, elle n'a plus de fiche où s'accrocher — mais `quantity` n'est
    // JAMAIS touchée par ce retrait : ces pelotes ont VRAIMENT été tricotées à la
    // clôture du projet, rien ne revient.
    const allYarns = await db.yarns.toArray()
    const yarnLinks = []
    for (const y of allYarns) {
      const qty = reservationsOf(y)[pid]
      const consumedQty = consumedOf(y)[pid]
      if (qty == null && consumedQty == null) continue
      yarnLinks.push({ id: y.id, qty, consumedQty })
      const patch = {}
      if (qty != null) {
        patch.reservations = setProjectReservation(y, pid, null)
        patch.reservedFor = undefined
        patch.reservedQty = undefined
      }
      if (consumedQty != null) {
        const nextConsumed = { ...consumedOf(y) }
        delete nextConsumed[pid]
        patch.consumed = nextConsumed
      }
      await db.yarns.update(y.id, patch)
    }
    // Instance patron dédiée à ce projet (copy-on-write) : supprimée EN CASCADE avec lui.
    const pat = project?.patternId != null ? await db.patterns.get(project.patternId) : null
    const instancePattern = pat && pat.ownerProjectId === pid ? pat : null
    await db.sections.where('projectId').equals(pid).delete()
    await db.diagrams.where('projectId').equals(pid).delete()
    await db.counters.where('projectId').equals(pid).delete()
    await db.sessions.where('projectId').equals(pid).delete()
    if (instancePattern) await db.patterns.delete(instancePattern.id)
    await db.projects.delete(pid)
    await load()
    // La cascade vient de modifier des laines en base : si le stock est déjà chargé en
    // mémoire, il faut le rafraîchir, sinon le badge du stock reste périmé (il ne se
    // recharge pas tout seul : StashView ne charge que si `loaded` est faux).
    await refreshYarnsIfLoaded()
    return { project, sections, diagrams, counters, sessions, yarnLinks, instancePattern }
  }

  // Réinsère un projet supprimé EN CASCADE (annulation / corbeille), ids conservés.
  // Exige la forme complète { project, ... } (cf. `remove()`) — une entrée qui ne la
  // porte pas ne restaure rien, silencieusement (aucun appelant vivant n'en envoie
  // d'autre forme, cf. tests ci-dessous).
  async function restore(bundle) {
    if (!bundle?.project) return
    await db.projects.put(bundle.project)
    if (bundle.sections?.length) await db.sections.bulkPut(bundle.sections)
    if (bundle.diagrams?.length) await db.diagrams.bulkPut(bundle.diagrams)
    if (bundle.counters?.length) await db.counters.bulkPut(bundle.counters)
    if (bundle.sessions?.length) await db.sessions.bulkPut(bundle.sessions)
    // Pool : réinjecte l'allocation de CE projet dans chaque laine mémorisée (cf.
    // `reinjectYarnLinks` ci-dessus pour le détail et la réserve sur la restauration).
    await reinjectYarnLinks(bundle.yarnLinks, bundle.project.id)
    if (bundle.instancePattern) await db.patterns.put(bundle.instancePattern)
    await load()
    // La cascade vient de modifier des laines en base : si le stock est déjà chargé en
    // mémoire, il faut le rafraîchir, sinon le badge du stock reste périmé (il ne se
    // recharge pas tout seul : StashView ne charge que si `loaded` est faux).
    await refreshYarnsIfLoaded()
  }

  // Projets exemples au 1er lancement (PRD §7.1), seulement si la base est vide.
  // `demo` (optionnel) : projet « en cours » lié à un patron exemple — quand il est fourni,
  // il remplace le projet générique. On garde toujours une « idée » (future) pour varier les
  // états affichés sur l'accueil. Renvoie `{ ideaId, wipId }` (le 2e sert à y rattacher
  // sections et progression depuis l'appelant), ou `null` si la base n'était pas vide.
  // `texts` : les libellés du jeu d'exemples de la langue choisie
  // (src/constants/demo/<langue>.js → `projects`). Ils étaient en français en dur jusqu'au
  // 30/07 — une utilisatrice allemande arrivait sur un accueil intégralement français.
  // `ideaDemo` (optionnel, 11/08) : le patron de démonstration auquel rattacher le projet
  // « idée » — `{ patternId, needleMm, gaugeStitches, gaugeRows }`. Forme retenue : un 4e
  // paramètre optionnel de même facture que `demo` plutôt qu'une correspondance
  // `demoId → …` qui aurait obligé à réécrire les trois appels existants (deux dans les
  // tests) sans rien apporter — les deux projets semés sont deux cas nommés, pas une liste.
  // Ce rattachement donne à la fiche de l'idée une image et des instructions **par
  // ricochet** (cf. `resolveCover`, qui retombe sur la 1re photo du patron, et le lecteur,
  // qui lit les sections DU PATRON) : aucune écriture dans `project.photos` ni dans
  // `db.sections`, les deux que `isDbRestorable` refuse et qui ont déjà coûté deux lots.
  async function seedExamplesIfEmpty(technique = 'knitting', demo = null, texts = {}, ideaDemo = null) {
    const count = await db.projects.count()
    if (count > 0) return null
    const now = new Date().toISOString()
    // Projet « idée » (future) — créé en premier pour que le projet en cours soit en tête de liste.
    // `patternId` est posé DÈS LE SEMIS : c'est la seule chose qui protège ce projet de
    // `migrateFreeProjects`, qui rattache au patron libre tout projet dont `patternId == null`
    // (appelé juste après le semis par OnboardingView, et à chaque démarrage par App.vue).
    // Aiguilles et échantillon viennent du patron lui-même, jamais recopiés en dur ici : ils
    // seraient à corriger deux fois. Statut `future` inchangé (c'est une IDÉE, son rôle dans la
    // démonstration face au projet « en cours »), et ni `lastWorkedAt` ni `readerState` —
    // témoins de geste, gardés par `isDbRestorable`.
    const ideaId = await db.projects.add({
      ...emptyProject(),
      name: texts.idea?.name || '',
      technique: 'knitting',
      status: 'future',
      patternId: ideaDemo?.patternId ?? null,
      needles: [{ mm: ideaDemo?.needleMm || '', us: '' }],
      gaugeStitches: ideaDemo?.gaugeStitches || '',
      gaugeRows: ideaDemo?.gaugeRows || '',
      // Dérivée de MAINTENANT, jamais une date en dur : elle vieillirait dans l'APK.
      // `ymdLocal`, pas `now.slice(0, 10)` : `now` est en UTC, donc la veille entre minuit local
      // et minuit UTC. Ce module importait déjà `ymdLocal` sans s'en servir ici.
      startedAt: ymdLocal(new Date()),
      notes: texts.idea?.notes || '',
      createdAt: now,
      updatedAt: now,
    })
    // Projet « en cours » : lié au patron démo si fourni, sinon générique selon la technique.
    const wip = demo
      ? {
          ...emptyProject(),
          name: demo.name,
          technique: 'knitting',
          patternId: demo.patternId,
          status: 'wip',
          needles: [{ mm: '4', us: '' }],
          sizes: demo.sizes || [],
          activeSize: demo.activeSize || '',
          startedAt: ymdLocal(new Date()),
          notes: texts.wip?.notes || '',
          createdAt: now,
          updatedAt: now,
        }
      : {
          ...emptyProject(),
          name: technique === 'crochet' ? texts.fallbackCrochet : texts.fallbackKnitting,
          technique: technique === 'crochet' ? 'crochet' : 'knitting',
          status: 'wip',
          needles: [{ mm: technique === 'crochet' ? '4' : '4.5', us: '' }],
          sizes: ['S', 'M', 'L'],
          activeSize: 'M',
          notes: texts.fallbackNotes || '',
          createdAt: now,
          updatedAt: now,
        }
    const wipId = await db.projects.add(wip)
    await load()
    // Les DEUX identifiants remontent : `recordSeededSamples` (OnboardingView) en a
    // besoin pour que `isDbRestorable` reconnaisse une base neuve. N'en renvoyer qu'un
    // laisserait le projet « idée » passer pour du travail réel.
    return { ideaId, wipId }
  }

  // Projets qui s'appuient sur ce patron de bibliothèque. Sert à prévenir avant
  // suppression (un patron supprimé vide la fiche des projets liés).
  async function usingPattern(patternId) {
    if (patternId == null) return []
    return db.projects.filter((p) => p.patternId === Number(patternId)).toArray()
  }

  // Migration : les projets « libres » (sans patron) sont rattachés au patron libre builtin.
  async function migrateFreeProjects(freePatternId) {
    if (!freePatternId) return 0
    const all = await db.projects.toArray()
    let n = 0
    for (const p of all) {
      if (p.patternId == null) {
        await db.projects.update(p.id, { patternId: freePatternId, activeSectionId: null })
        n++
      }
    }
    if (n) await load()
    return n
  }

  return {
    projects,
    loaded,
    load,
    get,
    create,
    update,
    markWorked,
    ensureStarted,
    remove,
    restore,
    seedExamplesIfEmpty,
    migrateFreeProjects,
    usingPattern,
  }
})

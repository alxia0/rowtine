// @vitest-environment jsdom
// Unitaire — store projets sur une vraie base Dexie (fake-indexeddb).
// Couvre le CRUD et surtout la suppression EN CASCADE + restauration fidèle.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useProjectsStore, emptyProject } from '@/stores/projects'
import { useYarnsStore } from '@/stores/yarns'
import { useToolsStore } from '@/stores/tools'
import { useTrashStore } from '@/stores/trash'
import { linkedTools } from '@/utils/tool-links'
import { ymdLocal } from '@/utils/time-periods'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('store projets — CRUD', () => {
  it('crée un projet avec les valeurs par défaut', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Pull torsadé' })

    expect(id).toBeTypeOf('number')
    expect(store.projects).toHaveLength(1)
    expect(store.projects[0]).toMatchObject({ name: 'Pull torsadé', status: 'waiting', technique: 'knitting' })
  })

  it('un projet neuf est « En attente » par défaut', () => {
    expect(emptyProject().status).toBe('waiting')
  })

  it('met à jour un projet existant', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Châle' })
    await store.update(id, { status: 'done', stars: 5 })

    const fresh = await store.get(id)
    expect(fresh).toMatchObject({ status: 'done', stars: 5 })
  })

  it('liste les projets du plus récent au plus ancien', async () => {
    const store = useProjectsStore()
    await store.create({ name: 'Premier' })
    await store.create({ name: 'Second' })
    expect(store.projects.map((p) => p.name)).toEqual(['Second', 'Premier'])
  })
})

describe('store projets — suppression en cascade + restauration', () => {
  it('supprime le projet et ses dépendances, puis les restaure à l’identique', async () => {
    const store = useProjectsStore()
    const pid = await store.create({ name: 'Projet lié' })

    // Dépendances rattachées au projet.
    await db.sections.bulkAdd([
      { projectId: pid, name: 'Dos', state: 'todo', order: 0 },
      { projectId: pid, name: 'Devant', state: 'todo', order: 1 },
    ])
    await db.sessions.add({ projectId: pid, sectionId: 1, date: '2026-06-30', durationSec: 600 })
    // Pool (nouveau modèle) : la laine porte reservations:{ [pid]: qty }.
    const yid = await db.yarns.add({ brand: 'Drops', quantity: 5, reservations: { [pid]: 2 } })

    // Suppression : renvoie un bundle complet et purge la base.
    const bundle = await store.remove(pid)
    expect(bundle.sections).toHaveLength(2)
    expect(store.projects).toHaveLength(0)
    expect(await db.sections.where('projectId').equals(pid).count()).toBe(0)
    expect(await db.sessions.where('projectId').equals(pid).count()).toBe(0)
    // La laine réservée est libérée (l'allocation de CE projet retirée du pool).
    expect((await db.yarns.get(yid)).reservations).toEqual({})

    // Restauration : projet + dépendances reviennent, laine ré-attachée.
    await store.restore(bundle)
    expect(store.projects).toHaveLength(1)
    expect(await db.sections.where('projectId').equals(pid).count()).toBe(2)
    expect(await db.sessions.where('projectId').equals(pid).count()).toBe(1)
    expect((await db.yarns.get(yid)).reservations).toEqual({ [pid]: 2 })
  })

  it('supprimer un projet retire SON allocation du pool et laisse celles des autres', async () => {
    const pid = await db.projects.add({ name: 'P1', technique: 'knitting' })
    const other = await db.projects.add({ name: 'P2', technique: 'knitting' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2, [other]: 1 } })
    const store = useProjectsStore()
    await store.load()
    const bundle = await store.remove(pid)
    expect((await db.yarns.get(yid)).reservations).toEqual({ [other]: 1 })
    await store.restore(bundle)
    expect((await db.yarns.get(yid)).reservations).toEqual({ [pid]: 2, [other]: 1 })
  })

  it('après suppression, le store laines en mémoire est à jour (le badge du stock ne ment pas)', async () => {
    const pid = await db.projects.add({ name: 'P', technique: 'knitting' })
    await db.yarns.add({ brand: 'L', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const yarns = useYarnsStore()
    const projects = useProjectsStore()
    await yarns.load() // l'utilisateur a consulté son stock : le store est chargé
    await projects.load()
    await projects.remove(pid)
    // StashView ne recharge pas (loaded === true) : c'est CE tableau que le badge lit.
    expect(yarns.yarns[0].reservations).toEqual({})
  })

  it('après annulation (restore), le store laines est à jour lui aussi', async () => {
    const pid = await db.projects.add({ name: 'P', technique: 'knitting' })
    await db.yarns.add({ brand: 'L', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const yarns = useYarnsStore()
    const projects = useProjectsStore()
    await yarns.load()
    await projects.load()
    const bundle = await projects.remove(pid)
    await projects.restore(bundle)
    expect(yarns.yarns[0].reservations).toEqual({ [pid]: 2 })
  })

  it('la restauration n’écrit plus reservedFor/reservedQty (ancien modèle « 1 laine = 1 projet », retiré le 07/09/2026)', async () => {
    // Scalars hérités préexistants sur la fiche laine : la restauration ne doit
    // plus les effacer à l’aveugle — elle n’écrit que la map `reservations`.
    // (Appel direct de restore() avec un bundle à la main : remove() porte son
    // propre effacement des scalaires, hors du périmètre arbitré du 07/09.)
    const yid = await db.yarns.add({ brand: 'L', colorName: 'Bleu', quantity: 5, reservations: {}, reservedFor: 9, reservedQty: 2 })
    const store = useProjectsStore()
    await store.restore({ project: { id: 1, name: 'Pull' }, yarnLinks: [{ id: yid, qty: 2 }] })
    const y = await db.yarns.get(yid)
    expect(y.reservations).toEqual({ 1: 2 })
    expect(y.reservedFor).toBe(9)
    expect(y.reservedQty).toBe(2)
  })

  it('un bundle nu (sans enveloppe `project`) ne restaure rien — restore() exige la forme complète', async () => {
    const store = useProjectsStore()
    await store.load()
    // Ancien format toléré AVANT le ménage : un objet projet transmis tel quel, sans
    // l'enveloppe { project, sections, ... } que produit `remove()`. Vérifié par l'ÉTAT
    // de la base (pas par la valeur de retour) : rien n'a été écrit.
    await store.restore({ id: 99, name: 'Pull nu', technique: 'knitting' })
    expect(await db.projects.get(99)).toBeUndefined()
    expect(store.projects).toHaveLength(0)
  })

  it('supprimer un projet rend ses pelotes réservées au stock, sans jamais toucher la quantité', async () => {
    const pid = await db.projects.add({ name: 'P', technique: 'knitting' })
    const yid = await db.yarns.add({ brand: 'L', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 }, consumed: {} })
    const projects = useProjectsStore()
    await projects.load()
    await projects.remove(pid)
    const y = await db.yarns.get(yid)
    expect(y.reservations).toEqual({})
    expect(y.quantity).toBe(5) // la suppression ne déduit plus RIEN
  })

  it('supprimer un projet terminé (pelotes déjà consommées) ne rend rien : le stock reste déduit', async () => {
    const pid = await db.projects.add({ name: 'P', technique: 'knitting', status: 'done' })
    const yid = await db.yarns.add({ brand: 'L', colorName: 'Bleu', quantity: 3, reservations: {}, consumed: { [pid]: 2 } })
    const projects = useProjectsStore()
    await projects.load()
    await projects.remove(pid)
    const y = await db.yarns.get(yid)
    expect(y.quantity).toBe(3) // les pelotes ont été tricotées : elles ne reviennent pas
    expect(y.consumed).toEqual({}) // la trace part avec le projet
  })

  it('ANNULER une telle suppression rend la trace de consommation', async () => {
    const pid = await db.projects.add({ name: 'P', technique: 'knitting', status: 'done' })
    const yid = await db.yarns.add({ brand: 'L', colorName: 'Bleu', quantity: 3, reservations: {}, consumed: { [pid]: 2 } })
    const projects = useProjectsStore()
    await projects.load()
    const bundle = await projects.remove(pid)
    await projects.restore(bundle)
    const y = await db.yarns.get(yid)
    expect(y.consumed).toEqual({ [pid]: 2 })
    expect(y.quantity).toBe(3)
  })

  // Protège l'atomicité de la cascade : un échec en cours de route n'ampute ni le pool ni le projet.
  it('une suppression qui échoue en cours de cascade ne laisse rien à moitié fait', async () => {
    const pid = await db.projects.add({ name: 'P', technique: 'knitting' })
    await db.sections.add({ projectId: pid, name: 'Dos', order: 0 })
    const yid = await db.yarns.add({ brand: 'L', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const projects = useProjectsStore()
    await projects.load()
    const spy = vi.spyOn(db.projects, 'delete').mockRejectedValue(new Error('disque plein'))
    try {
      await expect(projects.remove(pid)).rejects.toThrow('disque plein')
    } finally {
      spy.mockRestore()
    }
    expect(await db.projects.get(pid)).toBeDefined()
    expect(await db.sections.where('projectId').equals(pid).count()).toBe(1)
    expect((await db.yarns.get(yid)).reservations).toEqual({ [pid]: 2 })
  })

  it('seedExamplesIfEmpty ne seed qu’une base vide', async () => {
    const store = useProjectsStore()
    const seeded = await store.seedExamplesIfEmpty('knitting')
    // Les DEUX identifiants remontent désormais (04/08) : `recordSeededSamples` en a
    // besoin pour que `isDbRestorable` reconnaisse une base neuve.
    expect(seeded.ideaId).toBeTypeOf('number')
    expect(seeded.wipId).toBeTypeOf('number')
    expect(seeded.ideaId).not.toBe(seeded.wipId)
    expect(store.projects.length).toBeGreaterThanOrEqual(2)

    // Deuxième appel : base non vide → ne reseed pas.
    const again = await store.seedExamplesIfEmpty('knitting')
    expect(again).toBeNull()
  })

  it('le semis d’exemples ne pose aucun lien d’outil', async () => {
    const store = useProjectsStore()
    await store.seedExamplesIfEmpty('knitting')
    expect(store.projects.every((p) => !p.toolIds?.length)).toBe(true)
  })
})

describe('date de fin — règle 1 (statut → date)', () => {
  const aujourdhui = () => ymdLocal(new Date())

  it('SITE 1 (fiche projet) : passer à Terminé date la clôture', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Châle', status: 'wip' })
    await store.update(id, { status: 'done' }) // exactement le patch de ProjectDetailView.changeStatus
    expect((await store.get(id)).finishedAt).toBe(aujourdhui())
  })

  it('passer à Abandonné ne pose PAS de date de fin', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Pull', status: 'wip' })
    await store.update(id, { status: 'abandoned' })
    expect((await store.get(id)).finishedAt || '').toBe('')
  })

  it('SITE 2 (tuile de l’Accueil) : idem depuis le badge de statut', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Bonnet', status: 'wip' })
    await store.update(id, { status: 'done' }) // patch de ProjectCard.onStatus
    expect((await store.get(id)).finishedAt).toBe(aujourdhui())
  })

  it('SITE 3 (formulaire d’édition) : un payload COMPLET ne perd pas la date saisie', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Pull', status: 'wip', finishedAt: '' })
    // Le formulaire renvoie TOUJOURS les deux champs : c'est ce cas qui teste la préséance.
    await store.update(id, { name: 'Pull', status: 'done', finishedAt: '2026-07-15' })
    expect((await store.get(id)).finishedAt).toBe('2026-07-15')
  })

  it('quitter Terminé ne supprime jamais la date', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Écharpe', status: 'done', finishedAt: '2026-07-15' })
    await store.update(id, { status: 'wip', finishedAt: '2026-07-15' })
    expect((await store.get(id)).finishedAt).toBe('2026-07-15')
  })

  it('un geste de progression n’écrit AUCUNE date de fin', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Mitaines', status: 'wip' })
    await store.markWorked(id)
    expect((await store.get(id)).finishedAt).toBe('')
  })

  it('SITE 4 (création directe en Terminé) : le projet est daté d’aujourd’hui', async () => {
    // `create()` ne passe pas par `update()` — sans ce chemin, le projet serait invisible
    // dans la tuile des projets terminés.
    const store = useProjectsStore()
    const id = await store.create({ name: 'Snood fini', status: 'done' })
    expect((await store.get(id)).finishedAt).toBe(aujourdhui())
  })

  it('une création en Terminé AVEC date garde la date saisie', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Snood daté', status: 'done', finishedAt: '2026-07-15' })
    expect((await store.get(id)).finishedAt).toBe('2026-07-15')
  })
})

describe('store projets : liens d’outils (toolIds)', () => {
  it('un projet neuf porte toolIds vide', () => {
    expect(emptyProject().toolIds).toEqual([])
  })

  it('un projet neuf porte kitPicks vide', () => {
    expect(emptyProject().kitPicks).toEqual([])
  })

  it('setToolLinks élague toolIds et kitPicks, garde un kit en corbeille', async () => {
    const store = useProjectsStore()
    const tools = useToolsStore()
    const kit = await db.tools.add({ type: 'interchangeable', kitSizes: [4, 5], kitCables: [80] })
    const trashedKit = await tools.add({ type: 'interchangeable', kitSizes: [3], kitCables: [] })
    await useTrashStore().moveToTrash('tool', trashedKit)
    const pid = await store.create({ name: 'Bonnet' })
    await store.setToolLinks(pid, {
      toolIds: [kit, 9999],
      kitPicks: [
        { toolId: kit, sizeMm: 4, cableCm: 80 },
        { toolId: kit, sizeMm: 6, cableCm: null },
        { toolId: trashedKit, sizeMm: 3, cableCm: null },
        { toolId: 9999, sizeMm: 4, cableCm: null },
      ],
    })
    const p = await store.get(pid)
    expect(p.toolIds).toEqual([kit])
    expect(p.kitPicks).toEqual([
      { toolId: kit, sizeMm: 4, cableCm: 80, cableJoin: null },
      { toolId: trashedKit, sizeMm: 3, cableCm: null, cableJoin: null },
    ])
  })

  // Protège l'écriture des prises avec diamètre : 80 L gardé, 80 S inconnu du kit retiré, prise ancienne rattachée.
  it('setToolLinks écrit cableJoin et rattache une prise ancienne à l’unique diamètre', async () => {
    const store = useProjectsStore()
    const both = await db.tools.add({ type: 'interchangeable', kitSizes: [4], kitCables: [{ cm: 80, join: 's' }, { cm: 80, join: 'l' }] })
    const onlyS = await db.tools.add({ type: 'interchangeable', kitSizes: [4], kitCables: [{ cm: 60, join: 's' }] })
    const pid = await store.create({ name: 'Bonnet' })
    await store.setToolLinks(pid, { kitPicks: [
      { toolId: both, sizeMm: 4, cableCm: 80, cableJoin: 'l' },
      { toolId: onlyS, sizeMm: 4, cableCm: 60 },
    ] })
    expect((await store.get(pid)).kitPicks).toEqual([
      { toolId: both, sizeMm: 4, cableCm: 80, cableJoin: 'l' },
      { toolId: onlyS, sizeMm: 4, cableCm: 60, cableJoin: 's' },
    ])
  })

  it('setToolIds retire les ids d’outils inexistants à l’écriture', async () => {
    const store = useProjectsStore()
    const toolId = await db.tools.add({ type: 'circular', sizeMm: 4 })
    const pid = await store.create({ name: 'Bonnet' })
    await store.setToolIds(pid, [toolId, 9999])
    expect((await store.get(pid)).toolIds).toEqual([toolId])
  })

  it('setToolIds sur un projet en cours ne date rien et n’inscrit aucun jour actif', async () => {
    const store = useProjectsStore()
    const toolId = await db.tools.add({ type: 'circular', sizeMm: 4 })
    const pid = await store.create({ name: 'Bonnet', status: 'wip' })
    await store.setToolIds(pid, [toolId])
    const p = await store.get(pid)
    expect(p.toolIds).toEqual([toolId])
    expect(p.lastWorkedAt).toBeFalsy()
    expect(p.finishedAt).toBeFalsy()
    expect(p.startedAt).toBeFalsy()
    expect(await db.activeDays.count()).toBe(0)
  })

  it('setToolLinks sur un projet en cours ne date rien et n’inscrit aucun jour actif', async () => {
    const store = useProjectsStore()
    const kit = await db.tools.add({ type: 'interchangeable', kitSizes: [4], kitCables: [80] })
    const pid = await store.create({ name: 'Bonnet', status: 'wip' })
    await store.setToolLinks(pid, { toolIds: [], kitPicks: [{ toolId: kit, sizeMm: 4, cableCm: 80 }] })
    const p = await store.get(pid)
    expect(p.kitPicks).toEqual([{ toolId: kit, sizeMm: 4, cableCm: 80, cableJoin: null }])
    expect(p.lastWorkedAt).toBeFalsy()
    expect(p.finishedAt).toBeFalsy()
    expect(p.startedAt).toBeFalsy()
    expect(await db.activeDays.count()).toBe(0)
  })

  it('setToolLinks avec kitPicks seul laisse toolIds intact', async () => {
    const store = useProjectsStore()
    const circ = await db.tools.add({ type: 'circular', sizeMm: 4 })
    const kit = await db.tools.add({ type: 'interchangeable', kitSizes: [5], kitCables: [] })
    const pid = await store.create({ name: 'Bonnet' })
    await store.setToolLinks(pid, { toolIds: [circ] })
    await store.setToolLinks(pid, { kitPicks: [{ toolId: kit, sizeMm: 5, cableCm: null }] })
    const p = await store.get(pid)
    expect(p.toolIds).toEqual([circ])
    expect(p.kitPicks).toEqual([{ toolId: kit, sizeMm: 5, cableCm: null, cableJoin: null }])
  })

  it('un outil supprimé puis restauré garde son id et le lien revient', async () => {
    const projects = useProjectsStore()
    const tools = useToolsStore()
    const toolId = await tools.add({ type: 'circular', sizeMm: 4 })
    const pid = await projects.create({ name: 'Bonnet' })
    await projects.setToolIds(pid, [toolId])
    const removed = await tools.remove(toolId)
    const project = await projects.get(pid)
    expect(linkedTools(project, await db.tools.toArray())).toEqual([])
    await tools.restore(removed)
    expect(linkedTools(await projects.get(pid), await db.tools.toArray()).map((t) => t.id)).toEqual([toolId])
  })

  // Protège le lien d'un outil en corbeille : réécrire les liens ne l'efface pas, la restauration le ramène.
  it('setToolIds garde l’id d’un outil en corbeille, et le lien revient à sa restauration', async () => {
    const projects = useProjectsStore()
    const trash = useTrashStore()
    const toolId = await db.tools.add({ type: 'circular', sizeMm: 4 })
    const otherId = await db.tools.add({ type: 'circular', sizeMm: 6 })
    const pid = await projects.create({ name: 'Bonnet' })
    await projects.setToolIds(pid, [toolId])
    const trashId = await trash.moveToTrash('tool', toolId)
    await projects.setToolIds(pid, [otherId, toolId])
    expect((await projects.get(pid)).toolIds).toEqual([otherId, toolId])
    await trash.restore(trashId)
    const ids = linkedTools(await projects.get(pid), await db.tools.toArray()).map((t) => t.id)
    expect(ids.sort()).toEqual([toolId, otherId].sort())
  })

  // Protège le nettoyage : un outil supprimé définitivement (corbeille vidée) perd son lien à l'écriture.
  it('setToolIds retire l’id d’un outil supprimé définitivement', async () => {
    const projects = useProjectsStore()
    const trash = useTrashStore()
    const toolId = await db.tools.add({ type: 'circular', sizeMm: 4 })
    const pid = await projects.create({ name: 'Bonnet' })
    await projects.setToolIds(pid, [toolId])
    await trash.moveToTrash('tool', toolId)
    await trash.empty()
    await projects.setToolIds(pid, [toolId])
    expect((await projects.get(pid)).toolIds).toEqual([])
  })
})

describe('store projets : parkedTools vidé à la fin du projet', () => {
  const parked = () => ({ toolIds: [1], kitPicks: [] })

  // Protège la fin de vie : un projet terminé ou abandonné ne garde pas d'outils « mis de côté ».
  it.each(['done', 'abandoned'])('passer à %s vide parkedTools', async (status) => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Bonnet', status: 'pause', parkedTools: parked() })
    await store.update(id, { status })
    expect((await store.get(id)).parkedTools).toBeNull()
  })

  // Contrat : repasser à wip seul ne vide rien, c'est le composable de reprise qui s'en charge.
  it('passer à wip seul laisse parkedTools intact', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Bonnet', status: 'pause', parkedTools: parked() })
    await store.update(id, { status: 'wip' })
    expect((await store.get(id)).parkedTools).toEqual(parked())
  })

  // Contrat : un projet sans parkedTools ne reçoit pas le champ.
  it('un projet terminé sans parkedTools n’en gagne pas', async () => {
    const store = useProjectsStore()
    const id = await store.create({ name: 'Bonnet', status: 'wip' })
    await store.update(id, { status: 'done' })
    expect('parkedTools' in (await store.get(id))).toBe(false)
  })
})

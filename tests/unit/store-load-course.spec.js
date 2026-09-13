// tests/unit/store-load-course.spec.js
// Course entre deux rechargements de store (bug du 06/08, écran Dépenses : une des deux
// laines achetées manquait au budget).
//
// Mécanique : `add()` écrit la ligne PUIS relit toute la table (`load()`). Deux ajouts
// enchaînés lancent donc deux lectures ; rien ne garantit qu'elles se terminent dans
// l'ordre où elles sont parties. Si la lecture du PREMIER ajout se termine en dernier,
// elle réassigne son instantané — pris avant la seconde écriture — par-dessus le plus
// récent : la 2ᵉ ligne disparaît de l'écran alors qu'elle est bien en base. Et comme
// `loaded` reste vrai, aucune vue ne relit plus rien : le chiffre faux tient jusqu'au
// redémarrage de l'application.
//
// L'entrelacement est FORCÉ ici (les lectures sont retenues et relâchées dans l'ordre
// choisi) : un test qui se contenterait de lancer deux ajouts passerait sur le code
// défectueux sans rien prouver.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { usePurchasesStore } from '@/stores/purchases'
import { useYarnsStore } from '@/stores/yarns'
import { useProjectsStore } from '@/stores/projects'
import { usePatternsStore } from '@/stores/patterns'
import { useSectionsStore } from '@/stores/sections'
import { useCountersStore } from '@/stores/counters'
import { useSessionsStore } from '@/stores/sessions'
import { useTrashStore } from '@/stores/trash'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => {
  vi.restoreAllMocks()
})

// Retient la résolution de chaque `table.orderBy(...).reverse().toArray()`. La lecture
// RÉELLE part bien au moment de l'appel (donc chaque instantané reflète l'état de la base
// à cet instant) ; seule sa restitution à l'appelant attend qu'on ouvre la vanne.
function retenirLectures(table) {
  const vannes = []
  const orderByReel = table.orderBy.bind(table)
  vi.spyOn(table, 'orderBy').mockImplementation((index) => {
    const collection = orderByReel(index).reverse()
    return {
      reverse: () => ({
        toArray: async () => {
          const lignes = await collection.toArray()
          await new Promise((ouvrir) => vannes.push(ouvrir))
          return lignes
        },
      }),
    }
  })
  return vannes
}

// Même principe pour les magasins qui filtrent par projet (`where(…).equals(…)`) plutôt que
// de lire la table entière.
function retenirLecturesFiltrees(table) {
  const vannes = []
  const whereReel = table.where.bind(table)
  const retenir = async (promesse) => {
    const lignes = await promesse
    await new Promise((ouvrir) => vannes.push(ouvrir))
    return lignes
  }
  vi.spyOn(table, 'where').mockImplementation((index) => ({
    equals: (valeur) => {
      const collection = whereReel(index).equals(valeur)
      return {
        toArray: () => retenir(collection.toArray()),
        sortBy: (cle) => retenir(collection.sortBy(cle)),
      }
    },
  }))
  return vannes
}

const enVol = (vannes, n) => vi.waitFor(() => expect(vannes).toHaveLength(n))

describe('rechargement de store : un instantané périmé n’écrase jamais un plus récent', () => {
  it('deux achats enchaînés : la 2ᵉ ligne reste affichée même si la 1re lecture finit en dernier', async () => {
    const store = usePurchasesStore()
    const vannes = retenirLectures(db.purchases)

    const p1 = store.add({ yarnId: 1, yarnLabel: 'Drops · Baby Merino', quantity: 2, unitPrice: '6,40' })
    await enVol(vannes, 1) // lecture du 1er ajout : elle ne voit qu'une ligne
    const p2 = store.add({ yarnId: 2, yarnLabel: 'Katia · Merino', quantity: 1, unitPrice: '17,70' })
    await enVol(vannes, 2) // lecture du 2e ajout : elle voit les deux

    vannes[1]() // la plus récente rend la main d'abord…
    await p2
    vannes[0]() // …la plus ancienne ensuite : c'est elle qui écrasait tout
    await p1

    expect(await db.purchases.count()).toBe(2) // la base, elle, n'a jamais rien perdu
    expect(store.purchases).toHaveLength(2)
    expect(store.purchases.map((l) => l.yarnLabel).sort()).toEqual(['Drops · Baby Merino', 'Katia · Merino'])
  })

  it('deux laines enchaînées : la 2ᵉ fiche reste dans le stock (même course, store yarns)', async () => {
    const store = useYarnsStore()
    const vannes = retenirLectures(db.yarns)

    const p1 = store.add({ brand: 'Drops', colorName: 'Bleu' })
    await enVol(vannes, 1)
    const p2 = store.add({ brand: 'Katia', colorName: 'Rouge' })
    await enVol(vannes, 2)

    vannes[1]()
    await p2
    vannes[0]()
    await p1

    expect(await db.yarns.count()).toBe(2)
    expect(store.yarns).toHaveLength(2)
    expect(store.yarns.map((y) => y.brand).sort()).toEqual(['Drops', 'Katia'])
  })

  // `await load()` doit continuer de vouloir dire « la liste est à jour ». Une première
  // version du jeton laissait le rechargement abandonné rendre la main SANS rien assigner,
  // en pariant que « le plus récent est en vol, l'écran sera correct au tick suivant ».
  // Faux pour qui lit la liste dans la foulée de son `await`, sans rien attendre entre les
  // deux — et il y en a (revue de code) : `useProjectConsumption.requestStatusChange()` lit
  // `yarnsStore.yarns` juste après, et sur une liste vide conclut « aucune laine réservée »,
  // donc clôture le projet SANS demander combien de pelotes ont été tricotées, en laissant
  // les réservations pendantes. Même forme pour les exports CSV des réglages, qui
  // produiraient un fichier vide en annonçant « Export terminé ». Le rechargement abandonné
  // attend donc le gagnant.
  it('le rechargement abandonné ne rend la main qu’APRÈS le gagnant, liste à jour', async () => {
    const store = usePurchasesStore()
    await db.purchases.add({ yarnId: 1, yarnLabel: 'Drops', quantity: 1 })
    const vannes = retenirLectures(db.purchases)

    const p1 = store.load() // ne verra qu'une ligne
    await enVol(vannes, 1)
    await db.purchases.add({ yarnId: 2, yarnLabel: 'Katia', quantity: 1 })
    const p2 = store.load() // en verra deux
    await enVol(vannes, 2)

    let p1Fini = false
    p1.then(() => {
      p1Fini = true
    })
    vannes[0]() // le perdant a fini SA lecture…
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(p1Fini).toBe(false) // …mais il ne rend pas la main tant que le gagnant n'a pas écrit

    vannes[1]()
    await p1
    expect(store.purchases).toHaveLength(2) // au retour de SON await, la liste est fraîche
    await p2
  })
})

// Les six autres magasins portaient la même forme non gardée. Le plus exposé est
// `projects.js` : `markWorked()` tourne à CHAQUE geste de progression du tricot, donc deux
// gestes rapprochés suffisent — une progression pouvait disparaître de l'écran alors qu'elle
// était bien en base, et n'y revenir qu'au redémarrage. Les magasins par projet
// (`counters`, `sections`, `sessions`) sont ceux des boutons +/− et des cases à cocher,
// tapés en rafale par nature.
//
// `settings.js` et `activeSession.js` sont écartés à dessein : ils lisent des scalaires, pas
// un instantané de liste — il n'y a pas de « liste périmée » à écraser. Nuance relevée en
// revue : `settings.load()` expose bien une AUTRE course (son enfilade de lectures peut
// réécrire une valeur que `setTheme()`/`setLocale()` vient de changer), qu'un jeton ne
// corrigerait pas davantage — donc « une autre course, pas celle-ci », et non « aucune ».
const MAGASINS = [
  {
    nom: 'projects — markWorked() à chaque geste de progression',
    table: () => db.projects,
    filtre: false,
    semer: (n) => db.projects.add({ name: `Projet ${n}`, needles: [], sizes: [] }),
    store: () => useProjectsStore(),
    charger: (s) => s.load(),
    lire: (s) => s.projects,
  },
  {
    nom: 'patterns',
    table: () => db.patterns,
    filtre: false,
    // `reader` renseigné : sans lui, load() déclenche en plus une migration paresseuse qui
    // écrit — hors sujet ici, et source de bruit dans la mesure.
    semer: (n) => db.patterns.add({ name: `Patron ${n}`, reader: { blocks: [] } }),
    store: () => usePatternsStore(),
    charger: (s) => s.load(),
    lire: (s) => s.patterns,
  },
  {
    nom: 'trash',
    table: () => db.trash,
    filtre: false,
    semer: (n) => db.trash.add({ type: 'yarn', name: `Objet ${n}`, payload: {}, deletedAt: '2026-08-06' }),
    store: () => useTrashStore(),
    charger: (s) => s.load(),
    lire: (s) => s.items,
  },
  {
    nom: 'sections — cases à cocher tapées en rafale',
    table: () => db.sections,
    filtre: true,
    semer: (n) => db.sections.add({ projectId: 1, name: `Section ${n}`, order: n, state: 'todo' }),
    store: () => useSectionsStore(),
    charger: (s) => s.loadForProject(1),
    lire: (s) => s.sections,
  },
  {
    nom: 'counters — boutons +/− tapés en rafale',
    table: () => db.counters,
    filtre: true,
    semer: (n) => db.counters.add({ projectId: 1, name: `Compteur ${n}`, value: 0 }),
    store: () => useCountersStore(),
    charger: (s) => s.loadForProject(1),
    lire: (s) => s.counters,
  },
  {
    nom: 'sessions',
    table: () => db.sessions,
    filtre: true,
    semer: (n) => db.sessions.add({ projectId: 1, date: `2026-08-0${n}`, durationSec: 60, rowsDone: n }),
    store: () => useSessionsStore(),
    charger: (s) => s.loadForProject(1),
    lire: (s) => s.sessions,
  },
]

describe('les six autres magasins : même garde, même invariant', () => {
  for (const m of MAGASINS) {
    it(`${m.nom} : une lecture partie AVANT n’écrase pas une lecture partie APRÈS`, async () => {
      const store = m.store()
      await m.semer(1)
      const vannes = m.filtre ? retenirLecturesFiltrees(m.table()) : retenirLectures(m.table())

      const p1 = m.charger(store) // ne voit qu'une ligne
      await enVol(vannes, 1)
      await m.semer(2)
      const p2 = m.charger(store) // en voit deux
      await enVol(vannes, 2)

      vannes[1]()
      await p2
      vannes[0]() // la plus ancienne revient en dernier : elle ne doit RIEN réassigner
      await p1

      expect(await m.table().count()).toBe(2) // la base n'a jamais rien perdu
      expect(m.lire(store)).toHaveLength(2)
    })

    it(`${m.nom} : le rechargement abandonné attend le gagnant`, async () => {
      const store = m.store()
      await m.semer(1)
      const vannes = m.filtre ? retenirLecturesFiltrees(m.table()) : retenirLectures(m.table())

      const p1 = m.charger(store)
      await enVol(vannes, 1)
      await m.semer(2)
      const p2 = m.charger(store)
      await enVol(vannes, 2)

      let p1Fini = false
      p1.then(() => {
        p1Fini = true
      })
      vannes[0]()
      for (let i = 0; i < 20; i++) await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
      expect(p1Fini).toBe(false) // il ne rend pas la main tant que le gagnant n'a pas écrit

      vannes[1]()
      await p1
      expect(m.lire(store)).toHaveLength(2) // au retour de SON await, la liste est fraîche
      await p2
    })
  }
})

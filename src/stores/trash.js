// Corbeille — éléments supprimés récupérables (PRD §7.14).
// Couvre les entités « lourdes » (projet, laine, patron) qu'on craindrait de perdre.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, plain } from '@/db/db'
import { setProjectReservation, consumedOf } from '@/utils/yarn-usage'
import { usePurchasesStore } from '@/stores/purchases'
import { useYarnsStore } from '@/stores/yarns'
import { createLoadGuard } from '@/stores/load-guard'

const TABLE = { project: 'projects', yarn: 'yarns', pattern: 'patterns' }

export const useTrashStore = defineStore('trash', () => {
  const items = ref([])

  // Jeton de rechargement (cf. `stores/load-guard.js`) : deux suppressions enchaînées
  // lancent deux lectures, et la plus ancienne ne doit pas réafficher la corbeille telle
  // qu'elle était avant la seconde.
  const loadGuard = createLoadGuard()
  function load() {
    return loadGuard.run(async (isCurrent) => {
      const rows = await db.trash.orderBy('id').reverse().toArray()
      if (!isCurrent()) return
      items.value = rows
    })
  }
  async function add(type, payload) {
    // Un projet est stocké sous forme de « bundle » { project, sections, … } (cascade).
    const source = payload?.project || payload
    const name = source?.name || source?.brand || source?.colorName || ''
    const id = await db.trash.add({ type, payload: plain(payload), name, deletedAt: new Date().toISOString() })
    await load()
    return id
  }
  async function restore(trashId) {
    const shortfalls = []
    const row = await db.trash.get(Number(trashId))
    if (row) {
      if (row.type === 'project') {
        // Restauration en cascade (projet + sections/diagrammes/compteurs/sessions + laines).
        // Exige la forme complète { project, … } produite par la suppression en cascade —
        // même contrat que projects.js `restore`. La tolérance à l'ANCIEN format (projet
        // stocké nu comme payload) a été retirée le 07/09/2026 (ménage pré-1.0 : corbeilles
        // vérifiées vides sur les deux appareils) — une telle entrée ne restaure plus rien,
        // l'entrée est consommée ci-dessous sans rien écrire.
        const b = row.payload || {}
        if (b.project) await db.projects.put(b.project)
        if (b.sections?.length) await db.sections.bulkPut(b.sections)
        if (b.diagrams?.length) await db.diagrams.bulkPut(b.diagrams)
        if (b.counters?.length) await db.counters.bulkPut(b.counters)
        if (b.sessions?.length) await db.sessions.bulkPut(b.sessions)
        // Pool : même logique que projects.js `restore` — réinjecte l'allocation de
        // CE projet sans toucher celle des autres.
        for (const l of b.yarnLinks || []) {
          let y = await db.yarns.get(l.id)
          if (!y) continue
          // Trace de consommation (K3, même logique que projects.js `restore`) :
          // indépendante de la réservation ci-dessous, peut exister SEULE (la
          // réservation ayant déjà été retirée au moment de la consommation) — réinjectée
          // avant tout, sinon le garde `!qty` plus bas la sauterait.
          if (l.consumedQty != null) {
            const nextConsumed = { ...consumedOf(y), [b.project?.id]: l.consumedQty }
            await db.yarns.update(l.id, { consumed: nextConsumed })
            y = await db.yarns.get(l.id)
          }
          if (l.qty == null) continue
          const key = b.project?.id
          const qty = l.qty
          if (!qty || !key) continue
          const next = setProjectReservation(y, key, qty)
          // Signal (pas de correctif) : si l'allocation obtenue est inférieure à celle
          // demandée, un autre projet a pris la place entre-temps — setProjectReservation
          // a déjà borné correctement (jamais de pelotes inventées), on se contente ici
          // de le faire remonter à l'appelant (SettingsView) pour avertir l'utilisatrice.
          const got = next[key] ?? 0
          if (got < qty) shortfalls.push({ yarnId: l.id, requested: qty, got })
          // L'effacement des scalaires hérités reservedFor/reservedQty (ancien modèle
          // « 1 laine = 1 projet ») a été retiré le 07/09/2026 (ménage pré-1.0) :
          // cette écriture ne pose plus que la map `reservations` du modèle courant.
          await db.yarns.update(l.id, { reservations: next })
        }
      } else if (TABLE[row.type]) {
        await db[TABLE[row.type]].put(row.payload)
      }
    }
    await db.trash.delete(Number(trashId))
    await load()
    // La restauration vient de réécrire des laines en base (réinjection des réservations d'un
    // projet, ou remise en place d'une fiche laine) : si le stock est déjà chargé en mémoire, il
    // faut le rafraîchir, sinon il reste périmé (il ne se recharge pas tout seul — StashView ne
    // charge que si `loaded` est faux). MÊME raison que dans `projects.js` remove()/restore().
    // SettingsView le fait déjà de son côté ; le chemin « Annuler » de la snackbar
    // (`useSoftDelete`), lui, ne recharge que le magasin de l'entité supprimée — sur une
    // suppression de PROJET, personne ne rechargeait les laines et le stock affichait encore les
    // pelotes comme libres alors qu'elles venaient d'être re-réservées.
    const yarnsStore = useYarnsStore()
    if (yarnsStore.loaded) await yarnsStore.load()
    return { shortfalls }
  }
  // Suppression DÉFINITIVE d'une laine : ses achats survivent (arbitrage produit, 31/07 —
  // l'argent dépensé ne redescend pas), mais perdent leur lien. Ils restent lisibles par
  // leur libellé figé et restent supprimables un par un depuis l'écran Dépenses.
  // ⚠️ Surtout PAS au soft-delete : `restore()` remet la fiche avec le MÊME id, le lien
  // doit donc rester intact tant que la corbeille n'est pas vidée.
  async function drop(trashId) {
    const row = await db.trash.get(Number(trashId))
    if (row?.type === 'yarn' && row.payload?.id != null) {
      await usePurchasesStore().orphanYarn(row.payload.id)
    }
    await db.trash.delete(Number(trashId))
    await load()
  }
  async function empty() {
    const rows = await db.trash.toArray()
    const purchases = usePurchasesStore()
    for (const row of rows) {
      if (row.type === 'yarn' && row.payload?.id != null) {
        await purchases.orphanYarn(row.payload.id)
      }
    }
    await db.trash.clear()
    await load()
  }
  return { items, load, add, restore, drop, empty }
})

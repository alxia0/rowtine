// Corbeille — éléments supprimés récupérables (PRD §7.14).
// Couvre les entités « lourdes » (projet, laine, patron) qu'on craindrait de perdre.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, plain } from '@/db/db'
import { usePurchasesStore } from '@/stores/purchases'
import { refreshYarnsIfLoaded } from '@/stores/yarns'
import { reinjectYarnLinks } from '@/stores/projects'
import { createLoadGuard } from '@/stores/load-guard'

const TABLE = { project: 'projects', yarn: 'yarns', pattern: 'patterns' }

// Ligne de corbeille, construite à l'identique par `add` et `moveToTrash`.
function trashRow(type, payload) {
  // Un projet est stocké sous forme de « bundle » { project, sections, … } (cascade).
  const source = payload?.project || payload
  const name = source?.name || source?.brand || source?.colorName || ''
  return { type, payload: plain(payload), name, deletedAt: new Date().toISOString() }
}

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
    const id = await db.trash.add(trashRow(type, payload))
    await load()
    return id
  }
  // Suppression douce d'un patron ou d'une laine : retrait de sa table ET entrée de
  // corbeille dans UNE transaction. Enchaînées séparément (store puis `add`), un échec
  // de la seconde écriture perdait l'élément : plus en base, jamais en corbeille.
  // Renvoie l'id de l'entrée de corbeille, ou `null` si l'élément n'existait pas.
  // Les projets n'y passent pas : leur suppression en cascade vit dans projects.js.
  async function moveToTrash(type, id) {
    const table = type === 'yarn' || type === 'pattern' ? db[TABLE[type]] : null
    if (!table) throw new Error(`moveToTrash: type non pris en charge (${type})`)
    const trashId = await db.transaction('rw', [table, db.trash], async () => {
      const item = await table.get(Number(id))
      if (!item) return null
      await table.delete(Number(id))
      return db.trash.add(trashRow(type, item))
    })
    await load()
    return trashId
  }
  async function restore(trashId) {
    // UNE transaction pour toute la restauration, suppression de l'entrée comprise (même
    // motif que projects.js `remove()`) : un échec en route (quota, appli tuée) annule
    // tout, au lieu de laisser un projet sans ses sections ou une entrée de corbeille
    // qui, restaurée une seconde fois, dupliquerait les réservations de laine.
    // Uniquement des appels Dexie et des fonctions pures dans le callback
    // (`reinjectYarnLinks` en fait partie), sans quoi la zone se perd.
    const shortfalls = await db.transaction(
      'rw',
      [db.trash, db.projects, db.sections, db.diagrams, db.counters, db.sessions, db.patterns, db.yarns],
      async () => {
        let manques = []
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
            // Instance patron dédiée (copy-on-write), supprimée en cascade par projects.js `remove()`.
            if (b.instancePattern) await db.patterns.put(b.instancePattern)
            // Pool : réinjecte l'allocation de CE projet (même mécanisme que projects.js
            // `restore`, cf. `reinjectYarnLinks`). `collectShortfalls` : si l'allocation obtenue
            // est inférieure à celle demandée (un autre projet a pris la place entre-temps), le
            // signale à l'appelant (SettingsView) pour avertir l'utilisatrice — setProjectReservation
            // a déjà borné correctement (jamais de pelotes inventées), ce n'est qu'un signal.
            manques = await reinjectYarnLinks(b.yarnLinks, b.project?.id, { collectShortfalls: true })
          } else if (TABLE[row.type]) {
            await db[TABLE[row.type]].put(row.payload)
          }
        }
        await db.trash.delete(Number(trashId))
        return manques
      },
    )
    await load()
    // La restauration vient de réécrire des laines en base (réinjection des réservations d'un
    // projet, ou remise en place d'une fiche laine) : si le stock est déjà chargé en mémoire, il
    // faut le rafraîchir, sinon il reste périmé (il ne se recharge pas tout seul — StashView ne
    // charge que si `loaded` est faux). MÊME raison que dans `projects.js` remove()/restore().
    // SettingsView le fait déjà de son côté ; le chemin « Annuler » de la snackbar
    // (`useSoftDelete`), lui, ne recharge que le magasin de l'entité supprimée — sur une
    // suppression de PROJET, personne ne rechargeait les laines et le stock affichait encore les
    // pelotes comme libres alors qu'elles venaient d'être re-réservées.
    await refreshYarnsIfLoaded()
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
  return { items, load, add, moveToTrash, restore, drop, empty }
})

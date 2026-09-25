// Stock de laines — CRUD local (PRD §7.3).
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, plain } from '@/db/db'
import { normalizeYarnReservations } from '@/utils/yarn-usage'
import { createLoadGuard } from '@/stores/load-guard'

export function emptyYarn() {
  return {
    brand: '',
    model: '', // modèle/qualité de la laine (ex. « Baby Merino ») — distinct de la marque (« Drops »)
    colorName: '',
    color: '', // couleur choisie sur la palette (chaîne hsl) — pour la vignette
    colorType: 'uni', // type de coloris : uni / degrade / auto-rayant / mouchete / teint-main — cf. YARN_COLOR_TYPES
    colorNotes: '', // couleurs en mots (pelote multicolore) — masqué en formulaire si colorType === 'uni'
    weight: '',
    lengthM: '',
    grams: '', // grammes par pelote (total affiché = quantity × grams)
    quantity: 1,
    price: '', // prix d'une pelote (pour le total dépensé)
    // `bain` / `purchasedAt` : champs devenus INERTES depuis les travaux sur le budget laine (01/08).
    // Le formulaire de laine ne les propose plus — une fiche peut désormais porter
    // PLUSIEURS achats, chacun avec son propre bain et sa propre date, tracés dans le
    // registre `src/stores/purchases.js` (source de vérité, y compris pour les fiches
    // antérieures : la reprise d'existant leur reconstruit une ligne à toutes). Conservés
    // ici uniquement pour ne pas changer la forme de l'objet en base sans y avoir été
    // invité — plus rien ne les lit ni ne les écrit activement côté application ; à retirer
    // explicitement si une passe de nettoyage future les juge inutiles.
    bain: '',
    purchasedAt: '',
    composition: [],
    compositionPercents: {}, // { matière: pourcentage }, cf. constants/compositions.js#normalizeCompositionPercents
    // Caractéristiques cochées (lot 05/08/2026) : clés parmi YARN_LABELS. Non indexé —
    // le filtre s'applique en mémoire, donc aucune montée de schéma Dexie n'est requise.
    labels: [],
    reservations: {}, // pool : { [projectId]: nb de pelotes prises par ce projet } (source de vérité)
    consumed: {}, // trace : { [projectId]: nb de pelotes réellement tricotées, déjà déduites de quantity }
    photos: [], // galerie (tableau de data URLs) — cf. src/utils/yarn-photos.js pour la
    // lecture tolérante de l'ancien champ `photo` (chaîne unique) des fiches antérieures
    // à cette refonte, jamais réécrites tant qu'elles ne sont pas modifiées.
    coverIndex: 0,
    notes: '', // texte libre, alimenté notamment par l'import Ravelry (Comments + annexes)
    storedIn: '', // lieu de rangement physique, alimenté notamment par « Stored in » (Ravelry)
  }
}

export const useYarnsStore = defineStore('yarns', () => {
  const yarns = ref([])
  const loaded = ref(false)

  // Jeton de rechargement (cf. `stores/load-guard.js`) : deux laines saisies d'affilée
  // lancent deux lectures de la table, et la plus ancienne ne doit jamais réassigner son
  // instantané par-dessus la plus récente, sous peine de faire disparaître de la liste une
  // fiche pourtant bien créée.
  const loadGuard = createLoadGuard()
  function load() {
    return loadGuard.run(async (isCurrent) => {
      const rows = await db.yarns.orderBy('id').reverse().toArray()
      if (!isCurrent()) return
      yarns.value = rows
      // Complément `consumed` (laine déjà au pool mais migrée avant l'ajout de ce champ) :
      // une seule fois par laine. La migration depuis l'ancien scalaire reservedFor/
      // reservedQty a été retirée (ménage pré-1.0, aucune laine réelle n'en porte plus).
      for (const y of rows) {
        if (!y.reservations || typeof y.reservations !== 'object') continue
        const patch = normalizeYarnReservations(y)
        if (!patch) continue
        await db.yarns.update(y.id, patch)
        Object.assign(y, patch)
      }
      loaded.value = true
    })
  }
  async function add(data) {
    // Retourne l'id : depuis les travaux sur le budget laine, StashView écrit la 1re ligne d'achat
    // juste après la création (`purchasesStore.add({ yarnId, ... })`) — sans cet id,
    // impossible de rattacher la ligne à la fiche qui vient de naître (même convention
    // que `patterns.js`).
    const id = await db.yarns.add({ ...emptyYarn(), ...plain(data) })
    await load()
    return id
  }
  async function update(id, data) {
    await db.yarns.update(Number(id), plain(data))
    await load()
  }
  async function remove(id) {
    const y = await db.yarns.get(Number(id))
    await db.yarns.delete(Number(id))
    await load()
    return y
  }
  async function restore(y) {
    await db.yarns.put(y)
    await load()
  }
  return { yarns, loaded, load, add, update, remove, restore }
})

// Recharge le stock SEULEMENT s'il est déjà chargé en mémoire — sinon aucun écran n'attend
// une mise à jour immédiate, un prochain montage de StashView le chargera lui-même. Centralise
// le motif répété après toute cascade qui modifie des laines en base sans passer par
// `useYarnsStore().update()` (projects.js remove()/restore(), trash.js restore()) : sans lui,
// le stock affiché resterait périmé (badge, quantités) jusqu'au prochain rechargement complet.
export async function refreshYarnsIfLoaded() {
  const yarnsStore = useYarnsStore()
  if (yarnsStore.loaded) await yarnsStore.load()
}

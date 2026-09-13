// LA FILE DES MESSAGES.
//
// CE N'EST PAS UN VERROU, et la différence n'est pas de forme. Un verrou refuserait la
// parole au perdant et l'oublierait. Deux conséquences mesurées le 19/08 l'interdisent :
//   • `versionGuard` et `folderGate` s'ouvrent ENSEMBLE aujourd'hui, et c'est voulu
//     (App.vue). Un verrou aurait renvoyé la porte du dossier à la session suivante —
//     l'application resterait sans dossier jusque-là.
//   • `syncReport` rend compte d'une écriture DÉJÀ faite. Un refus sans retour est une
//     perte d'information, contre la règle « jamais perdre d'info » du projet.
//
// Donc : le magasin tient l'ENSEMBLE des demandeurs, et `active` est CALCULÉ. Quand le
// plus fort se retire, `active` bascule tout seul sur le suivant et celui-ci apparaît.
// Aucun composant n'a à retenir un refus ni à réessayer.
import { defineStore } from 'pinia'
import { ref, computed, readonly } from 'vue'
import { NOTICE_RANKS } from '@/constants/notice-queue'

export const useNoticeQueueStore = defineStore('notice-queue', () => {
  // Tableau et non Set : la réactivité de Vue suit un tableau sans réserve, et l'ordre
  // d'insertion n'est jamais lu — seul le rang décide (cf. `active`).
  //
  // ⚠️ PRIVÉ, ET C'EST STRUCTUREL. Ce qui sort du magasin est la COPIE en lecture seule
  // ci-dessous. Un tableau exposé tel quel serait mutable par n'importe quel appelant, et
  // un identifiant inconnu poussé dedans échapperait au contrôle de `request()`. La
  // conséquence serait grave et muette : voir le commentaire d'`active`.
  const _requesters = ref([])

  // Le rang le plus PETIT gagne (1 = le plus fort). `null` si personne ne demande.
  //
  // ⚠️ LE FILTRE SUR LES IDENTIFIANTS CONNUS N'EST PAS DÉCORATIF. Sans lui, un identifiant
  // inconnu présent dans la liste casserait la comparaison en silence : `NOTICE_RANKS[id]`
  // vaut alors `undefined`, et toute comparaison avec `undefined` rend `false`. Si
  // l'inconnu arrivait EN PREMIER, il deviendrait `best` et plus aucun message réel ne
  // pourrait le déloger — l'application n'afficherait plus AUCUN message d'accueil, pour
  // le reste de la session, sans une erreur. Ce filtre rend la fonction totale quoi qu'il
  // arrive dans la liste.
  const active = computed(() => {
    let best = null
    for (const id of _requesters.value) {
      if (!Object.hasOwn(NOTICE_RANKS, id)) continue
      if (best === null || NOTICE_RANKS[id] < NOTICE_RANKS[best]) best = id
    }
    return best
  })

  // LÈVE sur un identifiant inconnu, à dessein. Un identifiant mal tapé donnerait un
  // message qui ne s'affiche JAMAIS, sans un mot — le défaut le plus coûteux de cette
  // famille, et le plus difficile à voir en revue. Les appelants passent tous par les
  // constantes de `@/constants/notice-queue`, donc ce cas ne se produit qu'en cas de bug.
  function request(id) {
    if (!Object.hasOwn(NOTICE_RANKS, id)) throw new Error(`notice-queue: identifiant inconnu « ${id} »`)
    if (!_requesters.value.includes(id)) _requesters.value.push(id)
  }

  // Idempotent et silencieux : un composant qui se démonte se retire sans avoir à savoir
  // s'il était demandeur.
  function withdraw(id) {
    const i = _requesters.value.indexOf(id)
    if (i !== -1) _requesters.value.splice(i, 1)
  }

  // Copie en lecture seule, pour les tests et le débogage. Écrire dedans ne change rien à
  // la file : c'est voulu — la seule façon d'entrer est `request()`, qui contrôle.
  //
  // ⚠️ `readonly(...)`, PAS UN SIMPLE `computed(() => [...])`, ET CE N'EST PAS DÉCORATIF.
  // Un `computed` met en CACHE le tableau qu'il retourne tant que `_requesters` ne change
  // pas : `store.requesters.push(...)` muterait ce tableau caché EN PLACE, et la lecture
  // SUIVANTE — avant toute nouvelle demande — renverrait le tableau pollué. La « copie » ne
  // protégerait alors plus rien. `readonly()` enveloppe la copie d'un proxy dont l'écriture
  // est refusée (silencieusement en production, avec un avertissement en développement) :
  // `push()` n'a aucun effet, dans un sens comme dans l'autre.
  // Ni `Object.freeze` (lèverait une exception sur `push()`, la file n'en a pas besoin pour
  // rester saine — juste un `push` sans effet) ni un accesseur `get` sur l'objet retourné
  // (Pinia l'évalue une seule fois à la création du magasin, via `Object.assign`, et fige le
  // résultat : les demandes suivantes ne se verraient plus).
  const requesters = computed(() => readonly([..._requesters.value]))

  return { requesters, active, request, withdraw }
})

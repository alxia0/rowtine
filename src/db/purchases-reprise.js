// src/db/purchases-reprise.js
// Reprise de l'existant (les travaux sur le budget, 31/07/2026) : les fiches de laine saisies
// AVANT cette date n'ont pas d'historique d'achat. On en reconstruit un, une seule fois.
//
// Pourquoi c'est possible : `consumeYarn` (utils/yarn-usage.js:112) déduit la
// consommation de `quantity` TOUT EN la traçant dans `consumed` — la quantité achetée
// d'origine est donc `quantity + Σ consumed`, pas une invention.
//
// RÉSERVE ASSUMÉE : si une quantité a été corrigée à la main
// (perte, don, erreur de saisie), la ligne reconstruite reflète la valeur corrigée et
// non ce qui a été payé. D'où `reconstructed: true`, affiché et modifiable ligne à ligne.
//
// DEUX GARDES, et pas une :
//   1. le drapeau `settings` — sans lui, supprimer ses lignes reconstruites les ferait
//      refabriquer au lancement suivant, en boucle : le geste de l'utilisateur serait
//      annulé pour toujours ;
//   2. la garde par laine (« a déjà une ligne ») — le drapeau vit dans `settings`, table
//      FUSIONNÉE et non remplacée à la restauration (backup/restore.js:172-176) ; cette
//      seconde garde rend une reprise re-jouée inoffensive au lieu de doubler l'historique.
import { db, getSetting, setSetting } from '@/db/db'
import { acquiredFromStock, emptyPurchase } from '@/utils/purchases'

export const REPRISE_FLAG = 'purchasesRepriseDone'

// Libellé figé : seule chose qui restera lisible quand la fiche aura disparu.
function labelOf(yarn) {
  return [yarn?.brand, yarn?.model, yarn?.colorName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ')
}

export function buildReconstructedPurchase(yarn, currency) {
  return {
    ...emptyPurchase(),
    yarnId: yarn.id,
    yarnLabel: labelOf(yarn),
    kind: 'buy',
    quantity: acquiredFromStock(yarn),
    // `yarn.price` peut être un nombre JS (fiche saisie après la normalisation du prix,
    // StashView.vue:save()) — la virgule française, pas le point, alimente ce champ partout
    // ailleurs (cf. YarnPurchases.vue `openEdit`, même parade).
    unitPrice: String(yarn.price ?? '').replace('.', ','),
    currency,
    date: String(yarn.purchasedAt ?? ''),
    bain: String(yarn.bain ?? ''),
    reconstructed: true,
  }
}

export async function runReprise(currency) {
  // Les trois lectures ne dépendent pas l'une de l'autre : en parallèle plutôt qu'enchaînées.
  const [yarns, trashRows, purchases] = await Promise.all([
    db.yarns.toArray(),
    db.trash.toArray(),
    db.purchases.toArray(),
  ])
  // Laines en corbeille (correctif final, arbitrage : « le cumul démarre sur ce qui
  // existe au jour de la mise à jour, corbeille comprise ») : une laine mise à la
  // corbeille ne vit plus que dans `db.trash` (objet complet dans `payload`) — sans ce
  // balayage, elle ne recevrait jamais de ligne, et le drapeau étant posé, la restaurer
  // plus tard lui donnerait une alerte d'écart permanente, sans rattrapage possible.
  // `yarnId` reste l'identifiant D'ORIGINE : `restore()` (stores/trash.js) remet la
  // fiche avec le MÊME id, le lien se rétablit donc tout seul.
  const trashedYarns = trashRows
    .filter((row) => row.type === 'yarn' && row.payload?.id != null)
    .map((row) => row.payload)
  const withLines = new Set(purchases.map((l) => l.yarnId))
  const rows = []
  for (const yarn of [...yarns, ...trashedYarns]) {
    if (withLines.has(yarn.id)) continue
    rows.push(buildReconstructedPurchase(yarn, currency))
    withLines.add(yarn.id) // garde anti-doublon tenue AUSSI entre les deux sources
  }
  // Écriture groupée plutôt qu'un `add` par laine — mais PAR TRANCHES, jamais en un seul
  // `bulkAdd(rows)`. `bulkAdd` ouvre UNE transaction Dexie pour tout ce qu'on lui donne
  // (dexie.js:1755, `_trans('readwrite', …)`) : si elle avorte — quota, base fermée en cours
  // de route — les lignes déjà écrites sont ANNULÉES avec elle. Or les deux appelants
  // documentent le contrat inverse, et leur rattrapage en dépend : « le drapeau reste absent,
  // l'`ensureReprise` du prochain lancement reconstruira ce qui n'a pas pu l'être ici »
  // (backup/restore.js) et « une reprise qui échoue en cours de route sera simplement rejouée
  // au lancement suivant » (App.vue). Rejouer ne rattrape quelque chose QUE si le travail
  // partiel a survécu : sinon le lancement suivant repropose le même lot entier et échoue à
  // l'identique — un budget qui reste à zéro pour toujours sur un appareil au stockage
  // saturé. L'ancienne boucle `add`, elle, commitait laine par laine et convergeait.
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.purchases.bulkAdd(rows.slice(i, i + CHUNK))
  }
  await setSetting(REPRISE_FLAG, true)
  return rows.length
}

export async function ensureReprise(currency) {
  if (await getSetting(REPRISE_FLAG)) return 0
  return runReprise(currency)
}

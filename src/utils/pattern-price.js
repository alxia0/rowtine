// src/utils/pattern-price.js
// Dépenses de PATRON (les travaux sur le prix du patron, 07/08). PUR : aucune dépendance à Dexie,
// Pinia ou Vue — pendant exact de src/utils/purchases.js, pour rester testable sans base et
// réutilisable par l'écran Dépenses et l'accueil sans les faire diverger.
//
// POURQUOI le prix vit sur le PATRON et non sur le projet (arbitrage retenu, 07/08) : un
// patron acheté 18 € et tricoté trois fois n'a coûté 18 €, pas 54 €. Le champ reste
// saisissable depuis le formulaire du projet, mais il écrit dans la fiche du patron.

import { parseDecimal } from '@/utils/decimal'

// Un patron de BIBLIOTHÈQUE : ni le gabarit « Patron libre » (builtin, UNIQUE et PARTAGÉ par
// tous les projets sans patron), ni une copie de travail (ownerProjectId, duplicata d'un
// patron déjà compté). Prédicat PARTAGÉ (exporté) — réutilisé par backup-manifest.js,
// restore-service.js, SafFolderSection.vue et patterns.js plutôt que retapé localement :
// on ne crée pas une deuxième idée de « vrai patron ».
export function isLibraryPattern(pattern) {
  return !!pattern && !pattern.builtin && pattern.ownerProjectId == null
}

// Le patron qui PORTE le prix, pour un patron donné. C'est lui qu'il faut écrire quand la
// saisie se fait depuis un projet.
//  - bibliothèque       -> lui-même
//  - copie de travail   -> son patron d'origine (`sourcePatternId`, posé par forkForProject —
//                          systématique depuis son introduction, cf. ménage pré-1.0)
//  - builtin            -> null : partagé, un prix dessus serait recompté par projet
export function priceOwnerId(pattern) {
  if (!pattern) return null
  if (isLibraryPattern(pattern)) return pattern.id ?? null
  if (pattern.builtin) return null
  return pattern.sourcePatternId
}

// Y a-t-il une dépense à afficher ? `'0'` compte : une dépense à zéro est une dépense
// DÉCLARÉE (« j'ai vérifié, c'est gratuit »), à ne pas confondre avec un champ vide
// (« je n'ai rien noté »). Les confondre, c'est perdre l'information.
export function isPricedPattern(pattern) {
  return isLibraryPattern(pattern) && !!String(pattern.price ?? '').trim()
}

// Une ligne de dépense, de la MÊME FORME qu'une ligne d'achat de laine (src/utils/purchases.js
// emptyPurchase) — c'est ce qui permet à groupByPeriod / totalsByCurrency / yearsOf /
// filterByYear de la traiter sans une ligne de code de plus.
//
// L'identifiant est une CHAÎNE préfixée : les lignes d'achat portent des nombres
// auto-incrémentés, la collision est donc impossible. Cf. le correctif de tri dans
// groupByPeriod (purchases.js) — une soustraction sur cette chaîne produirait `NaN`.
//
// Ni `yarnId` ni `yarnLabel` : ces deux noms disent « laine ». `yarnId` en particulier est
// PIÉGEUX — l'écran Dépenses affiche l'étiquette « Laine supprimée » sur `line.yarnId == null`,
// et `undefined == null` est VRAI en JavaScript : l'absence du champ ne protège de rien, seule
// la garde de catégorie le fait (cf. ExpensesView).
export function patternExpenseLine(pattern) {
  return {
    id: `pat:${pattern.id}`,
    category: 'pattern',
    patternId: pattern.id,
    label: pattern.name || '',
    kind: 'buy',
    quantity: 1,
    unitPrice: pattern.price,
    currency: pattern.priceCurrency || '',
    date: pattern.purchasedAt || '',
  }
}

export function patternExpenseLines(patterns) {
  return (patterns || []).filter(isPricedPattern).map(patternExpenseLine)
}

// L'état du prix d'un patron, pour les écrans qui l'AFFICHENT (fiche projet, fiche patron).
// PUR et sans i18n : cette fonction dit QUEL est l'état, chaque vue dit COMMENT elle l'écrit
// — c'est ce qui permet de la partager entre deux écrans qui ne formatent pas pareil.
//
// Trois états, comme la saisie : un montant, un « gratuit » DÉCLARÉ (`'0'` — « j'ai vérifié,
// c'était gratuit »), ou rien de noté (champ vide — « je n'ai rien noté »). Les deux derniers
// ne se confondent jamais : les mélanger perdrait l'information (cf. isPricedPattern).
//
// La devise rendue est celle DU PATRON, jamais celle du réglage global : un patron acheté en
// francs suisses reste en francs suisses dans une app réglée en euros (l'app ne convertit
// rien, nulle part).
export function patternPriceState(pattern) {
  const raw = String(pattern?.price ?? '').trim()
  if (!raw) return { kind: 'none' }
  const amount = parseDecimal(raw) || 0
  if (!amount) return { kind: 'free' }
  return { kind: 'amount', amount, currency: pattern?.priceCurrency || '' }
}

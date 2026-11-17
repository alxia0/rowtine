// src/db/price-currency-reprise.js
// Reprise de l'existant : jusqu'ici le prix d'une laine ou d'un outil était stocké SANS devise
// (celle des réglages s'appliquait implicitement). On pose maintenant la devise des réglages sur
// chaque fiche qui a un prix et pas de devise, corbeille comprise (le `payload` d'une fiche
// restaurée plus tard doit la porter aussi).
//
// Les patrons aussi : leur prix est estampillé à l'écriture depuis son introduction, mais un
// patron avec un prix mais sans devise s'affichait SANS symbole et formait un total à part dans les
// Dépenses. Seuls les patrons de bibliothèque portent un prix (une copie de travail n'en a pas,
// cf. forkForProject), le prédicat `needsCurrency` suffit donc à les trier.
//
// Pas de drapeau dans `settings` : idempotente par construction, puisqu'elle ne touche QUE les
// lignes sans devise. Un second appel ne trouve rien (rend 0) ; une restauration d'une
// sauvegarde ancienne la rejoue sans danger.
import { db } from '@/db/db'
import { hasPrice } from '@/utils/price-currency'

const needsCurrency = (row) => hasPrice(row?.price) && String(row?.priceCurrency ?? '').trim() === ''

async function fillTable(table, currency) {
  const rows = (await table.toArray()).filter(needsCurrency)
  for (const row of rows) {
    await table.update(row.id, { priceCurrency: currency })
  }
  return rows.length
}

export async function fillMissingPriceCurrency(currency) {
  let changed = await fillTable(db.yarns, currency)
  changed += await fillTable(db.tools, currency)
  // Un patron porte son PDF et sa galerie : on ne recharge pas toute la table en mémoire une
  // seconde fois (la Nexus 7 est lente), `modify` parcourt la table sans tout garder.
  changed += await db.patterns.filter(needsCurrency).modify({ priceCurrency: currency })
  // Même chose pour la corbeille : elle garde le payload COMPLET d'un patron supprimé, et cette
  // reprise sans drapeau tourne à chaque lancement (revue du 15/11).
  changed += await db.trash
    .where('type')
    .anyOf('yarn', 'tool', 'pattern')
    .filter((row) => needsCurrency(row.payload))
    .modify((row) => {
      row.payload = { ...row.payload, priceCurrency: currency }
    })
  return changed
}

// Étape de lancement (App.vue) : la reprise, puis le rechargement des stores si elle a changé
// quelque chose en base. Les stores ont été chargés AVANT elle et l'écran Dépenses ne recharge
// jamais un store déjà chargé : sans ce rechargement, la fiche reprise resterait sans devise à
// l'écran toute la session. Dans son propre try/catch muet : un échec ne doit rien empêcher
// d'autre, le lancement suivant rejouera (la reprise n'a pas de drapeau).
export async function runPriceCurrencyReprise(currency, { yarns, tools, patterns }) {
  try {
    const filled = await fillMissingPriceCurrency(currency)
    if (filled > 0) await Promise.all([yarns.load(), tools.load(), patterns.load()])
  } catch {
    // Rejouée au prochain lancement.
  }
}

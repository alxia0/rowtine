// Titre de couverture écrit LETTRE PAR LETTRE (« M I A C A R D I G A N »). Deux mises en
// page très différentes produisent cette forme :
//  - un TAMPON/logo de difficulté (Phildar « Q U A L I F I É E ») : ce n'est pas un titre ;
//  - le VRAI titre du patron, mis en valeur par un interlettrage typographique
//    (Coco Amour Knitwear, Mia Cardigan v1.1 : 28,1 pt, la plus grande ligne du PDF).
// Mesuré sur le PDF réel : pdf.js rend la ligne entière comme UN SEUL élément avec UN
// SEUL espace partout (« M I A C A R D I G A N », 11 lettres + 10 espaces). La coupure
// entre les mots N'EXISTE PAS dans le PDF — aucune géométrie ne peut la retrouver.
// Décoller seul donne « MIACARDIGAN ».
// D'où restoreWords() : on cherche la suite de lettres dans la fiche d'identité du PDF
// (doc.getMetadata().info.Title, ici « Microsoft Word - Mia Cardigan (English) v1.1.docx »)
// et on reprend SA découpe en mots. Rien n'est inventé : la fiche n'est acceptée que si
// les lettres correspondent EXACTEMENT.

// Même critère que l'ancien isSpacedStamp de segment.js (déplacé ici, source unique).
export function isLetterSpaced(text) {
  const toks = String(text ?? '').trim().split(/\s+/)
  const singles = toks.filter((t) => t.length === 1).length
  return toks.length >= 4 && singles >= 4 && singles / toks.length >= 0.6
}

export function despace(text) {
  return String(text ?? '').replace(/\s+/g, '')
}

// Ne garde que les lettres et les chiffres, en majuscules — sert de clé de comparaison.
function key(s) {
  return String(s ?? '').toUpperCase().replace(/[^0-9A-ZÀ-Ý]/g, '')
}

export function restoreWords(despaced, metaTitle) {
  const want = key(despaced)
  // Bornée : `metaTitle` vient de `doc.getMetadata().info.Title`, une chaîne ARBITRAIRE du
  // PDF de l'utilisatrice, pas un champ qu'on contrôle. La double boucle de tranches
  // ci-dessous, multipliée par `key()` qui rebalaie chaque tranche, est O(L³) — mesuré :
  // 2000 caractères → 1867 ms, appelée ~3× par import, de quoi geler un vieil appareil
  // plusieurs dizaines de secondes. Un vrai titre de fiche d'identité tient largement sous
  // 300 caractères (mesuré : 51 pour Mia Cardigan) ; au-delà, on renonce plutôt que de
  // risquer le gel — `restoreWords` rend déjà `null` sans correspondance, comportement
  // identique à un titre absent.
  const meta = String(metaTitle ?? '').slice(0, 300)
  if (!want || !meta) return null
  // Parcours de toutes les tranches de `meta` : on retient la première dont la clé vaut
  // exactement `want`. Coût négligeable (un titre de fiche d'identité est court).
  for (let i = 0; i < meta.length; i++) {
    for (let j = meta.length; j > i; j--) {
      const slice = meta.slice(i, j)
      if (key(slice) !== want) continue
      const trimmed = slice.trim()
      // La tranche doit commencer et finir sur une lettre ou un chiffre : sinon on
      // rapporterait la ponctuation voisine (« - Mia Cardigan (»).
      if (!/^[0-9A-Za-zÀ-ÿ]/.test(trimmed) || !/[0-9A-Za-zÀ-ÿ]$/.test(trimmed)) continue
      return trimmed
    }
  }
  return null
}

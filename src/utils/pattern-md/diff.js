// Similarité ligne à ligne (LCS) entre deux MD : métrique de fidélité du banc
// corpus (MD produit vs MD corrigé = vérité terrain). Pur, O(n·m) — patrons < 1k lignes.
function toLines(md) {
  return String(md ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
}

export function mdSimilarity(mdA, mdB) {
  const a = toLines(mdA)
  const b = toLines(mdB)
  if (!a.length && !b.length) return { ratio: 1, missing: 0, extra: 0 }
  const dp = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const lcs = dp[a.length][b.length]
  const ratio = (2 * lcs) / (a.length + b.length)
  return { ratio: Math.round(ratio * 1e5) / 1e5, missing: b.length - lcs, extra: a.length - lcs }
}

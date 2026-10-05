// Import d'une partie seulement d'un PDF (spec 2026-10-04, choix des pages) : l'utilisatrice
// coche des pages, numérotées comme dans le PDF complet. Le cœur pur de l'import indexe les
// pages par leur position dans le tableau `pages` : on lui présente un document réduit
// numéroté 1..k, puis on rend leurs vrais numéros aux images de la galerie, car le PDF
// enregistré reste le fichier complet.

export function normalizePageSelection(pages) {
  if (!Array.isArray(pages)) return []
  const ok = pages.filter((n) => Number.isInteger(n) && n >= 1)
  return [...new Set(ok)].sort((a, b) => a - b)
}

export function togglePage(selected, n) {
  const list = Array.isArray(selected) ? selected : []
  return list.includes(n) ? list.filter((p) => p !== n) : normalizePageSelection([...list, n])
}

export function toSubsetPages(items, pageNumbers) {
  if (!pageNumbers?.length) return items
  const pos = new Map(pageNumbers.map((p, i) => [p, i + 1]))
  return items.filter((it) => pos.has(it.page)).map((it) => ({ ...it, page: pos.get(it.page) }))
}

export function toRealPages(items, pageNumbers) {
  if (!pageNumbers?.length) return items
  return items.map((it) => (it.page ? { ...it, page: pageNumbers[it.page - 1] ?? it.page } : it))
}

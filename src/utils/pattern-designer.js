// Designer du patron : nettoyage de la saisie et ligne « Patron » du badge (spec 2026-10-03).
// Pur JS, sans alias `@/` : réutilisable hors contexte Vite.

export function cleanDesignerName(raw) {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim()
}

// Ligne affichée sous le titre du badge : « Nom du patron, par Designer », ou le nom seul.
// Le patron libre (builtin) n'est pas un vrai patron : aucune ligne.
export function patternBadgeLine(pattern, t, locale) {
  if (!pattern || pattern.builtin) return ''
  const name = cleanDesignerName(pattern.name)
  if (!name) return ''
  const author = cleanDesignerName(pattern.author)
  if (!author) return name
  return t('project.patternWithDesigner', { name, author }, { locale })
}

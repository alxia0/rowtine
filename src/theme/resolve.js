// Résolution pure du réglage de thème vers un rendu effectif. Aucun effet de bord.
export const THEMES = ['system', 'light', 'dark']

export function prefersDark() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

// setting: 'system' | 'light' | 'dark'. Toute autre valeur est traitée comme 'system'
// (tolérant : une base corrompue ou un futur état inconnu ne casse pas le rendu).
export function resolveEffective(setting, isDark = prefersDark()) {
  if (setting === 'light') return 'light'
  if (setting === 'dark') return 'dark'
  return isDark ? 'dark' : 'light'
}

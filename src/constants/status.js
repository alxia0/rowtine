// Les 6 statuts de projet (PRD §7.2/§7.4). Ordre = ordre d'affichage sur l'Accueil.
export const STATUS_ORDER = ['waiting', 'wip', 'pause', 'done', 'future', 'abandoned']

export const STATUS_META = {
  waiting: { labelKey: 'status.waiting', color: 'var(--slate)' },
  wip: { labelKey: 'status.wip', color: 'var(--brand)' },
  // --mustard en texte sur --bg = 1,79:1, illisible ; --mustard-deep
  // (5,48:1 en clair, pire cas 5,45:1 sur les 360° de teinte d'accent) passe en gardant la
  // famille ambre. En sombre --mustard-deep vaut --mustard (10,23:1, déjà conforme).
  pause: { labelKey: 'status.pause', color: 'var(--mustard-deep)' },
  // --sage en texte sur --bg = 4,43:1, sous AA (4,5:1) ; --sage-deep (4,76:1 en clair, pire cas 4,74:1 sur les 360° de teinte d'accent,
  // déjà utilisé par .tag--used des cartes laine) passe en gardant la famille verte.
  // En sombre --sage-deep vaut --sage (déjà conforme) : zéro changement visuel là.
  done: { labelKey: 'status.done', color: 'var(--sage-deep)' },
  future: { labelKey: 'status.future', color: 'var(--ink-55)' },
  // --ink-40 (2,34:1) échoue le contraste texte ; --ink-55 (5,85:1) passe et reste discret.
  abandoned: { labelKey: 'status.abandoned', color: 'var(--ink-55)' },
}

export const TECHNIQUES = ['knitting', 'crochet']

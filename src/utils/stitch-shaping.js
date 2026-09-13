// Calcul du façonnage (augmentations / diminutions) du calculateur de mailles.
// Fonctions PURES : ce module rend des nombres, la vue les met en mots dans les
// quatre langues. Aucune dépendance à Vue ni à i18n, pour que le calcul soit
// vérifiable sans monter d'écran.
//
// CONVENTION (héritée du mode « répartition » d'origine, à ne pas changer) :
// chaque changement CLÔT son intervalle. La somme des intervalles vaut donc
// exactement le nombre de rangs, et le dernier changement tombe sur le dernier
// rang. C'est cette convention — et non un choix d'affichage — qui impose
// `rangs = fois × cadence` au sens inverse, et qui rend les deux sens
// réciproques (cf. l'essai d'aller-retour dans tests/unit/stitch-shaping.spec.js).

// Un « compte » valide : entier, au moins 1. Les saisies décimales (« 2,5 »,
// « 2.5 ») sont REFUSÉES, pas arrondies — arrondir en silence donnerait un
// nombre de rangs faux sans que personne ne le voie.
const isCount = (v) => Number.isInteger(v) && v >= 1

// Les champs de saisie rendent des chaînes ; on les normalise ici plutôt que
// dans la vue, pour que la règle de validation vive à un seul endroit.
function toCount(value) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string' || value.trim() === '') return NaN
  return Number(value.trim())
}

// Combien de mailles il faut gagner (ou perdre). Le MODE choisi pilote le sens
// du calcul, pas l'ordre des valeurs saisies.
export function changesFor({ mode, current, target }) {
  if (!isCount(current) || !isCount(target)) return { status: 'invalid', changes: 0 }
  const changes = mode === 'inc' ? target - current : current - target
  if (changes < 0) return { status: 'mismatch', changes }
  if (changes === 0) return { status: 'noChange', changes: 0 }
  return { status: 'ok', changes }
}

// Répartir `occurrences` changements sur `rows` rangs, aussi régulièrement que
// possible : (occurrences − reste) intervalles de `base` rangs, et `reste`
// intervalles de `base + 1`.
export function distributeOverRows({ occurrences, rows }) {
  if (!isCount(occurrences) || !isCount(rows)) return null
  if (rows < occurrences) return { dense: true, perRow: Math.ceil(occurrences / rows) }
  const base = Math.floor(rows / occurrences)
  const rem = rows % occurrences
  return { dense: false, base, a: occurrences - rem, b: rem }
}

// Le sens inverse : combien de rangs pour `occurrences` changements à cette cadence.
export function rowsForCadence({ occurrences, cadence }) {
  if (!isCount(occurrences) || !isCount(cadence)) return null
  return occurrences * cadence
}

// Orchestration. Rend une forme unique et explicite, que la vue n'a plus qu'à
// habiller :
//   { kind: 'incomplete' }                       — saisie insuffisante ou invalide
//   { kind: 'mismatch' } / { kind: 'noChange' }
//   { kind: 'rows',   changes, exact, options: [{ occurrences, stitches, delta, perTime, dense, perRow?, base?, a?, b? }] }
//   { kind: 'length', changes, exact, options: [{ occurrences, stitches, delta, perTime, rows, cadence }] }
// `options` compte UN élément quand la cible tombe pile, DEUX sinon (les deux
// propositions qui l'encadrent), et un seul si la proposition basse reviendrait
// à ne rien changer du tout.
export function computeShaping({ mode = 'inc', solveFor = 'rows', current, target, perTime, rows, cadence } = {}) {
  const c = toCount(current)
  const t = toCount(target)
  // Champ vide = le défaut, 1 maille à chaque fois : c'est l'usage courant.
  const s = perTime === '' || perTime === undefined || perTime === null ? 1 : toCount(perTime)
  if (!isCount(s)) return { kind: 'incomplete' }

  const base = changesFor({ mode, current: c, target: t })
  if (base.status === 'invalid') return { kind: 'incomplete' }
  if (base.status === 'mismatch') return { kind: 'mismatch' }
  if (base.status === 'noChange') return { kind: 'noChange' }
  const changes = base.changes

  // Combien de FOIS on augmente/diminue. En pas de `s` mailles, la cible n'est
  // pas toujours atteignable pile : on garde alors les deux candidats qui
  // l'encadrent, jamais un arrondi silencieux.
  const exact = changes % s === 0
  const low = Math.floor(changes / s)
  const stitchesFor = (k) => (mode === 'inc' ? c + k * s : c - k * s)
  // Un nombre de mailles ne descend jamais sous 1 : en diminutions, la
  // proposition haute (low + 1) peut passer sous la cible et même sous zéro
  // (ex. 5 → 1, 3 mailles à chaque fois : « 2 fois » donnerait -1 maille).
  // Seuil à 1 et non 0 : à 0 maille, l'ouvrage n'existe plus, ce n'est pas
  // une proposition valable non plus.
  let candidates = (exact ? [low] : [low, low + 1]).filter((k) => k >= 1 && stitchesFor(k) >= 1)
  // Cas extrême : en diminutions, quand `perTime` mailles valent au moins
  // `current` mailles (ex. 5 mailles actuelles, 5 à chaque fois), la SEULE
  // occurrence non nulle passerait sous 1 maille — le filtre ci-dessus vide
  // alors complètement la liste. On retombe sur « 0 fois » (rien ne change) :
  // c'est la seule proposition qui reste valable, jamais un écran vide.
  if (candidates.length === 0) candidates = [0]

  const outcome = (k) => {
    const stitches = stitchesFor(k)
    return { occurrences: k, stitches, delta: stitches - t, perTime: s }
  }

  if (solveFor === 'length') {
    const x = toCount(cadence)
    if (!isCount(x)) return { kind: 'incomplete' }
    return {
      kind: 'length',
      changes,
      exact,
      // rowsForCadence rejette 0 occurrence (isCount exige ≥ 1, la règle
      // habituelle) : ici 0 fois signifie justement « rien ne change », donc
      // 0 rang, un cas explicite plutôt que de laisser passer `null`.
      options: candidates.map((k) => ({ ...outcome(k), rows: k === 0 ? 0 : rowsForCadence({ occurrences: k, cadence: x }), cadence: x })),
    }
  }

  const r = toCount(rows)
  if (!isCount(r)) return { kind: 'incomplete' }
  return {
    kind: 'rows',
    changes,
    exact,
    options: candidates.map((k) => ({ ...outcome(k), ...distributeOverRows({ occurrences: k, rows: r }) })),
  }
}

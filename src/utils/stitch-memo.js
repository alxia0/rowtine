// Ajoute le mémo des techniques de points à l'aide-mémoire AFFICHÉ d'un patron. Fonction
// pure : la référence du patron (donnée stockée, source des infobulles d'abréviation) n'est
// jamais modifiée, le mémo se calcule à chaque affichage depuis `pattern.stitchPins`.
// Zéro dépendance, pas d'i18n (même doctrine que reader-reference.js) : libellés réservés
// portés par des clés, traduits à l'affichage.
export const STITCH_MEMO_TAB = 'stitches'
export const PICK_STITCHES_EVENT = 'pick-stitches'

const LABEL = 'Mémo : techniques de points'

export function withStitchMemo(reference, stitches = []) {
  const base = reference || {}
  const blocks = stitches.map((f) => ({
    h3: f.name,
    muted: f.abbr?.length ? [f.abbr.join(', ')] : [],
    steps: f.steps || [],
    ...(f.tip ? { tip: f.tip } : {}),
  }))
  // Sans fiche : l'explication puis « Choisir les points ». Avec des fiches : « Modifier les
  // points » EN TÊTE, sinon le bouton finit sous toutes les fiches et la sélection paraît figée.
  if (blocks.length) blocks.unshift({ action: { event: PICK_STITCHES_EVENT, labelKey: 'stitchMemo.edit' } })
  else blocks.push({ mutedKey: 'stitchMemo.empty' }, { action: { event: PICK_STITCHES_EVENT, labelKey: 'stitchMemo.pick' } })
  return {
    ...base,
    abbr: base.abbr || {},
    abbrFull: base.abbrFull || [],
    tabs: [...(base.tabs || []), { id: STITCH_MEMO_TAB, label: LABEL, labelKey: 'reader.reference.stitches.label', blocks }],
    tiles: [
      ...(base.tiles || []),
      {
        tab: STITCH_MEMO_TAB,
        title: LABEL,
        titleKey: 'reader.reference.stitches.label',
        sub: '',
        feature: true,
        subKey: stitches.length ? 'reader.reference.stitches.sub' : 'reader.reference.stitches.subEmpty',
      },
    ],
  }
}

// Caractéristiques d'une laine (lot du 05/08/2026). Deux groupes de NATURE différente :
// des déclarations du fabricant d'un côté, des certifications vérifiables de l'autre.
// La distinction est visible dans le formulaire — sans elle, « Recyclée » et « Recyclé
// certifié (GRS) » passeraient pour un doublon.
export const LABEL_GROUPS = {
  engagements: ['vegan', 'recyclee', 'ethique', 'sans-mulesing'],
  certifications: ['oeko-tex', 'gots', 'rws', 'grs'],
}

export const YARN_LABELS = [...LABEL_GROUPS.engagements, ...LABEL_GROUPS.certifications]

// Seuls les engagements sont rappelés par une icône dans la carte de laine : quatre sigles
// administratifs dessinés au trait à 16 px donneraient quatre carrés indiscernables.
export const ENGAGEMENTS = LABEL_GROUPS.engagements

// Normalise en tableau, sur le modèle de `normalizeComposition` (constants/compositions.js) :
// accepte null/''/tableau, trim, dédoublonne dans l'ordre d'apparition. La tolérance à
// l'ancienne saisie en chaîne a été retirée le 13/08/2026 (ménage pré-1.0, réserve produit acceptée)
// — plus aucun producteur, plus aucune fiche laine en base ne la porte.
// ⚠️ ÉCARTE en plus toute clé hors des huit : `AppIcon` retombe sur `pelote` pour un nom
// inconnu, donc une sauvegarde éditée à la main afficherait une pelote par valeur parasite.
export function normalizeLabels(value) {
  const list = Array.isArray(value) ? value : []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const key = String(raw).trim().toLowerCase()
    if (!key || seen.has(key) || !YARN_LABELS.includes(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

// Ordre canonique d'affichage des caractéristiques cochées d'une laine — normalise
// (normalizeLabels) puis trie selon YARN_LABELS. Un SEUL endroit qui décide de l'ordre,
// utilisé par les trois écrans qui affichent des caractéristiques (fiche détaillée, carte
// du stock, export tableur) : avant ce helper, l'export rendait dans l'ordre où
// l'utilisatrice avait coché les cases plutôt que dans l'ordre canonique — mesuré, pour
// `labels: ['gots', 'vegan']`, la fiche affichait « Vegan, Fibres biologiques (GOTS) »
// pendant que l'export sortait « Fibres biologiques (GOTS), Vegan » (revue du
// 06/08/2026).
export function orderedLabels(value) {
  const present = normalizeLabels(value)
  return YARN_LABELS.filter((k) => present.includes(k))
}

// Correspondance engagement → clé du registre d'icônes (utils/icons.js). Les certifications
// n'en ont pas : elles ne remontent pas dans la carte de laine.
export const LABEL_ICONS = {
  vegan: 'labelVegan',
  recyclee: 'labelRecycle',
  ethique: 'labelEthique',
  'sans-mulesing': 'labelMouton',
}

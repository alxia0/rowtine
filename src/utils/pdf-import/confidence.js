// Score composite. Seuils calibrés sur le corpus réel.
// Garde-fou : sans AUCUNE ligne structurée, le niveau est « low » quel que soit
// le score (un PDF vide ou en pur texte libre ne doit pas inspirer confiance).
//
// [Arbitrage 04/09/2026 — limite assumée pour la 1.0, à re-visiter post-1.0 avec les
// chantiers A5/A9 : la confiance reste AVEUGLE à la couverture du texte source.]
// Toutes les fractions ci-dessous sont calculées sur ce qui a SURVÉCU au filtrage :
// une perte massive en amont (sections jetées vides, lignes consommées, boilerplate)
// n'entame jamais le score (témoin fondateur : Mountaintop-Pullover, 84 affiché pour
// une rétention 0,602 — vague 2). Le signal « numéros de rang non consécutifs » a été
// ÉCARTÉ par la mesure du 04/09 (120 PDF des vagues 1-7 : 22 signaux, 0 vrai trou,
// 20 faux positifs structurels — instructions groupées, colonnes interfolées, pertes
// par section entière) ; la piste crédible est la COUVERTURE du texte source, dont le
// chantier (dénominateur propre + calibration sur la rétention du banc) est reporté
// post-1.0. Détail : étude reproductible dans
// tools/corpus/measure/proto-row-gaps*.mjs.
export function computeConfidence({ stats, warnings = [] }) {
  const s = stats || {}
  const secScore = s.sectionsTotal ? s.sectionsKnown / s.sectionsTotal : 0
  const stepScore = s.totalLines ? s.structuredLines / s.totalLines : 0
  const vecScore = s.vectorsSeen ? s.vectorsOk / s.vectorsSeen : 1
  const validScore = Math.max(0, 1 - warnings.length / 10)
  const global = Math.round(100 * (0.3 * secScore + 0.3 * stepScore + 0.2 * vecScore + 0.2 * validScore))
  const level = stepScore === 0 ? 'low' : global >= 70 ? 'high' : global >= 40 ? 'medium' : 'low'
  return { global, level, bySection: s.bySection || {} }
}

// Textes des tuiles de la fiche projet (onglet Détails). Module PUR : la langue et `t` sont
// des paramètres, pour tester sans monter la vue.
import { formatDecimalText } from '@/utils/decimal'

// Liste d'aiguilles : nouveau format needles[] ; repli sur les scalaires hérités si le projet
// n'a pas encore été migré. Seules les entrées renseignées sont gardées. Le diamètre suit le
// séparateur décimal de la langue (intent du 28/09), la taille US reste telle que saisie.
export function needleTexts(project, locale) {
  if (!project) return []
  const raw = Array.isArray(project.needles)
    ? project.needles
    : [{ mm: project.needleMm || '', us: project.needleUs || '' }]
  return raw
    .map((n) => {
      const mm = formatDecimalText(n.mm, locale)
      return [mm && `${mm} mm`, String(n.us ?? '').trim()].filter(Boolean).join(' · ')
    })
    .filter(Boolean)
}

// Échantillon « 20 m × 26 rg » : unités traduites (intent du 28/09, elles étaient en français
// dans toutes les langues), nombres au séparateur décimal de la langue. Un seul champ
// renseigné donne un seul terme, sans « × » orphelin.
export function gaugeText(project, t, locale) {
  const st = formatDecimalText(project?.gaugeStitches, locale)
  const rg = formatDecimalText(project?.gaugeRows, locale)
  return [st && t('project.gaugeStitchesValue', { n: st }), rg && t('project.gaugeRowsValue', { n: rg })]
    .filter(Boolean)
    .join(' × ')
}

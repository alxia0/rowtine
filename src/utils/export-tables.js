// Tables d'export tableur (CSV) des projets et des patrons — extraites de SettingsView.vue
// (revue du passage multilingue, 29/07).
//
// POURQUOI EXTRAIRE : écrites en ligne dans la vue, ces deux tables étaient hors de portée
// d'un test de module. 19 clés de traduction que rien ne vérifiait : une clé mal orthographiée
// ne se voit pas à la relecture et sort le CHEMIN DE CLÉ BRUT en en-tête de colonne du fichier
// tableur, chez l'utilisatrice, sans qu'aucun test ne bronche. La troisième table du même
// écran (`yarnExportTable`) était déjà extraite et testée : ces deux-ci s'alignent sur ce
// modèle. (`yarnExportTable` reste dans `yarn-filter.js` par histoire, aux côtés des autres
// fonctions pures du stock, plutôt que de subir un déplacement sans bénéfice.)
//
// Même contrat que `yarnExportTable` : fonctions PURES qui reçoivent `t` en paramètre plutôt
// que d'appeler `useI18n()` elles-mêmes — c'est ce qui les rend testables hors composant, et
// ce qui garantit que les en-têtes suivent la langue réelle de l'utilisatrice (les 4 langues,
// pas un booléen figé sur deux d'entre elles).
//
// Elles renvoient { head, rows } et ne touchent NI au fichier NI au store : la vue garde la
// lecture du store, le nommage du fichier et le téléchargement.
import { patternCategoryLabel } from '@/constants/catalog'
import { patternToReader } from '@/utils/reader'

// Projets → 12 colonnes. `head` et `rows` sont écrits l'un sous l'autre, dans le même ordre :
// tout ajout de colonne d'un seul côté décale la ligne et doit faire rougir le test de
// longueur (règle « jamais perdre d'info » du projet).
export function projectExportTable(projects, { t } = {}) {
  const head = [
    t('settings.export.project.name'), t('settings.export.project.craft'), t('settings.export.project.status'),
    t('settings.export.project.sizes'), t('settings.export.project.activeSize'), t('settings.export.project.needlesMm'),
    t('settings.export.project.needlesUs'), t('settings.export.project.gaugeStitches'), t('settings.export.project.gaugeRows'),
    t('settings.export.project.start'), t('settings.export.project.end'), t('settings.export.project.rating'),
  ]
  const rows = (projects || []).map((p) => {
    // Liste d'aiguilles (repli scalaires pour un projet non migré) → colonnes mm / US.
    const nds = Array.isArray(p.needles) ? p.needles : [{ mm: p.needleMm, us: p.needleUs }]
    const nmm = nds.map((n) => n.mm).filter(Boolean).join(' / ')
    const nus = nds.map((n) => n.us).filter(Boolean).join(' / ')
    return [
      p.name, t(`technique.${p.technique}`), t(`status.${p.status}`), (p.sizes || []).join(', '), p.activeSize,
      nmm, nus, p.gaugeStitches, p.gaugeRows, p.startedAt, p.finishedAt, p.stars,
    ]
  })
  return { head, rows }
}

// Patrons de la bibliothèque → 7 colonnes.
export function patternExportTable(patterns, { t } = {}) {
  const head = [
    t('settings.export.pattern.name'), t('settings.export.pattern.type'), t('settings.export.pattern.category'),
    t('settings.export.pattern.author'), t('settings.export.pattern.sizes'), t('settings.export.pattern.source'),
    t('settings.export.pattern.sections'),
  ]
  const rows = (patterns || []).map((p) => [
    p.name, t(`technique.${p.type}`), patternCategoryLabel(p, t), p.author, (p.sizes || []).join(', '), p.source, patternToReader(p).sections.length,
  ])
  return { head, rows }
}

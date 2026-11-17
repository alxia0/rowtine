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
import { formatDecimalText } from '@/utils/decimal'
import { hasPrice } from '@/utils/price-currency'
import { TOOL_TYPES } from '@/constants/tools'
import { toolSizes, cableCounts, cableCountLabel, toolSizeParts } from '@/utils/tool-list'

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

// Stock d'outils -> 21 colonnes (lot 1 de la phase 2, 14/11/2026). Aucun champ de la fiche
// n'est omis. Les valeurs à clé (catégorie, type, matière, manche, état, longueur nommée,
// crochet tunisien) sortent traduites, jamais la clé brute ; l'équivalent US ou lettre est
// calculé comme sur la fiche, jamais stocké. Prix sans symbole, devise en code dans sa colonne.
export function toolExportTable(tools, { t, locale } = {}) {
  const cols = [
    'category', 'type', 'sizeMm', 'equivalent', 'length', 'dpnCount', 'tunisianKind', 'material', 'handle',
    'brand', 'line', 'quantity', 'status', 'price', 'currency', 'purchasedAt', 'shop', 'storedIn',
    'kitSizes', 'kitCables', 'notes',
  ]
  const head = cols.map((c) => t(`settings.export.tool.${c}`))
  const num = (n) => formatDecimalText(String(n), locale)
  const has = (v) => v != null && v !== ''
  const joined = (list) => list.map(num).join(' / ')
  const rows = (tools || []).map((x) => {
    const isKit = TOOL_TYPES[x.type]?.size === 'kit'
    const size = isKit ? null : toolSizes(x)[0] ?? null
    const us = size == null ? null : toolSizeParts(x, size).us
    const length = has(x.lengthCm) ? num(x.lengthCm) : x.lengthKind ? t(`tools.lengthKinds.${x.lengthKind}`) : ''
    const priced = hasPrice(x.price)
    return [
      x.category ? t(`tools.categories.${x.category}`) : '',
      x.type ? t(`tools.types.${x.type}`) : '',
      size == null ? '' : num(size),
      has(us) ? String(us) : '',
      length,
      has(x.dpnCount) ? num(x.dpnCount) : '',
      x.tunisianKind ? t(`tools.tunisianKinds.${x.tunisianKind}`) : x.tunisian ? t('tools.tunisianKinds.interchangeable') : '',
      x.material ? t(`tools.materials.${x.material}`) : '',
      x.handle ? t(`tools.handles.${x.handle}`) : '',
      x.brand || '',
      x.line || '',
      has(x.quantity) ? num(x.quantity) : '',
      t(`tools.statuses.${x.status || 'available'}`),
      priced ? num(x.price) : '',
      priced ? x.priceCurrency || '' : '',
      x.purchasedAt || '',
      x.shop || '',
      x.storedIn || '',
      joined(isKit ? toolSizes(x) : []),
      cableCounts(x).map(({ cm, join, count }) => cableCountLabel({ cm, join }, count, t, num)).join(' ; '),
      x.notes || '',
    ]
  })
  return { head, rows }
}

// Promotion des grilles importées en diagrammes INTERACTIFS (décision produit du
// 2026-07-14 : TOUTES les grilles suivables, pas seulement la première). Chaque région
// vectorielle `kind:'grid'` devient sa PROPRE section `diagramme` suivable rang-par-rang
// (modèle « 1 grille = 1 section {chart} » du sous-projet A → réutilise le keying par
// `section.id` de la re-synchro, INCHANGÉ). Les `kind:'reference'` (schémas de
// mesures, légendes) NE sont PAS promues (restent des images). Pur, sans IO.
//
// ⚠️ Unicité des `section.id` : l'état par grille (`chartRows`/`chartReps`/`chartFrames`)
// et `reconcileReaderState` sont keyés par `section.id`. Deux grilles au même id
// contamineraient leur suivi mutuel. On assigne aux sections-diagrammes des ids
// `slug(titre)` DÉDUPLIQUÉS contre les ids existants — SANS re-normaliser les sections
// d'origine (qui portent déjà `step.imgs` etc. : un re-passage de normalizeReaderForSave
// risquerait de les altérer).
import { buildTitleEvents, activeSectionIndex } from './associate'
import { slug } from '../reader'

// Forme d'une section-diagramme, identique à ce que produit le parseur MD pour une image
// nue en section {chart} (cf. pattern-md/parse.js) : `rows:0` = rangs inconnus (une vraie
// grille a toujours ≥1 rang → 0 est un sentinel non ambigu « à renseigner », géré au rendu).
function gridSection(id, title, img) {
  return {
    id,
    kind: 'diagramme',
    title,
    steps: [{ chart: true }],
    chart: { rows: 0, cols: 0, img, repeat: '', readDir: '', builtinLegend: false },
  }
}

// Insère une section-diagramme par région `kind:'grid'`, en ordre de lecture (page, y),
// après la section géométriquement active à la position de la grille (repli : fin du patron
// si indéterminable). Ids uniques dédupliqués. Renvoie un NOUVEAU reader (sections d'origine
// intactes, référence conservée s'il n'y a aucune grille).
export function promoteGridSections(reader, gridRegions, pages) {
  const secs = Array.isArray(reader?.sections) ? reader.sections : []
  const grids = (Array.isArray(gridRegions) ? gridRegions : []).filter(
    (r) => r && r.kind === 'grid' && r.src,
  )
  if (!grids.length) return reader

  // Ordre de lecture des grilles : page croissante, puis haut→bas (y décroissant).
  const ordered = [...grids].sort((a, b) => (a.page || 0) - (b.page || 0) || (b.y ?? 0) - (a.y ?? 0))

  const used = new Set(secs.map((s) => s && s.id).filter(Boolean))
  const titleEvents = buildTitleEvents(secs, Array.isArray(pages) ? pages : [])

  const inserts = ordered.map((r, i) => {
    const title = `Diagramme ${i + 1}`
    let id = slug(title) || `diagramme-${i + 1}`
    while (used.has(id)) id = `${id}-${i + 1}` // seconde ceinture : jamais deux ids identiques
    used.add(id)
    return {
      afterIdx: activeSectionIndex(titleEvents, (r.page || 1) - 1, r.y ?? 0),
      section: gridSection(id, title, r.src),
    }
  })

  // Reconstruction : chaque section d'origine, suivie des grilles qui lui sont ancrées (ordre
  // de lecture) ; les grilles sans ancre (afterIdx null) vont à la fin. Sections d'origine intactes.
  const out = []
  secs.forEach((sec, idx) => {
    out.push(sec)
    for (const ins of inserts) if (ins.afterIdx === idx) out.push(ins.section)
  })
  for (const ins of inserts) if (ins.afterIdx == null) out.push(ins.section)

  return { ...reader, sections: out }
}

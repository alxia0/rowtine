// Transforms PURS de correction post-import « par bloc ».
// Aucune IO, aucune dépendance UI. Chaque transform clone défensivement le
// reader d'entrée (JAMAIS muté) et renvoie un NOUVEAU reader.
import { isKind, DEFAULT_KIND } from './section-kinds'
import { slug } from './reader'

function clone(reader) {
  return JSON.parse(JSON.stringify(reader))
}

function findSection(reader, sectionId) {
  return (reader?.sections || []).find((s) => s && s.id === sectionId) || null
}

// Une section est « un diagramme » ssi elle porte un step {chart:true} ET un
// objet section.chart (cf. gridSection dans pdf-import/promote-grids.js).
export function sectionIsChart(section) {
  return !!(section?.steps || []).some((s) => s && s.chart) && !!section?.chart
}

// 1re image trouvée sur la section : chart.img (diagramme) sinon 1re image
// ancrée dans un step ({ imgs: [src, ...] }).
export function sectionImageSrc(section) {
  if (section?.chart?.img) return section.chart.img
  for (const step of section?.steps || []) {
    const src = step?.imgs?.[0]
    if (src) return src
  }
  return null
}

export function sectionCanPromote(section) {
  return !sectionIsChart(section) && !!sectionImageSrc(section)
}

export function sectionCanDemote(section) {
  return sectionIsChart(section)
}

// Remplace section.kind si `kind` est un SECTION_KINDS connu ; sinon reader inchangé.
export function setSectionKind(reader, sectionId, kind) {
  if (!isKind(kind)) return reader
  const out = clone(reader)
  const sec = findSection(out, sectionId)
  if (!sec) return reader
  sec.kind = kind
  return out
}

// Section-diagramme → image simple. L'image de chart.img est CONSERVÉE dans
// un step { imgs: [img] } qui remplace le(s) step(s) { chart:true }.
// No-op si la section n'existe pas ou n'est pas un diagramme.
export function demoteChartToImage(reader, sectionId) {
  const src = findSection(reader, sectionId)
  if (!src || !sectionIsChart(src)) return reader
  const out = clone(reader)
  const sec = findSection(out, sectionId)
  const img = sec.chart.img
  // Garde-fou : si le chart n'a pas d'image (cas dégénéré), ne pas fabriquer
  // {imgs:[undefined]} — le step chart, sans rien à préserver, est simplement retiré.
  sec.steps = sec.steps
    .map((step) => (step && step.chart ? (img ? { imgs: [img] } : null) : step))
    .filter(Boolean)
  delete sec.chart
  if (sec.kind === 'diagramme') sec.kind = DEFAULT_KIND
  return out
}

// Section portant une image → diagramme interactif. Une image réelle est TOUJOURS
// ancrée sur un step qui porte déjà du texte (cf. associate.js) et peut avoir des
// images sœurs. On CONSERVE donc le step d'ancrage : on lui retire seulement la
// 1re image (promue en chart.img) — texte et images sœurs restent — et on INSÈRE
// un step { chart:true } juste après. No-op si aucune image ou déjà un diagramme.
export function promoteImageToChart(reader, sectionId, shape) {
  const src = findSection(reader, sectionId)
  if (!src || sectionIsChart(src)) return reader
  const img = sectionImageSrc(src)
  if (!img) return reader
  const out = clone(reader)
  const sec = findSection(out, sectionId)
  const steps = []
  let inserted = false
  for (const step of sec.steps) {
    if (!inserted && step?.imgs?.[0]) {
      inserted = true
      const rest = step.imgs.slice(1)
      const anchor = { ...step }
      if (rest.length) anchor.imgs = rest
      else delete anchor.imgs
      steps.push(anchor) // step d'ancrage préservé (texte + images sœurs)
      steps.push({ chart: true }) // nouveau step chart inséré juste après
    } else {
      steps.push(step)
    }
  }
  sec.steps = steps
  sec.chart = { rows: 0, cols: 0, img, repeat: '', readDir: '', builtinLegend: false, ...(shape ? { shape } : {}) }
  sec.kind = 'diagramme'
  return out
}

// Construit la section-diagramme suivante pour une promotion de GALERIE (image jamais
// ancrée dans un step existant, contrairement à promoteImageToChart — cf. son commentaire
// de tête). Numérotation basée sur le MAX des titres "Diagramme N" DÉJÀ présents dans le
// reader (import PDF, ou promotions de galerie précédentes de la même session de
// correction) — PAS sur promoteGridSections (pdf-import/promote-grids.js), qui numérote un
// LOT de grilles fraîchement importées par index de lot : cette fonction-ci s'ajoute de
// façon INCRÉMENTALE à un reader qui peut déjà porter des sections "Diagramme N", un besoin
// que la numérotation par lot ne couvre pas. Dédoublonnage d'id par suffixe numérique
// croissant (même principe, code distinct, cf. Note en tête de plan d'implémentation).
function nextDiagramSection(sections, img, shape) {
  const secs = sections || []
  const nums = secs
    .map((s) => /^Diagramme (\d+)$/.exec(s?.title || ''))
    .filter(Boolean)
    .map((m) => Number(m[1]))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const title = `Diagramme ${n}`
  const used = new Set(secs.map((s) => s && s.id).filter(Boolean))
  const base = slug(title) || `diagramme-${n}`
  let id = base
  let suffix = 2
  while (used.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return {
    id,
    kind: 'diagramme',
    title,
    steps: [{ chart: true }],
    chart: { rows: 0, cols: 0, img, repeat: '', readDir: '', builtinLegend: false, ...(shape ? { shape } : {}) },
  }
}

// Diagramme du TEXTE → image de galerie (retour terrain 25/08/2026, mécanisme inverse de
// appendGalleryImageAsChart) : contrairement à demoteChartToImage (qui RÉINJECTE l'image
// dans le texte, sur un nouveau step {imgs:[img]}), cette fonction retire l'image SANS la
// réinjecter — elle rejoint pattern.gallery via `movedImg`, à la charge de l'appelant (ce
// module ne connaît que `reader`, jamais `pattern.gallery`). Une section qui ne contenait
// RIEN d'autre que son step {chart:true} (diagramme promu depuis la galerie, sans ancrage
// texte) est retirée ENTIÈREMENT plutôt que de laisser un titre de section orphelin sans
// le moindre contenu — cf. le motif des sections cassées (kind:'diagramme' sans chart)
// que CorrectionView.vue détecte déjà par ailleurs, à ne pas recréer soi-même ici.
export function demoteChartToGallery(reader, sectionId) {
  const src = findSection(reader, sectionId)
  if (!src || !sectionIsChart(src)) return { reader, movedImg: null }
  const out = clone(reader)
  const sec = findSection(out, sectionId)
  const img = sec.chart.img
  sec.steps = sec.steps.filter((step) => !(step && step.chart))
  delete sec.chart
  if (sec.kind === 'diagramme') sec.kind = DEFAULT_KIND
  if (sec.steps.length === 0) {
    out.sections = out.sections.filter((s) => s.id !== sectionId)
  }
  return { reader: out, movedImg: img || null }
}

// Transforme une image de GALERIE (pattern.gallery, jamais ancrée dans le texte) en
// diagramme suivable : ajoute une NOUVELLE section en fin de reader.sections (jamais
// attachée à une section existante — modèle PAR SECTION inchangé). `shape` : vraie valeur
// de chart.shape (`undefined` pour rangs standards, JAMAIS la sentinelle UI 'standard' —
// cf. Global Constraints du plan). Reader d'entrée jamais muté.
export function appendGalleryImageAsChart(reader, img, shape) {
  const out = clone(reader)
  out.sections = [...(out.sections || []), nextDiagramSection(out.sections, img, shape)]
  return out
}

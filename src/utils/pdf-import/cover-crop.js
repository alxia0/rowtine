// Cœur PUR du cadrage de la couverture (visu du patron). Aucune dépendance pdfjs/DOM.
// Une page 1 qui porte aussi les instructions (Katia Merino Aran : photo, titre et descriptif
// dans la colonne de gauche, matériel et points dans le reste de la page) ne doit pas
// s'afficher en entier en tête de la visu : on n'en garde que la ou les photos principales
// et le texte d'affiche collé à elles (titre, descriptif), tels que la créatrice les a composés.
// Rend la boîte à rendre en points PDF ({ x0, y0, x1, y1 }, y vers le haut), ou null pour
// garder la page entière (vraie couverture, ou pas de photo principale).

const PX2PT = 72 / 96 // w, h des images : px CSS affichés
const HERO_MIN_W = 0.3 // part de la largeur de page
const HERO_MIN_H = 0.2 // part de la hauteur de page
// Photo de la même rangée (DROPS : deux photos côte à côte) : au moins la moitié de la hauteur
// de la photo principale, et 60 % de hauteur commune avec elle.
const ROW_MIN_H = 0.5
const ROW_MIN_OVERLAP = 0.6
// Un descriptif pleine largeur démarre à la marge, un peu à gauche de la photo.
const LEFT_TOL = 0.05 // part de la largeur de page
const FIRST_GAP = 3 // × taille de la ligne : écart maximal entre la photo et le texte
const LINE_GAP = 2.2 // × taille : écart maximal entre deux lignes du même bloc
const MAX_BLOCK_LINES = 6 // au-delà, le texte collé n'est plus un titre
const PAD = 6 // points de marge autour du texte gardé
const MIN_VISIBLE_SIZE = 4 // points : en deçà, texte invisible (référence d'article à 1 pt)
// Sous ce volume de texte hors cadre, la page 1 est une vraie couverture (titre, créatrice,
// mentions) : on la garde entière. Mesuré sur 400 PDF du corpus (page 1 entière) : un creux
// net entre 300 et 400 caractères, 182 pages sous 300, 186 sous 400.
const COVER_MAX_OUTSIDE_CHARS = 300

// Largeur estimée d'un texte : pdfjs ne donne que l'abscisse de départ des morceaux de ligne.
const estWidth = (text, size) => text.length * size * 0.5

// Boîte d'une image, rognée aux bords de la page (un bandeau peut en déborder largement).
function boxOf(im, pageWidth, pageHeight) {
  const x0 = im.x ?? 0
  const top = im.y ?? 0
  return {
    x0: Math.max(0, x0),
    x1: Math.min(pageWidth, x0 + (im.w || 0) * PX2PT),
    top: Math.min(pageHeight, top),
    bottom: Math.max(0, top - (im.h || 0) * PX2PT),
  }
}

// Rangées candidates : la photo principale (la plus grande) avec les photos de sa rangée,
// puis la photo principale seule. Chaque rangée : sa boîte englobante et ses photos.
function heroRows(images, pageWidth, pageHeight) {
  const photos = (images || [])
    .filter((im) => im && !im.repeated && im.kind !== 'grid')
    .map((im) => boxOf(im, pageWidth, pageHeight))
  const area = (b) => (b.x1 - b.x0) * (b.top - b.bottom)
  const hero = photos
    .filter((b) => b.x1 - b.x0 >= HERO_MIN_W * pageWidth && b.top - b.bottom >= HERO_MIN_H * pageHeight)
    .sort((a, b) => area(b) - area(a))[0]
  if (!hero) return []
  const h = hero.top - hero.bottom
  const mates = photos.filter((b) => {
    const bh = b.top - b.bottom
    const common = Math.min(b.top, hero.top) - Math.max(b.bottom, hero.bottom)
    return bh >= ROW_MIN_H * h && common >= ROW_MIN_OVERLAP * Math.min(bh, h)
  })
  const rowOf = (list) => ({
    photos: list,
    x0: Math.min(...list.map((b) => b.x0)),
    x1: Math.max(...list.map((b) => b.x1)),
    top: Math.max(...list.map((b) => b.top)),
    bottom: Math.min(...list.map((b) => b.bottom)),
  })
  return mates.length > 1 ? [rowOf(mates), rowOf([hero])] : [rowOf([hero])]
}

// Taille du corps de texte : la plus fréquente, pondérée par le nombre de caractères.
function bodySizeOf(lines) {
  const weight = new Map()
  for (const l of lines) {
    const s = Math.round(l.size * 2) / 2
    weight.set(s, (weight.get(s) || 0) + l.text.length)
  }
  let best = 0
  let bestW = -1
  for (const [s, w] of weight) if (w > bestW) [best, bestW] = [s, w]
  return best
}

// Texte d'affiche contigu au bord de la rangée de photos, vers le bas (`below`) ou vers le
// haut. S'arrête à la première ligne du corps de texte ou au premier grand écart ; vide si le
// bloc dépasse MAX_BLOCK_LINES.
function blockFrom(lines, row, below, bodySize, pageWidth) {
  const sorted = lines
    .filter((l) => l.x >= row.x0 - LEFT_TOL * pageWidth && l.x < row.x1)
    .filter((l) => (below ? l.y < row.bottom : l.y > row.top))
    .sort((a, b) => (below ? b.y - a.y : a.y - b.y))
  const block = []
  for (const l of sorted) {
    if (Math.abs(l.size - bodySize) < 0.5) break
    const prev = block[block.length - 1]
    const gap = prev
      ? Math.abs(prev.y - l.y)
      : below
        ? row.bottom - (l.y + l.size)
        : l.y - l.size * 0.35 - row.top
    const limit = prev ? LINE_GAP * Math.max(prev.size, l.size) : FIRST_GAP * l.size
    if (gap > limit) break
    block.push(l)
    if (block.length > MAX_BLOCK_LINES) return []
  }
  return block
}

function boxFor(row, blocks, pageWidth, pageHeight) {
  const [up, down] = blocks
  const text = [...up, ...down]
  const left = Math.min(row.x0, ...text.map((l) => l.x - PAD))
  const right = Math.max(row.x1, ...text.map((l) => l.x + estWidth(l.text, l.size) + PAD))
  const top = up.length ? Math.max(...up.map((l) => l.y + l.size)) + PAD : row.top
  const bottom = down.length ? Math.min(...down.map((l) => l.y - l.size * 0.35)) - PAD : row.bottom
  return {
    x0: Math.max(0, left),
    x1: Math.min(pageWidth, right),
    y0: Math.max(0, bottom),
    y1: Math.min(pageHeight, top),
  }
}

// Texte posé sur une photo (légende incrustée) : fait partie de la composition.
const onPhotos = (l, row) => row.photos.some((b) => l.x >= b.x0 && l.x < b.x1 && l.y <= b.top && l.y >= b.bottom)

export function coverCropBox({ lines, images, pageWidth, pageHeight }) {
  const rows = heroRows(images, pageWidth, pageHeight)
  if (!rows.length) return null
  const visible = (lines || [])
    .filter((l) => (l.size || 0) >= MIN_VISIBLE_SIZE && String(l.text || '').trim())
    .map((l) => ({ text: String(l.text).trim(), size: l.size, y: l.y ?? 0, x: l.parts?.[0]?.x ?? 0 }))
  const bodySize = bodySizeOf(visible)
  for (const row of rows) {
    const up = blockFrom(visible, row, false, bodySize, pageWidth)
    const down = blockFrom(visible, row, true, bodySize, pageWidth)
    // Un bloc qui élargit le cadre peut y faire entrer une autre colonne : on le retire alors,
    // le bas d'abord, jusqu'à ne garder que les photos.
    for (const blocks of [[up, down], [up, []], [[], down], [[], []]]) {
      const box = boxFor(row, blocks, pageWidth, pageHeight)
      const kept = new Set(blocks.flat())
      const foreign = visible.some(
        (l) => !kept.has(l) && !onPhotos(l, row) && l.x >= box.x0 && l.x < box.x1 && l.y > box.y0 && l.y < box.y1,
      )
      if (foreign) continue
      const outside = visible.filter((l) => !kept.has(l) && !onPhotos(l, row)).reduce((n, l) => n + l.text.length, 0)
      return outside < COVER_MAX_OUTSIDE_CHARS ? null : box
    }
  }
  return null
}

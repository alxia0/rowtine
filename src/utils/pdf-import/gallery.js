// Coeur PUR de la galerie : filtrage / deduplication / plafond des images candidates.
// Aucune dependance pdfjs/DOM — le decodage vit dans utils/pdf.js (navigateur).

const MIN_SIDE = 96 // px : en deça, c'est un logo / une icône / un filet décoratif
// Plafond de sécurité contre un PDF pathologique (des centaines d'images). Relevé de 24
// à 64 (retour Alexia #5, poncho) : un tutoriel « Pas à pas » photo peut porter ~6 photos
// par page sur ~10 pages (≈54 photos d'étapes) ; à 24 la moitié était coupée. 64 laisse
// passer ces tutoriels tout en bornant les cas pathologiques. Filtre gate-NEUTRE (le
// corpus offline n'extrait pas d'images).
const MAX_IMAGES = 64

// `src` est une data-URL : ses 32 premiers caractères sont une CONSTANTE par format
// (« data:image/jpeg;base64,/9j/4AAQS » pour tout JPEG JFIF, « data:image/png;base64,
// iVBORw0KGg » pour tout PNG) — ils n'apportaient donc AUCUNE entropie et la signature
// dégénérait en `w×h:longueur`. Sur un tutoriel photo « pas à pas » (~54 photos d'étapes
// aux mêmes w/h affichés, cf. MAX_IMAGES ci-dessous), deux photos DIFFÉRENTES dont les
// tailles encodées coïncident se confondaient : la seconde était écartée en silence,
// contre la règle « jamais perdre d'info ». On échantillonne donc aussi la FIN et le
// MILIEU de la charge utile, là où deux images distinctes diffèrent réellement.
function signature(c) {
  const src = String(c.src || '')
  const mid = src.slice(Math.floor(src.length / 2), Math.floor(src.length / 2) + 64)
  return `${c.w}x${c.h}:${src.length}:${src.slice(0, 32)}:${mid}:${src.slice(-64)}`
}

export function filterGalleryImages(candidates) {
  const list = Array.isArray(candidates) ? candidates : []
  const seen = new Set()
  const grids = []
  const rest = []
  for (const c of list) {
    if (!c || !c.src) continue
    // Exemption MIN_SIDE pour kind:'grid' : la classification tourne sur la
    // résolution INTRINSÈQUE du raster, indépendante de sa taille AFFICHÉE (w/h ici) — un
    // diagramme Cella mis en page en petit resterait un vrai diagramme, jamais un logo/filet.
    // Le perdre ici = perte silencieuse d'info (cf. règle « jamais perdre d'info »).
    if (c.kind !== 'grid' && Math.min(c.w || 0, c.h || 0) < MIN_SIDE) continue
    const sig = signature(c)
    if (seen.has(sig)) continue
    seen.add(sig)
    const item = { ...c, src: c.src, page: c.page || 0, w: c.w || 0, h: c.h || 0 }
    // Exemption MAX_IMAGES pour kind:'grid' (miroir de l'exemption MIN_SIDE ci-dessus) : un
    // PDF avec >64 images avant un diagramme raster ne doit JAMAIS faire perdre ce diagramme
    // au plafond — seules les images NON-grille sont plafonnées (règle « jamais perdre un
    // diagramme »). Les grilles sont donc comptées à part, hors plafond.
    if (item.kind === 'grid') grids.push(item)
    else rest.push(item)
  }
  return [...grids, ...rest.slice(0, MAX_IMAGES)]
}

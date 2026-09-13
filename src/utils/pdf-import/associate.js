// Cœur PUR de l'association image → step (point #5). Aucune dépendance pdfjs/DOM.
// Relie une image extraite (avec position) à la ligne d'instruction qu'elle illustre :
//  1. ancrage géométrique : ligne de texte immédiatement AU-DESSUS de l'image (même page) ;
//  2. correspondance verbatim normalisée entre cette ligne et le texte d'un step ;
//  3. succès → src poussée dans step.imgs (image consommée) ; échec → image renvoyée en galerie.

const ANCHOR_MAX_GAP = 140 // points PDF : au-delà, l'image n'illustre plausiblement plus la ligne
const MIN_MATCH_LEN = 8 // longueur mini d'une sous-chaîne pour valider un « contient »
const MIN_TOKENS = 4 // nb mini de mots communs pour l'appariement par recouvrement
const OVERLAP_RATIO = 0.7 // seuil de recouvrement de tokens

function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .replace(/\{\{\d+\}\}/g, ' ') // marqueurs de taille
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

// Retire les tokens purement numériques : un step multi-tailles remplace ses
// nombres par un marqueur {{i}} (cf. norm), mais la ligne PDF brute au-dessus
// d'une image garde les chiffres littéraux (ex. « (40) 44 (48) br. » en fin de
// bloc replié). Comparer à chiffres retirés des deux côtés évite qu'un ancrage
// pourtant correct échoue seulement à cause de ce delta numérique.
function stripDigitTokens(s) {
  return s
    .split(' ')
    .filter((t) => t && !/^[0-9]+$/.test(t))
    .join(' ')
}

// Correspondance stricte (verbatim, chiffres inclus) : comportement HISTORIQUE,
// inchangé. Cherché en premier, dans TOUTES les sections (ordre document).
function lineMatchesStepExact(lineNorm, stepNorm) {
  if (!lineNorm || !stepNorm) return false
  if (lineNorm.length >= MIN_MATCH_LEN && stepNorm.includes(lineNorm)) return true
  if (stepNorm.length >= MIN_MATCH_LEN && lineNorm.includes(stepNorm)) return true
  const a = new Set(lineNorm.split(' ').filter(Boolean))
  const b = new Set(stepNorm.split(' ').filter(Boolean))
  const min = Math.min(a.size, b.size)
  if (min < MIN_TOKENS) return false
  let inter = 0
  for (const tkn of a) if (b.has(tkn)) inter += 1
  return inter / min >= OVERLAP_RATIO
}

// Correspondance de repli « chiffres neutralisés » (#1) : NE JAMAIS l'essayer sur
// tout le document (un final de rang générique — « terminer avec une mc » — revient
// dans quasi tous les rangs d'un patron crochet, donc une ligne repliée riche en
// chiffres matcherait par coïncidence n'importe quelle section antérieure). Réservé
// à l'appelant qui la restreint à la section active géométriquement (cf. section
// scoping dans associateImages).
function lineMatchesStepDigitFold(lineNorm, stepNorm) {
  if (!lineNorm || !stepNorm) return false
  const lineNoDigits = stripDigitTokens(lineNorm)
  const stepNoDigits = stripDigitTokens(stepNorm)
  if (lineNoDigits.length >= MIN_MATCH_LEN && stepNoDigits.includes(lineNoDigits)) return true
  if (stepNoDigits.length >= MIN_MATCH_LEN && lineNoDigits.includes(stepNoDigits)) return true
  return false
}

// Ligne de texte dont le y est immédiatement au-dessus du bord haut de l'image (même page),
// dans la limite ANCHOR_MAX_GAP. null si rien de plausible.
function anchorLine(image, linesOfPage) {
  let best = null
  let bestGap = Infinity
  for (const l of linesOfPage) {
    const gap = (l.y ?? 0) - (image.y ?? 0) // ligne au-dessus ⇒ gap positif
    if (gap >= 0 && gap < bestGap) {
      bestGap = gap
      best = l
    }
  }
  if (!best || bestGap > ANCHOR_MAX_GAP) return null
  return best
}

// Repère, pour chaque section dont le titre apparaît verbatim comme ligne PDF
// (la plupart des sections « ## Titre » — pas l'intro synthétique « Présentation »),
// sa position de lecture (page, y) → sert à déterminer la section géométriquement
// ACTIVE à l'endroit d'une image (cf. activeSectionIndex), pour scoper le repli
// « chiffres neutralisés ». Renvoyé trié en ordre de lecture (page croissant,
// y décroissant = haut → bas de page).
export function buildTitleEvents(outSections, pages) {
  const events = []
  outSections.forEach((sec, secIdx) => {
    const titleNorm = norm(sec.title)
    if (!titleNorm) return
    pages.forEach((lines, pageIdx) => {
      ;(lines || []).forEach((l) => {
        if (norm(l.text) === titleNorm) events.push({ page: pageIdx, y: l.y ?? 0, secIdx })
      })
    })
  })
  events.sort((a, b) => a.page - b.page || b.y - a.y)
  return events
}

// Index de la section active en (imagePageIdx, imageY) : le dernier titre en
// ordre de lecture situé À ou AVANT cette position (page antérieure, ou même
// page avec y >= imageY càd au-dessus/à hauteur). null si indéterminable
// (aucun titre localisé avant l'image — ex. image dans l'intro).
export function activeSectionIndex(titleEvents, imagePageIdx, imageY) {
  let active = null
  for (const ev of titleEvents) {
    const before = ev.page < imagePageIdx || (ev.page === imagePageIdx && ev.y >= imageY)
    if (!before) break // trié en ordre de lecture : rien après ne peut plus être "avant"
    active = ev.secIdx
  }
  return active
}

export function associateImages(sections, imagesWithPos, linesByPage) {
  const imgs = Array.isArray(imagesWithPos) ? imagesWithPos : []
  const pages = Array.isArray(linesByPage) ? linesByPage : []
  const secList = Array.isArray(sections) ? sections : []
  // Copie : nouveaux objets step (imgs additif), on ne mute jamais l'entrée.
  const outSections = secList.map((sec) => ({
    ...sec,
    steps: (sec.steps || []).map((st) => ({ ...st })),
  }))
  const consumed = new Set()
  const titleEvents = buildTitleEvents(outSections, pages)

  function attach(sec, st, image, idx) {
    if (!Array.isArray(st.imgs)) st.imgs = []
    st.imgs.push(image.src)
    consumed.add(idx)
  }

  imgs.forEach((image, idx) => {
    const linesOfPage = pages[(image.page || 1) - 1] || []
    const anchor = anchorLine(image, linesOfPage)
    if (!anchor) return
    const lineNorm = norm(anchor.text)
    if (!lineNorm) return

    // Passe 1 (comportement HISTORIQUE, inchangé) : correspondance stricte,
    // dans l'ordre du document, 1er step qui matche.
    for (const sec of outSections) {
      let matched = false
      for (const st of sec.steps) {
        if (!st.t) continue
        if (lineMatchesStepExact(lineNorm, norm(st.t))) {
          attach(sec, st, image, idx)
          matched = true
          break
        }
      }
      if (matched) return
    }

    // Passe 2 (#1, repli) : correspondance chiffres neutralisés, restreinte à la
    // SEULE section géométriquement active à la position de l'image — jamais tout
    // le document (cf. lineMatchesStepDigitFold). Si la section active est
    // indéterminable, on n'essaie pas ce repli (comportement historique : galerie).
    const secIdx = activeSectionIndex(titleEvents, (image.page || 1) - 1, image.y ?? 0)
    if (secIdx == null) return
    const sec = outSections[secIdx]
    if (!sec) return
    for (const st of sec.steps) {
      if (!st.t) continue
      if (lineMatchesStepDigitFold(lineNorm, norm(st.t))) {
        attach(sec, st, image, idx)
        return
      }
    }
  })

  const gallery = imgs
    .filter((_, idx) => !consumed.has(idx))
    .map(({ src, page, w, h }) => ({ src, page: page || 0, w: w || 0, h: h || 0 }))

  return { sections: outSections, gallery }
}

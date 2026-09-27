// Cœur PUR de l'association image → step (point #5). Aucune dépendance pdfjs/DOM.
// Relie une image extraite (avec position) à la ligne d'instruction qu'elle illustre :
//  1. ancrage géométrique : ligne de texte immédiatement AU-DESSUS de l'image (même page) ;
//  2. correspondance verbatim normalisée entre cette ligne et le texte d'un step ;
//  3. à défaut, l'étape qui précède l'image en ordre de lecture (passe 3, hors page 1) ;
//  4. succès → src poussée dans step.imgs (image consommée) ; échec → image renvoyée en galerie.
// Option { coverShown } : la page 1 est déjà rendue en couverture en tête de la visu, ses
// images n'entrent alors dans aucune passe (1 à 3), elles restent en galerie. Option
// { coverBox } : couverture rognée (cover-crop.js), seules les images de la page 1 dont le
// centre tombe dans le cadre en sont exclues. Décoration
// (image répétée, région vectorielle posée sur une photo) : exclue de toutes les passes
// (1 à 3), quelle que soit la couverture.

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

// Correspondance stricte (verbatim, chiffres inclus). Cherchée en premier, dans TOUTES
// les sections ; départage entre plusieurs steps par pickBest (cf. associateImages).
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

// Continuité générique entre une suite de clés déjà normalisées (une ligne PDF par index)
// et un step : -1 si la clé d'ancrage elle-même n'est pas contenue dans le step
// (correspondance par recouvrement de mots seulement en passe 1, ou coïncidence isolée en
// passe 3), sinon le nombre de clés PRÉCÉDENTES qu'on peut lui accoler en gardant le tout
// contenu dans le step. Distingue deux rangs qui finissent pareil (« terminer avec une mc ») :
// seul le vrai prolonge les lignes au-dessus. Bornée à CONTINUITY_MAX_LINES lignes.
const CONTINUITY_MAX_LINES = 8

function continuityFromKeys(keys, anchorIdx, stepText) {
  if (anchorIdx < 0 || !stepText) return -1
  let tail = keys[anchorIdx]
  if (!tail || !stepText.includes(tail)) return -1
  let n = 0
  for (let i = anchorIdx - 1; i >= 0 && n < CONTINUITY_MAX_LINES; i--) {
    const prev = keys[i]
    const joined = prev ? `${prev} ${tail}` : tail
    if (!stepText.includes(joined)) break
    tail = joined
    n += 1
  }
  return n
}

// Continuité entre le texte au-dessus de l'image et un step, dans la normalisation de la
// passe (`fold` : chiffres neutralisés des deux côtés, sinon texte normalisé tel quel),
// pour les lignes de LA MÊME PAGE (passes 1 et 2). Cf. `continuityFromKeys` pour la passe 3,
// qui parcourt tout le document.
function continuity(stepText, anchorIdx, linesOfPage, fold) {
  const keys = linesOfPage.map((l) => (fold ? stripDigitTokens(norm(l.text)) : norm(l.text)))
  return continuityFromKeys(keys, anchorIdx, stepText)
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

// Passe 3 (spec 2026-09-26-visu-patron-couverture-photos) : une image que le texte juste
// au-dessus ne rattache pas va sous l'étape qui la PRÉCÈDE en ordre de lecture, comme on la
// voit dans le PDF. On remonte ligne à ligne depuis sa position, en franchissant les sauts
// de page, sur au plus PLACE_MAX_LINES lignes : au-delà (glossaire, abréviations), une
// étape retrouvée serait trop lointaine pour être la bonne, l'image reste en galerie.
const PLACE_MAX_LINES = 80

// Toutes les lignes du document en ordre de lecture. `norm` : texte normalisé tel quel
// (sert à distinguer deux titres qui ne diffèrent que par un chiffre, ex. « MOTIF 1 » /
// « MOTIF 2 ») ; `key` : la même, chiffres neutralisés (les étapes multi-tailles
// remplacent leurs nombres par des marqueurs {{i}}), utilisée en repli.
function flattenLines(pages) {
  const flat = []
  pages.forEach((lines, pageIdx) => {
    for (const l of lines || []) {
      const n = norm(l.text)
      flat.push({ page: pageIdx, y: l.y ?? 0, norm: n, key: stripDigitTokens(n) })
    }
  })
  return flat
}

// Index, dans `flat`, de la première ligne qui suit l'image en ordre de lecture : la
// première ligne de sa page sous son bord haut (tolérance 1 pt), sinon la première ligne
// des pages suivantes, sinon la fin du document.
function readingPosition(image, flat) {
  const pageIdx = (image.page || 1) - 1
  const top = image.y ?? 0
  const below = flat.findIndex((l) => l.page === pageIdx && l.y < top - 1)
  if (below >= 0) return below
  const next = flat.findIndex((l) => l.page > pageIdx)
  return next >= 0 ? next : flat.length
}

// Boîte d'une image en points PDF, y vers le HAUT : `x`,`y` (bord haut) sont en points,
// `w`,`h` en px CSS (taille affichée) → ×72/96.
const CSS2PT = 72 / 96
function boxOf(im) {
  const x0 = im.x ?? 0
  const top = im.y ?? 0
  return { x0, x1: x0 + (im.w || 0) * CSS2PT, y0: top - (im.h || 0) * CSS2PT, y1: top }
}
function intersectionArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}
// Une région vectorielle (cadre, légendes) posée sur une photo de la même page en est un
// rendu : la placer dans le fil redoublerait la photo, en petit. Seuil : le quart de la photo.
const REGION_OVER_PHOTO_RATIO = 0.25
function regionOverPhoto(image, imgs) {
  if (image.kind !== 'reference') return false
  const box = boxOf(image)
  return imgs.some((o) => {
    if (o === image || o.kind === 'reference' || o.kind === 'grid' || o.page !== image.page) return false
    const ob = boxOf(o)
    const area = (ob.x1 - ob.x0) * (ob.y1 - ob.y0)
    return area > 0 && intersectionArea(box, ob) >= REGION_OVER_PHOTO_RATIO * area
  })
}

// Centre de l'image dans le cadre de la couverture rognée.
function inBox(image, box) {
  if (!box) return false
  const b = boxOf(image)
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  return cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1
}

export function associateImages(sections, imagesWithPos, linesByPage, { coverShown = false, coverBox = null } = {}) {
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

  // Normalisations des steps calculées une fois (texte brut et chiffres neutralisés).
  const stepNorms = outSections.map((sec) =>
    sec.steps.map((st) => {
      if (!st.t) return null
      const n = norm(st.t)
      return { n, folded: stripDigitTokens(n) }
    }),
  )

  // Parmi plusieurs steps qui correspondent, le meilleur : celui que le texte au-dessus
  // de l'image (passes 1-2) ou les lignes qui la précèdent en ordre de lecture (passe 3)
  // prolongent le plus loin (continuité, cf. `continuityOf`, fourni par l'appelant : deux
  // rangs « 9. Crochet 1 dc cluster » et « 26. Crochet 1 dc cluster », ou deux rangs qui
  // finissent par la même formule, ne se valent pas), puis celui de la section active,
  // puis le premier en ordre du document (comportement historique à égalité).
  function pickBest(candidates, continuityOf, activeIdx) {
    let best = null
    let bestKey = null
    for (const c of candidates) {
      const key = [continuityOf(c), c.si === activeIdx ? 1 : 0]
      if (!best || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
        best = c
        bestKey = key
      }
    }
    return best
  }

  const flat = flattenLines(pages)
  const flatKeys = flat.map((l) => l.key)
  // Titre verbatim (distingue « MOTIF 1 » de « MOTIF 2 », que le repli chiffres neutralisés
  // ferait toutes deux tomber sur « motif ») et titre replié (repli, cf. plus bas).
  const titleNorms = outSections.map((sec) => norm(sec.title))
  const titleKeys = outSections.map((sec) => stripDigitTokens(norm(sec.title)))
  // Première étape TEXTE d'une section (-1 si aucune) : une étape diagramme ne porte pas
  // d'image en Rowtine-MD (une image nue dans une section y est lue comme un diagramme).
  const firstTextStep = (si) => outSections[si].steps.findIndex((st) => st.t && !st.chart)

  // Passe 3 : cible { si, k } de l'étape qui précède l'image en ordre de lecture, ou null.
  function placeByPosition(image, activeIdx) {
    const pageIdx = (image.page || 1) - 1
    // Page hors du document (donnée d'entrée aberrante) : rien à remonter, galerie.
    if (pageIdx >= pages.length) return null
    const pos = readingPosition(image, flat)
    for (let j = pos - 1; j >= 0 && j >= pos - PLACE_MAX_LINES; j--) {
      const lineKey = flat[j].key
      if (!lineKey) continue
      const lineNorm = flat[j].norm
      // Titre de section : verbatim d'abord (jamais de confusion entre deux titres qui ne
      // diffèrent que par un chiffre) ; à défaut, repli chiffres neutralisés en préférant
      // la section active si plusieurs titres repliés coïncident, sinon la première.
      let ti = lineNorm ? titleNorms.indexOf(lineNorm) : -1
      if (ti < 0) {
        const foldedMatches = []
        titleKeys.forEach((tk, si) => {
          if (tk && tk === lineKey) foldedMatches.push(si)
        })
        if (foldedMatches.length) ti = foldedMatches.includes(activeIdx) ? activeIdx : foldedMatches[0]
      }
      if (ti >= 0) {
        const k = firstTextStep(ti)
        if (k >= 0) return { si: ti, k }
        continue
      }
      if (lineKey.length < MIN_MATCH_LEN) continue
      const cands = []
      stepNorms.forEach((row, si) =>
        row.forEach((sn, k) => {
          if (sn && !outSections[si].steps[k].chart && sn.folded.includes(lineKey)) cands.push({ si, k })
        }),
      )
      if (cands.length) return pickBest(cands, (c) => continuityFromKeys(flatKeys, j, stepNorms[c.si][c.k].folded), activeIdx)
    }
    return null
  }

  // Passes 1 et 2 (inchangées) : cible { si, k } par le texte juste au-dessus, ou null.
  function placeByAnchor(image, linesOfPage, secIdx) {
    const anchor = anchorLine(image, linesOfPage)
    if (!anchor) return null
    const lineNorm = norm(anchor.text)
    if (!lineNorm) return null
    const anchorIdx = linesOfPage.indexOf(anchor)

    // Passe 1 : correspondance stricte, cherchée dans TOUTES les sections. Si plusieurs
    // steps correspondent, pickBest départage (avant : le 1er en ordre du document,
    // qui reste le choix à égalité).
    const exact = []
    outSections.forEach((sec, si) => {
      sec.steps.forEach((st, k) => {
        const sn = stepNorms[si][k]
        if (sn && lineMatchesStepExact(lineNorm, sn.n)) exact.push({ si, k })
      })
    })
    if (exact.length) return pickBest(exact, (c) => continuity(stepNorms[c.si][c.k].n, anchorIdx, linesOfPage, false), secIdx)

    // Passe 2 (#1, repli) : correspondance chiffres neutralisés, restreinte à la
    // SEULE section géométriquement active à la position de l'image, jamais tout
    // le document (cf. lineMatchesStepDigitFold). Si la section active est
    // indéterminable, on n'essaie pas ce repli.
    if (secIdx == null || !outSections[secIdx]) return null
    const folded = []
    outSections[secIdx].steps.forEach((st, k) => {
      const sn = stepNorms[secIdx][k]
      if (sn && lineMatchesStepDigitFold(lineNorm, sn.n)) folded.push({ si: secIdx, k })
    })
    return folded.length
      ? pickBest(folded, (c) => continuity(stepNorms[c.si][c.k].folded, anchorIdx, linesOfPage, true), secIdx)
      : null
  }

  // Dernière image rattachée (toutes passes) : une image sans texte reconnu sur la même
  // page ou la suivante prolonge la même série (diagramme découpé sur plusieurs pages).
  let last = null
  imgs.forEach((image, idx) => {
    const pageIdx = (image.page || 1) - 1
    // Couverture affichée (rendu de la page 1 en tête de la visu) : la page 1 s'y voit
    // déjà en entier, ses images n'entrent pas dans le fil, par aucune passe. La
    // décoration (image répétée : logo, en-tête ; région posée sur une photo : cadre et
    // légendes d'une photo extraite à part) n'illustre pas le patron : galerie aussi.
    if ((pageIdx === 0 && (coverShown || inBox(image, coverBox))) || image.repeated || regionOverPhoto(image, imgs)) return
    const linesOfPage = pages[pageIdx] || []
    const secIdx = activeSectionIndex(titleEvents, pageIdx, image.y ?? 0)
    let target = placeByAnchor(image, linesOfPage, secIdx)
    // Page 1 exclue de la passe 3 en toutes circonstances : sans couverture rendue, une
    // image de la page 1 n'a pas d'étape « précédente » qui ait un sens. La sortie
    // anticipée plus haut gère couverture et décoration pour toutes les passes (1 à 3).
    if (!target && pageIdx > 0) {
      target = placeByPosition(image, secIdx)
      // Prolongement borné à une page en AVANT seulement : l'appelant trie `imagesWithPos` en
      // ordre de lecture (cf. pdf-import/index.js), donc une image plus tôt dans le document ne
      // doit jamais hériter du step d'une image déjà vue plus loin.
      if (!target && last && pageIdx - last.pageIdx >= 0 && pageIdx - last.pageIdx <= 1) target = last.target
    }
    if (!target) return
    attach(outSections[target.si], outSections[target.si].steps[target.k], image, idx)
    last = { pageIdx, target }
  })

  const gallery = imgs
    .filter((_, idx) => !consumed.has(idx))
    .map(({ src, page, w, h }) => ({ src, page: page || 0, w: w || 0, h: h || 0 }))

  return { sections: outSections, gallery }
}

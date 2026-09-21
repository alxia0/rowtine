// Dessin du motif « mailles » du badge — traduction canevas du motif SVG de
// `StitchProgress.vue` (« Signature de l'app : la progression rendue comme des mailles », cf.
// son commentaire de tête), à l'échelle du badge plutôt que celle d'un composant d'écran :
// `SCALE` fait passer la hauteur de référence (13px CSS, taille d'un composant plein-largeur sur
// téléphone) à 26px, cohérente avec `STACK_VALUE_FONT` (26px, badge-render.js). Fonction PURE,
// appelée UNE SEULE FOIS par `drawStackedBlocks` (badge-render.js) au moment du dessin — pas de
// phase de mesure séparée à garder synchronisée : la hauteur réservée pour cette rangée
// (`STACK_ROW_H`, badge-render.js) est FIXE, indépendante du nombre de mailles réellement
// dessinées ; seule leur LARGEUR s'adapte à `maxWidth`, calculée ici et nulle part ailleurs.
const SCALE = 2
const H = 13 * SCALE
const MAX = 40 // même plafond que StitchProgress.vue (mailles réellement dessinées, jamais le total réel du patron)

function knitStep() {
  return (11 + 1.5) * SCALE
}
function crochetStep() {
  return 8.8 * SCALE
}

// Nombre de mailles dessinables dans `maxWidth` — plafonné par `total` (jamais plus de mailles
// que de rangs réels) et par `MAX` (lisibilité), jamais une troncature après coup qui laisserait
// une maille à moitié hors cadre (même esprit que `maxCols`, badge-calendar.js).
function shownCount(technique, total, maxWidth) {
  const capped = Math.min(Math.max(1, total || 1), MAX)
  let fit
  if (technique === 'crochet') {
    const a = 4.4 * SCALE, step = crochetStep()
    fit = Math.floor((maxWidth - a * 2 - 2 * SCALE) / step) + 1
  } else {
    fit = Math.floor(maxWidth / knitStep())
  }
  return Math.max(0, Math.min(capped, fit))
}

export const STITCH_MOTIF_HEIGHT = H

// `(x, y)` : coin HAUT-GAUCHE de la boîte du motif (jamais une ligne de base de texte,
// contrairement aux fonctions `fillText` de badge-render.js — ceci ne dessine pas de texte).
export function drawStitchMotif(ctx, x, y, { technique, done, total, textColor, maxWidth }) {
  const t = Math.max(1, Number(total) || 1)
  const d = Math.min(t, Math.max(0, Number(done) || 0))
  const shown = shownCount(technique, t, maxWidth)
  if (shown < 1) return // pas assez de place pour une seule maille lisible : on renonce plutôt que d'en dessiner une hors cadre
  const doneShown = Math.round((d / t) * shown)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (technique === 'crochet') {
    const a = 4.4 * SCALE, b = 5 * SCALE, step = crochetStep(), x0 = a + SCALE, cy = H / 2
    const strokeOn = 1.6 * SCALE, strokeOff = 1 * SCALE
    for (let i = 0; i < shown; i++) {
      const cx = x + x0 + i * step, cyAbs = y + cy
      ctx.beginPath()
      ctx.moveTo(cx - a, cyAbs)
      ctx.quadraticCurveTo(cx, cyAbs - b, cx + a, cyAbs)
      ctx.quadraticCurveTo(cx, cyAbs + b, cx - a, cyAbs)
      ctx.closePath()
      ctx.strokeStyle = textColor
      ctx.globalAlpha = i < doneShown ? 1 : 0.3
      ctx.lineWidth = i < doneShown ? strokeOn : strokeOff
      ctx.stroke()
    }
  } else {
    const w = 11 * SCALE, gap = 1.5 * SCALE, step = w + gap
    const strokeOn = 2.4 * SCALE, strokeOff = 1.5 * SCALE
    for (let i = 0; i < shown; i++) {
      const bx = x + i * step
      ctx.beginPath()
      ctx.moveTo(bx + 1 * SCALE, y + 2 * SCALE)
      ctx.lineTo(bx + w / 2, y + H - 1.5 * SCALE)
      ctx.lineTo(bx + w - 1 * SCALE, y + 2 * SCALE)
      ctx.strokeStyle = textColor
      ctx.globalAlpha = i < doneShown ? 1 : 0.3
      ctx.lineWidth = i < doneShown ? strokeOn : strokeOff
      ctx.stroke()
    }
  }
  ctx.restore()
}

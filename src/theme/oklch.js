// Conversion OKLCH -> sRGB en JS pur (matrices Ottosson / CSS Color 4). Pas de CSS
// oklch() natif : la base WebView Android documentée (Chromium 108+, cf. tokens.css)
// est antérieure à son support (Chromium 111+).
function linearToSrgb(c) {
  const cl = Math.min(1, Math.max(0, c))
  if (cl < 0.0001) return 0
  return cl <= 0.0031308 ? cl * 12.92 : 1.055 * cl ** (1 / 2.4) - 0.055
}

// L en pourcentage (0-100), C en chromaticité OKLCH, H en degrés (0-360). Retourne
// [r, g, b] entiers 0-255, écrêtés au gamut sRGB (clamp linéaire avant gamma).
export function oklchToRgb(L, C, H) {
  if (L === 0) return [0, 0, 0]
  const l = L / 100
  const hr = (H * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const ll = l_ ** 3
  const mm = m_ ** 3
  const ss = s_ ** 3
  const lr = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss
  const lg = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss
  const lb = -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss
  return [lr, lg, lb].map((v) => Math.round(linearToSrgb(v) * 255))
}

export function oklchToCss(L, C, H) {
  const [r, g, b] = oklchToRgb(L, C, H)
  return `rgb(${r}, ${g}, ${b})`
}

export function oklchToHex(L, C, H) {
  const [r, g, b] = oklchToRgb(L, C, H)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

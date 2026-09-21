// Couleur d'aperçu (« swatch ») déterministe pour les vignettes générées.
// Pour une laine, on tente de reconnaître la couleur d'après son nom (« noir d'encre »,
// « bleu marine »…) ; à défaut, et pour les projets/patrons, on dérive une teinte stable
// par hachage du texte. Tout est calculé en HSL pour dériver facilement deux tons (relief).

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

// Mots de couleur courants (FR + EN), valeurs en [teinte, saturation %, luminosité %].
// Clés sans accent (le texte saisi est normalisé avant comparaison).
const NAMED = {
  noir: [0, 0, 17], black: [0, 0, 17],
  blanc: [40, 28, 92], white: [40, 28, 92],
  ecru: [38, 38, 86], creme: [40, 42, 86], cream: [40, 42, 86], naturel: [38, 34, 84], natural: [38, 34, 84],
  gris: [220, 6, 62], grey: [220, 6, 62], gray: [220, 6, 62], anthracite: [220, 8, 32],
  beige: [38, 30, 76], sable: [40, 32, 74], sand: [40, 32, 74],
  taupe: [30, 12, 58], camel: [33, 45, 58], caramel: [30, 50, 50],
  marron: [25, 40, 34], brun: [25, 40, 34], brown: [25, 40, 34], chocolat: [22, 38, 28], chocolate: [22, 38, 28],
  rouge: [4, 65, 49], red: [4, 65, 49], cerise: [350, 65, 48],
  bordeaux: [348, 55, 32], burgundy: [348, 55, 32], grenat: [350, 50, 36],
  rose: [340, 60, 75], pink: [340, 60, 75], fuchsia: [320, 70, 58],
  corail: [12, 72, 67], coral: [12, 72, 67], saumon: [14, 65, 72], salmon: [14, 65, 72],
  orange: [28, 78, 57], abricot: [26, 72, 68], apricot: [26, 72, 68],
  moutarde: [44, 70, 47], mustard: [44, 70, 47], ocre: [40, 62, 50], ochre: [40, 62, 50], curry: [42, 68, 46],
  jaune: [50, 78, 62], yellow: [50, 78, 62], citron: [54, 78, 64],
  vert: [135, 35, 46], green: [135, 35, 46],
  sauge: [110, 18, 60], sage: [110, 18, 60],
  kaki: [70, 28, 42], khaki: [70, 28, 42], olive: [68, 34, 40],
  emeraude: [160, 45, 40], emerald: [160, 45, 40], menthe: [150, 40, 70], mint: [150, 40, 70],
  turquoise: [180, 45, 46], canard: [188, 40, 38], teal: [186, 42, 40],
  bleu: [212, 55, 52], blue: [212, 55, 52],
  marine: [222, 45, 28], navy: [222, 45, 28], indigo: [232, 42, 38],
  ciel: [205, 60, 72], sky: [205, 60, 72], azur: [205, 65, 60],
  lavande: [265, 40, 72], lavender: [265, 40, 72], parme: [280, 28, 70], lilas: [275, 38, 72], lilac: [275, 38, 72],
  violet: [285, 40, 45], purple: [285, 40, 45], prune: [300, 35, 38], plum: [300, 35, 38], aubergine: [295, 30, 30],
  mauve: [300, 25, 65],
}

function hashCode(str) {
  let h = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Teinte stable par hachage : palette douce (pastel chaleureux), cohérente avec la marque.
function hashHsl(seed) {
  const h = hashCode(seed) % 360
  return [h, 40, 64]
}

// Couleur de base [h,s,l] pour une vignette générée.
// kind 'yarn' → on cherche un mot de couleur dans le seed (le nom de coloris) ; sinon hash.
// Non exportée : seule `swatchTones`, dans ce fichier, l'appelle.
function swatchHsl(kind, seed) {
  if (kind === 'yarn') {
    const tokens = normalize(seed).split(/[^a-z]+/).filter(Boolean)
    // `Object.hasOwn` et NON `if (NAMED[tk])` : `NAMED` est un objet littéral, donc sa chaîne
    // de prototype répond. Les jetons sont [a-z] minuscules (cf. `normalize`), ce qui écarte
    // `toString`/`valueOf` mais PAS `constructor` : `NAMED['constructor']` rend la fonction
    // `Object`, que `swatchTones` déstructurerait aussitôt — « function is not iterable », la
    // vignette ne se peint plus du tout. Un nom de coloris n'a pas à pouvoir faire ça.
    for (const tk of tokens) if (Object.hasOwn(NAMED, tk)) return NAMED[tk]
  }
  return hashHsl(seed)
}

const clampL = (l) => Math.max(6, Math.min(94, l))
const hsl = ([h, s, l]) => `hsl(${h} ${s}% ${clampL(l)}%)`

// Les 3 tons (fond, creux, relief) dérivés d'un [h,s,l] — même formule pour swatchTones
// (teinte calculée) et tonesFromColor (teinte explicite) : un seul endroit qui décide des
// écarts de luminosité ±11/12.
function tonesOf([h, s, l]) {
  return { base: hsl([h, s, l]), lo: hsl([h, s, l - 11]), hi: hsl([h, s, l + 12]) }
}

// Renvoie les 3 tons d'une vignette générée : fond, creux (ombre), relief (lumière).
export function swatchTones(kind, seed) {
  return tonesOf(swatchHsl(kind, seed))
}

// Palette de couleurs proposée à l'utilisateur pour une laine (choix visuel).
// Dérivée des teintes nommées ; chaque entrée stocke sa couleur en chaîne hsl.
export const COLOR_PALETTE = [
  'noir', 'gris', 'anthracite', 'blanc', 'ecru', 'beige', 'taupe', 'camel', 'marron', 'chocolat',
  'rouge', 'bordeaux', 'rose', 'fuchsia', 'corail', 'orange', 'moutarde', 'jaune',
  'vert', 'sauge', 'kaki', 'emeraude', 'turquoise', 'bleu', 'marine', 'ciel', 'lavande', 'violet', 'prune', 'mauve',
].map((key) => ({ key, hsl: hsl(NAMED[key]) }))

// [h,s,l] numériques extraits d'une chaîne « hsl(h s% l%) ». null si la forme ne correspond pas.
// Regex partagée par tonesFromColor, hslToHex et hslStringToHsv : les trois lisent le même format.
function parseHsl(str) {
  const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(String(str || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// Tons d'une vignette à partir d'une couleur explicite (chaîne « hsl(h s% l%) »).
export function tonesFromColor(color) {
  const parsed = parseHsl(color)
  return parsed ? tonesOf(parsed) : null
}

// Convertit un hex « #rrggbb » (ou « rrggbb ») en chaîne « hsl(h s% l%) » (entiers),
// pour stocker une couleur perso au même format que la palette. '' si invalide.
export function hexToHsl(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || '').trim())
  if (!m) return ''
  const r = parseInt(m[1], 16) / 255
  const g = parseInt(m[2], 16) / 255
  const b = parseInt(m[3], 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = (((g - b) / d) % 6 + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`
}

// Inverse de hexToHsl : « hsl(h s% l%) » → « #rrggbb » (minuscule), pour réinjecter la
// couleur courante dans le champ hexa du pop-up ColorPickerDialog. '' si invalide.
export function hslToHex(hslStr) {
  const parsed = parseHsl(hslStr)
  if (!parsed) return ''
  const h = ((parsed[0] % 360) + 360) % 360
  const s = parsed[1] / 100
  const l = parsed[2] / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const mm = l - c / 2
  let r, g, b
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (v) => Math.round((v + mm) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

// Vrai si `color` est une couleur choisie hors palette (ni vide, ni une pastille connue).
// Sert à afficher la pastille « perso » en état sélectionné.
export function isCustomColor(color) {
  return !!color && !COLOR_PALETTE.some((c) => c.hsl === color)
}

// Le carré du sélecteur de couleur est en HSV (repère du sélecteur GIMP : saturation ×
// valeur), alors que l'app stocke en HSL. Ces deux fonctions pures font le pont dans les
// deux sens. h : 0-359 ; s / v / l : 0-100. Bijectives (même couleur, autre repère).
export function hsvToHslString(h, s, v) {
  const H = ((Math.round(Number(h) || 0) % 360) + 360) % 360
  const S = Math.min(100, Math.max(0, Number(s) || 0)) / 100
  const V = Math.min(100, Math.max(0, Number(v) || 0)) / 100
  const l = V * (1 - S / 2)
  const sl = l === 0 || l === 1 ? 0 : (V - l) / Math.min(l, 1 - l)
  return `hsl(${H} ${Math.round(sl * 100)}% ${Math.round(l * 100)}%)`
}

export function hslStringToHsv(hslStr) {
  const parsed = parseHsl(hslStr)
  if (!parsed) return null
  const H = ((parsed[0] % 360) + 360) % 360
  const S = Math.min(100, Math.max(0, parsed[1])) / 100
  const L = Math.min(100, Math.max(0, parsed[2])) / 100
  const v = L + S * Math.min(L, 1 - L)
  const sv = v === 0 ? 0 : 2 * (1 - L / v)
  return { h: Math.round(H), s: Math.round(sv * 100), v: Math.round(v * 100) }
}

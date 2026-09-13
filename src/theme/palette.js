// Génère la palette d'accent dérivée d'une seule teinte (H, 0-360°), pour un thème donné.
// Les valeurs sont justifiées par balayage de validation (ΔE contre les teintes de
// référence), conservé avec les specs du projet.
import { oklchToCss, oklchToHex, oklchToRgb } from './oklch'

// Teinte par défaut DYNAMIQUE (T2, 31/08) : tant que l'utilisatrice n'a pas choisi
// explicitement une teinte (marqueur `accentHueChosen` du store settings), l'accent suit
// le thème effectif — 320 (rose) en sombre, 230 (bleu) en clair. Le changement de mode
// fait donc suivre la couleur, sans choix définitif imposé à l'installation.
export const DEFAULT_HUES = { light: 230, dark: 320 }

// effectiveTheme: 'light' | 'dark' (résolu, jamais 'system'). Toute autre valeur retombe
// sur le défaut clair.
export function defaultHueFor(effectiveTheme) {
  return DEFAULT_HUES[effectiveTheme] ?? DEFAULT_HUES.light
}

// Nuancier des réglages — PAR THÈME (spec 08/09, même idiome que DEFAULT_HUES ci-dessus).
// Garde par liste : chaque teinte à >= 10° de la teinte de --danger DE SON THÈME
// (clair : |h − 30,5| ; sombre : |(h + 33) mod 360 − 30,7|, décalage du rôle brand sombre),
// même garde-fou que celui déjà appliqué à --brand dans tokens.css (cf. spec). Listes
// distinctes ASSUMÉES : une teinte choisie absente de la liste du thème courant → aucune
// pastille allumée, le curseur la montre. Clair : orange corail 44 et jaune doré 70
// (rendus « sombre-adapté », cf. WARM_BAND) à la place du vert d'eau 170 et du bleu
// pétrole 210 (retour terrain du 08/09) ; sombre : 70 retiré (y rend kaki), corail 15,
// bleu clair 210 et pastèque 340 ajoutés.
export const PRESET_HUES = {
  light: [15, 44, 70, 150, 190, 230, 250, 280, 320, 340],
  dark: [15, 44, 100, 150, 190, 210, 230, 280, 320, 340],
}

// effectiveTheme: 'light' | 'dark' (résolu, jamais 'system'). Toute autre valeur retombe
// sur la liste claire.
export function presetHuesFor(effectiveTheme) {
  return PRESET_HUES[effectiveTheme] ?? PRESET_HUES.light
}

// L (luminosité %), C (chromaticité) et off (décalage de teinte, en degrés) par rôle et
// par thème. off = teinte mesurée actuelle du rôle moins 44 (la référence 44, teinte par défaut d'avant T2) —
// chaque rôle garde son ÉCART DE TEINTE actuel par rapport aux autres (ex. --surface-lin
// est aujourd'hui nettement plus chaud que --bg : 63,19° contre 84,58° en clair, l'accent
// « crème lin » du design ; --brand sombre est à +33° de --brand clair). Un décalage
// UNIQUE par thème (au lieu d'un décalage par rôle) collapserait tous les rôles sur la
// même teinte et romprait ces écarts internes ET au moins une assertion e2e existante
// (`theme.spec.js` ancre --bg clair par défaut à `rgb(243, 246, 254)` depuis T2) — validé par
// balayage, cf. spec. L/C dérivés des hex actuels par conversion sRGB→OKLCH, SAUF :
// - brand et brandGradTop clairs : ajustés (L baissé, C réduit), seule façon de garantir
//   >= 4.5:1 sur les 360° (cf. spec — aucune réduction de C seule n'aurait suffi) ;
// - brandDeep clair : PAS un correctif AA (l'original passait déjà à 4,84:1) — juste
//   baissé en proportion de brand pour garder le même écart de luminosité entre les deux
//   (« encore plus sombre que brand »), sans quoi les deux se rapprocheraient trop après
//   la retouche de brand.
// tile clair garde sa chromaticité d'origine (0,0152, pas réduite) : l'écrêtage au gamut
// sur certaines teintes (mesuré : 44/72 valeurs testées) ne casse PAS le contraste (min
// 12,25:1, huge marge) — juste un très léger délavage cosmétique à ces teintes précises,
// invisible en pratique. La réduire aurait décalé la couleur PAR DÉFAUT du fond des
// cartes (`.card`/`.block`) pour tout le monde, pour gagner 0,13 point de contraste sur
// une paire qui n'en avait pas besoin — mauvais compromis, écarté.
const ROLES = {
  light: {
    brand: { L: 52, C: 0.1, off: 0.08 },
    brandDeep: { L: 47, C: 0.099, off: -2.05 },
    brandGradTop: { L: 54, C: 0.1, off: 2.39 },
    surface: { L: 92.11, C: 0.0218, off: 39.26 },
    surfaceLin: { L: 89.83, C: 0.0353, off: 19.19 },
    bg: { L: 97.4, C: 0.0114, off: 40.58 },
    page: { L: 92.17, C: 0.0235, off: 38.12 },
    tile: { L: 98.18, C: 0.0152, off: 33.07 },
  },
  dark: {
    brand: { L: 78.51, C: 0.1317, off: 33 },
    brandDeep: { L: 70.36, C: 0.1308, off: 30.49 },
    brandGradTop: { L: 83.43, C: 0.1247, off: 37.14 },
    surface: { L: 22.87, C: 0.0145, off: 13.46 },
    surfaceLin: { L: 26.39, C: 0.0198, off: 19.44 },
    bg: { L: 18.63, C: 0.0078, off: 4.28 },
    page: { L: 15.74, C: 0.0066, off: 11.82 },
    tile: { L: 25.59, C: 0.0188, off: 15.68 },
  },
}

// --on-accent : texte posé sur les surfaces ACCENT (brand / brand-grad), qui suivent la
// teinte. Valeurs d'origine de tokens.css ; depuis le 08/09 il bascule en plus sur la valeur
// sombre DANS la bande chaude claire (cf. WARM_BAND) — ce n'est donc plus une constante par
// thème, d'où --on-solid ci-dessous pour les fonds solides hors accent.
const ON_ACCENT = { light: '#fff', dark: '#2a1e08' }

// --on-solid : texte posé sur un fond solide QUI NE SUIT PAS la teinte (boutons --sage,
// bouton destructeur --danger, pastilles --mdc-* de l'éditeur Markdown, état :actif du
// bouton primaire sur --brand-deep…). Valeur STATIQUE par thème — identique à --on-accent
// en sombre ET hors bande chaude claire (zéro changement visible) ; dans la bande,
// --on-accent devient sombre (accent clair « sombre-adapté ») alors que ces fonds restent
// tels quels : ils gardent donc leur texte clair via --on-solid.
const ON_SOLID = { light: '#fff', dark: '#2a1e08' }

// Les 4 paliers de la grille calendaire (stats-grid.js::HEAT_COLORS), même mécanique que
// ROLES ci-dessus : L/C/off dérivés par conversion sRGB→OKLCH des hex actuels (reproduction
// exacte vérifiée à la teinte de référence 44), pour que le calendrier suive la teinte d'accent choisie
// sans jamais casser le validateur ordinal de stats-grid.js (teinte unique par palier,
// luminosité strictement monotone, écart ≥ 0,06) — L et C ne bougent pas avec la teinte,
// seul H tourne, donc ces invariants restent vrais pour n'importe quelle teinte choisie.
const HEAT_ROLES = {
  light: [
    { L: 75.15, C: 0.0849, off: 13.05 },
    { L: 64.48, C: 0.1034, off: 5.88 },
    { L: 56.53, C: 0.1142, off: 1.53 },
    { L: 47.93, C: 0.1258, off: -3.99 },
  ],
  dark: [
    { L: 42.85, C: 0.0614, off: 33.81 },
    { L: 55.52, C: 0.0889, off: 36.45 },
    { L: 67.65, C: 0.1121, off: 36.29 },
    { L: 78.51, C: 0.1317, off: 33.0 },
  ],
}

function normalizeHue(hue) {
  return ((hue % 360) + 360) % 360
}

// Bande chaude du mode CLAIR, bords INCLUS (40,5 est déjà le bord imposé par la garde
// >= 10° de --danger, H≈30,5). En clair, le rôle brand vit à L 52 / C 0,10 (choisi pour
// >= 4,5:1 avec le texte blanc) : à cette luminosité TOUTE la bande rend TERREUX —
// terracotta/brun à 44-65°, moutarde/olive à 70-110°. C'est la physique du texte blanc
// sur accent : un « orange » ou un « jaune » clair y est structurellement impossible
// (spec 08/09). Ces teintes basculent donc sur le rendu « sombre-adapté » du mode sombre :
// accent CLAIR (L/C du rôle brand sombre : 78,51/0,1317 et 83,43/0,1247) + texte SOMBRE
// --on-accent (#2a1e08, contraste mesuré ≈ 8:1) dessus, en gardant le DÉCALAGE de teinte
// du clair (off 0,08 / 2,39). --brand-deep, lui, reste STRICTEMENT le rôle clair (L 47) :
// c'est lui qui porte le texte d'accent sur fond clair partout — rien ne devient pâle.
// Le mode sombre n'est JAMAIS concerné : rendu inchangé sur toute la roue.
const WARM_BAND = { min: 40.5, max: 110 }

// Décide du basculement « sombre-adapté » : clair uniquement (toute valeur non 'dark' est
// rendue claire, cf. les replis ROLES/ON_ACCENT), teinte normalisée dans la bande.
export function warmAdapted(hue, effectiveTheme) {
  if (effectiveTheme === 'dark') return false
  const h = normalizeHue(hue)
  return h >= WARM_BAND.min && h <= WARM_BAND.max
}

// Rôle brand EFFECTIF pour cette teinte/thème : en bande chaude claire, L/C du sombre +
// off du clair. Partagé par generatePalette ET hueGradientCss — le curseur de glissé
// « s'ennoblit » pareil (ce qui rendait brun rend doré), sans cas spécial dans les
// composants ni duplication de la logique ici.
function brandRoleFor(hue, effectiveTheme) {
  const roles = ROLES[effectiveTheme] ?? ROLES.light
  if (!warmAdapted(hue, effectiveTheme)) return roles.brand
  return { L: ROLES.dark.brand.L, C: ROLES.dark.brand.C, off: roles.brand.off }
}

// Même basculement pour l'arrêt haut du dégradé de marque (brandGradTop).
function brandGradRoleFor(hue, effectiveTheme) {
  const roles = ROLES[effectiveTheme] ?? ROLES.light
  if (!warmAdapted(hue, effectiveTheme)) return roles.brandGradTop
  return { L: ROLES.dark.brandGradTop.L, C: ROLES.dark.brandGradTop.C, off: roles.brandGradTop.off }
}

// role: une entrée de ROLES[theme] ({ L, C, off }). hue: la teinte globale (0-360),
// pas encore décalée — le décalage propre au rôle est appliqué ici. format: la fonction de
// conversion OKLCH -> chaîne CSS à utiliser (oklchToCss pour rgb(), oklchToHex pour hex).
function roleValue(role, hue, format) {
  return format(role.L, role.C, normalizeHue(hue + role.off))
}

function roleCss(role, hue) {
  return roleValue(role, hue, oklchToCss)
}

// Triplet nu "r, g, b" (sans rgb(...)) — CSS ne permet pas d'injecter une alpha dans un
// var() qui contient déjà une fonction de couleur complète (rgba(var(--brand), .16) est
// invalide). Un remplissage translucide qui doit suivre la teinte choisie (retour terrain
// 26/08, bande « rang en cours ») a donc besoin de ce triplet séparé pour écrire
// rgba(var(--brand-rgb), .16) — au lieu d'un littéral figé qui ignorait la teinte.
function roleRgbTriplet(role, hue) {
  return roleValue(role, hue, (L, C, H) => oklchToRgb(L, C, H).join(', '))
}

// Hex du fond réel pour ce thème/cette teinte — utilisé par apply.js pour <meta
// theme-color> et la barre d'état Android (Capacitor exige du hex, pas du rgb()).
export function bgHex(hue, effectiveTheme) {
  const roles = ROLES[effectiveTheme] ?? ROLES.light
  return roleValue(roles.bg, hue, oklchToHex)
}

// effectiveTheme: 'light' | 'dark' (jamais 'system' — résoudre avant l'appel, cf.
// theme/resolve.js::resolveEffective). Toute autre valeur retombe sur 'light'. hue: la
// teinte globale choisie par l'utilisatrice (0-360).
export function generatePalette(hue, effectiveTheme) {
  const roles = ROLES[effectiveTheme] ?? ROLES.light
  const onAccent = ON_ACCENT[effectiveTheme] ?? ON_ACCENT.light
  // Bande chaude claire (cf. WARM_BAND) : l'accent devient clair (L/C sombres) => le texte
  // posé dessus bascule sur le sombre #2a1e08. brand et brandGradTop suivent le basculement
  // via les résolveurs partagés ; --brand-deep reste STRICTEMENT le rôle clair. Hors bande
  // et en sombre : rendu identique octet pour octet à l'ancien générateur.
  const brand = brandRoleFor(hue, effectiveTheme)
  const brandGradTop = brandGradRoleFor(hue, effectiveTheme)
  const onAccentEffectif = warmAdapted(hue, effectiveTheme) ? ON_ACCENT.dark : onAccent
  return {
    '--brand': roleCss(brand, hue),
    '--brand-rgb': roleRgbTriplet(brand, hue),
    '--brand-deep': roleCss(roles.brandDeep, hue),
    '--brand-grad': `linear-gradient(180deg, ${roleCss(brandGradTop, hue)}, ${roleCss(brand, hue)})`,
    '--surface': roleCss(roles.surface, hue),
    '--surface-lin': roleCss(roles.surfaceLin, hue),
    '--bg': roleCss(roles.bg, hue),
    '--page': roleCss(roles.page, hue),
    '--tile': roleCss(roles.tile, hue),
    '--on-accent': onAccentEffectif,
    '--on-solid': ON_SOLID[effectiveTheme] ?? ON_SOLID.light,
  }
}

// Les deux nuanciers du calendrier (clair + sombre à la fois, comme StatsHeatmap.vue en a
// besoin — c'est le CSS, pas ce module, qui choisit lequel s'affiche via data-theme).
// Palier 0 (aucune session) reste `null` : il ne se peint pas, cf. stats-grid.js.
export function generateHeatColors(hue) {
  return {
    light: [null, ...HEAT_ROLES.light.map((role) => roleValue(role, hue, oklchToHex))],
    dark: [null, ...HEAT_ROLES.dark.map((role) => roleValue(role, hue, oklchToHex))],
  }
}

// Dégradé CSS pour la barre de sélection de teinte (13 arrêts, tous les 30°) — même rôle
// "brand" que la génération réelle (décalage de rôle inclus, ET basculement « sombre-adapté »
// de la bande chaude claire via brandRoleFor : la bande entière du glissé s'ennoblit
// pareil), pour que la barre représente fidèlement ce qui sera appliqué.
export function hueGradientCss(effectiveTheme) {
  const stops = []
  for (let hue = 0; hue <= 360; hue += 30) {
    stops.push(roleCss(brandRoleFor(hue, effectiveTheme), hue))
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}

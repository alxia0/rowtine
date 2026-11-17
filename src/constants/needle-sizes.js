// Table de correspondance des tailles d'aiguilles et de crochets (stock d'outils, 14/11/2026).
// La taille est TOUJOURS stockée en mm ; US et UK sont dérivés ici, jamais enregistrés.
// Valeurs de départ : relevé Ravelry du 14/11/2026 (non rouvert depuis). Recoupées le
// 14/11/2026 avec KnitPro, LoveCrafts, Yarn and Fiber, Studio Koekoek et Crochet365KnitToo.
// Les tailles tricot sous 2 mm n'ont qu'un recoupement faible (Yarn and Fiber seul).
// `null` = pas d'équivalent connu ou non confirmé.
// Complète `NEEDLE_SIZES_MM` (src/utils/needle-gauge.js), qui reste le barème du
// recommandeur de taille et n'est pas modifié.

export const KNITTING_SIZES = [
  { mm: 0.5, us: '8/0', uk: null },
  { mm: 0.75, us: '6/0', uk: null },
  { mm: 1, us: '5/0', uk: null },
  { mm: 1.25, us: '4/0', uk: null },
  { mm: 1.5, us: '000', uk: null },
  { mm: 1.75, us: '00', uk: null },
  { mm: 2, us: '0', uk: '14' },
  { mm: 2.25, us: '1', uk: '13' },
  { mm: 2.5, us: '1½', uk: null },
  { mm: 2.75, us: '2', uk: '12' },
  { mm: 3, us: '2½', uk: '11' },
  { mm: 3.25, us: '3', uk: '10' },
  { mm: 3.5, us: '4', uk: null },
  { mm: 3.75, us: '5', uk: '9' },
  { mm: 4, us: '6', uk: '8' },
  { mm: 4.5, us: '7', uk: '7' },
  { mm: 5, us: '8', uk: '6' },
  { mm: 5.5, us: '9', uk: '5' },
  { mm: 6, us: '10', uk: '4' },
  { mm: 6.5, us: '10½', uk: '3' },
  { mm: 7, us: '10¾', uk: '2' },
  { mm: 7.5, us: null, uk: '1' },
  { mm: 8, us: '11', uk: '0' },
  { mm: 9, us: '13', uk: '00' },
  { mm: 10, us: '15', uk: '000' },
  { mm: 12, us: '17', uk: null },
  { mm: 15, us: '19', uk: null },
  { mm: 19, us: '35', uk: null },
  { mm: 25, us: '50', uk: null },
]

export const HOOK_SIZES = [
  { mm: 2, us: null },
  { mm: 2.25, us: 'B-1' },
  { mm: 2.5, us: null },
  { mm: 2.75, us: 'C-2' },
  { mm: 3, us: null },
  { mm: 3.25, us: 'D-3' },
  { mm: 3.5, us: 'E-4' },
  { mm: 3.75, us: 'F-5' },
  { mm: 4, us: 'G-6' },
  { mm: 4.5, us: '7' },
  { mm: 5, us: 'H-8' },
  { mm: 5.5, us: 'I-9' },
  { mm: 6, us: 'J-10' },
  { mm: 6.5, us: 'K-10½' },
  { mm: 7, us: null },
  { mm: 7.5, us: null },
  { mm: 8, us: 'L-11' },
  { mm: 9, us: 'M/N-13' },
  { mm: 10, us: 'N/P-15' },
  { mm: 12, us: 'O-16' },
  { mm: 15, us: 'P/Q' },
  { mm: 19, us: 'S' },
  { mm: 25, us: null },
]

export const STEEL_HOOK_SIZES = [
  { mm: 0.6, us: null },
  { mm: 0.7, us: null },
  { mm: 0.75, us: '14' },
  { mm: 0.85, us: '13' },
  { mm: 0.9, us: null },
  { mm: 1, us: '12' },
  { mm: 1.05, us: null },
  { mm: 1.1, us: '11' },
  { mm: 1.15, us: null },
  { mm: 1.25, us: null },
  { mm: 1.3, us: '10' },
  { mm: 1.4, us: '9' },
  { mm: 1.5, us: '8' },
  { mm: 1.65, us: '7' },
  { mm: 1.8, us: '6' },
  { mm: 1.9, us: '5' },
  { mm: 2, us: '4' },
  { mm: 2.1, us: '3' },
  { mm: 2.25, us: '2' },
  { mm: 2.75, us: '1' },
  { mm: 3.25, us: '0' },
  { mm: 3.5, us: '00' },
]

// Un crochet (standard ou tunisien) n'a qu'une échelle : les tailles fines de l'acier sous
// 2 mm suivies des tailles de 2 à 25 mm. C'est la MATIÈRE qui choisit l'équivalent US, pas le
// type : un crochet en acier prend le numéro acier (« 2,25 mm · US 2 »), un autre la lettre
// (« 2,25 mm · B-1 »). Sous 2 mm, seul le numéro acier existe en usage US : il sert aussi à
// un crochet d'une autre matière, faute de mieux.
const FINE_HOOK_MAX_MM = 2
const HOOK_SCALE_MM = [
  ...STEEL_HOOK_SIZES.filter((s) => s.mm < FINE_HOOK_MAX_MM).map((s) => s.mm),
  ...HOOK_SIZES.map((s) => s.mm),
]
const HOOK_TYPES = new Set(['standard', 'tunisian', 'hookKit'])

export function sizeScaleFor(type) {
  return HOOK_TYPES.has(type) ? 'hook' : 'knitting'
}

export function sizesFor(scale) {
  return scale === 'hook' ? [...HOOK_SCALE_MM] : KNITTING_SIZES.map((s) => s.mm)
}

// `material` ne compte que pour un crochet : 'steel' y donne le numéro acier quand la table
// acier connaît la taille, la lettre sinon.
export function sizeEquivalents(mm, scale, material = '') {
  const n = Number(mm)
  if (scale === 'hook') {
    const steel = STEEL_HOOK_SIZES.find((s) => s.mm === n)
    const hook = HOOK_SIZES.find((s) => s.mm === n)
    if (steel && (material === 'steel' || n < FINE_HOOK_MAX_MM)) return { us: steel.us ?? null, uk: null }
    return { us: hook?.us ?? null, uk: null }
  }
  const row = KNITTING_SIZES.find((s) => s.mm === n)
  return { us: row?.us ?? null, uk: row?.uk ?? null }
}

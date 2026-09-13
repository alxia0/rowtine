// Épaisseurs de fil (weight) et catégories de patron (PRD §7.3 / §7.7).
export const YARN_WEIGHTS = ['lace', 'fingering', 'sport', 'dk', 'worsted', 'aran', 'bulky', 'superbulky']
// Types de coloris d'une pelote/écheveau — une pelote « Uni » n'a qu'une seule teinte
// (vignette actuelle) ; les 4 autres décrivent une pelote multicolore (cf. yarn.colorNotes).
export const YARN_COLOR_TYPES = ['uni', 'degrade', 'auto-rayant', 'mouchete', 'teint-main']
export const PATTERN_CATEGORIES = [
  'clothing',
  'accessories',
  'socks',
  'home',
  'amigurumi',
  'toys',
  'leisure',
  'animals',
  'other',
]

// Affiche le libellé d'une catégorie de patron. Si « Autre » est choisi et qu'une
// catégorie libre a été saisie, on affiche celle-ci ; sinon le libellé traduit.
export function patternCategoryLabel(pattern, t) {
  if (!pattern?.category) return ''
  if (pattern.category === 'other' && pattern.categoryCustom?.trim()) return pattern.categoryCustom.trim()
  return t(`pattern.categories.${pattern.category}`)
}

// Marques de laine courantes (marché francophone + classiques internationaux +
// marques très référencées sur Ravelry, dont les filatures nordiques).
// Utilisé pour pré-remplir le menu déroulant d'ajout d'une laine ; l'utilisateur
// peut toujours saisir une marque libre via « Autre… ». La liste affichée fusionne
// ce catalogue avec les marques déjà présentes dans le stock (cf. StashView), et
// est triée à l'affichage — l'ordre ci-dessous (alphabétique) n'est qu'indicatif.
export const YARN_BRANDS = [
  'Adriafil',
  'Anny Blatt',
  'BC Garn',
  'Bergère de France',
  'Bernat',
  'Berroco',
  'Biscuit',
  "Bouton d'Or",
  'Brooklyn Tweed',
  'CaMaRose',
  'Caron',
  'Cascade Yarns',
  'Cheval Blanc',
  'Dale Garn',
  'De Rerum Natura',
  'Debbie Bliss',
  'Distrifil',
  'DMC',
  'Drops',
  'Filcolana',
  'Fonty',
  'Garthenor',
  'Gepard Garn',
  'ggh',
  'Hayfield',
  'Hjertegarn',
  'Hobbii',
  'Holst Garn',
  'Isager',
  'Ístex',
  'James C. Brett',
  "Jamieson's of Shetland",
  'Katia',
  'King Cole',
  'Knit Picks',
  'Knitting for Olive',
  'Koigu',
  'Lamana',
  'Lana Gatto',
  'Lana Grossa',
  'Lang Yarns',
  'Lion Brand',
  'Madelinetosh',
  'Malabrigo',
  'Manos del Uruguay',
  'Mondial',
  'Novita',
  'Önling',
  'Opal',
  'Phildar',
  'Plassard',
  'Plymouth Yarn',
  'Quince & Co',
  'Rauma Garn',
  'Red Heart',
  'Regia',
  'Rico Design',
  'Rosários 4',
  'Rowan',
  'Sandnes Garn',
  'Schachenmayr',
  'Scheepjes',
  'Schoppel Wolle',
  'Sirdar',
  'Stylecraft',
  'Svarta Fåret',
  'Sysleriget',
  'Universal Yarn',
  'We Are Knitters',
  'Wendy',
  'West Yorkshire Spinners',
  'Wollmeise',
  'Wool and the Gang',
]

// Catalogue du mémo des techniques de points : identifiants STABLES (clé de donnée de
// `pattern.stitchPins`, jamais affichés, jamais traduits) et ordre d'affichage.
// Les fiches rédigées vivent dans un fichier par langue (fr.js, en.js, de.js, es.js).
export const CRAFTS = ['crochet', 'knitting']

export const GROUPS = {
  crochet: ['base', 'shaping', 'construction', 'texture'],
  knitting: ['cast-on', 'bind-off', 'base', 'shaping', 'pattern', 'technique'],
}

export const STITCH_CATALOG = [
  { id: 'cr-ch', craft: 'crochet', group: 'base' },
  { id: 'cr-slst', craft: 'crochet', group: 'base' },
  { id: 'cr-sc', craft: 'crochet', group: 'base' },
  { id: 'cr-hdc', craft: 'crochet', group: 'base' },
  { id: 'cr-dc', craft: 'crochet', group: 'base' },
  { id: 'cr-tr', craft: 'crochet', group: 'base' },
  { id: 'cr-inc', craft: 'crochet', group: 'shaping' },
  { id: 'cr-dec', craft: 'crochet', group: 'shaping' },
  { id: 'cr-magic-ring', craft: 'crochet', group: 'construction' },
  { id: 'cr-rounds', craft: 'crochet', group: 'construction' },
  { id: 'cr-flo-blo', craft: 'crochet', group: 'construction' },
  { id: 'cr-color-change', craft: 'crochet', group: 'construction' },
  { id: 'cr-shell', craft: 'crochet', group: 'texture' },
  { id: 'cr-picot', craft: 'crochet', group: 'texture' },
  { id: 'cr-popcorn', craft: 'crochet', group: 'texture' },
  { id: 'cr-puff', craft: 'crochet', group: 'texture' },
  { id: 'cr-post', craft: 'crochet', group: 'texture' },
  { id: 'kn-co-long-tail', craft: 'knitting', group: 'cast-on' },
  { id: 'kn-co-tubular', craft: 'knitting', group: 'cast-on' },
  { id: 'kn-co-cable', craft: 'knitting', group: 'cast-on' },
  { id: 'kn-bo', craft: 'knitting', group: 'bind-off' },
  { id: 'kn-bo-tubular', craft: 'knitting', group: 'bind-off' },
  { id: 'kn-knit', craft: 'knitting', group: 'base' },
  { id: 'kn-purl', craft: 'knitting', group: 'base' },
  { id: 'kn-tbl', craft: 'knitting', group: 'base' },
  { id: 'kn-slip', craft: 'knitting', group: 'base' },
  { id: 'kn-yo', craft: 'knitting', group: 'base' },
  { id: 'kn-k2tog', craft: 'knitting', group: 'shaping' },
  { id: 'kn-p2tog', craft: 'knitting', group: 'shaping' },
  { id: 'kn-skp', craft: 'knitting', group: 'shaping' },
  { id: 'kn-ssk', craft: 'knitting', group: 'shaping' },
  { id: 'kn-cdd', craft: 'knitting', group: 'shaping' },
  { id: 'kn-m1', craft: 'knitting', group: 'shaping' },
  { id: 'kn-kfb', craft: 'knitting', group: 'shaping' },
  { id: 'kn-stockinette', craft: 'knitting', group: 'pattern' },
  { id: 'kn-garter', craft: 'knitting', group: 'pattern' },
  { id: 'kn-rib', craft: 'knitting', group: 'pattern' },
  { id: 'kn-seed', craft: 'knitting', group: 'pattern' },
  { id: 'kn-cable', craft: 'knitting', group: 'pattern' },
  { id: 'kn-short-rows-german', craft: 'knitting', group: 'technique' },
  { id: 'kn-pick-up', craft: 'knitting', group: 'technique' },
  { id: 'kn-kitchener', craft: 'knitting', group: 'technique' },
]

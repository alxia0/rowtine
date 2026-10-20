// Table de correspondance des termes US / UK (texte anglais, montrée telle quelle quelle que soit
// la langue de l'app). `stitch` renvoie à une fiche du catalogue quand il y en a une.
const row = (craft, id, us, uk, stitch) => ({ id, craft, us, uk, ...(stitch ? { stitch } : {}) })
const t = (name, ...abbr) => ({ name, abbr })

export const US_UK_TERMS = [
  row('crochet', 'sc-dc', t('single crochet', 'sc'), t('double crochet', 'dc'), 'cr-sc'),
  row('crochet', 'hdc-htr', t('half double crochet', 'hdc'), t('half treble crochet', 'htr'), 'cr-hdc'),
  row('crochet', 'dc-tr', t('double crochet', 'dc'), t('treble crochet', 'tr'), 'cr-dc'),
  row('crochet', 'tr-dtr', t('treble crochet', 'tr'), t('double treble crochet', 'dtr'), 'cr-tr'),
  row('crochet', 'sc2tog', t('single crochet 2 together', 'sc2tog'), t('double crochet 2 together', 'dc2tog'), 'cr-dec'),
  row('crochet', 'dc2tog', t('double crochet 2 together', 'dc2tog'), t('treble crochet 2 together', 'tr2tog')),
  row('crochet', 'post', t('front / back post double crochet', 'FPdc', 'BPdc'), t('front / back post treble or raised treble front / back', 'FPtr', 'BPtr', 'rtrf', 'rtrb'), 'cr-post'),
  row('crochet', 'slst', t('slip stitch', 'sl st'), t('slip stitch', 'ss'), 'cr-slst'),
  row('crochet', 'yoh', t('yarn over', 'yo'), t('yarn over hook', 'yoh')),
  row('knitting', 'yo', t('yarn over', 'yo'), t('yarn forward / yarn round needle / yarn over needle', 'yfwd', 'yrn', 'yon'), 'kn-yo'),
  row('knitting', 'stockinette', t('stockinette stitch', 'St st'), t('stocking stitch', 'St st'), 'kn-stockinette'),
  row('knitting', 'seed', t('seed stitch'), t('moss stitch'), 'kn-seed'),
  row('knitting', 'moss-double', t('moss stitch (two-row repeat)'), t('double moss stitch')),
  row('knitting', 'bind-off', t('bind off', 'BO'), t('cast off'), 'kn-bo'),
  row('knitting', 'psso', t('pass slipped stitch over', 'psso'), t('pass slipped stitch over', 'psso'), 'kn-skp'),
  row('general', 'gauge', t('gauge (stitches and rows over 4 inches)'), t('tension (stitches and rows over 10 cm)')),
  row('general', 'yarn', t('yarn'), t('wool (general term)')),
]

export const usUkTerms = (craft) => US_UK_TERMS.filter((r) => r.craft === craft)

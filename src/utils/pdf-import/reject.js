// Refus NETS de l'import PDF, dans l'ordre de la spec rowtine.app 2026-09-24 §3 : scanné,
// puis pas un patron de tricot ou de crochet, puis plusieurs patrons. Module PUR sur les pages
// extraites, appelé par parsePdfLocally AVANT l'assemblage (un refus ne coûte ni conversion,
// ni images, ni lecture du PDF) et par la commande de calage (tools/corpus/rejets-calage.mjs) :
// ce qui est mesuré est ce qui est livré. Les pauses réversibles (colonnes) restent dans
// computeBlocking (blocking.js), sur le patron assemblé.
import { detectCraft } from './craft-detect'
import { detectMultiPattern, MULTI_PATTERN_REJECTS } from './blocking'

export const SCANNED_CHARS_PER_PAGE = 50

export function isScannedPages(pages) {
  const list = Array.isArray(pages) ? pages : []
  if (!list.length) return true
  const chars = list.reduce(
    (a, p) => a + (Array.isArray(p) ? p : []).reduce((b, l) => b + String(l?.text || '').length, 0),
    0,
  )
  return chars / list.length < SCANNED_CHARS_PER_PAGE
}

// Codes machine (jamais une phrase) : `reason` et `detail` restent des identifiants stables,
// traduits côté vue. Assignés par variable puis retournés en raccourci d'objet (comme
// craft-detect.js), et non posés en toutes lettres dans l'objet retourné, pour ne pas
// déclencher la garde « aucun avertissement en français en dur »
// (tests/unit/warnings-no-french.spec.js), qui ne sait pas distinguer un code d'une phrase à
// ce point du texte.
export function detectRejection(pages) {
  let reason
  let detail = null
  if (isScannedPages(pages)) {
    reason = 'scanned'
  } else {
    const craft = detectCraft(pages)
    if (!craft.isPattern) {
      reason = 'notPattern'
      detail = craft.reason
    } else if (MULTI_PATTERN_REJECTS && detectMultiPattern(pages)) {
      reason = 'multiPattern'
    }
  }
  return reason ? { reason, detail } : null
}

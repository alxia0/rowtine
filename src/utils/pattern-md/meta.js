// Front-matter Rowtine-MD (anglicisé : voir dialect.js). La clé
// technique de version (`rowtine` depuis le renommage du 03/08/2026) reste
// toujours en tête et n'est jamais traduite. Émission ET lecture en anglais :
// la tolérance de lecture aux clés françaises historiques (titre, auteur,
// lien, tailles, sous-tailles, aisance) a été retirée le 07/09/2026 (décision
// produit, ménage du code hérité — zéro occurrence sur les 103 patron.md du
// corpus, mesure du 13/08). Une clé FR reçue aujourd'hui pousse
// l'avertissement META_UNKNOWN_KEY puis est ignorée — même traitement que
// `tricoche` depuis le 16/08.
import { frontmatterKeyToEn, frontmatterKeyToFr } from './dialect'
import { W, WARNING_CODES } from './warning-codes'

export const MD_VERSION = 1
// Clé de version du format, exportée pour que tout AUTRE émetteur de front-matter minimal
// (ex. fragment.js, éditeur MD in-app) la réutilise au lieu de la recopier en dur — un
// second littéral aurait dérivé silencieusement à un prochain renommage (revue finale du
// renommage Rowtine, 04/08/2026 : fragment.js l'avait fait une première fois).
export const VERSION_KEY = 'rowtine'
const SEP = ' · '
const SPLIT_RE = /\s*·\s*/

export function emitFrontMatter(pattern) {
  const r = pattern?.reader || {}
  // Clé de version du format. La clé historique `tricoche` (avant le renommage de
  // l'app du 03/08/2026) n'est PLUS acceptée en lecture depuis le 16/08/2026 : décision
  // produit. Un patron resté en `tricoche:` n'est PAS abîmé pour autant : parseFrontMatter
  // ci-dessous pousse l'avertissement META_UNKNOWN_KEY sur cette seule ligne puis `continue`
  // (ligne ~65) — titre, auteur, tailles restent lus normalement sur les lignes suivantes.
  // L'avertissement est visible à l'écran (i18n, 4 langues), et le fichier se répare de
  // lui-même à la sauvegarde suivante (emitFrontMatter réécrit toujours `rowtine:`).
  // Mesuré le 16/08/2026 : les deux appareils (tablette Nexus 7 + Huawei) ne portent plus
  // aucun patron en ancienne clé, sur 22 fichiers au total. La réécriture du
  // corpus archivé, elle, n'est pas encore faite.
  const lines = ['---', `${VERSION_KEY}: ${MD_VERSION}`]
  if (pattern?.name) lines.push(`${frontmatterKeyToEn('titre')}: ${pattern.name}`)
  if (pattern?.author) lines.push(`${frontmatterKeyToEn('auteur')}: ${pattern.author}`)
  if (pattern?.authorUrl) lines.push(`${frontmatterKeyToEn('lien')}: ${pattern.authorUrl}`)
  if (r.sizeLabels?.length) lines.push(`${frontmatterKeyToEn('tailles')}: ${r.sizeLabels.join(SEP)}`)
  if (r.sizeSub?.length) {
    const label = r.sizeSubLabel ? ` (${r.sizeSubLabel})` : ''
    lines.push(`${frontmatterKeyToEn('sous-tailles')}: ${r.sizeSub.join(SEP)}${label}`)
  }
  if (r.easeHint) lines.push(`${frontmatterKeyToEn('aisance')}: ${r.easeHint}`)
  lines.push('---', '')
  return lines.join('\n')
}

// Clés reconnues en lecture : les anglaises canoniques uniquement — l'émission
// (emitFrontMatter ci-dessus) n'écrit qu'elles. Les clés FR héritées (titre,
// auteur, lien, tailles, sous-tailles, aisance) ne sont plus reconnues depuis
// le 07/09/2026 : elles tombent dans le contrôle « clé inconnue » ci-dessous.
const KNOWN = new Set([
  'rowtine',
  'title', 'author', 'link', 'sizes', 'subsizes', 'ease',
])

export function parseFrontMatter(md) {
  const src = String(md ?? '').replace(/\r\n/g, '\n')
  const meta = { titre: '', auteur: '', lien: '', tailles: [], sousTailles: [], sousTaillesLabel: '', aisance: '' }
  const warnings = []
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src)
  if (!m) {
    warnings.push(W(WARNING_CODES.META_NO_FRONTMATTER))
    return { meta, body: src, warnings }
  }
  for (const raw of m[1].split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const kv = /^([^:]+):\s*(.*)$/.exec(line)
    if (!kv) { warnings.push(W(WARNING_CODES.META_UNREADABLE_LINE, { line })); continue }
    const rawKey = kv[1].trim().toLowerCase()
    const val = kv[2].trim()
    if (!KNOWN.has(rawKey)) { warnings.push(W(WARNING_CODES.META_UNKNOWN_KEY, { key: rawKey })); continue }
    // Clé canonique FR (interne) : traduit la seule forme acceptée en fichier
    // (EN, cf. KNOWN) vers la clé interne FR. Depuis le retrait des clés FR,
    // frontmatterKeyToFr ne reçoit plus ici jamais de clé déjà FR — son repli
    // « renvoie tel quel » reste une propriété générique du dialecte
    // (dialect.js), pas une tolérance de ce lecteur.
    const key = frontmatterKeyToFr(rawKey)
    if (key === 'titre') meta.titre = val
    else if (key === 'auteur') meta.auteur = val
    else if (key === 'lien') meta.lien = val
    else if (key === 'aisance') meta.aisance = val
    else if (key === 'tailles') meta.tailles = val ? val.split(SPLIT_RE).filter(Boolean) : []
    else if (key === 'sous-tailles') {
      const lm = /^(.*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(val)
      const values = (lm ? lm[1] : val)
      meta.sousTailles = values ? values.split(SPLIT_RE).filter(Boolean) : []
      meta.sousTaillesLabel = lm ? lm[2] : ''
    }
  }
  return { meta, body: src.slice(m[0].length), warnings }
}

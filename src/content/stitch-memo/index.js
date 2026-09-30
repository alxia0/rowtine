// Point d'accès unique au mémo des techniques de points. Repli de langue PAR FICHE (une
// fiche absente d'une langue ne fait pas disparaître le mémo), même ordre que le reste
// du contenu localisé (resolve-localized-content.js : anglais puis français).
import { STITCH_CATALOG, GROUPS } from './catalog'
import { STITCH_MEMO_FR } from './fr'
import { STITCH_MEMO_EN } from './en'
import { STITCH_MEMO_DE } from './de'
import { STITCH_MEMO_ES } from './es'
import { resolveLocalized } from '../resolve-localized-content'

export const STITCH_CONTENT = { fr: STITCH_MEMO_FR, en: STITCH_MEMO_EN, de: STITCH_MEMO_DE, es: STITCH_MEMO_ES }

const BY_ID = new Map(STITCH_CATALOG.map((s, i) => [s.id, { ...s, order: i }]))

export function resolveStitch(id, locale) {
  const meta = BY_ID.get(id)
  if (!meta) return null
  const perLang = Object.fromEntries(Object.entries(STITCH_CONTENT).filter(([, d]) => d[id]).map(([l, d]) => [l, d[id]]))
  const hit = resolveLocalized(perLang, locale)
  if (!hit) return null
  const f = hit.entry
  return { id, craft: meta.craft, group: meta.group, name: f.name, abbr: f.abbr || [], steps: f.steps || [], tip: f.tip || null }
}

export function resolveStitches(ids, locale) {
  const known = [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => BY_ID.has(id))
  known.sort((a, b) => BY_ID.get(a).order - BY_ID.get(b).order)
  return known.map((id) => resolveStitch(id, locale)).filter(Boolean)
}

export function stitchesByGroup(craft, locale) {
  return (GROUPS[craft] || [])
    .map((group) => ({ group, stitches: STITCH_CATALOG.filter((s) => s.craft === craft && s.group === group).map((s) => resolveStitch(s.id, locale)).filter(Boolean) }))
    .filter((g) => g.stitches.length)
}

// Normalisation d'une abréviation pour comparer glossaire du patron et fiches : minuscules,
// qualificatif (US)/(UK) retiré, espaces et points retirés.
const norm = (s) => String(s || '').toLowerCase().replace(/\((us|uk)\)/g, '').replace(/[\s.]/g, '')

// Abréviations jamais indexées pour la suggestion : « AM » désigne l'anneau marqueur dans le
// glossaire des patrons de tricot (démo FR) alors que c'est l'anneau magique au crochet. La
// fiche garde l'abréviation affichée et cherchable, seule la suggestion l'ignore.
const NO_SUGGEST = new Set(['am'])

// Index abréviation normalisée → identifiants, toutes langues confondues (un patron anglais
// lu dans une app en français doit suggérer la maille serrée pour « sc »).
const ABBR_INDEX = (() => {
  const idx = new Map()
  for (const dict of Object.values(STITCH_CONTENT)) {
    for (const [id, f] of Object.entries(dict)) {
      for (const a of f.abbr || []) {
        const k = norm(a)
        if (!k || NO_SUGGEST.has(k)) continue
        if (!idx.has(k)) idx.set(k, new Set())
        idx.get(k).add(id)
      }
    }
  }
  return idx
})()

export function suggestStitches(abbrKeys) {
  const hits = new Set()
  for (const key of Array.isArray(abbrKeys) ? abbrKeys : []) for (const id of ABBR_INDEX.get(norm(key)) || []) hits.add(id)
  return STITCH_CATALOG.map((s) => s.id).filter((id) => hits.has(id))
}

// Recherche d'une fiche par saisie libre (sélecteur et page Outils) : nom et abréviations,
// insensible à la casse et aux accents. Requête vide : tout correspond.
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

export function matchesQuery(stitch, query) {
  const needle = fold(String(query || '').trim())
  return !needle || fold([stitch.name, ...(stitch.abbr || [])].join(' ')).includes(needle)
}

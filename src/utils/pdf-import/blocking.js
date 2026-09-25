// Détection PURE des cas d'import risqués ou refusés.
// - `columns` (≥ 3 colonnes sur une page) : pause RÉVERSIBLE, l'UI propose « Importer quand
//   même » (règle « jamais perdre d'info »).
// - `multiPattern` (recueil) : REFUS net, porté par reject.js (variante A du plan
//   2026-09-24, décision de la propriétaire). computeBlocking ne le pose plus comme pause.

import { ROW_START_RE } from './segment'

// Variante A du plan 2026-09-24-rejets-import (décision de la propriétaire) : le détecteur
// resserré atteint 0 faux positif sur le corpus réel, un recueil est REFUSÉ par reject.js.
// La constante ne suffit plus à revenir à la variante B (pause réversible) : les vues ne
// listent plus que la pause `columns` (écran d'import de l'application, LocalPdfImportView.vue,
// depuis b98fd983 ; convertisseur du site, ConvertisseurIsland.vue, qui n'a qu'un message de
// refus) ; il faudrait y rétablir l'entrée `multiPattern` et son libellé de pause, en plus de
// passer ce drapeau à false.
export const MULTI_PATTERN_REJECTS = true

// Nombre de pages dé-colonnées en ≥3 colonnes (chaque ligne d'une telle page porte
// `multiCol`, posé par lines.js). Signal géométrique mesuré, pas une promesse : les faux
// « colonnes » d'autrefois (sous-blocs indentés dans une colonne légitime, mesuré Cortina
// EN p.2 le 23/07 — 26 rangées piétinées vs 4 occupées) sont écartés depuis le 04/09 par
// la garde « ratio d'occupation du couloir » de detectColumns ; restent de vraies pages
// ≥3 colonnes, tableaux multi-tailles compris (sectionnés colonne par colonne, pas
// mélangés — ex. klara, glow-check, défaut de lecture de tableau connu). Corpus au 04/09 :
// 138 → 107 PDF bloqués « columns » (202 → 158 pages multiCol). L'échappatoire « Importer
// quand même » reste la soupape (haute précision visée, pas 100 %).
export function countMultiColPages(pages) {
  return (pages || []).filter((p) => Array.isArray(p) && p.some((l) => l && l.multiCol)).length
}

// En-tête « matériel / fournitures » (multilingue). Seul, il ne dit rien : une couverture le
// répète, un patron multilingue en porte un par langue. Ancien détecteur (≥ 2 pages portant
// l'en-tête) : 41 vrais patrons déclarés recueils. Détecteur resserré ci-dessous, avec le
// seuil de 3 patrons (MIN_BOOK_PATTERNS) : 0 faux positif sur les 3248 patrons uniques
// mesurés, 2/5 recueils détectés, relevé 2026-09-24 (rapport
// …/Patrons/rejets-calage/2026-09-24-multiPattern-v11.md). Détectés : le recueil construit de
// (3 patrons) et 5-Cozy-Crochet-Patterns-eBook-2024 (5 patrons, rangé dans le corpus positif,
// reconnu comme recueil par la propriétaire le 2026-09-24). Non détectés : les recueils
// construits fr et en, où seuls 2 patrons sont comptés (au seuil de 2, v10, ils l'étaient),
// et le recueil publié Interweave (7 patrons), qui n'a AUCUN en-tête « Materials » mais des
// étiquettes « Yarn: / Needles: / Notions: » ; ce détecteur ne connaît que les recueils à
// en-têtes. Un recueil manqué s'importe comme un patron : l'erreur tolérée, à l'inverse
// d'un refus à tort, qui n'a pas de recours.
const MATERIALS_HEADING_RE =
  /^\s*(?:mat[eé]riel|fournitures|materials?|you\s+will\s+need|materiaal|benodigdheden|material(?:i|es)?)\s*:?\s*$/i
const MIN_BOOK_PAGES = 4 // en dessous, 2 en-têtes = trop peu de signal (faux positifs)
// Décision de la propriétaire, 2026-09-24 08:41 (choix B) : un recueil a au moins 3 patrons.
// Un ensemble de deux pièces (« Bonnet » puis « Snood ») sans mot de variante n'est donc
// jamais refusé. Reliquat connu : un ensemble de TROIS pièces sans mot de variante en titre
// reste pris pour un recueil.
const MIN_BOOK_PATTERNS = 3

// Candidat 1 (spec §4.2) : un en-tête ne compte que s'il est suivi, SUR SA PAGE, d'au moins
// MIN_SUPPLY_LINES lignes courtes de fournitures parmi les SUPPLY_WINDOW suivantes. Il écarte
// les en-têtes nus (Poncho Kristen, el-chaleco…). Valeurs du plan, gardées au calage.
const SUPPLY_WINDOW = 8
const MIN_SUPPLY_LINES = 2
const SUPPLY_LINE_MAX = 120
const SUPPLY_LINE_RE =
  /(?<![\p{L}\p{N}])(?:\d+(?:[.,]\d+)?\s*(?:g|gr|m|mm|cm|yds?|yards?|oz)|pelotes?|balls?|skeins?|hanks?|knäuel|ovillos?|madejas?|gomitol\p{L}*|bollen|nøgler?|nystan|kerä\p{L}*|aiguilles?|needles?|\p{L}*nadel\p{L}*|agujas?|ferri|\p{L}*naald\p{L}*|pind\p{L}*|pinn\p{L}*|stick\p{L}*|puik\p{L}*|drut\p{L}*|crochet|hooks?|ganchillo|uncinetto|\p{L}*nål|virkkuukouk\p{L}*|szydeł\p{L}*|marqueurs?|markers?|marcadores?)(?![\p{L}\p{N}])/iu
// calé 2026-09-24 : une référence de coloris (« color 22 », « Col. 44 », « Farbe 84 ») compte
// comme fourniture, mais SEULEMENT si la ligne porte aussi une quantité (un autre nombre).
// Sans cette branche, l'en-tête d'Agnes (recueil Hobbii en : « 4 (4) (5) 5 Alpaca Silk,
// color 22 & », une seule ligne à unité) n'était pas réel et le recueil en passait inaperçu
// (2/3 détectés). Sans la quantité exigée, une ligne de nuancier (« Col. 44 vert ») suffirait.
const COLOR_REF_RE = /(?<![\p{L}\p{N}])(?:colou?r|col|coul|couleur|coloris|fb|farbe)\.?\s*(?:n[°º.]?\s*)?\d+(?![\p{L}\p{N}])/giu

function isSupplyLine(t) {
  if (t.length > SUPPLY_LINE_MAX) return false
  if (SUPPLY_LINE_RE.test(t)) return true
  const withoutRefs = t.replace(COLOR_REF_RE, ' ')
  return withoutRefs !== t && /\d/.test(withoutRefs)
}

// Candidat 2 : deux en-têtes réels ne font deux patrons que si un titre NOUVEAU (corps au
// moins TITLE_SIZE_RATIO fois la médiane du document, jamais vu avant, hors liste de
// fournitures) ou un bloc de tailles DIFFÉRENT du précédent s'intercale. Seul, il laissait
// 13 faux positifs (v4) : sur les fiches Hobbii « Go handmade », la page de photos légendée
// en 16-18 pt (2 à 2,24 fois la médiane) arme la séparation, et le recueil réel du corpus
// titre ses patrons à 1,94 fois la sienne : aucun seuil de corps ne sépare les deux (v5 :
// 2,5 perdait le recueil réel). D'où les deux gardes suivantes, porteuses toutes deux.
// calé 2026-09-24 : 1,4 gardé. 1,5 retirait 5 faux positifs avant la garde des rangs (v3),
// plus aucun après : 0 faux positif mesuré de 1,2 à 1,5.
const TITLE_SIZE_RATIO = 1.4
const SIZES_LINE_RE =
  /^\s*(?:tailles?|sizes?|gr(?:ö|oe)(?:ß|ss)en?|tallas?|taglie|maten|størrelser?|storlek(?:ar)?|koot|rozmiary?)\s*:\s*(\S.*)$/iu

// Garde des rangs (calé 2026-09-24, écart au plan) : un patron a un corps. Sans rangs
// (ROW_START_RE, « Rang 1 », « Row 3 », « Tour 2 »…) entre deux en-têtes réels, le premier
// n'était qu'une couverture ou un résumé : 12 faux positifs retirés (fiches Hobbii « Go
// handmade », couverture p. 1 avec sa liste, patron p. 3), aucun recueil perdu. Les rangs sont
// comptés dans analyzeMultiPattern ; le détecteur est celui de segment.js, partagé.
// calé 2026-09-24 (revue) : plancher porté de 1 à 2 rangs. Mesuré : les 17 en-têtes réels
// écartés « sans rang » du corpus positif en ont 0, et le recueil fr compte son 3e patron
// avec exactement 2 rangs (marge nulle) ; un plancher de 3 le perdrait. 2 ne change aucun
// compte mesuré et tolère une ligne « Rang 1 » isolée dans une couverture.
const MIN_BODY_ROWS = 2

// Garde des langues (calé 2026-09-24, écart au plan) : un recueil est écrit dans une langue,
// un patron multilingue apporte un en-tête par langue NOUVELLE, avec des tailles traduites que
// le candidat 2 prend pour « différentes ». Une langue jamais vue ne compte donc pas pour un
// nouveau patron ; une langue déjà vue, si (recueil fr dont le premier patron, 8036-436, est
// en six langues). Retire 8036-436 et Wilkinson (en/fr/de) ; sans elle, Wilkinson revient.
// « Material » est allemand, anglais au singulier ou espagnol : sa langue se lit dans les
// lignes qui le suivent sur sa page (MATERIAL_LANG_WINDOW), par des mots-outils et des mots
// de fournitures propres à chaque langue (MATERIAL_LANG_WORDS). Sans vainqueur net (au moins
// MATERIAL_LANG_MIN mots, et plus que chacune des deux autres langues), il garde sa propre
// classe « material », comme avant la revue de la tâche 5.
// Limite connue : un recueil dont les patrons changent de langue (le 2e en allemand après un
// 1er en anglais) n'est pas détecté, chaque langue nouvelle passant pour une traduction ; de
// même un recueil anglais qui alterne « Materials » et « Material » quand la liste qui suit
// « Material » ne dit pas sa langue. Faux négatif toléré : le recueil s'importe comme un patron.
const MATERIAL_LANG_WINDOW = 12
const MATERIAL_LANG_MIN = 2
const MATERIAL_LANG_WORDS = {
  de: /(?<![\p{L}\p{N}])(?:und|mit|für|der|die|das|den|dem|oder|ein|eine|einen|knäuel|wolle|garn|farbe|nadel\p{L}*|\p{L}+nadel\p{L}*|maschen\p{L}*|reihen?|runden?)(?![\p{L}\p{N}])/giu,
  en: /(?<![\p{L}\p{N}])(?:and|with|the|of|for|or|balls?|skeins?|yarn|needles?|colou?r|stitch(?:es)?|sts|rows?|rounds?|hook)(?![\p{L}\p{N}])/giu,
  es: /(?<![\p{L}\p{N}])(?:y|con|de|del|para|las?|los|el|ovillos?|madejas?|lana|agujas?|puntos?|vueltas?|hileras?|ganchillo)(?![\p{L}\p{N}])/giu,
}

function materialLang(lines, i) {
  const text = lines
    .slice(i + 1, i + 1 + MATERIAL_LANG_WINDOW)
    .map((l) => String(l?.text || ''))
    .join(' ')
  const scores = Object.entries(MATERIAL_LANG_WORDS).map(([lang, re]) => [lang, (text.match(re) || []).length])
  scores.sort((a, b) => b[1] - a[1])
  const [[best, n], [, second]] = scores
  return n >= MATERIAL_LANG_MIN && n > second ? best : 'material'
}

function headingLang(lines, i) {
  const w = String(lines[i]?.text || '').trim().toLowerCase().replace(/\s*:?\s*$/, '')
  if (/^(?:mat[eé]riel|fournitures)$/.test(w)) return 'fr'
  if (/^(?:materials|you\s+will\s+need)$/.test(w)) return 'en'
  if (w === 'materiales') return 'es'
  if (w === 'materiali') return 'it'
  if (/^(?:materiaal|benodigdheden)$/.test(w)) return 'nl'
  if (w === 'material') return materialLang(lines, i)
  return w
}

// Garde des variantes (décision de la propriétaire, 2026-09-24 08:28) : un PDF qui décrit
// des VARIANTES d'un même patron n'est jamais un recueil, même quand chaque variante a son
// titre, sa liste, ses tailles et ses rangs (adulte/enfant, ensemble assorti, tricot/crochet,
// manches courtes/longues). Une ligne « de titre » (corps ≥ TITLE_SIZE_RATIO fois la
// médiane, grasse, ou dans les VARIANT_NEAR lignes qui précèdent un en-tête « matériel ») de
// VARIANT_LINE_MAX caractères au plus, qui porte un mot de variante, suffit à écarter le
// document entier : dans le doute, on laisse passer (un refus n'a pas de recours).
// calé 2026-09-24 : aucune de ces lignes dans les 4 recueils détectés (3 construits + Cozy) ;
// 165 patrons uniques du corpus positif en portent une (« enfant » 100 fois, « set » et
// « ensemble » 13, « adult » 8…), sans effet puisqu'ils ne sont pas des recueils. Piste
// écartée : un mot commun aux titres intercalés. Mesuré, les vrais recueils en partagent
// (Cozy : « Cabled » p. 4 et 11, « Cozy » au titre du livre et p. 49 ; recueil en :
// « Sweater » chez Agnes et Amalie), et une liste de mots génériques à exclure serait sans fin.
// Faux négatifs tolérés (re-revue) : « kids? », « set » et « \p{L}*versions? » débordent
// (« set » en titre d'un patron de recueil, « conversion » dans « Conversion chart »), et
// écartent alors un vrai recueil : il s'importe comme un patron, ce qui reste permis.
const VARIANT_LINE_MAX = 60
const VARIANT_NEAR = 3
const VARIANT_RE =
  /(?<![\p{L}\p{N}])(?:\p{L}*versions?|versión|versiones|variantes?|variants?|variations?|adultes?|enfants?|adults?|child(?:ren)?|kids?|erwachsenen?|kinder\p{L}*|adultos?|niños?|niñas?|assortie?s?|matching|passende?[nrs]?|a\s+juego|ensemble|conjunto|set|manches\s+(?:courtes|longues)|short\s+sleeves?|long\s+sleeves?|kurzarm\p{L}*|langarm\p{L}*|mangas?\s+(?:corta|larga)s?)(?![\p{L}\p{N}])/iu

function findVariant(list, median) {
  for (let pi = 0; pi < list.length; pi++) {
    const lines = Array.isArray(list[pi]) ? list[pi] : []
    for (let i = 0; i < lines.length; i++) {
      const t = String(lines[i]?.text || '').trim()
      if (!t || t.length > VARIANT_LINE_MAX || !VARIANT_RE.test(t)) continue
      const titleLike =
        (median && Number(lines[i]?.size) >= TITLE_SIZE_RATIO * median) ||
        lines[i]?.bold === true ||
        lines.slice(i + 1, i + 1 + VARIANT_NEAR).some((x) => MATERIALS_HEADING_RE.test(String(x?.text || '')))
      if (titleLike) return `p${pi + 1} : ${t}`
    }
  }
  return null
}

const t0 = (s) => String(s).trim().slice(0, 60)
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '')

function isRealMaterialsHeading(lines, i) {
  let supplies = 0
  for (let j = i + 1; j < lines.length && j <= i + SUPPLY_WINDOW; j++) {
    const t = String(lines[j]?.text || '')
    if (MATERIALS_HEADING_RE.test(t)) break
    if (isSupplyLine(t)) supplies += 1
  }
  return supplies >= MIN_SUPPLY_LINES
}

export function analyzeMultiPattern(pages) {
  const list = Array.isArray(pages) ? pages : []
  const sizes = []
  for (const p of list) {
    for (const l of Array.isArray(p) ? p : []) if (Number.isFinite(l?.size) && l.size > 0) sizes.push(l.size)
  }
  sizes.sort((a, b) => a - b)
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0
  const seenTitles = new Set()
  const seenLangs = new Set()
  const trace = []
  let lastSizes = null
  let armed = false
  let armedBy = null
  let rows = 0 // rangs (« Rang 1 », « Row 3 »…) lus depuis le dernier en-tête réel
  let headings = 0
  let realHeadings = 0
  let patterns = 0
  list.forEach((p, pageIndex) => {
    const lines = Array.isArray(p) ? p : []
    let supplyEnd = -1 // dernière ligne de la fenêtre de fournitures d'un en-tête réel de cette page
    lines.forEach((l, i) => {
      const text = String(l?.text || '')
      if (MATERIALS_HEADING_RE.test(text)) {
        headings += 1
        const real = isRealMaterialsHeading(lines, i)
        let counted = false
        let why = null
        let lang = null
        if (real) {
          realHeadings += 1
          lang = headingLang(lines, i)
          // Langue jamais vue après un premier patron : la traduction du même patron.
          const translation = patterns > 0 && !seenLangs.has(lang)
          seenLangs.add(lang)
          // Sans MIN_BODY_ROWS rangs depuis l'en-tête précédent, le patron d'avant n'avait pas de corps :
          // c'était une couverture ou un résumé, pas un patron à part entière.
          if (patterns === 0 || (armed && !translation && rows >= MIN_BODY_ROWS)) {
            patterns += 1
            counted = true
          } else why = !armed ? 'sans séparateur' : translation ? 'traduction' : 'sans rang'
          armed = false
        }
        trace.push({ page: pageIndex + 1, text: text.trim(), real, counted, by: counted ? armedBy : null, why, lang, rows })
        if (real) {
          armedBy = null
          rows = 0
          supplyEnd = i + SUPPLY_WINDOW
        }
        return
      }
      if (ROW_START_RE.test(text)) rows += 1
      const sm = SIZES_LINE_RE.exec(text)
      if (sm) {
        const s = norm(sm[1])
        if (lastSizes !== null && s !== lastSizes && patterns > 0) {
          armed = true
          armedBy = `tailles p${pageIndex + 1} : ${t0(text)}`
        }
        lastSizes = s
        return
      }
      const t = text.trim()
      if (i <= supplyEnd) return // une ligne de la liste de fournitures n'est jamais un titre
      if (median && Number(l?.size) >= TITLE_SIZE_RATIO * median && t.length >= 3 && t.length <= 80) {
        const key = norm(t)
        if (!seenTitles.has(key)) {
          if (patterns > 0) {
            armed = true
            armedBy = `titre p${pageIndex + 1} : ${t0(t)}`
          }
          seenTitles.add(key)
        }
      }
    })
  })
  return { pages: list.length, headings, realHeadings, patterns, variant: findVariant(list, median), trace }
}

export function detectMultiPattern(pages) {
  const a = analyzeMultiPattern(pages)
  return a.pages >= MIN_BOOK_PAGES && a.patterns >= MIN_BOOK_PATTERNS && !a.variant
}

export function computeBlocking(pages) {
  const reasons = []
  if (countMultiColPages(pages) > 0) reasons.push('columns')
  if (!MULTI_PATTERN_REJECTS && detectMultiPattern(pages)) reasons.push('multiPattern')
  return { blocked: reasons.length > 0, reasons }
}

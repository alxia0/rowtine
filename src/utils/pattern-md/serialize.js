// patternToMd : objet pattern (avec reader) → { md, files }.
// Pur, imports relatifs (exécutable sous Node par le banc corpus).
import { sectionKind, DEFAULT_KIND } from '../section-kinds'
import { photoFileName, parseDataUrl } from '../../backup/naming'
import { stepTextToMd, mdTextToStep } from './line'
import { emitFrontMatter, mdScalar, mdSizeLabel } from './meta'
import { emitStepCounter, legacyRepeatTotal } from './counters'
import { referenceToFlat } from './reference-flat'
import { referenceBlocksToMd, reservedKey } from './refblocks'
import { kindToEn, REF_TO_EN, readDirToMd, chartShapeToMd } from './dialect'
import { TITLE_KIND_RE } from './md-line-type'

// Un pas répétition peut-il rester en forme legacy « - × <texte rendu> » sans perte ?
// La forme legacy est relue par le lecteur (parse.js) qui reconstruit `total` à partir
// du SEUL texte, via l'échelle partagée legacyRepeatTotal (counters.js) : compte explicite
// « N fois/times/volte/… », vecteur de tailles ({{i}} → c[0]), puis PREMIER nombre nu.
// On ne garde donc « - × text » que si cette relecture SIMULÉE — le chemin exact qu'empruntera
// le lecteur — rend EXACTEMENT `total` ; sinon on bascule sur le marqueur {×N}.
//
// `text` = forme RENDUE (stepTextToMd), pas st.t (qui porte des {{i}} bruts).
//
// L'ancien « cas 2 » (chaque valeur de `total` présente comme nombre dans le texte rendu)
// a été RETIRÉ (D2, défaut vague 2) : c'est lui qui laissait la corruption passer. Sur
// « Ripeti queste 2 righe 7 volte », le « 7 » figurait bien comme nombre (donc legacy
// conservé), mais la relecture legacy ne connaissait que times|fois et retombait sur le
// PREMIER nombre du texte (« 2 ») : le patron repartait ré-enregistré avec 2 répétitions.
// La PRÉSENCE d'un nombre dans le texte ne prouve rien sur ce que la relecture en fera —
// seul le critère d'égalité exacte avec le chemin réel du lecteur garantit la fidélité.
function legacyRepeatIsLossless(text, total, n) {
  const want = (total || []).map(Number)
  if (!want.length) return true // rien à préserver → pas de perte possible
  const read = legacyRepeatTotal(mdTextToStep(String(text ?? ''), n), n)
  return !!read && read.length === want.length && read.every((v, i) => Number(v) === want[i])
}

// Décision C3 (docs/2026-09-02-NOTE-TRANCHEMENT-intents.md) : le libellé affiché servait
// seul de clé de reconnaissance de l'intro — une section de TRAVAIL coïncidemment titrée
// « Présentation » aurait été absorbée à tort (perte de son ## au round-trip). parseIntro
// (parse.js) pose déjà un id stable ('presentation', non dérivé du titre) : on le préfère
// quand il est renseigné. Depuis l'intent 2026-09-07, `title` vaut aussi 'presentation'
// par construction (survie de l'id à travers normalizeReaderForSave) ; le fallback sur le
// titre s'applique seulement aux anciens patrons dont la section n'aurait jamais transité
// par cette version de parseIntro. Repli tolérant uniquement — aucune migration requise.
function isIntro(sec) {
  if (!sec || (sec.steps || []).length === 0 || !(sec.steps || []).every((s) => s.note)) return false
  return sec.id ? sec.id === 'presentation' : sec.title === 'Présentation'
}

// Un titre de kind par défaut s'émet nu (`## Titre`), sauf s'il serait mal relu : vide (`## `
// n'est pas un titre), réservé (`## Fil` redevient un bloc de référence), ou finissant par
// `{…}` (pris pour une balise). La section disparaissait ou changeait de kind et d'id, donc
// la progression était perdue. La balise explicite lève l'ambiguïté.
function titleNeedsKindTag(title) {
  return !title.trim() || reservedKey(title) != null || TITLE_KIND_RE.test(title.trimEnd())
}

export function patternToMd(pattern, { assetDir = 'img', galleryPrefix = 'galerie-' } = {}) {
  const reader = pattern?.reader || { sizeLabels: [], sections: [] }
  const n = (reader.sizeLabels || []).length
  const files = []
  const asset = (src, prefix = 'photo-') => {
    if (typeof src !== 'string' || !src.startsWith('data:')) return src || ''
    const name = prefix + photoFileName(src, files.length).slice('photo-'.length)
    // assetDir vide (nommage à plat aligné sauvegarde) : pas de "/" superflu en tête.
    const path = assetDir ? `${assetDir}/${name}` : name
    if (!files.some((f) => f.path === path)) {
      const parsed = parseDataUrl(src)
      files.push({ path, data: parsed ? parsed.base64 : '', encoding: 'base64' })
    }
    return path
  }

  const out = [emitFrontMatter(pattern)]
  const sections = [...(reader.sections || [])]

  if (isIntro(sections[0])) {
    for (const st of sections.shift().steps) {
      out.push(mdScalar(stepTextToMd(st.t, st.c)), '')
      for (const img of st.imgs || []) out.push(`![](${asset(img)})`, '')
    }
  }

  const refMd = referenceBlocksToMd(referenceToFlat(reader.reference), (reader.sizeLabels || []).map(mdSizeLabel))
  if (refMd) out.push(refMd)

  for (const sec of sections) {
    const kind = sectionKind(sec)
    const title = mdScalar(sec.title)
    const tagged = kind !== DEFAULT_KIND || titleNeedsKindTag(title)
    out.push(`## ${title}${tagged ? ` {${kindToEn(kind)}}` : ''}`, '')
    for (const st of sec.steps || []) {
      if (st.chart) {
        // Rétrocompat : patrons pré-multi-grilles où seul reader.chart (global) est renseigné,
        // sans section.chart (ex. data déjà persistée avant ce lot ; normalizeReaderForSave ne
        // rétro-remplit pas section.chart). Une section {chart} multi-grilles porte toujours SA
        // propre grille, donc ce repli n'est consulté que pour les anciens patrons.
        const ch = sec.chart || reader.chart
        // Étape diagramme sans grille exploitable : rien à émettre (non-invention).
        if (!(ch && ch.img)) continue
        out.push('', `![Diagramme](${asset(ch.img)})`)
        // Diagramme fraîchement promu (rows:0, cols:0) mais déjà typé (`shape`) : la ligne
        // d'attributs doit quand même sortir, sinon le type choisi disparaît au 1er
        // enregistrement, avant même que l'utilisatrice ait saisi ses rangs/mailles.
        if (ch.rows || ch.cols || ch.shape || ch.readDir || ch.reps || (Array.isArray(ch.sizes) && ch.sizes.length)) {
          const sizes = Array.isArray(ch.sizes) && ch.sizes.length ? ` · tailles ${ch.sizes.map(mdSizeLabel).join(', ')}` : ''
          out.push(`${ch.cols} m × ${ch.rows} rangs${ch.shape ? ` · forme ${chartShapeToMd(ch.shape)}` : ''}${ch.readDir ? ` · lecture ${readDirToMd(ch.readDir)}` : ''}${ch.reps ? ` · répéter ${ch.reps} fois` : ''}${sizes}`)
        }
        out.push('')
        continue
      }
      const text = mdScalar(stepTextToMd(st.t, st.c))
      if (st.note) out.push('', `> ${text}`, '')
      else if (st.repeat) {
        // `times` = le compte du marqueur (N). À n=0, normalizeReaderForSave VIDE `total`
        // mais garde `every` : sans le garde `validCount`, la branche cadence émettrait
        // « {cadence 4×undefined} » — non re-parsable (CADENCE_RE exige \d+×\d+), donc
        // dégradé en texte brut à la relecture. On n'écrit JAMAIS de marqueur malformé :
        // sans compte exploitable on retombe sur « - × text » (dégradation propre ; le
        // compte est déjà perdu en amont par la normalisation, pas par la sérialisation).
        const times = Number(st.total?.[0])
        const validCount = Number.isFinite(times) && times > 0
        // Provenance ÉDITEUR (parse.js taggue les marqueurs {×N}/{cadence X×N}) : on force
        // le marqueur, inconditionnellement — le prédicat legacy n'est PAS consulté. Sinon un
        // {×4} dont « 4 » est un jeton du texte repartirait en « - × … » et la relecture legacy
        // capterait le premier nombre du texte, corrompant N en silence. Les pas SANS ce tag
        // (import, legacy) gardent le prédicat → legacy quand récupérable (banc-safe, 25 refs).
        const forceMarker = st.origin === 'editor'
        // Cadence : aucune forme legacy ne porte `every` → marqueur {cadence X×N} si le compte tient.
        // Répétition : legacy « - × … » si sûr (cf. legacyRepeatIsLossless) et pas forcé, sinon marqueur {×N}.
        if (!st.every && !forceMarker && legacyRepeatIsLossless(text, st.total, n)) out.push(`- × ${text}`)
        else if (st.every && validCount) out.push(`- ${emitStepCounter({ kind: 'cadence', every: st.every, times })}${text}`)
        else if (!st.every && validCount) out.push(`- ${emitStepCounter({ kind: 'repetition', times })}${text}`)
        else out.push(`- × ${text}`)
      }
      else out.push(`- ${text}`)
      for (const img of st.imgs || []) out.push(`  ![](${asset(img)})`)
    }
    out.push('')
  }

  const gallery = pattern?.gallery || []
  if (gallery.length) {
    out.push(`## Galerie {${REF_TO_EN.galerie}}`, '')
    for (const g of gallery) {
      const alt = g.page ? `page ${g.page}` : ''
      out.push(`![${alt}](${asset(g.src, galleryPrefix)})`)
    }
    out.push('')
  }

  const md = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  return { md, files }
}

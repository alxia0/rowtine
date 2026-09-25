// mdToPattern : Rowtine-MD → { pattern, warnings }. Parsing TOLÉRANT :
// jamais d'exception ; l'illisible devient avertissement, le texte nu devient note.
import { buildReference } from '../reader-reference'
import { CHART_PATH_MAX_ROWS } from '../reader'
import { sanitizeUrl } from '../safe-url'
import { normalizeReaderForSave, broadcast } from '../reader-edit'
import { isKind } from '../section-kinds'
import { parseFrontMatter } from './meta'
import { mdTextToStep, stepTextToMd } from './line'
import { parseStepCounter, legacyRepeatTotal } from './counters'
import { reservedKey, parseReservedBlock, REF_TAG_TO_KEY } from './refblocks'
import { mergeFlat } from './reference-merge'
import { kindToFr, readDirFromMd, chartShapeFromMd } from './dialect'
import { W, WARNING_CODES } from './warning-codes'
import { TITLE_KIND_RE, H2_RE } from './md-line-type'

const IMG_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/
const CHART_ATTR_RE = /^(\d+)\s*m\s*×\s*(\d+)\s*rangs?(?:\s*·\s*forme\s+(radial-carré|radial-rond|radial-hexagone|tracé))?(?:\s*·\s*lecture\s+(.+?))?(?:\s*·\s*répéter\s+(\d+)\s*fois)?(?:\s*·\s*tailles\s+(.+?))?\s*$/

export function mdToPattern(md) {
  const warnings = []
  const { meta, body, warnings: metaW } = parseFrontMatter(md)
  warnings.push(...metaW)
  const sizeLabels = meta.tailles
  const n = sizeLabels.length

  // Découpe en blocs délimités par les titres ## (le préambule a title === null).
  const blocks = [{ title: null, lines: [] }]
  for (const line of String(body).split('\n')) {
    const h = H2_RE.exec(line)
    if (h) blocks.push({ title: h[1], lines: [] })
    else blocks[blocks.length - 1].lines.push(line)
  }

  const flat = {}
  let gallery = []
  let chart = null
  const sections = []

  for (const b of blocks) {
    if (b.title === null) {
      const intro = parseIntro(b.lines, n, warnings)
      if (intro.steps.length) sections.push(intro)
      continue
    }
    // Désambiguïsation bloc référence / section de travail :
    // - tag {xxx} présent et RÉFÉRENCE (REF_TAG_TO_KEY) → bloc référence ;
    // - tag présent mais pas un tag de référence (kind de travail EN/FR connu,
    //   ou tag inconnu) → toujours une section de travail (jamais absorbée,
    //   cf. anti-régression « ## Aiguilles {sleeve} ») ;
    // - pas de tag (compat patrons FR hérités non balisés) → slug du titre.
    const tm = TITLE_KIND_RE.exec(b.title)
    const key = tm ? (REF_TAG_TO_KEY[tm[2]] ?? null) : reservedKey(b.title)
    if (key === 'galerie') {
      // Fusion (jamais réaffectation) : deux blocs `## Galerie {gallery}` dans le même
      // document doivent s'ADDITIONNER, exactement comme les rubriques passant par
      // mergeFlat ci-dessous. L'ancien `gallery = …` gardait le SECOND bloc et jetait
      // le premier en silence — la perte même que reference-merge.js a été écrit pour
      // éliminer, restée ici parce que la galerie ne transite pas par `flat`.
      const g = parseGallery(b.lines)
      gallery.push(...g.images)
      if (g.leftover.length) sections.push(demotedSection(key, g.leftover, n))
      continue
    }
    if (key) {
      // `leftover` = ce que le bloc de référence ne sait pas exploiter (refblocks.js).
      // Il ne rejoint JAMAIS la forme plate (`flat` alimente buildReference) : il est
      // rétrogradé en notes, à la place du bloc dans le patron, plutôt que jeté.
      const { leftover, ...ref } = parseReservedBlock(key, b.lines, { n, warnings, title: tm ? tm[1] : b.title })
      // Fusion (jamais `Object.assign`) : deux blocs de même rubrique — cas devenu
      // courant depuis que le menu « Aide mémoire » produit de vrais blocs — doivent
      // s'additionner, pas s'écraser. Voir reference-merge.js.
      Object.assign(flat, mergeFlat(flat, ref))
      if (leftover?.length) sections.push(demotedSection(key, leftover, n))
      continue
    }
    const { section } = parseWorkSection(b.title, b.lines, n, warnings)
    if (section.chart?.sizes) {
      const unknown = section.chart.sizes.filter((s) => !sizeLabels.includes(s))
      if (unknown.length) {
        const sizes = unknown.join(', ')
        warnings.push(W(WARNING_CODES.SECTION_UNKNOWN_SIZES, { section: section.title, sizes }))
      }
      section.chart.sizes = section.chart.sizes.filter((s) => sizeLabels.includes(s))
      if (!section.chart.sizes.length) delete section.chart.sizes
    }
    if (!chart && section.chart) chart = section.chart
    sections.push(section)
  }

  const hasRef = Object.values(flat).some((v) => (Array.isArray(v) ? v.length : v))
  const reader = normalizeReaderForSave(
    {
      sizeLabels,
      sizeSub: meta.sousTailles,
      sizeSubLabel: meta.sousTaillesLabel,
      easeHint: meta.aisance,
      sections,
      ...(hasRef ? { reference: buildReference(flat) } : {}),
      ...(chart ? { chart } : {}),
    },
    sizeLabels,
  )
  const pattern = {
    name: meta.titre || '',
    author: meta.auteur || '',
    // `lien:` du front-matter est une chaîne LIBRE venue d'un fichier extérieur, et elle
    // atterrit dans un `href` (PatternView.vue) : `javascript:alert(1)` s'y exécutait au
    // premier clic sur « site de l'auteur ». Seuls `http:`/`https:` (et le relatif, qui ne
    // désigne aucun interpréteur) passent ; le reste devient chaîne vide — on ne répare
    // jamais une URL, on la laisse tomber (cf. src/utils/safe-url.js). Pas d'avertissement
    // pour l'instant : le catalogue WARNING_CODES exige une phrase dans les quatre langues
    // (tests/unit/warning-i18n.spec.js) et src/i18n/ est hors du périmètre de ce lot.
    authorUrl: sanitizeUrl(meta.lien),
    sizes: [...sizeLabels],
    gallery,
    reader,
  }
  return { pattern, warnings }
}

// Section de repli qui recueille, en notes, le contenu qu'un bloc de référence ne
// sait pas exploiter (cf. refblocks.js) : rien ne se perd, tout reste lisible à sa
// place dans le patron. Tant que le tag `{other}` reste posé, la section est protégée
// d'une RÉ-ABSORPTION (donc d'une re-destruction) à la relecture : il se sérialise en
// `## … {other}`, et `{other}` n'est pas une balise de référence (REF_TAG_TO_KEY), donc
// le dispatch de parse.js la relit toujours en section de travail, quel que soit son
// titre. MAIS si une travailleuse retague cette section vers le kind par défaut, le tag
// disparaît — le header redevient nu (`## <titre>`) — et alors le TEXTE du titre devient
// la seule protection restante : `reservedKey()` (refblocks.js) reconnaît des titres FR
// non balisés comme blocs de référence. Intent 2026-09-07-titres-francais-donnees-generes :
// le titre n'est plus la prose FR `${label} (texte conservé)`, mais la clé interne brute
// (`key`, ex. 'yarn', 'materials', 'galerie'). Deux de ces 9 clés — 'techniques' et
// 'galerie' — sont AUSSI des clés du dictionnaire RESERVED (refblocks.js) : un simple
// `title: key` aurait donc réabsorbé à tort une section 'techniques' ou 'galerie' démotée
// puis retaguée nue, comme un vrai bloc de référence (perte du kind choisi, préfixe `> `
// parasite). D'où le suffixe `-notes` : `slug('galerie-notes') === 'galerie-notes'` (les
// tirets internes survivent à `slug`, seuls les tirets en tête/queue sont retirés), et
// aucune clé de RESERVED ne se termine par `-notes` — la collision disparaît pour les 9
// clés possibles sans logique par cas, et redonne un peu de contexte à l'utilisatrice (au
// lieu d'un mot nu). Le titre reste un mot-code du vocabulaire neutre du format (comme les
// tags `{yarn}`, `{other}`…), jamais traduit, jamais collecté par un id stable (une section
// démotée redevient une section de travail ordinaire dès le premier re-parse).
function demotedSection(key, lines, n) {
  return {
    id: '',
    kind: 'autre',
    title: `${key}-notes`,
    steps: lines.map((l) => ({ ...mdTextToStep(l, n), note: true })),
  }
}

function paragraphs(lines) {
  const out = [[]]
  for (const l of lines) {
    if (l.trim() === '') { if (out[out.length - 1].length) out.push([]) }
    else out[out.length - 1].push(l.trim())
  }
  return out.filter((p) => p.length).map((p) => p.join(' '))
}

function parseIntro(lines, n, warnings) {
  // Clé stable en donnée (intent 2026-09-07-titres-francais-donnees-generes) : plus de
  // prose FR ici. `title` reste identique à `id` ('presentation') pour une raison
  // structurelle, pas cosmétique : `normalizeReaderForSave` (reader-edit.js) recalcule
  // TOUJOURS `id = slug(sec.title) || …` à chaque parse ET chaque sauvegarde — il ne
  // préserve jamais un id déjà posé. `slug('presentation') === 'presentation'` : l'id
  // survit donc à tout aller-retour parse/save exactement comme avant (où il survivait
  // par coïncidence via `slug('Présentation')`), sans toucher à cette fonction partagée.
  const title = 'presentation'
  const steps = []
  for (const p of paragraphs(lines)) {
    const img = IMG_RE.exec(p)
    if (img) {
      const last = steps[steps.length - 1]
      // Image SANS étape porteuse (paragraphe image en TÊTE de présentation) : elle ne
      // peut être rattachée à rien. Elle était jusqu'ici écartée en silence — désormais
      // signalée, exactement comme le fait parseWorkSection pour le même cas
      // (SECTION_ORPHAN_IMAGE) : la perte reste, mais elle cesse d'être invisible.
      if (last) (last.imgs = last.imgs || []).push(img[2])
      else warnings?.push(W(WARNING_CODES.SECTION_ORPHAN_IMAGE, { section: title }))
      continue
    }
    steps.push({ ...mdTextToStep(p, n), note: true })
  }
  return { id: 'presentation', kind: 'autre', title, steps }
}

// Retourne les images ET le `leftover` (lignes non-image, hors lignes vides) — même
// contrat que parseReservedBlock : ce qu'un bloc ne sait pas exploiter ne se JETTE pas,
// il ressort pour être rétrogradé en notes par l'appelant (règle cardinale du projet :
// rien de ce que la travailleuse a saisi ne doit disparaître). Avant, toute ligne non-image
// d'un bloc `## Galerie {gallery}` (une légende tapée entre deux images, par ex.) était
// silencieusement perdue à la relecture, sans avertissement ni trace.
function parseGallery(lines) {
  const images = []
  const leftover = []
  for (const l of lines) {
    const t = l.trim()
    // Les lignes VIDES sont de la mise en forme, jamais du contenu : elles ne
    // deviennent pas du leftover (sinon tout bloc galerie aéré fabriquerait une
    // section de repli fantôme).
    if (!t) continue
    const m = IMG_RE.exec(t)
    if (!m) { leftover.push(l); continue }
    const page = /page\s+(\d+)/i.exec(m[1] || '')
    images.push({ src: m[2], page: page ? Number(page[1]) : 0, w: 0, h: 0 })
  }
  return { images, leftover }
}

function parseWorkSection(rawTitle, lines, n, warnings) {
  let title = rawTitle
  let kind = ''
  const tm = TITLE_KIND_RE.exec(rawTitle)
  if (tm) {
    title = tm[1]
    // Tag traduit vers le kind interne FR (dialecte) ; tolérant si déjà
    // FR ou inconnu (kindToFr renvoie tel quel, cf. dialect.js).
    kind = kindToFr(tm[2])
    if (!isKind(kind)) warnings.push(W(WARNING_CODES.SECTION_UNKNOWN_KIND, { section: title, kind: tm[2] }))
  }
  const steps = []
  let chart = null
  let noteOpen = false
  const last = () => steps[steps.length - 1]

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (!trimmed) { noteOpen = false; continue }

    const indentedImg = /^\s{2,}(!\[[^\]]*\]\([^)]+\))$/.exec(line)
    if (indentedImg) {
      const m = IMG_RE.exec(indentedImg[1])
      const st = last()
      if (st && !st.chart) (st.imgs = st.imgs || []).push(m[2])
      else warnings.push(W(WARNING_CODES.SECTION_ORPHAN_IMAGE, { section: title }))
      continue
    }

    const bareImg = IMG_RE.exec(trimmed)
    if (bareImg) {
      steps.push({ chart: true })
      noteOpen = false
      if (!chart) chart = { rows: 0, cols: 0, img: bareImg[2], repeat: '', readDir: '', builtinLegend: false }
      else if (chart.img !== bareImg[2]) warnings.push(W(WARNING_CODES.SECTION_EXTRA_CHART, { section: title }))
      continue
    }

    const attr = CHART_ATTR_RE.exec(trimmed)
    if (attr && last()?.chart) {
      if (chart && !chart.rows) {
        // `CHART_ATTR_RE` laisse `(\d+)` sans plafond : « 8 m × 999999999 rangs · forme
        // tracé » est un attribut de diagramme parfaitement bien formé. Sur la forme
        // « tracé », ce nombre pilote une boucle d'allocation par rang (chartPathRows,
        // src/utils/reader.js) — le rendu part pour un milliard d'éléments et l'écran se
        // fige. On plafonne donc DÈS LE PARSING, au même seuil que la boucle elle-même
        // (importé, jamais recopié : deux plafonds qui dérivent ne protègent plus rien).
        // Aucun avertissement émis : le catalogue WARNING_CODES impose une phrase dans les
        // quatre langues (tests/unit/warning-i18n.spec.js), or src/i18n/ est hors du
        // périmètre de ce lot de sécurité — le plafond est posé, la phrase reste à écrire.
        // `cols` reste NON plafonné : aucune boucle ni allocation ne s'en sert (il ne sert
        // qu'à composer un libellé, chartMotifLabel), et le plafonner sous une constante
        // nommée « rows » se lirait comme un copier-coller raté.
        chart.cols = Number(attr[1])
        chart.rows = Math.min(CHART_PATH_MAX_ROWS, Number(attr[2]) || 0)
        // Revue finale (31/07) : ce module reste zéro-dépendance i18n (importable sous
        // Node), donc AUCUNE langue n'est légitime ici — la ligne
        // fabriquait « ${cols} m × ${rows} rangs » en français en dur, écrasant sans
        // recours tout libellé traduit (`chart.repeat` porté par un exemple ou un patron
        // importé, ex. « 8 M × 24 Reihen »). `cols`/`rows` suffisent à reconstruire un
        // libellé équivalent : c'est désormais chartMotifLabel (src/utils/reader.js),
        // consommé à l'AFFICHAGE dans la langue courante, qui s'en charge — jamais le
        // moteur. `chart.repeat` reste '' tant qu'aucun libellé n'a été fourni en amont.
        if (attr[3]) chart.shape = chartShapeFromMd(attr[3])
        chart.readDir = readDirFromMd(attr[4])
        if (attr[5]) chart.reps = Number(attr[5])
        if (attr[6]) chart.sizes = attr[6].split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean)
      }
      continue
    }

    const bulletMatch = /^-\s+(.*)$/.exec(trimmed)
    if (bulletMatch || trimmed === '-') {
      const content = bulletMatch ? bulletMatch[1] : ''
      noteOpen = false
      // Marqueurs de compteur écrits par l'éditeur (counters.js) : {×N} répétition,
      // {cadence X×N} cadence. Une puce « - {×4} … » ne commence pas par × : sans
      // cette branche le marqueur resterait du texte brut (un compteur posé ne doit
      // jamais se perdre). `every` (cadence) est purement additif ; sans lui c'est une
      // répétition simple, identique à l'existant. Legacy « - × … » traité juste après.
      // Garde `pc.rest.trim()` : un marqueur SANS texte (« - {×4} » seul) ne peut pas
      // devenir une étape (t vide → filtrée par normalizeReaderForSave, donc perdue) ;
      // on le laisse retomber en texte brut ci-dessous — moins beau, mais rien de perdu.
      const pc = parseStepCounter(content)
      if (pc.counter && pc.rest.trim()) {
        const base = mdTextToStep(pc.rest, n)
        const total = broadcast(pc.counter.times, Math.max(1, n))
        // Tag de provenance : ce pas vient d'un MARQUEUR de l'éditeur ({×N}/{cadence X×N}).
        // serialize.js le ré-émet TOUJOURS en marqueur (jamais en legacy « - × … »), même
        // si N figure comme nombre dans le texte — sinon la relecture legacy capterait le
        // PREMIER nombre du texte et corromprait N en silence. Un pas legacy ou d'import ne
        // porte PAS ce tag (l'import ne passe jamais ici) → forme legacy conservée (banc-safe).
        steps.push({ ...base, repeat: true, ...(pc.counter.kind === 'cadence' ? { every: pc.counter.every } : {}), total, origin: 'editor' })
        continue
      }
      if (content.startsWith('×')) {
        const st = mdTextToStep(content.replace(/^×\s*/, ''), n)
        // Échelle de relecture PARTAGÉE (counters.js, source unique — D2) : compte explicite
        // « … fois/times/volte/veces/keer/… » (vecteur {{i}} par taille, ou scalaire diffusé),
        // puis repli historique (1er vecteur, 1er nombre hors placeholders). REP_KW multilingue :
        // « Ripeti queste 2 righe 7 volte » est désormais relu 7 (et non plus 2).
        const tot = legacyRepeatTotal(st, n)
        if (tot) steps.push({ ...st, repeat: true, total: tot })
        else { steps.push(st); warnings.push(W(WARNING_CODES.SECTION_REPEAT_NO_COUNT, { section: title })) }
      } else {
        steps.push(mdTextToStep(content, n))
      }
      continue
    }
    if (trimmed.startsWith('>')) {
      const text = trimmed.replace(/^>\s?/, '')
      if (noteOpen && last()?.note) {
        const st = last()
        const merged = mdTextToStep(`${stepBack(st)} ${text}`, n)
        Object.assign(st, { t: merged.t }, merged.c ? { c: merged.c } : {})
        if (!merged.c) delete st.c
      } else {
        steps.push({ ...mdTextToStep(text, n), note: true })
        noteOpen = true
      }
      continue
    }
    // Ligne de texte nue : continuation de l'étape précédente, sinon note + avertissement.
    const st = last()
    if (st && !st.chart) {
      const merged = mdTextToStep(`${stepBack(st)} ${trimmed}`, n)
      Object.assign(st, { t: merged.t, ...(merged.c ? { c: merged.c } : {}) })
    } else {
      steps.push({ ...mdTextToStep(trimmed, n), note: true })
      warnings.push(W(WARNING_CODES.SECTION_LOOSE_TEXT, { section: title }))
    }
  }
  return { section: { id: '', ...(kind ? { kind } : {}), title, steps, ...(chart ? { chart } : {}) }, chart }
}

// Reconstruit le texte « papier » d'une étape pour concaténer une continuation
// avant de re-tokeniser l'ensemble (évite de décaler les indices {{i}}).
function stepBack(st) {
  return stepTextToMd(st.t, st.c)
}

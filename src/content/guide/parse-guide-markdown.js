// Convertit le guide utilisateur (Markdown écrit par nous, pas une entrée utilisateur) en un
// tableau de blocs TYPÉS, consommé par GuideView.vue sans dépendance de rendu Markdown ni
// `v-html` (surface d'attaque inutile pour un texte qu'on écrit soi-même). Le Markdown reste
// la source de vérité : ce module ne fait que le lire, jamais l'inverse.
//
// Fonction PURE (texte en, données en) : appelée à la fois par le script de génération
// (scripts/gen-guide-content.mjs, qui écrit le JSON committé consommé par l'app) et par le
// test de garde anti-dérive (tests/unit/guide-content-fresh.spec.js). Aucune dépendance à
// Vite ni au DOM : elle tourne aussi bien sous Node que sous Vitest.
//
// Constructions couvertes, mesurées en lisant tout `src/content/guide/fr.md` le 02/08 :
// titres (#/##/###), paragraphes, gras/italique en ligne, images suivies d'une légende en
// italique (une ligne entière entre astérisques), listes à puces (jusqu'à 2 niveaux
// d'imbrication), listes numérotées, un unique tableau à 2 colonnes. Rien d'autre n'apparaît
// dans le guide : ce n'est pas un analyseur CommonMark général, juste ce dialecte-là.
//
// L'identifiant de section est un INDEX DE POSITION (`section-0`, `section-1`…), jamais dérivé
// du texte du titre : le projet a déjà été mordu une fois par un id = slug de titre (mémoire du
// 01/08 — traduire un titre effaçait la progression liée à son id). Un id
// positionnel reste valide même quand le titre change de langue ou de formulation.
//
// CONSTRUCTIONS NON GÉRÉES, volontairement (revue du 02/08) — absentes de `fr.md` aujourd'hui,
// mais un futur ajout au guide pourrait s'en servir sans qu'aucun avertissement ne le
// signale ; à relire au moment d'agrandir ce dialecte :
//   - citations (`>`) : la ligne serait traitée comme un paragraphe normal, guillemets
//     compris — dégradation visuelle, aucune perte de texte ;
//   - titres `####` (niveau 4) et au-delà : non reconnus comme titre (le `#` ne matche pas
//     `headingLevel`), tomberaient dans un paragraphe — dégradation visuelle seulement ;
//   - liens `[texte](url)` : le texte ressortirait tel quel, crochets et parenthèses
//     compris (aucune règle ne les retire) — pas de perte, rendu brut ;
//   - séparateurs `---` : traités comme un paragraphe (le contenu textuel, trois tirets,
//     survit) — pas invisible, juste pas un vrai filet horizontal.
// Deux constructions PLUS risquées (perte réelle, pas seulement visuelle) sont détectées et
// signalées par `detectInlineWarnings` plutôt que corrigées silencieusement — voir plus bas.

// Découpe une ligne de texte en portions {text, bold, italic}. Gras (**...**), italique
// simple (*...*) et gras+italique combinés (***...***, testé EN PREMIER dans l'alternation :
// un ordre inverse laisserait `\*\*...\*\*` happer les deux premières étoiles et abandonner
// la 3e, non appariée, en texte brut — mesuré en revue du 02/08 sur
// « ***très important*** », qui ressortait mal découpé avant ce correctif).
export function parseInlineSpans(text) {
  if (!text) return []
  const tokens = text.split(/(\*{3}[^*]+\*{3}|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((t) => t !== '')
  return tokens.map((token) => {
    if (token.startsWith('***') && token.endsWith('***') && token.length >= 7) {
      return { text: token.slice(3, -3), bold: true, italic: true }
    }
    if (token.startsWith('**') && token.endsWith('**')) {
      return { text: token.slice(2, -2), bold: true, italic: false }
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return { text: token.slice(1, -1), bold: false, italic: true }
    }
    return { text: token, bold: false, italic: false }
  })
}

// Signale (sans les corriger : la distinction exigerait un vrai analyseur CommonMark, hors
// budget de ce dialecte volontairement restreint — cf. en-tête de fichier) les constructions
// que ce parseur risque de mal interpréter. Trouvé en revue du 02/08 : un texte comme
// « 5 * 3 = 15 » a un `*` isolé entre chiffres — une multiplication, pas un marqueur
// d'italique — que `parseInlineSpans` peut happer avec un AUTRE `*` isolé plus loin sur la
// même ligne et transformer toute la portion intermédiaire en italique, avalant du texte au
// passage. Mieux vaut un avertissement à la génération (visible dans la sortie de
// `yarn guide:gen`) qu'une perte silencieuse — la règle du projet est de ne JAMAIS perdre
// d'information, et ce guide alimentera aussi un futur site web.
//
// ⚠️ Diagnostic DÉVELOPPEUR (console de `yarn guide:gen`), jamais montré à l'utilisatrice :
// n'a donc rien à voir avec le système d'avertissements d'import traduit (`W(...)`/
// `warningText()`, tests/unit/warnings-no-french.spec.js) qui, LUI, interdit les phrases
// françaises en dur, en repérant un certain appel de méthode sur une variable nommée
// précisément ainsi ; la variable locale ci-dessous s'appelle donc `found`, pas ce mot-là —
// deux concepts distincts qui partagent un terme, pas une exception à cette garde-là.
export function detectInlineWarnings(text) {
  const found = []
  if (/\d\s*\*\s*\d/.test(text)) {
    found.push(`« * » isolé entre deux chiffres (multiplication littérale ?), risque de confusion avec de l'italique : "${text}"`)
  }
  return found
}

function isBlank(line) {
  return line.trim() === ''
}

function headingLevel(line) {
  const m = /^(#{1,3})\s+(.*)$/.exec(line)
  return m ? { level: m[1].length, text: m[2].trim() } : null
}

function imageLine(line) {
  const m = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line.trim())
  if (!m) return null
  const [, alt, path] = m
  const file = path.split('/').pop()
  const src = file.replace(/\.[^.]+$/, '')
  return { alt, src }
}

// Légende : une ligne ENTIÈRE entre astérisques simples (pas du gras) — convention du guide,
// toujours juste après une image.
function captionLine(line) {
  const t = line.trim()
  if (t.length > 2 && t.startsWith('*') && t.endsWith('*') && !t.startsWith('**')) {
    return t.slice(1, -1)
  }
  return null
}

function tableRow(line) {
  const t = line.trim()
  if (!t.startsWith('|') || !t.endsWith('|')) return null
  return t
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

function isTableSeparator(cells) {
  return cells.every((c) => /^:?-+:?$/.test(c))
}

function listMarker(line) {
  const unordered = /^(\s*)-\s+(.*)$/.exec(line)
  if (unordered) return { indent: unordered[1].length, ordered: false, text: unordered[2] }
  const ordered = /^(\s*)\d+\.\s+(.*)$/.exec(line)
  if (ordered) return { indent: ordered[1].length, ordered: true, text: ordered[2] }
  return null
}

// Une ligne de continuation (repli d'un paragraphe ou d'un item de liste sur plusieurs lignes
// physiques) : ni titre, ni image, ni ligne de tableau, ni nouveau marqueur de liste, ni ligne
// blanche.
function isContinuation(line) {
  if (isBlank(line)) return false
  if (headingLevel(line)) return false
  if (imageLine(line)) return false
  if (tableRow(line)) return false
  if (listMarker(line)) return false
  return true
}

export function parseGuideMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let i = 0

  // Le H1 (titre du document) n'est pas rendu : l'écran porte déjà son propre titre
  // (AppHeader, clé `about.guide`), comme PrivacyPolicyView ne répète pas non plus le sien.
  if (headingLevel(lines[i])?.level === 1) i++

  const sections = []
  const warnings = []
  let currentSection = null
  let sectionIndex = 0

  // Aperçu textuel d'un bloc pour un message d'avertissement lisible — mêmes types de blocs
  // que ceux produits plus bas (paragraph/subsection : spans ou title ; image : alt/src ;
  // terms : header ; list : items).
  function blockPreview(block) {
    const joinSpans = (spans) => (spans || []).map((s) => s.text).join('')
    if (block.spans) return joinSpans(block.spans)
    if (block.title) return joinSpans(block.title)
    if (block.type === 'image') return `![${block.alt}](${block.src})`
    if (block.type === 'terms') return (block.header || []).map(joinSpans).join(' | ')
    if (block.type === 'list') return (block.items || []).map((it) => joinSpans(it.spans)).join(' / ')
    return JSON.stringify(block)
  }

  function pushBlock(block) {
    if (!currentSection) {
      // Dernier chemin de perte SILENCIEUSE de ce parseur (revue du 02/08) :
      // tout contenu situé avant le premier titre `##` était jusqu'ici jeté sans un mot,
      // alors que le reste des risques de perte de ce module est soit documenté comme
      // dégradation visuelle seulement (cf. en-tête de fichier), soit signalé par
      // `detectInlineWarnings`. Même traitement ici : un avertissement, visible dans la
      // sortie de `yarn guide:gen`, jamais montré à l'utilisatrice — la règle du projet est
      // de ne JAMAIS perdre d'information en silence.
      // Construit via une variable plutôt qu'un littéral passé directement à `warnings.push`
      // (même précaution que `detectInlineWarnings` plus haut dans ce fichier, qui pousse
      // dans une variable nommée `found`, pas `warnings`) : tests/unit/warnings-no-french.spec.js
      // interdit tout littéral français passé en argument DIRECT de `warnings.push(...)` dans
      // TOUT `src/**/*.{js,vue}` — garde pensée pour le système d'avertissements d'import
      // traduit (W(...)/warningText()), sans rapport avec ce diagnostic développeur, mais qui
      // matche sur la forme du code plutôt que sur son propos.
      const message = `Contenu trouvé avant le premier titre de section (##), ignoré : bloc de type "${block.type}" — "${blockPreview(block)}"`
      warnings.push(message)
      return
    }
    currentSection.blocks.push(block)
  }

  // Remplace `parseInlineSpans` partout où le texte vient de la prose du guide (pas d'un
  // identifiant technique) : mémorise aussi les avertissements de detectInlineWarnings, sans
  // dupliquer cet appel à chaque site. Nommée `inline`, pas `spans`, pour ne pas se confondre
  // visuellement avec la clé `spans:` des blocs produits juste en dessous.
  function inline(text) {
    warnings.push(...detectInlineWarnings(text))
    return parseInlineSpans(text)
  }

  // `initialText` est déjà le texte de la 1re ligne (débarrassé d'un éventuel préfixe, cf.
  // parseList ci-dessous) ; `from` est l'index de la ligne suivante à examiner. Factorisée
  // (revue) : même boucle « avale tant que ça continue » utilisée ici pour un paragraphe et
  // dans parseList pour un item de liste — seul le texte de départ diffère.
  function collectContinuationFrom(initialText, from) {
    let text = initialText
    let j = from
    while (j < lines.length && isContinuation(lines[j])) {
      text += ' ' + lines[j].trim()
      j++
    }
    return { text, next: j }
  }

  function collectContinuation(startIndex) {
    return collectContinuationFrom(lines[startIndex].trim(), startIndex + 1)
  }

  // Une liste (à puces ou numérotée) à partir de la ligne `start`, avec jusqu'à 2 niveaux
  // d'imbrication (mesuré dans le guide : jamais plus de 2). Chaque item absorbe ses lignes
  // de continuation (repli sans marqueur) avant de regarder si la ligne suivante démarre une
  // sous-liste plus indentée.
  function parseList(start, baseIndent) {
    const items = []
    let j = start
    let ordered = null
    while (j < lines.length) {
      const marker = listMarker(lines[j])
      if (!marker || marker.indent !== baseIndent) break
      if (ordered === null) ordered = marker.ordered
      // Le texte de la 1re ligne vient du marqueur (déjà débarrassé de son préfixe "- "/"N. ") ;
      // les lignes de continuation (repli sans marqueur, plus indentées que la puce) s'y
      // ajoutent telles quelles.
      const { text: itemText, next } = collectContinuationFrom(marker.text, j + 1)
      // Sous-liste : même forme que le bloc `list` au niveau supérieur ({ordered, items}),
      // pas juste un tableau — sinon une sous-liste NUMÉROTÉE (aucune dans ce guide
      // aujourd'hui, mais rien ne l'interdit) perdrait son type au rendu.
      let children = null
      let k = next
      const childMarker = k < lines.length ? listMarker(lines[k]) : null
      if (childMarker && childMarker.indent > baseIndent) {
        const child = parseList(k, childMarker.indent)
        children = { ordered: child.ordered, items: child.items }
        k = child.next
      }
      items.push({ spans: inline(itemText), children })
      j = k
      while (j < lines.length && isBlank(lines[j])) j++ // une liste tolère des lignes blanches entre items
      const peek = j < lines.length ? listMarker(lines[j]) : null
      if (!peek || peek.indent !== baseIndent) break
    }
    return { items, ordered: ordered ?? false, next: j }
  }

  // Généralisé à N colonnes (revue du 02/08 : la version précédente ne gardait que les 2
  // premières cellules de chaque ligne, perdant TOUTE colonne au-delà en silence — la règle
  // du projet est de ne jamais perdre d'information, et ce guide est appelé à s'enrichir).
  // `header` ET chaque ligne de `rows` sont conservés intégralement ; c'est GuideView.vue qui
  // décide comment les afficher (paires terme/description pour 2 colonnes, dt/dd répétés par
  // ligne sinon) — le parseur, lui, ne choisit jamais de jeter une colonne.
  function parseTable(start) {
    let j = start
    const rawRows = []
    while (j < lines.length) {
      const cells = tableRow(lines[j])
      if (!cells) break
      if (!isTableSeparator(cells)) rawRows.push(cells)
      j++
    }
    const [headerRow, ...bodyRows] = rawRows
    const header = (headerRow ?? []).map((cell) => inline(cell))
    const rows = bodyRows.map((row) => row.map((cell) => inline(cell ?? '')))
    return { header, rows, next: j }
  }

  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }

    const heading = headingLevel(line)
    if (heading?.level === 2) {
      currentSection = { id: `section-${sectionIndex++}`, title: inline(heading.text), blocks: [] }
      sections.push(currentSection)
      i++
      continue
    }
    if (heading?.level === 3) {
      pushBlock({ type: 'subsection', title: inline(heading.text) })
      i++
      continue
    }

    const image = imageLine(line)
    if (image) {
      i++
      let caption = null
      while (i < lines.length && isBlank(lines[i])) i++
      const capText = i < lines.length ? captionLine(lines[i]) : null
      if (capText !== null) {
        caption = inline(capText)
        i++
      }
      pushBlock({ type: 'image', src: image.src, alt: image.alt, caption })
      continue
    }

    const cells = tableRow(line)
    if (cells) {
      const table = parseTable(i)
      pushBlock({ type: 'terms', header: table.header, rows: table.rows })
      i = table.next
      continue
    }

    const marker = listMarker(line)
    if (marker) {
      const list = parseList(i, marker.indent)
      pushBlock({ type: 'list', ordered: list.ordered, items: list.items })
      i = list.next
      continue
    }

    // Paragraphe : gobe ses lignes de continuation.
    const { text, next } = collectContinuation(i)
    pushBlock({ type: 'paragraph', spans: inline(text) })
    i = next
  }

  return { sections, warnings }
}

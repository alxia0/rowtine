// Transformations PURES de requalification d'une ligne Rowtine-MD (à terme, le
// menu de requalification de l'éditeur appellera ce module). Aucun
// import DOM/CM6 ici : module chargeable tel quel par Vitest. × = U+00D7.
import { emitStepCounter, parseStepCounter, parseSectionRepeat } from './counters.js'
import { DEFAULT_KIND } from '../section-kinds.js'
import { kindToEn } from './dialect.js'
// NOTE_RE/BULLET_RE réutilisées depuis md-line-type.js (même syntaxe, recopiée à
// l'identique jusqu'ici) : IMG_RE, elle, diffère réellement là-bas (`\s*` en tête
// pour reconnaître une image indentée) et reste donc propre à ce fichier.
import { TITLE_KIND_RE, H2_RE, NOTE_RE, BULLET_RE } from './md-line-type.js'

const IMG_RE = /^!\[[^\]]*\]\([^)]*\)\s*$/
const LEGACY_REP_RE = /^×\s*/

// Retire tout balisage Rowtine-MD d'une ligne pour en obtenir le texte nu.
// Les lignes image (`![alt](src)`) sont hors périmètre de la requalification
// texte : laissées inchangées plutôt que mal interprétées.
export function stripMarkup(line) {
  const raw = String(line ?? '')

  if (IMG_RE.test(raw)) return raw

  const h2 = H2_RE.exec(raw)
  if (h2) {
    // Le compteur de section {×N} se détache en premier (ancré en fin de chaîne),
    // sinon il empêcherait de reconnaître un {kind} qui le précède — même ordre
    // que parseWorkSection (src/utils/pattern-md/parse.js).
    const sr = parseSectionRepeat(h2[1])
    const tm = TITLE_KIND_RE.exec(sr.title)
    return tm ? tm[1] : sr.title
  }

  if (NOTE_RE.test(raw)) return raw.replace(NOTE_RE, '')

  const bullet = BULLET_RE.exec(raw)
  if (bullet) {
    const content = bullet[1]
    const cc = parseStepCounter(content)
    if (cc.counter) return cc.rest
    if (content.startsWith('×')) return content.replace(LEGACY_REP_RE, '')
    return content
  }

  return raw
}

// Réécrit UNE ligne MD vers `type` ∈ {rang, note, section, compteur-rep,
// compteur-cadence, texte}. opts : { kind, times, every }. Idempotent : on
// strippe d'abord le balisage existant, puis on réémet pour le type cible —
// requalifier deux fois de suite vers le même type est donc un no-op.
export function retagLine(line, type, opts = {}) {
  const bare = stripMarkup(line)
  switch (type) {
    case 'rang':
      return `- ${bare}`
    case 'note':
      return `> ${bare}`
    case 'section': {
      // pelote = kind défaut (section.js) : jamais émis en {kind} explicite,
      // pour rester canonique avec un `## Titre` nu (même convention que
      // l'ancien menu textarea, md-toolbar.js:setSectionKind). opts.kind est le
      // kind interne FR (menu de requalification, cf. cm-editor.js/SECTION_KINDS) ;
      // la balise émise dans le MD est anglicisée (dialecte, kindToEn).
      const attr = opts.kind && opts.kind !== DEFAULT_KIND ? ` {${kindToEn(opts.kind)}}` : ''
      return `## ${bare}${attr}`
    }
    case 'compteur-rep':
      return `- ${emitStepCounter({ kind: 'repetition', times: opts.times })}${bare}`
    case 'compteur-cadence':
      return `- ${emitStepCounter({ kind: 'cadence', every: opts.every, times: opts.times })}${bare}`
    case 'reference':
      // Bloc RÉFÉRENCE (fil/aiguilles/échantillon…) : titre `## …` porteur d'une
      // balise de référence. Le tag (opts.tag) est DÉJÀ en anglais (REF_TO_EN,
      // ensemble REF_TAG_TO_KEY) → émis tel quel, sans kindToEn (contrairement au
      // {kind} de section). lineType le colorera en `reference`, pas `section`.
      return `## ${bare} {${opts.tag}}`
    case 'texte':
      return bare
    default:
      return bare
  }
}

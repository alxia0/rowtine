import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import { W, E, WARNING_CODES, formatWarningFr, isStructuredWarning } from '@/utils/pattern-md/warning-codes'
import { warningText } from '@/utils/warning-i18n'
import { reservedLabel } from '@/utils/pattern-md/refblocks'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

// Les 8 clés de blocs réservés (KEY_LABELS dans refblocks.js) — dupliquées ici car KEY_LABELS
// n'est pas exporté (seul `reservedLabel` l'est, cf. contrat de la tâche B3). Sert à vérifier
// la 3e copie à tenir synchronisée à la main : `warnings.blockName.*` dans les 4 dictionnaires.
const BLOCK_KEYS = ['abbr', 'sizeTable', 'yarn', 'needles', 'gauge', 'materials', 'techniques', 'tips']

// `t` factice : renvoie la clé et les paramètres, pour vérifier l'aiguillage sans monter i18n.
const fakeT = (key, params) => `${key}|${JSON.stringify(params || {})}`

// Navigue `dict.warnings` par le chemin en points d'un code (`'sizes.countMismatch'` →
// `dict.warnings.sizes.countMismatch`).
function phraseFor(dict, code) {
  return code.split('.').reduce((node, key) => (node == null ? undefined : node[key]), dict.warnings)
}

// Noms de paramètres `{xxx}` présents dans une phrase, en ensemble (l'ordre ne compte pas).
function paramNames(phrase) {
  return new Set([...String(phrase || '').matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]))
}

describe('W (fabrique)', () => {
  it('produit un objet code + params', () => {
    expect(W('zip.missingImage', { ref: 'photo.png' })).toEqual({
      code: 'zip.missingImage',
      params: { ref: 'photo.png' },
    })
  })

  it('accepte un code sans paramètre', () => {
    expect(W('merge.noSections')).toEqual({ code: 'merge.noSections', params: {} })
  })
})

// Sœur de W : les ERREURS destinées au rapport de synchro empruntent le
// même canal code + params — mais restent de VRAIES Error, dont le verbatim français de
// `.message` survit pour le diagnostic là où aucun `t()` n'existe (console, terminal).
describe('E (fabrique d’erreur codée)', () => {
  it('produit une vraie Error portant code + params, le message intact', () => {
    const err = E(WARNING_CODES.SAF_SIZE_MISMATCH, { path: 'a/patron.json', read: 20, expected: 26 }, 'verbatim diagnostique')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('verbatim diagnostique')
    expect(err.code).toBe(WARNING_CODES.SAF_SIZE_MISMATCH)
    expect(err.params).toEqual({ path: 'a/patron.json', read: 20, expected: 26 })
  })

  it('params jamais undefined (comme W), et l’erreur est reconnue structurée', () => {
    const err = E(WARNING_CODES.SAF_DESYNC, undefined, 'verbatim')
    expect(err.params).toEqual({})
    expect(isStructuredWarning(err)).toBe(true)
  })
})

describe('warningText', () => {
  it('traduit un avertissement structuré', () => {
    expect(warningText(W('zip.missingImage', { ref: 'a.png' }), fakeT)).toBe(
      'warnings.zip.missingImage|{"ref":"a.png"}',
    )
  })

  it('laisse passer une chaîne telle quelle (forme héritée, ou message venu d\'ailleurs)', () => {
    expect(warningText('un message brut', fakeT)).toBe('un message brut')
  })

  it('ne casse jamais sur une valeur absurde', () => {
    expect(warningText(null, fakeT)).toBe('')
    expect(warningText({ pas: 'un code' }, fakeT)).toBe('')
  })

  // isStructuredWarning n'accepte que les codes du catalogue : un objet Error du système de
  // fichiers porte lui aussi un `.code` string (ex. 'ENOENT'). Sans ce garde-fou, l'écran
  // afficherait la clé i18n brute `warnings.ENOENT` — pire que rien. Mais on ne perd pas non
  // plus l'information : un `.message` ou `.reason` exploitable est affiché tel quel.
  it("un code hors catalogue avec message (ex. erreur fichier ENOENT) affiche le message, pas la clé i18n brute", () => {
    const fsError = { code: 'ENOENT', message: 'Le dossier est introuvable.' }
    expect(warningText(fsError, fakeT)).toBe('Le dossier est introuvable.')
  })

  it('un code hors catalogue avec `reason` (et pas de `message`) affiche `reason`', () => {
    expect(warningText({ code: 'ENOENT', reason: 'chemin invalide' }, fakeT)).toBe('chemin invalide')
  })

  it('un code hors catalogue sans message ni reason exploitable dégrade en chaîne vide (rien à perdre)', () => {
    expect(warningText({ code: 'ENOENT' }, fakeT)).toBe('')
  })

  // Piège mesuré (tâche B3) : vue-i18n efface SILENCIEUSEMENT un paramètre dont le nom ne
  // correspond pas — un `{blockKey}` émis là où la phrase attend `{block}` donnerait une phrase
  // amputée, verte aux tests si on ne vérifiait pas la RÉSOLUTION elle-même. Le moteur transporte
  // la clé (`blockKey`), jamais le libellé français : `warningText` doit la traduire en `block`
  // via `warnings.blockName.<clé>` avant l'appel à `t`.
  it('traduit la clé de bloc en libellé', () => {
    const txt = warningText(W('block.notATable', { blockKey: 'abbr' }), fakeT)
    expect(txt).toContain('warnings.blockName.abbr')
  })
})

// Le test précédent prouve que la RÉSOLUTION est appelée (via `fakeT`, qui renvoie la clé
// telle quelle), mais pas que les 8 clés `blockName.*` existent réellement dans les 4
// dictionnaires. `warnings.blockName.*` est une 3e copie de `KEY_LABELS` (refblocks.js) tenue à
// la main, sans lien structurel avec les deux autres (cf. commentaire de `BLOCK_NAMES_FR` dans
// warning-codes.js) : une clé absente ou mal orthographiée ferait ressortir la chaîne brute
// `warnings.blockName.<clé>` au milieu d'une phrase traduite, SANS faire rougir le test de
// résolution (celui-ci n'utilise qu'un `t` factice). Ici on monte un VRAI i18n par langue et on
// vérifie, pour les 8 clés, que la traduction n'est ni vide ni égale à la clé brute — et que le
// repli banc Node (`formatWarningFr`/`BLOCK_NAMES_FR`) ne fuit pas non plus la clé technique.
describe('warnings.blockName.* : les 8 clés existent dans les 4 langues (pas de fuite de clé brute)', () => {
  for (const [name, dict] of [['fr', fr], ['en', en], ['de', de], ['es', es]]) {
    it(`${name} : les 8 blocs réservés ont un libellé traduit non vide`, () => {
      const i18n = createI18n({ legacy: false, locale: name, messages: { [name]: dict } })
      const t = i18n.global.t
      for (const key of BLOCK_KEYS) {
        const out = t(`warnings.blockName.${key}`)
        expect(out, `${name}/${key}`).not.toBe(`warnings.blockName.${key}`)
        expect(out.length, `${name}/${key}`).toBeGreaterThan(0)
      }
    })
  }

  it('reservedLabel(key) reste non vide pour les 8 clés (contrat inchangé, KEY_LABELS non touché)', () => {
    for (const key of BLOCK_KEYS) {
      expect(reservedLabel(key), key).not.toBe('')
    }
  })

  // `BLOCK_NAMES_FR` (warning-codes.js) est un miroir DÉLIBÉRÉ de `KEY_LABELS`, tenu à la main.
  // Assertion positive (le texte rendu CONTIENT le libellé attendu), pas seulement négative :
  // une simple absence de `blockName.<clé>`/`{block}` ne rougirait jamais (une entrée manquante
  // dans `BLOCK_NAMES_FR` dégrade vers `p.blockKey` brut via `|| params.blockKey`, jamais vers la
  // clé i18n ni une accolade orpheline — un test qui cherchait ces motifs ne pouvait pas rougir).
  it('formatWarningFr (repli banc Node) rend le VRAI libellé français, pas la clé technique', () => {
    for (const key of BLOCK_KEYS) {
      const txt = formatWarningFr(W('block.notATable', { blockKey: key }))
      expect(txt, key).toContain(reservedLabel(key))
    }
  })
})

describe('couverture des codes dans les 4 langues', () => {
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    )

  for (const [name, dict] of [['fr', fr], ['en', en], ['de', de], ['es', es]]) {
    it(`${name} : tous les codes ont une phrase`, () => {
      const present = new Set(flatten(dict.warnings || {}))
      const missing = Object.values(WARNING_CODES).filter((c) => !present.has(c))
      expect(missing).toEqual([])
    })
  }
})

// L'assertion « pas d'accolade orpheline dans le rendu » ne prouve RIEN : mesuré en conditions
// réelles, vue-i18n retire SILENCIEUSEMENT un paramètre inconnu (une coquille `{expectd}` sans
// valeur `expectd` fournie ne laisse aucune `{...}` visible, juste un trou dans la phrase — pas
// d'accolade, pas d'avertissement console). La seule preuve qui tienne : comparer, pour chaque
// code, l'ENSEMBLE des noms de paramètres `{xxx}` de chaque langue à celui du français
// (référence) — une coquille de nom dans une seule langue casse l'égalité d'ensembles.
describe('paramètres identiques entre les 4 langues (pas de coquille de nom)', () => {
  for (const code of Object.values(WARNING_CODES)) {
    it(`${code} : mêmes noms de paramètres en fr/en/de/es`, () => {
      const frParams = [...paramNames(phraseFor(fr, code))].sort()
      for (const [name, dict] of [['en', en], ['de', de], ['es', es]]) {
        const params = [...paramNames(phraseFor(dict, code))].sort()
        expect(params, `${name}/${code}`).toEqual(frParams)
      }
    })
  }
})

describe('formatWarningFr (repli du banc Node, sans i18n)', () => {
  it('rend une phrase française lisible', () => {
    const txt = formatWarningFr(W('zip.missingImage', { ref: 'a.png' }))
    expect(txt).toContain('a.png')
    expect(txt.length).toBeGreaterThan(10)
  })

  it('un code hors catalogue avec message affiche le message, pas le code brut', () => {
    const fsError = { code: 'ENOENT', message: 'Le dossier est introuvable.' }
    expect(formatWarningFr(fsError)).toBe('Le dossier est introuvable.')
  })

  it('un code hors catalogue sans message ni reason dégrade en chaîne vide', () => {
    expect(formatWarningFr({ code: 'ENOENT' })).toBe('')
  })
})

// Garde anti-dérive (corrigé le 06/09) : le repli banc Node miroire les
// traductions FR de l'app, mais les deux copies sont tenues à la main et ont DÉJÀ divergé —
// le 16/08 (commit 5e57043b), fr.json est passé à « en-tête du patron … » sans que `FR`
// (warning-codes.js) suive, pendant que son commentaire « AU CARACTÈRE PRÈS » continuait
// d'affirmer une copie exacte. Les trois phrases `meta.*` sont donc épinglées AU CARACTÈRE
// PRÈS contre fr.json (source de vérité) : toute retouche d'un côté sans l'autre rougit ici.
// Portée volontairement limitée : `section.extraChart` diverge DÉLIBÉRÉMENT (le littéral
// `{chart}` est conservé côté Node, cf. warning-codes.js), et pour les autres codes l'écart
// exact reste à peser (stabilité des rapports du banc) — l'épinglage complet est donc exclu.
describe('repli banc Node : miroir fr.json des phrases meta.* (garde anti-dérive)', () => {
  const MIRROR_CODES = ['meta.noFrontmatter', 'meta.unreadableLine', 'meta.unknownKey']

  for (const code of MIRROR_CODES) {
    it(`${code} : le repli Node rend la phrase FR de fr.json au caractère près`, () => {
      // Chaque paramètre `{xxx}` de la phrase fr.json reçoit la valeur littérale `{xxx}` :
      // le rendu du repli doit alors être IDENTIQUE à la phrase source, accolades comprises —
      // un placeholder renommé, perdu ou superflu casse l'égalité.
      const params = Object.fromEntries(
        [...paramNames(phraseFor(fr, code))].map((name) => [name, `{${name}}`]),
      )
      expect(formatWarningFr(W(code, params))).toBe(phraseFor(fr, code))
    })
  }
})

// Invariant : TOUT code du catalogue a une phrase française dans `FR`. `WARNING_CODES` et `FR`
// sont deux tableaux tenus à la main, à deux endroits du même fichier — rien ne les lie
// structurellement. Un code ajouté à l'un sans l'autre (attendu dans les tâches B2-B5, qui vont
// ajouter des codes) ne doit jamais faire planter `formatWarningFr` (le banc Node), seulement
// dégrader proprement. Ce test exerce les 11 codes, pas seulement `zip.missingImage`.
describe('formatWarningFr : invariant « tout code du catalogue a une phrase française »', () => {
  // `sampleParams` était tenu à la main jusqu'ici — 3e fois dans ce lot qu'une liste de
  // paramètres maintenue à la main prend du retard sur le catalogue (mesuré : `blockTitle`,
  // utilisé par `correction.chartOpLostNamed` dans la table `FR`, en était absent ; la phrase
  // rendait littéralement « … du bloc « undefined » n'a pas pu être appliqué… », test pourtant
  // vert car il ne vérifiait que « non vide, différent du code »). Corrigé À LA RACINE : le jeu
  // de paramètres est DÉRIVÉ du catalogue via `paramNames`/`phraseFor`, déjà utilisés plus haut
  // dans ce fichier pour les 4 dictionnaires i18n — la phrase FR de `fr.json` de chaque code
  // (dont l'existence et l'exhaustivité sont déjà verrouillées par le describe « couverture des
  // codes dans les 4 langues » ci-dessus) sert de source de vérité pour les noms de paramètres
  // qu'elle utilise. Un code ajouté demain avec un nouveau paramètre est donc couvert sans
  // toucher cette liste, à condition qu'il ait sa phrase fr.json — ce qui est déjà exigé par
  // ailleurs. Chaque paramètre reçoit une valeur synthétique distincte (`valeur-<nom>`), pour
  // que le test de contenu ci-dessous puisse vérifier sa présence littérale dans le rendu.
  const allParamNames = new Set()
  for (const code of Object.values(WARNING_CODES)) {
    for (const p of paramNames(phraseFor(fr, code))) allParamNames.add(p)
  }
  const sampleParams = Object.fromEntries([...allParamNames].map((p) => [p, `valeur-${p}`]))

  for (const code of Object.values(WARNING_CODES)) {
    it(`${code} : rend une phrase non vide, distincte du code brut, CONTENANT les valeurs fournies, jamais "undefined"`, () => {
      const txt = formatWarningFr(W(code, sampleParams))
      expect(txt.length, code).toBeGreaterThan(0)
      // Si `FR[code]` est absent, `formatWarningFr` dégrade vers le code lui-même (`w.code`) —
      // ce test doit alors rougir : une chaîne identique au code n'est PAS une phrase française.
      expect(txt, code).not.toBe(code)
      // La preuve qui manquait (défaut `blockTitle` réel, cf. commentaire ci-dessus) : un
      // paramètre non fourni par `sampleParams` mais lu par `FR[code]` s'interpole en la chaîne
      // littérale JS "undefined" — jamais silencieusement effacé comme sous vue-i18n, mais tout
      // aussi jamais attrapé par « non vide, différent du code ». On l'interdit explicitement.
      expect(txt, code).not.toMatch(/undefined/)
      // Et, comme pour le rendu réel vue-i18n plus haut : la valeur de chaque paramètre RÉELLEMENT
      // attendu par la phrase FR de référence doit apparaître littéralement dans le rendu.
      for (const paramName of paramNames(phraseFor(fr, code))) {
        expect(txt, `${code}/{${paramName}}`).toContain(sampleParams[paramName])
      }
    })
  }
})

// Le `fakeT` ci-dessus vérifie l'aiguillage (code → clé) mais ne prouve pas que le compilateur
// de messages vue-i18n avale réellement chaque phrase du catalogue (interpolation `{param}`,
// guillemets allemands `„…“` collés à `}`, `%` littéral dans les phrases merge.*). On monte
// donc un VRAI i18n et on rend chaque code dans les 4 langues.
describe('rendu réel vue-i18n (toutes les phrases du catalogue, pas juste leurs clés)', () => {
  // Couvre TOUS les noms de paramètres réellement utilisés par au moins une phrase de
  // `warnings.*` (vérifié par balayage de fr.json) — pas seulement ceux des 9 codes de la
  // tâche B6. Une valeur manquante ici pour un paramètre existant ferait remonter un faux
  // échec sur l'assertion de contenu ci-dessous (aucun rapport avec une régression réelle) :
  // c'est la contrepartie de vérifier le CONTENU plutôt que la simple non-vacuité.
  const sampleParams = {
    ref: 'photo.png',
    block: 'Tailles',
    blockTitle: 'Materiel',
    line: 'rg 12 : 2 m ens.',
    label: 'S/M',
    got: 2,
    expected: 3,
    count: 12,
    detail: 'le décompte par taille n’a pas pu être conservé après correction',
    section: 'Corps',
    sizes: 'XXL',
    kind: 'zorglub',
    key: 'foo',
    // Erreurs SAF : les codes saf.* transportent des données techniques
    // (octets, offsets, chemins) — noms dérivés des phrases FR de fr.json, cf. plus haut.
    bytes: 12,
    path: 'Projets/x/patron.json',
    offset: 6,
    read: 20,
  }

  for (const [name, dict] of [['fr', fr], ['en', en], ['de', de], ['es', es]]) {
    it(`${name} : chaque code se traduit en un texte non vide, distinct de sa clé, CONTENANT les valeurs fournies`, () => {
      const i18n = createI18n({ legacy: false, locale: name, messages: { [name]: dict } })
      const t = i18n.global.t
      for (const code of Object.values(WARNING_CODES)) {
        const key = `warnings.${code}`
        const out = t(key, sampleParams)
        expect(out, `${name}/${code}`).not.toBe(key)
        expect(out.length, `${name}/${code}`).toBeGreaterThan(5)
        // La preuve qui manquait : « non vide » n'attrape PAS un trou d'interpolation
        // silencieux (vue-i18n efface un `{xxx}` dont le nom ne correspond à aucune clé de
        // `sampleParams`, sans laisser d'accolade ni avertir en console — mesuré dans ce
        // même lot pour `{block}`/`blockKey` et `{chart}`). On vérifie donc, pour chaque
        // paramètre RÉELLEMENT présent dans la phrase FR de référence (source de vérité des
        // noms attendus), que sa valeur apparaît bien, littéralement, dans le texte rendu —
        // dans les 4 langues, pas seulement en français.
        // Preuve par mutation (renommage d'un {xxx} dans les 4 dictionnaires à la fois) :
        // c'est la garde `not.toBeUndefined()` ci-dessous qui rougit (le paramètre français de
        // référence change de nom, `sampleParams` ne le porte plus) — pas le `toContain` qui la
        // suit. Angle mort assumé, différent : une SUPPRESSION du `{xxx}` (pas un renommage)
        // dans les 4 langues à la fois ferait disparaître ce nom de `paramNames(fr)`, et cette
        // boucle n'itérerait plus dessus — non couvert ici, hors du cas demandé par la revue.
        for (const paramName of paramNames(phraseFor(fr, code))) {
          const value = sampleParams[paramName]
          expect(value, `${name}/${code} : sampleParams.${paramName} manquant`).not.toBeUndefined()
          expect(out, `${name}/${code}/{${paramName}}`).toContain(String(value))
        }
      }
    })
  }

  it('allemand : les guillemets bas-haut « „…“ » collés à {ref} s\'interpolent sans casse', () => {
    const i18n = createI18n({ legacy: false, locale: 'de', messages: { de } })
    const out = i18n.global.t('warnings.zip.missingImage', { ref: 'photo.png' })
    expect(out).toBe(
      'Bild im Zip nicht gefunden: „photo.png“ — Verweis entfernt, der Rest der Anleitung bleibt erhalten.',
    )
  })

  it('le "%" littéral des phrases merge.* n\'est pas interprété comme un modificateur vue-i18n', () => {
    for (const [name, dict] of [['fr', fr], ['de', de], ['es', es]]) {
      const i18n = createI18n({ legacy: false, locale: name, messages: { [name]: dict } })
      const out = i18n.global.t('warnings.merge.fewerSections')
      expect(out, name).toContain('%')
    }
  })
})

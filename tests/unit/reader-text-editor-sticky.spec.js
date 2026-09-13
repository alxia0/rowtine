// Les travaux visant à rendre de la place à l'écran de correction.
//
// AVANT ce changement, ce fichier scrapait le SOURCE CSS (vitest.config.js a `css: false`,
// getComputedStyle y est aveugle, cf. commentaire historique ci-dessous conservé pour
// mémoire) pour policer un invariant que ce changement SUPPRIME : l'accord entre le `top` en
// calc() de `.rte__controls` et celui, plus long, de `.cm-retag-toolbar`. Les deux
// bandeaux sont désormais fusionnés en un seul conteneur collant (`.rte__bar`) — il
// n'y a donc plus deux `top` à faire concorder, et les 5 assertions qui vérifiaient
// cet accord (position sticky des DEUX barres, contenu du `top` de la barre
// catégories préfixé par celui des flèches, z-index relatif des DEUX barres,
// nowrap comme garde-fou contre un overlap entre les DEUX barres) n'ont plus d'objet.
//
// Ce que ces assertions mesuraient — le rendu RÉEL, empilement visuel sans
// chevauchement ni fente — est désormais couvert par le rendu réel dans
// tests/e2e/correction-barre-unique.spec.js :
// - « aucune tranche de texte du patron n'est peinte entre les bandeaux » (test A) :
//   remplace l'ancienne assertion d'accord entre les deux `top` — elle mesure le nœud
//   RÉELLEMENT peint à l'écran, pas une valeur CSS déclarée.
// - « un seul bandeau collant dans l'éditeur (.rte) » (test B) : remplace les
//   assertions position:sticky×2 et z-index relatif — l'invariant qui compte
//   maintenant est qu'il n'y en ait plus qu'UN, pas que deux s'accordent.
//
// La seule assertion qui garde un sens en scrapant le source (pas de rendu réel à
// vérifier, juste que le composant reprend bien une formule figée ailleurs) : le
// `top` de `.rte__bar` reprend exactement la boîte d'AppHeader, et le z-index
// d'AppHeader reste supérieur à celui de la barre — cf. ci-dessous.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const componentSrc = readFileSync(
  resolve(process.cwd(), 'src/components/ReaderTextEditor.vue'),
  'utf8',
)
const headerSrc = readFileSync(resolve(process.cwd(), 'src/components/AppHeader.vue'), 'utf8')

// Extrait le corps `{ ... }` de la PREMIÈRE règle dont le sélecteur (littéral,
// espaces échappées) est suivi de `{` — les blocs ciblés ici n'ont pas
// d'accolade imbriquée ni dans leurs déclarations ni dans leurs commentaires,
// donc « jusqu'à la première } » borne bien la règle.
function ruleBody(css, selector) {
  const re = new RegExp(selector.replace(/[.[\]]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\}', 'm')
  const m = css.match(re)
  if (!m) throw new Error(`règle introuvable : ${selector}`)
  return m[1]
}

function declValue(body, prop) {
  const m = body.match(new RegExp(`(?:^|\\s)${prop}\\s*:\\s*([^;]+);`))
  if (!m) throw new Error(`déclaration introuvable : ${prop}`)
  return m[1].replace(/\s+/g, ' ').trim()
}

// Découpe une valeur CSS sur ses espaces de NIVEAU 0 seulement (profondeur de
// parenthèses 0) : un `max(var(--sp-4), var(--sa-top))` reste un seul jeton même si
// la valeur a été aplatie sur une seule ligne par declValue (l'espace après la
// virgule est à profondeur 1, jamais retenu comme séparateur). Sert à décomposer le
// raccourci `padding: haut droite bas gauche` en ses 4 valeurs individuelles.
function splitTopLevel(value) {
  const tokens = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ' ' && depth === 0) {
      if (current) tokens.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

// `ruleBody` n'accepte qu'UN sélecteur littéral : `.hdr__back` et `.hdr__burger`
// partagent leur règle (`height: 44px` commun), sélecteur combiné sur 2 lignes.
function ruleBodyCombined(css, selectors) {
  const pattern =
    selectors.map((s) => s.replace(/[.[\]]/g, '\\$&')).join('\\s*,\\s*') + '\\s*\\{([\\s\\S]*?)\\n\\}'
  const m = css.match(new RegExp(pattern, 'm'))
  if (!m) throw new Error(`règle combinée introuvable : ${selectors.join(', ')}`)
  return m[1]
}

describe('ReaderTextEditor — .rte__bar, le bandeau collant unique', () => {
  const barBody = ruleBody(componentSrc, '.rte__bar')
  const headerBody = ruleBody(headerSrc, '.hdr')

  it('.rte__bar se cale exactement sous AppHeader (top DÉRIVÉ de la boîte .hdr, pas recopié)', () => {
    // Dérive la hauteur de boîte d'AppHeader depuis SA PROPRE source, plutôt que de
    // comparer `.rte__bar` à une chaîne recopiée en dur ici (une tautologie au titre
    // trompeur : si la formule de `.hdr` changeait, une chaîne figée resterait verte
    // à tort). `padding` est un raccourci à 4 valeurs (haut droite bas gauche) : la
    // hauteur de boîte = padding-top + hauteur du contenu (le bouton burger/retour,
    // cf. `.hdr__back, .hdr__burger { height: 44px }`) + padding-bottom.
    const paddingTokens = splitTopLevel(declValue(headerBody, 'padding'))
    const paddingTop = paddingTokens[0]
    const paddingBottom = paddingTokens[2]
    const buttonHeight = declValue(ruleBodyCombined(headerSrc, ['.hdr__back', '.hdr__burger']), 'height')
    // La formule utilise var(--sa-top), déclaré dans tokens.css avec
    // env(safe-area-inset-top, 0px) comme valeur — comportement équivalent,
    // point d'entrée unique pour tous les appels directs à env().
    expect(declValue(barBody, 'top')).toBe(`calc(${paddingTop} + ${buttonHeight} + ${paddingBottom})`)
  })

  it("z-index : AppHeader reste toujours au-dessus de .rte__bar", () => {
    const headerZ = Number(declValue(headerBody, 'z-index'))
    const barZ = Number(declValue(barBody, 'z-index'))
    expect(headerZ).toBeGreaterThan(barZ)
  })

  it('.rte__bar garde bien position: sticky (invariant dont dépend measureStickyTopHeight)', () => {
    expect(declValue(barBody, 'position')).toBe('sticky')
  })
})

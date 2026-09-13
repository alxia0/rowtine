import { describe, it, expect } from 'vitest'
import { findSizeVectors, applySizeVectors } from '@/utils/pdf-import/sizes'

describe('notation de tailles groupée (Mia Cardigan, 11 tailles)', () => {
  it('lit les 11 valeurs, queue post-parenthèse comprise', () => {
    const L = 'Cast on 99 (99, 101, 101, 101) (103, 111, 113, 115) 123, 125 sts on a 4mm needle.'
    const v = findSizeVectors(L).find((x) => x.values.length === 11)
    expect(v?.values).toEqual(
      ['99', '99', '101', '101', '101', '103', '111', '113', '115', '123', '125'])
  })

  it('produit un vecteur exploitable pour 11 tailles', () => {
    const L = 'Cast on 99 (99, 101, 101, 101) (103, 111, 113, 115) 123, 125 sts on a 4mm needle.'
    const { t, c } = applySizeVectors(L, 11)
    expect(t).toContain('{{0}}')
    expect(c[0][3]).toBe('101') // taille 4
  })

  it('ne casse pas la notation alternée du dialecte', () => {
    const { c } = applySizeVectors('Cast on 99 (99) 101 (101) 101 (103) 111 (113) 115 (123) 125 sts.', 11)
    expect(c[0]).toHaveLength(11)
    expect(c[0][3]).toBe('101')
  })

  // Revue du commit 950190f : les 2 propriétés qui rendent la queue post-parenthèse SÛRE
  // n'étaient affirmées QUE dans le commentaire (sizes.js:35-41), aucun test ne les épingle.
  it('non-invention : une liste de prose chiffrée sans parenthèse ne devient jamais un vecteur', () => {
    // Aucun groupe (…) dans la ligne : VEC_RE exige un groupe, la queue (TAIL_RUN) n'est
    // JAMAIS utilisée en tête de vecteur (cf. sizes.js:35-37). Une régression plausible serait
    // d'ajouter une regex de liste comma-séparée INDÉPENDANTE (à la manière de BRACKET_VEC_RE)
    // au lieu de l'ancrer à `\)\s*TAIL_RUN` — elle capterait alors n'importe quelle prose.
    expect(findSizeVectors('Monter 90, 100, 110 mailles')).toEqual([])
  })

  it('non-invention : la queue ne s\'accroche qu\'à LA parenthèse du vecteur, pas à une parenthèse plus tôt dans la ligne', () => {
    // « (4) » est une parenthèse d'aiguille, sans rapport ; le mot « puis monter » intercalé
    // doit couper toute continuité de queue. Une régression plausible : chercher la DERNIÈRE
    // parenthèse fermante de la ligne (au lieu de l'adjacence immédiate `\)\s*`) et sauter les
    // mots pour reprendre la liste de nombres plus loin.
    expect(findSizeVectors('Aiguilles (4) puis monter 90, 100, 110 m')).toEqual([])
  })

  it('anti-ReDoS : reste linéaire sur une longue liste de décimales françaises sans groupe', () => {
    // Décimales « 4,5 » (virgule COLLÉE au chiffre, cf. VEC_NUM_DEC) enchaînées par de simples
    // espaces, SANS aucun groupe (…) : VEC_RE échoue partout (groupe obligatoire), mais doit
    // le faire vite malgré le run de nombres libres pathologique.
    const k = 500
    const evil = 'Cast on ' + '4,5 '.repeat(k) + 'sts'
    const t0 = performance.now()
    const out = findSizeVectors(evil)
    const ms = performance.now() - t0
    expect(out).toEqual([])
    // Seuil volontairement LARGE (1 s) : le but est d'attraper une explosion exponentielle
    // (blocage), pas de mesurer une performance précise — un seuil serré rendrait le test
    // instable sur une machine chargée. Mesuré en pratique : ~1-8 ms pour k jusqu'à 2000.
    expect(ms).toBeLessThan(1000)
  })

  it('anti-ReDoS : reste linéaire sur une longue queue de décimales séparées par virgule+espace', () => {
    // Variante « virgules et espaces » : la queue post-parenthèse (TAIL_RUN, séparateur
    // `\s*,\s+`) doit rester DISJOINTE de la décimale française « 4,5 » (virgule collée, sans
    // espace) même répétée un grand nombre de fois — sinon chaque virgule redevient ambiguë
    // (décimale vs séparateur de queue) et le parcours redevient exponentiel (cf. sizes.js:38-41).
    const k = 500
    const evil = 'Aiguilles (4) ' + '4,5, '.repeat(k) + 'mm'
    const t0 = performance.now()
    findSizeVectors(evil)
    const ms = performance.now() - t0
    // Même remarque : seuil large (1 s), pas une mesure de perf. Mesuré en pratique : < 1 ms.
    expect(ms).toBeLessThan(1000)
  })
})

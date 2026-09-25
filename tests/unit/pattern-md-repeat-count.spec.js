import { describe, it, expect } from 'vitest'
import { mdToPattern } from '@/utils/pattern-md/parse'
import { patternToMd } from '@/utils/pattern-md/serialize'

// BUG #1 (parse.js, branche legacy « - × … ») : sur un patron à N sous-tailles, le
// seul vecteur à N valeurs d'une ligne « … 5 times (= 80 (80) … 84 sts) » est le
// compte de MAILLES, pas le « 5 times ». L'ancien code prenait st.c[0] (les mailles)
// comme `total` → le lecteur affichait 80 « répéter 80 fois » au lieu de 5.
// Le correctif détecte un compte EXPLICITE « … times|fois » et le préfère.
const HEAD = [
  '---',
  'rowtine: 1',
  'title: Roni',
  'sizes: XS · S · M · L · XL · 2XL · 3XL · 4XL · 5XL', // 9 sous-tailles
  '---',
  '',
  '## Yoke {yoke}',
  '',
].join('\n')
const md = (body) => HEAD + body + '\n'
const repStep = (reader) => {
  for (const sec of reader.sections) for (const st of sec.steps || []) if (st.repeat) return st
  return null
}
const firstRepStep = (mdStr) => repStep(mdToPattern(mdStr).pattern.reader)

describe('BUG #1 — le compteur legacy « × » prend le vrai « N times/fois », pas les mailles', () => {
  it('scalaire « 5 times » gagne sur le vecteur de mailles (Roni : 5, pas 80)', () => {
    const st = firstRepStep(md('- × Repeat R 1-2 in total 5 times (= 80 (80) 80 (82) 82 (82) 84 (84) 84 sts).'))
    expect(st.repeat).toBe(true)
    expect(st.total).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5])
  })

  it('scalaire « 2 times » (autre ligne Roni : 2, pas 100)', () => {
    const st = firstRepStep(md('- × Repeat these 2 rs in total 2 times (= 100 (100) 100 (102) 102 (102) 104 (104) 104 sts).'))
    expect(st.total).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2])
  })

  // COMPTEUR-AVANT-MAILLES : le vecteur compteur (12 … 22) vient AVANT le vecteur
  // mailles (256 … 368) → st.c[0] = le compteur. vecRep lit {{0}} = le compteur, MAIS
  // le repli historique c[0] donnerait DÉJÀ le même vecteur : ce cas passe donc avec
  // ou sans vecRep, il ne DISCRIMINE pas la branche (cf. le cas mailles-avant-compteur
  // ci-dessous, lui vraiment porteur). On le garde comme garde de non-régression de la
  // forme la plus courante (compteur en tête).
  it('vecteur par-taille « {{i}} times » COMPTEUR-avant-mailles (12 (12) … 22 times → distribution par taille)', () => {
    const st = firstRepStep(md('- × Repeat these 2 rs in total 12 (12) 13 (14) 16 (18) 20 (22) 22 times (= 256 (256) 264 (276) 292 (316) 344 (368) 368 sts).'))
    expect(st.total).toEqual([12, 12, 13, 14, 16, 18, 20, 22, 22])
  })

  // MAILLES-AVANT-COMPTEUR = le cas qui COUVRE réellement `vecRep` (parse.js ~l.241-243).
  // Ici le vecteur MAILLES (256 … 368) vient en PREMIER → st.c[0] = les mailles, et le
  // vecteur COMPTEUR (12 … 22) vient en SECOND → st.c[1]. Le texte rendu par le lecteur
  // devient « … {{0}} sts, then repeat … {{1}} times » : `vecRep` matche « {{1}} times »
  // et lit st.c[1] (le compteur, correct). SANS `vecRep`, aucun « N times » nu ne subsiste
  // (le nombre est un jeton {{1}}), donc scalRep échoue et le repli tombe sur c[0] = les
  // MAILLES [256…] — FAUX. Ce test rougit donc si l'on retire `vecRep` (preuve par mutation).
  it('vecteur par-taille MAILLES-avant-compteur : total = le compteur, JAMAIS les mailles (couvre vecRep)', () => {
    const st = firstRepStep(md('- × Work even until 256 (256) 264 (276) 292 (316) 344 (368) 368 sts, then repeat the last two rows 12 (12) 13 (14) 16 (18) 20 (22) 22 times.'))
    expect(st.repeat).toBe(true)
    expect(st.total).toEqual([12, 12, 13, 14, 16, 18, 20, 22, 22])
    expect(st.total).not.toEqual([256, 256, 264, 276, 292, 316, 344, 368, 368])
  })

  it('scalaire FR « fois » gagne aussi', () => {
    const st = firstRepStep(md('- × Répéter les rangs 1-2 en tout 5 fois (= 80 (80) 80 (82) 82 (82) 84 (84) 84 m).'))
    expect(st.total).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5])
  })

  it('round-trip parse→serialize→parse stable (total=5 conservé, ligne reste legacy « - × », serialize.js intouché)', () => {
    const src = md('- × Repeat R 1-2 in total 5 times (= 80 (80) 80 (82) 82 (82) 84 (84) 84 sts).')
    const { pattern } = mdToPattern(src)
    const md2 = patternToMd(pattern).md
    expect(md2).toContain('- × Repeat R 1-2 in total 5 times')
    expect(md2).not.toContain('{×') // reste legacy, pas de marqueur éditeur forcé
    expect(firstRepStep(md2).total).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5])
  })

  it('non-régression : sans « times/fois », repli historique inchangé (vecteur par-taille)', () => {
    const st = firstRepStep(['---', 'rowtine: 1', 'title: T', 'sizes: S · M', '---', '', '## Corps {body}', '', '- × Rép. ce tour 4 (6) fois.', ''].join('\n'))
    expect(st.total.map(Number)).toEqual([4, 6])
  })
})

describe('BUG #2 — le repli vectoriel ne doit pas confondre mailles et répétitions', () => {
  // Cas vectoriel qui déclenchait le bug : ligne « N times (= mailles) » avec vecteur.
  // Quand le premier vecteur (mailles) vient AVANT le second (compteur de répétitions),
  // st.c[0] = les mailles. Sans la branche vecRep qui extrait st.c[1], le repli tomberait
  // sur c[0] = les MAILLES, ce qui serait faux. Même si vecRep fonctionne déjà, le repli
  // doit maintenant vérifier qu'il n'y a pas « times/fois » pour éviter une régression
  // si vecRep était contourné par une autre cause (st.c[1] manquant, regex malformée).
  it('vecteur : mailles avant compteur, avec « times » explicite — repli ne prend pas les mailles', () => {
    const st = firstRepStep(md('- × Work even until 256 (256) 264 (276) 292 (316) 344 (368) 368 sts, then repeat the last 2 rows 12 (12) 13 (14) 16 (18) 20 (22) 22 times.'))
    expect(st.repeat).toBe(true)
    expect(st.total).toEqual([12, 12, 13, 14, 16, 18, 20, 22, 22])
    expect(st.total).not.toEqual([256, 256, 264, 276, 292, 316, 344, 368, 368])
  })

  // Vérification que le cas scalaire déjà corrigé n'a pas régressé : le fix vectoriel
  // ne doit pas affecter le traitement scalaire.
  it('scalaire : non-régression du cas « 5 times (= mailles) »', () => {
    const st = firstRepStep(md('- × Repeat R 1-2 in total 5 times (= 80 (80) 80 (82) 82 (82) 84 (84) 84 sts).'))
    expect(st.repeat).toBe(true)
    expect(st.total).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5])
    expect(st.total).not.toEqual([80, 80, 80, 82, 82, 82, 84, 84, 84])
  })

  // Cas nominal : répétition vectorielle légitime, sans l'ambiguïté « = mailles ».
  // Le repli historique doit continuer à fonctionner quand il n'y a PAS de « times/fois ».
  it('cas nominal : pas de « times/fois » → repli historique inchangé', () => {
    const st = firstRepStep(['---', 'rowtine: 1', 'title: T', 'sizes: XS · S · M · L · XL', '---', '', '## Corps {body}', '', '- × Tous les 4 (5) (6) (7) (8) rangs.', ''].join('\n'))
    expect(st.repeat).toBe(true)
    expect(st.total).toEqual([4, 5, 6, 7, 8])
  })

  // SABAI regression : ligne avec vecteur et mot de liaison avant times/fois (« autres/more/etc. »).
  // Avant le fix, vecRep ne matchait pas « {{0}} autres fois » (manquait le mot de liaison),
  // et le guard trop large rejetait le fallback st.c[0] juste en voyant « fois ». Résultat :
  // fallback chiffre trouvait « 3 » de « les rgs 3 et 4 » au lieu de [18,18,14,…] de st.c[0].
  // La regex élargie et la suppression du guard trop large restaurent le comportement correct.
  it('SABAI : vecteur avec mot de liaison (« autres/more ») avant times/fois', () => {
    const st = firstRepStep(['---', 'rowtine: 1', 'title: SABAI', 'sizes: XS · S · M · L · XL · 2XL', '---', '', '## Main {body}', '', '- × Rép. les rgs 3 et 4 encore 18 (18) 14 (14) 11 9 autres fois.', ''].join('\n'))
    expect(st.repeat).toBe(true)
    expect(st.total).toEqual([18, 18, 14, 14, 11, 9])
    // Vérifier que ce n'est pas le chiffre de « les rgs 3 et 4 »
    expect(st.total).not.toEqual([3, 3, 3, 3, 3, 3])
    expect(st.total).not.toEqual([4, 4, 4, 4, 4, 4])
  })

  // Scalaire avec mot de liaison + vecteur de mailles co-present : cas extrême où le scalaire
  // « 5 more times » ne match pas la regex originale car « \s* » ne traverse pas le mot « more ».
  // Avec scalRep élargie, « (\d+)\s*(?:modifier)?\s*times » matche « 5 more times » et capture 5.
  // Cas qui a failli causer une régression en passant inaperçu : scalaire avec modifier + vecteur
  // coexistant (stitch vector en début de ligne, repeat scalar + modifier en fin).
  it('scalaire avec mot de liaison (« more/additional/etc. ») matché via REP_COUNT_SCALAR_RE élargie', () => {
    const st = firstRepStep(['---', 'rowtine: 1', 'title: T', 'sizes: S · M', '---', '', '## Test {body}', '', '- × Continuer pour 5 more times (= 80 (82) m).', ''].join('\n'))
    expect(st.repeat).toBe(true)
    // Vérifier que c'est le scalaire « 5 », pas le vecteur de mailles [80, 82]
    expect(st.total).toEqual([5, 5])
    expect(st.total).not.toEqual([80, 82])
  })
})

describe('D2 — marqueur {×N} vs relecture legacy (défaut vague 2)', () => {
  // Défaut D2 : un step REP d'import arrive avec un `total` extrait par REP_RE
  // (pdf-import/steps.js, qui connaît les unités multilingues : volte, veces, keer…),
  // mais serialize.js ne basculait en {×N} que si la relecture legacy — limitée à
  // times|fois — trahissait le compte. « 7 volte » passait donc en legacy « - × … »
  // et était relu « 2 » (premier nombre du texte) au ré-enregistrement.
  const md1 = ['## Section {other}', '', '- × Ripeti queste 2 righe 7 volte.', ''].join('\n')
  // Une taille (n=1) : normalizeReaderForSave tronque `total` à la longueur n —
  // sans taille, tout total serait lu [] et l'assertion aveugle.
  const front = (body) => ['---', 'rowtine: 1', 'title: T', 'sizes: M', '---', '', body].join('\n')

  it('la relecture legacy retrouve « 7 » via l’unité IT « volte » (REP_KW étendu)', () => {
    const { pattern } = mdToPattern(front(md1))
    expect(pattern.reader.sections[0].steps[0].total).toEqual([7])
  })

  it('sans unité lisible dont le 1er nombre trahit le compte, serialize émet {×N}', () => {
    // « 14 x » : l'IMPORT lit 14 (REP_RE admet l'unité « x »), mais la relecture
    // legacy d'une puce « - × … » prendrait le PREMIER nombre (« 2 ») — le compte
    // ne survit pas à la forme legacy → marqueur {×N} obligatoire.
    const step = { t: 'Répéter ces 2 rangs 14 x', repeat: true, total: [14] }
    const { md } = patternToMd({ reader: { sizeLabels: [], sections: [{ title: 'Section', kind: 'autre', steps: [step] }] } })
    expect(md).toContain('- {×14} ')
  })

  it('round-trip : le compte survit à serialize → parse (cas audrey-tunic-it)', () => {
    // patternToMd émet déjà son propre front-matter : on relit le MD SANS le
    // réentourer (sinon le second front-matter devient une section Présentation
    // parasite qui décale sections[0]). Une taille (n=1), cf. ci-dessus.
    const { md } = patternToMd({ reader: { sizeLabels: ['M'], sections: [{ title: 'Section', kind: 'autre', steps: [{ t: 'Ripeti queste 2 righe 7 volte.', repeat: true, total: [7] }] }] } })
    const { pattern } = mdToPattern(md)
    expect(pattern.reader.sections[0].steps[0].total).toEqual([7])
  })
})

// Protège : l'unité « x » (admise par l'import PDF) garde un total PAR TAILLE à l'aller-retour.
describe('répétition par taille avec l’unité « x »', () => {
  it('« rows {{0}} … {{1}} x » : le total par taille survit à patternToMd → mdToPattern', () => {
    const pattern = {
      name: 'P',
      reader: {
        sizeLabels: ['S', 'M', 'L'],
        sections: [{ title: 'Dos', kind: 'dos', steps: [{ t: 'Rep the last {{0}} rows {{1}} x.', c: [[4, 6, 8], [3, 4, 5]], repeat: true, total: [3, 4, 5] }] }],
      },
    }
    const st = repStep(mdToPattern(patternToMd(pattern).md).pattern.reader)
    expect(st.total).toEqual([3, 4, 5])
  })
})

// Le calcul du façonnage (augmentations/diminutions), hors de tout écran.
// L'essai central est celui de l'ALLER-RETOUR : le sens « combien de rangs »
// et le sens « répartition » doivent être réciproques, sinon l'app se
// contredit d'un onglet à l'autre sur le même ouvrage.
import { describe, it, expect } from 'vitest'
import {
  changesFor,
  distributeOverRows,
  rowsForCadence,
  computeShaping,
} from '@/utils/stitch-shaping'

describe('changesFor — combien de mailles à gagner ou perdre', () => {
  it('compte les mailles à gagner en augmentations', () => {
    expect(changesFor({ mode: 'inc', current: 60, target: 80 })).toEqual({ status: 'ok', changes: 20 })
  })

  it('compte les mailles à perdre en diminutions', () => {
    expect(changesFor({ mode: 'dec', current: 80, target: 60 })).toEqual({ status: 'ok', changes: 20 })
  })

  it('signale une cible incohérente avec le mode choisi', () => {
    expect(changesFor({ mode: 'inc', current: 80, target: 60 }).status).toBe('mismatch')
    expect(changesFor({ mode: 'dec', current: 60, target: 80 }).status).toBe('mismatch')
  })

  it('signale qu’il n’y a rien à changer', () => {
    expect(changesFor({ mode: 'inc', current: 60, target: 60 }).status).toBe('noChange')
  })

  it('rejette les saisies qui ne sont pas des nombres de mailles', () => {
    expect(changesFor({ mode: 'inc', current: 0, target: 80 }).status).toBe('invalid')
    expect(changesFor({ mode: 'inc', current: 60.5, target: 80 }).status).toBe('invalid')
    expect(changesFor({ mode: 'inc', current: -5, target: 80 }).status).toBe('invalid')
  })
})

describe('distributeOverRows — répartir k occurrences sur r rangs', () => {
  it('donne un seul intervalle quand ça tombe juste', () => {
    expect(distributeOverRows({ occurrences: 20, rows: 40 })).toEqual({ dense: false, base: 2, a: 20, b: 0 })
  })

  it('mélange deux intervalles quand il reste des rangs', () => {
    // 30 rangs pour 20 occurrences : 10 intervalles de 1 rang, 10 de 2 rangs (10×1 + 10×2 = 30).
    expect(distributeOverRows({ occurrences: 20, rows: 30 })).toEqual({ dense: false, base: 1, a: 10, b: 10 })
  })

  it('passe en « dense » quand il y a plus d’occurrences que de rangs', () => {
    expect(distributeOverRows({ occurrences: 30, rows: 5 })).toEqual({ dense: true, perRow: 6 })
  })

  it('la somme des intervalles vaut TOUJOURS le nombre de rangs demandé', () => {
    for (const k of [1, 2, 3, 7, 13, 20]) {
      for (const r of [1, 5, 8, 30, 41, 100]) {
        const d = distributeOverRows({ occurrences: k, rows: r })
        if (d.dense) continue
        expect({ total: d.a * d.base + d.b * (d.base + 1), cas: `k=${k} r=${r}` })
          .toEqual({ total: r, cas: `k=${k} r=${r}` })
      }
    }
  })

  it('rejette les saisies invalides', () => {
    expect(distributeOverRows({ occurrences: 0, rows: 40 })).toBeNull()
    expect(distributeOverRows({ occurrences: 20, rows: 0 })).toBeNull()
    expect(distributeOverRows({ occurrences: 20, rows: 2.5 })).toBeNull()
  })
})

describe('rowsForCadence — combien de rangs pour k occurrences', () => {
  it('multiplie les occurrences par la cadence', () => {
    expect(rowsForCadence({ occurrences: 20, cadence: 2 })).toBe(40)
    expect(rowsForCadence({ occurrences: 10, cadence: 4 })).toBe(40)
  })

  it('rejette une cadence invalide', () => {
    expect(rowsForCadence({ occurrences: 20, cadence: 0 })).toBeNull()
    expect(rowsForCadence({ occurrences: 20, cadence: 1.5 })).toBeNull()
  })
})

describe('ALLER-RETOUR — les deux sens de calcul sont réciproques', () => {
  it('répartir sur (fois × cadence) rangs rend exactement « tous les X rangs × k »', () => {
    for (const k of [1, 2, 3, 5, 7, 12, 20]) {
      for (const X of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const cas = `k=${k} X=${X}`
        const rows = rowsForCadence({ occurrences: k, cadence: X })
        expect({ rows, cas }).toEqual({ rows: k * X, cas })
        // Une seule ligne de résultat (b = 0), l'intervalle EST la cadence saisie.
        expect({ ...distributeOverRows({ occurrences: k, rows }), cas })
          .toEqual({ dense: false, base: X, a: k, b: 0, cas })
      }
    }
  })
})

describe('computeShaping — orchestration des deux sens', () => {
  const inc = { mode: 'inc', current: 60, target: 80 }

  it('sens « répartition » : le cas d’usage historique, une maille à chaque fois', () => {
    const r = computeShaping({ ...inc, solveFor: 'rows', perTime: 1, rows: 40 })
    expect(r.kind).toBe('rows')
    expect(r.exact).toBe(true)
    expect(r.changes).toBe(20)
    expect(r.options).toEqual([
      { occurrences: 20, stitches: 80, delta: 0, perTime: 1, dense: false, base: 2, a: 20, b: 0 },
    ])
  })

  it('sens « nombre de rangs » : 60 → 80 tous les 2 rangs = 40 rangs', () => {
    const r = computeShaping({ ...inc, solveFor: 'length', perTime: 1, cadence: 2 })
    expect(r.kind).toBe('length')
    expect(r.exact).toBe(true)
    expect(r.options).toEqual([
      { occurrences: 20, stitches: 80, delta: 0, perTime: 1, rows: 40, cadence: 2 },
    ])
  })

  it('MANCHE : 2 mailles à chaque fois, tous les 4 rangs → 40 rangs (et non 80)', () => {
    const r = computeShaping({ ...inc, solveFor: 'length', perTime: 2, cadence: 4 })
    expect(r.options[0].occurrences).toBe(10)
    expect(r.options[0].rows).toBe(40)
    expect(r.options[0].stitches).toBe(80)
  })

  it('cible non atteignable pile : deux propositions qui l’encadrent', () => {
    const r = computeShaping({ mode: 'inc', current: 60, target: 75, solveFor: 'length', perTime: 2, cadence: 4 })
    expect(r.exact).toBe(false)
    expect(r.options).toEqual([
      { occurrences: 7, stitches: 74, delta: -1, perTime: 2, rows: 28, cadence: 4 },
      { occurrences: 8, stitches: 76, delta: 1, perTime: 2, rows: 32, cadence: 4 },
    ])
  })

  it('cible non atteignable pile, sens « répartition » : deux répartitions complètes', () => {
    const r = computeShaping({ mode: 'inc', current: 60, target: 75, solveFor: 'rows', perTime: 2, rows: 40 })
    expect(r.exact).toBe(false)
    expect(r.options).toEqual([
      { occurrences: 7, stitches: 74, delta: -1, perTime: 2, dense: false, base: 5, a: 2, b: 5 },
      { occurrences: 8, stitches: 76, delta: 1, perTime: 2, dense: false, base: 5, a: 8, b: 0 },
    ])
  })

  it('diminutions non atteignables pile : l’écart change de signe, pas l’ordre', () => {
    const r = computeShaping({ mode: 'dec', current: 80, target: 65, solveFor: 'length', perTime: 2, cadence: 4 })
    expect(r.options.map((o) => [o.occurrences, o.stitches, o.delta])).toEqual([
      [7, 66, 1],
      [8, 64, -1],
    ])
  })

  it('n’affiche qu’une proposition quand la basse reviendrait à ne rien changer', () => {
    // 1 maille d'écart en pas de 2 : la proposition basse serait « 0 fois ».
    const r = computeShaping({ mode: 'inc', current: 60, target: 61, solveFor: 'length', perTime: 2, cadence: 4 })
    expect(r.exact).toBe(false)
    expect(r.options).toEqual([
      { occurrences: 1, stitches: 62, delta: 1, perTime: 2, rows: 4, cadence: 4 },
    ])
  })

  it('ne rend jamais un nombre de mailles négatif ou nul (5 → 1, 3 mailles à chaque fois)', () => {
    // En pas de 3, la proposition haute (« 2 fois ») retirerait 6 mailles à 5 : impossible.
    // Une seule proposition doit rester, et aucune option (sur tout un balayage de cas
    // limites) ne doit jamais tomber sous 1 maille.
    const r = computeShaping({ mode: 'dec', current: 5, target: 1, solveFor: 'length', perTime: 3, cadence: 2 })
    expect(r.exact).toBe(false)
    expect(r.options).toEqual([{ occurrences: 1, stitches: 2, delta: 1, perTime: 3, rows: 2, cadence: 2 }])

    // La liste ne doit JAMAIS devenir vide non plus (cf. « n'affiche qu'une
    // proposition quand la basse reviendrait à ne rien changer » ci-dessus,
    // et le repli en « 0 fois » plus bas pour le cas extrême où même une
    // seule occurrence passerait sous 1 maille) : balayage exhaustif de cas
    // limites, sur les deux sens et les deux modes.
    for (const current of [1, 2, 3, 4, 5, 6, 10])
      for (const target of [1, 2, 3, 4, 5, 6, 10])
        for (const perTime of [1, 2, 3, 4])
          for (const mode of ['inc', 'dec'])
            for (const solveFor of ['rows', 'length']) {
              if (mode === 'inc' && target <= current) continue
              if (mode === 'dec' && target >= current) continue
              const res = computeShaping({
                mode,
                current,
                target,
                perTime,
                solveFor,
                rows: 40,
                cadence: 2,
              })
              if (res.kind !== 'rows' && res.kind !== 'length') continue
              const cas = `mode=${mode} ${current}→${target} perTime=${perTime} solveFor=${solveFor}`
              // Sans cette ligne, la boucle passerait sur une liste vide et ne
              // prouverait rien sur un cas qui aurait tout filtré par erreur.
              expect(res.options.length, cas).toBeGreaterThanOrEqual(1)
              for (const o of res.options) {
                expect(o.stitches, cas).toBeGreaterThanOrEqual(1)
              }
            }
  })

  it('replie sur « 0 fois » quand même une seule occurrence passerait sous 1 maille (perTime ≥ current, en diminutions)', () => {
    // Cas extrême découvert en durcissant le correctif ci-dessus : avec
    // perTime >= current (ex. 5 mailles actuelles, 5 mailles retirées à
    // chaque fois), la proposition basse (0 fois) est déjà écartée comme
    // « ne change rien », et la proposition haute (1 fois) retomberait à 0
    // maille ou moins — donc filtrée elle aussi. Sans repli, la liste devient
    // vide et le gabarit (qui lit `res.options[0].perTime` dès que la cible
    // n'est pas exacte) PLANTE littéralement au rendu. Le repli sur « 0 fois »
    // est la seule proposition qui reste valable : rien ne change, l'écart
    // à la cible se lit dans son `delta`.
    const r = computeShaping({ mode: 'dec', current: 5, target: 3, solveFor: 'length', perTime: 5, cadence: 2 })
    expect(r.exact).toBe(false)
    expect(r.options).toEqual([{ occurrences: 0, stitches: 5, delta: 2, perTime: 5, rows: 0, cadence: 2 }])

    const r2 = computeShaping({ mode: 'dec', current: 3, target: 1, solveFor: 'rows', perTime: 5, rows: 40 })
    expect(r2.options).toEqual([{ occurrences: 0, stitches: 3, delta: 2, perTime: 5 }])
  })

  it('reconduit les états « incohérent » et « rien à changer »', () => {
    expect(computeShaping({ mode: 'inc', current: 80, target: 60, solveFor: 'rows', perTime: 1, rows: 40 }).kind).toBe('mismatch')
    expect(computeShaping({ mode: 'inc', current: 60, target: 60, solveFor: 'rows', perTime: 1, rows: 40 }).kind).toBe('noChange')
  })

  it('reste « incomplet » tant qu’une saisie manque ou n’est pas un entier ≥ 1', () => {
    const cas = [
      { ...inc, solveFor: 'rows', perTime: 1, rows: '' },
      { ...inc, solveFor: 'rows', perTime: 1, rows: 0 },
      { ...inc, solveFor: 'rows', perTime: 1, rows: '2,5' },
      { ...inc, solveFor: 'length', perTime: 1, cadence: '' },
      { ...inc, solveFor: 'length', perTime: 0, cadence: 4 },
      { mode: 'inc', current: '', target: 80, solveFor: 'length', perTime: 1, cadence: 4 },
    ]
    for (const c of cas) expect({ kind: computeShaping(c).kind, c }).toEqual({ kind: 'incomplete', c })
  })

  it('accepte les chaînes de saisie et traite un champ « mailles à chaque fois » vide comme 1', () => {
    const r = computeShaping({ mode: 'inc', current: '60', target: '80', solveFor: 'rows', perTime: '', rows: '40' })
    expect(r.options[0]).toMatchObject({ occurrences: 20, perTime: 1 })
  })
})

import { describe, it, expect } from 'vitest'
import { stepPlaceholders, compactStepCounts, resizeStepCounts, normalizeReaderForSave } from '@/utils/reader-edit'
import { validateReader, formatSizes, pickCount } from '@/utils/reader'

describe('stepPlaceholders', () => {
  it('indices distincts dans l\'ordre d\'apparition', () => {
    expect(stepPlaceholders('a {{2}} b {{0}} c {{2}}')).toEqual([2, 0])
    expect(stepPlaceholders('rien')).toEqual([])
  })
})

describe('compactStepCounts', () => {
  it('renumérote les placeholders et réaligne c', () => {
    const out = compactStepCounts({ t: 'a {{2}} b {{0}}', c: [[1, 2], [3, 4], [5, 6]] })
    expect(out.t).toBe('a {{0}} b {{1}}')
    expect(out.c).toEqual([[5, 6], [1, 2]]) // c[2]→col0, c[0]→col1
  })
  it('gère {{10}} vs {{1}} sans collision de préfixe', () => {
    const out = compactStepCounts({ t: '{{1}} et {{10}}', c: [[0], [9], [0,0,0,0,0,0,0,0,0,0], [0]] })
    // indices utilisés : 1 puis 10 → 0 puis 1
    expect(out.t).toBe('{{0}} et {{1}}')
    expect(out.c[0]).toEqual([9])
  })
  it('supprime c s\'il n\'y a aucun placeholder', () => {
    expect(compactStepCounts({ t: 'texte', c: [[1, 2]] })).not.toHaveProperty('c')
  })
  it('ne touche pas une étape chart', () => {
    expect(compactStepCounts({ chart: true })).toEqual({ chart: true })
  })
})

describe('resizeStepCounts', () => {
  // NON-RÉGRESSION du broadcast (I3) : une valeur UNIQUE vaut pour toutes les tailles —
  // rien n'est invente, c'est la semantique de l'ancien `broadcast` et une bonne partie des
  // patrons importes en depend. Cette branche ne doit PAS changer.
  it('ramène c[j] et total à n (une valeur unique se diffuse sur toutes les tailles)', () => {
    const out = resizeStepCounts({ t: '{{0}}', c: [[7]], repeat: true, total: [3] }, 3)
    expect(out.c[0]).toEqual([7, 7, 7])
    expect(out.total).toEqual([3, 3, 3])
  })
  it('tronque si trop long', () => {
    expect(resizeStepCounts({ c: [[1, 2, 3, 4]] }, 2).c[0]).toEqual([1, 2])
  })

  // I3 (arbitrage proprietaire, 20/08/2026) : un vecteur DEJA multi-valeurs, plus court que
  // n, se completait par recopie de la derniere valeur — « monter 10 (12) 14 m » devenait
  // « 10 (12) 14 (14) » en passant a 4 tailles, et ce 14 en XL etait presente comme une
  // donnee du patron alors que personne ne l'a ecrit. Grammaire de non-invention : la case
  // reste VIDE, l'utilisatrice voit qu'il manque une valeur.
  it('un vecteur multi-valeurs se complete par du vide, jamais par recopie', () => {
    const out = resizeStepCounts({ t: '{{0}}', c: [[10, 12, 14]], repeat: true, total: [30, 32, 34] }, 4)
    expect(out.c[0]).toEqual([10, 12, 14, ''])
    expect(out.total).toEqual([30, 32, 34, ''])
  })

  it('un vecteur vide reste comble de zeros (artefact d import, jamais affiche)', () => {
    expect(resizeStepCounts({ t: '{{0}}', c: [[]] }, 3).c[0]).toEqual([0, 0, 0])
  })

  // IDEMPOTENCE (I3) : cette fonction repasse sur ses propres sorties — rouvrir l'ecran de
  // correction puis reenregistrer suffit (le carving restaure le step de base, qui repart par
  // normalizeReaderForSave). Une case vide ramenee a 0 a l'entree faisait revenir la valeur
  // inventee au DEUXIEME enregistrement, en pire : « 0 maille ».
  it('la case vide survit a un second passage (idempotence)', () => {
    const once = resizeStepCounts({ t: '{{0}}', c: [[10, 12, 14]], repeat: true, total: [30] }, 4)
    const twice = resizeStepCounts(once, 4)
    expect(twice.c[0]).toEqual([10, 12, 14, ''])
    expect(twice).toEqual(once)
  })

  it('un reader deja normalise le reste (normalizeReaderForSave idempotente sur les cases vides)', () => {
    const reader = {
      sizeLabels: ['S', 'M', 'L'],
      sections: [{ title: 'Corps', steps: [{ t: 'monter {{0}} m', c: [['10', '12', '14']] }] }],
    }
    const once = normalizeReaderForSave(reader, ['S', 'M', 'L', 'XL'])
    const twice = normalizeReaderForSave(once, ['S', 'M', 'L', 'XL'])
    expect(once.sections[0].steps[0].c[0]).toEqual([10, 12, 14, ''])
    expect(twice.sections[0].steps[0].c[0]).toEqual([10, 12, 14, ''])
  })

  // Pourquoi `''` et pas `0` : rendu OBSERVE, pas deduit. `0` afficherait « (0) » / « 0 »,
  // c'est-a-dire zero maille — une invention fausse ; `''` laisse la case vide.
  it('la valeur de complement produit bien une case vide a l affichage', () => {
    const c = resizeStepCounts({ t: '{{0}}', c: [[10, 12, 14]] }, 4).c[0]
    expect(String(pickCount(c, 3))).toBe('')
    expect(formatSizes(c)).toBe('10 (12) 14 ()')
    expect(String(pickCount([10, 12, 14, 0], 3))).toBe('0') // ce que l'ancien comportement montrait
  })
})

describe('normalizeReaderForSave — round-trip validateReader', () => {
  it('produit un reader valide (c dense, contigu, tous utilisés, longueur N)', () => {
    const reader = { sizeLabels: [], sections: [
      { id: 's', icon: '🧶', title: 'S', steps: [
        { t: 'Monter {{2}} m puis {{0}} m', c: [[10], [999], [20]] }, // c[1] inutilisé, mono-colonne
        { t: 'Rép {{0}} fois', repeat: true, total: [4], c: [[4]] },
      ] },
    ] }
    const out = normalizeReaderForSave(reader, ['S', 'M', 'L']) // n = 3
    expect(validateReader(out)).toEqual([])
  })
  it('préserve un patron riche déjà dense (SABAI-like) inchangé', () => {
    const reader = { sizeLabels: ['A','B','C'], sections: [
      { id: 's', icon: '🧶', title: 'S', steps: [{ t: 'x {{0}}', c: [[1, 2, 3]] }] },
    ] }
    const out = normalizeReaderForSave(reader, ['A', 'B', 'C'])
    expect(out.sections[0].steps[0].c).toEqual([[1, 2, 3]])
    expect(validateReader(out)).toEqual([])
  })
})

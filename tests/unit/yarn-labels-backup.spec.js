// La sauvegarde sérialise l'objet entier (collect.js `db.yarns.toArray()` puis
// serialize.js:190 `JSON.stringify(yarns)`), donc `labels` devrait suivre tout seul.
// « Devrait » ne suffit pas : ce test le PROUVE, parce qu'une perte y serait silencieuse.
// Verrouille un comportement DÉJÀ correct (caractéristiques, 05/08), pour qu'une
// refactorisation future qui listerait les champs un par un le casse bruyamment plutôt
// qu'en silence.
import { describe, it, expect } from 'vitest'
import { serializeYarns } from '@/backup/serialize'
import { deserializeYarns } from '@/backup/restore'

describe('sauvegarde des caractéristiques', () => {
  it('conserve les labels dans le fichier de sauvegarde', () => {
    const { files } = serializeYarns([{ id: 1, brand: 'Drops', labels: ['vegan', 'rws'] }])
    const data = files.find((f) => f.path === 'laines.json').data
    expect(JSON.parse(data)[0].labels).toEqual(['vegan', 'rws'])
  })

  // Revue finale (correction 3, 06/08/2026) : le critère de réussite nº 10 dit « une
  // sauvegarde PUIS une restauration conservent les labels » — le test ci-dessus ne prouve
  // que la moitié (sérialisation). `deserializeYarns` de restore.js RECONSTRUIT chaque laine
  // (migration reservedFor/reservedQty → reservations/consumed, cf. son commentaire) : c'est
  // exactement ce type de site qui a déjà fait perdre de l'information à ce projet. Aller-
  // retour complet : sérialise, reparse (ce que fait readRootJson), désérialise via
  // restore.js (pas deserialize.js — c'est CE désérialiseur que readBackup appelle).
  it('conserve les labels après un aller-retour sauvegarde puis restauration', () => {
    const { files } = serializeYarns([{ id: 1, brand: 'Drops', labels: ['vegan', 'rws'] }])
    const data = files.find((f) => f.path === 'laines.json').data
    const restored = deserializeYarns(JSON.parse(data))
    expect(restored[0].labels).toEqual(['vegan', 'rws'])
  })
})

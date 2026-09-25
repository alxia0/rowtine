// @vitest-environment jsdom
// Les caractéristiques (`labels`) d'une laine survivent à la sauvegarde puis à la restauration.
// Aujourd'hui elles suivent seules (objet sérialisé entier) : ce test fait casser bruyamment une
// refactorisation qui listerait les champs un par un.
import { describe, it, expect } from 'vitest'
import { serializeYarns } from '@/backup/serialize'
import { deserializeYarns } from '@/backup/restore'

describe('sauvegarde des caractéristiques', () => {
  it('conserve les labels dans le fichier de sauvegarde', () => {
    const { files } = serializeYarns([{ id: 1, brand: 'Drops', labels: ['vegan', 'rws'] }])
    const data = files.find((f) => f.path === 'laines.json').data
    expect(JSON.parse(data)[0].labels).toEqual(['vegan', 'rws'])
  })

  // Aller-retour complet via `deserializeYarns` de restore.js (celui qu'appelle readBackup) :
  // il RECONSTRUIT chaque laine (migration des réservations), le genre de site qui perd un champ.
  it('conserve les labels après un aller-retour sauvegarde puis restauration', () => {
    const { files } = serializeYarns([{ id: 1, brand: 'Drops', labels: ['vegan', 'rws'] }])
    const data = files.find((f) => f.path === 'laines.json').data
    const restored = deserializeYarns(JSON.parse(data))
    expect(restored[0].labels).toEqual(['vegan', 'rws'])
  })
})

// La carte du projet-idée « Écharpe douillette » affiche la photo de SON PATRON
// (resolveCover retombe dessus, faute de photo propre). Depuis que cette photo est une
// vraie écharpe VERT SAUGE (12/08), une note qui annonce « gris clair » fait mentir la
// carte sous les yeux de l'utilisatrice, dans un exemple censé enseigner l'app.
//
// On ancre sur LA VALEUR DE LA CLÉ, jamais sur « la chaîne existe quelque part dans le
// fichier » : un test qui cherche dans le fichier entier reste vert quand la note change
// mais qu'un commentaire garde l'ancien mot.
import { describe, it, expect } from 'vitest'
import fr from '@/constants/demo/fr'
import en from '@/constants/demo/en'
import de from '@/constants/demo/de'
import es from '@/constants/demo/es'

const CAS = [
  ['fr', fr, 'vert sauge', 'gris clair'],
  ['en', en, 'sage green', 'light grey'],
  ['de', de, 'salbeigrüne', 'hellgraue'],
  ['es', es, 'verde salvia', 'gris claro'],
]

describe('note du projet-idée — la couleur annoncée est celle de la photo', () => {
  for (const [lang, demo, attendu, perime] of CAS) {
    it(`${lang} : la note dit « ${attendu} » et plus « ${perime} »`, () => {
      const notes = demo.projects.idea.notes
      expect(typeof notes).toBe('string')
      expect(notes).toContain(attendu)
      expect(notes).not.toContain(perime)
    })
  }
})

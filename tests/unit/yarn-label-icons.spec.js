import { describe, it, expect } from 'vitest'
import { ICONS } from '@/utils/icons'
import { ENGAGEMENTS, LABEL_ICONS } from '@/constants/yarn-labels'

describe('icônes des engagements', () => {
  it('chaque engagement a son icône, et elle existe au registre', () => {
    for (const key of ENGAGEMENTS) {
      const nom = LABEL_ICONS[key]
      expect(nom, `pas d’icône pour « ${key} »`).toBeTruthy()
      expect(ICONS[nom], `« ${nom} » absente du registre`).toBeTruthy()
    }
  })

  it('les quatre icônes sont DISTINCTES', () => {
    // Deux engagements partageant un tracé rendraient la carte trompeuse.
    const noms = ENGAGEMENTS.map((k) => LABEL_ICONS[k])
    expect(new Set(noms).size).toBe(4)
    const corps = noms.map((n) => ICONS[n].body)
    expect(new Set(corps).size).toBe(4)
  })

  it('ne portent aucune couleur en dur — elles héritent du texte', () => {
    for (const key of ENGAGEMENTS) {
      const body = ICONS[LABEL_ICONS[key]].body
      expect(body, `« ${key} » impose une couleur`).not.toMatch(/fill="(?!none)[^"]+"|stroke="(?!currentColor)[^"]+"/)
    }
  })
})

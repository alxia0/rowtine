import { describe, it, expect } from 'vitest'
import { detectRejection, isScannedPages } from '@/utils/pdf-import/reject'
import { MULTI_PATTERN_REJECTS } from '@/utils/pdf-import/blocking'

const L = (text, size = 10) => ({ text, size, bold: false, y: 0 })
const TRICOT = [L('Monter 88 mailles sur les aiguilles circulaires 4 mm.'), L('Tricoter en côtes 2/2 pendant 5 cm.'), L('Rang 1 : tricoter toutes les mailles à l’endroit.')]
const COUTURE = [L('Robe Capucine'), L('Valeurs de couture de 1 cm comprises.'), L('Placer les pièces sur le droit-fil du tissu.'), L('Entoilage thermocollant : 50 cm.')]
// MIN_BOOK_PATTERNS = 3 (décision de la propriétaire, tâche 5) : un recueil a au moins trois
// patrons, d'où le troisième (Mitaines Givre) ajouté ici par rapport au brief de la tâche 6.
const RECUEIL = [
  [L('Bonnet Alpin', 24), L('Matériel', 12), L('2 pelotes de 50 g'), L('Aiguilles circulaires 4 mm'), ...TRICOT],
  [L('Rang 2 : tricoter les mailles comme elles se présentent.')],
  [L('Écharpe Brume', 24), L('Fournitures', 12), L('3 pelotes de 50 g'), L('Aiguilles 5 mm'), ...TRICOT],
  [L('Rang 2 : tricoter à l’envers.')],
  [L('Mitaines Givre', 24), L('Matériel', 12), L('1 pelote de 50 g'), L('Aiguilles 3,5 mm'), ...TRICOT],
  [L('Rang 2 : tricoter à l’endroit.')],
]

describe('detectRejection : ordre des refus (spec §3)', () => {
  it('scanné d’abord : aucune page, ou moins de 50 caractères par page', () => {
    expect(isScannedPages([])).toBe(true)
    expect(detectRejection([[L('x')], []])).toEqual({ reason: 'scanned', detail: null })
  })
  it('notPattern ensuite, avec la raison du détecteur', () => {
    expect(detectRejection([COUTURE])).toEqual({ reason: 'notPattern', detail: 'otherCraft' })
  })
  it('un recueil de couture est refusé comme notPattern, pas comme multiPattern', () => {
    const pages = [[L('Robe', 24), L('Matériel', 12), L('2 m de tissu'), L('1 m de 140 cm'), ...COUTURE], [L('x'.repeat(60))], [L('Jupe', 24), L('Fournitures', 12), L('2 m de tissu'), L('1 m de 140 cm'), ...COUTURE], [L('y'.repeat(60))]]
    expect(detectRejection(pages)?.reason).toBe('notPattern')
  })
  it('recueil de tricot : refus multiPattern si MULTI_PATTERN_REJECTS, sinon aucun refus', () => {
    expect(detectRejection(RECUEIL)).toEqual(MULTI_PATTERN_REJECTS ? { reason: 'multiPattern', detail: null } : null)
  })
  it('vrai patron : aucun refus', () => {
    expect(detectRejection([TRICOT])).toBeNull()
  })
})

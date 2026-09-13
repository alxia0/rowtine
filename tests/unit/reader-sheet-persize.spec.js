// Composant — ReaderSheet (aide-mémoire). Non-régression bugs B/C de « modifs a faire.txt » :
//  C : un vecteur de valeurs par taille tout-à-zéro (artefact d'import) ne doit PLUS s'afficher
//      (« 0 (0) 0 (0)… »), même règle que les rangs du lecteur (isBlankCount).
//  B : les longues séries de valeurs par taille portent overflow-wrap pour ne jamais déborder.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import ReaderSheet from '@/components/ReaderSheet.vue'

function mountSheet(perSize) {
  const reference = {
    abbrFull: [],
    tabs: [{ id: 'materiel', label: 'Matériel', blocks: [{ h3: 'Échantillon', p: ['16 m × 24 rgs'], perSize }] }],
  }
  return mount(ReaderSheet, {
    props: { reference, sizeLabels: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], sizeIndex: null, open: true, activeTab: 'materiel' },
    global: { plugins: [i18n] },
  })
}

describe('ReaderSheet — valeurs par taille (bugs B/C)', () => {
  it('C : masque une ligne perSize tout-à-zéro (artefact d’import)', () => {
    const w = mountSheet([{ label: '', values: [0, 0, 0, 0, 0, 0], unit: '' }])
    expect(w.text()).not.toContain('0 (0)')
    expect(w.findAll('.rs__persize')).toHaveLength(0)
  })

  it('affiche une ligne perSize avec de vraies valeurs', () => {
    const w = mountSheet([{ label: 'Laine', values: [300, 300, 350, 350, 400, 400], unit: 'g' }])
    const rows = w.findAll('.rs__persize')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('300 (300) 350 (350) 400 (400)')
  })

  it('B : la valeur par taille est rendue dans le span porteur du wrap CSS', () => {
    // Le correctif de débordement est purement CSS (overflow-wrap: anywhere sur
    // .rs__persize/.rs__muted/.rs__psval) — non calculable par jsdom (css:false).
    // On garantit ici que la longue série vit bien dans l'élément ciblé par la règle.
    const w = mountSheet([{ label: 'Laine', values: [300, 300, 350, 350, 400, 400], unit: 'g' }])
    const val = w.find('.rs__persize .rs__muted') // sizeIndex null → span muted
    expect(val.exists()).toBe(true)
    expect(val.text()).toContain('300 (300)')
  })

  it('n’affiche pas le label vide comme « : »', () => {
    const w = mountSheet([{ label: '', values: [200, 250, 250, 300, 350, 400], unit: 'g' }])
    expect(w.find('.rs__persize strong').exists()).toBe(false)
  })
})

describe('ReaderSheet — ascenseur horizontal du tableau de tailles (#5)', () => {
  it('la table de tailles large (9 colonnes) est enveloppée dans un conteneur scrollable dédié', () => {
    const sizeLabels = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL']
    const reference = {
      abbrFull: [],
      tabs: [
        {
          id: 'tailles',
          label: 'Tailles',
          blocks: [
            {
              sizeTable: {
                rows: [{ label: 'Tour de buste', values: ['80', '84', '88', '92', '96', '100', '104', '108', '112'] }],
              },
            },
          ],
        },
      ],
    }
    const w = mount(ReaderSheet, {
      props: { reference, sizeLabels, sizeIndex: null, open: true, activeTab: 'tailles' },
      global: { plugins: [i18n] },
    })
    expect(w.find('.rs__tablewrap').exists()).toBe(true)
    // la table de tailles est bien ENFANT du conteneur scrollable (pas seulement présente)
    expect(w.find('.rs__tablewrap > table.rs__sizes').exists()).toBe(true)
  })
})

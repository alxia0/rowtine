// Composant — ReaderSheet (aide-mémoire) : libellés RÉSERVÉS (onglet/tuile/h3) localisés
// dans la langue de l'utilisateur (directive produit : « vocabulaire hors patron = langue
// locale »). Le tag balise reste EN (identité stable, cf. reader-reference.js) ; SEULS les
// libellés fixes émis par buildReference (labelKey/h3Key) doivent suivre la locale — les h3
// du tab tech (contenu du patron, ref.techniques[].title) ne portent PAS de clé et restent
// dans la langue source, non testés ici.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import ReaderSheet from '@/components/ReaderSheet.vue'
import { buildReference } from '@/utils/reader-reference'

function mountLocale(locale, messages, reference, activeTab) {
  const localeI18n = createI18n({ legacy: false, locale, messages })
  return mount(ReaderSheet, {
    props: { reference, sizeLabels: [], sizeIndex: null, open: true, activeTab },
    global: { plugins: [localeI18n] },
  })
}

describe('ReaderSheet — libellés réservés localisés', () => {
  it('locale EN : label de tuile/onglet ET h3 traduits en anglais, pas le FR figé', () => {
    const reference = buildReference({
      gauge: '20 sts x 28 rows = 10cm',
      yarn: 'Silk Mohair, 2 strands',
    })
    const w = mountLocale('en', { en }, reference, 'materiel')

    expect(w.find('.rs__tab').text()).toBe('Materials & gauge')
    expect(w.findAll('h3').map((h) => h.text())).toEqual(['Gauge', 'Yarn'])
  })

  it('locale FR : le chemin par clé rend les libellés FR d’origine (byte-identique)', () => {
    // Chaque libellé réservé porte désormais une clé (labelKey/h3Key) — même en FR, le
    // rendu passe par t(clé) → fr.json, PLUS par le repli brut (qui ne joue que si la
    // clé est absente, cf. h3 du tab tech). Sans ce test, une valeur fr.json mal
    // recopiée romprait le comportement FR par défaut sans qu'aucun test ne le voie.
    const reference = buildReference({
      gauge: '20 m x 28 rgs',
      yarn: 'Silk Mohair',
    })
    const w = mountLocale('fr', { fr }, reference, 'materiel')

    expect(w.find('.rs__tab').text()).toBe('Matériel & échantillon')
    expect(w.findAll('h3').map((h) => h.text())).toEqual(['Échantillon', 'Fil'])
  })

  // Bloc Conseils : sa propre tuile/onglet, sur le modèle exact de tech/abbr,
  // localisée de la même façon (labelKey/h3Key résolus par `t()`, jamais le repli FR figé).
  it('locale EN : la tuile/onglet Conseils (tips) est traduite en anglais', () => {
    const reference = buildReference({ tips: ['Conseils', 'Voir la vidéo de montage.'] })
    const w = mountLocale('en', { en }, reference, 'tips')
    expect(w.find('.rs__tab').text()).toBe('Tips')
    expect(w.find('h3').text()).toBe('Tips')
  })

  it('locale FR : la tuile/onglet Conseils (tips) rend le FR d’origine', () => {
    const reference = buildReference({ tips: ['Conseils', 'Voir la vidéo de montage.'] })
    const w = mountLocale('fr', { fr }, reference, 'tips')
    expect(w.find('.rs__tab').text()).toBe('Conseils')
    expect(w.find('h3').text()).toBe('Conseils')
  })
})

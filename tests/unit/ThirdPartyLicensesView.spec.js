// @vitest-environment jsdom
// Écran Licences tierces. Exigence légale (MIT/Apache/BSD
// exigent la reproduction de leur mention) : le contenu vient du fichier GÉNÉRÉ
// (src/generated/third-party-licenses.json, cf. scripts/gen-third-party-licenses.mjs), pas
// d'une liste écrite à la main — ce test vérifie que l'écran affiche fidèlement ce fichier
// et que des bibliothèques réellement utilisées par l'app y figurent bien.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import AppHeader from '@/components/AppHeader.vue'
import ThirdPartyLicensesView from '@/views/ThirdPartyLicensesView.vue'
import licenses from '@/generated/third-party-licenses.json'
import pkg from '../../package.json'

// Seule exception admise à « aucune devDependency racine n'apparaît » (revue du 02/08) :
// `vite` figure dans les vraies dépendances (pas devDependencies) de `vue-router`, donc
// license-checker (production: true) le voit comme transitivement embarqué, alors que c'est
// un outil de build interne à vue-router, jamais exécuté dans le bundle app. Sur-inclusion
// DOCUMENTÉE et assumée : mesuré le 02/08, 110 954
// caractères de texte de licence, 23 % du fichier généré. On ne le filtre pas côté générateur
// (mesurer précisément ce qui finit RÉELLEMENT dans dist/ demanderait d'analyser le graphe
// Rollup, hors budget de ces travaux) ; on le rend explicite ICI pour qu'aucune liste d'exclusion
// ne puisse plus être ajustée en silence autour de lui — défaut trouvé en revue : la 1re
// version de ce test énumérait EXACTEMENT les devDependencies racine sauf celle qui échouait.
const KNOWN_TRANSITIVE_EXCEPTIONS = ['vite']

function mountLicenses() {
  return mount(ThirdPartyLicensesView, {
    global: { plugins: [i18n], stubs: { AppHeader: true } },
  })
}

describe('ThirdPartyLicensesView', () => {
  it('affiche exactement un bloc <details> par paquet du fichier généré', () => {
    const wrapper = mountLicenses()
    expect(wrapper.findAll('.pkg')).toHaveLength(licenses.length)
    expect(licenses.length).toBeGreaterThan(0)
  })

  it('liste des bibliothèques réellement utilisées par l’app, avec leur texte de licence', () => {
    const wrapper = mountLicenses()
    const html = wrapper.html()
    for (const name of ['vue', 'vue-router', 'vue-i18n', 'pinia', 'dexie', 'pdfjs-dist']) {
      expect(html).toContain(`>${name}<`)
    }
    const vueEntry = licenses.find((p) => p.name === 'vue')
    expect(wrapper.text()).toContain(vueEntry.licenseText.split('\n')[0])
  })

  it("ne contient aucune devDependency racine de rowtine, sauf l'exception documentée", () => {
    const names = licenses.map((p) => p.name)
    const rootDevDeps = Object.keys(pkg.devDependencies)
    expect(rootDevDeps.length).toBeGreaterThan(0)
    for (const dep of rootDevDeps) {
      if (KNOWN_TRANSITIVE_EXCEPTIONS.includes(dep)) continue
      expect(names, `${dep} ne devrait pas apparaître (devDependency racine)`).not.toContain(dep)
    }
  })

  it('vite apparaît quand même : sur-inclusion transitive documentée, pas une fuite silencieuse', () => {
    // Preuve POSITIVE plutôt qu'une simple absence d'assertion : si ce paquet disparaissait un
    // jour du fichier généré (dépendance de vue-router retirée en amont), ce test le
    // signalerait — l'exception ci-dessus doit rester à jour avec la réalité, pas l'inverse.
    const names = licenses.map((p) => p.name)
    expect(names).toContain('vite')
  })

  // ── Les polices embarquées ────────────────────────────────────────────────────────────
  // L'app EMBARQUE ses .woff2 (public/fonts/), donc elle les REDISTRIBUE : la SIL Open Font
  // License exige que l'avis de droit d'auteur et le texte de la licence les accompagnent.
  // Manquement constaté le 17/08/2026 — et il était STRUCTUREL : le générateur interroge
  // node_modules, or les polices sont posées à la main et n'existent dans aucun package.json.
  // Aucune régénération n'aurait pu les faire apparaître. C'est ce qui rend ce test
  // nécessaire : sans lui, la seule chose qui tienne l'obligation est la mémoire de
  // quelqu'un.
  it('cite les deux polices embarquées, avec leur texte OFL intégral', () => {
    const wrapper = mountLicenses()
    const html = wrapper.html()
    for (const nom of ['Literata', 'Source Sans 3']) {
      const entree = licenses.find((p) => p.name === nom)
      expect(entree, `${nom} est absente du fichier généré : l'app la redistribue sans sa licence`)
        .toBeTruthy()
      expect(entree.license).toBe('OFL-1.1')
      // Le texte doit être la licence ELLE-MÊME, pas le repli « texte non fourni » du
      // générateur ni un résumé : l'OFL demande le texte, en entier.
      expect(entree.licenseText).toContain('SIL OPEN FONT LICENSE Version 1.1')
      expect(entree.licenseText).toContain('PERMISSION & CONDITIONS')
      expect(entree.licenseText.length).toBeGreaterThan(3000)
      expect(html).toContain(`>${nom}<`)
    }
  })

  it('garde la flèche retour (sous-écran atteint depuis À propos)', () => {
    const wrapper = mountLicenses()
    expect(wrapper.getComponent(AppHeader).props('back')).toBe(true)
  })

  it('porte une affordance de dépli sur chaque entrée (chevron, revue du 02/08)', () => {
    // `display: flex` sur <summary> supprime le triangle natif sans rien mettre à sa
    // place — rien n'indiquait qu'un appui dépliait la ligne. Un <AppIcon> par entrée,
    // jamais un glyphe brut (registre d'icônes du projet).
    const wrapper = mountLicenses()
    expect(wrapper.findAll('.pkg__chevron')).toHaveLength(licenses.length)
  })
})

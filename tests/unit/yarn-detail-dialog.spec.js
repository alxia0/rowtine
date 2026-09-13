import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { db } from '@/db/db'
import fr from '@/i18n/fr.json'
import de from '@/i18n/de.json'
import { usePurchasesStore } from '@/stores/purchases'
import YarnDetailDialog from '@/components/YarnDetailDialog.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
// Instance dédiée à une régression connue : locale allemande, pour prouver que la ligne
// « Composition » traduit dans la langue ACTIVE plutôt que de pousser la clé française
// stockée en base.
const i18nDe = createI18n({ legacy: false, locale: 'de', messages: { de } })

const yarn = {
  id: 1, brand: 'DROPS', model: 'Baby Merino', colorName: 'Bleu ciel', color: 'hsl(205 60% 75%)',
  weight: '', lengthM: 175, grams: 50, quantity: 5, price: 3.2, composition: ['Laine'], photo: '',
  // Ni `bain` ni `purchasedAt` : retirés du formulaire —
  // la fiche ne les lit plus, ils viennent désormais du registre d'achats.
}
const usage = { state: 'free', used: 0, total: 5 }

let pinia
let wrapper

// Base réelle (fake-indexeddb, cf. tests/unit/setup.js), même motif que
// tests/unit/yarn-purchases.spec.js : les lignes d'achat sont écrites via le VRAI store
// (usePurchasesStore().add) avant chaque montage, sur la même instance Pinia que celle
// passée au composant — c'est ce qui rend `purchasesStore.forYarn(yarn.id)` observable
// depuis l'intérieur de YarnDetailDialog sans rien mocker.
beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

// attachTo: document.body — en jsdom, .focus() / document.activeElement sont des no-op sur
// un élément non attaché au DOM réel (motif tests/unit/confirm-dialog.spec.js).
// YarnDetailDialog lit settings.unitSystem/currency : Pinia doit être
// installé, comme partout ailleurs dans le projet — sinon useSettingsStore() lève à
// l'instanciation.
function mountDialog(yarnOverrides = {}) {
  wrapper = mount(YarnDetailDialog, {
    props: { open: true, yarn: { ...yarn, ...yarnOverrides }, usage },
    global: { plugins: [i18n, pinia], stubs: { AppIcon: true } },
    attachTo: document.body,
  })
  return wrapper
}

async function addLine(overrides = {}) {
  const store = usePurchasesStore()
  return store.add({ yarnId: yarn.id, yarnLabel: 'DROPS · Bleu ciel', ...overrides })
}

// Lit la VALEUR affichée pour un libellé donné, en appariant les `<dt>`/`<dd>` par position
// plutôt qu'en cherchant un fragment dans le texte entier de la fiche — un `.toContain('3')`
// nu serait déjà vrai à cause du prix (3,20 €) même si le récapitulatif d'achats était cassé,
// exactement le défaut « assertion qui ne peut pas échouer » que ce projet proscrit.
function fieldValue(w, label) {
  const dts = w.findAll('.ydet__dt')
  const dds = w.findAll('.ydet__dd')
  const i = dts.findIndex((dt) => dt.text() === label)
  return i === -1 ? null : dds[i].text()
}

// Le composant pose un listener `keydown` sur `document` tant que `open` est vrai ; sans
// démontage entre les tests, il fuite d'un test à l'autre (un Échap dans un test ultérieur
// émettrait `close` sur une instance déjà remplacée). Motif tests/unit/confirm-dialog.spec.js.
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('YarnDetailDialog', () => {
  it('affiche tous les champs saisis, bain et date d’achat compris via le registre (jamais perdre d’info)', async () => {
    await addLine({ bain: 'LOT42', date: '2026-06-01' })
    const txt = mountDialog().text()
    for (const v of ['DROPS', 'Baby Merino', 'Bleu ciel', '175', '50', '5', 'LOT42', '2026-06-01', 'Laine']) {
      expect(txt).toContain(v)
    }
  })

  // Point signalé en revue précédente : plusieurs lignes pour la même laine ne
  // doivent perdre ni un bain ni une date — la fiche affiche un récapitulatif agrégé, pas la
  // dernière ligne saisie. Bains et dates du jeu d'essai tous distincts.
  it('récapitule plusieurs lignes d’achat : nombre de lignes, bains dédoublonnés, dernier achat', async () => {
    await addLine({ bain: 'A12', date: '2026-01-10' })
    await addLine({ bain: 'B03', date: '2026-05-04' })
    await addLine({ bain: 'A12', date: '2026-02-20' }) // bain déjà vu : ne doit pas se dupliquer
    const w = mountDialog()
    expect(fieldValue(w, fr.yarn.purchasesCount)).toBe('3')
    // `forYarn` renvoie les lignes plus récentes d'abord (stores/purchases.js) : bainsOf
    // dédoublonne dans CET ordre — B03 (04/05) et A12 (20/02) avant le doublon A12 (10/01).
    expect(fieldValue(w, fr.yarn.bain)).toBe('B03 · A12')
    expect(fieldValue(w, fr.yarn.lastPurchaseDate)).toBe('2026-05-04') // la plus récente des trois
  })

  it('aucune ligne d’achat pour cette laine : pas de récapitulatif affiché', () => {
    const w = mountDialog()
    expect(fieldValue(w, fr.yarn.purchasesCount)).toBeNull()
    expect(fieldValue(w, fr.yarn.bain)).toBeNull()
    expect(fieldValue(w, fr.yarn.lastPurchaseDate)).toBeNull()
  })

  it('émet edit puis close', async () => {
    const w = mountDialog()
    await w.find('.ydet__edit').trigger('click')
    expect(w.emitted('edit')).toBeTruthy()
    await w.find('.ydet__close').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })

  it('le focus va sur le bouton fermer à l’ouverture', async () => {
    const w = mountDialog()
    await nextTick()
    expect(document.activeElement).toBe(w.find('.ydet__close').element)
  })

  it('Échap ferme (émet close)', async () => {
    const w = mountDialog()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toBeTruthy()
  })

  it('affiche le type de coloris et les notes pour une pelote multicolore', () => {
    const txt = mountDialog({ colorType: 'degrade', colorNotes: 'bleu vers blanc' }).text()
    expect(txt).toContain(fr.yarn.colorTypes.degrade)
    expect(txt).toContain('bleu vers blanc')
  })

  it('une pelote Uni sans notes n\'affiche ni Type de coloris ni Description du coloris', () => {
    const txt = mountDialog().text() // yarn de base : pas de colorType/colorNotes
    expect(txt).not.toContain(fr.yarn.colorType)
    expect(txt).not.toContain(fr.yarn.colorNotes)
  })

  it('affiche l’origine déduite et les caractéristiques cochées', async () => {
    const w = mountDialog({ composition: ['alpaga'], labels: ['vegan', 'rws'] })
    expect(w.text()).toContain('Fibre animale')
    expect(w.text()).toContain('Vegan')
    expect(w.text()).toContain('Bien-être des moutons (RWS)')
  })

  it('n’affiche PAS de ligne d’origine quand la composition est vide', async () => {
    const w = mountDialog({ composition: [], labels: [] })
    expect(w.find('.ydet__origin').exists()).toBe(false)
  })

  it('dit « Origine incomplète » dès qu’une fibre n’est pas classée', async () => {
    const w = mountDialog({ composition: ['mérinos', 'zzz-fibre-inconnue'], labels: [] })
    expect(w.text()).toContain('Origine incomplète')
  })

  // Revue (finding 1) : les deux tests ci-dessus cochent des libellés qui sont
  // DÉJÀ dans l'ordre canonique ('vegan' avant 'rws' dans YARN_LABELS) — aucun des deux ne
  // tomberait si le composant itérait sur `labels` (ordre de cochage) au lieu de filtrer
  // `YARN_LABELS`. Ici l'ordre de cochage est délibérément INVERSÉ par rapport à l'ordre
  // canonique : seule une lecture qui respecte YARN_LABELS fait apparaître Vegan avant RWS.
  it('affiche les caractéristiques dans l’ordre canonique de YARN_LABELS, jamais l’ordre de cochage', async () => {
    const w = mountDialog({ composition: ['alpaga'], labels: ['rws', 'vegan'] })
    const items = w.findAll('.ydet__labels li').map((li) => li.text())
    expect(items).toEqual(['Vegan', 'Bien-être des moutons (RWS)'])
  })

  // Revue (finding 2) : la branche « mélange » n'était testée que sur le cas
  // spécial animal + végétal (composé en « Mélange animal et végétal »). Ici la paire
  // d'origines est animale + synthétique — `deduceOrigin(['laine', 'acrylique'])` mesuré
  // rend `{ key: 'melange', complete: true, origins: ['animale', 'synthetique'] }` — donc
  // la juxtaposition doit s'appliquer, et surtout PAS le libellé spécial du couple
  // animal + végétal, qui serait faux ici.
  it('juxtapose les libellés d’origine pour un mélange autre qu’animal + végétal', async () => {
    const w = mountDialog({ composition: ['laine', 'acrylique'], labels: [] })
    expect(w.text()).toContain('Fibre animale · Fibre synthétique')
    expect(w.text()).not.toContain('Mélange animal et végétal')
  })

  // Revue finale (correction 2, 06/08/2026) : le test précédent ne prouve que l'ABSENCE du
  // libellé spécial sur un mélange autre qu'animal + végétal — une assertion `not.toContain`
  // qui reste vraie même si la branche « Mélange animal et végétal » disparaissait
  // ENTIÈREMENT du composant (36 tests étaient restés verts après sa suppression en revue).
  // Ici l'assertion est POSITIVE : une composition animale + végétale doit produire la
  // chaîne exacte, terminologie vérifiée dans le règlement européen sur les dénominations
  // textiles.
  it('affiche « Mélange animal et végétal » pour une composition animale + végétale', async () => {
    const w = mountDialog({ composition: ['laine', 'coton'], labels: [] })
    expect(w.text()).toContain('Mélange animal et végétal')
  })

  // Régression (06/08/2026) : la fiche poussait la clé de catalogue BRUTE
  // (français, ex. « coton ») au lieu de la traduire — visible sur les captures du guide en
  // allemand, anglais et espagnol. Locale allemande ici : si le composant repasse par la
  // valeur brute, la ligne afficherait « coton », absent des messages allemands, au lieu de
  // « Baumwolle ».
  it('traduit la composition dans la langue active au lieu d’afficher la clé française brute', () => {
    const w = mount(YarnDetailDialog, {
      props: { open: true, yarn: { ...yarn, composition: ['coton'] }, usage },
      global: { plugins: [i18nDe, pinia], stubs: { AppIcon: true } },
      attachTo: document.body,
    })
    expect(fieldValue(w, de.yarn.composition)).toBe(de.yarn.compositions.coton)
    expect(w.text()).not.toContain('coton')
    w.unmount()
  })
})

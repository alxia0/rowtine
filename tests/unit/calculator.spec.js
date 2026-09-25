// @vitest-environment jsdom
// Front (composant) — la répartition d'augmentations/diminutions du calculateur.
// On teste l'algorithme à travers l'UI réelle (montage + i18n), pas une copie.
import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import CalculatorView from '@/views/CalculatorView.vue'
import i18n from '@/i18n'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

function mountCalc() {
  return mount(CalculatorView, {
    global: { plugins: [i18n], stubs: { AppHeader: true, FieldHelp: true } },
  })
}

// Renseigne les trois champs par leur IDENTIFIANT et non par leur texte d'exemple :
// un champ qui devient conditionnel ferait rendre un wrapper vide à `find`, et
// `.setValue` lèverait une erreur illisible au lieu de nommer le champ manquant.
async function fill(wrapper, current, target, rows) {
  await wrapper.find('#calc-current').setValue(String(current))
  await wrapper.find('#calc-target').setValue(String(target))
  await wrapper.find('#calc-rows').setValue(String(rows))
}

describe('CalculatorView — répartition', () => {
  it('invite à remplir tant que les champs sont vides', () => {
    const w = mountCalc()
    expect(w.text()).toContain(tk('calc.fillIn'))
  })

  it('répartit régulièrement quand ça tombe juste (60→80 sur 40 rangs)', async () => {
    const w = mountCalc()
    await fill(w, 60, 80, 40)
    const txt = w.text()
    // Phrase mot pour mot (avec le « : » final) : à 1 maille à chaque fois,
    // la garantie de non-régression du lot est que cette phrase ne bouge pas
    // au-delà de l'accord pluriel réel « augmentations » (lot du 03/08, béquille
    // retirée le 11/09). Un simple `.toContain('Répartis 20 augmentation')`
    // resterait vert même si la garde `perTime === 1` du gabarit disparaissait
    // (« ... soit 20 fois 1 mailles : » contient aussi ce préfixe) : le « s » du
    // pluriel et le « : » final sont ce qui distingue vraiment cette phrase de
    // la variante Multi.
    expect(txt).toContain('Répartis 20 augmentations :')
    expect(txt).toContain('tous les 2 rangs × 20')
    expect(txt).toContain('Au total : 80 mailles')
  })

  it('mélange deux intervalles quand le reste n’est pas nul (60→80 sur 30 rangs)', async () => {
    const w = mountCalc()
    await fill(w, 60, 80, 30)
    const txt = w.text()
    // 30 = 20×1 + 10 → 10 intervalles de 1 rang et 10 de 2 rangs. « tous les
    // 1 rangs » n'existe pas en français : à cadence 1, la phrase devient
    // « à chaque rang » (lot accord du 03/08 — valeur mise à jour, seul essai
    // historique dont la valeur attendue devient objectivement fausse).
    expect(txt).toContain('à chaque rang × 10')
    expect(txt).toContain('tous les 2 rangs × 10')
  })

  it('passe en mode « dense » quand il y a plus de changements que de rangs (10→40 sur 5 rangs)', async () => {
    const w = mountCalc()
    await fill(w, 10, 40, 5)
    expect(w.text()).toContain('Env. 6 par rang') // ceil(30/5)
  })

  it('bascule sur Diminutions (80→60) via le sélecteur', async () => {
    const w = mountCalc()
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.dec')).trigger('click')
    await fill(w, 80, 60, 40)
    expect(w.text()).toContain('Répartis 20 diminutions')
  })

  it('bascule En rond → répartition en tours (60→80 sur 40 tours)', async () => {
    const w = mountCalc()
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.round')).trigger('click')
    await fill(w, 60, 80, 40)
    expect(w.text()).toContain('tous les 2 tours × 20')
  })

  it('signale une cible incohérente avec le mode (Augmentations mais 80→60)', async () => {
    const w = mountCalc()
    // mode Augmentations (défaut) mais cible < actuel → incohérent
    await fill(w, 80, 60, 40)
    expect(w.text()).toContain('Cible incohérente')
  })
})

describe('CalculatorView — mailles à chaque fois', () => {
  it('avec 2 mailles à chaque fois, 60 → 80 se fait en 10 fois et non 20', async () => {
    const w = mountCalc()
    await fill(w, 60, 80, 40)
    await w.find('#calc-per-time').setValue('2')
    const txt = w.text()
    // 10 occurrences sur 40 rangs → tous les 4 rangs × 10. La correction du
    // vocabulaire (CRITIQUE 1) ne change que l'en-tête, pas cette ligne.
    expect(txt).toContain('tous les 4 rangs × 10')
    expect(txt).toContain('Au total : 80 mailles')
  })

  it('CRITIQUE 1 — l’en-tête distingue les mailles des fois (60 → 80, 2 mailles à chaque fois, 40 rangs)', async () => {
    const w = mountCalc()
    await fill(w, 60, 80, 40)
    await w.find('#calc-per-time').setValue('2')
    const txt = w.text()
    // 20 mailles, réparties en 10 fois : les deux nombres doivent être reliés
    // dans la même phrase, pas juxtaposés comme « 20 augmentations : × 10 ».
    expect(txt).toContain('Répartis 20 augmentations, soit 10 fois 2 mailles :')
    expect(txt).toContain('tous les 4 rangs × 10')
  })

  it('CRITIQUE 1 — le cas « dense » distingue aussi les fois des mailles (60 → 80, 2 mailles à chaque fois, 5 rangs)', async () => {
    const w = mountCalc()
    await fill(w, 60, 80, 5)
    await w.find('#calc-per-time').setValue('2')
    const txt = w.text()
    // 20 mailles sur 5 rangs, en pas de 2 : 2 FOIS par rang, soit 4 mailles.
    // « ≈ 2 par rang » (sans préciser fois/mailles) laisserait croire à 2
    // mailles par rang, alors que 2×5 = 10, pas 20.
    expect(txt).toContain('Env. 2 fois par rang, soit 4 mailles')
    expect(txt).not.toContain('Env. 2 par rang')
  })

  it('CRITIQUE 1 — à 1 maille à chaque fois, la phrase « dense » historique reste intacte (60 → 80, 5 rangs)', async () => {
    const w = mountCalc()
    await fill(w, 60, 80, 5)
    const txt = w.text()
    expect(txt).toContain('Env. 4 par rang')
  })

  it('un champ vide vaut 1 maille à chaque fois', async () => {
    const w = mountCalc()
    await fill(w, 60, 80, 40)
    await w.find('#calc-per-time').setValue('')
    expect(w.text()).toContain('tous les 2 rangs × 20')
  })

  it('annonce les deux propositions quand la cible n’est pas atteignable pile', async () => {
    const w = mountCalc()
    await fill(w, 60, 75, 40)
    await w.find('#calc-per-time').setValue('2')
    const txt = w.text()
    expect(txt).toContain('n’est pas atteignable pile')
    expect(txt).toContain('7 fois, soit 74 mailles')
    expect(txt).toContain('1 de moins')
    expect(txt).toContain('8 fois, soit 76 mailles')
    expect(txt).toContain('1 de plus')
    // Chaque proposition porte sa propre répartition.
    expect(txt).toContain('tous les 5 rangs × 2')
    expect(txt).toContain('tous les 6 rangs × 5')
    expect(txt).toContain('tous les 5 rangs × 8')
  })

  it('n’affiche pas la phrase d’encadrement quand la cible tombe pile', async () => {
    const w = mountCalc()
    await fill(w, 60, 80, 40)
    await w.find('#calc-per-time').setValue('2')
    expect(w.text()).not.toContain('atteignable pile')
  })

  it('n’affiche qu’une seule proposition quand la basse reviendrait à ne rien changer (60 → 61, 3 mailles à chaque fois)', async () => {
    const w = mountCalc()
    await fill(w, 60, 61, 40)
    await w.find('#calc-per-time').setValue('3')
    expect(w.text()).toContain('1 fois, soit 63 mailles')
  })

  // `calc.optionTimes` a retrouvé ses formes plurielles vue-i18n pour {st}
  // (lot du 11/09, béquille « (s) » retirée). Reste néanmoins {k} : ce
  // marqueur ne suit PAS le mécanisme `|` (cf. i18n-parity.spec.js règle 3) —
  // {k} peut valoir 0 ou 1 (essais ci-dessous), donc en anglais/espagnol
  // « fois » compte réellement. Ce mot-là est accordé par LE CODE (fonction
  // `times()`, jumelle de `unit()`), pas par une forme parenthésée : le
  // français et l'allemand ne rougissent pas sur ce cas (« fois »/« Mal »
  // sont invariables), c'est en anglais que l'accord au singulier se voit
  // vraiment (« 1 time », pas « 1 times »). On bascule donc la locale pour
  // vérifier le vrai défaut.
  it('accorde le mot « fois » en anglais (pas de « times » pour une seule occurrence)', async () => {
    const w = mountCalc()
    await fill(w, 60, 61, 40)
    await w.find('#calc-per-time').setValue('3')
    i18n.global.locale.value = 'en'
    await flushPromises()
    const txt = w.text()
    i18n.global.locale.value = 'fr'
    expect(txt).toContain('1 time, that’s 63 stitches')
    expect(txt).not.toContain('1 times')
  })

  // Cas extrême trouvé en durcissant CRITIQUE 2 (mailles négatives) : en
  // diminutions, quand « mailles à chaque fois » ≥ mailles actuelles, même
  // une seule occurrence passerait sous 1 maille. Sans repli côté calcul
  // (cf. stitch-shaping.js), le gabarit PLANTAIT au rendu en lisant
  // `res.options[0].perTime` sur une liste devenue vide. Essai au niveau
  // composant, là où le crash et l'artefact « soit  rangs » (rows: null)
  // se sont réellement manifestés — pas seulement dans la fonction pure.
  it('ne plante pas quand perTime ≥ mailles actuelles en diminutions (5 → 3, 5 mailles à chaque fois)', async () => {
    const w = mountCalc()
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.dec')).trigger('click')
    await fill(w, 5, 3, 40)
    await w.find('#calc-per-time').setValue('5')
    const txt = w.text()
    expect(txt).toContain('n’est pas atteignable pile')
    expect(txt).toContain('0 fois, soit 5 mailles')
    expect(txt).toContain('2 de plus')
  })

  it('même repli côté « nombre de rangs », avec le nombre de rangs à 0 et non « null » (5 → 3, 5 mailles à chaque fois)', async () => {
    const w = mountCalc()
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.dec')).trigger('click')
    await fillLength(w, 5, 3, 2)
    await w.find('#calc-per-time').setValue('5')
    const txt = w.text()
    expect(txt).toContain('0 fois, soit 5 mailles')
    // « 0 rang » et non « 0 rangs » : en français, 0 s'accorde comme 1
    // (repli du calcul, cf. `singularCount` dans CalculatorView.vue).
    expect(txt).toContain('soit 0 rang')
    expect(txt).not.toContain('soit 0 rangs')
  })

  // Contrairement au français (0 singulier, essai ci-dessus), 0 prend le
  // PLURIEL en anglais et en espagnol pour l'unité rang/tour aussi — même
  // règle que celle déjà appliquée à `times()`. `unit()` traitait encore 0
  // comme singulier dans les 4 langues avant ce correctif : aucun essai ne
  // franchissait la frontière du français, donc le défaut a survécu au lot
  // précédent. Boutons pris par INDEX (Diminutions=1, Nombre de rangs=5) :
  // leur texte varie selon la langue, cf. `texteEnRondDec` plus bas.
  it('même repli, hors français : 0 prend le pluriel (« 0 rows », « 0 filas », jamais « 0 row »/« 0 fila »)', async () => {
    for (const [locale, plural, singular] of [
      ['en', 'that’s 0 rows', 'that’s 0 row'],
      ['es', 'o sea 0 filas', 'o sea 0 fila'],
    ]) {
      i18n.global.locale.value = locale
      const w = mountCalc()
      const opts = w.findAll('.toggle__opt')
      await opts[1].trigger('click') // Diminutions
      await opts[5].trigger('click') // sens « nombre de rangs »
      await w.find('#calc-current').setValue('5')
      await w.find('#calc-target').setValue('3')
      await w.find('#calc-cadence').setValue('2')
      await w.find('#calc-per-time').setValue('5')
      const txt = w.text()
      i18n.global.locale.value = 'fr'
      expect(txt, locale).toContain(plural)
      // `not.toContain(singular)` serait toujours vrai une fois le pluriel
      // affiché (« 0 rows » CONTIENT « 0 row ») : lookahead négatif pour
      // vérifier que le mot singulier n'apparaît jamais SANS son « s ».
      expect(txt, locale).not.toMatch(new RegExp(`${singular}(?!s)`))
    }
  })

  // Contrairement à « 0 rang » (singulier propre au français, cf. essai
  // ci-dessus), « 0 fois » est du PLURIEL en anglais : la fonction `times()`
  // traite ce cas explicitement (seul n === 1 est singulier).
  it('le repli « 0 fois » reste au pluriel anglais (pas de « 0 time » au singulier)', async () => {
    const w = mountCalc()
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.dec')).trigger('click')
    await fill(w, 5, 3, 40)
    await w.find('#calc-per-time').setValue('5')
    i18n.global.locale.value = 'en'
    await flushPromises()
    const txt = w.text()
    i18n.global.locale.value = 'fr'
    expect(txt).toContain('0 times, that’s 5 stitches')
    expect(txt).not.toContain('0 time,')
  })
})

// Bascule sur le sens « nombre de rangs » et renseigne la cadence.
async function fillLength(wrapper, current, target, cadence) {
  await wrapper.findAll('.toggle__opt').find((b) => b.text() === tk('calc.solveLength')).trigger('click')
  await wrapper.find('#calc-current').setValue(String(current))
  await wrapper.find('#calc-target').setValue(String(target))
  await wrapper.find('#calc-cadence').setValue(String(cadence))
}

describe('CalculatorView — sens « combien de rangs »', () => {
  it('60 → 80 tous les 2 rangs : 40 rangs, dernière augmentation au rang 40', async () => {
    const w = mountCalc()
    await fillLength(w, 60, 80, 2)
    const txt = w.text()
    expect(txt).toContain('Il te faut 40 rangs')
    expect(txt).toContain('20 augmentations en tout, une tous les 2 rangs')
    expect(txt).toContain('tombe au rang 40')
    expect(txt).toContain('Au total : 80 mailles')
  })

  it('MANCHE : 2 mailles à chaque fois, tous les 4 rangs → 40 rangs, et non 80', async () => {
    const w = mountCalc()
    await fillLength(w, 60, 80, 4)
    await w.find('#calc-per-time').setValue('2')
    const txt = w.text()
    expect(txt).toContain('Il te faut 40 rangs')
    expect(txt).not.toContain('Il te faut 80 rangs')
    // La phrase de détail compte les MAILLES (20), pas les FOIS (10) : une
    // augmentation vaut une maille dans le vocabulaire de l'app (cf. l'autre
    // sens, « Répartis 20 augmentations »). Avec perTime > 1 les deux nombres
    // ne coïncident plus, donc ce cas les distingue vraiment. Le « fois »
    // devant « tous les 4 rangs » a disparu (lot accord du 03/08) : le
    // fragment {every} porte seul « tous les X rangs »/« à chaque rang »,
    // sans le redoubler d'un « une fois » qui devenait faux à cadence 1.
    expect(txt).toContain('20 augmentations en tout : 10 fois 2 mailles, une tous les 4 rangs.')
    expect(txt).not.toContain('10 augmentations')
  })

  it('en diminutions, la phrase suit le mode', async () => {
    const w = mountCalc()
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.dec')).trigger('click')
    await fillLength(w, 80, 60, 2)
    const txt = w.text()
    expect(txt).toContain('20 diminutions en tout')
    expect(txt).toContain('tombe au rang 40')
  })

  it('cible non atteignable pile : deux propositions avec leur nombre de rangs', async () => {
    const w = mountCalc()
    await fillLength(w, 60, 75, 4)
    await w.find('#calc-per-time').setValue('2')
    const txt = w.text()
    expect(txt).toContain('7 fois, soit 74 mailles')
    expect(txt).toContain('soit 28 rangs')
    expect(txt).toContain('8 fois, soit 76 mailles')
    expect(txt).toContain('soit 32 rangs')
  })

  it('invite à remplir tant que la cadence manque', async () => {
    const w = mountCalc()
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.solveLength')).trigger('click')
    await w.find('#calc-current').setValue('60')
    await w.find('#calc-target').setValue('80')
    // « Remplis les champs » seul est le préfixe commun à calc.fillIn et
    // calc.fillInLength : ça ne prouverait rien. La partie discriminante,
    // c'est « le nombre de rangs ».
    expect(w.text()).toContain('Remplis les champs pour voir le nombre de rangs')
  })

  it('le champ des rangs disparaît dans ce sens, celui de la cadence apparaît', async () => {
    const w = mountCalc()
    expect(w.find('#calc-rows').exists()).toBe(true)
    expect(w.find('#calc-cadence').exists()).toBe(false)
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.solveLength')).trigger('click')
    expect(w.find('#calc-rows').exists()).toBe(false)
    expect(w.find('#calc-cadence').exists()).toBe(true)
  })
})

// Lot accord du 03/08 : le mot d'unité (rang/tour) s'accorde réellement selon
// le nombre qui précède, et « tous les 1 rang » n'existe pas (bascule sur
// « à chaque rang »). Cas dédiés au singulier, distincts du balayage « jamais
// de rang en rond » plus bas qui ne couvre que l'ABSENCE du mot, pas l'accord.
describe('CalculatorView — accord au singulier (lot du 03/08)', () => {
  it('« Il te faut 1 rang », jamais « 1 rangs » (60 → 61, tous les 1 rang)', async () => {
    const w = mountCalc()
    await fillLength(w, 60, 61, 1)
    const txt = w.text()
    expect(txt).toContain('Il te faut 1 rang')
    expect(txt).not.toContain('Il te faut 1 rangs')
  })

  it('accord singulier : 1 augmentation en tout (pas de "(s)")', async () => {
    const w = mountCalc()
    await fillLength(w, 60, 61, 1)
    const txt = w.text()
    expect(txt).toContain('1 augmentation en tout, une à chaque rang.')
    expect(txt).not.toContain('(s)')
  })

  // `leadInc` a la forme « Répartis {n} augmentation : | Répartis {n}
  // augmentations : » — un espace avant le « | » ET avant le « : » (ponctuation
  // française). vue-i18n coupe sur `|` en retirant les espaces autour du
  // séparateur lui-même, mais ne doit PAS manger l'espace interne devant « : » ;
  // sans cet essai, un mauvais découpage (« augmentation:» au lieu de
  // « augmentation :») passerait inaperçu, aucun autre test ne montant le cas
  // singulier de cette clé précise (sens « répartition », pas « nombre de rangs »).
  it('accord singulier : « Répartis 1 augmentation : » garde l’espace avant les deux-points', async () => {
    const w = mountCalc()
    await fill(w, 60, 61, 40)
    expect(w.text()).toContain('Répartis 1 augmentation :')
  })

  it('en rond, la même cadence dit « à chaque tour », jamais « rang » (60 → 61, tous les 1 tour)', async () => {
    const w = mountCalc()
    await fillLength(w, 60, 61, 1)
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.round')).trigger('click')
    const txt = w.text()
    expect(txt).toContain('Il te faut 1 tour')
    expect(txt).toContain('à chaque tour')
    expect(txt).not.toContain('rang')
  })
})

// Le mot « rang » (et ses équivalents) ne doit plus apparaître nulle part quand on
// tricote EN ROND. On monte donc l'écran avec le vrai FieldHelp (et non un stub),
// on déplie toutes les aides ⓘ, puis on balaie le TEXTE VISIBLE — pas le HTML,
// qui contient des identifiants techniques comme `calc-rows` sans rapport avec
// ce que lit l'utilisatrice.
const MOT_RANG = { fr: 'rang', en: 'row', de: 'Reihe', es: 'fila' }

async function texteEnRond(locale, solveFor) {
  i18n.global.locale.value = locale
  const w = mount(CalculatorView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
  const opts = w.findAll('.toggle__opt')
  await opts[3].trigger('click') // « En rond »
  if (solveFor === 'length') await w.findAll('.toggle__opt')[5].trigger('click') // « Nombre de tours »
  await w.find('#calc-current').setValue('60')
  await w.find('#calc-target').setValue('80')
  await w.find(solveFor === 'length' ? '#calc-cadence' : '#calc-rows').setValue(solveFor === 'length' ? '2' : '40')
  for (const b of w.findAll('.fh__btn')) await b.trigger('click') // déplie toutes les aides
  await nextTick()
  return w.text()
}

describe('CalculatorView — en rond, l’écran parle de tours et jamais de rangs', () => {
  afterEach(() => {
    i18n.global.locale.value = 'fr'
  })

  for (const locale of ['fr', 'en', 'de', 'es']) {
    for (const solveFor of ['rows', 'length']) {
      it(`${locale} / ${solveFor} : aucune occurrence du mot « rang »`, async () => {
        const txt = await texteEnRond(locale, solveFor)
        // Le second argument d'expect nomme le cas dans le message d'échec : sans lui,
        // huit essais générés échouent avec le même libellé et on ne sait pas lequel.
        expect(txt, `${locale} / ${solveFor}`).not.toContain(MOT_RANG[locale])
      })
    }
  }
})

// Le balayage ci-dessus ne monte que le cas 60 → 80 à 1 maille, cible
// atteignable pile et jamais « dense » : les clés propres au cas « 2 mailles
// à chaque fois » (notExact*, optionTimes, deltaLess/More, optionRows,
// lengthDetailMulti*, leadIncMulti/leadDecMulti, denseMulti) n’y passent
// jamais, dans aucune langue. Deux jeux de balayage supplémentaires, chacun
// ciblé sur les clés qu'il exerce réellement (vérifié en calculant à la main
// `exact`/`dense` pour 60→80 et 60→75 à 2 mailles) : même méthode que
// l'existant (vrai FieldHelp, aides dépliées, texte visible).
async function texteEnRondCas(locale, solveFor, { target, rows, cadence }) {
  i18n.global.locale.value = locale
  const w = mount(CalculatorView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
  const opts = w.findAll('.toggle__opt')
  await opts[3].trigger('click') // « En rond »
  if (solveFor === 'length') await w.findAll('.toggle__opt')[5].trigger('click') // « Nombre de tours »
  await w.find('#calc-current').setValue('60')
  await w.find('#calc-target').setValue(String(target))
  await w.find('#calc-per-time').setValue('2')
  await w.find(solveFor === 'length' ? '#calc-cadence' : '#calc-rows').setValue(String(solveFor === 'length' ? cadence : rows))
  for (const b of w.findAll('.fh__btn')) await b.trigger('click') // déplie toutes les aides
  await nextTick()
  return w.text()
}

// Jeu 1 — 60 → 75 (non atteignable pile), 40 rangs / 4 rangs de cadence :
// exerce notExactInc, optionTimes, deltaLess/More, optionRows, every (le
// couple occurrences=7 ou 8 sur 40 rangs ne repasse jamais en « dense »).
describe('CalculatorView — en rond, cible non atteignable pile (2 mailles à chaque fois), jamais de « rang »', () => {
  afterEach(() => {
    i18n.global.locale.value = 'fr'
  })

  for (const locale of ['fr', 'en', 'de', 'es']) {
    for (const solveFor of ['rows', 'length']) {
      it(`${locale} / ${solveFor} : aucune occurrence du mot « rang », cible non atteignable pile`, async () => {
        const txt = await texteEnRondCas(locale, solveFor, { target: 75, rows: 40, cadence: 4 })
        expect(txt, `${locale} / ${solveFor}`).not.toContain(MOT_RANG[locale])
      })
    }
  }
})

// Jeu 2 — 60 → 80 (atteignable pile), 2 mailles à chaque fois : exerce
// leadIncMulti et lengthDetailMultiInc (res.exact avec perTime > 1) ; côté
// « répartition » on tasse en plus sur seulement 5 rangs pour forcer
// distributeOverRows en mode « dense » (10 occurrences > 5 rangs) et donc
// exercer denseMulti — 5 ne sert que côté rows, la cadence (4) reste celle
// du sens « nombre de rangs ».
describe('CalculatorView — en rond, cible atteignable pile en pas serré (2 mailles à chaque fois), jamais de « rang »', () => {
  afterEach(() => {
    i18n.global.locale.value = 'fr'
  })

  for (const locale of ['fr', 'en', 'de', 'es']) {
    for (const solveFor of ['rows', 'length']) {
      it(`${locale} / ${solveFor} : aucune occurrence du mot « rang », cible atteignable pile`, async () => {
        const txt = await texteEnRondCas(locale, solveFor, { target: 80, rows: 5, cadence: 4 })
        expect(txt, `${locale} / ${solveFor}`).not.toContain(MOT_RANG[locale])
      })
    }
  }

  // Preuve que ce jeu exerce bien les clés visées (pas seulement l'absence du
  // mot « rang ») : sans elle, un jeu mal calculé passerait au vert en
  // silence sans jamais atteindre leadIncMulti/denseMulti/lengthDetailMulti*,
  // exactement le défaut qui a motivé cet ajout (IMPORTANT 3).
  it('exerce bien leadIncMulti et denseMulti côté répartition (fr)', async () => {
    const txt = await texteEnRondCas('fr', 'rows', { target: 80, rows: 5, cadence: 4 })
    expect(txt).toContain('Répartis 20 augmentations, soit 10 fois 2 mailles')
    expect(txt).toContain('fois par tour')
  })

  it('exerce bien lengthDetailMultiInc côté nombre de rangs (fr)', async () => {
    const txt = await texteEnRondCas('fr', 'length', { target: 80, rows: 5, cadence: 4 })
    expect(txt).toContain('20 augmentations en tout : 10 fois 2 mailles')
  })
})

// Les balayages « en rond » ci-dessus ne passent jamais par `everyOne`
// (« à chaque tour ») : leurs cadences/intervalles valent toujours 2 ou 4,
// jamais 1. Jeu dédié, cadence/intervalle à 1 des deux côtés (répartition et
// nombre de tours), à 1 maille à chaque fois (perTime par défaut) : ferme le
// trou nommé par le plan (« attention au singulier unitSing »).
async function texteEnRondCadenceUn(locale, solveFor) {
  i18n.global.locale.value = locale
  const w = mount(CalculatorView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
  const opts = w.findAll('.toggle__opt')
  await opts[3].trigger('click') // « En rond »
  if (solveFor === 'length') await w.findAll('.toggle__opt')[5].trigger('click') // « Nombre de tours »
  await w.find('#calc-current').setValue('60')
  await w.find('#calc-target').setValue('61')
  await w.find(solveFor === 'length' ? '#calc-cadence' : '#calc-rows').setValue('1')
  for (const b of w.findAll('.fh__btn')) await b.trigger('click') // déplie toutes les aides
  await nextTick()
  return w.text()
}

describe('CalculatorView — en rond, cadence/intervalle à 1 (« à chaque tour »), jamais de « rang »', () => {
  afterEach(() => {
    i18n.global.locale.value = 'fr'
  })

  for (const locale of ['fr', 'en', 'de', 'es']) {
    for (const solveFor of ['rows', 'length']) {
      it(`${locale} / ${solveFor} : aucune occurrence du mot « rang » à cadence 1`, async () => {
        const txt = await texteEnRondCadenceUn(locale, solveFor)
        expect(txt, `${locale} / ${solveFor}`).not.toContain(MOT_RANG[locale])
      })
    }
  }

  // Preuve que ce jeu exerce bien `everyOne` (pas seulement l'absence de
  // « rang ») : sans elle, un jeu mal calculé passerait au vert en silence
  // sans jamais atteindre le fragment « à chaque tour ».
  it('exerce bien everyOne, « à chaque tour × 1 » côté répartition (fr)', async () => {
    const txt = await texteEnRondCadenceUn('fr', 'rows')
    expect(txt).toContain('à chaque tour × 1')
  })

  it('exerce bien everyOne, « à chaque tour » côté nombre de tours (fr)', async () => {
    const txt = await texteEnRondCadenceUn('fr', 'length')
    expect(txt).toContain('à chaque tour')
  })
})

// Le champ « mailles à chaque fois » parlait de « mailles » dans l'absolu,
// sans dire si on augmente ou diminue : le libellé et son aide doivent
// suivre `mode` (Augmentations/Diminutions), comme le fait déjà `label()`
// pour à plat/en rond. Ici on a besoin du VRAI FieldHelp (pas le stub de
// `mountCalc`) pour lire le libellé et l'aide dans le texte affiché.
describe('CalculatorView — le champ « à chaque fois » suit augmentations/diminutions', () => {
  it('en mode Augmentations (par défaut), le libellé parle d’augmentations', () => {
    const w = mount(CalculatorView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
    const txt = w.text()
    expect(txt).toContain('Augmentations à chaque fois')
    // Garde contre une régression qui laisserait l'ancien libellé générique
    // affiché en plus du nouveau (les deux visibles = le mauvais aurait pu
    // rester dans le gabarit sans que le premier `toContain` s'en aperçoive).
    expect(txt).not.toContain('Mailles à chaque fois')
  })

  it('après bascule sur Diminutions, le libellé parle de diminutions', async () => {
    const w = mount(CalculatorView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.dec')).trigger('click')
    expect(w.text()).toContain('Diminutions à chaque fois')
  })

  it('l’aide de la cadence donne l’exemple concret du patron (rangs à plat, tours en rond)', async () => {
    const w = mount(CalculatorView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
    // Sens « Nombre de rangs » : c'est celui où le champ cadence (#calc-cadence)
    // existe, comme dans `fillLength`/`texteEnRond` plus haut.
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.solveLength')).trigger('click')
    expect(w.find('#calc-cadence').exists()).toBe(true)
    // Le champ cadence est le dernier FieldHelp du gabarit dans ce sens
    // (current, target, per-time, cadence) : son bouton ⓘ est donc le dernier
    // `.fh__btn` du DOM à ce stade.
    const boutonsAide = w.findAll('.fh__btn')
    await boutonsAide[boutonsAide.length - 1].trigger('click') // déplie l'aide de la cadence
    expect(w.text()).toContain('8 augmentations tous les 2 rangs') // à plat, forme par défaut
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.round')).trigger('click')
    expect(w.text()).toContain('tous les 2 tours')
  })

  // Symétrie demandée par le PO : l'aide de la cadence donnait toujours
  // l'exemple « augmentations », même en mode Diminutions. Même gabarit que
  // le test ci-dessus (vrai FieldHelp, sens « Nombre de rangs »), mais en
  // Diminutions : l'exemple doit parler de diminutions, jamais d'augmentations.
  it('en mode Diminutions, l’aide de la cadence donne l’exemple de diminutions', async () => {
    const w = mount(CalculatorView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.dec')).trigger('click')
    await w.findAll('.toggle__opt').find((b) => b.text() === tk('calc.solveLength')).trigger('click')
    expect(w.find('#calc-cadence').exists()).toBe(true)
    const boutonsAide = w.findAll('.fh__btn')
    await boutonsAide[boutonsAide.length - 1].trigger('click') // déplie l'aide de la cadence
    const txt = w.text()
    expect(txt).toContain('8 diminutions tous les 2 rangs')
    expect(txt).not.toContain('8 augmentations')
  })
})

// Le balayage « en rond » ci-dessus (texteEnRond/texteEnRondCas) ne bascule
// jamais sur Diminutions : `mode` y reste 'inc' dans les 24 cas, donc
// `perTimeHintDec` (les 4 langues) n'est jamais lue par ce mécanisme, alors
// que c'est justement l'une des 8 aides visées par la contrainte « jamais
// rang/tour » du plan. Jeu de balayage dédié, en mode Diminutions, qui
// couvre ce qui manquait. Boutons pris par INDEX (pas par texte 'Diminutions'/
// 'En rond') : leur texte varie selon la langue, contrairement au motif
// `.find((b) => b.text() === …)` utilisé ailleurs dans ce fichier, qui ne
// fonctionnerait qu'en français.
async function texteEnRondDec(locale, solveFor) {
  i18n.global.locale.value = locale
  const w = mount(CalculatorView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
  const opts = w.findAll('.toggle__opt')
  await opts[1].trigger('click') // Diminutions
  await opts[3].trigger('click') // En rond
  if (solveFor === 'length') await w.findAll('.toggle__opt')[5].trigger('click') // Nombre de tours
  await w.find('#calc-current').setValue('80')
  await w.find('#calc-target').setValue('60')
  await w.find(solveFor === 'length' ? '#calc-cadence' : '#calc-rows').setValue(solveFor === 'length' ? '2' : '40')
  for (const b of w.findAll('.fh__btn')) await b.trigger('click') // déplie toutes les aides, dont perTimeHintDec
  await nextTick()
  return w.text()
}

describe('CalculatorView — en rond ET en diminutions, jamais de « rang » (couvre perTimeHintDec)', () => {
  afterEach(() => {
    i18n.global.locale.value = 'fr'
  })

  for (const locale of ['fr', 'en', 'de', 'es']) {
    for (const solveFor of ['rows', 'length']) {
      it(`${locale} / ${solveFor} : aucune occurrence du mot « rang » en diminutions`, async () => {
        const txt = await texteEnRondDec(locale, solveFor)
        expect(txt, `${locale} / ${solveFor}`).not.toContain(MOT_RANG[locale])
      })
    }
  }

  // Preuve que ce balayage atteint bien perTimeHintDec (pas seulement l'absence
  // du mot « rang ») : sans elle, une bascule Diminutions qui échouerait
  // silencieusement, ou une boucle `.fh__btn` qui ne déplierait pas l'aide,
  // laisserait les 8 cas ci-dessus verts sans jamais lire ce texte. Le
  // sous-titre « tu retires d'un coup » n'existe que dans perTimeHintDec —
  // son pendant Inc dit « tu ajoutes d'un coup » — donc cette assertion
  // distingue bien la variante Dec de la variante Inc, pas seulement sa
  // présence.
  it('exerce bien perTimeHintDec, pas seulement l’absence de « rang » (fr)', async () => {
    const txt = await texteEnRondDec('fr', 'rows')
    expect(txt).toContain('tu retires d’un coup')
  })
})

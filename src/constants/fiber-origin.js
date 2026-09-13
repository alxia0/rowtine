// Origine d'une fibre — DÉDUITE de la composition, jamais saisie (décision produit 05/08).
// Rien n'est stocké : recalculé à l'affichage, donc rien ne peut se désynchroniser.
import { normalizeComposition } from '@/constants/compositions'

// Les 11 fibres du catalogue (constants/compositions.js) PLUS les saisies libres fréquentes :
// le champ « Autre » permet de taper n'importe quoi, et « origine incomplète » doit rester
// l'exception, pas la règle. Le catalogue lui-même reste stocké en clé française (cf.
// compositions.js) quelle que soit la langue d'affichage : ce dictionnaire ne sert qu'à
// classer la SAISIE LIBRE, où une utilisatrice DE/EN/ES tape le mot de sa langue.
//
// Toutes les clés sont écrites en forme repliée (cf. fold() ci-dessous) : minuscules, sans
// accent ni caractère spécial (« algodon » et non « algodón », « bambu » et non « bambú »).
export const FIBER_ORIGIN = {
  // animales — FR
  laine: 'animale', merinos: 'animale', alpaga: 'animale', mohair: 'animale', soie: 'animale',
  cachemire: 'animale', angora: 'animale', yak: 'animale', chameau: 'animale', lama: 'animale',
  vigogne: 'animale', qiviut: 'animale',
  // animales — EN
  wool: 'animale', merino: 'animale', alpaca: 'animale', llama: 'animale', vicuna: 'animale',
  silk: 'animale', cashmere: 'animale', camel: 'animale',
  // animales — DE
  wolle: 'animale', alpaka: 'animale', vikunja: 'animale', seide: 'animale',
  kaschmir: 'animale', kamel: 'animale',
  // animales — ES (merino, alpaca, llama, vicuna partagent déjà l'orthographe anglaise)
  lana: 'animale', seda: 'animale', cachemira: 'animale', camello: 'animale',

  // végétales — FR
  coton: 'vegetale', lin: 'vegetale', bambou: 'vegetale', chanvre: 'vegetale', ramie: 'vegetale',
  jute: 'vegetale', soja: 'vegetale', ortie: 'vegetale',
  // végétales — EN (« flax » = nom réglementaire, « linen » = usage courant sur les étiquettes)
  cotton: 'vegetale', linen: 'vegetale', flax: 'vegetale', bamboo: 'vegetale', hemp: 'vegetale',
  soy: 'vegetale', nettle: 'vegetale',
  // végétales — DE
  baumwolle: 'vegetale', leinen: 'vegetale', bambus: 'vegetale', hanf: 'vegetale',
  nessel: 'vegetale',
  // végétales — ES (« yute » = jute, « ramio » = ramie : signalés en relecture, absents alors
  // que leurs équivalents FR/EN sont déjà couverts)
  algodon: 'vegetale', lino: 'vegetale', bambu: 'vegetale', canamo: 'vegetale',
  ortiga: 'vegetale', yute: 'vegetale', ramio: 'vegetale',

  // artificielles d'origine végétale — rangées avec les synthétiques : ce sont des fibres
  // transformées chimiquement, ce que le mot « végétale » laisserait mal entendre. Même
  // principe pour leurs équivalents EN/DE/ES (« rayon » = synonyme anglais usuel de viscose ;
  // lyocell/tencel/modal sont des noms génériques déjà identiques dans les quatre langues).
  viscose: 'synthetique', lyocell: 'synthetique', tencel: 'synthetique', modal: 'synthetique',
  acetate: 'synthetique',
  rayon: 'synthetique', viskose: 'synthetique', viscosa: 'synthetique',
  acetat: 'synthetique', acetato: 'synthetique',

  // synthétiques — FR (polyamide, polyester, nylon, polypropylene s'écrivent déjà comme en
  // anglais : pas de doublon nécessaire pour l'EN sur ces quatre-là)
  acrylique: 'synthetique', polyamide: 'synthetique', polyester: 'synthetique',
  nylon: 'synthetique', elasthanne: 'synthetique', polypropylene: 'synthetique',
  // synthétiques — EN
  acrylic: 'synthetique', elastane: 'synthetique', spandex: 'synthetique',
  // synthétiques — DE
  acryl: 'synthetique', polyacryl: 'synthetique', polyamid: 'synthetique',
  elasthan: 'synthetique', polypropylen: 'synthetique',
  // synthétiques — ES
  acrilico: 'synthetique', poliamida: 'synthetique', poliester: 'synthetique',
  elastano: 'synthetique', polipropileno: 'synthetique',
}

// « Mérinos », « MERINOS », « mérinos » désignent la même fibre : on compare sur une forme
// repliée (minuscules, sans accents, sans espaces superflus).
function fold(s) {
  return String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Quelques formulations courantes ramenées à leur fibre : « laine mérinos », « coton bio ».
// La correspondance la PLUS LONGUE l'emporte, jamais la première rencontrée dans le
// dictionnaire : sur « soie de bambou », « soie » (4 lettres) et « bambou » (6 lettres) sont
// toutes deux des sous-chaînes, mais seul « bambou » est la fibre réellement désignée. Prendre
// la première clé trouvée ferait dépendre le résultat de l'ordre de déclaration de
// FIBER_ORIGIN — un accident d'implémentation, pas une règle métier.
//
// Même vérification faite pour l'allemand : « wolle » (laine, animale) est une sous-chaîne de
// « baumwolle » (coton, végétale — littéralement « laine d'arbre »). Le mot complet étant
// toujours le plus long des deux, il l'emporte systématiquement ; testé dans
// tests/unit/fiber-origin.spec.js (audit de collisions).
//
// Exportée uniquement pour que ce test d'audit puisse vérifier canonical(clé) === clé pour
// chaque entrée de FIBER_ORIGIN — deduceOrigin()/animalFibersIn() restent la seule API utilisée
// par le reste de l'app.
export function canonical(fibre) {
  const f = fold(fibre)
  // `Object.hasOwn` et NON `if (FIBER_ORIGIN[f])` : la chaîne de prototype de l'objet littéral
  // répond aussi. Une composition saisie librement contenant « constructor » rendrait la
  // fonction `Object` en guise d'origine — `deduceOrigin` la pousserait dans `origins`, puis
  // dans `key`, et l'affichage chercherait une clé i18n bâtie sur une fonction.
  if (Object.hasOwn(FIBER_ORIGIN, f)) return f
  let best = null
  for (const key of Object.keys(FIBER_ORIGIN)) {
    if (f.includes(key) && (!best || key.length > best.length)) best = key
  }
  return best
}

// Séparateurs qui annoncent PLUSIEURS fibres dans UNE SEULE entrée de composition. Le champ
// « Autre » de StashView.vue (addCustomComposition()) pousse tel quel tout ce qu'une
// utilisatrice tape en une fois — rien ne le découpe en amont. Sans ce découpage, canonical()
// (une seule correspondance, la plus longue, sur toute la chaîne) ne
// retenait QUE le polyamide dans « 80 % laine, 20 % polyamide » — l'étiquette type d'une laine
// à chaussettes, pas un cas limite — et perdait la laine : l'avertissement fibre animale ne se
// déclenchait jamais dessus.
//
// L'ESPACE est volontairement ABSENT de cette liste : il sépare aussi les mots d'un seul nom de
// fibre composé (« laine mérinos », « soie de bambou »), que canonical() sait déjà démêler par
// la correspondance la plus longue (cf. commentaire au-dessus de canonical()). Le découper sur
// l'espace romprait ce cas — vérifié par sabotage : ajouter l'espace ici découpe « soie de
// bambou » en trois jetons ("soie", "de", "bambou") dont « de » ne correspond à aucune fibre,
// ce qui fait tomber le garde-fou en « incomplete » (preuve que la liste ne doit pas aller plus
// loin). « laine mérinos » n'est PAS un contre-exemple utile à ce sabotage précis : « laine » et
// « mérinos » sont CHACUN une clé du dictionnaire, donc les découper sur l'espace retombe quand
// même sur la même origine animale — ce n'est pas une preuve d'absence de sur-découpage, juste
// une coïncidence de ce cas particulier.
const ENTRY_SEPARATORS = /[,/+·;]+/

function splitEntry(fibre) {
  return String(fibre)
    .split(ENTRY_SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Un jeton sans aucune lettre (« 20 », « 80 % ») est un reliquat de dosage, pas une fibre
// inconnue : « Wolle/Polyamid 80/20 » se découpe en "Wolle", "Polyamid 80", "20" parce que le
// dosage partage le même séparateur « / » que les noms de fibres. On l'ignore plutôt que de le
// compter comme un défaut de complétude — sinon CE découpage lui-même réintroduirait le
// symptôme qu'il corrige.
function isPureMeasurement(token) {
  return !/[a-zà-öø-ÿ]/i.test(token)
}

export function deduceOrigin(composition) {
  const fibres = normalizeComposition(composition)
  if (!fibres.length) return { key: null, complete: true, origins: [] }

  const origins = new Set()
  let complete = true
  for (const fibre of fibres) {
    for (const token of splitEntry(fibre)) {
      if (isPureMeasurement(token)) continue
      const key = canonical(token)
      if (!key) complete = false
      else origins.add(FIBER_ORIGIN[key])
    }
  }

  // Le libellé se tait dès qu'il ne peut pas être complet — même si des fibres sont connues.
  if (!complete) return { key: 'incomplete', complete: false, origins: [...origins].sort() }
  const list = [...origins].sort()
  return { key: list.length > 1 ? 'melange' : list[0], complete: true, origins: list }
}

// Base de l'avertissement vegan. Indépendante de `deduceOrigin.complete` : une fibre animale
// RECONNUE reste une certitude, quoi qu'il y ait d'autre dans la liste. Une entrée composite
// (« Wolle/Polyamid 80/20 ») est signalée dès qu'UN de ses jetons est une fibre animale connue —
// l'entrée d'ORIGINE est renvoyée (pas le jeton extrait), comme pour toute entrée simple.
export function animalFibersIn(composition) {
  return normalizeComposition(composition).filter((f) =>
    splitEntry(f).some((token) => {
      if (isPureMeasurement(token)) return false
      const key = canonical(token)
      return key && FIBER_ORIGIN[key] === 'animale'
    })
  )
}

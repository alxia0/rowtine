// Garde de parité STRUCTURELLE des fichiers de langue (passage multilingue,
// 29/07 ; remplace la garde P5 du 18/07, dont la règle 1 est reprise et
// étendue à 3 règles supplémentaires). Un fichier de ~800 clés « qui a l'air
// traduit » est invérifiable à la lecture : ce test compare la STRUCTURE de
// chaque src/i18n/*.json (hors fr.json lui-même) à celle de fr.json, qui est
// la langue de référence (100 % complète, jamais vide). Découverte DYNAMIQUE
// des fichiers via fs.readdirSync : le test passe aujourd'hui avec le seul
// en.json et couvrira automatiquement de.json/es.json le jour où ils seront
// ajoutés, sans qu'on ait à y repenser.
//
// Quatre règles, chacune avec un message d'échec qui liste les CHEMINS DE
// CLÉS fautifs (« les fichiers diffèrent » est inutilisable sur 800 clés) :
//   1. mêmes clés (ni manquante, ni en trop) ;
//   2. mêmes marqueurs {…} par clé (en ENSEMBLE, l'ordre peut légitimement
//      changer d'une langue à l'autre) ;
//   3. même nombre de formes plurielles (séparateur vue-i18n ' | ') ;
//   4. aucune valeur vide, aucune valeur identique au français hors liste
//      blanche explicite.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fr from '@/i18n/fr.json'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const I18N_DIR = path.resolve(__dirname, '../../src/i18n')

// Liste blanche de la règle 4 (valeur identique au français autorisée),
// mesurée en lançant la règle contre en.json le 29/07 (73 clés remontées).
// Deux compartiments :
//   - '*'  : légitime dans N'IMPORTE QUELLE langue cible (rien de
//            linguistique à traduire — chiffre, unité, nom propre).
//   - 'en' : légitime SEULEMENT en anglais — une coïncidence lexicale
//            fr/en (cognat, ou jargon qui se trouve être identique dans
//            ces deux langues précises) qui ne tient pas en allemand/
//            espagnol (ex. "Notes"/"Notes" mais "Notizen" en allemand,
//            "Polyamide" mais "Polyamid" en allemand). Une entrée classée
//            à tort en '*' désarmerait la règle 4 sur de.json/es.json —
//            c'est justement le genre de clé qu'un agent traducteur saute.
const IDENTICAL_VALUE_ALLOWED = {
  '*': [
    'app.name', // "Rowtine" — nom de l'app, jamais traduit
    'pattern.categories.amigurumi', // "Amigurumi" — emprunt japonais, identique dans toutes les langues occidentales
    'yarn.filterCritLabel', // "Label" — terme voulu pour le menu du stock (décision produit, 07/09) : identique en fr/en/de, seul l'espagnol traduit (« Etiqueta »)

    // Unités et mesures : chiffres + unité, rien de linguistique à traduire.
    'needleGauge.unitCm',
    'needleGauge.squareCm',
    'yarn.weightGuide.lace.m50',
    'yarn.weightGuide.lace.m100',
    'yarn.weightGuide.fingering.m50',
    'yarn.weightGuide.fingering.m100',
    'yarn.weightGuide.sport.m50',
    'yarn.weightGuide.sport.m100',
    'yarn.weightGuide.dk.m50',
    'yarn.weightGuide.dk.m100',
    'yarn.weightGuide.worsted.m50',
    'yarn.weightGuide.worsted.m100',
    'yarn.weightGuide.aran.needles',
    'yarn.weightGuide.aran.m50',
    'yarn.weightGuide.aran.m100',
    'yarn.weightGuide.bulky.m50',
    'yarn.weightGuide.bulky.m100',
    'yarn.weightGuide.superbulky.m50',
    'yarn.weightGuide.superbulky.m100',
    'yarn.unit.km', // symbole SI, universel
    'yarn.unit.kg', // symbole SI, universel
    'calc.everyTimes', // "{every} × {count}" — pur gabarit (deux marqueurs + ×), rien de linguistique : {every} porte déjà la traduction (calc.everyN/everyOne)
    'stats.heatmap.cell', // "{date} — {duration}, {count}" — pur gabarit (tiret cadratin + virgule), rien de linguistique : {duration} et {count} portent déjà la traduction (fmtDuration + stats.heatmap.sessions)
    'stats.heatmap.projectLine', // "{name} — {duration}" — MÊME motif que stats.heatmap.cell juste au-dessus : {name} et {duration} portent déjà toute la traduction (11/08)
  ],
  en: [
    'yarn.unit.yd', // "yards" — mot entier, pas un symbole ("Yards" en allemand, "yardas" en espagnol)
    'project.sizesPlaceholder', // "S, M, L" — mesuré identique en fr/en/de/es (29/07) : reconduit aussi dans les compartiments 'de' et 'es' ci-dessous, ce n'est plus une exception anglaise seule

    // Jauges de fil : noms de catégorie non vérifiés comme identiques en
    // allemand/espagnol (contrairement aux unités ci-dessus) — restreint à
    // l'anglais par prudence.
    'yarn.weights.lace',
    'yarn.weights.fingering',
    'yarn.weights.sport',
    'yarn.weights.dk',
    'yarn.weights.worsted',
    'yarn.weights.aran',
    'yarn.weights.bulky',
    'yarn.weights.superbulky',
    'yarn.weightGuide.sport.cyc',
    'yarn.weightGuide.dk.cyc',
    'yarn.weightGuide.worsted.cyc',
    'yarn.weightGuide.aran.cyc',
    'yarn.weightGuide.bulky.cyc',
    'yarn.weightGuide.superbulky.cyc',

    // Matières : "Polyamide"/"Viscose" sont "Polyamid"/"Viskose" en
    // allemand — identité fr/en seulement, pas généralisable.
    'yarn.compositions.mohair',
    'yarn.compositions.polyamide',
    'yarn.compositions.viscose',

    // Gabarits de pagination : "page"/"p." sont des cognats fr/en
    // ("Seite"/"S." en allemand).
    'import.pageOf', // "page {n} / {total}"
    'pdfViewer.page', // "p. {n} / {total}"
    'patternExtras.fromPage', // "p. {n}"

    // Cognats : mots à l'orthographe strictement identique en français et
    // en anglais (pas une traduction manquante, une coïncidence lexicale
    // propre à ce couple de langues — ex. "Notes" est "Notizen" en
    // allemand, donc PAS reconduit dans le compartiment '*').
    'nav.menu', // "Menu"
    'onboarding.crochet', // "Crochet"
    'technique.crochet', // "Crochet"
    'project.sectionDates', // "Dates & notes"
    'project.notes', // "Notes"
    'project.tab.sections', // "Sections"
    'project.tab.sessions', // "Sessions"
    // Vocabulaire unifié « session » (T5, 31/08) : le français dit désormais
    // « Sessions », exactement comme l'anglais — cognats légitimes, alors
    // que l'allemand dit "Sitzungen" et l'espagnol "Sesiones" (donc PAS le
    // compartiment '*').
    'nav.sessions', // "Sessions"
    'session.recapCount', // "Sessions"
    'sessions.title', // "Sessions"
    'session.pause', // "Pause"
    'session.count', // "session(s)"
    'session.date', // "Date"
    'yarn.composition', // "Composition"
    'pattern.type', // "Type"
    'pattern.source', // "Source"
    'pattern.sourcePlaceholder', // "PDF, Ravelry, magazine…"
    'pattern.sectionFallback', // "Section"
    'correction.toolbar.note', // "Note"
    'correction.toolbar.counterCadence', // "Cadence"
    'correction.toolbar.section', // "Section…"
    'correction.toolbar.techniques', // "Techniques"
    'correction.toolbar.ariaSection', // "Section"
    'correction.help.cat.section', // "Section"
    'correction.help.cat.image', // "Image"
    'photo.title', // "Photos"
    'common.actions', // "Actions"
    'reader.reference.tech.label', // "Techniques"
    'warnings.blockName.techniques', // "Techniques"
    'reader.edit.stepType', // "Type"
    'reader.edit.typeNote', // "Note"
    'reader.edit.repeatTotal', // "Total"
    'expenses.categoryFilterLabel', // "Type" — prix du patron (07/08)

    // Caractéristiques de la laine (05/08) : cognats fr/en
    // seulement — "Zertifizierungen"/"Certificaciones" diffèrent en allemand
    // et en espagnol, donc PAS reconduit dans le compartiment '*'.
    'yarn.labelGroups.certifications', // "Certifications"
    // "Vegan" est un emprunt identique par coïncidence en anglais ET en
    // allemand (mais pas en espagnol, "Vegano") — reconduit aussi dans le
    // compartiment 'de' ci-dessous.
    'yarn.labels.vegan', // "Vegan"

    // En-têtes d'export CSV (passage multilingue, 29/07) : cognats fr/en
    // seulement — "Zusammensetzung"/"Composición", "Typ"/"Tipo",
    // "Quelle"/"Fuente", "Abschnitte"/"Secciones" diffèrent en allemand et
    // en espagnol, donc PAS reconduits dans le compartiment '*'.
    'settings.export.yarn.composition', // "Composition"
    'settings.export.pattern.type', // "Type"
    'settings.export.pattern.source', // "Source"
    'settings.export.pattern.sections', // "Sections"
  ],

  // Allemand — mesuré le 29/07 en lançant la règle 4 contre de.json. Chaque
  // entrée vérifiée une par une contre le français ET l'anglais avant
  // classement ; aucune n'est une traduction sautée.
  de: [
    'project.sizesPlaceholder', // "S, M, L" — notation de taille imposée telle quelle (règle 5), identique aussi en allemand
    'session.pause', // "Pause" — mot allemand identique par coïncidence, pas un anglicisme
    'pattern.categories.accessories', // "Accessoires" — emprunt courant de la mode/du tricot allemand, identique au français (pas à l'anglais "Accessories")
    'reader.kind.accessoires', // idem ci-dessus, même mot dans une autre clé
    'settings.profile', // "Profil" — identique en allemand (pas à l'anglais "Profile")

    // Noms d'épaisseur de fil normalisés : emprunts internationaux, jamais
    // traduits par aucun fabricant, dans aucune langue occidentale.
    'yarn.compositions.mohair',
    'yarn.weights.lace',
    'yarn.weights.fingering',
    'yarn.weights.sport',
    'yarn.weights.dk',
    'yarn.weights.worsted',
    'yarn.weights.aran',
    'yarn.weights.bulky',
    'yarn.weights.superbulky',

    // Codes de catégorie CYC (numéro · nom anglais) : repris tels quels par
    // les fabricants dans toutes les langues.
    'yarn.weightGuide.sport.cyc',
    'yarn.weightGuide.dk.cyc',
    'yarn.weightGuide.worsted.cyc',
    'yarn.weightGuide.aran.cyc',
    'yarn.weightGuide.bulky.cyc',
    'yarn.weightGuide.superbulky.cyc',

    // Tailles d'aiguilles en millimètres : le français ET l'allemand notent
    // la décimale avec une virgule ("1,5–2,25 mm") — coïncidence réelle de
    // format numérique, c'est l'anglais qui fait exception (point décimal).
    'yarn.weightGuide.lace.needles',
    'yarn.weightGuide.fingering.needles',
    'yarn.weightGuide.sport.needles',
    'yarn.weightGuide.dk.needles',
    'yarn.weightGuide.worsted.needles',
    'yarn.weightGuide.bulky.needles',
    'yarn.weightGuide.superbulky.needles',

    // Caractéristiques de la laine (05/08) : "Vegan" est un
    // emprunt identique par coïncidence en allemand ET en anglais (mais pas
    // en espagnol, "Vegano").
    'yarn.labels.vegan', // "Vegan"
  ],

  // Espagnol — mesuré le 29/07 en lançant la règle 4 contre es.json. Même
  // méthode que pour l'allemand ci-dessus.
  es: [
    'icounter.typePlain', // "Simple" — adjectif existant en espagnol, identique par coïncidence (pas à l'anglais "Plain")
    'project.sizesPlaceholder', // "S, M, L" — notation de taille imposée telle quelle (règle 5), identique aussi en espagnol
    'project.finishedAt', // "Fin" — mot espagnol correct, identique au français (pas à l'anglais "Finished")
    'settings.export.project.end', // idem : "Fin" est le mot espagnol correct pour un en-tête de colonne "fin", pas un oubli
    'yarn.usage.free', // "Libre" — identique par coïncidence orthographique fr/es (pas à l'anglais "Free")
    'reader.edit.repeatTotal', // "Total" — mot international à une syllabe, aucune alternative plus courte ou naturelle en espagnol
    'patternExtras.fromPage', // "p. {n}" — abréviation de pagination identique en français, anglais et espagnol ("página")

    // Sélecteur de fenêtre des statistiques (travaux sur la grille calendaire du temps,
    // 10-11/08) : "Trimestre"/"Semestre" sont les mots espagnols CORRECTS, identiques au
    // français par coïncidence lexicale réelle (contrairement à l'anglais "Quarter"/
    // "Half-year") — mesuré en lançant la règle 4 contre es.json après l'ajout des clés.
    'stats.period.quarter',
    'stats.period.semester',

    // Noms d'épaisseur de fil normalisés : emprunts internationaux, jamais
    // traduits par aucun fabricant, dans aucune langue occidentale.
    'yarn.compositions.mohair',
    'yarn.weights.lace',
    'yarn.weights.fingering',
    'yarn.weights.sport',
    'yarn.weights.dk',
    'yarn.weights.worsted',
    'yarn.weights.aran',
    'yarn.weights.bulky',
    'yarn.weights.superbulky',

    // Codes de catégorie CYC (numéro · nom anglais) : repris tels quels par
    // les fabricants dans toutes les langues.
    'yarn.weightGuide.sport.cyc',
    'yarn.weightGuide.dk.cyc',
    'yarn.weightGuide.worsted.cyc',
    'yarn.weightGuide.aran.cyc',
    'yarn.weightGuide.bulky.cyc',
    'yarn.weightGuide.superbulky.cyc',

    // Tailles d'aiguilles en millimètres : le français ET l'espagnol notent
    // la décimale avec une virgule ("1,5–2,25 mm") — coïncidence réelle de
    // format numérique, c'est l'anglais qui fait exception (point décimal).
    'yarn.weightGuide.lace.needles',
    'yarn.weightGuide.fingering.needles',
    'yarn.weightGuide.sport.needles',
    'yarn.weightGuide.dk.needles',
    'yarn.weightGuide.worsted.needles',
    'yarn.weightGuide.bulky.needles',
    'yarn.weightGuide.superbulky.needles',
  ],
}

// `guide.toc`/`guide.notTranslatedYet` (écran Guide) ont d'abord porté la
// valeur française dans les 4 fichiers, whitelistées ici sous un compartiment séparé pendant
// que la consigne produit était de ne rien traduire ici. Traduites en revue du 02/08
// (en/de/es) : la garde générale ci-dessous les couvre à nouveau normalement, ce compartiment
// dédié n'est plus nécessaire.

// Liste blanche effective pour une langue donnée : le compartiment universel
// '*' plus le compartiment propre à cette langue (vide si non listé — c'est
// le cas attendu pour de.json/es.json tant que personne n'y a mesuré de
// coïncidence légitime).
function allowedIdenticalValues(locale) {
  return new Set([...(IDENTICAL_VALUE_ALLOWED['*'] || []), ...(IDENTICAL_VALUE_ALLOWED[locale] || [])])
}

// Liste blanche de la règle 3 (nombre de formes plurielles différent entre le français et une
// langue cible, toléré) — même patron que IDENTICAL_VALUE_ALLOWED ci-dessus pour la règle 4 :
// chaque entrée documente POURQUOI l'écart est un fait de grammaire légitime, pas une traduction
// oubliée. Introduite le 11/08 : avant ce mécanisme, l'écart était masqué en
// dupliquant une forme identique dans le JSON de la langue cible — ça satisfaisait la règle sans
// laisser de trace du pourquoi, risquant qu'un futur traducteur fasse diverger les deux formes
// par erreur, ou les refonde en une seule sans savoir que la règle 3 recasserait.
const PLURAL_COUNT_MISMATCH_ALLOWED = {
  '*': [],
}

function allowedPluralCountMismatch(locale) {
  return new Set([...(PLURAL_COUNT_MISMATCH_ALLOWED['*'] || []), ...(PLURAL_COUNT_MISMATCH_ALLOWED[locale] || [])])
}

// Aplatit récursivement un objet de traductions en { "a.b.c": valeur }. Une
// feuille = tout ce qui n'est pas un objet non-tableau (un tableau, s'il y en
// avait, serait déjà une valeur terminale : ce projet encode les pluriels
// vue-i18n en une seule string séparée par ' | ', pas en tableau).
function flattenKeys(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenKeys(value, p, out)
    } else {
      out[p] = value
    }
  }
  return out
}

// Extrait l'ensemble des marqueurs `{…}` d'une valeur (ex. "page {n} / {total}"
// -> {"{n}", "{total}"}). Ensemble, pas liste : l'ORDRE peut légitimement
// changer d'une langue à l'autre (une phrase allemande peut déplacer {n}).
function extractPlaceholders(value) {
  if (typeof value !== 'string') return new Set()
  return new Set(value.match(/\{[^}]*\}/g) || [])
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x))
}

const frFlat = flattenKeys(fr)

// Découverte dynamique : tous les src/i18n/*.json sauf fr.json (référence).
const langFiles = fs
  .readdirSync(I18N_DIR)
  .filter((name) => name.endsWith('.json') && name !== 'fr.json')
  .sort()

describe.each(langFiles)('i18n — parité de structure avec fr.json : %s', (fileName) => {
  const locale = fileName.replace(/\.json$/, '')
  const data = JSON.parse(fs.readFileSync(path.join(I18N_DIR, fileName), 'utf-8'))
  const flat = flattenKeys(data)

  it('règle 1 : mêmes clés que fr.json (ni manquante, ni en trop)', () => {
    const missing = Object.keys(frFlat).filter((k) => !(k in flat)).sort()
    const extra = Object.keys(flat).filter((k) => !(k in frFlat)).sort()
    expect(missing, `clés manquantes dans ${fileName} : ${JSON.stringify(missing)}`).toEqual([])
    expect(extra, `clés en trop dans ${fileName} (absentes de fr.json) : ${JSON.stringify(extra)}`).toEqual([])
  })

  it('règle 2 : mêmes marqueurs {…} (en ensemble) pour chaque clé', () => {
    const bad = []
    for (const key of Object.keys(frFlat)) {
      if (!(key in flat)) continue // déjà signalé par la règle 1
      const frPh = extractPlaceholders(frFlat[key])
      const otherPh = extractPlaceholders(flat[key])
      if (!sameSet(frPh, otherPh)) {
        bad.push(`${key} (fr: ${[...frPh].join(', ') || '—'} / ${locale}: ${[...otherPh].join(', ') || '—'})`)
      }
    }
    expect(bad, `marqueurs {…} différents dans ${fileName} : ${JSON.stringify(bad, null, 1)}`).toEqual([])
  })

  it('règle 3 : même nombre de formes plurielles (séparateur vue-i18n "|")', () => {
    const allowed = allowedPluralCountMismatch(locale)
    const bad = []
    for (const key of Object.keys(frFlat)) {
      if (!(key in flat)) continue
      if (allowed.has(key)) continue
      const frVal = frFlat[key]
      const otherVal = flat[key]
      if (typeof frVal !== 'string' || typeof otherVal !== 'string') continue
      // vue-i18n sépare les formes par '|' et ignore les espaces autour
      // (« a|b » et « a | b » sont équivalents) : le séparateur ici doit
      // tolérer les espaces, sous peine de faire échouer un fichier
      // structurellement correct qui n'aurait pas la même mise en forme.
      const frCount = frVal.split(/\s*\|\s*/).length
      const otherCount = otherVal.split(/\s*\|\s*/).length
      if (frCount !== otherCount) {
        bad.push(`${key} (fr: ${frCount} forme(s) / ${locale}: ${otherCount} forme(s))`)
      }
    }
    expect(bad, `nombre de formes plurielles différent dans ${fileName} : ${JSON.stringify(bad, null, 1)}`).toEqual([])
  })

  it('règle 4 : aucune valeur vide, aucune valeur identique au français hors liste blanche', () => {
    const allowed = allowedIdenticalValues(locale)
    const empty = []
    const identical = []
    for (const key of Object.keys(frFlat)) {
      if (!(key in flat)) continue
      const value = flat[key]
      if (typeof value !== 'string') continue
      if (value.trim() === '') {
        empty.push(key)
        continue
      }
      if (value === frFlat[key] && !allowed.has(key)) {
        identical.push(key)
      }
    }
    expect(empty, `valeurs vides dans ${fileName} : ${JSON.stringify(empty)}`).toEqual([])
    expect(
      identical,
      `valeurs identiques au français dans ${fileName} (hors liste blanche) : ${JSON.stringify(identical, null, 1)}`
    ).toEqual([])
  })
})

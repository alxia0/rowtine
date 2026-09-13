import { describe, it, expect } from 'vitest'
import { detectGerman } from '@/utils/pdf-import/lang-detect'

const L = (text) => ({ text })

describe('detectGerman', () => {
  it('détecte un patron allemand (mots-outils denses : der/die/das/und/für/mit/wird…)', () => {
    const pages = [[
      L('Die Anleitung beginnt mit einem Bündchen, das rechts gestrickt wird.'),
      L('Nach zehn Reihen wird die Arbeit gewendet und für den restlichen Teil in Glattstrickt fortgesetzt.'),
      L('Für die Ärmel werden die Maschen aufgenommen und nicht wieder abgenommen.'),
      L('Wiederhole diese Reihe für die gesamte Länge des Schals.'),
    ]]
    expect(detectGerman(pages)).toBe(true)
  })

  it('ne détecte PAS un patron français (aucun mot-outil allemand)', () => {
    const pages = [[
      L('Ce modèle se tricote de haut en bas, sans couture.'),
      L('Commencez par monter les mailles pour l’encolure, puis continuez en jersey endroit jusqu’à la longueur désirée.'),
      L('Diminuez régulièrement de chaque côté pour former les emmanchures, puis terminez par quelques rangs de côtes avant de rabattre toutes les mailles.'),
    ]]
    expect(detectGerman(pages)).toBe(false)
  })

  it('ne détecte PAS un patron anglais (aucun mot-outil allemand)', () => {
    const pages = [[
      L('This pattern is worked flat in one piece.'),
      L('Cast on the required number of stitches and work in stocking stitch until the piece measures the desired length.'),
      L('Shape the armholes by decreasing on both sides, then work a few rows of rib before casting off all stitches.'),
    ]]
    expect(detectGerman(pages)).toBe(false)
  })

  it('ne détecte PAS un patron espagnol (aucun mot-outil allemand)', () => {
    const pages = [[
      L('Este patrón se teje en redondo desde arriba hacia abajo.'),
      L('Monta los puntos para el cuello y continúa en punto jersey hasta alcanzar el largo deseado.'),
      L('Disminuye a ambos lados para formar las sisas antes de cerrar todos los puntos.'),
    ]]
    expect(detectGerman(pages)).toBe(false)
  })

  it('renvoie false sur un texte trop court pour un score fiable (repli sûr)', () => {
    // « Und der die das » est 100% marqueurs allemands mais 4 mots seulement : sous le
    // plancher MIN_WORDS, le score n'a aucune valeur statistique → repli sûr = false.
    expect(detectGerman([[L('Und der die das')]])).toBe(false)
  })

  it('renvoie false sur des pages vides', () => {
    expect(detectGerman([])).toBe(false)
    expect(detectGerman([[]])).toBe(false)
  })

  it('ne laisse pas "Fäden" (ä adjacent à "den") gonfler le score via la faille \\b non-Unicode', () => {
    // "Fäden" (fils, mot allemand courant en tricot) contient la sous-chaîne "den". Avec
    // \b non-Unicode-aware (frontière définie sur \w ASCII), "ä" est vu comme un caractère
    // non-mot : une frontière apparaissait à tort entre "ä" et "d", et \bden\b matchait à
    // l'intérieur de "Fäden" comme si "den" était l'article isolé. Ce texte ne contient
    // aucun autre marqueur allemand : le score doit rester nul (avant le correctif, ce
    // faux positif suffisait à faire basculer le ratio au-dessus du seuil).
    const pages = [[
      L('Compter les mailles avec attention avant de continuer le rang suivant sans erreur.'),
      L('Les brins colorés forment un joli motif régulier tout au long du châle en Fäden.'),
    ]]
    expect(detectGerman(pages)).toBe(false)
  })
})

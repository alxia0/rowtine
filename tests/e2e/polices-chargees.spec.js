// ───────────────────────────────────────────────────────────────────────────────────────────
// Les polices se chargent-elles VRAIMENT dans l'app assemblée ?
//
// Pourquoi ce fichier existe, et pourquoi il est en e2e et pas en unitaire : les six gardes de
// `tests/unit/polices-embarquees.spec.js` vérifient les OCTETS des .woff2, les noms dans
// `tokens.css`, les `src: url()` et les plages de graisse. Elles restent TOUTES VERTES si le
// navigateur rejette les @font-face et rend l'app entière avec la pile de repli
// (Georgia / system-ui). 4 978 unitaires au vert, et l'app peut tourner en Georgia sans que
// rien ne le signale.
//
// Le risque est concret depuis le 17/08 : le nom de famille a changé pour « Source Sans 3 »
// — espaces ET chiffre —, et `format('woff2-variations')` n'avait jamais été éprouvé avec ces
// fichiers-là. Un nom mal écrit dans `tokens.css`, un fichier absent du build, un chemin
// `/fonts/` cassé par la configuration Vite : rien de tout ça ne produit d'erreur visible,
// seulement un rendu qui n'est plus celui qu'on a choisi.
//
// C'est le motif qui a déjà coûté à ce projet : les revues lisent le diff, pas l'app assemblée.
// ───────────────────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

// Les trois fontes déclarées dans src/styles/tokens.css, avec le style attendu pour chacune.
// Literata n'a PAS d'italique embarquée (Fraunces n'en avait pas non plus : parité assumée).
const ATTENDUES = [
  { family: 'Literata', style: 'normal' },
  { family: 'Source Sans 3', style: 'normal' },
  { family: 'Source Sans 3', style: 'italic' },
]

test.describe('polices embarquées', () => {
  test('les trois fontes sont réellement chargées par le navigateur', async ({ page }) => {
    await completeOnboarding(page)

    // `document.fonts.ready` attend que TOUTES les fontes utilisées par la page aient fini de
    // se résoudre — chargées ou en échec. Sans cette attente, on lirait un état intermédiaire
    // et la garde deviendrait instable au lieu d'être fausse.
    await page.evaluate(async () => {
      await document.fonts.ready
    })

    // ⚠️ Un navigateur ne télécharge une fonte QUE si la page l'emploie vraiment. Mesuré le
    // 17/08 : sur l'écran d'accueil, l'italique de Source Sans 3 reste à `unloaded`, faute de
    // texte en italique — ce n'est pas un défaut, c'est le chargement paresseux qui fait son
    // travail. Pour prouver que le fichier est bien SERVI (et pas seulement déclaré), on
    // demande explicitement son chargement : si l'URL était cassée, `load()` échouerait ici.
    await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load("400 16px 'Source Sans 3'"),
        document.fonts.load("italic 400 16px 'Source Sans 3'"),
        document.fonts.load("600 44px 'Literata'"),
      ])
    })

    const fontes = await page.evaluate(() =>
      [...document.fonts].map((f) => ({ family: f.family, style: f.style, status: f.status })),
    )

    for (const { family, style } of ATTENDUES) {
      const trouvee = fontes.find((f) => f.family === family && f.style === style)
      expect(
        trouvee,
        `La fonte « ${family} » (${style}) n'est déclarée nulle part dans le document. ` +
          "L'app rend donc avec sa pile de repli (Georgia / system-ui) — silencieusement. " +
          'Vérifier le @font-face correspondant dans src/styles/tokens.css.',
      ).toBeTruthy()
      expect(
        trouvee.status,
        `La fonte « ${family} » (${style}) est déclarée mais son statut est « ${trouvee.status} » ` +
          "et non « loaded » : le fichier .woff2 n'a pas pu être chargé (chemin /fonts/ cassé, " +
          "fichier absent du build, ou format() refusé). L'app rend en police de repli.",
      ).toBe('loaded')
    }
  })

  test('le texte de l’app est effectivement rendu avec ces polices, pas avec un repli', async ({
    page,
  }) => {
    await completeOnboarding(page)
    await page.evaluate(async () => {
      await document.fonts.ready
    })

    // On ne se contente pas de « la fonte est chargée » : on vérifie que les JETONS la
    // désignent bien en PREMIER choix. Une fonte peut être chargée et pourtant n'être
    // utilisée nulle part si --font-ui pointe ailleurs.
    const jetons = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement)
      return { ui: s.getPropertyValue('--font-ui'), display: s.getPropertyValue('--font-display') }
    })
    // ⚠️ Le style CALCULÉ normalise les quotes : `'Source Sans 3'` écrit dans tokens.css
    // ressort en `"Source Sans 3"`. Le motif accepte donc les deux formes — sinon la garde
    // échouerait sur un détail de sérialisation du navigateur, pas sur un vrai défaut.
    expect(jetons.ui.trim()).toMatch(/^["']Source Sans 3["']/)
    expect(jetons.display.trim()).toMatch(/^["']Literata["']/)

    // Et qu'aucune trace des anciennes polices ne subsiste dans les jetons.
    expect(`${jetons.ui} ${jetons.display}`).not.toMatch(/Fraunces|DM Sans/)

    // Preuve de rendu : le corps du document doit résoudre sur la fonte UI.
    //
    // ⚠️ Limite de `document.fonts.check`, constatée en éprouvant ce fichier par mutation le
    // 17/08 : en renommant la famille en « Source Sans 33 » dans tokens.css, `check()` a
    // continué de répondre `true` — il tient compte des polices SYSTÈME disponibles, pas
    // seulement des @font-face du document. C'est donc le test précédent (statut `loaded` de
    // chaque FontFace déclarée) qui est le vrai discriminant ; celui-ci ne vaut que par ses
    // assertions sur les JETONS. Écrit noir sur blanc pour que personne ne prenne ce `check()`
    // pour une preuve qu'il n'apporte pas.
    const rendableUi = await page.evaluate(() => document.fonts.check("16px 'Source Sans 3'"))
    const rendableDisplay = await page.evaluate(() => document.fonts.check("44px 'Literata'"))
    expect(
      rendableUi,
      "Le navigateur ne peut pas rendre de texte en Source Sans 3 : l'UI part en repli.",
    ).toBe(true)
    expect(
      rendableDisplay,
      'Le navigateur ne peut pas rendre de texte en Literata : titres et compteurs partent en ' +
        'repli. C’est le corps 44 px de .ccard__val qui souffre le plus visiblement.',
    ).toBe(true)
  })
})

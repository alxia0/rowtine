<script setup>
// Aide dépliable en tête de l'écran de correction. L'écran ne disait
// rien de comment procéder ni de ce que fait/devient chaque catégorie une
// fois dans le projet — en usage réel, des instructions par taille ont ainsi
// été étiquetées en « Tailles » (un bloc de la fiche patron qui attend un
// TABLEAU de mesures, pas des instructions) et perdu leurs lignes.
//
// Repliée par défaut : <details>/<summary> natifs — repliable accessible sans
// JavaScript, sans piège de focus, sans dépendance (même motif que les
// sections repliables de PatternView.vue).
//
// Les libellés de catégorie (colonne de gauche des 2 tableaux) réutilisent
// TELS QUELS les clés i18n existantes des boutons de la barre CM6
// (correction.toolbar.*, cf. ReaderTextEditor.vue) : ce sont les mots que la
// personne voit déjà en tapant sur une ligne, l'aide doit parler le même
// vocabulaire. Seules les explications (« ce que ça donne dans le projet »)
// sont nouvelles (correction.help.*).
//
// EXCEPTION (P3, revue) : Compteur/Section/Aide-mémoire réutilisent
// correction.toolbar.counter/.section/.reference dans la barre CM6, mais CES
// valeurs portent un « … » (placeholder de menu déroulant) — lisible comme
// « ouvre un menu » dans un tableau STATIQUE. Ces lignes utilisent donc des
// clés dédiées à nom nu (correction.help.cat.*), pas les clés toolbar.*.
//
// EXCEPTION 2 : Image n'a PLUS de bouton dans la barre CM6 (retiré —
// tap-to-select remplace le re-balisage manuel), donc plus de
// correction.toolbar.image du tout ; la catégorie existe toujours (images
// parsées/rendues, non manuellement assignable), d'où correction.help.cat.image
// (même motif que les 3 ci-dessus, pour une raison différente : clé absente
// plutôt que libellé à « … »).
//
// ORDRE (revue du 28/07, correctif 5) : les lignes du 1er tableau suivent
// l'ordre RÉEL de la barre CM6 depuis son regroupement en deux lignes —
// [Étape][Note][Aide-mémoire] puis [Compteur][Section][Texte] — puis Image en
// dernier (aucun contrôle correspondant dans la barre). Même principe que
// « parler le même vocabulaire » ci-dessus, appliqué à l'ORDRE cette fois.
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'

const { t } = useI18n()
</script>

<template>
  <details class="help card">
    <summary class="help__summary">
      <AppIcon name="help" :size="18" />
      <h2 class="help__summary-title">{{ t('correction.help.title') }}</h2>
      <AppIcon name="chevronDown" :size="16" class="help__chevron" />
    </summary>

    <div class="help__body">
      <ol class="help__steps">
        <li>{{ t('correction.help.steps2') }}</li>
        <li>{{ t('correction.help.steps1') }}</li>
        <li>{{ t('correction.help.steps3') }}</li>
      </ol>

      <!-- Retour terrain 26/08/2026 : les deux bandes du BAS de l'écran (Diagrammes, Galerie)
           n'étaient nommées nulle part dans l'aide, et le geste qui compte le plus — taper une
           image DANS le texte pour en changer le type — n'était découvrable que par hasard.
           Bloc à part, avec sa propre classe : `.help__steps li` est COMPTÉ par
           tests/unit/correction-help.spec.js (« 3 étapes ») — y verser ces lignes ferait
           monter ce décompte à tort. Même raison, même parade que `.help__markup`. -->
      <h3>{{ t('correction.help.stripsTitle') }}</h3>
      <ul class="help__strips">
        <li>{{ t('correction.help.stripDiagrams') }}</li>
        <li>{{ t('correction.help.stripGallery') }}</li>
        <li>{{ t('correction.help.stripImageTap') }}</li>
      </ul>

      <h3>{{ t('correction.help.tagsTitle') }}</h3>
      <table class="help__table">
        <thead>
          <tr>
            <th>{{ t('correction.help.tagsCol1') }}</th>
            <th>{{ t('correction.help.tagsCol2') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="help__cat"><AppIcon name="checkbox" :size="17" /> {{ t('correction.toolbar.step') }}</span></td>
            <td>{{ t('correction.help.tagRang') }}</td>
          </tr>
          <tr>
            <td><span class="help__cat"><AppIcon name="note" :size="17" /> {{ t('correction.toolbar.note') }}</span></td>
            <td>{{ t('correction.help.tagNote') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.help.cat.reference') }}</td>
            <td>{{ t('correction.help.tagReference') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.help.cat.counter') }}</td>
            <td>{{ t('correction.help.tagCompteur') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.help.cat.section') }}</td>
            <td>{{ t('correction.help.tagSection') }}</td>
          </tr>
          <tr>
            <td><span class="help__cat"><AppIcon name="text" :size="17" /> {{ t('correction.toolbar.text') }}</span></td>
            <td>{{ t('correction.help.tagTexte') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.help.cat.image') }}</td>
            <td>{{ t('correction.help.tagImage') }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('correction.help.refsTitle') }}</h3>
      <p class="help__intro">{{ t('correction.help.refsIntro') }}</p>
      <table class="help__table">
        <thead>
          <tr>
            <th>{{ t('correction.help.refsCol1') }}</th>
            <th>{{ t('correction.help.refsCol2') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{{ t('correction.toolbar.yarn') }}</td>
            <td>{{ t('correction.help.refYarn') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.toolbar.needles') }}</td>
            <td>{{ t('correction.help.refNeedles') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.toolbar.gauge') }}</td>
            <td>{{ t('correction.help.refGauge') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.toolbar.materials') }}</td>
            <td>{{ t('correction.help.refMaterials') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.toolbar.tips') }}</td>
            <td>{{ t('correction.help.refTips') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.toolbar.abbreviations') }}</td>
            <td>{{ t('correction.help.refAbbreviations') }}</td>
          </tr>
          <!-- Tailles : LE piège avéré. Seule ligne mise en évidence
               (classe + gras) : ce bloc attend un TABLEAU de mesures, pas
               des instructions par taille (celles-ci sont des Sections). -->
          <tr class="help__row--warn">
            <td>{{ t('correction.toolbar.measurements') }}</td>
            <td>{{ t('correction.help.refMeasurements') }}</td>
          </tr>
          <tr>
            <td>{{ t('correction.toolbar.techniques') }}</td>
            <td>{{ t('correction.help.refTechniques') }}</td>
          </tr>
        </tbody>
      </table>

      <p>{{ t('correction.help.sections') }}</p>

      <!-- Tâche A (lot « aide accolades + hiérarchie des titres ») — le manque documenté :
           l'écran offre un mode « Modifier le texte » qui montre le
           balisage brut (`## Fil {yarn}`, `### Croiser une torsade`), sans qu'aucune ligne
           de l'aide n'en dise rien. {yarn} est un marqueur de catégorie EN ANGLAIS lu par
           REF_TAG_TO_KEY (src/utils/pattern-md/refblocks.js) : le TRADUIRE (ex. {laine})
           fait retomber le bloc en section de travail ordinaire (parse.js:60, lineType
           renvoie 'section' au lieu de 'reference') et le bloc quitte la fiche du patron.
           C'est le seul endroit de l'app où une syntaxe technique est offerte à la frappe
           libre.

           ⚠️ Revue (point critique) : LE SUPPRIMER, lui, ne casse RIEN tant que le titre
           français nu reste intact — `parse.js:60` retombe alors sur `reservedKey(b.title)`,
           la compat FR héritée qui reconnaît "Fil"/"Aiguilles"/"Échantillon"/etc. À LEUR
           LIBELLÉ NU (cf. `tests/unit/find-reference-block.spec.js` : « trouve un titre
           réservé NU »). Mon premier jet affirmait aussi ce risque de suppression : FAUX,
           corrigé — seule la traduction du marqueur est dangereuse, l'aide ne dit plus que
           ça.

           Les exemples de syntaxe (`##`, `Fil`, `{yarn}`, `###`, `-`, `>`, `| … |`) sont
           posés en texte STATIQUE du template, pas dans une clé i18n — pour deux raisons
           DIFFÉRENTES selon le morceau :
             - `{yarn}` porte de vraies accolades simples, et vue-i18n interprète `{nom}`
               DANS un message comme une interpolation nommée à résoudre — un message qui
               les contiendrait sans passer le paramètre correspondant ne les afficherait
               pas tel quel ;
             - `Fil`, lui, n'est PAS un libellé d'interface à traduire ici : c'est une
               DONNÉE gelée. `referenceBlocksToMd` (src/utils/pattern-md/refblocks.js:55)
               écrit littéralement `## Fil {yarn}` dans le texte du patron, EN FRANÇAIS,
               quelle que soit la langue de l'app (seul le tag `{yarn}` vient de
               `REF_TO_EN`) — l'enrichir avec `t('correction.toolbar.yarn')` afficherait
               "## Yarn {yarn}" à une utilisatrice anglophone alors que SON éditeur, lui,
               montre bien "## Fil {yarn}". Reproduire l'exemple tel qu'il apparaît
               RÉELLEMENT dans Modifier le texte, dans les 4 langues, prime ici sur la
               convention "réutiliser les clés toolbar.*" suivie ailleurs dans ce fichier.
           `Titre` (exemple du ###), à l'inverse, reste traduit via
           `correction.help.markupTitlePlaceholder` : LUI est un mot-gabarit générique
           tenant lieu d'un titre de technique choisi par la personne
           (`### ${t.title}`, refblocks.js), pas une donnée figée — l'asymétrie avec
           `Fil` est voulue, pas un oubli. -->
      <h3>{{ t('correction.help.markupTitle', { editCode: t('correction.toolbar.editCode') }) }}</h3>
      <ul class="help__markup">
        <li>
          <code class="help__code">## Fil {yarn}</code>
          — {{ t('correction.help.markupTag') }}
        </li>
        <li>
          <code class="help__code">### {{ t('correction.help.markupTitlePlaceholder') }}</code>
          — {{ t('correction.help.markupSubtitle') }}
        </li>
        <li>
          {{ t('correction.help.markupSyntaxIntro') }}
          <code class="help__code">-</code> = {{ t('correction.help.markupStep') }},
          <code class="help__code">&gt;</code> = {{ t('correction.help.markupNote') }},
          <code class="help__code">| … |</code> = {{ t('correction.help.markupRow') }}.
        </li>
      </ul>
    </div>
  </details>
</template>

<style scoped>
.help {
  margin-bottom: var(--sp-4);
}
.help__summary {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px;
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-70);
  list-style: none;
}
.help__summary::-webkit-details-marker {
  display: none;
}
/* Viser le titre SEUL. Task B (hiérarchie des titres) : le titre est passé de <span> à
   <h2> pour combler le saut H1 (AppHeader) -> H3 (corps de l'aide) qu'un lecteur d'écran
   annonçait. `:not(.app-icon)` reste indispensable pour autant : <AppIcon> s'affiche
   AUSSI comme un <span>, et un sélecteur `> :not(.app-icon)` naïf sans lui étirerait les
   deux icônes à parts égales avec le titre, qui se retrouverait écrasé sur trois lignes.
   Modifier CETTE règle plutôt que d'en ajouter une : les styles scoped de Vue portent un
   attribut [data-v-…] qui leur donne une priorité qu'une règle concurrente n'aurait pas. */
.help__summary > :not(.app-icon) {
  flex: 1;
}
/* h1/h2/h3 { font-family: var(--font-display) } (src/styles/tokens.css) s'appliquerait
   sinon au <h2> du résumé, cassant la police --font-ui (et le poids/couleur) que porte
   .help__summary — annulé explicitement, comme si le titre était toujours un <span>. */
.help__summary-title {
  font: inherit;
  color: inherit;
}
.help__chevron {
  color: var(--ink-55);
  flex-shrink: 0;
  transition: transform var(--motion-base, 0.15s);
}
.help[open] .help__chevron {
  transform: rotate(180deg);
}
.help__body {
  padding-top: var(--sp-3);
}
.help__body h3 {
  font-size: 14px;
  margin: var(--sp-4) 0 var(--sp-1);
  color: var(--ink-70);
}
.help__body h3:first-child {
  margin-top: 0;
}
.help__steps {
  margin: 0;
  padding-left: 1.2em;
  font-size: 14px;
  line-height: 1.5;
}
.help__steps li {
  margin-bottom: var(--sp-1);
}
/* Tâche A — même gabarit que .help__steps (marge/taille/interligne), mais SÉPARÉ : les
   3 étapes numérotées (.help__steps li) sont comptées ailleurs (tests/unit/
   correction-help.spec.js), réutiliser la classe aurait fait remonter le décompte à tort
   dès que cette section serait montée. Puces (comportement <ul> par défaut) plutôt que
   numéros : ces 3 lignes n'ont rien de séquentiel, contrairement aux étapes. */
.help__markup,
/* Même gabarit que .help__markup, classe DISTINCTE (lot « bandes du bas ») : le texte de la
   section balisage est ciblé nommément par tests/unit/correction-help.spec.js (« l'aide
   n'affirme plus que supprimer le marqueur est dangereux »), une classe partagée y ferait
   entrer les lignes des bandes — qui parlent, elles, de supprimer des images. */
.help__strips {
  margin: 0;
  padding-left: 1.2em;
  font-size: 14px;
  line-height: 1.5;
}
.help__markup li,
.help__strips li {
  margin-bottom: var(--sp-1);
}
.help__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  background: var(--surface);
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
}
.help__intro {
  font-size: 13.5px;
  color: var(--ink-55);
  margin: 0 0 var(--sp-2);
}
.help__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
  margin-bottom: var(--sp-1);
}
.help__table th,
.help__table td {
  text-align: left;
  padding: 7px 6px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: top;
}
.help__table th {
  color: var(--ink-55);
  font-weight: 700;
  font-size: 12.5px;
}
.help__table td:first-child {
  font-weight: 600;
  white-space: nowrap;
}
.help__row--warn td {
  color: var(--warning);
  font-weight: 700;
}
.help__cat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.help__cat :deep(.app-icon) {
  color: var(--ink-55);
}
</style>

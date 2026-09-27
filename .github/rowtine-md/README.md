# Rowtine-MD: writing a pattern Rowtine can import

Rowtine stores every pattern as a Markdown file, `patron.md`, written in a small dialect
called Rowtine-MD. This folder holds a complete, working example and explains how to turn
it (or your own pattern) into a `.rowtine` file that the app imports as is.

```
.github/rowtine-md/
  README.md            this file
  example/             exactly what goes into the archive
    patron.md          the pattern (Meadowlark Round Cushion, an original example)
    cover.png          cover photo of the pattern
    img/               every picture the pattern refers to
```

`example/patron.md` uses every feature of the format: front matter with sizes and
sub-sizes, an introduction with a picture, all the reference blocks (gauge, yarn, needles,
materials, tips, techniques, abbreviations, size table), work sections of several kinds,
per-size figures, notes, three kinds of repeat, pictures attached to a step, a gallery,
and three charts (a linear cable chart with a repeat, a round medallion chart, and a chart
that only applies to some sizes). Start from a copy of it.

## 1. The `.rowtine` archive

A `.rowtine` file is a plain ZIP archive. The extension is only a convenience: the app
recognises the archive by its content, and a `.zip` file imports the same way.

| Entry | Required | Role |
|---|---|---|
| `patron.md` | yes | The pattern. If there is no `patron.md` at the root, the first `.md` file found is used. |
| images (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`) | if referenced | Every picture named in `patron.md`, at the path written there (for example `img/chart-a-cable.png`). A reference that does not match a path is matched by file name alone. |
| `cover.jpg`, `cover.jpeg`, `cover.png` or `cover.webp` | no | Cover photo of the pattern, at the root or next to `patron.md`. |

There is no manifest and no JSON file: the format version lives in the front matter of
`patron.md` (`rowtine: 1`). Anything else in the archive is ignored. On import, every
picture is scaled down to at most 1280 px and stored as JPEG. An archive is refused above
50 MB per entry, 150 MB in total or 4096 entries.

### Build it

Zip the **content** of the folder, from inside it, so that `patron.md` sits at the root of
the archive and the picture paths stay as they are written in the pattern. Write the
archive outside the folder (here, in your home directory):

```bash
cd .github/rowtine-md/example
zip -r -X ~/meadowlark.rowtine .
```

Do not put anything else in the folder you zip (in particular, no second `.md` file).

### Import it

Copy the file to your phone, then in Rowtine: **Pattern library**, **Add pattern**,
**Import in Rowtine format**, and pick the file. If something in the file could not be
read, the pattern is still imported and its page lists what was skipped.

The unit test `tests/unit/zip-import.spec.js` builds this archive from `example/` in the
same way, imports it through the app's own import code and checks that nothing produces a
warning: `yarn test tests/unit/zip-import.spec.js`.

## 2. The dialect

Rowtine-MD is ordinary Markdown with a few fixed words. The text of your pattern can be in
any language, but **the keywords below are part of the format and must be written exactly
as shown**, including the French ones (section titles of the reference blocks, chart
attributes, table headers). The app translates them on screen; in the file they never
change.

A file is read in this order, which is also the order in which the app writes it back:
front matter, introduction, reference blocks, work sections, gallery.

### Front matter

```
---
rowtine: 1
title: Meadowlark Round Cushion
author: Rowtine example
link: https://example.com/meadowlark-cushion
sizes: S · M · L
subsizes: 35 · 40 · 45 (insert diameter, cm)
ease: The cover is knitted about 3 cm smaller than the insert, for a snug fit.
---
```

| Key | Content |
|---|---|
| `rowtine` | Format version. Always `1`, always first. |
| `title`, `author` | Free text, one line. |
| `link` | Web address of the designer. Only `http:` and `https:` addresses are kept. |
| `sizes` | Size labels, separated by ` · ` (middle dot). Their number, n, drives every per-size figure in the file. For a one-size pattern, write `sizes: Taille unique` or leave the key out. |
| `subsizes` | Optional second line of labels under the sizes (one per size, same separator), with an optional caption in parentheses at the end. |
| `ease` | Optional ease note, free text. |

Any other key is reported as a warning and ignored.

### Introduction

Paragraphs before the first `##` heading form the introduction. A picture line
(`![](img/schematic.png)`) is attached to the paragraph just above it; a picture with no
paragraph before it is reported and dropped.

### Reference blocks

These blocks feed the pattern's quick-reference sheet. The heading must be written exactly
as in the first column: for the blocks holding free text (gauge, yarn, needles, materials,
tips, techniques), a different title turns the block into plain notes.

| Heading | Body |
|---|---|
| `## Échantillon {gauge}` | One paragraph. |
| `## Fil {yarn}` | One paragraph. |
| `## Aiguilles {needles}` | One paragraph. |
| `## Matériel {materials}` | A list, one `- item` per line. |
| `## Conseils {tips}` | A list, one `- tip` per line. |
| `## Techniques {techniques}` | One `### Technique name` per technique, followed by its explanation. |
| `## Abréviations {abbreviations}` | A two-column table. The header row is `\| abr. \| définition \|`. |
| `## Tailles {measurements}` | A table with a first column `mesure` and one column per size, in the order of `sizes`. Every row must have exactly n values. |

Abbreviations are matched as whole words in the pattern text and explained on tap, so
declare them in the form they are written (`k2tog`, `C6B`).

### Work sections

Every other `##` heading starts a work section, the part the knitter follows row by row:

```
## Front medallion {lace}
```

The tag in braces gives the section its kind (and its icon). Without a tag, the section
gets the default kind. An unknown tag is reported as a warning.

| Family | Tags |
|---|---|
| Garment | `body`, `sleeve`, `neckline`, `border`, `accessory` |
| Accessory | `base`, `flap`, `handle`, `strap`, `loop-handle`, `lining`, `pocket` |
| Toy (amigurumi) | `head`, `round-body`, `limb`, `ear`, `muzzle`, `tail` |
| Stitch pattern and technique | `motif`, `lace`, `swatch`, `chart`, `buttonhole` |
| General | `finishing`, `info`, `other` |

A work section whose untagged title is one of the reference headings above (`## Fil`,
`## Techniques`, `## Galerie`...) would be read as that block: give it a tag.

### Steps

Inside a work section, each line is one of the following.

| Line | Meaning |
|---|---|
| `- Cast on 12 sts.` | A row or round to work, ticked off by the knitter. |
| `> Measure over 10 cm.` | A note: read, not worked. Leave a blank line after it, or the next `>` line joins it. |
| `- × Repeat the last 2 rounds 2 (5) 8 more times.` | A repeat. The count is the figure before `times` (or `fois`), per size when it is a size vector. |
| `- {×3} Work rounds 1 to 8 of Chart A.` | A repeat counted N times, the same for every size. |
| `- {cadence 2×17} Increase round: ...` | A cadence: the step comes back every 2 rows or rounds, 17 times. |
| `  ![](img/step-markers.png)` | A picture attached to the step above it: indented by at least two spaces. |

The `×` sign is the multiplication sign (U+00D7), not the letter x. A line of plain text
right under a step continues that step; plain text with no step above it becomes a note and
is reported.

### Figures per size

Write a figure that changes with the size as n values, the first one bare and the next
ones alternately in parentheses: with `sizes: S · M · L`, `240 (276) 312 sts`. The app
then shows each knitter only the figure for her size. A group of values that does not have
exactly n values stays plain text. Be careful with three or more numbers joined by dashes
or slashes (`8-10-12`, `6/7/8`): they are also read as figures per size.

### Charts

A picture line that is **not** indented, inside a work section, is that section's chart.
The line right after it describes the chart:

```
![Diagramme](img/chart-a-cable.png)
12 m × 8 rangs · lecture droite à gauche {rtl} · répéter 3 fois
```

The description starts with `<stitches> m × <rows> rangs`, followed by any of these parts,
in this order, each introduced by ` · `:

| Part | Meaning |
|---|---|
| `forme radial-rond`, `forme radial-carré`, `forme radial-hexagone` | A chart worked in rounds from the centre out (circle, square or hexagon). Without it, the chart is a flat grid. |
| `lecture droite à gauche {rtl}` or `lecture gauche à droite {ltr}` | Reading direction. |
| `répéter N fois` | The whole chart is worked N times, one after the other. |
| `tailles M, L` | The chart only applies to these sizes (labels from `sizes`, separated by commas). |

Each work section holds one chart at most; a second, different chart in the same section is
reported. Give each chart its own section. The alt text is not read (the app writes
`Diagramme`).

To let the app highlight the current row without any adjustment, draw a flat chart so that
its grid fills the whole picture, row 1 at the bottom. Draw a round chart centred, its last
round touching the edges of the picture. Otherwise, the knitter can adjust the grid in the
app.

### Gallery

```
## Galerie {gallery}

![](img/gallery-band.png)
![](img/gallery-back.png)
```

One picture per line. These pictures show the finished piece; they are not attached to a
step.

## 3. What gets reported

The import never fails because of the content of `patron.md`: whatever cannot be read is
kept as a note where possible and listed on the pattern page. The usual causes are a
missing picture, an unknown front matter key or section tag, a size table row or chart size
that does not match `sizes`, a repeat without a count, and a reference block whose heading
is not the expected one. `example/patron.md` produces none of them.

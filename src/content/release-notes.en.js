// Journal des nouveautés, traduction anglaise (revue du 02/08 — ce fichier
// n'existait pas : la section se rendait en français aux quatre langues). Traduite depuis
// release-notes.fr.js, la source de vérité — voir le commentaire de tête de ce fichier pour
// le mécanisme (une entrée par version, marqueur `{app}` substitué à l'affichage).
//
// ⚠️ Cette version anglaise n'a PAS été relue par une personne de langue maternelle anglaise,
// même réserve que les traductions d'interface des 29/07 et 31/07.
export const RELEASE_NOTES_EN = [
  {
    version: '1.4.1',
    notes: [
      'Tracking notification: a button tap is kept even if Android has closed or frozen the app.',
      'Notification turned on only on request, with a background permission pop-up.',
      'Reopening a project lands on the last row you worked on: a pattern can be worked out of order.',
      'Project page: a "Keep the screen on" switch, available while you work.',
    ],
  },
  {
    version: '1.4.0',
    notes: [
      "Stitch techniques memo: basic and common knitting and crochet techniques (cast-ons, bind-offs, stitches), in the Tools and in the reader's cheat sheet; pick the stitches to keep at hand for each pattern.",
      'Current row in a notification while you follow a pattern: check off the row, count repeats (minus and plus), chart reminder, visible on the lock screen. Turn it on in Settings, with the background permission that makes the button reliable.',
      'The screen stays on while you follow a pattern. On by default; adjustable in Settings and from the tracking memo panel.',
      'Reader: the current step also stops on repeat counters, and tapping the left third of a step card checks it off.',
      "Badge: each yarn's colorway, the project's fibres above the calendar, sharper image.",
      'Yarn stash: each card shows the total yardage of the lot.',
      "Project page: gauge units are translated, and needle sizes use your language's decimal separator.",
      'Guide updated.',
    ],
  },
  {
    version: '1.3.3',
    notes: [
      'Decimal yarn quantities (e.g. 2.5 skeins): stash, purchases, reservations, per-project usage, CSV export and sharing.',
      "PDF import: the pattern's pictures are better preserved, and patterns are read more accurately, German ones in particular.",
      'Pattern viewer: large step images, PDF cover at the top, improved preview.',
      'Various UI improvements and fixes.',
    ],
  },
  {
    version: '1.3.2',
    notes: [
      'Import your yarn stash from a Ravelry export (.xlsx): status, colour, purchases, notes, storage location, and "bought at" on each purchase.',
      'Various display fixes.',
    ],
  },
  {
    version: '1.3.1',
    notes: [
      'HEIC/HEIF photos supported (Android 9 or later).',
      'Improved yarn stash menu.',
    ],
  },
  {
    version: '1.3.0',
    notes: [
      'New Stats tab on every project: total time, sessions, skeins used, timespan, longest daily streak and a calendar view.',
      'Share a badge of your work (photo, numbers, colors, four layouts, free text, choice of language).',
      'Share a project photo from the gallery.',
      'Yarn stash: price now accepts a comma.',
      'Photo access permission removed (system picker).',
    ],
  },
  {
    version: '1.1 to 1.2.3',
    notes: ['Store compliance updates (F-Droid, Google Play), no functional changes.'],
  },
  {
    version: '1.0',
    notes: ['First version of {app}.'],
  },
]

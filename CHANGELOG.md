# Changelog — Rowtine

All notable changes to the app. Date format: YYYY-MM-DD.

## [1.3.1]

- HEIC/HEIF photo support (requires Android 9 / API 28 or higher).
- Yarn stash menu: UX improvements.

## [1.3.0]

- Stats tab on every project: total time, sessions, skeins used, timespan,
  longest daily streak, and a calendar view.
- Share button: compose a badge of your project (photo, numbers, colors,
  four layouts, free text, choice of language) and send it anywhere.
- Share a project photo from the gallery.
- Yarn stash: the price field now accepts a comma.
- Removed the unused READ_MEDIA_IMAGES permission (the photo picker doesn't
  need it).

## [1.2.2]

- No code change — adds the Fastlane store listing (description,
  screenshots) requested during F-Droid review.

## [1.2.1]

- No code change from 1.2 — switches to a 3-part version scheme (required
  for F-Droid reproducible-build verification).

## [1.2]

- Build: excluded the dependency metadata block from the release APK/AAB.
  No functional change — required for F-Droid inclusion, whose scanner
  rejects it.

## [1.1]

- Build: removed an unused Google Play Services reference from the Android
  build configuration. No functional change — the app has never used any
  Google service.

## [1.0]

First public release.

- Knitting and crochet project tracking: row and stitch counters,
  timed sessions.
- Pattern library: PDF import, step-by-step reader, charts.
- Yarn stash, purchases, and per-project cost.
- Stats and activity log.
- Offline, local data; backup to a folder of your choice.
- French, English, Spanish, and German interface.

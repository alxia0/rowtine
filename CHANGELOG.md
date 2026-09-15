# Changelog — Rowtine

All notable changes to the app. Date format: YYYY-MM-DD.

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

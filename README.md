# Rowtine

**Your yarn, patterns in your size, your projects. Free and fully offline.**

Rowtine is a knitting and crochet companion for Android. It brings together what is
scattered today: the yarn asleep in your cupboard, the PDF pattern you can never find at
the right moment, the paper row counter that goes missing, the project notebook nobody
opens any more. All in one place, on your phone.

## What Rowtine does

- **Follow every project** from cast-on to finished piece, with a timer that never forgets
  where you left off.
- **Import a PDF pattern**: the app rebuilds the sections, rows and sizes on its own — no
  connection, nothing ever leaves your phone. It reads patterns in English, French, German
  and Spanish.
- **Read your pattern with a size selector**: every number is filtered down to yours. No
  more decoding size tables line after line.
- **Follow a chart row by row**, with a movable marker so you never lose your stitch
  mid-row, and an abbreviations sheet always within reach. On a tablet, keep the chart
  beside the text.
- **Manage your yarn stash**: what is reserved for a project, what is free, with a warning
  when there isn't enough left to finish — including multicoloured yarns (gradient,
  self-striping, speckled, hand-dyed).
- **Keep an eye on your budget**: every yarn purchase is recorded, and gifts never count
  towards it.
- **Find the right needle or hook size** from your yarn's ball band and the gauge your
  pattern asks for.
- **Standalone tools**: an increase and decrease distribution calculator, and a
  free-standing counter.
- **Your units and your currency**: metric or imperial, five currencies to choose from.
- **Four languages**: English, French, German and Spanish — interface, guide and pattern
  import alike.

## What Rowtine stands for

Rowtine is free and will stay free: no essential feature locked behind a paywall. It works
offline and keeps your data on your phone — no account to create, no data collection, no
server hoovering up your projects. You, and only you, choose a continuous backup folder if
you want one.

And because we all slip up, in knitting as in crochet: nothing is ever lost by accident.
Every deletion can be undone, and goes through a bin anyway.

## Stack

Vue 3 + Vite · Pinia · Vue Router · vue-i18n · Dexie (IndexedDB) · Capacitor 8 (Android).

## Develop

```bash
yarn install
yarn dev        # browser, hot reload
yarn build      # web build -> dist/
yarn preview    # preview the build
yarn test       # unit suite (Vitest)
yarn test:e2e   # end to end (Playwright)
```

## Build the APK

Requires JDK 21.

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
yarn build && yarn cap sync android
cd android && ./gradlew assembleDebug -Dorg.gradle.java.home="$JAVA_HOME"
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## License

Rowtine is licensed under the **Apache License, Version 2.0** — see [LICENSE](LICENSE) and
[NOTICE](NOTICE).

You are free to use, modify and redistribute the code, including in a commercial product,
as long as you keep the copyright notices and state your changes.

### The name and the logo are **not** covered by the licence

**Rowtine** and the Rowtine hedgehog logo are trade names of the copyright holder.
[Section 6 of the Apache License](https://www.apache.org/licenses/LICENSE-2.0#trademarks)
grants no permission to use them.

In plain words: **take the code, but ship it under your own name and your own icon.** This
is the same arrangement as Firefox, Signal and VLC. Its only purpose is to make sure that
what is called "Rowtine" on a store page is the app maintained here.

### Contributions

Contributions are welcome. As stated in section 5 of the licence, anything you submit for
inclusion is submitted under the Apache License 2.0, with no separate paperwork.

## Contact

- Bugs, ideas, questions → [issues](https://github.com/alxia0/rowtine/issues)
- Anything else → rowtine-fdroid.stash285@silomails.com

---

Copyright 2026 Alexia O.

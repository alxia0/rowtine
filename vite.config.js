import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Cible par défaut de Vite (ESM moderne) laisse passer `&&=`/`??=`/`||=`
    // (ES2021) tels quels : le WebView système Android ne se met à jour que
    // via Play Store, donc reste figé à sa version d'origine sur un appareil
    // qui ne l'a pas (F-Droid). Constaté : `Uncaught SyntaxError` au chargement
    // sur WebView 66 (Chromium, Android 9 AOSP) — l'app ne monte jamais.
    // `chrome58` retranspile tout l'ES2021+ (dépendances incluses) avec une
    // marge sous ce cas reproduit ; `minSdkVersion` (android/variables.gradle)
    // vaut 24 (Android 7.0) mais aucun test n'a été fait en dessous d'API 28.
    target: 'chrome58',
  },
})

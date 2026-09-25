import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Plugin pour traiter @capacitor/status-bar comme optionnel en test
const capStatusBarPlugin = {
  name: 'capacitor-status-bar-optional',
  resolveId(id) {
    if (id === '@capacitor/status-bar') {
      return { id, external: true }
    }
  },
}

// Config Vitest dédiée (sans vite-plugin-vue-devtools, inutile/bruyant en test).
// Environnement `node` par défaut : démarrer jsdom coûtait trois fois le temps des tests
// eux-mêmes. jsdom seulement pour les specs qui le déclarent en première ligne
// (`// @vitest-environment jsdom`) : celles qui montent un composant (@vue/test-utils),
// celles qui importent, même indirectement, un module dont le comportement dépend de
// l'environnement (`typeof window`, `typeof document`, matchMedia, navigator...), et celles
// qui touchent au DOM. Vitest 4 n'a plus `environmentMatchGlobs`, d'où le docblock.
// fake-indexeddb (setup.js) sert les stores Dexie dans les deux environnements.
export default defineConfig({
  plugins: [vue(), capStatusBarPlugin],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/unit/setup.js'],
    include: ['tests/unit/**/*.spec.js'],
    css: false,
    // Défaut Vitest = 5000ms. Plusieurs tests attendent une cascade Dexie/fake-indexeddb
    // réelle (via vi.waitFor) : sous la contention de la suite complète (197 fichiers en
    // parallèle), ce budget est parfois dépassé alors que le comportement testé est correct
    // (juste plus lent) → faux rouge intermittent « Test timed out in 5000ms », indépendant
    // du timeout interne passé à chaque vi.waitFor. Relevé pour donner une marge réaliste ;
    // les vi.waitFor eux-mêmes gardent un timeout explicite (10000ms) plus court que ce
    // plafond, pour qu'un VRAI blocage (condition qui ne devient jamais vraie) échoue avec
    // un message clair (AssertionError ciblée) plutôt qu'un timeout générique.
    testTimeout: 20000,
    hookTimeout: 20000,
    // PAS de `retry` ici, volontairement. Un `retry: 2` a été essayé le 17/07 pour absorber
    // les pics de latence de cette machine : écarté après mesure, la suite complète étant
    // verte sans lui une fois les timeouts ci-dessus relevés. Rejouer un test rouge jusqu'à
    // ce qu'il passe rendrait vert un test défaillant 2 fois sur 3 — or les bugs de course
    // (IndexedDB asynchrone, ordre des nextTick) échouent justement de façon INTERMITTENTE,
    // pas 3 fois sur 3. C'est exactement la classe de défaut qu'on veut voir sur ce projet.
    // Si la suite redevient instable, c'est un signal à instruire, pas à faire taire.
  },
})

import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfig([
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,js,mjs,jsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', '**/android/**']),

  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Fichiers de config, tests E2E et outillage de banc : tournent sous Node (process,
  // Buffer, __dirname…), pas dans le navigateur. `tools/**` manquait à cette liste, ce qui
  // faisait sortir 53 faux « process is not defined » et gardait `yarn lint` rouge.
  {
    files: ['*.config.{js,mjs}', 'playwright.config.js', 'tests/**', 'scripts/**', 'tools/**'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],

  // Le projet écrit déjà les variables volontairement inutilisées avec un `_` en tête, et
  // se sert du reste d'une déstructuration pour RETIRER une clé d'un objet
  // (`const { id: _staleId, ...payload } = form`, YarnPurchases.vue) — un idiome où la
  // variable nommée n'a par construction pas vocation à servir. Sans ces deux options, la
  // convention ne vaut rien et le contrôle sort rouge sur du code correct.
  {
    name: 'app/unused-vars',
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,
])

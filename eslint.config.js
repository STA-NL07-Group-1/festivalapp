// ESLint flat config voor de hele monorepo.
// https://eslint.org/docs/latest/use/configure/configuration-files
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import security from 'eslint-plugin-security'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['**/dist', '**/dev-dist', '**/coverage', '**/node_modules']),

  // Algemene regels voor alle JS/TS
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended, security.configs.recommended],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Geeft bij TypeScript vooral vals alarm (elke obj[key]); invoer valideren we tegen api.yaml
      'security/detect-object-injection': 'off',
    },
  },

  // TypeScript (app en backend)
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
  },

  // De PWA (browser + React)
  {
    files: ['app/**/*.{ts,tsx}', 'portal/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      // dangerouslySetInnerHTML is de belangrijkste XSS-route in React
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Geen dangerouslySetInnerHTML: dit opent de deur voor XSS.',
        },
      ],
    },
  },

  // Node-code: backend en configbestanden
  {
    files: ['backend/**/*.{js,ts}', '*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Tests mogen losser getypeerd zijn
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
])

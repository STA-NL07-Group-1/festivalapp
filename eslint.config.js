// Gedeelde ESLint-configuratie voor de hele repo.
// app/ en portal/ = React in de browser, backend/ = Node.js. Alles in TypeScript of JavaScript.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['**/dist', '**/build', '**/coverage', '**/node_modules', '**/dev-dist']),

  // Basis voor alle code
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      // Security: geen code uitvoeren vanuit strings
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      // Veelgemaakte fouten
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // De app en het beheerportal (React, browser)
  {
    files: ['app/**/*.{js,jsx,ts,tsx}', 'portal/**/*.{js,jsx,ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      // Geen HTML direct in de pagina zetten: risico op XSS
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Gebruik geen innerHTML (XSS-risico); laat React de tekst renderen.' },
        { property: 'outerHTML', message: 'Gebruik geen outerHTML (XSS-risico).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is niet toegestaan (XSS-risico). Overleg met Gijs als het echt nodig is.',
        },
      ],
    },
  },

  // Backend en tooling (Node.js)
  {
    files: ['backend/**/*.{js,ts}', 'tests/**/*.{js,ts}', 'tools/**/*.{js,ts}', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
]);
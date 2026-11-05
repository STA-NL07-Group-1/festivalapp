// Gedeelde Vitest-configuratie. `npm test` in de hoofdmap draait alle projecten.
// Een project in app/, backend/ of portal/ met een eigen vitest.config.* wordt automatisch meegenomen.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Alle eigen code; tests en configuratie tellen niet mee
      include: ['tools/**/*.{js,ts}', 'app/src/**/*.{js,jsx,ts,tsx}', 'backend/src/**/*.{js,ts}', 'portal/src/**/*.{js,jsx,ts,tsx}'],
      exclude: ['**/*.test.*', '**/*.config.*'],
      reporter: ['text', 'html'],
      // Silver-eis van OpenSSF Best Practices: minimaal 80% statement coverage
      thresholds: { statements: 80 },
    },
    projects: [
      {
        test: {
          name: 'contract',
          include: ['tests/**/*.test.js'],
          environment: 'node',
        },
      },
      'app/vitest.config.*',
      'backend/vitest.config.*',
      'portal/vitest.config.*',
    ],
  },
});
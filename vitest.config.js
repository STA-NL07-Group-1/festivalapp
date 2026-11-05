// Gedeelde Vitest-configuratie. `npm test` in de hoofdmap draait alle projecten.
// Een project in app/, backend/ of portal/ met een eigen vitest.config.* wordt automatisch meegenomen.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
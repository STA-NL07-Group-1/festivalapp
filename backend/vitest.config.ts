import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Leest ../.env (o.a. TEST_DATABASE_URL). Zonder database worden de integratietests overgeslagen.
    env: loadEnv('test', '..', ''),
    testTimeout: 20_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})

import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: { name: 'app', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom' },
}));
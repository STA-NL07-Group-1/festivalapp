import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Beheerportal voor de organisatie — https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // In productie draait het portal op /beheer/ (zie deploy/Caddyfile)
  base: process.env.PORTAL_BASE ?? '/',
  server: { port: 5174 },
})

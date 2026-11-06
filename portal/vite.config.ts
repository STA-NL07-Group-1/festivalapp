import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Beheerportal voor de organisatie — https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    // Keep a deliberate renderer budget; large optional surfaces are loaded
    // through explicit React lazy boundaries instead of bundler heuristics.
    chunkSizeWarningLimit: 550,
  },
})

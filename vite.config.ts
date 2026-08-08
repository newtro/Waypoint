import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    // Keep a deliberate renderer budget so Vite reports real growth instead of
    // warning on the current 527 kB chat-first shell at its default 500 kB cut-off.
    chunkSizeWarningLimit: 550,
  },
})

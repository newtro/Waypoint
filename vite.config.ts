import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    // Enforce the renderer budget with real code splitting rather than hiding
    // growth behind a larger warning threshold.
    chunkSizeWarningLimit: 550,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "renderer-vendor",
              test: /node_modules/,
              maxSize: 500_000,
            },
          ],
        },
      },
    },
  },
})

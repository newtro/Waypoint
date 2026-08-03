import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['spikes/**/*.test.ts', 'electron/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.ts'] },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/server/**/*.test.ts', 'src/cli/**/*.test.ts', 'src/client/**/*.test.ts'],
  },
})

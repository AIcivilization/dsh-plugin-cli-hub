import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.{spec,test}.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});

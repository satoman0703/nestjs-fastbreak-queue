import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    env: { DATABASE_URL: 'postgresql://fastbreak:fastbreak@localhost:15432/fastbreak_test' },
    fileParallelism: false,
    include: ['**/*.e2e-spec.ts'],
  },
});

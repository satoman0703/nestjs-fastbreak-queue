import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    env: {
      DATABASE_URL: 'postgresql://fastbreak:fastbreak@localhost:15432/fastbreak_test',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '16379',
      // 開発用のキューと混ざらないよう、テストでは Redis のキー名の頭を変える
      BULL_PREFIX: 'test',
    },
    fileParallelism: false,
    include: ['**/*.spec.ts'],
  },
});

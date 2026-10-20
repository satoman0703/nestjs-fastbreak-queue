import { defineConfig } from 'vitest/config';

export default defineConfig({
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
    include: ['**/*.e2e-spec.ts'],
  },
});

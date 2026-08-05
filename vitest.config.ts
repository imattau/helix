import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors app/vite.config.ts's own `@helix` alias, so a root-level test can
      // import an app/src/backend file (e.g. test/backend/ipfsPersistence.test.ts)
      // without that file needing a different import style than its siblings just to
      // be testable from here too.
      '@helix': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    testTimeout: 30_000,
  },
});

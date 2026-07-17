import { defineConfig } from 'vitest/config';

// integration tests share one database; run files serially
export default defineConfig({
  test: { fileParallelism: false },
});

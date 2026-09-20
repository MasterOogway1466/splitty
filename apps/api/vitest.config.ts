import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // All test files share one Postgres database (test/setup.ts), so they
    // must not run concurrently — a truncate in one file would wipe state
    // a parallel file is mid-assertion on.
    fileParallelism: false,
  },
});

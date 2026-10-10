import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Database integration tests (`npm run test:db`). They talk to the Supabase project configured in `.env`,
// so they live in *.it.ts files that the regular `npm test` never picks up.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.it.ts"],
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

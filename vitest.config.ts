import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// The `server-only` guard (CS-5) ships a conditional export: the bundler picks
// the `react-server` condition (a no-op `empty.js`), but vitest resolves the
// `default` condition (`index.js`), which throws by design. Point vitest at the
// same `empty.js` so server-only modules are importable under test — the
// build-time client-import guard is unaffected (Turbopack still applies it).
// Resolve via the main entry (the `exports` map blocks "./package.json"), then
// swap to the sibling `empty.js` that ships in the same directory.
const serverOnlyEmpty = join(
  dirname(require.resolve("server-only")),
  "empty.js",
);

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "drizzle"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": serverOnlyEmpty,
    },
  },
});

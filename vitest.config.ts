import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^next-auth\/adapters$/,
        replacement: `${srcDir}/test/stubs/next-auth-adapters.ts`,
      },
      { find: /^~\//, replacement: `${srcDir}/` },
    ],
  },
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    server: {
      deps: {
        // `next` ships no "exports" map, so its extensionless subpaths
        // (next/server, next/headers) only resolve through a bundler. Run the
        // Auth.js packages through Vite's resolver instead of Node's.
        inline: ["next-auth", "@auth/core", "@auth/drizzle-adapter"],
      },
    },
    // PGlite boots a WASM Postgres on first use; give it room on cold start.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

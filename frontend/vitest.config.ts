import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Standalone Vitest config. It intentionally does NOT import vite.config.ts so it
// can be tuned for tests (jsdom + setup files) without disturbing the app build.
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror the app's `@` -> `src` alias so tests can import the same way.
    alias: {
      "@": srcDir,
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});

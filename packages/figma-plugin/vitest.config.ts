import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `protocol/browser/index.js` imports Ajv, and it resolves from this
      // package rather than from the protocol package when Vite loads it.
      "ajv/dist/2020.js": fileURLToPath(
        new URL("./node_modules/ajv/dist/2020.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

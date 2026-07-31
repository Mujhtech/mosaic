import { fileURLToPath } from "node:url";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __MOSAIC_BUILD_TIME__: JSON.stringify("1970-01-01T00:00:00.000Z"),
    __MOSAIC_COMMIT__: JSON.stringify("test"),
    __MOSAIC_VERSION__: JSON.stringify("0.0.0-test"),
  },
  resolve: {
    alias: {
      "ajv/dist/2020.js": fileURLToPath(
        new URL("./node_modules/ajv/dist/2020.js", import.meta.url)
      ),
    },
    dedupe: ["react", "react-dom"],
    tsconfigPaths: true,
  },
  plugins: [viteReact()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});

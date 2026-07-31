import viteReact from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "ajv/dist/2020.js": fileURLToPath(
        new URL("./node_modules/ajv/dist/2020.js", import.meta.url),
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
})

import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { execSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const require = createRequire(import.meta.url)
const { version } = require("./package.json") as { version: string }

function readCommit() {
  // MOSAIC_COMMIT is supplied by the container build, where .git is absent.
  if (process.env.MOSAIC_COMMIT) return process.env.MOSAIC_COMMIT
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return "unknown"
  }
}

// SOURCE_DATE_EPOCH keeps the stamp reproducible for deterministic builds.
const buildTime = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString()

export default defineConfig({
  build: {
    // Studio's editor workspace is legitimately large. The limit is set
    // deliberately so the warning still fires on a genuine regression.
    chunkSizeWarningLimit: 750,
    // Source maps are not shipped: they would publish Mosaic's client source
    // to every visitor, and Mosaic sends no client error reports anywhere.
    sourcemap: false,
  },
  define: {
    __MOSAIC_BUILD_TIME__: JSON.stringify(buildTime),
    __MOSAIC_COMMIT__: JSON.stringify(readCommit()),
    __MOSAIC_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "ajv/dist/2020.js": fileURLToPath(
        new URL("./node_modules/ajv/dist/2020.js", import.meta.url),
      ),
    },
    dedupe: ["react", "react-dom"],
    tsconfigPaths: true,
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})

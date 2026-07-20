import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
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

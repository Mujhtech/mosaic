import eslint from "@eslint/js"
import pluginQuery from "@tanstack/eslint-plugin-query"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["dist/**", ".output/**", "coverage/**", "src/routeTree.gen.ts"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginQuery.configs["flat/recommended"],
  reactHooks.configs.flat.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      sourceType: "module",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      sourceType: "module",
    },
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactRefresh.configs.vite.rules,
    },
  },
  {
    files: ["src/routes/**/*.tsx"],
    rules: {
      // File-route modules must export TanStack's generated Route constant.
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["src/features/paywall-editor/stores/editor-store-context.tsx"],
    rules: {
      // This feature context intentionally colocates its provider and typed hooks.
      "react-refresh/only-export-components": "off",
    },
  },
)

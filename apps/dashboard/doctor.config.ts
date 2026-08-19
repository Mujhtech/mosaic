/**
 * React Doctor configuration.
 *
 * Suppressions live here rather than as inline comments wherever Biome already
 * owns an inline suppression on the same line: both tools require their
 * comment to sit immediately above the code, and only one can.
 */
export default {
  rules: {
    /**
     * The dashboard is an authenticated, client-rendered TanStack Start SPA.
     * There are no server actions in this stack and no surface is expected to
     * work without JavaScript, so `<form action={serverAction}>` — the fix this
     * rule asks for — is not available. Every flagged form submits through
     * TanStack Query or TanStack Form.
     */
    "react-doctor/no-prevent-default": "off",
  },
  ignore: {
    /**
     * Generated output, excluded exactly as biome.jsonc excludes it: findings
     * here are actionable against the generators, not this repository.
     */
    files: ["src/generated/**", "src/routeTree.gen.ts"],
    overrides: [
      {
        /**
         * Direct-manipulation canvas surfaces. Both carry a Biome suppression
         * explaining why they cannot be buttons: each contains the paywall's
         * own interactive controls, so an interactive role would nest
         * interactive content and hide the children from assistive
         * technology. Both already handle Enter/Space, and selection is also
         * reachable from the Layers tree.
         */
        files: [
          "src/features/paywall-editor/components/canvas-preview-device.tsx",
          "src/features/paywall-editor/components/canvas-preview-node-primitives.tsx",
        ],
        rules: ["react-doctor/no-noninteractive-element-interactions"],
      },
      {
        /**
         * The Figma bundle upload loop is deliberately sequential so a
         * twenty-image bundle does not open twenty concurrent uploads, and so
         * per-image progress reporting stays ordered.
         */
        files: ["src/features/paywall-editor/hooks/use-figma-bundle-import.ts"],
        rules: ["react-doctor/async-await-in-loop"],
      },
    ],
  },
};

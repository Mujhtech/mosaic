/**
 * Builds the two artefacts a Figma plugin loads: the main-thread bundle and a
 * single self-contained HTML file for the UI.
 *
 * The UI must be one file -- Figma serves it as a data document with no
 * origin to fetch siblings from -- so the compiled UI script is inlined into
 * the template at build time.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(packageRoot, "build");
const uiTemplatePath = join(packageRoot, "src", "ui", "ui.html");
const scriptPlaceholder = "/* MOSAIC_UI_SCRIPT */";

const watch = process.argv.includes("--watch");

/**
 * The Figma plugin sandbox is not a browser: no modules, no `eval`. An IIFE
 * targeting ES2020 is what it accepts.
 */
const shared = {
  bundle: true,
  format: "iife",
  target: "es2020",
  logLevel: "info",
  legalComments: "none",
};

const mainOptions = {
  ...shared,
  entryPoints: [join(packageRoot, "src", "main.ts")],
  outfile: join(outDir, "main.js"),
  minify: !watch,
};

const uiOptions = {
  ...shared,
  entryPoints: [join(packageRoot, "src", "ui", "ui.ts")],
  outfile: join(outDir, "ui.js"),
  write: false,
  minify: !watch,
};

async function writeUiHtml(compiledScript) {
  const template = await readFile(uiTemplatePath, "utf8");
  if (!template.includes(scriptPlaceholder)) {
    throw new Error(
      `src/ui/ui.html no longer contains ${scriptPlaceholder}; the UI bundle has nowhere to go.`,
    );
  }
  // `$` sequences in the bundle would be read as replacement patterns.
  const html = template.replace(scriptPlaceholder, () => compiledScript);
  await writeFile(join(outDir, "ui.html"), html, "utf8");
}

async function buildUi() {
  const result = await build(uiOptions);
  const [file] = result.outputFiles ?? [];
  if (!file) throw new Error("esbuild produced no UI bundle.");
  await writeUiHtml(file.text);
}

await mkdir(outDir, { recursive: true });

if (watch) {
  const mainContext = await context(mainOptions);
  await mainContext.watch();
  const uiContext = await context({
    ...uiOptions,
    plugins: [
      {
        name: "mosaic-inline-ui",
        setup(pluginBuild) {
          pluginBuild.onEnd(async (result) => {
            const [file] = result.outputFiles ?? [];
            if (file) await writeUiHtml(file.text);
          });
        },
      },
    ],
  });
  await uiContext.watch();
  console.log("Watching packages/figma-plugin. Reload the plugin in Figma to pick up a rebuild.");
} else {
  await build(mainOptions);
  await buildUi();
  console.log("Built build/main.js and build/ui.html.");
}

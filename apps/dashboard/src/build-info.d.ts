/**
 * Build identity stamped by Vite `define` (see vite.config.ts). These make the
 * running bundle self-identifying, which is what a deployment diagnosis needs
 * when several dashboard versions may be in circulation.
 */
declare const __MOSAIC_VERSION__: string;
declare const __MOSAIC_COMMIT__: string;
declare const __MOSAIC_BUILD_TIME__: string;

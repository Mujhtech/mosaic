import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    disconnect() {
      /* stub for a browser API jsdom does not implement */
    }
    observe() {
      /* stub for a browser API jsdom does not implement */
    }
    unobserve() {
      /* stub for a browser API jsdom does not implement */
    }
  };
}

afterEach(cleanup);

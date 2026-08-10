/**
 * Generates `fixtures/v0.4/motion-frames.json` from the reference resolver.
 *
 * Motion is the first thing in the protocol whose contract is a value at an
 * instant rather than a value. Prose cannot pin that and three renderers will
 * not agree by coincidence, so the contract ships vectors: for every trigger,
 * effect, and easing preset, the exact frame a renderer must be showing at
 * t = 0, a quarter, a half, three quarters, and the end -- plus the
 * reduced-motion answer for each, and the per-cycle phases of the pulse.
 *
 * Written by `resolveV04MotionFrame` and reconciled against it by
 * `validateMotionFrameVectors()` in `npm run validate`, so the tool and the
 * fixture cannot drift: a hand edit to either fails the gate.
 *
 * Run via `npm run generate`.
 */
import { writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  protocolV04Paths,
  protocolV04Root,
  resolveV04MotionFrame,
  V04_EASING_CONTROL_POINTS,
} from "./validation-v0.4.mjs";

const easings = Object.keys(V04_EASING_CONTROL_POINTS);

const curve = (durationMilliseconds, easing) => ({
  type: "motion",
  durationMilliseconds,
  easing,
});

/** t = 0, a quarter, a half, three quarters, and the end of a span. */
function quarters(totalMilliseconds) {
  return [0, 1, 2, 3, 4].map((step) =>
    Math.round((totalMilliseconds * step) / 4),
  );
}

/**
 * The Default and Selected styles a selection frame interpolates between.
 *
 * Deliberately mixed: an opaque literal background pair that interpolates, a
 * semantic border colour that cannot and therefore switches at the half-way
 * point, numeric corner radius and opacity that always interpolate, a padding
 * change that is structural, and a shadow present on both sides.
 */
const SELECTION_FROM = Object.freeze({
  background: { type: "color", value: "#101018FF" },
  border: { color: "border.default", width: 1 },
  cornerRadius: 12,
  padding: { top: 12, start: 12, bottom: 12, end: 12 },
  opacity: 0.8,
  shadow: {
    type: "shadow",
    color: "#00000033",
    offsetX: 0,
    offsetY: 4,
    blurRadius: 12,
  },
});

const SELECTION_TO = Object.freeze({
  background: { type: "color", value: "#007F73FF" },
  border: { color: "action.primary", width: 3 },
  cornerRadius: 20,
  padding: { top: 16, start: 16, bottom: 16, end: 16 },
  opacity: 1,
  shadow: {
    type: "shadow",
    color: "#000000AA",
    offsetX: 0,
    offsetY: 12,
    blurRadius: 28,
  },
});

function framesFor(motion, options) {
  return options.elapsed.map((elapsedMilliseconds) => ({
    elapsedMilliseconds,
    frame: resolveV04MotionFrame(motion, {
      trigger: options.trigger,
      elapsedMilliseconds,
      reducedMotion: options.reducedMotion,
      resolvedFrom: options.resolvedFrom,
      resolvedTo: options.resolvedTo,
    }),
  }));
}

export function buildMotionFrameVectors() {
  const cases = [];

  // Appear: both effects, every easing, two representative durations, and the
  // reduced-motion answer for each effect.
  for (const durationMilliseconds of [160, 240]) {
    for (const easing of easings) {
      for (const reducedMotion of [false, true]) {
        if (reducedMotion && durationMilliseconds !== 240) continue;
        for (const effect of ["fade", "fadeRise"]) {
          const motion =
            effect === "fade"
              ? {
                  effect,
                  curve: curve(durationMilliseconds, easing),
                  delayMilliseconds: 0,
                }
              : {
                  effect,
                  riseLogicalSize: 12,
                  curve: curve(durationMilliseconds, easing),
                  delayMilliseconds: 0,
                };
          cases.push({
            id: `appear-${effect}-${easing}-${durationMilliseconds}${reducedMotion ? "-reduced" : ""}`,
            note: reducedMotion
              ? "reduced motion keeps the opacity change and drops the transform"
              : `${effect} over ${durationMilliseconds}ms`,
            trigger: "appear",
            reducedMotion,
            motion,
            frames: framesFor(motion, {
              trigger: "appear",
              reducedMotion,
              elapsed: quarters(durationMilliseconds),
            }),
          });
        }
      }
    }
  }

  // An authored delay: the node holds its start frame, then runs its full
  // course. Stagger is authored delays and nothing else in 0.4.
  {
    const motion = {
      effect: "fadeRise",
      riseLogicalSize: 12,
      curve: curve(240, "decelerate"),
      delayMilliseconds: 80,
    };
    cases.push({
      id: "appear-fadeRise-decelerate-delayed",
      note: "an authored stagger delay holds the start frame before the effect runs",
      trigger: "appear",
      reducedMotion: false,
      motion,
      frames: framesFor(motion, {
        trigger: "appear",
        reducedMotion: false,
        elapsed: [0, 80, 140, 200, 320],
      }),
    });
  }

  // Selection: every easing, plus the reduced-motion instant answer.
  for (const easing of easings) {
    for (const reducedMotion of [false, true]) {
      const motion = { curve: curve(160, easing) };
      cases.push({
        id: `selection-${easing}${reducedMotion ? "-reduced" : ""}`,
        note: reducedMotion
          ? "reduced motion applies the selected style instantly"
          : "interpolable fields interpolate; structural fields switch at the half-way point",
        trigger: "selection",
        reducedMotion,
        motion,
        resolvedFrom: structuredClone(SELECTION_FROM),
        resolvedTo: structuredClone(SELECTION_TO),
        frames: framesFor(motion, {
          trigger: "selection",
          reducedMotion,
          resolvedFrom: SELECTION_FROM,
          resolvedTo: SELECTION_TO,
          elapsed: quarters(160),
        }),
      });
    }
  }

  // Loop: every easing across the whole bounded run, the per-cycle phases, and
  // the reduced-motion rest state.
  for (const easing of easings) {
    const motion = {
      effect: "pulse",
      scaleAmplitude: 0.04,
      opacityAmplitude: 0.12,
      curve: curve(900, easing),
      repeat: { count: 3 },
    };
    cases.push({
      id: `loop-pulse-${easing}-run`,
      note: "the whole bounded run: three cycles, then permanent rest",
      trigger: "loop",
      reducedMotion: false,
      motion,
      frames: framesFor(motion, {
        trigger: "loop",
        reducedMotion: false,
        elapsed: quarters(2700),
      }),
    });
    cases.push({
      id: `loop-pulse-${easing}-phases`,
      note: "one cycle at quarter phases: the excursion peaks at the half and returns to rest at both ends",
      trigger: "loop",
      reducedMotion: false,
      motion,
      frames: framesFor(motion, {
        trigger: "loop",
        reducedMotion: false,
        elapsed: [0, 225, 450, 675, 900, 2700],
      }),
    });
    cases.push({
      id: `loop-pulse-${easing}-reduced`,
      note: "reduced motion never leaves the rest state, which is the static rendering",
      trigger: "loop",
      reducedMotion: true,
      motion,
      frames: framesFor(motion, {
        trigger: "loop",
        reducedMotion: true,
        elapsed: [0, 225, 450, 675, 900],
      }),
    });
  }

  return {
    contract: "Paywall Protocol 0.4",
    description:
      "Conformance vectors for authored motion, generated by resolveV04MotionFrame in tools/validation-v0.4.mjs. For each trigger, effect, and easing preset, the exact frame a renderer must be showing at an exact elapsed time. A renderer conforms by reproducing every recorded number within toleranceAbsolute; continuous interpolation cannot be byte-pinned across three platform bezier solvers, and 1e-3 is two orders of magnitude below perceptibility. The last frame of every case is the terminal state, which equals the static rendering exactly -- that is the rule that makes the renderWithoutMotion fallback lossless. See docs/protocol/v0.4.md.",
    toleranceAbsolute: 0.001,
    easingControlPoints: V04_EASING_CONTROL_POINTS,
    cases,
  };
}

export function writeMotionFrameVectors() {
  const document = buildMotionFrameVectors();
  writeFileSync(
    protocolV04Paths.motionFrameVectors,
    `${JSON.stringify(document, null, 2)}\n`,
  );
  return document;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const document = writeMotionFrameVectors();
  const frames = document.cases.reduce(
    (total, entry) => total + entry.frames.length,
    0,
  );
  console.log(
    `Recorded ${document.cases.length} motion cases (${frames} frames) in ` +
      `${relative(dirname(dirname(fileURLToPath(import.meta.url))), protocolV04Paths.motionFrameVectors)}` +
      ` under ${relative(protocolV04Root, protocolV04Root) || "protocol"}.`,
  );
}

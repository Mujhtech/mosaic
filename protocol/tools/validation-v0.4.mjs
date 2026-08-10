import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addUniqueCapabilities,
  addUniqueFieldValues,
  createSchemaValidators,
  expectedV03DocumentCapabilities,
  formatSchemaErrors,
  validateAccessibilityAnnouncementVectors,
  validateAssetReferences,
  validateDesignSystem,
  validateIdentifiers,
  validateLayoutAndRuntime,
  validateLocalization,
  validateProductReferences,
  walkObjectValues,
  walkV03DocumentNodes,
} from "./validation-v0.3.mjs";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

export const protocolV04Root = resolve(toolsDirectory, "..");

export const protocolV04Paths = Object.freeze({
  canonicalFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/complete-paywall.json",
  ),
  edgeFixture: resolve(protocolV04Root, "fixtures/v0.4/edge-cases.json"),
  expiredCountdownFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/expired-countdown.json",
  ),
  hiddenPurchaseTargetFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/hidden-purchase-target.json",
  ),
  navigationOnlyFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/navigation-only.json",
  ),
  invalidFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/noncanonical-color.json",
  ),
  invalidExternalUrlFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/insecure-external-url.json",
  ),
  invalidInteractiveButtonChildFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/interactive-button-child.json",
  ),
  invalidNavigationCycleFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/navigation-cycle.json",
  ),
  invalidProductCardOwnershipFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/product-card-outside-selector.json",
  ),
  invalidProductCardDefaultFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/incomplete-product-card-default.json",
  ),
  invalidDuplicateProductReferenceFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/duplicate-product-reference.json",
  ),
  invalidInteractiveProductCardChildFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/interactive-product-card-child.json",
  ),
  invalidUnsafeProductTemplateFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/unsafe-product-template.json",
  ),
  invalidUnknownTabVisibilityFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/unknown-tab-visibility.json",
  ),
  invalidTimelineUnusedMarkerStyleFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/timeline-unused-marker-style.json",
  ),
  invalidSocialProofOverratedFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/social-proof-overrated.json",
  ),
  invalidNestedAppearFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/nested-appear-motion.json",
  ),
  invalidSecondScreenLoopFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/two-loops-on-one-screen.json",
  ),
  invalidLoopOutsideButtonFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/loop-motion-outside-button.json",
  ),
  invalidFastLoopMotionFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/loop-motion-below-flash-floor.json",
  ),
  invalidUnknownMotionTokenFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/unknown-motion-token.json",
  ),
  invalidUnusedMotionTokenFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/unused-motion-token.json",
  ),
  invalidRiseWithoutFadeRiseFixture: resolve(
    protocolV04Root,
    "fixtures/v0.4/invalid/rise-on-fade-appear.json",
  ),
  accessibilityAnnouncementVectors: resolve(
    protocolV04Root,
    "fixtures/v0.4/accessibility-announcement.json",
  ),
  motionFrameVectors: resolve(protocolV04Root, "fixtures/v0.4/motion-frames.json"),
  compatibilityManifest: resolve(protocolV04Root, "compatibility/v0.4.json"),
  compatibilityManifestSchema: resolve(
    protocolV04Root,
    "schema/v0.4/compatibility-manifest.schema.json",
  ),
  paywallSchema: resolve(protocolV04Root, "schema/v0.4/paywall.schema.json"),
});

export function readV04Json(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/**
 * The layout tree 0.4 walks is the tree 0.3 walks.
 *
 * 0.4 adds no container, no new child collection, and no new way for a node to
 * own another node -- motion is a property of a node, not a place one can hide.
 * Re-exporting rather than copying is what keeps that true: a future container
 * added to one walk cannot be missing from the other.
 */
export const walkV04DocumentNodes = walkV03DocumentNodes;

/**
 * Normative cubic-bezier control points for the four easing presets.
 *
 * Published here rather than described in prose because three renderers have to
 * produce the same curve: these values map exactly onto SwiftUI
 * `timingCurve(_:_:_:_:)`, Compose `CubicBezierEasing`, and Flutter `Cubic`.
 * Authored control points are excluded -- an out-of-range `y` fakes a spring,
 * and overshoot is precisely where the three platforms clamp opacity and scale
 * differently.
 */
export const V04_EASING_CONTROL_POINTS = Object.freeze({
  linear: Object.freeze([0, 0, 1, 1]),
  standard: Object.freeze([0.4, 0, 0.2, 1]),
  decelerate: Object.freeze([0, 0, 0.2, 1]),
  accelerate: Object.freeze([0.4, 0, 1, 1]),
});

/**
 * Emitted numbers carry four decimal places.
 *
 * Continuous interpolation cannot be byte-pinned across three platform bezier
 * solvers, so the contract discretizes instead: the resolver rounds, the
 * vectors record the rounded value, and renderers conform within the stated
 * 1e-3 tolerance -- two orders of magnitude below perceptibility.
 */
function round4(value) {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function cubicBezierY(controlPoints, x) {
  const [x1, y1, x2, y2] = controlPoints;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const axis = (a, b) => (t) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  const curveX = axis(x1, x2);
  const curveY = axis(y1, y2);
  const slopeX = (t) =>
    3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t ** 2 * (1 - x2);

  let parameter = x;
  for (let step = 0; step < 8; step += 1) {
    const error = curveX(parameter) - x;
    if (Math.abs(error) < 1e-12) return curveY(parameter);
    const derivative = slopeX(parameter);
    if (Math.abs(derivative) < 1e-9) break;
    parameter -= error / derivative;
  }
  let low = 0;
  let high = 1;
  parameter = x;
  for (let step = 0; step < 64; step += 1) {
    const value = curveX(parameter);
    if (Math.abs(value - x) < 1e-12) break;
    if (value > x) high = parameter;
    else low = parameter;
    parameter = (low + high) / 2;
  }
  return curveY(parameter);
}

/** Eased progress in 0...1 for a fraction of a curve's duration. */
export function v04EasedProgress(easing, fraction) {
  const controlPoints = V04_EASING_CONTROL_POINTS[easing];
  if (!controlPoints) {
    throw new TypeError(`Unknown Protocol 0.4 easing preset ${easing}.`);
  }
  return cubicBezierY(controlPoints, fraction);
}

/** Resolves a `motionToken` chain to its inline motion, or null. */
export function resolveV04MotionToken(document, motion) {
  const catalog = new Map(
    (document.designSystem?.motions ?? []).map((token) => [token.id, token.value]),
  );
  let current = motion;
  const seen = new Set();
  while (current?.type === "motionToken") {
    if (seen.has(current.id) || !catalog.has(current.id)) return null;
    seen.add(current.id);
    current = catalog.get(current.id);
  }
  return current ? structuredClone(current) : null;
}

const LITERAL_COLOR = /^#[0-9A-F]{8}$/;

/**
 * A colour interpolates only when both endpoints are canonical literals.
 *
 * A semantic name resolves against the renderer's theme and a `colorToken`
 * resolves against the document, and neither has a numeric value the protocol
 * can average. Rather than invent one, the change applies discretely at the
 * half-way point -- the same rule a background *kind* change and a padding
 * change follow, and for the same reason.
 */
function interpolateColor(from, to, progress) {
  if (JSON.stringify(from) === JSON.stringify(to)) return structuredClone(to);
  if (typeof from !== "string" || typeof to !== "string") {
    return structuredClone(progress < 0.5 ? from : to);
  }
  if (!LITERAL_COLOR.test(from) || !LITERAL_COLOR.test(to)) {
    return progress < 0.5 ? from : to;
  }
  let mixed = "#";
  for (let offset = 1; offset < 9; offset += 2) {
    const start = Number.parseInt(from.slice(offset, offset + 2), 16);
    const end = Number.parseInt(to.slice(offset, offset + 2), 16);
    const channel = Math.round(start + (end - start) * progress);
    mixed += channel.toString(16).toUpperCase().padStart(2, "0");
  }
  return mixed;
}

function interpolateNumber(from, to, progress) {
  return round4(from + (to - from) * progress);
}

function interpolateBackground(from, to, progress) {
  if (from?.type === "color" && to?.type === "color") {
    return { type: "color", value: interpolateColor(from.value, to.value, progress) };
  }
  return structuredClone(progress < 0.5 ? from : to);
}

function interpolateShadow(from, to, progress) {
  if (from?.type === "shadow" && to?.type === "shadow") {
    return {
      type: "shadow",
      color: interpolateColor(from.color, to.color, progress),
      offsetX: interpolateNumber(from.offsetX, to.offsetX, progress),
      offsetY: interpolateNumber(from.offsetY, to.offsetY, progress),
      blurRadius: interpolateNumber(from.blurRadius, to.blurRadius, progress),
    };
  }
  return structuredClone(progress < 0.5 ? from : to);
}

function interpolateSelectionStyle(from, to, progress) {
  const style = {
    background: interpolateBackground(from.background, to.background, progress),
    border: {
      color: interpolateColor(from.border.color, to.border.color, progress),
      width: interpolateNumber(from.border.width, to.border.width, progress),
    },
    cornerRadius: interpolateNumber(from.cornerRadius, to.cornerRadius, progress),
    // Padding changes the box the renderer is laying out, not the paint it is
    // applying. Interpolating it would relayout the subtree on every frame on
    // three layout engines that disagree about when that is legal.
    padding: structuredClone(progress < 0.5 ? from.padding : to.padding),
    opacity: interpolateNumber(from.opacity, to.opacity, progress),
  };
  if (from.shadow !== undefined || to.shadow !== undefined) {
    style.shadow = interpolateShadow(from.shadow, to.shadow, progress);
  }
  return style;
}

function requireResolvedCurve(motion) {
  const curve = motion?.curve;
  if (curve?.type !== "motion") {
    throw new TypeError(
      "Motion frame resolution requires an inline curve; resolve motionToken references against the document first.",
    );
  }
  return curve;
}

function requireEndpoints(trigger, resolvedFrom, resolvedTo) {
  const supplied = resolvedFrom !== undefined || resolvedTo !== undefined;
  if (trigger === "selection") {
    if (!resolvedFrom || !resolvedTo) {
      throw new TypeError(
        "A selection frame requires resolvedFrom and resolvedTo styles.",
      );
    }
    return;
  }
  if (supplied) {
    throw new TypeError(
      `A ${trigger} frame does not interpolate between two styles; resolvedFrom and resolvedTo must be omitted.`,
    );
  }
}

/**
 * The frame a renderer must be showing at an exact elapsed time.
 *
 * Pure and integer-in, following the `resolveV03CountdownState` precedent: a
 * clock that cannot be trusted throws rather than resolving, because arithmetic
 * on a bad clock yields a frame that reads back as plausible.
 *
 * Two rules hold in every branch and are what make the `renderWithoutMotion`
 * tier lossless:
 *
 *   - **Terminal state.** Once the motion has run its authored course, the
 *     output equals the static rendering exactly. It is short-circuited rather
 *     than approached, so no rounding can leave a price at 0.9999 opacity.
 *   - **Reduced motion.** `appear` keeps its opacity change and drops the
 *     transform, `selection` applies instantly, and `loop` never leaves rest.
 *     The contract owns *what* changes; the platform owns *how long*.
 */
export function resolveV04MotionFrame(
  motion,
  { trigger, elapsedMilliseconds, reducedMotion = false, resolvedFrom, resolvedTo } = {},
) {
  if (!Number.isInteger(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw new TypeError(
      "Motion frame resolution requires a whole, non-negative elapsed time in milliseconds.",
    );
  }
  if (typeof reducedMotion !== "boolean") {
    throw new TypeError(
      "Motion frame resolution requires an explicit reduced-motion signal.",
    );
  }
  if (trigger !== "appear" && trigger !== "selection" && trigger !== "loop") {
    throw new TypeError(`Unknown Protocol 0.4 motion trigger ${trigger}.`);
  }
  requireEndpoints(trigger, resolvedFrom, resolvedTo);
  const curve = requireResolvedCurve(motion);

  if (trigger === "appear") {
    if (motion.effect !== "fade" && motion.effect !== "fadeRise") {
      throw new TypeError(`Unknown Protocol 0.4 appear effect ${motion.effect}.`);
    }
    const rise = motion.effect === "fadeRise" ? motion.riseLogicalSize : 0;
    const start = motion.delayMilliseconds;
    const end = start + curve.durationMilliseconds;
    if (elapsedMilliseconds >= end) {
      return {
        trigger,
        reducedMotion,
        complete: true,
        progress: 1,
        opacity: 1,
        translateLogicalSize: 0,
      };
    }
    if (elapsedMilliseconds <= start) {
      return {
        trigger,
        reducedMotion,
        complete: false,
        progress: 0,
        opacity: 0,
        translateLogicalSize: reducedMotion ? 0 : round4(rise),
      };
    }
    const fraction =
      (elapsedMilliseconds - start) / curve.durationMilliseconds;
    const progress = v04EasedProgress(curve.easing, fraction);
    return {
      trigger,
      reducedMotion,
      complete: false,
      progress: round4(progress),
      opacity: round4(progress),
      translateLogicalSize: reducedMotion ? 0 : round4(rise * (1 - progress)),
    };
  }

  if (trigger === "selection") {
    if (reducedMotion || elapsedMilliseconds >= curve.durationMilliseconds) {
      return {
        trigger,
        reducedMotion,
        complete: true,
        progress: 1,
        style: structuredClone(resolvedTo),
      };
    }
    const progress = v04EasedProgress(
      curve.easing,
      elapsedMilliseconds / curve.durationMilliseconds,
    );
    return {
      trigger,
      reducedMotion,
      complete: false,
      progress: round4(progress),
      style: interpolateSelectionStyle(resolvedFrom, resolvedTo, progress),
    };
  }

  if (motion.effect !== "pulse") {
    throw new TypeError(`Unknown Protocol 0.4 loop effect ${motion.effect}.`);
  }
  const cycleMilliseconds = curve.durationMilliseconds;
  const totalMilliseconds = cycleMilliseconds * motion.repeat.count;
  const atRest = {
    trigger,
    reducedMotion,
    complete: true,
    cycle: motion.repeat.count,
    cyclePhase: 0,
    excursion: 0,
    scale: 1,
    opacityMultiplier: 1,
  };
  if (reducedMotion) {
    return { ...atRest, cycle: 0 };
  }
  if (elapsedMilliseconds >= totalMilliseconds) return atRest;
  const cycle = Math.floor(elapsedMilliseconds / cycleMilliseconds);
  const cyclePhase =
    (elapsedMilliseconds - cycle * cycleMilliseconds) / cycleMilliseconds;
  // One pulse is out and back. The easing shapes each half, so the excursion is
  // 0 at both ends of every cycle -- which is what makes a cycle boundary and
  // the terminal frame the same static rendering rather than two near misses.
  const halfPhase = cyclePhase < 0.5 ? cyclePhase * 2 : (1 - cyclePhase) * 2;
  const excursion = v04EasedProgress(curve.easing, halfPhase);
  return {
    trigger,
    reducedMotion,
    complete: false,
    cycle,
    cyclePhase: round4(cyclePhase),
    excursion: round4(excursion),
    scale: round4(1 + motion.scaleAmplitude * excursion),
    opacityMultiplier: round4(1 - motion.opacityAmplitude * excursion),
  };
}

/**
 * The capabilities a 0.4 document requires.
 *
 * Expressed as a delta over the 0.3 derivation rather than as a second copy of
 * it, because "0.4 is 0.3 plus motion minus one co-derived capability" is the
 * whole compatibility claim and a copy would let the two answers drift while
 * each stayed internally consistent.
 */
export function expectedV04DocumentCapabilities(document) {
  const capabilities = new Set(expectedV03DocumentCapabilities(document));
  capabilities.delete("style.productCardStates");
  for (const { node } of walkV04DocumentNodes(document)) {
    if (node.motion?.appear) capabilities.add("motion.appear");
    if (node.motion?.selection) capabilities.add("motion.selection");
    if (node.motion?.loop) capabilities.add("motion.loop");
  }
  return capabilities;
}

export function orderedV04Capabilities(document, paywallSchema) {
  const expected = expectedV04DocumentCapabilities(document);
  return paywallSchema.$defs.capabilityName.enum
    .filter((name) => expected.has(name))
    .map((name) => ({ name, version: "0.4" }));
}

export const V04_MOTION_CAPABILITIES = Object.freeze([
  "motion.appear",
  "motion.selection",
  "motion.loop",
]);

/**
 * The flash-safety floor for a looping motion, in milliseconds.
 *
 * A 500 ms cycle caps the fundamental at 2 Hz and its perceived pulse rate at
 * 1 Hz, an order of magnitude under the three-per-second threshold WCAG 2.3.1
 * draws. Enforced in the schema's neighbour -- the semantic layer -- rather than
 * in prose, because the duration lives on a token and the constraint belongs to
 * the reference site.
 */
export const V04_LOOP_MINIMUM_DURATION_MILLISECONDS = 500;

function validateMotionCatalog(errors, document, entries) {
  const catalog = document.designSystem.motions;
  addUniqueFieldValues(errors, catalog, "id", "motion token catalog");
  addUniqueFieldValues(errors, catalog, "name", "motion token catalog");

  const declared = new Set(catalog.map((token) => token.id));
  const referenced = new Set();
  const roots = [document.designSystem, ...entries.map(({ node }) => node)];
  for (const root of roots) {
    walkObjectValues(root, (value, path) => {
      if (value.type !== "motionToken") return;
      if (declared.has(value.id)) {
        referenced.add(value.id);
        return;
      }
      errors.push(`motionToken reference${path} targets unknown token ${value.id}`);
    });
  }

  const graph = new Map(catalog.map((token) => [token.id, new Set()]));
  for (const token of catalog) {
    walkObjectValues(token.value, (value) => {
      if (value.type === "motionToken") graph.get(token.id).add(value.id);
    });
  }
  const visiting = new Set();
  const settled = new Set();
  function hasCycle(id) {
    if (visiting.has(id)) return true;
    if (settled.has(id)) return false;
    visiting.add(id);
    for (const target of graph.get(id) ?? []) {
      if (graph.has(target) && hasCycle(target)) return true;
    }
    visiting.delete(id);
    settled.add(id);
    return false;
  }
  for (const id of graph.keys()) {
    if (hasCycle(id)) {
      errors.push("motionToken catalog contains a reference cycle");
      break;
    }
  }

  // Deliberately asymmetric with the colour, background, and shadow catalogs,
  // which carry no unused-token check. Those are inert values. A motion token
  // is a duration that flash safety is checked against at its *reference* site,
  // so a token nothing references has never been checked against anything and
  // survives a redesign looking approved. See docs/protocol/v0.4.md.
  for (const token of catalog) {
    if (referenced.has(token.id)) continue;
    // A token reached only by another token is used; an unreachable one is not.
    const reachable = [...referenced].some((id) => graph.get(id)?.has(token.id));
    if (reachable) continue;
    errors.push(`motion token catalog declares unused motion ${token.id}`);
  }
}

function validateMotionSemantics(errors, document, entries) {
  const loopsByScreen = new Map();
  for (const { node, screenId, ancestors } of entries) {
    const motion = node.motion;
    if (!motion) continue;

    if (motion.appear) {
      const animatedAncestor = ancestors.find((ancestor) => ancestor.motion?.appear);
      if (animatedAncestor) {
        // Two entrance opacities multiply, and the three renderers compose that
        // product at different points in their pipelines. Rejecting is cheaper
        // than pinning an arithmetic no platform agrees on.
        errors.push(
          `${node.type} ${node.id} declares appear motion inside ${animatedAncestor.type} ` +
            `${animatedAncestor.id}, which already declares one`,
        );
      }
    }

    if (!motion.loop) continue;
    loopsByScreen.set(screenId, [...(loopsByScreen.get(screenId) ?? []), node.id]);
    const resolved = resolveV04MotionToken(document, motion.loop.curve);
    if (!resolved) continue;
    if (resolved.durationMilliseconds >= V04_LOOP_MINIMUM_DURATION_MILLISECONDS) {
      continue;
    }
    errors.push(
      `button ${node.id} loop motion resolves to ${resolved.durationMilliseconds}ms, ` +
        `below the ${V04_LOOP_MINIMUM_DURATION_MILLISECONDS}ms flash-safety floor`,
    );
  }
  for (const [screenId, buttonIds] of loopsByScreen) {
    if (buttonIds.length <= 1) continue;
    errors.push(
      `screen ${screenId} declares loop motion on ${buttonIds.length} buttons ` +
        `(${buttonIds.join(", ")}); at most one is permitted`,
    );
  }
}

function validateCapabilities(
  errors,
  document,
  manifest,
  paywallSchema,
  manifestSchema,
) {
  const documentNames = new Set(paywallSchema.$defs.capabilityName.enum);
  const manifestNames = new Set(manifestSchema.$defs.capabilityName.enum);
  for (const name of documentNames) {
    if (!manifestNames.has(name)) {
      errors.push(`manifest schema omits paywall capability ${name}`);
    }
  }
  for (const name of manifestNames) {
    if (!documentNames.has(name)) {
      errors.push(`manifest schema declares unknown capability ${name}`);
    }
  }
  if (documentNames.has("style.productCardStates")) {
    errors.push(
      "0.4 must not carry style.productCardStates; 0.3 removed it as a co-derived signal",
    );
  }

  addUniqueCapabilities(
    errors,
    document.compatibility.requiredCapabilities,
    "document",
  );
  addUniqueCapabilities(errors, manifest.capabilities, "manifest");

  const expected = expectedV04DocumentCapabilities(document);
  const declared = new Map(
    document.compatibility.requiredCapabilities.map((entry) => [
      entry.name,
      entry.version,
    ]),
  );
  const supported = new Map(
    manifest.capabilities.map((entry) => [entry.name, entry.version]),
  );

  for (const name of expected) {
    if (declared.has(name)) continue;
    errors.push(`document is missing required capability ${name}`);
  }
  for (const [name, version] of declared) {
    if (!expected.has(name)) {
      errors.push(`document declares unused capability ${name}`);
    } else if (!supported.has(name)) {
      errors.push(`manifest does not support required capability ${name}`);
    } else if (supported.get(name) !== version) {
      errors.push(
        `manifest supports ${name}@${supported.get(name)}, ` +
          `but the document requires ${name}@${version}`,
      );
    }
  }
  for (const name of documentNames) {
    if (supported.has(name)) continue;
    errors.push(`manifest omits schema capability ${name}`);
  }
  errors.push(...v04ManifestFallbackTierErrors(manifest));
}

/**
 * The enhancement tier is exactly three capabilities wide, and stays that way.
 *
 * `renderWithoutMotion` is named for motion rather than named generically so it
 * cannot spread by imitation: server-side stripping of a capability a reader
 * does not understand is doctrine-forbidden, and one generic
 * `renderWithoutFeature` value would be an invitation to relitigate that per
 * feature. This asserts the partition rather than trusting review to notice it.
 */
export function v04ManifestFallbackTierErrors(manifest) {
  const errors = [];
  const motion = new Set(V04_MOTION_CAPABILITIES);
  for (const capability of manifest.capabilities) {
    const expected = motion.has(capability.name)
      ? "renderWithoutMotion"
      : "rejectDocument";
    if (capability.fallback === expected) continue;
    errors.push(
      `manifest declares ${capability.name} fallback ${capability.fallback}; ` +
        `${expected} is the only permitted value for it`,
    );
  }
  for (const name of motion) {
    if (manifest.capabilities.some((capability) => capability.name === name)) {
      continue;
    }
    errors.push(`manifest omits enhancement capability ${name}`);
  }
  return errors;
}

export function loadProtocolV04Artifacts() {
  return {
    document: readV04Json(protocolV04Paths.canonicalFixture),
    edgeDocument: readV04Json(protocolV04Paths.edgeFixture),
    expiredCountdownDocument: readV04Json(
      protocolV04Paths.expiredCountdownFixture,
    ),
    hiddenPurchaseTargetDocument: readV04Json(
      protocolV04Paths.hiddenPurchaseTargetFixture,
    ),
    navigationOnlyDocument: readV04Json(protocolV04Paths.navigationOnlyFixture),
    invalidDocument: readV04Json(protocolV04Paths.invalidFixture),
    invalidDocuments: [
      readV04Json(protocolV04Paths.invalidFixture),
      readV04Json(protocolV04Paths.invalidExternalUrlFixture),
      readV04Json(protocolV04Paths.invalidInteractiveButtonChildFixture),
      readV04Json(protocolV04Paths.invalidNavigationCycleFixture),
      readV04Json(protocolV04Paths.invalidProductCardOwnershipFixture),
      readV04Json(protocolV04Paths.invalidProductCardDefaultFixture),
      readV04Json(protocolV04Paths.invalidDuplicateProductReferenceFixture),
      readV04Json(protocolV04Paths.invalidInteractiveProductCardChildFixture),
      readV04Json(protocolV04Paths.invalidUnsafeProductTemplateFixture),
      readV04Json(protocolV04Paths.invalidUnknownTabVisibilityFixture),
      readV04Json(protocolV04Paths.invalidTimelineUnusedMarkerStyleFixture),
      readV04Json(protocolV04Paths.invalidSocialProofOverratedFixture),
      readV04Json(protocolV04Paths.invalidNestedAppearFixture),
      readV04Json(protocolV04Paths.invalidSecondScreenLoopFixture),
      readV04Json(protocolV04Paths.invalidLoopOutsideButtonFixture),
      readV04Json(protocolV04Paths.invalidFastLoopMotionFixture),
      readV04Json(protocolV04Paths.invalidUnknownMotionTokenFixture),
      readV04Json(protocolV04Paths.invalidUnusedMotionTokenFixture),
      readV04Json(protocolV04Paths.invalidRiseWithoutFadeRiseFixture),
    ],
    manifest: readV04Json(protocolV04Paths.compatibilityManifest),
    manifestSchema: readV04Json(protocolV04Paths.compatibilityManifestSchema),
    paywallSchema: readV04Json(protocolV04Paths.paywallSchema),
  };
}

export function validateProtocolV04({
  document,
  manifest,
  manifestSchema,
  paywallSchema,
}) {
  const validators = createSchemaValidators({ manifestSchema, paywallSchema });
  const errors = [];
  const documentIsValid = validators.paywall(document);
  const manifestIsValid = validators.manifest(manifest);
  if (!documentIsValid) {
    errors.push(...formatSchemaErrors("document", validators.paywall.errors));
  }
  if (!manifestIsValid) {
    errors.push(...formatSchemaErrors("manifest", validators.manifest.errors));
  }
  if (!documentIsValid || !manifestIsValid) return errors;

  if (document.schemaVersion !== manifest.schemaVersion) {
    errors.push(
      `document schema version ${document.schemaVersion} does not match ` +
        `manifest version ${manifest.schemaVersion}`,
    );
  }
  const entries = walkV04DocumentNodes(document);
  validateCapabilities(errors, document, manifest, paywallSchema, manifestSchema);
  validateIdentifiers(errors, document, entries);
  validateDesignSystem(errors, document, entries);
  validateMotionCatalog(errors, document, entries);
  validateAssetReferences(errors, document, entries);
  validateProductReferences(errors, document, entries);
  validateLocalization(errors, document, entries);
  validateLayoutAndRuntime(errors, document, entries);
  validateMotionSemantics(errors, document, entries);
  return errors;
}

/**
 * Coverage floors for what 0.4 adds.
 *
 * The 0.3 floors already hold through the ported corpus. These name only the
 * distinguishable motion cases: every trigger, both appear effects, the inline
 * and token curve forms, a token reached through another token, two screens
 * each carrying their own loop, and the negated Feature List marker the
 * bundled cleanup exists to make expressible.
 */
export function validateCanonicalV04Coverage(document) {
  const errors = [];
  const entries = walkV04DocumentNodes(document);
  const motions = entries
    .map(({ node }) => node.motion)
    .filter((motion) => motion !== undefined);

  for (const trigger of ["appear", "selection", "loop"]) {
    if (motions.some((motion) => motion[trigger])) continue;
    errors.push(`canonical fixture omits ${trigger} motion`);
  }
  const effects = new Set(
    motions.filter((motion) => motion.appear).map((motion) => motion.appear.effect),
  );
  for (const effect of ["fade", "fadeRise"]) {
    if (effects.has(effect)) continue;
    errors.push(`canonical fixture omits a ${effect} appear effect`);
  }
  const curveForms = new Set();
  walkObjectValues(document.screens, (value) => {
    if (value.type === "motion") curveForms.add("inline");
    if (value.type === "motionToken") curveForms.add("token");
  });
  for (const form of ["inline", "token"]) {
    if (curveForms.has(form)) continue;
    errors.push(`canonical fixture omits a ${form} motion curve`);
  }
  const motionCatalog = document.designSystem?.motions ?? [];
  if (motionCatalog.length === 0) {
    errors.push("canonical fixture omits the motion token catalog");
  }
  if (!motionCatalog.some((token) => token.value.type === "motionToken")) {
    errors.push("canonical fixture omits a motion token referencing another token");
  }
  const loopScreens = new Set(
    entries.filter(({ node }) => node.motion?.loop).map(({ screenId }) => screenId),
  );
  if (loopScreens.size < 2) {
    errors.push(
      "canonical fixture must place a loop on more than one screen; one loop per " +
        "screen and one loop per document are otherwise indistinguishable",
    );
  }
  const featureLists = entries
    .filter(({ node }) => node.type === "featureList")
    .map(({ node }) => node);
  if (!featureLists.some((node) => node.items.some((item) => item.marker))) {
    errors.push(
      "canonical fixture omits a Feature List item marker override; the negated " +
        "item is the reason the marker vocabulary was consolidated",
    );
  }
  return errors;
}

/**
 * Every renderer must reproduce these frames within the stated tolerance.
 *
 * The file is generated by `resolveV04MotionFrame` and reconciled against it
 * here, so a hand edit to either side fails the gate. The floor is the point:
 * a truncated corpus would otherwise report perfect conformance over nothing.
 */
export const MOTION_FRAME_CASE_FLOOR = 40;

export function validateMotionFrameVectors(
  vectors = readV04Json(protocolV04Paths.motionFrameVectors),
) {
  const errors = [];
  const cases = Array.isArray(vectors.cases) ? vectors.cases : [];
  if (cases.length < MOTION_FRAME_CASE_FLOOR) {
    errors.push(
      `motion-frames vectors hold ${cases.length} cases but the contract ` +
        `declares a floor of ${MOTION_FRAME_CASE_FLOOR}`,
    );
  }
  if (vectors.toleranceAbsolute !== 0.001) {
    errors.push("motion-frames vectors must pin toleranceAbsolute 0.001");
  }
  if (
    JSON.stringify(vectors.easingControlPoints) !==
    JSON.stringify(V04_EASING_CONTROL_POINTS)
  ) {
    errors.push(
      "motion-frames vectors record easing control points the resolver does not use",
    );
  }

  const seen = new Set();
  const triggers = new Set();
  const easings = new Set();
  const reduced = new Set();
  for (const entry of cases) {
    if (seen.has(entry.id)) {
      errors.push(`motion-frames vectors repeat case ${entry.id}`);
    }
    seen.add(entry.id);
    triggers.add(entry.trigger);
    easings.add(entry.motion.curve.easing);
    reduced.add(entry.reducedMotion);
    if (!Array.isArray(entry.frames) || entry.frames.length < 5) {
      errors.push(`motion-frames case ${entry.id} pins fewer than five frames`);
      continue;
    }
    for (const frame of entry.frames) {
      let expected;
      try {
        expected = resolveV04MotionFrame(entry.motion, {
          trigger: entry.trigger,
          elapsedMilliseconds: frame.elapsedMilliseconds,
          reducedMotion: entry.reducedMotion,
          resolvedFrom: entry.resolvedFrom,
          resolvedTo: entry.resolvedTo,
        });
      } catch (error) {
        errors.push(`motion-frames case ${entry.id}: ${error.message}`);
        break;
      }
      if (JSON.stringify(frame.frame) === JSON.stringify(expected)) continue;
      errors.push(
        `motion-frames case ${entry.id} frame at ${frame.elapsedMilliseconds}ms ` +
          "does not match the reference resolver",
      );
    }
    const terminal = entry.frames.at(-1);
    if (terminal.frame.complete !== true) {
      errors.push(
        `motion-frames case ${entry.id} never reaches its terminal state; the ` +
          "rule that makes renderWithoutMotion lossless is unexercised",
      );
    }
  }
  for (const trigger of ["appear", "selection", "loop"]) {
    if (triggers.has(trigger)) continue;
    errors.push(`motion-frames vectors omit the ${trigger} trigger`);
  }
  for (const easing of Object.keys(V04_EASING_CONTROL_POINTS)) {
    if (easings.has(easing)) continue;
    errors.push(`motion-frames vectors omit the ${easing} easing`);
  }
  if (!reduced.has(true) || !reduced.has(false)) {
    errors.push(
      "motion-frames vectors must exercise both sides of the reduced-motion signal",
    );
  }
  return errors;
}

/**
 * 0.4 does not change how a component is announced.
 *
 * The corpus travels with the canonical document because it names components by
 * id, but it is reconciled against the 0.3 reference implementation rather than
 * a 0.4 copy of it: two implementations of one unchanged contract is the drift
 * this repository has already been bitten by once.
 */
export function validateV04AccessibilityAnnouncementVectors() {
  return validateAccessibilityAnnouncementVectors(
    readV04Json(protocolV04Paths.accessibilityAnnouncementVectors),
    readV04Json(protocolV04Paths.canonicalFixture),
  );
}

export function validateV04JsonFormatting() {
  const errors = [];
  for (const filePath of Object.values(protocolV04Paths)) {
    const source = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(source);
    const formatted = `${JSON.stringify(parsed, null, 2)}\n`;
    if (source === formatted) continue;
    errors.push(`${relative(protocolV04Root, filePath)} is not canonical JSON`);
  }
  return errors;
}

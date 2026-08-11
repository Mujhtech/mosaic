import assert from "node:assert/strict";
import test from "node:test";

import {
  easedMotionProgress,
  motionCapabilitiesFor,
  motionEasingControlPoints,
  motionLoopMinimumDurationMilliseconds,
  parsePortablePaywallJson as parseBrowserPortablePaywallJson,
  paywallDocumentVersion as browserPaywallDocumentVersion,
  paywallContractVersions,
  paywallV04CapabilityNames,
  paywallV04ContractVersion,
  resolveMotionFrame as resolveBrowserMotionFrame,
  resolveMotionToken as resolveBrowserMotionToken,
  validatePaywallDocument as validateBrowserPaywallDocument,
} from "../browser/index.js";
import { rejectionLayerTargets } from "./generate-rejection-layers.mjs";
import { buildMotionFrameVectors } from "./generate-motion-frames-v0.4.mjs";
import {
  readV03Json,
  protocolV03Paths,
  walkObjectValues,
} from "./validation-v0.3.mjs";
import {
  expectedV04DocumentCapabilities,
  loadProtocolV04Artifacts,
  MOTION_FRAME_CASE_FLOOR,
  orderedV04Capabilities,
  protocolV04Paths,
  readV04Json,
  resolveV04MotionFrame,
  resolveV04MotionToken,
  V04_EASING_CONTROL_POINTS,
  V04_LOOP_MINIMUM_DURATION_MILLISECONDS,
  v04EasedProgress,
  v04ManifestFallbackTierErrors,
  validateCanonicalV04Coverage,
  validateMotionFrameVectors,
  validateProtocolV04,
  validateV04AccessibilityAnnouncementVectors,
  validateV04JsonFormatting,
  walkV04DocumentNodes,
} from "./validation-v0.4.mjs";

function artifacts() {
  return structuredClone(loadProtocolV04Artifacts());
}

function errors(input) {
  return validateProtocolV04(input);
}

function node(document, id) {
  const entry = walkV04DocumentNodes(document).find(
    ({ node: candidate }) => candidate.id === id,
  );
  assert.ok(entry, `expected node ${id}`);
  return entry.node;
}

function refreshCapabilities(input) {
  input.document.compatibility.requiredCapabilities = orderedV04Capabilities(
    input.document,
    input.paywallSchema,
  );
}

const entranceCurve = { type: "motionToken", id: "motion-entrance" };
const pulseCurve = { type: "motionToken", id: "motion-pulse" };

// ---------------------------------------------------------------------------
// The corpus.
// ---------------------------------------------------------------------------

test("the canonical 0.4 document and every ported document validate", () => {
  const input = artifacts();
  for (const document of [
    input.document,
    input.edgeDocument,
    input.expiredCountdownDocument,
    input.hiddenPurchaseTargetDocument,
    input.navigationOnlyDocument,
    input.screenRoundTripDocument,
  ]) {
    assert.deepEqual(errors({ ...input, document }), []);
  }
});

test("a canonical document pins the screen-to-screen half of the replay ruling", () => {
  // Renderers must be able to drive a genuine screen round trip -- navigateTo
  // then navigateBack between two screen-*presentation* screens -- and assert
  // that entrances and the pulse budget both restart. The canonical document
  // cannot supply that: its second surface is a sheet, and a sheet round trip
  // is the case where nothing replays. Without this fixture all three renderers
  // infer screen re-entry from the sheet path, which is the opposite rule.
  const document = artifacts().screenRoundTripDocument;
  const entries = walkV04DocumentNodes(document);

  assert.deepEqual(
    document.screens.map((screen) => screen.presentation.type),
    ["screen", "screen"],
  );
  for (const screen of document.screens) {
    const onScreen = entries.filter((entry) => entry.screenId === screen.id);
    assert.ok(
      onScreen.some(({ node }) => node.motion?.appear),
      `screen ${screen.id} authors no entrance`,
    );
    assert.ok(
      onScreen.some(({ node }) => node.motion?.loop),
      `screen ${screen.id} authors no bounded loop`,
    );
  }

  // And the round trip is authored, not merely possible: one screen navigates
  // to the other, and the other navigates back.
  const actions = [];
  walkObjectValues(document.screens, (value) => {
    if (value.type === "navigateTo" || value.type === "navigateBack") {
      actions.push(value.type);
    }
  });
  assert.ok(actions.includes("navigateTo"));
  assert.ok(actions.includes("navigateBack"));
});

test("the canonical fixture covers every motion case a renderer can get wrong", () => {
  assert.deepEqual(validateCanonicalV04Coverage(artifacts().document), []);
  assert.deepEqual(validateV04AccessibilityAnnouncementVectors(), []);
  assert.deepEqual(validateV04JsonFormatting(), []);
});

test("every invalid fixture is rejected", () => {
  const input = artifacts();
  const target = rejectionLayerTargets.find(
    (entry) => entry.directory === "fixtures/v0.4/invalid",
  );
  assert.ok(target, "the 0.4 invalid corpus must be registered for layering");
  // The corpus and the declared floor must agree, and the floor must be the
  // number the fixtures actually justify rather than whatever they happen to be.
  assert.equal(target.minimumCases, 20);
  assert.equal(input.invalidDocuments.length, 20);
  for (const document of input.invalidDocuments) {
    assert.notDeepEqual(errors({ ...input, document }), []);
  }
});

// ---------------------------------------------------------------------------
// Motion semantics.
// ---------------------------------------------------------------------------

test("an entrance inside an entrance is rejected and siblings are not", () => {
  const input = artifacts();
  node(input.document, "commerce-actions").motion = {
    appear: { effect: "fade", curve: entranceCurve, delayMilliseconds: 0 },
  };
  assert.ok(
    errors(input).some((error) =>
      error.includes("declares appear motion inside stack commerce-actions"),
    ),
  );

  const siblings = artifacts();
  node(siblings.document, "legal").motion = {
    appear: { effect: "fade", curve: entranceCurve, delayMilliseconds: 320 },
  };
  assert.deepEqual(errors(siblings), []);
});

test("one loop per screen is per screen, not per document", () => {
  // The canonical document already pulses a Button on each of its two screens.
  assert.deepEqual(errors(artifacts()), []);

  const crowded = artifacts();
  node(crowded.document, "view-details").motion = {
    loop: {
      effect: "pulse",
      scaleAmplitude: 0.03,
      opacityAmplitude: 0.1,
      curve: pulseCurve,
      repeat: { count: 2 },
    },
  };
  assert.ok(
    errors(crowded).some((error) =>
      error.includes("screen offer declares loop motion on 2 buttons"),
    ),
  );
});

test("a loop curve below the flash-safety floor is rejected at the boundary", () => {
  const belowFloor = artifacts();
  const catalog = belowFloor.document.designSystem.motions;
  const pulse = catalog.find((token) => token.id === "motion-pulse");
  pulse.value.durationMilliseconds =
    V04_LOOP_MINIMUM_DURATION_MILLISECONDS - 1;
  assert.ok(
    errors(belowFloor).some((error) =>
      error.includes("below the 500ms flash-safety floor"),
    ),
  );

  const atFloor = artifacts();
  atFloor.document.designSystem.motions.find(
    (token) => token.id === "motion-pulse",
  ).value.durationMilliseconds = V04_LOOP_MINIMUM_DURATION_MILLISECONDS;
  assert.deepEqual(errors(atFloor), []);
});

test("a motion token must resolve, and one reached only through another counts as used", () => {
  const unknown = artifacts();
  node(unknown.document, "headline").motion.appear.curve = {
    type: "motionToken",
    id: "motion-missing",
  };
  assert.ok(
    errors(unknown).some((error) =>
      error.includes("targets unknown token motion-missing"),
    ),
  );

  // motion-entrance is referenced by nodes and by motion-entrance-alias; the
  // alias is referenced only by a node. Neither may be reported as unused.
  const input = artifacts();
  assert.ok(
    input.document.designSystem.motions.some(
      (token) => token.value.type === "motionToken",
    ),
  );
  assert.deepEqual(
    errors(input).filter((error) => error.includes("unused motion")),
    [],
  );
});

test("a motion token nothing references is rejected, unlike an unused colour", () => {
  const input = artifacts();
  input.document.designSystem.motions.push({
    id: "motion-orphan",
    name: "Orphaned timing",
    value: { type: "motion", durationMilliseconds: 320, easing: "accelerate" },
  });
  assert.deepEqual(errors(input), [
    "motion token catalog declares unused motion motion-orphan",
  ]);

  // The asymmetry is deliberate and documented: an unreferenced colour is inert,
  // an unreferenced duration is an accessibility decision nothing has checked.
  const colours = artifacts();
  colours.document.designSystem.colors.push({
    id: "orphan-colour",
    name: "Orphaned colour",
    value: "#123456FF",
  });
  assert.deepEqual(errors(colours), []);
});

test("a token referenced only by an unreferenced token is unused, and both are named", () => {
  // Usage is reachability from node reference sites. Walking designSystem as a
  // usage root -- which every implementation of this rule did -- lets an orphan
  // vouch for the orphan it names: the document is still rejected, but only
  // half of what is wrong is reported, and the half that is silent is the one
  // an author would reach for next.
  const input = {
    ...artifacts(),
    document: readV04Json(protocolV04Paths.invalidTransitiveUnusedMotionTokenFixture),
  };
  assert.deepEqual(
    errors(input).filter((error) => error.includes("unused motion")),
    [
      "motion token catalog declares unused motion motion-orphan-a",
      "motion token catalog declares unused motion motion-orphan-b",
    ],
  );

  // And the browser mirror reports the same pair, at addressable paths.
  const result = validateBrowserPaywallDocument(input.document);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics
      .filter((entry) => entry.code === "semantic.unusedDeclaration")
      .map((entry) => [entry.location.documentPath, entry.location.componentId]),
    [
      ["/designSystem/motions/4", "motion-orphan-a"],
      ["/designSystem/motions/5", "motion-orphan-b"],
    ],
  );
});

test("a motion token cycle is rejected", () => {
  const input = artifacts();
  const catalog = input.document.designSystem.motions;
  catalog.find((token) => token.id === "motion-entrance").value = {
    type: "motionToken",
    id: "motion-entrance-alias",
  };
  assert.ok(
    errors(input).some((error) =>
      error.includes("motionToken catalog contains a reference cycle"),
    ),
  );
});

test("the schema alone rejects a loop outside a Button and a rise on a fade", () => {
  const layers = readV04Json(
    new URL("../fixtures/v0.4/invalid/rejection-layers.json", import.meta.url),
  );
  assert.equal(layers.layers["loop-motion-outside-button.json"], "schema");
  assert.equal(layers.layers["rise-on-fade-appear.json"], "schema");
  // The per-screen loop count is not expressible in JSON Schema, so it must be
  // the semantic layer that catches it. If it ever reads "schema", the rule has
  // been silently replaced by something narrower.
  assert.equal(layers.layers["two-loops-on-one-screen.json"], "semantic");
  assert.equal(layers.layers["nested-appear-motion.json"], "semantic");
});

// ---------------------------------------------------------------------------
// Capabilities and the enhancement tier.
// ---------------------------------------------------------------------------

test("motion capabilities are derived only from the motion that occurs", () => {
  const input = artifacts();
  const derived = expectedV04DocumentCapabilities(input.document);
  for (const name of ["motion.appear", "motion.selection", "motion.loop"]) {
    assert.ok(derived.has(name), name);
  }
  assert.deepEqual(
    [...expectedV04DocumentCapabilities(input.navigationOnlyDocument)].filter(
      (name) => name.startsWith("motion."),
    ),
    [],
  );

  const withoutLoop = artifacts();
  delete node(withoutLoop.document, "purchase").motion.loop;
  delete node(withoutLoop.document, "privacy-policy").motion;
  const remaining = expectedV04DocumentCapabilities(withoutLoop.document);
  assert.equal(remaining.has("motion.loop"), false);
  assert.ok(remaining.has("motion.appear"));
});

test("style.productCardStates is gone from the 0.4 vocabulary but still in 0.3", () => {
  const input = artifacts();
  assert.equal(
    input.paywallSchema.$defs.capabilityName.enum.includes(
      "style.productCardStates",
    ),
    false,
  );
  assert.equal(
    input.manifest.capabilities.some(
      (capability) => capability.name === "style.productCardStates",
    ),
    false,
  );
  const frozen = readV03Json(protocolV03Paths.paywallSchema);
  assert.ok(
    frozen.$defs.capabilityName.enum.includes("style.productCardStates"),
    "0.3 is a release candidate and must not have been edited",
  );
});

test("a document declaring the removed capability is rejected", () => {
  const input = artifacts();
  input.document.compatibility.requiredCapabilities.push({
    name: "style.productCardStates",
    version: "0.4",
  });
  assert.notDeepEqual(errors(input), []);
});

test("only the three motion capabilities may degrade instead of rejecting", () => {
  const input = artifacts();
  assert.deepEqual(v04ManifestFallbackTierErrors(input.manifest), []);
  for (const capability of input.manifest.capabilities) {
    const expected = capability.name.startsWith("motion.")
      ? "renderWithoutMotion"
      : "rejectDocument";
    assert.equal(capability.fallback, expected, capability.name);
  }

  const widened = artifacts();
  widened.manifest.capabilities.find(
    (capability) => capability.name === "component.carousel",
  ).fallback = "renderWithoutMotion";
  assert.ok(
    v04ManifestFallbackTierErrors(widened.manifest).some((error) =>
      error.includes("component.carousel"),
    ),
  );
  assert.notDeepEqual(errors(widened), []);
});

test("the reader policy splits the two capability tiers", () => {
  const { manifest } = artifacts();
  assert.equal(manifest.readerPolicy.unsupportedRequiredCapability, "rejectDocument");
  assert.equal(
    manifest.readerPolicy.unsupportedEnhancementCapability,
    "renderStaticDocument",
  );
  assert.equal(manifest.readerPolicy.reducedMotionAppear, "applyOpacityOnly");
  assert.equal(manifest.readerPolicy.reducedMotionSelection, "applyInstantly");
  assert.equal(manifest.readerPolicy.reducedMotionLoop, "renderRestState");
  assert.equal(
    manifest.readerPolicy.reducedMotionVideoBackground,
    "renderPosterThenFallbackColorWithoutPlayback",
  );
  assert.equal(manifest.status, "draft");
});

// ---------------------------------------------------------------------------
// The bundled Feature List cleanup.
// ---------------------------------------------------------------------------

test("a Feature List item can negate its marker and the 0.3 constant is gone", () => {
  const input = artifacts();
  const features = node(input.document, "features");
  assert.deepEqual(features.marker, { kind: "icon", name: "checkmark" });
  assert.deepEqual(features.items.at(-1).marker, { kind: "icon", name: "close" });
  assert.deepEqual(errors(input), []);

  const legacy = artifacts();
  node(legacy.document, "features").marker = "checkmark";
  assert.notDeepEqual(errors(legacy), []);

  const frozen = readV03Json(protocolV03Paths.paywallSchema);
  assert.equal(
    frozen.$defs.featureListComponent.properties.marker.const,
    "checkmark",
    "0.3 keeps its single-constant marker",
  );
});

// ---------------------------------------------------------------------------
// The reference resolver.
// ---------------------------------------------------------------------------

const appearMotion = {
  effect: "fadeRise",
  riseLogicalSize: 12,
  curve: { type: "motion", durationMilliseconds: 240, easing: "decelerate" },
  delayMilliseconds: 0,
};
const loopMotion = {
  effect: "pulse",
  scaleAmplitude: 0.04,
  opacityAmplitude: 0.12,
  curve: { type: "motion", durationMilliseconds: 900, easing: "standard" },
  repeat: { count: 3 },
};
const selectionFrom = {
  background: { type: "color", value: "#000000FF" },
  border: { color: "border.default", width: 1 },
  cornerRadius: 10,
  padding: { top: 8, start: 8, bottom: 8, end: 8 },
  opacity: 0.5,
};
const selectionTo = {
  background: { type: "color", value: "#FFFFFFFF" },
  border: { color: "action.primary", width: 3 },
  cornerRadius: 20,
  padding: { top: 16, start: 16, bottom: 16, end: 16 },
  opacity: 1,
};
const selectionMotion = {
  curve: { type: "motion", durationMilliseconds: 100, easing: "linear" },
};

test("a clock that cannot be trusted throws rather than resolving a plausible frame", () => {
  for (const elapsedMilliseconds of [-1, 1.5, Number.NaN, "120", undefined]) {
    assert.throws(
      () =>
        resolveV04MotionFrame(appearMotion, {
          trigger: "appear",
          elapsedMilliseconds,
        }),
      TypeError,
    );
  }
  assert.throws(
    () =>
      resolveV04MotionFrame(
        { ...appearMotion, curve: { type: "motionToken", id: "motion-entrance" } },
        { trigger: "appear", elapsedMilliseconds: 0 },
      ),
    /resolve motionToken references against the document first/,
  );
  assert.throws(
    () =>
      resolveV04MotionFrame(selectionMotion, {
        trigger: "selection",
        elapsedMilliseconds: 0,
      }),
    /requires resolvedFrom and resolvedTo/,
  );
  assert.throws(
    () =>
      resolveV04MotionFrame(appearMotion, {
        trigger: "appear",
        elapsedMilliseconds: 0,
        resolvedTo: selectionTo,
      }),
    /must be omitted/,
  );
});

test("every terminal state is the static rendering exactly", () => {
  const appear = resolveV04MotionFrame(appearMotion, {
    trigger: "appear",
    elapsedMilliseconds: 240,
  });
  assert.equal(appear.complete, true);
  assert.equal(appear.opacity, 1);
  assert.equal(appear.translateLogicalSize, 0);
  assert.deepEqual(
    resolveV04MotionFrame(appearMotion, {
      trigger: "appear",
      elapsedMilliseconds: 100000,
    }),
    appear,
  );

  const selection = resolveV04MotionFrame(selectionMotion, {
    trigger: "selection",
    elapsedMilliseconds: 100,
    resolvedFrom: selectionFrom,
    resolvedTo: selectionTo,
  });
  assert.equal(selection.complete, true);
  assert.deepEqual(selection.style, selectionTo);

  const loop = resolveV04MotionFrame(loopMotion, {
    trigger: "loop",
    elapsedMilliseconds: 2700,
  });
  assert.equal(loop.complete, true);
  assert.equal(loop.scale, 1);
  assert.equal(loop.opacityMultiplier, 1);
});

test("a pulse returns to rest at every cycle boundary, not only at the end", () => {
  for (const elapsedMilliseconds of [0, 900, 1800, 2700]) {
    const frame = resolveV04MotionFrame(loopMotion, {
      trigger: "loop",
      elapsedMilliseconds,
    });
    assert.equal(frame.scale, 1, `scale at ${elapsedMilliseconds}ms`);
    assert.equal(frame.opacityMultiplier, 1, `opacity at ${elapsedMilliseconds}ms`);
  }
  const peak = resolveV04MotionFrame(loopMotion, {
    trigger: "loop",
    elapsedMilliseconds: 450,
  });
  assert.equal(peak.excursion, 1);
  assert.equal(peak.scale, 1.04);
  assert.equal(peak.opacityMultiplier, 0.88);
  // The floor is a fraction of the resolved static opacity, so it can never
  // drive a price below what the author actually asked for.
  assert.ok(peak.opacityMultiplier >= 1 - loopMotion.opacityAmplitude);
});

test("reduced motion drops the transform, applies selection instantly, and rests the loop", () => {
  const midway = resolveV04MotionFrame(appearMotion, {
    trigger: "appear",
    elapsedMilliseconds: 120,
    reducedMotion: true,
  });
  assert.equal(midway.translateLogicalSize, 0);
  assert.ok(midway.opacity > 0 && midway.opacity < 1);
  assert.equal(
    resolveV04MotionFrame(appearMotion, {
      trigger: "appear",
      elapsedMilliseconds: 0,
      reducedMotion: true,
    }).translateLogicalSize,
    0,
  );

  const selection = resolveV04MotionFrame(selectionMotion, {
    trigger: "selection",
    elapsedMilliseconds: 0,
    reducedMotion: true,
    resolvedFrom: selectionFrom,
    resolvedTo: selectionTo,
  });
  assert.equal(selection.complete, true);
  assert.deepEqual(selection.style, selectionTo);

  const loop = resolveV04MotionFrame(loopMotion, {
    trigger: "loop",
    elapsedMilliseconds: 450,
    reducedMotion: true,
  });
  assert.equal(loop.scale, 1);
  assert.equal(loop.opacityMultiplier, 1);
  assert.equal(loop.cycle, 0);
});

test("selection interpolates what it can average and switches what it cannot", () => {
  const quarter = resolveV04MotionFrame(selectionMotion, {
    trigger: "selection",
    elapsedMilliseconds: 25,
    resolvedFrom: selectionFrom,
    resolvedTo: selectionTo,
  });
  assert.equal(quarter.style.background.value, "#404040FF");
  assert.equal(quarter.style.cornerRadius, 12.5);
  assert.equal(quarter.style.opacity, 0.625);
  // A semantic colour resolves against the renderer's theme, so there is no
  // number to average; it and padding switch at the half-way point instead.
  assert.equal(quarter.style.border.color, "border.default");
  assert.deepEqual(quarter.style.padding, selectionFrom.padding);

  const past = resolveV04MotionFrame(selectionMotion, {
    trigger: "selection",
    elapsedMilliseconds: 60,
    resolvedFrom: selectionFrom,
    resolvedTo: selectionTo,
  });
  assert.equal(past.style.border.color, "action.primary");
  assert.deepEqual(past.style.padding, selectionTo.padding);
});

test("the four easing presets are pinned, bounded, and monotonic", () => {
  assert.deepEqual(Object.keys(V04_EASING_CONTROL_POINTS), [
    "linear",
    "standard",
    "decelerate",
    "accelerate",
  ]);
  assert.deepEqual(V04_EASING_CONTROL_POINTS.standard, [0.4, 0, 0.2, 1]);
  assert.deepEqual(V04_EASING_CONTROL_POINTS.decelerate, [0, 0, 0.2, 1]);
  assert.deepEqual(V04_EASING_CONTROL_POINTS.accelerate, [0.4, 0, 1, 1]);
  for (const easing of Object.keys(V04_EASING_CONTROL_POINTS)) {
    assert.equal(v04EasedProgress(easing, 0), 0, easing);
    assert.equal(v04EasedProgress(easing, 1), 1, easing);
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const value = v04EasedProgress(easing, step / 20);
      // No preset overshoots: overshoot is exactly where the three platforms
      // clamp opacity and scale differently, which is why springs are excluded.
      assert.ok(value >= 0 && value <= 1, `${easing} at ${step}`);
      assert.ok(value >= previous, `${easing} is monotonic at ${step}`);
      previous = value;
    }
  }
  for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    assert.ok(Math.abs(v04EasedProgress("linear", fraction) - fraction) < 1e-9);
  }
  assert.throws(() => v04EasedProgress("bouncy", 0.5), TypeError);
});

test("resolving a motion token walks the chain the catalog declares", () => {
  const { document } = artifacts();
  assert.deepEqual(
    resolveV04MotionToken(document, { type: "motionToken", id: "motion-entrance-alias" }),
    { type: "motion", durationMilliseconds: 240, easing: "decelerate" },
  );
  assert.equal(
    resolveV04MotionToken(document, { type: "motionToken", id: "nope" }),
    null,
  );
});

// ---------------------------------------------------------------------------
// The frame vectors, and the browser mirror.
// ---------------------------------------------------------------------------

test("the committed motion vectors are what the resolver produces", () => {
  assert.deepEqual(validateMotionFrameVectors(), []);
  const committed = readV04Json(protocolV04Paths.motionFrameVectors);
  assert.deepEqual(committed, buildMotionFrameVectors());
});

test("a shrunken or hand-edited vector corpus fails the gate", () => {
  const vectors = readV04Json(protocolV04Paths.motionFrameVectors);
  const shrunken = {
    ...vectors,
    cases: vectors.cases.slice(0, MOTION_FRAME_CASE_FLOOR - 1),
  };
  assert.ok(
    validateMotionFrameVectors(shrunken).some((error) =>
      error.includes("declares a floor of"),
    ),
  );

  const tampered = structuredClone(vectors);
  tampered.cases[0].frames.at(-1).frame.opacity = 0.99;
  assert.ok(
    validateMotionFrameVectors(tampered).some((error) =>
      error.includes("does not match the reference resolver"),
    ),
  );

  const rewritten = structuredClone(vectors);
  rewritten.easingControlPoints.standard = [0.42, 0, 0.58, 1];
  assert.ok(
    validateMotionFrameVectors(rewritten).some((error) =>
      error.includes("easing control points the resolver does not use"),
    ),
  );
});

test("the browser runtime resolves every committed frame identically", () => {
  const vectors = readV04Json(protocolV04Paths.motionFrameVectors);
  let compared = 0;
  for (const entry of vectors.cases) {
    for (const frame of entry.frames) {
      const options = {
        trigger: entry.trigger,
        elapsedMilliseconds: frame.elapsedMilliseconds,
        reducedMotion: entry.reducedMotion,
        resolvedFrom: entry.resolvedFrom,
        resolvedTo: entry.resolvedTo,
      };
      assert.deepEqual(
        resolveBrowserMotionFrame(entry.motion, options),
        resolveV04MotionFrame(entry.motion, options),
      );
      compared += 1;
    }
  }
  // A mirror compared over zero frames is a mirror nobody checked.
  assert.equal(compared, 229);
});

test("the browser runtime exposes the 0.4 motion contract without widening 0.3", () => {
  const { document, paywallSchema, manifest } = artifacts();
  assert.equal(paywallV04ContractVersion, "0.4");
  assert.deepEqual(paywallContractVersions, ["0.3", "0.4"]);
  assert.deepEqual(paywallV04CapabilityNames, paywallSchema.$defs.capabilityName.enum);
  assert.deepEqual(motionEasingControlPoints, V04_EASING_CONTROL_POINTS);
  assert.equal(
    motionLoopMinimumDurationMilliseconds,
    V04_LOOP_MINIMUM_DURATION_MILLISECONDS,
  );
  assert.deepEqual(motionCapabilitiesFor(document), [
    "motion.appear",
    "motion.selection",
    "motion.loop",
  ]);
  assert.deepEqual(
    motionCapabilitiesFor(document),
    manifest.capabilities
      .filter((capability) => capability.fallback === "renderWithoutMotion")
      .map((capability) => capability.name),
  );
  assert.deepEqual(
    resolveBrowserMotionToken(document, { type: "motionToken", id: "motion-pulse" }),
    resolveV04MotionToken(document, { type: "motionToken", id: "motion-pulse" }),
  );
  assert.equal(easedMotionProgress("standard", 0.5), v04EasedProgress("standard", 0.5));
});

test("capabilities are derived, and a hand-maintained list is rejected", () => {
  const input = artifacts();
  refreshCapabilities(input);
  assert.deepEqual(errors(input), []);
  assert.deepEqual(
    input.document.compatibility.requiredCapabilities.map((entry) => entry.version),
    input.document.compatibility.requiredCapabilities.map(() => "0.4"),
  );

  const stale = artifacts();
  stale.document.compatibility.requiredCapabilities =
    stale.document.compatibility.requiredCapabilities.filter(
      (entry) => entry.name !== "motion.loop",
    );
  assert.ok(
    errors(stale).some((error) =>
      error.includes("missing required capability motion.loop"),
    ),
  );
});

test("the browser reads 0.4 documents and agrees with the Node validator", () => {
  const input = artifacts();

  // Every committed valid 0.4 fixture: both readers accept.
  for (const document of [
    input.document,
    input.edgeDocument,
    input.expiredCountdownDocument,
    input.hiddenPurchaseTargetDocument,
    input.navigationOnlyDocument,
    input.screenRoundTripDocument,
  ]) {
    assert.equal(
      validateBrowserPaywallDocument(document).ok,
      errors({ ...input, document }).length === 0,
      `valid fixture ${document.id}`,
    );
    assert.equal(validateBrowserPaywallDocument(document).ok, true);
    assert.equal(browserPaywallDocumentVersion(document), "0.4");
  }

  // Every committed invalid 0.4 fixture: both readers refuse. This is the
  // anti-drift control for the 0.4 semantic delta -- a browser rule that goes
  // missing shows up here rather than in a preview client.
  for (const [index, document] of input.invalidDocuments.entries()) {
    assert.equal(
      validateBrowserPaywallDocument(document).ok,
      false,
      `invalid fixture ${index}`,
    );
  }
});

test("the browser rejects 0.4 motion mistakes with addressable diagnostics", () => {
  const input = artifacts();
  const loop = walkV04DocumentNodes(input.document).find(
    ({ node: candidate }) => candidate.motion?.loop,
  );
  assert.ok(loop, "expected a looping call to action in the canonical fixture");

  // A motion token nothing references has never been checked against the
  // flash-safety floor, so it is rejected rather than left looking approved.
  input.document.designSystem.motions.push({
    id: "motion-orphan",
    name: "Orphan",
    value: { type: "motion", durationMilliseconds: 40, easing: "linear" },
  });
  const result = validateBrowserPaywallDocument(input.document);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (entry) =>
        entry.code === "semantic.unusedDeclaration" &&
        entry.message.includes("motion-orphan"),
    ),
    JSON.stringify(result.diagnostics),
  );
  assert.equal(errors(input).length > 0, true);
});

test("a 0.3 document is still read as 0.3 by the dispatching entry points", () => {
  const v03 = readV03Json(protocolV03Paths.canonicalFixture);

  assert.equal(browserPaywallDocumentVersion(v03), "0.3");
  assert.equal(validateBrowserPaywallDocument(v03).ok, true);
  assert.equal(
    parseBrowserPortablePaywallJson(JSON.stringify(v03)).ok,
    true,
  );

  // And a 0.4 document round-trips through the portable reader, which is the
  // entry point Studio builds on next.
  const v04 = artifacts().document;
  const parsed = parseBrowserPortablePaywallJson(JSON.stringify(v04));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.schemaVersion, "0.4");

  // An unknown version is read as 0.3 and refused there, rather than silently
  // treated as the newest thing this runtime happens to know.
  const future = { ...v04, schemaVersion: "9.9" };
  assert.equal(browserPaywallDocumentVersion(future), "0.3");
  assert.equal(validateBrowserPaywallDocument(future).ok, false);
});

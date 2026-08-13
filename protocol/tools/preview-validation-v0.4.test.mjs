import assert from "node:assert/strict";
import test from "node:test";

import {
  localPreviewVersionPreference,
  localPreviewWebSocketProtocols,
  negotiateLocalPreviewVersion,
  decideLocalPreviewDraftDelivery,
} from "../browser/index.js";
import {
  loadPreviewV04Artifacts,
  localPreviewV04DeliveryDiagnosticCodes,
  requiredLocalPreviewV04Capabilities,
  validatePreviewV04Artifacts,
  validatePreviewV04JsonFormatting,
} from "./preview-validation-v0.4.mjs";
import { localPreviewV03DeliveryDiagnosticCodes } from "./preview-validation-v0.3.mjs";
import { runtimeStateForAcceptedV04Revision } from "./validation-v0.4.mjs";

function artifacts() {
  return structuredClone(loadPreviewV04Artifacts());
}

function acceptedDocument(input) {
  const accepted = input.messages.find(
    (message) =>
      message.type === "draftUpdated" &&
      message.payload.revision.sequence ===
        input.acceptedRevisionRuntimeReset.acceptedRevision.sequence,
  );
  assert.ok(accepted, "expected the accepted 0.4 draft");
  return accepted.payload.document;
}

test("the committed Local Preview 0.4 artifacts validate", () => {
  assert.deepEqual(validatePreviewV04Artifacts(loadPreviewV04Artifacts()), []);
  assert.deepEqual(validatePreviewV04JsonFormatting(), []);
});

test("the first accepted revision of a session has played no entrance", () => {
  const input = artifacts();
  const state = runtimeStateForAcceptedV04Revision(acceptedDocument(input));

  assert.deepEqual(state.motion, { playedAppearScreens: [] });
});

test("an accepted revision retains the appear screens it still declares", () => {
  const input = artifacts();
  const document = acceptedDocument(input);
  const screenIds = document.screens.map((screen) => screen.id);
  assert.ok(screenIds.length >= 2, "expected a multi-screen 0.4 draft");

  const state = runtimeStateForAcceptedV04Revision(document, {
    motion: {
      // Deliberately reversed, and carrying a screen this revision deleted.
      playedAppearScreens: [...screenIds].reverse().concat("removed-screen"),
    },
  });

  // Retained, filtered to what the accepted document declares, and ordered by
  // that document rather than by whatever order the client recorded.
  assert.deepEqual(state.motion.playedAppearScreens, screenIds);
});

test("every 0.3 runtime member still resets on an accepted 0.4 revision", () => {
  const input = artifacts();
  const document = acceptedDocument(input);
  const before = input.acceptedRevisionRuntimeReset.runtimeBeforeAcceptance;
  const after = runtimeStateForAcceptedV04Revision(document, before);

  for (const member of [
    "switches",
    "tabs",
    "carousels",
    "navigation",
    "selectedProducts",
  ]) {
    assert.deepEqual(
      after[member],
      input.acceptedRevisionRuntimeReset.expectedRuntimeAfterAcceptance[member],
      member,
    );
    assert.notDeepEqual(after[member], before[member], member);
  }
});

test("a runtime-reset fixture that never exercises suppression is rejected", () => {
  const input = artifacts();
  // A fixture whose played screens are all gone from the accepted revision
  // proves nothing about retention: the rule would hold vacuously.
  input.acceptedRevisionRuntimeReset.runtimeBeforeAcceptance.motion.playedAppearScreens =
    ["removed-screen"];
  input.acceptedRevisionRuntimeReset.expectedRuntimeAfterAcceptance.motion.playedAppearScreens =
    [];

  const errors = validatePreviewV04Artifacts(input);
  assert.ok(
    errors.some((error) => error.includes("never exercises entrance-replay")),
    errors.join("\n"),
  );
});

test("a runtime-reset fixture that replays every entrance is rejected", () => {
  const input = artifacts();
  input.acceptedRevisionRuntimeReset.expectedRuntimeAfterAcceptance.motion.playedAppearScreens =
    [];

  const errors = validatePreviewV04Artifacts(input);
  assert.ok(errors.length > 0, "expected the cleared motion member to fail");
});

test("Local Preview 0.4 negotiates ahead of 0.3 on its own subprotocol", () => {
  assert.deepEqual(localPreviewVersionPreference, ["0.4", "0.3"]);
  assert.equal(
    localPreviewWebSocketProtocols["0.4"],
    "mosaic.local-preview.v0.4",
  );

  const both = negotiateLocalPreviewVersion(["0.3", "0.4"], ["0.3", "0.4"]);
  assert.deepEqual(both, {
    ok: true,
    selectedVersion: "0.4",
    selectedWebSocketSubprotocol: "mosaic.local-preview.v0.4",
  });

  // A 0.3-only client still gets 0.3 rather than a refusal.
  const legacy = negotiateLocalPreviewVersion(["0.3", "0.4"], ["0.3"]);
  assert.equal(legacy.selectedVersion, "0.3");
  assert.equal(
    legacy.selectedWebSocketSubprotocol,
    "mosaic.local-preview.v0.3",
  );
});

test("0.4 draft delivery requires 0.4 preview capabilities", () => {
  const input = artifacts();
  const report = input.messages.find(
    (message) => message.type === "capabilityReport",
  ).payload;
  const negotiation = negotiateLocalPreviewVersion(["0.4"], ["0.4"]);
  const document = acceptedDocument(input);

  assert.deepEqual(
    decideLocalPreviewDraftDelivery({
      capabilityReport: report,
      document,
      negotiation,
    }),
    { delivery: "send" },
  );

  // The same client reporting the 0.3 generation of the preview capabilities
  // must not receive a 0.4 draft: the capability version is the whole signal.
  const stale = structuredClone(report);
  for (const capability of stale.previewCapabilities) {
    capability.version = "0.3";
  }
  const withheld = decideLocalPreviewDraftDelivery({
    capabilityReport: stale,
    document,
    negotiation,
  });
  assert.equal(withheld.delivery, "withhold");
  assert.equal(
    withheld.diagnostic.code,
    "preview.unsupportedPreviewCapability",
  );
});

test("the 0.4 preview capability and diagnostic vocabularies are unchanged", () => {
  assert.deepEqual(
    localPreviewV04DeliveryDiagnosticCodes,
    localPreviewV03DeliveryDiagnosticCodes,
  );
  assert.deepEqual(requiredLocalPreviewV04Capabilities, [
    "preview.liveUpdate",
    "preview.mockCommerce",
    "preview.localeOverride",
    "preview.textScale",
    "preview.diagnostics",
  ]);
});

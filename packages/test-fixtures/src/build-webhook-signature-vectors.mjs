/**
 * Regenerates `webhook-signature-vectors.json`.
 *
 * A webhook signature is the one place where an application backend written in
 * any language has to reproduce Mosaic's bytes exactly. Every realistic mistake
 * -- re-serializing the JSON before hashing, signing the body alone, joining the
 * parts with the wrong separator, comparing hex case-sensitively against an
 * uppercase digest -- produces a verifier that rejects every genuine delivery,
 * or worse, one that accepts a replayed signature on a different event.
 *
 * Signatures are computed here, never hand-written.
 *
 * Run: node packages/test-fixtures/src/build-webhook-signature-vectors.mjs
 * Verified by: protocol/tools/billing-state-webhook-validation.test.mjs
 */
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");

const SIGNING_VERSION = "v1";

/**
 * The exact bytes the MAC covers, pinned by
 * `protocol/compatibility/billing-state-webhook/v2.json`.
 *
 * `SIGNING_VERSION` is the signature *scheme* version carried in the
 * `v1=` header parameter. It is not the contract version and does not move
 * when the contract version does: a verifier reads `v1=` regardless of which
 * Billing State Webhook contract produced the body.
 */
function signedPayload({ timestamp, eventId, rawBody }) {
  return `${SIGNING_VERSION}.${timestamp}.${eventId}.${rawBody}`;
}

function sign({ secret, timestamp, eventId, rawBody }) {
  return createHmac("sha256", secret)
    .update(signedPayload({ timestamp, eventId, rawBody }), "utf8")
    .digest("hex");
}

const eventFixturePath =
  "protocol/fixtures/billing-state-webhook/v2/events/entitlement-activated.json";

/**
 * The raw body is the bytes as transmitted, not a re-serialization. Mosaic
 * transmits the canonical 2-space-indented form its fixtures are written in, and
 * a verifier must hash the bytes it received rather than the object it parsed.
 */
const canonicalEventBody = readFileSync(
  resolve(repository, eventFixturePath),
  "utf8",
).trimEnd();

const canonicalEvent = JSON.parse(canonicalEventBody);

const vector = (id, input, notes) => ({
  id,
  ...input,
  signedPayload: signedPayload(input),
  signature: sign(input),
  header: `t=${input.timestamp}, ${SIGNING_VERSION}=${sign(input)}`,
  notes,
});

const primarySecret = "whsec_fixture_primary_0000000000000000";
const rotationSecret = "whsec_fixture_rotation_000000000000000";
const timestamp = 1785243603;

const primary = {
  secret: primarySecret,
  timestamp,
  eventId: canonicalEvent.payload.eventId,
  rawBody: canonicalEventBody,
};

const rotated = { ...primary, secret: rotationSecret };

const document = {
  $comment:
    "Generated cross-implementation reference vectors. Regenerate with " +
    "packages/test-fixtures/src/build-webhook-signature-vectors.mjs; never hand-edit a signature.",
  contract: "Billing State Webhook Contract v2",
  contractVersion: "2",
  compatibilityManifest: "protocol/compatibility/billing-state-webhook/v2.json",
  eventFixture: eventFixturePath,
  scheme: {
    header: "Mosaic-Signature",
    algorithm: "HMAC-SHA256",
    signingVersion: SIGNING_VERSION,
    signedPayloadTemplate: "{signingVersion}.{timestamp}.{eventId}.{rawBody}",
    separator: ".",
    keyEncoding: "UTF-8 bytes of the secret, used verbatim; the secret is not hex- or base64-decoded first",
    output: "lowercase hexadecimal, 64 characters",
    timestampFormat: "unix seconds, decimal, no fractional part",
    replayWindowSeconds: 300,
  },
  rules: [
    "Hash the raw request body exactly as received. Do not parse and re-serialize it: whitespace, member order, and Unicode escaping all change the bytes and therefore the signature.",
    "The event ID is inside the signed payload, so a captured signature cannot be replayed onto a different event body even within the replay window.",
    "Reject a delivery whose timestamp is more than 300 seconds from your own clock, before comparing signatures.",
    "During key rotation the header carries one v1 parameter per active key. Accept the delivery if ANY of them verifies. A verifier that reads only the first parameter drops every delivery signed with the new key.",
    "Compare signatures with a constant-time comparison. A byte-by-byte early-exit comparison leaks the expected value over enough requests.",
    "Compare case-insensitively or lowercase your own output first. Several HMAC libraries emit uppercase hexadecimal by default.",
  ],
  vectors: [
    vector("canonical-event-primary-key", primary,
      `The signature Mosaic produces for ${eventFixturePath}. A verifier that reproduces this agrees with the canonical fixture.`),
    vector("canonical-event-rotation-key", rotated,
      "The same event signed with a second active key. During rotation both parameters appear in one header and either one verifying is enough."),
    vector("tampered-body-must-not-verify", {
      ...primary,
      rawBody: canonicalEventBody.replace('"pro"', '"pro_lifetime"'),
    },
      "One entitlement key changed. Its signature differs from canonical-event-primary-key, which is the property that makes the signature worth computing. An implementation must NOT accept this signature for the canonical body."),
    vector("different-event-id-must-not-verify", {
      ...primary,
      eventId: "fixture-event-9999",
    },
      "Same body, same secret, same timestamp, different event ID. The differing signature proves the event ID is genuinely inside the signed payload rather than merely carried beside it."),
    vector("different-timestamp-must-not-verify", { ...primary, timestamp: timestamp + 1 },
      "One second later. Proves the timestamp is covered, which is what makes the replay window enforceable."),
    vector("minimal-body", {
      secret: primarySecret,
      timestamp,
      eventId: "fixture-event-0001",
      rawBody: "{}",
    },
      "A trivial body, so an implementation can be bootstrapped against this vector before it can produce a real event."),
    vector("non-ascii-body", {
      secret: primarySecret,
      timestamp,
      eventId: "fixture-event-0001",
      rawBody: '{"safeMessage":"Abonnement actif — 続き"}',
    },
      "Proves the payload is hashed as UTF-8. A UTF-16 or platform-default encoding agrees on every ASCII vector and disagrees here, so this is the vector that catches the bug."),
    vector("non-ascii-secret", {
      secret: "whsec_fixture_ünïcödé_secret",
      timestamp,
      eventId: "fixture-event-0001",
      rawBody: "{}",
    },
      "Proves the key is also taken as UTF-8 bytes and is not decoded from hex or base64 first."),
  ],
};

const path = resolve(here, "webhook-signature-vectors.json");
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${document.vectors.length} webhook signature vectors to ${path}`);

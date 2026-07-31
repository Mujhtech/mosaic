# Mosaic protocol breaking-change process

## Definition

A protocol change is **breaking** if any of the following is true:

1. **A previously valid document is now rejected.** Any narrowing of what a
   contract accepts.
2. **A field's meaning changed.** The same field, same type, different
   interpretation. This is the most dangerous category because nothing fails: old
   and new readers both accept the document and disagree about what it says.
3. **A field, enumeration member, or capability was removed.** Including removal
   from an enumeration that a document may already reference.

If a change is not in one of those three categories it is additive, and additive
changes to an approved contract still require a new contract version — see
below.

## Approved contracts are immutable

An approved contract's behaviour is frozen. Breaking *and* additive behaviour
changes both require a **new contract version** with its own manifest, schemas,
fixtures, documentation, and capability negotiation. The existing version is
never edited in place.

Changes that are not behaviour changes may be made to an approved contract:
documentation, comments, diagnostic message wording, and generated-artifact
formatting. The test is whether any document's accept/reject verdict, or any
field's meaning, could differ. If it could, it needs a version.

## The narrowing pre-approval doctrine

**Narrowing a schema to reject only what the semantic validators already reject
is non-breaking — but only before approval.**

The reasoning: Mosaic validates in two layers, the canonical JSON Schema and a
semantic validator, and a document is only valid if it passes both. If the schema
accepts a document that the semantic validator rejects, that document was never
valid Mosaic material. Tightening the schema to also reject it changes no
document's actual validity. It moves the rejection earlier and makes the
canonical schema an honest description of the contract.

Three conditions, all required:

1. **The contract is not yet `approved`.** Once approved, immutability wins even
   for a narrowing, because integrators are entitled to rely on the published
   schema exactly as published.
2. **The narrowing rejects nothing new in aggregate.** Every document rejected
   after the change was already rejected before it, by some layer. Demonstrated
   by running every canonical valid fixture (all must still pass) and every
   invalid fixture (the verdicts must be unchanged in aggregate, with the
   rejecting *layer* allowed to move from `semantic` to `schema`).
3. **The move is recorded.** The rejection-layer metadata
   ([fixture lifecycle](fixture-lifecycle.md)) is regenerated so the layer change
   appears in the diff, and `protocol/CHANGELOG.md` states what narrowed and why.

This doctrine was exercised once, immediately before the v1 approval flip, to
encode the analytics minimization rules into the canonical Analytics Event `1`
and `2` schemas. Four invalid fixtures moved from `semantic` to `schema`
rejection; no valid fixture changed. It closed a release-blocker category —
"canonical schema, semantic validator, and API runtime path disagreeing about
validity" — that could not have been closed after approval without versioning all
of Analytics Event.

The doctrine is now **spent for the v1 contract set.** Every v1 contract is
approved. Any future narrowing of them requires a new contract version.

## Divergence is itself a defect

The condition the doctrine exists to fix — schema and semantic validator
disagreeing about validity — is a release-blocker category, independently of
whether any document exploits it. It means the canonical schema is not the
contract, and every consumer that trusts the schema (an SDK decoder, a
third-party validator, generated types) is working from a false description.

For Analytics Event this is now structurally prevented rather than tested: the
schema allow-lists are generated from the semantic validators' tables
(`npm run generate:analytics-minimization`) and reconciled by `npm run validate`.
Editing one without the other fails CI. New contracts should prefer the same
arrangement over hand-maintained parallel definitions.

## Required artifacts for any protocol change

Per `docs/architecture/conventions/protocol.md`, every protocol change requires:

- schema update;
- fixture update ([fixture lifecycle](fixture-lifecycle.md));
- documentation;
- compatibility review; and
- implementation or a declared fallback across **all** supported SDKs.

A new contract version additionally requires:

- a new compatibility manifest and manifest schema;
- capability-negotiation support so the version is only delivered to readers that
  declared it;
- a migration guide under [`migration/`](migration/);
- confirmation that the change is implementable across Flutter, SwiftUI, and
  Jetpack Compose without platform-specific names entering the protocol; and
- `npm --prefix protocol run generate && npm --prefix protocol run validate &&
  npm --prefix protocol test` all green with zero generation drift.

## Approver

**The product owner approves every breaking change and every new contract
version.** No other role can authorize one, and approval is recorded in
`protocol/CHANGELOG.md` and the relevant phase review.

A breaking change is never introduced silently. If a change's classification is
unclear, it is treated as breaking until the product owner rules otherwise.

## Related documents

- [Compatibility policy](compatibility-policy.md)
- [Deprecation policy](deprecation-policy.md)
- [Release approval process](release-approval-process.md)
- [Fixture lifecycle](fixture-lifecycle.md)

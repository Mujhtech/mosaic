# ADR 0026: Replace Paywall Protocol 0.2 with 0.3 and delete 0.2

- Status: Accepted
- Date: 2026-08-06

## Context

Mosaic needed four new paywall components that the approved Paywall Protocol
`0.2` contract cannot express:

- `tabs` — N labelled panels with one visible at a time, and a new runtime
  selection state that authored visibility conditions can read;
- `timeline` — an ordered sequence of steps, the "how your free trial works"
  pattern;
- `award` — a recognition or accolade such as "App of the Day";
- `socialProof` — an attributed testimonial with an optional bounded rating.

Adding them to `0.2` in place was never available. Approved contracts are
immutable (`docs/protocol/release-approval-process.md`): behaviour is frozen and
a behaviour change requires a new contract version. Four new components, a new
runtime state, a third conditional `visibility` mode, and five new capability
names are unambiguously a behaviour change. A version bump was therefore
unavoidable, and the only open question was what happens to `0.2` afterwards.

The product owner directed explicitly that `0.3` **not** support `0.2`, that
there be no migration path, and that every `0.2` reference be removed from the
tree. That direction is consistent with the earlier decision on this branch to
delete the RC2→RC3 and RC3→RC4 candidate migrators rather than keep them: in a
pre-release project, redundant compatibility code is a liability rather than an
asset, and the migrators had already produced a schema-invalid document with an
empty diagnostics array (`mosaic-fallback-audit.md`, Protocol finding 1).

Mosaic has not shipped. There are no external readers pinned to `0.2`, no
published paywall documents outside this repository, and every consumer of the
contract — three SDKs, Studio, and the backend — is built in this repository and
cuts over together.

## Decision

**Paywall Protocol `0.3` replaces `0.2` outright. `0.3` does not support `0.2`,
there is no migration path, and every `0.2` artifact is deleted.**

`0.3` is `0.2` carried forward unchanged plus the four components above. No
`0.2` component, action, layout rule, design-token rule, localization rule,
locale-resolution behaviour, capability, reader policy, or normalized outcome
was removed or re-specified.

This is not a deprecation. `0.2` was not marked `deprecated` with a retirement
window and no reader accepts both versions. A `0.2` document is an unknown
version to a `0.3` reader and is rejected atomically under the existing
`unknownSchemaVersion: "rejectDocument"` policy, resolving through last-accepted
configuration, then bundled fallback, then configuration unavailable.

Deleted: `protocol/schema/v0.2/`, `protocol/schema/local-preview/v0.2/`,
`protocol/compatibility/v0.2.json`,
`protocol/compatibility/local-preview/v0.2.json`, `protocol/fixtures/v0.2/`,
`protocol/fixtures/local-preview/v0.2/`, `docs/protocol/v0.2.md`, and
`docs/protocol/local-preview-v0.2.md`. The `V02`/`v02` reference-implementation
symbols in `protocol/browser/` and `protocol/tools/` are renamed to `V03`/`v03`.

Local Preview moves in lockstep, because its message schema pins
`previewProtocolVersion` to the paywall contract version.

Configuration Delivery `1`/`2`/`3` are **not** renumbered or collapsed. They
embed paywall documents, so their paywall-version constants and schema
references now name `0.3`; the delivery contracts themselves are untouched.
Renumbering them is a separate decision that nobody has made.

`0.3` enters `status: "releaseCandidate"`, not `approved`. The cross-platform
implementability gate cannot have passed while the renderers for the new
components are still being written, and a candidate can still absorb a narrowing
correction that renderer work surfaces. The outstanding approval gates are
enumerated in `docs/protocol/v0.3.md`.

## Alternatives considered

**Deprecate `0.2` with a retirement window, running both contracts.** This is
what the deprecation policy prescribes for a contract with external readers, and
it is the right answer once Mosaic ships. Rejected here because the runway it
buys protects nobody: no reader outside this repository is pinned to `0.2`. The
cost is real and immediate — every SDK carries two decoders, two validators, two
fixture corpora, and a negotiation path between them, and every new component
must be reasoned about in both. The deprecation policy also obliges the
successor to be approved six months before the predecessor may be deprecated,
which would keep `0.2` alive well past any point at which it was useful.

**Dual-version readers that accept `0.2` and `0.3`.** Rejected. A reader that
accepts two schema versions has to decide what a `0.2` document means when a
`0.3` feature is requested of it, and every such decision is a fallback. The
2026-08 fallback audit found this defect class reproduced across all six layers;
building a new instance of it deliberately, in the contract layer, to serve
documents that do not exist, is the wrong trade.

**Add the components to `0.2` in place.** Not available. The immutability rule
forbids it, and the rule exists precisely so that a reader can rely on the
published schema exactly as published. Suspending it for a change this size
would leave the rule meaning nothing.

**Ship a `0.2`→`0.3` migration tool.** Rejected, and this is the alternative
the earlier RC-migrator decision already settled. A migrator is code that runs
on documents nobody has, is exercised only by its own fixtures, and — as the
audit showed — is where a silent defect hides longest, because nothing
downstream of it is looking. Deleting the RC migrators was the right call for
the same reason.

## Consequences

- **Documents authored at `0.2` become unreadable, not degraded.** They are
  rejected atomically and resolve through the existing safe-failure chain. No
  partial render, no best-effort interpretation, no per-component downgrade.
- **No migration tooling ships**, and none will. Anything authored at `0.2`
  during pre-release is re-authored at `0.3`.
- **Every consuming layer cuts over at once.** The three SDKs, Studio, the
  backend (including its vendored schema copy and its
  `MOSAIC_PROTOCOL_V02_SCHEMA_PATH` environment variable), and the example apps
  all carry `0.2` constants, `V02` symbols, and `fixtures/v0.2/` paths today.
  Until they are purged the repository is internally inconsistent, and a partial
  cutover is worse than either end state.
- **The forward-only lifecycle takes a documented exception.** `approved →
  deleted` is not a transition the versioning model has, and this ADR is the
  record of why it was taken. It is available only because Mosaic is
  pre-release. Once `0.3` is approved and Mosaic ships, the deprecation policy
  governs, and a future `0.4` must deprecate rather than delete.
- **`0.3` is a release candidate and is not yet immutable.** Narrowing
  corrections remain permitted until approval, which is deliberate: renderer
  implementation is where a schema problem surfaces, and a frozen contract could
  not absorb one.
- Studio, all three renderers, and the backend must implement the four new
  components, the `tabs` runtime-selection state, and the
  `condition.tabVisibility` capability before `0.3` can be approved.

## Related

- ADR-0013, ADR-0014, ADR-0015 — the Protocol `0.2` component, product-card, and
  visual-system decisions that `0.3` carries forward unchanged.
- ADR-0016 — retirement of pre-release Protocol `0.1`, the closest precedent for
  removing a contract rather than deprecating it.
- `docs/protocol/v0.3.md` — the contract and its outstanding approval gates.
- `docs/protocol/release-approval-process.md` — the approval checklist.
- `protocol/CHANGELOG.md` — the release entry.

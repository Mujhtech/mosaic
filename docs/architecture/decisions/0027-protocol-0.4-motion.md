# ADR 0027: Open Paywall Protocol 0.4 "Motion" as a bounded draft

- Status: Accepted
- Date: 2026-08-10

## Context

Motion is a planned hole in the Mosaic protocol rather than new scope. The
agentic plan (§9.1) already names animation metadata as a protocol
responsibility, and Paywall Protocol `0.3` explicitly defers "arbitrary
animation" to a later reviewed change. Today the protocol has zero motion
surface and all three renderers are fully static: no animation API is called
anywhere in any SDK.

Two things forced the question now.

The first is a **live accessibility defect**. `0.3` specifies video backgrounds
as "always muted, autoplaying, looping, and control-free", and no SDK reads the
platform reduced-motion signal (`UIAccessibility.isReduceMotionEnabled`,
`ANIMATOR_DURATION_SCALE`, `MediaQuery.disableAnimations`). Apple's App Store
Reduced Motion evaluation criteria cover "any other ongoing motion", so a Mosaic
paywall can invalidate a customer's own accessibility declaration. Only Studio
chrome handles `prefers-reduced-motion`.

The second is **position**. No competitor has filled this hole well on a native
renderer: RevenueCat documents no animation capability, Adapty shipped exactly
one primitive (a CTA pulse) and stopped, Purchasely's Lottie support "requires a
little setup from mobile developers" added template by template — the
release-and-developer-coupling failure mode Mosaic's promise forbids — and
Superwall's rich motion surface comes free with a webview and is not a model to
chase on three native renderers. There is, however, **no credible public
evidence that paywall motion lifts conversion**; the circulating "12–18%" figure
is unsourced. The defensible claims are attention capture and perceived quality,
against a counter-signal that visual-only paywall tests have the lowest
experiment win rate.

A parallel protocol review and product review were run and synthesized into
`docs/product/motion-exploration.md`, which lists the decisions this ADR
records.

## Decision

**Open Paywall Protocol `0.4` "Motion" as a single bounded gate, born
`status: "draft"`, carrying exactly three preset-based primitives.**

`0.4` is a pure superset of `0.3` apart from two removals `0.3` itself named for
this version. The contract is specified in
[`docs/protocol/v0.4.md`](../../protocol/v0.4.md).

### The rulings

1. **The gate is open, and the sequencing recommendation was overridden.** Both
   reviews recommended finishing `0.3` and Phase 9C first, because the motion
   conformance strategy depends on the very renderers `0.3` is still waiting on.
   The owner considered that and directed schema work to start now. See
   [risk](#the-accepted-sequencing-risk).

2. **The CTA pulse is bounded: `repeat: { "count": 1…5 }`. No `forever` mode
   exists anywhere in the schema.** The protocol review had proposed `forever`
   with the operating system's reduce-motion switch as the WCAG 2.2.2 stop
   mechanism. That was rejected on accessibility grounds: a user who has not
   enabled that switch would then have no stop mechanism at all. A bounded count
   needs no stop control because it stops.

   **Amendment, 2026-08-11 — the bound's scope.** The ruling did not say what
   the count is a bound *over*, and the answer changes what it guarantees. It is
   a bound **per screen entry**, not per session: `appear` and `loop` replay on
   genuine screen re-entry, so a `count: 3` pulse runs three cycles each time
   the user navigates to the screen. This does not weaken the rationale above.
   WCAG 2.2.2's subject is content that moves outside the user's control, and
   motion re-triggered by the user's own navigation action is user-initiated;
   the guarantee the bound makes — that the motion stops on its own, with no
   stop control — is a property of a viewing, and it holds in every viewing. The
   alternative, a per-session bound, would require renderers to carry
   cross-screen motion history that the protocol does not model and no frame
   vector can pin, which is where three renderers diverge. All three renderers
   behave this way and now pin it with tests driving
   `protocol/fixtures/v0.4/screen-round-trip.json`, each with the sheet round
   trip as its negative case. A **Sheet is not an entry** of the screen beneath
   it: that screen never left, so neither presenting nor dismissing one replays
   its entrances or resets its pulse budget — which is what stops a disclosure
   sheet from handing the bounded pulse a fresh budget on every open. Specified
   in
   [`docs/protocol/v0.4.md`](../../protocol/v0.4.md#replay-on-screen-re-entry).

3. **The video-background reduced-motion fix ships as specified `0.4`
   behaviour, not as a `0.3` defect patch.** The product review argued to fix it
   now as a defect; the protocol review argued it is a behaviour change that
   does not belong slipped into a release candidate. The owner ruled for `0.4`.
   Under reduced motion a video background does not play; the declared poster
   renders, then the declared fallback colour. **The live exposure remains open
   until `0.4` lands and is accepted**, and is tracked as such rather than
   closed by this ADR.

4. **Easing is presets-only:** `linear | standard | decelerate | accelerate`,
   with normative control points published and fixture-pinned. Springs are
   excluded (three parameterizations, three settling rules) and authored control
   points are excluded (an out-of-range `y` fakes a spring, and overshoot is
   where platform clamping diverges). Presets are cheap to widen later and
   impossible to retract.

5. **The two flagged `0.3` cleanups are bundled into `0.4`:**
   `style.productCardStates` is removed as a co-derived signal carrying no
   information, and the Feature List marker constant is consolidated into
   Timeline's shared three-arm marker union so a negated "not included" item is
   expressible. A version bump has a fixed cost; paying it twice for two
   one-line cleanups is worse than paying it once.

6. **`renderWithoutMotion` is introduced as the first enhancement-fallback
   tier**, carried by exactly three capabilities (`motion.appear`,
   `motion.selection`, `motion.loop`). Every other capability in every Mosaic
   contract remains `rejectDocument`, and a validator asserts that partition.
   The value is named for motion specifically rather than generically so that
   graceful degradation cannot spread by imitation into the
   no-partial-rendering doctrine.

### What makes the tier safe

One normative sentence carries the whole design: **every animation's terminal
state is byte-identical to the static rendering.** That makes
`renderWithoutMotion` provably lossless, makes reduced motion "be at the end
already", makes the `t = end` conformance golden the existing static golden, and
guarantees a motion bug can never make a price or a disclosure unreachable.

## Consequences

### Accepted

- **Three primitives, trigger-constrained.** `appear` on any node with a
  nested-`appear` rejection, `selection` on the two components owning runtime
  selection state, `loop` on `button` with at most one per screen. A protocol
  that lets you pulse six things is a toolkit; one that lets you pulse *the*
  thing is a paywall protocol.
- **Flash safety is enforced, not advised**: a 500 ms floor on loop durations,
  ceiling-bounded amplitudes, and colour loops made structurally inexpressible.
- **A pure reference resolver plus frame vectors.** `resolveV04MotionFrame`
  generates `motion-frames.json`, and `npm run validate` reconciles the fixture
  against the resolver, so the two cannot drift.
- **Renderers gain a new obligation**: an injectable motion driver, and every
  existing static golden must be recaptured with that driver disabled. Android's
  SHA-256 zero-tolerance goldens make this non-optional.

### Deferred to later waves, deliberately

- The three native renderers, Studio authoring, and Local Preview `0.4`.
- The backend capability partitioning in
  `apps/api/internal/hostedpublishing/capability_request.go`, which must
  partition on the manifest `fallback` so a reader missing a `motion.*`
  capability receives the release rather than a capability-missing refusal. It
  is flagged and **not modified** by the contract slice.
- Exit animation, stagger sugar, carousel auto-advance, authored beziers.

**Status, 2026-08-11.** The list above records what was deferred when the gate
opened and is left as written. Since then the three renderers, Studio motion
authoring, Local Preview `0.4`, and the backend capability partitioning have all
landed; `capability_request.go` now partitions on the manifest `fallback`. What
remains deferred is publish-time projectability, Studio's live-preview surface,
a Configuration Delivery version that can carry a `0.4` document at all, and the
last four items above. See
[`docs/protocol/v0.4.md`](../../protocol/v0.4.md#what-this-slice-did-not-include-and-what-has-since-landed).

### The accepted sequencing risk

`0.3` is a release candidate whose cross-platform implementability gate has not
cleared, and a release candidate may still absorb narrowing corrections. Any
correction the `0.3` renderer work surfaces must now be applied **twice** —
once to `0.3` and once to `0.4` — or `0.4` inherits a defect that `0.3` fixed.
The owner accepted this explicitly. It is bounded by `0.4` being a draft, which
may change without a version bump, and by `0.4` having been generated from `0.3`
by a script rather than hand-copied, which makes reapplying a correction
mechanical.

### Open items this ADR does not close

- Decision 2 (sequencing relative to Phase 10 AI Assistance) remains open.
- Decision 7 (presets-only versus authored beziers, validated against
  design-partner demand) is defaulted to presets-only and is reversible while
  `0.4` remains a draft.
- Decision 8 (measuring the primitives through Phase 7 Experiments and
  publishing the results as Mosaic-owned evidence) remains an open commitment.
- The countdown second-rounding divergence between Flutter and iOS is an
  independent `0.3` conformance defect and is **not** addressed here.

## Alternatives considered

**Wait for `0.3` approval and Phase 9C.** Recommended by both reviews and
overridden by the owner. Recorded above as accepted risk rather than argued
away.

**Add motion to `0.3`.** Unavailable. `0.3` is a release candidate in which only
narrowing corrections are permitted, and motion is an addition.

**One generic `renderWithoutFeature` fallback value.** Rejected. A generic value
invites relitigating the no-partial-rendering doctrine once per feature; a
motion-shaped name cannot spread by imitation.

**Lottie or Rive.** Permanently excluded by both reviews on the
no-executable-code-in-remote-configuration rule: a state machine is remote
executable behaviour. It would also add three native runtime dependencies and
content no validator can inspect.

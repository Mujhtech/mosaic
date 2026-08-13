# Motion in Mosaic — exploration and proposal

Status: gate opened 2026-08-10 by owner decision. Written 2026-08-10 from a
parallel protocol-design review and product/competitive review; this document
synthesizes both and lists the owner decisions required before any work starts.

Owner rulings recorded 2026-08-10 (work proceeds on `feat/protocol-0.4-motion`):

- **Decision 1 — authorized.** The Protocol 0.4 Motion gate is open. The
  sequencing recommendation (wait for 0.3 approval and Phase 9C) was
  considered and overridden by the owner; schema work starts now. The 0.3
  RC absorption risk named in the protocol review is accepted and tracked.
- **Decision 3 — bounded.** The CTA pulse runs an authored cycle count of
  1–5, then rests permanently. No infinite loops; no stop control needed.
- **Decision 5 — carried in 0.4.** The video-background reduced-motion fix
  ships as specified 0.4 behavior, not as a 0.3 defect patch. The live
  exposure remains open until 0.4 lands and is accepted by the owner.
- Decisions 2, 6, 7, 8 remain open; work below follows this document's
  recommendations where a default is needed (cleanups bundled, presets-only
  easing) and each such default is reversible before 0.4 leaves draft.

## Summary

Motion is a planned hole in the protocol, not new scope: the agentic plan (§9.1)
already names "animation metadata" as a protocol responsibility, and protocol
0.3 explicitly defers "arbitrary animation" to a later reviewed change. Nobody
in the market has filled this hole well on a native renderer — the opportunity
is real, but it is a gap to fill deliberately, not a race being lost.

The recommendation in one paragraph: **fix the reduced-motion defect that ships
today; finish 0.3 and Phase 9C first; then propose Protocol 0.4 "Motion" as one
bounded gate** carrying exactly three preset-based primitives — staggered
entrance reveal, a bounded CTA pulse, and selection-change transitions — with
durations and easings drawn from a closed motion-token catalog, a new
`renderWithoutMotion` capability-fallback tier, a protocol-mandated
reduced-motion contract, and frame-pinned three-renderer conformance. Then run
the primitives through Phase 7 Experiments and publish the results: nobody has
credible data on paywall motion, and Mosaic is positioned to produce the first.

## Competitive landscape (facts, as of Aug 2026)

- **RevenueCat** (native SwiftUI/Compose): no documented animation capability.
  One community request for CTA pulse / badge shimmer ("passed along to the
  team", Mar 2026, no commitment). One blog sentence claiming "basic animations
  and transitions" that the docs do not substantiate. An open-source Compose
  animations showcase — i.e. their answer today is "hand-code it." Shipped
  adjacent: video backgrounds, countdown timer, multipage paywalls, AI editor.
- **Superwall** (webview): the richest motion surface — tap animations, state
  transitions, Lottie, page transitions — because CSS gives it away. Not a
  model to chase on a three-renderer native surface; the correct position is
  *less motion, but native, accessible, and identical on three platforms*.
- **Adapty** (native): shipped exactly one motion primitive — CTA **pulse** —
  and stopped. The most relevant precedent for what is affordable natively and
  what customers actually ask for.
- **Purchasely**: Lottie support that "requires a little setup from mobile
  developers", added "template by template" — exactly the
  release-and-developer-coupling failure mode Mosaic's promise forbids.

**Evidence honesty:** there is no credible public data that motion lifts paywall
conversion. The "12–18%" figure circulating in SEO content is unsourced; do not
repeat it. The defensible claims are attention capture and perceived quality
(NN/g), with the caveat that irrelevant motion measurably harms UX and most UI
motion should live in 100–300 ms. Counter-signal worth respecting: visual-only
paywall tests have the lowest experiment win rate; structure and pricing win
more. Hence the experiments play: ship motion, measure it, publish.

## What exists in Mosaic today

- The protocol has zero motion surface, and all three renderers are fully
  static — no animation API is called anywhere in any SDK.
- **Defect (live today):** video backgrounds are specified as "always muted,
  autoplaying, looping, and control-free" and **no SDK reads the platform
  reduced-motion signal** (`UIAccessibility.isReduceMotionEnabled`,
  `ANIMATOR_DURATION_SCALE`, `MediaQuery.disableAnimations`). Apple's App Store
  Reduced Motion evaluation criteria cover "any other ongoing motion", so a
  Mosaic paywall can invalidate a customer's accessibility declaration. Only
  Studio chrome handles `prefers-reduced-motion`.
- **Defect (live today, found during renderer survey):** countdown second
  rounding diverges — Flutter rounds a sub-second remainder up, iOS rounds
  down; same document, same instant, different displayed digit. Needs its own
  ticket and a countdown-formatting conformance fixture that 0.3 lacks.
- **Structural gap:** the injectable "clock" in each SDK is `now`-only and the
  countdown tick bypasses it on all three (TimelineView / delay-loop /
  root-level `Timer.periodic` doing a full-tree `setState` in Flutter). Motion
  needs a genuinely new injectable **motion driver**; the countdown tick should
  move onto it too.

## Protocol design (proposed shape for 0.4)

### Motion tokens in `designSystem`

One new catalog, `motions`, mirroring colors/backgrounds/shadows exactly:
`{ id, name, value: { type: "motion", durationMilliseconds, easing } }`,
referenced as `{ type: "motionToken", id }` with an inline form permitted (the
`inlineShadow` pattern). Duration and easing are one composite because they are
not independently meaningful. Durations are integers (0–2000 ms), per the 0.3
doctrine that four languages must not disagree about a rounded fraction.
Studio's own theme already ships this exact vocabulary
(`--mosaic-motion-fast/standard`, one ease, a reduced-motion collapse) —
protocol and Studio chrome should share one motion model.

### Three primitives, constrained by trigger

| Trigger | Allowed on | Hard rule (document-rejecting) |
| --- | --- | --- |
| `appear` — `fade`, `fadeRise` (+ `delayMilliseconds` for stagger) | any node | a node with `appear` may not descend from another node with `appear` (nested-opacity compounding diverges across platforms) |
| `selection` | `productSelector`, `tabs` only | closed interpolable-field list (background color, border color/width, cornerRadius, opacity, shadow); background *kind* changes and padding apply discretely at t=0.5 |
| `loop` — `pulse` only | `button` only | **at most one per screen** — a protocol that lets you pulse six things is a toolkit; one that lets you pulse *the* thing is a paywall protocol |

Tabs `selection` animates the tab control's style, not the panel swap — 0.3's
visibility semantics remove a hidden node from layout/accessibility/focus, and
animating a removal would require a "present but not focusable" third state
that does not exist. Exit/removal animation is 0.5 work at the earliest.

### Easing: four presets, no springs, no authored beziers

`linear | standard | decelerate | accelerate`, normative control points
published and fixture-pinned. Cubic beziers are the one faithfully portable
curve (SwiftUI/Compose/Flutter share the parameterization); springs are not —
three different parameterizations and settling rules, and matching them means
reimplementing the ODE and fighting each platform. Authored control points are
excluded because out-of-range `y` fakes a spring, and overshoot is exactly
where platform clamping of opacity/scale/color diverges. Presets are cheap to
widen later and impossible to retract.

### Excluded, with reasons that should go in the contract

Lottie/Rive (a state machine is remote executable behavior — direct violation
of the "no executable code in remote configuration" rule; plus three native
runtime dependencies and unvalidatable content); keyframe timelines (a mini
animation language); scroll-linked motion/parallax (needs scroll-state binding
the protocol deliberately does not expose, and platform scroll physics differ
by construction — consequently there are no "parallax limits" to specify:
there is no parallax); screen/sheet transitions (platform-owned, same boundary
0.3 drew for focus order); shimmer (moving gradient masks are where
cross-platform fidelity dies, and on a CTA shimmer reads as skeleton-loading);
color loops (a looping color change *is* the flash primitive — structurally
excluded by `pulse` carrying only scale and opacity); countdown motion
emphasis (deferred at best — it adds a second time axis to conformance — and
recommended permanently excluded as authored *urgency* motion on store-policy
grounds: Apple's fake-urgency guidance, Play's deceptive-purchase policy).

### The rule that makes it safe

**Every animation's terminal state is byte-identical to the static rendering.**
This one normative sentence makes `renderWithoutMotion` provably lossless,
makes reduced-motion "jump to the end", makes the t=end conformance golden the
*existing* static golden, and guarantees a motion bug can never make a price or
disclosure unreachable.

### Capability model: an enhancement tier

Today every capability is `fallback: "rejectDocument"` (a schema `const`) and
server-side stripping is doctrine-forbidden. Motion introduces the first
enhancement tier: three capabilities — `motion.appear`, `motion.selection`,
`motion.loop` (granularity justified by the 0.3 distinguishability test) — with
a new manifest fallback value named **`renderWithoutMotion`** (deliberately
motion-specific, not generic, so graceful degradation cannot spread by
imitation; a validator asserts every non-`motion.*` capability remains
`rejectDocument`). Reader policy splits into
`unsupportedRequiredCapability: rejectDocument` and
`unsupportedEnhancementCapability: renderStaticDocument`. The unused-capability
derivation needs no change and actively protects the tier. One backend
integration point is flagged: the capability check in
`apps/api/internal/hostedpublishing/capability_request.go` must partition on
the manifest fallback so a missing motion capability delivers the release
rather than returning capability-missing.

### Accessibility contract (protocol-mandated, not renderer-interpreted)

Normative platform signal mapping (iOS reduce-motion / Android animator scale
/ Flutter `disableAnimations`), injected at the renderer boundary like the
clock so it is testable. Under reduced motion: `appear` degrades to opacity
only (no transform — the contract owns *what* changes, the platform owns *how
long*, which resolves the iOS-replace vs Android-remove divergence without
per-platform clauses); `selection` applies instantly; `loop` is fully disabled
to rest state. Safety is schema-enforced, not prose: loop tokens require
duration ≥ 500 ms (caps the fundamental at 1 Hz, far under flash thresholds),
pulse amplitudes are ceiling-bounded (scale ≤ 0.06, opacity ≥ 0.6), color
flashing is inexpressible, and motion never touches the accessibility tree
(a node mid-entrance is already present, focusable, and announceable).

### Versioning and sequencing

Motion cannot enter 0.3 (RC, narrowing-only) and 0.4 should not start until
0.3 is approved — the motion conformance strategy depends on the very
renderers 0.3 is still waiting on — and Phase 9C clears its owner gate. 0.4 is
a pure superset: migration is mechanical (bump versions, drop
`style.productCardStates` if the flagged 0.3 cleanups are bundled — recommended
on fixed-cost grounds). Post-GA versioning discipline applies: 0.3 deprecates
with runway rather than being replaced. Local Preview bumps in lockstep; the
accepted-revision runtime-state shape gains a `motion.playedAppearScreens`
member, and Local Preview suppresses entrance replay on accepted revisions so
designers are not strobed while nudging padding. Publishing emits a 0.3
representation by projection at publish time (the established delivery
pattern) so one authored document serves both reader generations.

### Conformance strategy

A pure reference resolver `resolveV04MotionFrame(motion, {trigger, elapsed,
reducedMotion, from, to})` in the protocol tools (the
`resolveV03CountdownState` precedent), generating `motion-frames.json` vectors
pinned at t = 0/¼/½/¾/end for every effect × easing × duration, plus
reduced-motion variants, at 4 decimal places with a stated 1e-3 tolerance
(continuous interpolation cannot be byte-pinned across three platform bezier
solvers; the tolerance is two orders below perceptibility). Renderers gain an
injectable motion driver (Compose `mainClock.advanceTimeBy`, Flutter
`tester.pump(duration)`, iOS driving progress directly); all existing static
goldens must be captured with the driver disabled (Android's SHA-256
zero-tolerance goldens make this non-optional); and two assertions fall out of
the terminal-state rule for free: the t=end golden equals the static golden,
and the reduced-motion loop golden equals the static golden.

## Minimal viable slice (0.4 wave 1)

`designSystem.motions` + `motionToken` reference; four-preset easing;
`motion.appear` (`fade`, `fadeRise`, `delayMilliseconds`); `motion.selection`
on selector/tabs with the closed field list; `motion.loop` (`pulse`, button
only, one per screen); the reduced-motion contract and injectable signal; the
`renderWithoutMotion` tier; the reference resolver and frame fixtures. Held
back: staggered-reveal sugar beyond authored delays, countdown-conditional
motion, exit animation, carousel auto-advance (a component behavior, not
motion — if ever built it needs a pause affordance per WCAG 2.2.2), authored
beziers, springs.

## Required now, independent of any motion decision

1. **Reduced-motion handling for the existing video background** on all three
   renderers (render the declared poster/fallback instead of playing) plus a
   documented statement of the iOS/Android semantic divergence and conformance
   coverage. The reviews differ on labeling — product review: fix as a defect
   now; protocol review: it is a behavior change and belongs in 0.4 rather
   than slipped into an RC — but agree it must be ruled explicitly, not by
   omission (owner decision 5 below).
2. **File the countdown rounding divergence** (Flutter rounds up, iOS rounds
   down) as an independent 0.3 conformance defect with a formatting fixture.

## Owner decisions required before schema work

1. Authorize a Protocol 0.4 "Motion" gate at all (plan §9.1 anticipates it;
   0.3 defers it).
2. Sequence relative to Phase 10 (AI Assistance): before, after, or parallel
   protocol track. Note: competitors all ship AI paywall generation already;
   nobody ships native authored motion — entering the AI race third is the
   weaker position of the two.
3. `loop` repeat: `forever` relying on the OS reduced-motion switch as the
   WCAG 2.2.2 stop mechanism, versus a bounded cycle count (product review
   recommends bounded, 1–5; protocol review proposes `forever` with the OS
   switch as the mechanism). Needs an explicit accessibility ruling.
4. Permanently exclude Lottie/Rive (both reviews: yes, on the
   executable-configuration rule) and countdown urgency motion (product
   review: yes, on store policy; protocol review: defer to 0.5 as
   countdown-conditional triggers). Rule on both.
5. Video-background reduced-motion fix: ship against 0.3 now as a defect, or
   carry in 0.4 as a specified behavior change.
6. Bundle the flagged 0.3 cleanups (`style.productCardStates` removal,
   negated feature-list markers) into 0.4.
7. Presets-only easing vs authored beziers — validate against design-partner
   demand before freezing.
8. Measure the Tier-1 primitives through Phase 7 Experiments and publish the
   results as Mosaic-owned evidence (a public commitment).

## Sources

Competitive and evidence claims are sourced in the product review (RevenueCat
docs/changelog/community, Superwall docs, Adapty docs, Purchasely docs, NN/g
motion research, Apple Reduced Motion evaluation criteria and HIG, Google Play
Deceptive Behavior policy, WCAG 2.2.2). Protocol claims are grounded in
`protocol/schema/v0.3/*`, `protocol/compatibility/v0.3.json`,
`docs/protocol/v0.3.md`, `docs/protocol/versioning.md`, the three renderer
sources, and `packages/design-tokens/src/theme.css`.

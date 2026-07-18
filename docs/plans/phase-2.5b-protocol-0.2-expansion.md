# Gate 2.5B Protocol 0.2 Styling, Component, and Navigation Expansion

**Status:** Frozen RC3 contract for implementation
**Date:** 2026-07-18
**Phase gate:** Gate 2.5A remains the Production Studio UX and Design System contract. Gate 2.5B
must pass before Phase 2.5 may be accepted and before Phase 3 begins.

## Purpose

Gate 2.5B makes the Gate 2.5A contextual editor useful for production paywall design without
turning Studio into a freeform graphics tool. It adds a strict, platform-neutral Mosaic Protocol
`0.2`, matching Flutter, SwiftUI, and Jetpack Compose rendering, and complete Studio support for:

- contextual text, box, sizing, spacing, and visibility styling;
- one through ten accessible screens with bounded forward/back navigation;
- one generalized vertical or horizontal Stack;
- platform-neutral Icon and one composable Button with a closed action set;
- Carousel;
- Switch;
- Countdown; and
- authored Product Card and Product Badge layers with Default and Selected visual states; and
- safe Product Card templates for runtime product name and localized price.

The user problem is that Protocol `0.1` can express a usable paywall structure but cannot express
the visual differentiation expected from a production paywall. Developers and designers otherwise
have to return to three hardcoded native implementations, undermining Mosaic's core promise of
visual editing without losing native control.

## Authority and phase boundary

The product owner approved this bounded contract after Gate 2.5A exposed the Protocol `0.1`
styling limit. This is the only protocol and SDK expansion authorized before Phase 3.

The authority order is:

1. immutable Mosaic Protocol `0.1` artifacts and accepted Phase 1 behavior;
2. this frozen Gate 2.5B contract for Protocol `0.2`;
3. the Gate 2.5A Studio contract for interaction and design-system behavior that does not conflict
   with Protocol `0.2`;
4. the roadmap and older agentic plan where they do not conflict with the items above.

Protocol `0.1` remains byte-for-byte immutable. Gate 2.5B creates a separate strict document
version; it does not edit, relax, or reinterpret `0.1`.

Gate 2.5B does not authorize:

- hosted publishing, accounts, organizations, projects, environments, placements, or releases;
- real RevenueCat, StoreKit 2, or Google Play Billing adapters;
- analytics, experiments, AI, collaboration, or a marketplace;
- executable content or arbitrary expressions;
- freeform positioning or a Figma-compatible document model; or
- components and style effects outside this contract.

## Approved owner decisions

| Decision            | Frozen resolution                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switch meaning      | A generic native Boolean runtime control used by constrained visibility rules. It does not directly mutate products, entitlements, actions, or arbitrary fields. |
| Countdown clock     | An absolute RFC 3339 UTC deadline calculated from the device wall clock. It is not a presentation-relative urgency timer.                                        |
| Stack migration     | Protocol `0.2` uses only `stack` with an explicit direction. A migrator converts `verticalStack` to `stack` with `direction: "vertical"`.                        |
| Color model         | A fixed protocol semantic-color vocabulary plus literal canonical sRGB colors.                                                                                   |
| Product Card states | Only Default and Selected are authored in `0.2`. Focus, pressed, loading, disabled, and unavailable chrome remain native or follow existing fallback behavior.   |
| Product structure   | Product Selector owns one through twenty ordered Product Cards. Each card owns one product binding, passive content, independent layout and style, and at most one direct Product Badge child. |
| Product templates   | Only `product.name` and `product.price`, with optional whitespace, may be interpolated in Text below a Product Card or its localized accessibility label. |
| Screen model        | `initialScreenId` plus one through ten closed screens; all screens reachable and the forward `navigateTo` graph acyclic.                                               |
| Button model        | One composable Button with passive descendants and one merged accessibility target replaces specialized `0.2` action components.                                   |
| Action expansion    | Add Navigate To, Navigate Back, and absolute HTTPS-only Open External URL; navigation and external opening add no presentation outcome.                              |
| Roadmap placement   | This work is Gate 2.5B. Gate 2.5A and Gate 2.5B both block Phase 3.                                                                                              |

## Versioning, compatibility, and migration

Protocol `0.2` requires:

- a canonical JSON Schema under a new versioned path;
- a matching compatibility manifest;
- generated browser types produced from the canonical schema;
- a canonical complete fixture plus focused valid and invalid fixtures;
- semantic validation, documentation, and changelog entries;
- exact capability derivation for every used component and presentation feature;
- first-party Flutter, SwiftUI, and Compose readers that continue to support `0.1` and add `0.2`;
- atomic rejection by clients without complete `0.2` capabilities; and
- last-accepted or bundled fallback behavior after rejection.

Protocol `0.2` also requires a separately versioned Local Preview `0.2` contract because Local
Preview `0.1` embeds the Protocol `0.1` document schema and cannot carry a Protocol `0.2` document.
Gate 2.5B must add:

- Local Preview `0.2` message and local-project schemas;
- Local Preview `0.2` canonical session-flow and local-project fixtures;
- the exact `mosaic.local-preview.v0.2` WebSocket subprotocol;
- generated browser declarations and runtime validation from those schemas;
- capability reports that declare supported paywall schema versions and exact Protocol `0.2`
  capabilities before a `0.2` draft is sent;
- WebSocket subprotocol negotiation that selects the highest mutually supported Local Preview
  version; and
- explicit incompatible-client diagnostics when a connected `0.1`-only client cannot receive a
  Protocol `0.2` draft.

Local Preview `0.1` schemas, messages, fixtures, subprotocol, ordering, acknowledgements,
diagnostics, and fallback behavior remain unchanged and supported. A first-party Studio, relay, or
SDK implementation that supports Local Preview `0.2` must continue to negotiate Local Preview
`0.1` with an older peer.

Local Preview `0.2` preserves the accepted identity, direction, sequencing, acknowledgement,
diagnostic, mock-commerce, heartbeat, reconnect, and last-accepted-draft semantics. Its versioned
draft payload references Protocol `0.2`. A `0.1`-only peer may connect through
`mosaic.local-preview.v0.1`, but Studio must not send that peer a `0.2` document or silently
downgrade it.

There is no lossy automatic downgrade from `0.2` to `0.1`.

The deterministic `0.1` to `0.2` migration must:

- preserve document, component, asset, product, feature-item, and localization identifiers;
- preserve source order, actions, product bindings, localized defaults, and catalogs;
- replace top-level `layout` with `initialScreenId: "main"` and one screen without invented
  accessibility copy;
- replace every `verticalStack` with `stack`;
- set `direction` to `vertical`;
- rename `spacing` to `gap`;
- rename `horizontalAlignment` to `crossAxisAlignment`;
- set `mainAxisDistribution` to `start`;
- preserve logical padding;
- replace Legal Text with ordinary Text using caption typography and unlimited lines;
- replace Purchase, Restore, and Close components with Button, one Text child, and preserved
  action/accessibility semantics;
- convert Purchase and Restore progress labels to `inProgressChildren`;
- allocate deterministic collision-safe Button-descendant identifiers; and
- replace Product Selector reference lists with ordered authored Product Cards, safe name/price
  Text templates, and nested Product Badges that preserve existing badge copy;
- remove `badge` from Product References and allocate collision-safe card, badge, and child IDs;
- add only the explicit neutral presentation defaults required by the `0.2` schema.

New `0.2` documents must not contain `verticalStack`. SDKs retain that type only in their `0.1`
reader.

## Shared presentation contract

Presentation fields are contextual. A component exposes only fields that have defined semantics
for that component and all three native renderers. Studio must not render one generic property bag
for every node.

### Color

A color is exactly one of:

- a fixed semantic token; or
- a literal sRGB color in canonical `#RRGGBBAA` form.

The initial semantic vocabulary is:

- `text.primary`;
- `text.secondary`;
- `surface.default`;
- `surface.elevated`;
- `action.primary`;
- `action.onPrimary`;
- `border.default`; and
- `transparent`.

Renderers map semantic colors to the host's corresponding light or dark native theme values.
Literal colors remain exact. Custom project token catalogs, gradients, multiple fills, and blend
modes are deferred.

### Box appearance

Eligible nodes may define:

- one solid background;
- one inside border with color and logical-unit width;
- one uniform corner radius;
- overall opacity from `0` through `1`; and
- content clipping where the node is a container or image.

The border is drawn inside the allocated bounds and does not change outer size. Overall opacity is
visual only: an element with zero opacity still exists in layout, focus, accessibility, and
interaction order. Visibility is the only mechanism that removes an element.

Corner radius clips an Image. Stack and Carousel clip descendants only when their explicit
clip-content value is enabled.

### Sizing

All sizes use Protocol logical units.

- Width supports content-sized, fill available width, or a fixed positive logical size.
- Height supports content-sized or a fixed positive logical size only for components whose
  semantics remain safe at fixed height.
- Text and Countdown always use content height so accessibility text is not clipped by
  a fixed container.
- Image uses either a positive aspect ratio or fixed height, never both.
- Fill height, percentages, viewport units, arbitrary constraints, and general min/max chains are
  deferred.

Sizing never introduces absolute X/Y coordinates, rotation, overlap, or z-index.

### Spacing

Spacing is direction-relative:

- outer insets use `top`, `start`, `bottom`, and `end`;
- padding uses the same edges on nodes with a rendered box; and
- gap belongs to layout/list components.

Outer insets do not collapse. The parent applies them before alignment. Negative spacing is
invalid.

### Visibility

Visibility is exactly one of:

- always visible;
- statically hidden; or
- visible when a referenced Switch component equals `true` or `false`.

A hidden node:

- occupies no layout space;
- is absent from focus, hit testing, and accessibility order;
- cannot execute an action; and
- retains its runtime state so it returns predictably when made visible again.

Every Switch reference must resolve inside the same screen. A component cannot condition its own
visibility on itself. Arbitrary expressions, scripts, compound Boolean trees, entitlement checks,
remote values, and time-based visibility are invalid.

A Button Purchase action whose target Product Selector is currently hidden is disabled and emits a safe
diagnostic rather than purchasing an invisible choice.

### Typography

Text-bearing components expose only the relevant subset of:

- semantic text style;
- semantic or literal text color;
- logical font size;
- weight: regular, medium, semibold, or bold;
- line-height multiplier;
- direction-relative alignment;
- optional maximum lines; and
- overflow: clip or ellipsis when a maximum is present.

Absent maximum lines means unlimited. The complete localized string remains available to assistive
technology when visual text is truncated. Studio warns when maximum lines are likely to truncate a
long locale or accessibility-scaled preview.

Migrated `0.1` Legal Text becomes ordinary Text with caption typography and no maximum lines. Font
families, downloaded fonts, rich text, inline links, letter spacing, general-purpose
interpolation, and text effects are deferred. The only interpolation in `0.2` is the closed
Product Card template vocabulary defined below.

Text may provide a localized accessibility-label override. Without one, assistive technology uses
the resolved visible value.

## Component semantics

### Screens and Scroll Container

The document declares `initialScreenId` and one through ten screens. Screen IDs use a namespace
separate from globally unique component IDs. A single screen may omit its accessibility label;
multiple screens require a label on every screen. Each screen owns a vertical Scroll Container
with safe-area policy, indicator visibility, root background, and one root Stack.

Every `navigateTo` target resolves to a different screen. Every screen is reachable from the
initial screen and the forward graph is acyclic. `navigateBack` uses presentation history; at the
root it is a safe no-op with a diagnostic. An accepted revision resets to the new initial screen
with a one-entry history stack containing that screen.

### Stack

Stack replaces `verticalStack` in Protocol `0.2` and defines:

- `direction`: vertical or horizontal;
- gap;
- logical padding;
- cross-axis alignment: start, center, end, or stretch;
- main-axis distribution: start, center, end, or space-between;
- contextual sizing, outer spacing, background, border, radius, opacity, visibility, and clipping;
  and
- recursive children.

Source order remains reading and focus order. A horizontal Stack places source order from logical
start to end and mirrors spatially in RTL. It does not wrap.

A nested Stack may be empty so Studio can provide a valid drop target. The root Stack inside the
Scroll Container must contain at least one child. Stack may contain every Protocol `0.2` node except
Scroll Container.

### Carousel

Carousel is a horizontally paged native component with:

- two through twenty pages;
- a stable identifier and localized accessibility label for each page;
- one Stack as each page's content;
- an initial zero-based page index;
- indicator visibility;
- horizontal swipe interaction and page snapping;
- looping disabled;
- automatic advancement disabled;
- height equal to the largest laid-out page for the active locale and text scale; and
- contextual sizing, outer spacing, background, border, radius, opacity, visibility, clipping, and
  accessibility metadata.

The runtime current page begins at the document's initial page, changes only through presentation
interaction, and resets for a new presentation or accepted document revision. It never modifies
the document, revision, autosave, undo history, or export.

Accessibility exposes one named Carousel group. After a user-initiated page change, it announces
the page label and position. Passive layout updates do not create live announcements.

Layers display Carousel, its ordered Slides, and each Slide's Stack content. Slides support
reorder, duplicate, delete while at least two remain, rename as Studio-only metadata, and insertion
of valid content into their Stack.

### Switch

Switch is a generic native Boolean control with:

- a localized visible label;
- optional localized accessibility hint;
- a document-defined initial Boolean value;
- off and on track colors;
- thumb color; and
- contextual box, outer spacing, opacity, visibility, and accessibility fields.

The component identifier is its runtime state identity. On presentation or accepted document
revision, the state initializes from the document. User interaction changes runtime presentation
state only. It never modifies the document, revision, autosave, undo history, products,
entitlements, actions, or export.

Other nodes may reference the Switch only through the visibility contract. Direct product
selection, purchase mutation, arbitrary field binding, and executable callbacks are invalid.

### Countdown

Countdown is an absolute offer-deadline display with:

- an RFC 3339 UTC `endsAt` timestamp;
- largest and smallest displayed units;
- localized completed text;
- contextual typography, sizing, outer spacing, background, border, radius, opacity, visibility,
  and accessibility metadata.

Remaining time is `max(endsAt - current device wall clock, zero)`. Completion shows the localized
completed text. It does not hide a node, fire an action, close the paywall, or start a purchase.
Device-clock changes cause recalculation.

Countdown is not a per-second accessibility live region. It announces the current remaining-time
summary when focused and completion once. Studio provides a frozen preview instant and explicit
advance-time controls as workspace state; those controls never enter the document or preview as
document properties.

The device clock is not trusted server time. Studio and SDK documentation must state this
limitation and must not describe Countdown as tamper-proof scarcity.

### Content and action components

- **Text:** content, localization, typography, color, maximum lines, width, spacing, box appearance,
  visibility, semantic role/heading level, and optional localized accessibility-label override.
- **Image:** asset, fit/fill, aspect-ratio or fixed-height sizing, width, spacing, box appearance,
  visibility, and decorative/informative accessibility behavior.
- **Feature List:** localized items, marker, gap, marker/text colors, contextual typography, box
  appearance, spacing, visibility, and group accessibility metadata.
- **Icon:** the closed semantic names Checkmark, Close, Lock, Restore, External Link, Arrow
  Backward/Forward, and Chevron Backward/Forward; positive size; color; image-style
  accessibility; directional RTL mirroring; and contextual appearance, spacing, and visibility.
- **Button:** horizontal or vertical passive child layout, gap and alignment, one merged control
  accessibility target, appearance, sizing, spacing, visibility, one closed action, and optional
  Purchase/Restore-only `inProgressChildren`.

Button descendants may recursively contain only passive Stack, Text, Image, Icon, Feature List,
and Countdown content. Button, Product Selector, Switch, and Carousel descendants are invalid.

The closed actions are Purchase, Restore, Close, Navigate To, Navigate Back, and Open External
URL. Purchase references a Product Selector in the same screen. External URLs are absolute HTTPS,
at most 2,048 characters, contain no credentials or control characters, and do not dismiss the
paywall or add a normalized presentation outcome. A host refusal or open failure keeps the paywall
visible and emits a safe diagnostic.

### Product Selector and Product Card states

Product Selector owns one through twenty ordered Product Card children and an
`initialProductCardId`. Product Card is a real structural Layer only within that selector; it is
invalid in every generic node position. Each card owns a unique Product Reference binding within
its selector, vertical or horizontal passive layout, source-ordered children, an optional
localized accessibility label, and its own Default/Selected styles. Product Reference is only
provider-neutral identity and label metadata; it owns no visual badge.

Product Card descendants may recursively contain passive Stack, Text, Image, Icon, Feature List,
Countdown, and at most one Product Badge as a direct child. Interactive descendants, nested
selectors, Buttons, Carousels, and Switches are invalid. A card has no more than twenty passive
descendants and its nested Stack depth is at most four.

Product Badge is a real structural Layer only as a direct Product Card child. It owns passive
content, layout, and independent Default/Selected styles. Placement is either `nested`, which
participates in the card's normal source-order layout, or `overlay`, which uses logical
`topStart`, `topEnd`, `bottomStart`, or `bottomEnd` anchoring plus bounded logical insets. Overlay
never exposes freeform X/Y coordinates or z-index and mirrors start/end in RTL.

Product Card and Product Badge each serialize a complete Default box style—background, inside
border, uniform radius, logical padding, and opacity—and a recursively partial Selected override,
which may be `{}`. Resolution overlays present Selected leaves on Default. Resetting a leaf removes
only that leaf; full reset replaces Selected with `{}`. Content, typography, gap, alignment, and
placement are not stateful, so selection never changes structure or reading order.

Text below a Product Card and the card's localized accessibility label may contain only
`{{ product.name }}` and `{{ product.price }}`, with optional whitespace. Templates resolve after
locale selection from the bound provider product. Unknown, malformed, or out-of-context template
syntax rejects the entire document. Resolution never evaluates code or returns unresolved raw
template syntax.

The initial available card is `initialProductCardId`; if it is unavailable, the first available
card in source order is selected. Missing localized price makes a price-dependent card
unavailable. If no cards are available, the selector shows `unavailableFallback`, has no selected
card, and its Purchase action is disabled with a safe diagnostic. Changing selection updates both
card and badge styles plus native selected accessibility semantics atomically without mutating the
document. Renderer runtime state is keyed by selector ID and stores the selected Product Card ID.

Focus, pressed, loading, disabled, and unavailable visual chrome remain platform-native. Studio
warns when Default and Selected authoring is visually indistinguishable but does not reject the
document because native selected semantics still communicate state.

## Runtime, document, and Studio state boundary

| State                                           | Owner                | Serialized in paywall | Undo/autosave |
| ----------------------------------------------- | -------------------- | --------------------- | ------------- |
| Initial screen and forward navigation actions   | Document             | Yes                   | Yes           |
| Current screen and navigation history           | Renderer runtime     | No                    | No            |
| Stack direction, styling, visibility rule       | Document             | Yes                   | Yes           |
| Carousel pages and initial page                 | Document             | Yes                   | Yes           |
| Current Carousel page                           | Renderer runtime     | No                    | No            |
| Switch initial value                            | Document             | Yes                   | Yes           |
| Current Switch value                            | Renderer runtime     | No                    | No            |
| Countdown deadline and display configuration    | Document             | Yes                   | Yes           |
| Current Countdown remaining time                | Renderer runtime     | No                    | No            |
| Product Selector initial Product Card           | Document             | Yes                   | Yes           |
| Selected Product Card ID and resolved state     | Renderer runtime     | No                    | No            |
| Studio Default/Selected card preview            | Workspace preference | No                    | No            |
| Studio frozen Countdown preview instant         | Workspace preference | No                    | No            |

An accepted document revision resets screen navigation, Carousel page, Switch value, and every
selector's selected Product Card ID to the new configured/first-available value. Other runtime
state persists within one presentation unless its existing component semantics require a reset.

## Studio interaction and inspector contract

Studio borrows the attached Figma inspector's useful interaction density without copying its
freeform design model.

Use Mosaic design tokens and Phosphor icons for:

- strong contextual section dividers;
- compact labelled rows;
- two-column controls only for clearly related values;
- segmented icon controls for small enumerations;
- an accessible color swatch plus canonical value input;
- visible units and validation ranges;
- contextual reset actions;
- Product Card `Default | Selected` preview tabs; and
- progressive secondary sections with Advanced closed by default.

Do not expose X/Y position, freeform constraints, rotation, overlapping layers, multiple fills or
strokes, export controls, blend modes, or arbitrary effects.

The contextual coverage is:

| Element                | Sections                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Screen / Scroll Container | Content, Layout, Background, Accessibility, Advanced                                                          |
| Stack                  | Layout, Size, Spacing, Background, Border, Appearance, Visibility, Advanced                                      |
| Carousel               | Content, Layout, Size, Spacing, Background, Border, Appearance, Visibility, Accessibility, Advanced              |
| Switch                 | Content, Appearance, Spacing, Visibility, Accessibility, Advanced                                                |
| Countdown              | Content, Typography, Size, Spacing, Background, Border, Appearance, Visibility, Accessibility, Advanced          |
| Text                   | Content, Typography, Size, Spacing, Background, Border, Appearance, Visibility, Accessibility, Advanced          |
| Image                  | Content, Size, Spacing, Background, Border, Appearance, Visibility, Accessibility, Advanced                      |
| Feature List           | Content, Typography, Spacing, Background, Border, Appearance, Visibility, Accessibility, Advanced                |
| Icon                   | Content, Size, Spacing, Background, Border, Appearance, Visibility, Accessibility, Advanced                      |
| Product Selector       | Product Cards, Layout, Spacing, Background, Border, Appearance, Visibility, Accessibility, Advanced              |
| Product Card           | Product, Content, Layout, Spacing, Default/Selected Appearance, Accessibility, Advanced                           |
| Product Badge          | Content, Placement, Layout, Default/Selected Appearance, Advanced                                                 |
| Button                 | Content, Actions, Layout, Size, Spacing, Background, Border, Appearance, Visibility, Accessibility, Advanced    |

Common sections for the selected type open first. Secondary sections remain collapsed until used.
Advanced contains IDs, localization keys, capability details, and fixed protocol discriminators.
Validation navigation opens the owning section and focuses the exact field.

Canvas remains a selection/editing surface. Switch, Carousel, Product Card state, and Countdown
runtime preview controls belong in clearly labelled preview or inspector controls and connected
native previews; they must not make every canvas element interactive or draggable.

All document property changes:

- update browser and connected native previews immediately;
- form one explicit undo transaction for a related gesture or typing session;
- mark the document dirty;
- autosave through the accepted local path;
- revalidate exact property addresses; and
- enter portable export.

Runtime and workspace preview changes do none of those things.

## Accessibility, localization, and RTL

- Every new visible string and accessibility label uses the existing localized-text contract.
- Every screen in a multi-screen document has a localized accessibility label.
- Horizontal Stack source order runs from logical start to end and mirrors spatially in RTL.
- Directional Icon names mirror spatially in RTL without changing authored meaning.
- Button descendants merge into one control target and never create nested focus targets.
- Carousel page order remains source order; swipe direction and native gestures follow locale
  direction.
- Countdown visible digits follow the configured unit contract; its accessible remaining-time
  phrase uses the active locale.
- Hidden content is absent from semantics, reading order, focus, and hit testing.
- Product Card selection is communicated through native selected state, not color alone.
- Switch exposes native switch role, label, value, enabled state, and visible focus.
- Maximum-lines truncation never truncates the accessible value.
- All text honors host accessibility scaling. Studio must preview at least 100%, 150%, and 200%.
- Studio warns for insufficient text/background and control-boundary contrast, indistinguishable
  Product Card states, truncation risk, and horizontal overflow under accessibility scaling.
- Contrast warnings consider literal colors and composed opacity. Unknown host semantic mappings
  produce an explicit cannot-verify warning rather than a false pass.

## Safe defaults and failure behavior

Neutral absence defaults are normative:

- semantic inherited text and surface colors;
- transparent background;
- zero-width border;
- zero corner radius;
- opacity `1`;
- always visible;
- content size, except existing fill-width behavior preserved by migration;
- zero outer insets and padding where no existing value exists;
- clipping disabled, except Image radius clips its image; and
- no maximum lines.

Studio insertion creates a valid component:

- Stack is vertical and empty when nested;
- Carousel contains two valid labelled Slides with empty Stack content;
- Switch starts off with a visible localized label;
- Countdown requires an explicit valid deadline before insertion completes; an already expired
  deadline remains valid and previews the completed state; and
- Product Selector contains at least one valid authored Product Card and identifies its initial
  card; insertion may add a visible Default/Selected difference as an authoring aid;
- Product Card starts with passive localized name/price Text and complete semantic Default plus
  deterministic Selected box styles; and
- Product Badge starts nested with passive Text, while overlay placement requires one logical
  corner and bounded logical insets.

Invalid or unsupported `0.2` content is rejected atomically. The renderer never partially applies
recognized styles while ignoring an unknown style, component, state, reference, or condition.

## Required fixtures and conformance

The canonical complete Protocol `0.2` fixture must exercise:

- both Stack directions and recursive nesting;
- every existing component;
- Carousel with at least two localized Slides;
- Switch-controlled visibility for both Boolean values;
- active and completed Countdown states through a controlled clock;
- semantic and literal colors;
- sizing, padding, outer spacing, background, border, radius, opacity, and visibility;
- Text maximum lines and full accessibility value;
- Product Card Default and Selected appearance;
- Product Card Default inheritance, per-field Selected override, per-field reset, and full
  Selected reset;
- at least three differently authored Product Cards, one nested Product Badge, and one
  RTL-relevant logical overlay Product Badge;
- safe product name/price templates, initial and first-available selection, missing-price
  unavailability, and the no-available-card fallback;
- long German and Arabic RTL; and
- existing asset, unavailable-product, purchase, restore, close, and accessibility semantics.

Focused fixtures and tests must cover:

- invalid style ranges and unknown properties;
- invalid Stack/Carousel nesting and page bounds;
- missing, self-referential, and invalid Switch visibility references;
- a hidden purchase target;
- malformed and expired Countdown timestamps;
- long localization and 200% accessibility text;
- low contrast and indistinguishable Product Card authoring warnings;
- Product Card or Product Badge outside its valid parent, duplicate selector product bindings,
  interactive descendants, over-limit passive depth/count, and incomplete Default styles;
- malformed, unknown, and out-of-context product templates;
- unavailable products and changing initial Product Card selection;
- a valid `0.1` to `0.2` migration;
- a `0.2` document presented to a `0.1`-only client;
- missing or incomplete `0.2` capabilities; and
- Local Preview `0.2` schema/message validation, subprotocol negotiation, versioned fixtures, and
  a Protocol `0.2` draft withheld from a Local Preview `0.1`-only client.

Each SDK requires decoding, semantic validation, renderer, interaction, accessibility, snapshot or
golden, migration-input, fallback, and local-preview conformance tests.

## Acceptance criteria

Gate 2.5B is accepted only when:

1. Protocol `0.1` canonical artifacts and behavior remain unchanged.
2. Every valid `0.1` document is still accepted by all three current SDKs.
3. The migrator converts every valid canonical `0.1` input into a valid semantically equivalent
   `0.2` document.
4. The same complete two-screen `0.2` fixture renders Stack in both directions, Text-plus-Icon
   Button content, every action, Carousel, Switch, Countdown, three structurally different Product
   Cards, nested/overlay Product Badges, safe product templates, and both authored states in
   Flutter, SwiftUI, and Compose.
5. Unsupported clients reject `0.2` atomically and keep the last accepted or bundled fallback.
6. Hidden nodes occupy no layout space and are absent from interaction and accessibility order on
   all three platforms.
7. Navigation history, Carousel, Switch, Product Card selection, and Countdown change runtime
   state without changing document revision, undo history, autosave, or export.
8. Countdown produces equivalent remaining/completed semantics under a controlled clock on all
   three platforms and does not continuously announce each tick.
9. Product Card selection updates authored appearance and native selected semantics atomically.
10. Product Card Default is complete, Selected resolves as deterministic per-leaf overrides, and
    per-field and full Selected reset preserve inheritance without copying Default values.
11. Product Card/Product Badge parentage and passive limits validate identically; selection uses
    initial/first-available order, and no available card disables Purchase safely.
12. Only name/price product templates resolve, only within Product Card scope, without executable
    evaluation or leaked raw template syntax.
13. Local Preview `0.2` carries Protocol `0.2` through its versioned schemas, messages, fixtures,
    and exact subprotocol only after capability negotiation; Local Preview `0.1` remains unchanged
    and works with older peers.
14. All screen/action references, global component identifiers, Button descendant rules, forward
    reachability/acyclicity, and HTTPS URL constraints validate identically in every first-party
    reader.
15. Studio exposes every approved `0.2` field in its relevant contextual section and no deferred
    field.
16. Inspector changes update browser and connected native previews immediately, create one undo
    entry per edit transaction, autosave, validate, and export correctly.
17. Validation selects the affected layer, opens the owning section, and focuses the exact field.
18. Long German, Arabic RTL, 200% text scaling, missing assets, unavailable products, expired
    Countdown, hidden content, and unsupported-client scenarios pass the defined behavior.
19. Studio emits explicit contrast, truncation, indistinguishable-state, and horizontal-overflow
    warnings without blocking unrelated editing.
20. A keyboard and screen-reader user can operate every new inspector control, Switch, Carousel,
    and Product Card state preview with visible focus and accessible names.
21. Protocol, Local Preview, dashboard, Flutter, iOS, and Android documentation and changelogs
    describe `0.2`, migration, negotiation, limitations, and safe failure.
22. No generated protocol, API, or route file is manually edited.

## Bounded implementation sequence

1. **Contract freeze**
   - Add the reviewed Protocol `0.2` schema, manifest, capability model, semantic validation rules,
     migration contract, documentation, and fixture plan.
   - Add the reviewed Local Preview `0.2` schemas, messages, fixtures, exact subprotocol, and
     negotiation rules while preserving Local Preview `0.1`.
   - Regenerate browser types from the source schema.
   - Stop for protocol and product review before renderer or Studio implementation.
2. **Canonical fixtures and validators**
   - Complete the canonical and focused fixtures, strict validation, capability derivation,
     migration validation, Local Preview `0.2` validation/negotiation, unknown-property rejection,
     and safe-failure tests.
3. **Native renderer proof**
   - Implement the same frozen contract in Flutter, SwiftUI, and Compose with no platform-specific
     schema extensions.
   - Complete decoding, rendering, state, accessibility, golden/snapshot, and fallback tests.
4. **Studio document model and structure**
   - Consume regenerated types, migrate `verticalStack` editing to Stack, add components, Layers,
     insertion defaults, tree legality, validation addresses, and import/export migration.
5. **Contextual inspector and preview**
   - Add the Mosaic-styled Figma-inspired property sections, color controls, Product Card state
     preview, Switch/Carousel runtime preview, frozen Countdown time, and connected preview support.
6. **Integration and gate review**
   - Run complete protocol, dashboard, Flutter, iOS, Android, local-preview, migration,
     accessibility, RTL, long-localization, and safe-failure checks.
   - Complete product, UX, and quality review and the full Phase 2.5 report.

Do not begin with Studio-only controls. A property is not available in Studio until the canonical
contract and all three native renderer implementations exist or are integrated as one frozen
vertical slice.

## Explicit deferrals

- Container, Spacer, Divider, standalone Badge, Video, Sticky Footer, Grid, and arbitrary conditional
  components;
- Carousel autoplay, looping, vertical axis, animated transitions, and remote pages;
- Switch actions, direct product selection, entitlement binding, analytics binding, and arbitrary
  field mutation;
- session-relative, server-synchronized, or action-triggering Countdown behavior;
- gradients, image fills, multiple fills or borders, shadows, blur, blend modes, and per-corner
  radii;
- X/Y position, constraints, rotation, overlap, z-index, and freeform canvas layout;
- percentages, viewport sizing, fill height, and general min/max constraint chains;
- custom fonts, rich text, links, letter spacing, general-purpose interpolation, plurals, and text
  effects beyond the closed Product Card name/price templates;
- custom project design-token catalogs and animations;
- authored Product Card focus, pressed, loading, disabled, or unavailable states;
- real billing-provider, hosted configuration, publishing, placement, analytics, or experiment work.

## Review gate

The final Gate 2.5B review must include:

- protocol and migration conformance;
- Local Preview `0.1` preservation and Local Preview `0.2` schemas, messages, fixtures,
  subprotocol negotiation, capability gating, and fallback conformance;
- exact capability and safe-failure status;
- Flutter, SwiftUI, and Compose component/style matrix;
- runtime-versus-document state conformance;
- Studio contextual inspector and Layers coverage;
- localization, RTL, accessibility scaling, contrast, and truncation findings;
- Product Card state findings;
- fixture, snapshot/golden, interaction, migration, and fallback test results;
- unresolved defects and deferred scope; and
- the task demo result.

The task demo is:

```text
Open a Protocol 0.1 paywall
→ migrate it to Protocol 0.2
→ change the root content to use vertical and horizontal Stacks
→ add and reorder Carousel Slides
→ add a Switch and use it to control a section's visibility
→ add a Countdown and preview active and completed time
→ style text, background, border, radius, spacing, opacity, and visibility
→ author and preview Product Card Default and Selected states
→ add nested and logical-overlay Product Badges and verify Arabic RTL anchoring
→ make the initial product unavailable and confirm first-available/no-available behavior
→ reset one Selected field and then the full Selected state to confirm Default inheritance
→ switch to long German, Arabic RTL, and 200% text
→ resolve a contrast or truncation warning
→ preview the same document in Flutter, SwiftUI, and Compose
→ export, reload, and confirm document and workspace-state boundaries
→ negotiate Local Preview 0.2 with a capable client
→ connect a Local Preview 0.1-only client, withhold the Protocol 0.2 draft, and show the explicit incompatibility recovery
```

Classify Gate 2.5B as Accepted, Accepted with tracked follow-ups, or Rejected pending fixes. Phase
2.5 can be accepted only when Gate 2.5A also passes. Phase 3 remains blocked.

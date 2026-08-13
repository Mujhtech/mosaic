# Analytics export names

## Normative statements

1. **The canonical event names are unprefixed.** `placement_requested`,
   `purchase_completed_client`, `experiment_exposed`, and every other name in
   the tables below are the contract names. They are what the SDKs emit, what
   `POST /v1/analytics/events` accepts, what
   `protocol/schema/analytics-event/v2/event.schema.json` enumerates in
   `$defs/eventName`, and what appears in every canonical fixture.

2. **Mosaic's own exports emit canonical unprefixed names.** Mosaic's NDJSON and
   CSV analytics exports write the canonical name verbatim in the event-name
   field. Mosaic performs no renaming, prefixing, or namespacing on export. A
   consumer reading a Mosaic export can join it directly against the schema
   enumeration.

3. **`mosaic_*` is a recommended convention, not a Mosaic behaviour.** When
   Mosaic events are forwarded into a *third-party downstream destination* — a
   warehouse table, or a product-analytics tool where Mosaic events share an
   event namespace with events from other sources — prefixing with `mosaic_` is
   the recommended convention. Mapping is applied by the operator in their own
   pipeline. Nothing in Mosaic produces a `mosaic_`-prefixed name, and nothing in
   Mosaic accepts one.

4. **Provider-native namespaces are reserved.** `rc_*` (RevenueCat) and `af_*`
   (AppsFlyer) are reserved prefixes. Mosaic never emits them and a Mosaic event
   must never be renamed into them. Events arriving in a shared destination under
   those prefixes originate from the provider, not from Mosaic; treating them as
   interchangeable with Mosaic events double-counts monetization outcomes.

5. **Renaming does not change contract identity.** A downstream rename is a
   presentation choice in the operator's pipeline. It never affects contract
   version negotiation, schema validation, or the `eventSchemaVersion` field.
   Applying a different convention is not a protocol change and requires no
   contract version.

## Recommended mapping — Analytics Event v2

All 31 events. Contract version `2`; `eventSchemaVersion: "2"`.

| Canonical wire name (normative) | Recommended downstream name | Family |
| --- | --- | --- |
| `placement_requested` | `mosaic_placement_requested` | Placement |
| `placement_paywall_selected` | `mosaic_placement_paywall_selected` | Placement |
| `placement_no_paywall` | `mosaic_placement_no_paywall` | Placement |
| `placement_fallback_used` | `mosaic_placement_fallback_used` | Placement |
| `placement_unavailable` | `mosaic_placement_unavailable` | Placement |
| `placement_evaluation_failed` | `mosaic_placement_evaluation_failed` | Placement |
| `paywall_presented` | `mosaic_paywall_presented` | Presentation |
| `paywall_dismissed` | `mosaic_paywall_dismissed` | Presentation |
| `paywall_action_selected` | `mosaic_paywall_action_selected` | Presentation |
| `paywall_render_failed` | `mosaic_paywall_render_failed` | Presentation |
| `product_load_started` | `mosaic_product_load_started` | Product |
| `product_load_completed` | `mosaic_product_load_completed` | Product |
| `product_load_failed` | `mosaic_product_load_failed` | Product |
| `product_unavailable` | `mosaic_product_unavailable` | Product |
| `product_selected` | `mosaic_product_selected` | Product |
| `purchase_started` | `mosaic_purchase_started` | Purchase |
| `purchase_completed_client` | `mosaic_purchase_completed_client` | Purchase |
| `purchase_completed_provider` | `mosaic_purchase_completed_provider` | Purchase |
| `purchase_pending` | `mosaic_purchase_pending` | Purchase |
| `purchase_deferred` | `mosaic_purchase_deferred` | Purchase |
| `purchase_cancelled` | `mosaic_purchase_cancelled` | Purchase |
| `purchase_failed` | `mosaic_purchase_failed` | Purchase |
| `restore_started` | `mosaic_restore_started` | Restore |
| `restore_completed` | `mosaic_restore_completed` | Restore |
| `restore_nothing_found` | `mosaic_restore_nothing_found` | Restore |
| `restore_cancelled` | `mosaic_restore_cancelled` | Restore |
| `restore_failed` | `mosaic_restore_failed` | Restore |
| `experiment_assigned` | `mosaic_experiment_assigned` | Experiment |
| `experiment_exposed` | `mosaic_experiment_exposed` | Experiment |
| `experiment_fallback_presented` | `mosaic_experiment_fallback_presented` | Experiment |
| `experiment_assignment_failed` | `mosaic_experiment_assignment_failed` | Experiment |

The recommended name is derived from the canonical name alone. A downstream
destination distinguishes contract revisions by `eventSchemaVersion`, never by
name: renaming per contract version would break longitudinal analysis across a
contract upgrade.

## Reserved prefixes

| Prefix | Owner | Mosaic behaviour |
| --- | --- | --- |
| *(none)* | Mosaic contract | Canonical wire and export names |
| `mosaic_` | Reserved for Mosaic events in shared third-party destinations | Never emitted or accepted by Mosaic |
| `rc_` | RevenueCat provider-native events | Never emitted; never a rename target for a Mosaic event |
| `af_` | AppsFlyer provider-native events | Never emitted; never a rename target for a Mosaic event |

## Applying the convention

Apply the mapping at the boundary where Mosaic events enter the shared
namespace — the warehouse loader or destination-side transformation — not
inside Mosaic. Two properties matter:

- **Total and reversible.** Map every event or none. A partial mapping produces
  two names for one behaviour and silently splits funnels.
- **Version-independent.** Derive the downstream name from the canonical name
  alone. Preserve `eventSchemaVersion` as its own column so a contract upgrade
  is visible without changing event identity.

## Related documents

- [Analytics Event Contract v2](analytics-event-v2.md)
- [Compatibility policy](compatibility-policy.md)

# Mosaic protocol migration guides

Per-version upgrade guides for contracts with more than one approved version.

Every version listed here is **approved and current**. A later version does not
supersede an earlier one: both remain valid negotiated representations, and the
server selects the highest one the reader declared. Migrate when you need what
the later version adds — not because it is newer.

| Guide | Adds |
| --- | --- |
| [Configuration Delivery 1 → 2](delivery-v1-to-v2.md) | Placement Decision Rule Sets; conditional and `no_paywall` outcomes |
| [Configuration Delivery 2 → 3](delivery-v2-to-v3.md) | Atomic Experiment Assignment definitions |
| [Analytics Event 1 → 2](analytics-event-v1-to-v2.md) | Immutable Experiment attribution and four Experiment events |
| [Commerce Provider Contract 1 → 2](commerce-provider-v1-to-v2.md) | Asynchronous commerce updates, native recovery, local acceptance |
| [Commerce Configuration 1 → 2](commerce-configuration-v1-to-v2.md) | Direct native-store activation and exact native selectors |

No guide exists for Paywall Protocol `0.3`, Local Preview `0.3`, Placement
Decision `1`, or Experiment Assignment `1`: each has exactly one approved
version, and the retired RC-candidate migration tools were removed from the
tree; there is no upgrade path from unapproved candidates.

## Coupled migrations

Two pairs must move together.

**Delivery v3 requires Analytics Event v2.** Adopting Experiments without moving
the conversion events to v2 yields exposures with zero matching conversions, with
no error reported. See
[the compatibility policy](../compatibility-policy.md#experiment-conversion-attribution-requires-v2-emission).

**Commerce Provider v2 and Commerce Configuration v2 are designed together.** v2
operations bind to the accepted Commerce Configuration v2 content digest.

## Related documents

- [Compatibility policy](../compatibility-policy.md)
- [Deprecation policy](../deprecation-policy.md)
- [Breaking-change process](../breaking-change-process.md)
- [Versioning](../versioning.md)

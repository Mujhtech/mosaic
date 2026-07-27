# Commerce Provider Contract 1 → 2

Both versions are approved and current. v2 is a **parallel exact reader**, not a
replacement: v1 remains valid and a client receives v2 only after declaring exact
v2 support. Records from different versions are **never combined**.

## Why v2 exists

v1 assumes commerce operations are request/response: the SDK asks, the provider
answers. v2 adds the cases where the *store* speaks first or later — a
transaction confirmed while the app was closed, a purchase recovered from the
native store, a delayed update arriving out of band — and a way for the client to
acknowledge such an update locally.

## Schema delta

Discriminator: `commerceProviderContractVersion` `"1"` → `"2"`. Envelope shape is
unchanged: `{ commerceProviderContractVersion, recordType, payload }`.

**Two record types added** (8 → 10):

| Record type | Meaning |
| --- | --- |
| `commerceUpdate` | An asynchronous commerce update originating from the provider or native store. |
| `commerceUpdateAcceptance` | The client's local disposition of such an update. |

**Six capabilities added** (13 → 19):

| Capability | Meaning |
| --- | --- |
| `basePlans` | Google Play base plans. |
| `explicitOffers` | Explicitly identified store offers. |
| `storeSynchronization` | Synchronization with native store state. |
| `activePurchaseRecovery` | Recovering active purchases from the native store. |
| `asynchronousCommerceUpdates` | Receiving out-of-band commerce updates. |
| `localDeliveryAcceptance` | Locally acknowledging delivery of an update. |

The 13 v1 capabilities are unchanged. `recoveryMode` and `configurationReference`
definitions are added in support of the above.

All v1 record types, outcomes, state machines, and properties are unchanged. Every
valid v1 record is a valid v2 record once the discriminator is `"2"`.

## Configuration revision binding

A v2 operation or update references the exact accepted **Commerce Configuration v2
content digest** as `configurationRevision`. A different digest is a different
immutable revision. Readers do not compare numeric ordering, accept aliases, or
treat a digest as approximately equal to another.

This matters because an asynchronous update may arrive after configuration
changed. Binding by digest means the client can tell whether the update refers to
the configuration it currently holds, instead of assuming it does.

## Reader changes required

1. Declare exact v2 support. Until then the server sends v1, which is correct
   behaviour and not a degradation.
2. Handle `commerceUpdate` and `commerceUpdateAcceptance`, including the
   acceptance disposition enumeration.
3. Declare only the capabilities you actually implement. Declaring
   `activePurchaseRecovery` without implementing it means recovery records arrive
   and are dropped — which loses a purchase the customer already made.
4. Bind operations to the accepted Commerce Configuration v2 content digest.
5. Never merge v1 and v2 records in one state machine. Mixing an unknown provider
   state with a known one risks rendering an entitled customer as unentitled,
   which is a release-blocker category.
6. Reject unknown versions, record types, outcomes, and properties.

## Provider identity remains opaque

Provider identifiers stay opaque values in both versions. Capability names and
normalized state machines are closed enumerations. A new provider does not
require a contract change; a new *capability* does.

## Verification

- `protocol/fixtures/commerce-provider/v2/` — canonical records for every record
  type including the two new ones.

These fixtures are **tool-verified only** — validated by
`protocol/tools/commerce-provider-validation-v2.mjs`, not consumed by SDK
conformance suites. Recorded in `docs/known-limitations.md`.

## Related documents

- [Commerce Provider Contract v1](../commerce-provider-v1.md)
- [Commerce Provider Contract v2](../commerce-provider-v2.md)
- [Commerce Configuration v1 → v2](commerce-configuration-v1-to-v2.md)

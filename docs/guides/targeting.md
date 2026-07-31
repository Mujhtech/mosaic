# Targeting

Targeting is the condition language inside Placement rules (see the
[placements guide](placements.md)). Conditions read a closed set of inputs,
compare them with a fixed set of operators, and — critically — treat missing
or unreliable data as `unknown` rather than guessing.

## Inputs

Keyless inputs: `device.platform`, `device.os_version`, `application.version`,
`application.locale`, `context.country`, `environment.id`, `environment.key`,
`identity.user_present`. Country comes only from the host application; Mosaic
never infers it from locale, timezone, currency, or IP.

Keyed inputs: `user_attribute`, `entitlement_state`, `product_availability`,
`product_readiness`, `provider_capability`.

## Attributes

Custom user attributes are declared per Project (dashboard: the Attributes
panel on a Placement's Rules tab; API:
`GET/POST /v1/projects/{projectId}/placement-attributes`). A definition has a
key, a type (`string`, `boolean`, `number`, `timestamp`, `semantic_version`,
or `string_list`), a sensitivity marking, and the set of operators rules may
use with it.

Only the definitions live on the server. Attribute values are set by your app
through the SDK and stay on the device; they are never uploaded, and Placement
evaluation happens locally against them.

## Operators

Thirteen operators: `equals`, `not_equals`, `in`, `not_in`, `greater_than`,
`greater_than_or_equal`, `less_than`, `less_than_or_equal`, `exists`,
`does_not_exist`, `contains_any`, `contains_all`, `locale_matches`.
`exists`/`does_not_exist` take no operand; all others require one.
`locale_matches` uses RFC 4647 basic filtering, and locales are normalized on
both sides (`en_US` matches `en-US`). Version comparisons use semantic-version
ordering — a malformed version is `unknown`, never compared lexically.

## Three-state evaluation

Every condition leaf evaluates to `true`, `false`, or `unknown`:

- Comparing against a missing, malformed, or type-incompatible value is
  `unknown` (except `exists`, which is false, and `does_not_exist`, which is
  true, for a missing value).
- `all` is false if any child is false, otherwise unknown if any child is
  unknown. `any` is true if any child is true, otherwise unknown if any child
  is unknown. `not` flips true/false and preserves unknown.
- A rule whose condition is false **or unknown** is skipped — it can never
  win. Unknown is never coerced to false data.

This matters most for Entitlement state: an Entitlement observation of
`unknown`, `provider_unavailable`, or `failed` is never treated as
`inactive`, so a provider outage cannot silently push paying customers into a
paywall rule meant for non-subscribers.

## Simulator

Test conditions from the Simulator tab on the Placement detail page (API:
`POST .../rule-sets/{ruleSetId}/simulate`). You supply platform, versions,
locale, country, identities, attributes, Entitlement states, and Product
availability, and get back the winning rule, outcome, rollout bucket, and a
step-by-step trace. Inputs are ephemeral — neither logged nor persisted.

## Verification status

Operator semantics, three-state propagation, and locale/semver handling are
defined in
[docs/protocol/placement-decision-v1.md](../protocol/placement-decision-v1.md)
and verified by the shared conformance corpus consumed by all three SDKs.

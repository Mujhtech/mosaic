# Experiment Assignment Contract changelog

## Version 1 - 2026-07-26

Status: release candidate

- Added immutable platform-neutral Experiment, Version, Placement, Control, Variant, Paywall Version, and allocation identities.
- Added exactly one Control and one to three Treatments with complete half-open ranges over 10,000 buckets.
- Added installation, identified-user, and explicit identified-user fallback assignment policies using versioned length-prefixed SHA-256 bucketing.
- Added trusted-time scheduling, mutual-exclusion group ranges, safe QA override metadata, normal-Placement fallback, and exact compatibility derivation.
- Added shared assignment/group vectors and focused Control, Treatment, QA, schedule, inactive, fallback, unsupported, and malformed-allocation cases.
- Group Version membership references stable Experiment IDs rather than unpublished Experiment Version IDs; each delivered Assignment separately pins its exact immutable Experiment Version.
- `schedule.startsAt` remains required for immediate and scheduled activation;
  `schedule.endsAt` is optional for manual completion and must follow start when
  present.

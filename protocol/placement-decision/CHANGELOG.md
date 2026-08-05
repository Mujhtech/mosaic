# Placement Decision Contract changelog

## Version 1 - 2026-07-26

Status: approved at v1 GA (2026-07-27); released as a candidate on 2026-07-26

- Added a closed, platform-neutral three-state Placement decision model with explicit priority, bounded conditions, typed values, exact compatibility requirements, and safe diagnostic labels.
- Added platform, semantic version, locale, explicit country, identity, allow-listed attribute, Entitlement, Product, readiness, and provider-capability inputs.
- Added exact Paywall, `no_paywall`, named fallback, and unavailable outcomes with bounded acyclic fallback resolution.
- Added explicit assignment policies and `sha256_length_prefixed_v1` rollout with shared UTF-8 conformance vectors.
- Added non-production, high-entropy token-digest QA override metadata with a 24-hour maximum lifetime and privacy-safe trace requirements.
- Added a shared evaluator corpus and focused invalid fixtures for unsupported operators, malformed condition kinds, duplicate priorities, and fallback cycles.
- Clarified that locale equality and membership use the same canonical normalization as locale filtering, and added conformance vectors for underscore-delimited runtime locales and malformed runtime semantic versions.
- Clarified (2026-08-05) that locale normalization drops empty subtags and truncates at the first singleton subtag, so extension and private-use sequences in a runtime tag (`en-US-u-rg-gbzzzz`, `de-DE-x-corp`) compare on their language-script-region core. Runtime-input clarification only; the authored operand grammar is unchanged. Conformance vectors added for Unicode-extension, private-use, and empty-subtag runtime locales.
- Clarified (2026-08-05) that normalization first cuts the value at `@`, `.`, or `#`, so the ICU keyword, POSIX charset, and Java `Locale.toString` identifier shapes denote the locale they name. Runtime-input clarification only; a value that is still unnormalizable is not retargeted onto its language subtag.
- Clarified (2026-08-05) that presence is uniform across host-supplied inputs: an unrecognized `context.country` exists and compares unknown rather than being absent, matching `application.locale`, the version sources, and `device.platform`. Conformance vectors added for invalid and absent country against `exists`, `does_not_exist`, `equals`, and `not_equals`.
- Clarified (2026-08-05) that a value outside a closed vocabulary compares unknown rather than false, so an out-of-set `device.platform` cannot become a positive match under a negated group. Conformance vectors added for direct and negated conditions.
- Clarified (2026-08-05) that an authored locale operand with no canonical form makes `equals`, `not_equals`, `in`, and `not_in` unknown rather than false, and that a single unusable member makes a whole `in`/`not_in` list unknown even when another member matches. Conformance vectors added for each arm.
- Clarified (2026-08-05) that a host-supplied locale that cannot be normalized exists and compares unknown rather than being absent, that an unnormalizable authored range makes `locale_matches` unknown rather than false, and that the authored range grammar has no `*` wildcard. Conformance vectors added for all three, including a negated range condition that distinguishes unknown from false.

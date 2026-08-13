final RegExp _language = RegExp(r'^[A-Za-z]{2,8}$');
final RegExp _subtag = RegExp(r'^[A-Za-z0-9]{1,8}$');
final RegExp _script = RegExp(r'^[A-Za-z]{4}$');
final RegExp _region = RegExp(r'^(?:[A-Za-z]{2}|[0-9]{3})$');

/// The canonical comparison form of one locale tag, or `null` when nothing
/// usable remains.
///
/// This mirrors `protocol/tools/locale-resolution.mjs`
/// (`canonicalLocaleTag`), the reference implementation of the 2026-08-05
/// locale-semantics rulings. Placement targeting and catalog lookup share one
/// rule deliberately: the two subsystems must not disagree about what "the same
/// locale" is. Underscores become hyphens, empty subtags are dropped, the tag
/// is truncated at the first singleton subtag (`-u-`, `-t-`, `-x-`), the
/// language subtag is lowercased, a script subtag becomes title case, and a
/// two-letter or three-digit region is uppercased.
///
/// Hosts hand Mosaic whatever their platform produced, and the realistic
/// sources disagree with that form. Dart's `Platform.localeName` is POSIX
/// (`en_US`, and on desktop `en_US.UTF-8`), a region override adds an ICU
/// keyword (`en_US@rg=gbzzzz`), and `Locale.toLanguageTag()` can carry BCP-47
/// extensions (`en-US-u-ca-buddhist`). Passing any of those through unchanged
/// drops every analytics event and every locale-targeted rule, invisibly, and
/// precisely on the devices that have a region override configured.
///
/// The value is cut at the first ICU keyword (`@`), POSIX codeset (`.`), or
/// Java `Locale.toString` extension marker (`#`), so `en_US@rg=gbzzzz`,
/// `en_US.UTF-8`, and `en_US_#u-rg-gbzzzz` all denote `en-US`.
///
/// `null` means "the host named no usable locale". It is never replaced with a
/// fabricated tag: inventing `en` would both mislabel telemetry and make an
/// `en` targeting rule match a device that never claimed English. Catalog
/// lookup — and only catalog lookup — recovers a language subtag from such a
/// value through [mosaicRecoverLocaleLanguage].
String? mosaicNormalizeLocaleTag(String? value) {
  if (value == null) return null;
  var working = value.trim();
  final suffix = working.indexOf(RegExp(r'[@.#]'));
  if (suffix >= 0) working = working.substring(0, suffix);
  final subtags = <String>[];
  for (final part in working.replaceAll('_', '-').split('-')) {
    if (part.isEmpty) continue;
    if (part.length == 1) break;
    subtags.add(part);
  }
  if (subtags.isEmpty ||
      subtags.length > 8 ||
      !_language.hasMatch(subtags.first) ||
      subtags.skip(1).any((part) => !_subtag.hasMatch(part))) {
    return null;
  }
  return <String>[
    subtags.first.toLowerCase(),
    for (final part in subtags.skip(1))
      if (_script.hasMatch(part))
        '${part[0].toUpperCase()}${part.substring(1).toLowerCase()}'
      else if (_region.hasMatch(part))
        part.toUpperCase()
      else
        part.toLowerCase(),
  ].join('-');
}

/// The leading language subtag of a value [mosaicNormalizeLocaleTag] cannot
/// canonicalize, or `null` when even that is unusable.
///
/// **Catalog lookup only.** The 2026-08-05 ruling scopes language-subtag
/// recovery deliberately: in lookup, a tag such as `en-US-verylongsubtag` would
/// otherwise skip the `en` catalog it plainly denotes and fall through to the
/// document's own fallback, which is a worse answer than the language the host
/// actually named. In targeting, the same recovery would change *which users
/// match a Rule*, so the evaluator must keep treating an unnormalizable locale
/// as present-but-unknown instead. Do not reach for this from the decision
/// path.
String? mosaicRecoverLocaleLanguage(String? value) {
  if (value == null) return null;
  var working = value.trim();
  final suffix = working.indexOf(RegExp(r'[@.#]'));
  if (suffix >= 0) working = working.substring(0, suffix);
  for (final part in working.replaceAll('_', '-').split('-')) {
    if (part.isEmpty) continue;
    return _language.hasMatch(part) ? part.toLowerCase() : null;
  }
  return null;
}

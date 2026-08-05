import 'package:flutter/widgets.dart';

import 'locale_tag.dart';
import 'protocol.dart';

final class MosaicResolvedText {
  const MosaicResolvedText({
    required this.value,
    required this.locale,
    required this.direction,
  });

  final String value;
  final String? locale;
  final MosaicLocaleDirection direction;
}

/// A locale decision shared by every visible and accessibility string.
final class MosaicResolvedLocalization {
  MosaicResolvedLocalization({
    required MosaicLocalization localization,
    required Iterable<String> candidates,
  })  : _localization = localization,
        candidates = List.unmodifiable(candidates),
        _resolvedDirection = _direction(localization, candidates);

  final MosaicLocalization _localization;
  final List<String> candidates;
  final MosaicLocaleDirection? _resolvedDirection;

  /// Whether any locale in the fallback chain declared a writing direction.
  ///
  /// When this is `false` the paywall lays out left to right because something
  /// must be chosen, not because a catalog said so. An RTL paywall rendered LTR
  /// is a visible defect, so callers report it rather than accept it.
  bool get directionIsDeclared => _resolvedDirection != null;

  MosaicLocaleDirection get direction =>
      _resolvedDirection ?? MosaicLocaleDirection.ltr;

  TextDirection get textDirection => direction == MosaicLocaleDirection.rtl
      ? TextDirection.rtl
      : TextDirection.ltr;

  MosaicResolvedText resolve(MosaicLocalizedText text) {
    for (final locale in candidates) {
      final value =
          _localization.locales[locale]?.strings[text.localizationKey];
      if (value != null) {
        return MosaicResolvedText(
          value: value,
          locale: locale,
          direction: direction,
        );
      }
    }
    return MosaicResolvedText(
      value: text.defaultValue,
      locale: null,
      direction: direction,
    );
  }

  String text(MosaicLocalizedText value) => resolve(value).value;

  /// The first declared direction in the full fallback chain, or `null` when no
  /// locale in it is declared.
  static MosaicLocaleDirection? _direction(
    MosaicLocalization localization,
    Iterable<String> candidates,
  ) {
    for (final locale in <String>[
      ...candidates,
      localization.defaultLocale,
      localization.fallbackLocale,
    ]) {
      final catalog = localization.locales[locale];
      if (catalog != null) return catalog.direction;
    }
    return null;
  }
}

final class MosaicLocaleResolver {
  const MosaicLocaleResolver();

  MosaicResolvedLocalization resolve(
    MosaicPaywallDocument document, {
    String? requestedLocale,
  }) {
    final localization = document.localization;
    // Catalog keys are authored in one canonical form, so the requested tag is
    // canonicalized to that same form and matched exactly. Matching a raw
    // platform string would simply miss the one catalog that exists: a `PT_br`
    // device would render the fallback catalog rather than its own.
    // Lookup — and only lookup — recovers the leading language subtag when the
    // whole tag has no canonical form, so `en-US-verylongsubtag` still reaches
    // the `en` catalog instead of falling through to the document's fallback.
    // Placement targeting deliberately does not recover: there it would change
    // which users match a Rule.
    final requested = mosaicNormalizeLocaleTag(requestedLocale) ??
        mosaicRecoverLocaleLanguage(requestedLocale);
    final ordered = <String>[];

    void add(String? locale) {
      if (locale != null && locale.isNotEmpty && !ordered.contains(locale)) {
        ordered.add(locale);
      }
    }

    // The Protocol 0.2 candidate chain, in order. A requested locale with no
    // canonical form contributes no candidate rather than matching anything,
    // which leaves the declared fallback and default exactly as they are. There
    // is no language-plus-region reduction step in 0.2: `zh-Hans-CN` reduces to
    // `zh`, never to `zh-CN`.
    add(requested);
    if (requested != null) add(requested.split('-').first);
    add(localization.fallbackLocale);
    add(localization.defaultLocale);

    return MosaicResolvedLocalization(
      localization: localization,
      candidates: ordered.where(localization.locales.containsKey),
    );
  }
}

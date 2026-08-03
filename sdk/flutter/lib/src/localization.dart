import 'package:flutter/widgets.dart';

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
    final requested = requestedLocale?.trim();
    final ordered = <String>[];

    void add(String? locale) {
      if (locale != null && locale.isNotEmpty && !ordered.contains(locale)) {
        ordered.add(locale);
      }
    }

    if (requested != null && requested.isNotEmpty) {
      add(requested);
      add(requested.split('-').first);
      add(localization.fallbackLocale);
      add(localization.defaultLocale);
    } else {
      add(localization.defaultLocale);
      add(localization.fallbackLocale);
    }

    return MosaicResolvedLocalization(
      localization: localization,
      candidates: ordered.where(localization.locales.containsKey),
    );
  }
}

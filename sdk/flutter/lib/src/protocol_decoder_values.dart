part of 'protocol.dart';

extension on MosaicProtocolDecoder {
  MosaicTypography _v02Typography(
    Object? value,
    String path, {
    required bool allowMaximumLines,
  }) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'style',
        'fontSize',
        'lineHeightMultiplier',
        'weight',
        'color',
        'alignment',
      },
      path,
      optional: allowMaximumLines
          ? const <String>{'maxLines', 'overflow'}
          : const <String>{},
    );
    final hasMaximum = object.containsKey('maxLines');
    final hasOverflow = object.containsKey('overflow');
    if (hasMaximum != hasOverflow) {
      throw MosaicProtocolException(
        'Typography maxLines and overflow must appear together at $path.',
      );
    }
    return MosaicTypography(
      style: _v02TextStyle(object['style'], '$path.style'),
      fontSize: _boundedNumber(
        object['fontSize'],
        '$path.fontSize',
        minimum: 8,
        maximum: 96,
      ),
      lineHeightMultiplier: _boundedNumber(
        object['lineHeightMultiplier'],
        '$path.lineHeightMultiplier',
        minimum: 0.8,
        maximum: 3,
      ),
      weight: _v02FontWeight(object['weight'], '$path.weight'),
      color: _v02Color(object['color'], '$path.color'),
      alignment: _textAlignment(object['alignment'], '$path.alignment'),
      maxLines: hasMaximum
          ? _integerInRange(
              object['maxLines'],
              '$path.maxLines',
              minimum: 1,
              maximum: 100,
            )
          : null,
      overflow: hasOverflow
          ? switch (_enumValue(
              object['overflow'],
              const <String>{'clip', 'ellipsis'},
              '$path.overflow',
            )) {
              'clip' => MosaicTextOverflow.clip,
              'ellipsis' => MosaicTextOverflow.ellipsis,
              final unreachable =>
                throw StateError('Unhandled overflow "$unreachable".'),
            }
          : null,
    );
  }

  MosaicTextAccessibility _v02TextAccessibility(
    Object? value,
    String path, {
    required bool allowHeading,
  }) {
    final object = _object(value, path);
    final role = _string(object['role'], '$path.role');
    final optional = const <String>{'label'};
    if (role == 'text') {
      _expectKeys(
        object,
        const <String>{'role'},
        path,
        optional: optional,
      );
      return MosaicTextAccessibility(
        role: MosaicTextAccessibilityRole.text,
        label: object.containsKey('label')
            ? _localizedText(object['label'], '$path.label')
            : null,
      );
    }
    if (allowHeading && role == 'heading') {
      _expectKeys(
        object,
        const <String>{'role', 'level'},
        path,
        optional: optional,
      );
      return MosaicTextAccessibility(
        role: MosaicTextAccessibilityRole.heading,
        level: _integerInRange(
          object['level'],
          '$path.level',
          minimum: 1,
          maximum: 6,
        ),
        label: object.containsKey('label')
            ? _localizedText(object['label'], '$path.label')
            : null,
      );
    }
    throw MosaicProtocolException('Invalid text accessibility role at $path.');
  }

  MosaicProductCardStyles _v02ProductCardStyles(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'default', 'selected'}, path);
    return MosaicProductCardStyles(
      defaultStyle: _v02ProductCardDefault(
        object['default'],
        '$path.default',
      ),
      selectedOverride: _v02ProductCardOverride(
        object['selected'],
        '$path.selected',
      ),
    );
  }

  MosaicProductCardStyle _v02ProductCardDefault(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'background',
        'border',
        'cornerRadius',
        'padding',
        'opacity',
      },
      path,
      optional: const <String>{'shadow'},
    );
    return MosaicProductCardStyle(
      background: _v02Background(object['background'], '$path.background'),
      border: _v02Border(object['border'], '$path.border'),
      cornerRadius: _logicalSize(
        object['cornerRadius'],
        '$path.cornerRadius',
      ),
      padding: _edgeInsets(object['padding'], '$path.padding'),
      opacity: _boundedNumber(
        object['opacity'],
        '$path.opacity',
        minimum: 0,
        maximum: 1,
      ),
      shadow: object.containsKey('shadow')
          ? _v02Shadow(object['shadow'], '$path.shadow')
          : null,
    );
  }

  MosaicProductCardStyleOverride _v02ProductCardOverride(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{},
      path,
      optional: const <String>{
        'background',
        'border',
        'cornerRadius',
        'padding',
        'opacity',
        'shadow',
      },
    );
    final border = object.containsKey('border')
        ? _object(object['border'], '$path.border')
        : null;
    if (border != null) {
      _expectKeys(
        border,
        const <String>{},
        '$path.border',
        optional: const <String>{'color', 'width'},
      );
    }
    final padding = object.containsKey('padding')
        ? _v02InsetsOverride(object['padding'], '$path.padding')
        : null;
    return MosaicProductCardStyleOverride(
      background: object.containsKey('background')
          ? _v02Background(object['background'], '$path.background')
          : null,
      borderColor: border?.containsKey('color') ?? false
          ? _v02Color(border!['color'], '$path.border.color')
          : null,
      borderWidth: border?.containsKey('width') ?? false
          ? _logicalSize(border!['width'], '$path.border.width')
          : null,
      cornerRadius: object.containsKey('cornerRadius')
          ? _logicalSize(object['cornerRadius'], '$path.cornerRadius')
          : null,
      paddingTop: padding?['top'],
      paddingStart: padding?['start'],
      paddingBottom: padding?['bottom'],
      paddingEnd: padding?['end'],
      opacity: object.containsKey('opacity')
          ? _boundedNumber(
              object['opacity'],
              '$path.opacity',
              minimum: 0,
              maximum: 1,
            )
          : null,
      shadow: object.containsKey('shadow')
          ? _v02Shadow(object['shadow'], '$path.shadow')
          : null,
    );
  }

  Map<String, double> _v02InsetsOverride(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{},
      path,
      optional: const <String>{'top', 'start', 'bottom', 'end'},
    );
    return <String, double>{
      for (final key in const <String>['top', 'start', 'bottom', 'end'])
        if (object.containsKey(key))
          key: _logicalSize(object[key], '$path.$key'),
    };
  }

  MosaicMainAxisDistribution _v02Distribution(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'start', 'center', 'end', 'spaceBetween'},
      path,
    );
    return switch (source) {
      'start' => MosaicMainAxisDistribution.start,
      'center' => MosaicMainAxisDistribution.center,
      'end' => MosaicMainAxisDistribution.end,
      'spaceBetween' => MosaicMainAxisDistribution.spaceBetween,
      // `_enumValue` already rejected every other string, so a value here means
      // the accepted set and this mapping disagree. That is an SDK bug, and it
      // must not be absorbed as a plausible-looking distribution.
      final unreachable =>
        throw StateError('Unhandled distribution "$unreachable".'),
    };
  }

  MosaicTextStyle _v02TextStyle(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'display', 'title', 'heading', 'body', 'label', 'caption'},
      path,
    );
    return MosaicTextStyle.values.byName(source);
  }

  MosaicFontWeight _v02FontWeight(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'regular', 'medium', 'semibold', 'bold'},
      path,
    );
    return MosaicFontWeight.values.byName(source);
  }

  MosaicCountdownUnit _v02CountdownUnit(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'day', 'hour', 'minute', 'second'},
      path,
    );
    return MosaicCountdownUnit.values.byName(source);
  }

  MosaicLocalization _localization(Object? value) {
    const path = r'$.localization';
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'defaultLocale', 'fallbackLocale', 'locales'},
      path,
    );
    final localeValues = _object(object['locales'], '$path.locales');
    if (localeValues.isEmpty) {
      throw MosaicProtocolException(
        'Expected at least one locale at $path.locales.',
      );
    }
    final locales = <String, MosaicLocaleCatalog>{};
    for (final entry in localeValues.entries) {
      final locale = _localeTag(entry.key, '$path.locales key');
      locales[locale] = _localeCatalog(
        entry.value,
        '$path.locales.$locale',
      );
    }
    return MosaicLocalization(
      defaultLocale: _localeTag(
        object['defaultLocale'],
        '$path.defaultLocale',
      ),
      fallbackLocale: _localeTag(
        object['fallbackLocale'],
        '$path.fallbackLocale',
      ),
      locales: locales,
    );
  }

  MosaicLocaleCatalog _localeCatalog(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'direction', 'strings'}, path);
    final directionValue = _enumValue(
      object['direction'],
      const <String>{'ltr', 'rtl'},
      '$path.direction',
    );
    final stringValues = _object(object['strings'], '$path.strings');
    if (stringValues.isEmpty) {
      throw MosaicProtocolException(
        'Expected at least one localized string at $path.strings.',
      );
    }
    final strings = <String, String>{};
    for (final entry in stringValues.entries) {
      final key = _localizationKey(entry.key, '$path.strings key');
      strings[key] = _boundedNonEmptyString(
        entry.value,
        '$path.strings.$key',
        maximumLength: 5000,
      );
    }
    return MosaicLocaleCatalog(
      direction: directionValue == 'ltr'
          ? MosaicLocaleDirection.ltr
          : MosaicLocaleDirection.rtl,
      strings: strings,
    );
  }

  MosaicDesignSystem _v02DesignSystem(Object? value) {
    const path = r'$.designSystem';
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'colors', 'backgrounds', 'shadows'},
      path,
    );
    List<MosaicDesignToken<T>> decode<T>(
      String key,
      T Function(Object? value, String path) decodeValue,
    ) {
      final tokenPath = '$path.$key';
      final values = _list(object[key], tokenPath);
      if (values.length > 256) {
        throw MosaicProtocolException(
          'Design-system $key must contain at most 256 entries.',
        );
      }
      return <MosaicDesignToken<T>>[
        for (var index = 0; index < values.length; index += 1)
          () {
            final entryPath = '$tokenPath[$index]';
            final entry = _object(values[index], entryPath);
            _expectKeys(
              entry,
              const <String>{'id', 'name', 'value'},
              entryPath,
            );
            return MosaicDesignToken<T>(
              id: _identifier(entry['id'], '$entryPath.id'),
              name: _boundedNonEmptyString(
                entry['name'],
                '$entryPath.name',
                maximumLength: 80,
              ),
              value: decodeValue(entry['value'], '$entryPath.value'),
            );
          }(),
      ];
    }

    return MosaicDesignSystem(
      colors: decode<MosaicColorValue>('colors', _v02Color),
      backgrounds: decode<MosaicBackground>('backgrounds', _v02Background),
      shadows: decode<MosaicShadow>('shadows', _v02Shadow),
    );
  }

  List<MosaicAsset> _v02Assets(Object? value) {
    const path = r'$.assets';
    final values = _list(value, path);
    return <MosaicAsset>[
      for (var index = 0; index < values.length; index += 1)
        _v02Asset(values[index], '$path[$index]'),
    ];
  }

  MosaicAsset _v02Asset(Object? value, String path) {
    final object = _object(value, path);
    final type = _enumValue(
      object['type'],
      const <String>{'image', 'video'},
      '$path.type',
    );
    _expectKeys(
      object,
      type == 'image'
          ? const <String>{'type', 'id', 'source', 'fallback'}
          : const <String>{'type', 'id', 'source'},
      path,
    );
    final source = _v02AssetSource(object['source'], '$path.source');
    final id = _identifier(object['id'], '$path.id');
    if (type == 'video') return MosaicVideoAsset(id: id, source: source);
    final fallback = _object(object['fallback'], '$path.fallback');
    _expectKeys(
      fallback,
      const <String>{'type', 'value'},
      '$path.fallback',
    );
    _expectConst(fallback['type'], 'placeholder', '$path.fallback.type');
    return MosaicImageAsset(
      id: id,
      source: source,
      placeholder: _localizedText(
        fallback['value'],
        '$path.fallback.value',
      ),
    );
  }

  MosaicAssetSource _v02AssetSource(Object? value, String path) {
    final object = _object(value, path);
    final type = _enumValue(
      object['type'],
      const <String>{'bundled', 'remote'},
      '$path.type',
    );
    if (type == 'bundled') {
      _expectKeys(object, const <String>{'type', 'key'}, path);
      return MosaicBundledAssetSource(_assetKey(object['key'], '$path.key'));
    }
    _expectKeys(object, const <String>{'type', 'url'}, path);
    return MosaicRemoteAssetSource(_v02ExternalUrl(object['url'], '$path.url'));
  }

  List<MosaicProductReference> _v02Products(Object? value) {
    const path = r'$.products';
    final values = _list(value, path);
    return <MosaicProductReference>[
      for (var index = 0; index < values.length; index += 1)
        _v02ProductReference(values[index], '$path[$index]'),
    ];
  }

  MosaicProductReference _v02ProductReference(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'id', 'productId', 'label'},
      path,
    );
    return MosaicProductReference(
      id: _identifier(object['id'], '$path.id'),
      productId: _productId(object['productId'], '$path.productId'),
      label: _localizedText(object['label'], '$path.label'),
    );
  }

  MosaicEdgeInsets _edgeInsets(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'top', 'start', 'bottom', 'end'},
      path,
    );
    return MosaicEdgeInsets(
      top: _logicalSize(object['top'], '$path.top'),
      start: _logicalSize(object['start'], '$path.start'),
      bottom: _logicalSize(object['bottom'], '$path.bottom'),
      end: _logicalSize(object['end'], '$path.end'),
    );
  }

  MosaicFeatureListItem _featureListItem(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'id', 'text'}, path);
    return MosaicFeatureListItem(
      id: _identifier(object['id'], '$path.id'),
      text: _localizedText(object['text'], '$path.text'),
    );
  }

  MosaicUnavailableProductFallback _unavailableProductFallback(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'selection', 'whenNoneAvailable', 'message'},
      path,
    );
    _expectConst(object['selection'], 'firstAvailable', '$path.selection');
    _expectConst(
      object['whenNoneAvailable'],
      'showMessageAndDisablePurchase',
      '$path.whenNoneAvailable',
    );
    return MosaicUnavailableProductFallback(
      message: _localizedText(object['message'], '$path.message'),
    );
  }

  MosaicPurchaseAction _purchaseAction(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'type', 'productSelectorId'}, path);
    _expectConst(object['type'], 'purchase', '$path.type');
    return MosaicPurchaseAction(
      productSelectorId: _identifier(
        object['productSelectorId'],
        '$path.productSelectorId',
      ),
    );
  }

  MosaicRestoreAction _restoreAction(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'type'}, path);
    _expectConst(object['type'], 'restore', '$path.type');
    return const MosaicRestoreAction();
  }

  MosaicCloseAction _closeAction(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'type'}, path);
    _expectConst(object['type'], 'close', '$path.type');
    return const MosaicCloseAction();
  }

  MosaicLocalizedText _localizedText(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'default', 'localizationKey'}, path);
    return MosaicLocalizedText(
      defaultValue: _boundedNonEmptyString(
        object['default'],
        '$path.default',
        maximumLength: 5000,
      ),
      localizationKey: _localizationKey(
        object['localizationKey'],
        '$path.localizationKey',
      ),
    );
  }

  MosaicImageAccessibility _imageAccessibility(Object? value, String path) {
    final object = _object(value, path);
    final hidden = _boolean(object['hidden'], '$path.hidden');
    if (hidden) {
      _expectKeys(object, const <String>{'hidden'}, path);
      return const MosaicImageAccessibility(hidden: true);
    }
    _expectKeys(object, const <String>{'hidden', 'label'}, path);
    return MosaicImageAccessibility(
      hidden: false,
      label: _localizedText(object['label'], '$path.label'),
    );
  }

  MosaicControlAccessibility _controlAccessibility(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'label'},
      path,
      optional: const <String>{'hint'},
    );
    return MosaicControlAccessibility(
      label: _localizedText(object['label'], '$path.label'),
      hint: object.containsKey('hint')
          ? _localizedText(object['hint'], '$path.hint')
          : null,
    );
  }
}

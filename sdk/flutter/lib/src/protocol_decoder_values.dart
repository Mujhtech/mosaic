part of 'protocol.dart';

extension on _DocumentDecoder {
  MosaicTypography _docTypography(
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
      style: _docTextStyle(object['style'], '$path.style'),
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
      weight: _docFontWeight(object['weight'], '$path.weight'),
      color: _docColor(object['color'], '$path.color'),
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

  MosaicTextAccessibility _docTextAccessibility(
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

  MosaicSelectionStyles _docSelectionStyles(
    Object? value,
    String path,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'default', 'selected'}, path);
    return MosaicSelectionStyles(
      defaultStyle: _docSelectionStateStyle(
        object['default'],
        '$path.default',
      ),
      selectedOverride: _docSelectionStateStyleOverride(
        object['selected'],
        '$path.selected',
      ),
    );
  }

  MosaicSelectionStateStyle _docSelectionStateStyle(
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
    return MosaicSelectionStateStyle(
      background: _docBackground(object['background'], '$path.background'),
      border: _docBorder(object['border'], '$path.border'),
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
          ? _docShadow(object['shadow'], '$path.shadow')
          : null,
    );
  }

  MosaicSelectionStateStyleOverride _docSelectionStateStyleOverride(
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
        ? _docInsetsOverride(object['padding'], '$path.padding')
        : null;
    return MosaicSelectionStateStyleOverride(
      background: object.containsKey('background')
          ? _docBackground(object['background'], '$path.background')
          : null,
      borderColor: border?.containsKey('color') ?? false
          ? _docColor(border!['color'], '$path.border.color')
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
          ? _docShadow(object['shadow'], '$path.shadow')
          : null,
    );
  }

  Map<String, double> _docInsetsOverride(Object? value, String path) {
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

  MosaicMainAxisDistribution _docDistribution(Object? value, String path) {
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

  MosaicTextStyle _docTextStyle(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'display', 'title', 'heading', 'body', 'label', 'caption'},
      path,
    );
    return MosaicTextStyle.values.byName(source);
  }

  MosaicFontWeight _docFontWeight(Object? value, String path) {
    final source = _enumValue(
      value,
      const <String>{'regular', 'medium', 'semibold', 'bold'},
      path,
    );
    return MosaicFontWeight.values.byName(source);
  }

  MosaicCountdownUnit _docCountdownUnit(Object? value, String path) {
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

  MosaicDesignSystem _docDesignSystem(Object? value) {
    const path = r'$.designSystem';
    final object = _object(value, path);
    _expectKeys(
      object,
      // The fourth catalog is required and may be empty.
      const <String>{'colors', 'backgrounds', 'shadows', 'motions'},
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
      colors: decode<MosaicColorValue>('colors', _docColor),
      backgrounds: decode<MosaicBackground>('backgrounds', _docBackground),
      shadows: decode<MosaicShadow>('shadows', _docShadow),
      motions: decode<MosaicMotion>('motions', _motion),
    );
  }

  List<MosaicAsset> _docAssets(Object? value) {
    const path = r'$.assets';
    final values = _list(value, path);
    return <MosaicAsset>[
      for (var index = 0; index < values.length; index += 1)
        _docAsset(values[index], '$path[$index]'),
    ];
  }

  MosaicAsset _docAsset(Object? value, String path) {
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
    final source = _docAssetSource(object['source'], '$path.source');
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

  MosaicAssetSource _docAssetSource(Object? value, String path) {
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
    return MosaicRemoteAssetSource(_docExternalUrl(object['url'], '$path.url'));
  }

  List<MosaicProductReference> _docProducts(Object? value) {
    const path = r'$.products';
    final values = _list(value, path);
    return <MosaicProductReference>[
      for (var index = 0; index < values.length; index += 1)
        _docProductReference(values[index], '$path[$index]'),
    ];
  }

  MosaicProductReference _docProductReference(Object? value, String path) {
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
    _expectKeys(
      object,
      const <String>{'id', 'text'},
      path,
      optional: const <String>{'marker'},
    );
    return MosaicFeatureListItem(
      id: _identifier(object['id'], '$path.id'),
      text: _localizedText(object['text'], '$path.text'),
      marker: object.containsKey('marker')
          ? _marker(object['marker'], '$path.marker')
          : null,
    );
  }

  /// The shared marker union, used by Feature List and Timeline.
  MosaicMarker _marker(Object? value, String path) {
    final object = _object(value, path);
    final kind = _enumValue(
      object['kind'],
      const <String>{'dot', 'ordinal', 'icon'},
      '$path.kind',
    );
    switch (kind) {
      case 'dot':
        _expectKeys(object, const <String>{'kind'}, path);
        return const MosaicDotMarker();
      case 'ordinal':
        _expectKeys(object, const <String>{'kind'}, path);
        return const MosaicOrdinalMarker();
      case 'icon':
        _expectKeys(object, const <String>{'kind', 'name'}, path);
        return MosaicIconMarker(_docIconName(object['name'], '$path.name'));
      // `_enumValue` already rejected every other string, so a value here means
      // the accepted set and this mapping disagree. That is an SDK bug, and it
      // must never be absorbed as a plausible-looking glyph.
      default:
        throw StateError('Unhandled marker kind "$kind".');
    }
  }

  /// A `motionToken` reference or an inline motion.
  MosaicMotion _motion(Object? value, String path) {
    final object = _object(value, path);
    final type = _enumValue(
      object['type'],
      const <String>{'motion', 'motionToken'},
      '$path.type',
    );
    if (type == 'motionToken') {
      _expectKeys(object, const <String>{'type', 'id'}, path);
      return MosaicMotionTokenReference(_identifier(object['id'], '$path.id'));
    }
    _expectKeys(
      object,
      const <String>{'type', 'durationMilliseconds', 'easing'},
      path,
    );
    return MosaicInlineMotion(
      // Integers throughout, so that Dart, Swift, Kotlin, and JavaScript
      // cannot disagree about a rounded fraction.
      durationMilliseconds: _integerInRange(
        object['durationMilliseconds'],
        '$path.durationMilliseconds',
        minimum: 0,
        maximum: 2000,
      ),
      easing: MosaicMotionEasing.values.byName(
        _enumValue(
          object['easing'],
          const <String>{'linear', 'standard', 'decelerate', 'accelerate'},
          '$path.easing',
        ),
      ),
    );
  }

  /// The authored motion block on one node, constrained by what the node is.
  MosaicNodeMotion? _nodeMotion(
    Map<String, Object?> object,
    String path,
    _MotionSlot slot,
  ) {
    if (!object.containsKey('motion')) return null;
    if (slot == _MotionSlot.none) {
      throw MosaicProtocolException(
        'Unknown properties motion at $path.',
      );
    }
    final motionPath = '$path.motion';
    final motion = _object(object['motion'], motionPath);
    _expectKeys(
      motion,
      const <String>{},
      motionPath,
      optional: switch (slot) {
        _MotionSlot.node => const <String>{'appear'},
        _MotionSlot.selectable => const <String>{'appear', 'selection'},
        _MotionSlot.button => const <String>{'appear', 'loop'},
        _MotionSlot.none => const <String>{},
      },
    );
    if (motion.isEmpty) {
      throw MosaicProtocolException(
        'A motion block must declare at least one trigger at $motionPath.',
      );
    }
    return MosaicNodeMotion(
      appear: motion.containsKey('appear')
          ? _appearMotion(motion['appear'], '$motionPath.appear')
          : null,
      selection: motion.containsKey('selection')
          ? _selectionMotion(motion['selection'], '$motionPath.selection')
          : null,
      loop: motion.containsKey('loop')
          ? _loopMotion(motion['loop'], '$motionPath.loop')
          : null,
    );
  }

  MosaicAppearMotion _appearMotion(Object? value, String path) {
    final object = _object(value, path);
    final effect = _enumValue(
      object['effect'],
      const <String>{'fade', 'fadeRise'},
      '$path.effect',
    );
    // `riseLogicalSize` is required with fadeRise and forbidden with fade. Two
    // key sets rather than one optional key, so "a fade that authored a rise"
    // is rejected rather than silently ignored.
    _expectKeys(
      object,
      effect == 'fadeRise'
          ? const <String>{
              'effect',
              'riseLogicalSize',
              'curve',
              'delayMilliseconds',
            }
          : const <String>{'effect', 'curve', 'delayMilliseconds'},
      path,
    );
    return MosaicAppearMotion(
      effect: effect == 'fadeRise'
          ? MosaicAppearEffect.fadeRise
          : MosaicAppearEffect.fade,
      // Bounded at 64: a rise longer than the component it moves reads as a
      // fly-in, and a large authored translation is where transform-versus-
      // layout divergence between three renderers becomes visible.
      riseLogicalSize: effect == 'fadeRise'
          ? _boundedNumber(
              object['riseLogicalSize'],
              '$path.riseLogicalSize',
              minimumExclusive: 0,
              maximum: 64,
            )
          : null,
      curve: _motion(object['curve'], '$path.curve'),
      delayMilliseconds: _integerInRange(
        object['delayMilliseconds'],
        '$path.delayMilliseconds',
        minimum: 0,
        maximum: 2000,
      ),
    );
  }

  MosaicSelectionMotion _selectionMotion(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'curve'}, path);
    return MosaicSelectionMotion(
      curve: _motion(object['curve'], '$path.curve'),
    );
  }

  MosaicLoopMotion _loopMotion(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{
        'effect',
        'scaleAmplitude',
        'opacityAmplitude',
        'curve',
        'repeat',
      },
      path,
    );
    _expectConst(object['effect'], 'pulse', '$path.effect');
    final repeat = _object(object['repeat'], '$path.repeat');
    _expectKeys(repeat, const <String>{'count'}, '$path.repeat');
    return MosaicLoopMotion(
      effect: MosaicLoopEffect.pulse,
      // A pulse that does not scale is not a pulse, so the lower bound is
      // exclusive. The 0.06 ceiling keeps the excursion noticeable without
      // overlapping neighbours or changing perceived hit targets.
      scaleAmplitude: _boundedNumber(
        object['scaleAmplitude'],
        '$path.scaleAmplitude',
        minimumExclusive: 0,
        maximum: 0.06,
      ),
      // 0 is a pulse that scales without dimming. The 0.2 ceiling keeps the
      // floor at no less than 80% of whatever the static rendering already was.
      opacityAmplitude: _boundedNumber(
        object['opacityAmplitude'],
        '$path.opacityAmplitude',
        minimum: 0,
        maximum: 0.2,
      ),
      curve: _motion(object['curve'], '$path.curve'),
      // Bounded 1..5 by owner ruling: an unbounded pulse would rely on the
      // operating system's reduce-motion switch as its WCAG 2.2.2 stop
      // mechanism, leaving a user who has not enabled it with no stop at all.
      repeatCount: _integerInRange(
        repeat['count'],
        '$path.repeat.count',
        minimum: 1,
        maximum: 5,
      ),
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

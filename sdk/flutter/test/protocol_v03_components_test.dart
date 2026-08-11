import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// Decoding and semantic-rule coverage for the four components Protocol 0.3
/// adds, plus the runtime-state and visibility contract Tabs introduces.
void main() {
  MosaicPaywallDocument document() => decodeCanonicalFixture();

  Map<String, Object?> source() => canonicalFixtureObject();

  group('Tabs', () {
    test('decodes every authored field, including a non-first initial tab', () {
      final tabs = document().nodes.whereType<MosaicTabsComponent>().single;

      expect(tabs.id, 'billing-tabs');
      expect(tabs.tabBarDirection, MosaicStackDirection.horizontal);
      expect(tabs.tabBarGap, 8);
      expect(
        tabs.tabBarDistribution,
        MosaicMainAxisDistribution.spaceBetween,
      );
      expect(tabs.gap, 16);
      expect(
        tabs.tabs.map((tab) => tab.id),
        <String>[
          'billing-tabs-monthly',
          'billing-tabs-annual',
          'billing-tabs-lifetime',
        ],
      );
      // The authored initial tab is deliberately not the first entry: a
      // positional default would make reordering the array change behaviour.
      expect(tabs.initialTabId, 'billing-tabs-annual');
      expect(tabs.tabs.first.id, isNot(tabs.initialTabId));
      expect(tabs.selectedLabelColor.value, 'action.onPrimary');
      expect(tabs.labelTypography.style, MosaicTextStyle.label);
      expect(tabs.tabs.first.content.id, 'billing-tabs-monthly-content');
    });

    test('resolves Selected over Default with the shared selection overlay',
        () {
      final tabs = document().nodes.whereType<MosaicTabsComponent>().single;
      final defaultStyle = tabs.styles.resolve(selected: false);
      final selected = tabs.styles.resolve(selected: true);

      final selectedBackground = selected.background;
      expect(selectedBackground, isA<MosaicColorBackground>());
      expect(
        (selectedBackground as MosaicColorBackground).color.value,
        'action.primary',
      );
      expect(selected.border.width, 2);
      // Absent overrides are an authored statement that nothing changes, so
      // they inherit rather than reset.
      expect(selected.cornerRadius, defaultStyle.cornerRadius);
      expect(selected.padding.start, defaultStyle.padding.start);
      expect(selected.opacity, defaultStyle.opacity);
    });

    test('rejects an initialTabId that names no declared tab', () {
      final value = source();
      _node(value, 'billing-tabs')['initialTabId'] = 'billing-tabs-quarterly';

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });

    test('rejects a tab id that collides with the global layout namespace', () {
      final value = source();
      final tabs = _node(value, 'billing-tabs');
      ((tabs['tabs']! as List<Object?>).first! as Map<String, Object?>)['id'] =
          'hero';

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });
  });

  group('Timeline', () {
    test('decodes ordered entries, every marker arm, and both connectors', () {
      final timelines =
          document().nodes.whereType<MosaicTimelineComponent>().toList();
      expect(timelines, hasLength(2));

      final trial =
          timelines.singleWhere((node) => node.id == 'trial-timeline');
      expect(trial.connector.style, MosaicTimelineConnectorStyle.solid);
      expect(trial.connector.width, 2);
      // Array order is the sequence order and carries meaning.
      expect(
        trial.entries.map((entry) => entry.id),
        <String>['trial-today', 'trial-reminder', 'trial-charge'],
      );
      expect(trial.entries[0].marker, isA<MosaicTimelineDotMarker>());
      expect(trial.entries[1].marker, isA<MosaicTimelineOrdinalMarker>());
      expect(
        (trial.entries[2].marker! as MosaicTimelineIconMarker).name,
        MosaicIconName.lock,
      );
      // An absent description is "this entry has a title and nothing else".
      expect(trial.entries[2].description, isNull);
      expect(trial.markerColor?.value, 'action.primary');
      expect(trial.markerSize, 12);
      expect(trial.descriptionTypography, isNotNull);

      final support =
          timelines.singleWhere((node) => node.id == 'support-timeline');
      expect(support.connector.style, MosaicTimelineConnectorStyle.dashed);
      expect(support.hasMarkers, isFalse);
      // Forbidden, not merely omitted, when nothing consumes them.
      expect(support.markerColor, isNull);
      expect(support.markerSize, isNull);
      expect(support.descriptionTypography, isNull);
    });

    test('rejects marker style declared where no entry consumes it', () {
      final value = source();
      final timeline = _node(value, 'trial-timeline');
      for (final entry in timeline['entries']! as List<Object?>) {
        (entry! as Map<String, Object?>).remove('marker');
      }

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });

    test('rejects a consumed marker style that is not declared', () {
      final value = source();
      _node(value, 'trial-timeline').remove('markerColor');

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });

    test('rejects an unrecognised marker kind rather than substituting one',
        () {
      final value = source();
      final timeline = _node(value, 'trial-timeline');
      final first = (timeline['entries']! as List<Object?>).first!
          as Map<String, Object?>;
      first['marker'] = <String, Object?>{'kind': 'diamond'};

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });
  });

  group('Award', () {
    test('decodes both emblem arms and the optional subtitle pair', () {
      final awards =
          document().nodes.whereType<MosaicAwardComponent>().toList();
      expect(awards, hasLength(2));

      final editor = awards.singleWhere((node) => node.id == 'editor-award');
      final icon = editor.emblem! as MosaicAwardIconEmblem;
      expect(icon.name, MosaicIconName.checkmark);
      expect(icon.size, 28);
      expect(editor.subtitle, isNotNull);
      expect(editor.subtitleTypography, isNotNull);
      expect(editor.direction, MosaicStackDirection.horizontal);

      final press = awards.singleWhere((node) => node.id == 'press-award');
      expect((press.emblem! as MosaicAwardImageEmblem).assetId, 'award-emblem');
      // Absent means the award has a title and nothing else.
      expect(press.subtitle, isNull);
      expect(press.subtitleTypography, isNull);
    });

    test('rejects a subtitle without its typography', () {
      final value = source();
      _node(value, 'editor-award').remove('subtitleTypography');

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });

    test('rejects an emblem that does not resolve to an image asset', () {
      final value = source();
      (_node(value, 'press-award')['emblem']!
          as Map<String, Object?>)['assetId'] = 'bundled-ambient-video';

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });
  });

  group('Social Proof', () {
    test('decodes the integer step scale, and absence as absence', () {
      final proofs =
          document().nodes.whereType<MosaicSocialProofComponent>().toList();
      expect(proofs, hasLength(3));

      final rated = proofs.singleWhere((node) => node.id == 'rated-review');
      final half = rated.rating!;
      expect(half.step, MosaicRatingStep.half);
      expect(half.value, 9);
      expect(half.maximum, 5);
      // Nine half-steps out of ten is four and a half symbols, computed in
      // integers so no runtime has to round a fraction.
      expect(half.stepsPerPoint, 2);
      expect(half.maximumSteps, 10);
      expect(half.filledPoints, 4);
      expect(half.hasHalfPoint, isTrue);
      expect(rated.avatar?.assetId, 'reviewer-avatar');

      final whole =
          proofs.singleWhere((node) => node.id == 'whole-review').rating!;
      expect(whole.step, MosaicRatingStep.whole);
      expect(whole.stepsPerPoint, 1);
      expect(whole.filledPoints, 5);
      expect(whole.hasHalfPoint, isFalse);

      final plain = proofs.singleWhere((node) => node.id == 'analyst-note');
      // Absent is neither a zero rating nor an unknown rating.
      expect(plain.rating, isNull);
      expect(plain.avatar, isNull);
      expect(plain.attribution.defaultValue, 'Subscription Economy Review');
    });

    test('rejects a value beyond maximum multiplied by steps per point', () {
      final value = source();
      final rating =
          _node(value, 'whole-review')['rating']! as Map<String, Object?>;
      // Five points at one step per point admits at most five steps.
      rating['value'] = 6;

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });

    test('accepts the exact bound so the rule is off-by-one safe', () {
      final value = source();
      final rating =
          _node(value, 'rated-review')['rating']! as Map<String, Object?>;
      rating['value'] = 10;

      final decoded = const MosaicProtocolDecoder().decode(jsonEncode(value));
      final proof = decoded.nodes
          .whereType<MosaicSocialProofComponent>()
          .singleWhere((node) => node.id == 'rated-review');
      expect(proof.rating!.filledPoints, 5);
      expect(proof.rating!.hasHalfPoint, isFalse);
    });
  });

  group('reserved accessibility strings', () {
    test('matches every canonical rating-announcement vector', () {
      final corpus = jsonDecode(
        repositoryFile('protocol/fixtures/v0.3/rating-announcement.json')
            .readAsStringSync(),
      )! as Map<String, Object?>;
      final cases =
          (corpus['cases']! as List<Object?>).cast<Map<String, Object?>>();
      // A corpus sweep that iterates nothing reports success having checked
      // nothing, so a case-count floor is asserted before the loop. It is a
      // floor rather than an equality so the protocol agent can add vectors
      // without breaking this SDK, while a truncated corpus still fails.
      expect(cases.length, greaterThanOrEqualTo(10));
      expect(
        cases.map((vector) => vector['locale']),
        containsAll(<String>['en', 'de', 'ar']),
      );

      for (final vector in cases) {
        final rating = vector['rating']! as Map<String, Object?>;
        final decoded = MosaicSocialProofRating(
          value: rating['value']! as int,
          maximum: rating['maximum']! as int,
          step: rating['step'] == 'half'
              ? MosaicRatingStep.half
              : MosaicRatingStep.whole,
          size: (rating['size']! as num).toDouble(),
          filledColor: MosaicColorValue.parse(rating['filledColor']! as String),
          emptyColor: MosaicColorValue.parse(rating['emptyColor']! as String),
        );
        final id = vector['id'];
        expect(decoded.announcedPoints, vector['points'], reason: '$id');
        expect(
          decoded.announcement(vector['template']! as String),
          vector['expectedAnnouncement'],
          reason: '$id',
        );
      }
    });

    test('matches every canonical accessibility-announcement vector', () {
      final corpus = jsonDecode(
        repositoryFile('protocol/fixtures/v0.3/accessibility-announcement.json')
            .readAsStringSync(),
      )! as Map<String, Object?>;
      final cases =
          (corpus['cases']! as List<Object?>).cast<Map<String, Object?>>();
      // A corpus sweep that iterates nothing reports success having checked
      // nothing, so a case-count floor is asserted before the loop.
      expect(cases.length, greaterThanOrEqualTo(11));
      expect(corpus['separator'], isNull);
      expect(
        cases.map((vector) => vector['componentType']),
        containsAll(<String>['socialProof', 'award', 'timeline', 'button']),
      );
      expect(
        cases.map((vector) => vector['locale']),
        containsAll(<String>['en', 'de', 'ar']),
      );

      final decoded = document();
      final nodesById = <String, MosaicNode>{
        for (final node in decoded.nodes) node.id: node,
      };
      for (final vector in cases) {
        final id = vector['id'];
        final node = nodesById[vector['componentId']];
        expect(node, isNotNull, reason: '$id');
        final strings = const MosaicLocaleResolver()
            .resolve(decoded, requestedLocale: vector['locale'] as String)
            .catalogStrings;
        final announcement = mosaicAccessibilityAnnouncement(
          node!,
          strings: strings,
          state: switch (vector['state']) {
            'idle' => MosaicButtonAnnouncementState.idle,
            'inProgress' => MosaicButtonAnnouncementState.inProgress,
            _ => null,
          },
        );

        expect(announcement.composition, vector['composition'], reason: '$id');
        // Never joined: `separator` is null by contract, and modelling it makes
        // "no joining happens" assertable rather than inferred.
        expect(announcement.separator, isNull, reason: '$id');

        final container = vector['container']! as Map<String, Object?>;
        expect(announcement.container.role, container['role'], reason: '$id');
        expect(announcement.container.label, container['label'], reason: '$id');
        expect(announcement.container.value, container['value'], reason: '$id');
        expect(announcement.container.hint, container['hint'], reason: '$id');

        final elements =
            (vector['elements']! as List<Object?>).cast<Map<String, Object?>>();
        expect(
          announcement.elements.length,
          elements.length,
          reason: '$id',
        );
        for (var index = 0; index < elements.length; index += 1) {
          final actual = announcement.elements[index];
          final expected = elements[index];
          expect(actual.segment, expected['segment'], reason: '$id[$index]');
          expect(actual.text, expected['text'], reason: '$id[$index]');
          expect(actual.item, expected['item'], reason: '$id[$index]');
        }
        expect(
          announcement.decorative,
          vector['decorative'],
          reason: '$id',
        );
      }
    });

    test('requires a reserved key exactly when something announces it', () {
      final missing = source();
      _defaultStrings(missing).remove('mosaic.a11y.rating');
      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(missing)),
        throwsA(isA<MosaicProtocolException>()),
      );

      // Declared where nothing announces it is equally rejected: a string
      // nobody reads is how a stale translation survives a redesign.
      final unused = source();
      for (final id in <String>[
        'rated-review',
        'whole-review',
      ]) {
        _node(unused, id).remove('rating');
      }
      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(unused)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });

    test('requires each placeholder exactly once in every catalog', () {
      final duplicated = source();
      _defaultStrings(duplicated)['mosaic.a11y.rating'] =
          '{{ rating.value }} of {{ rating.value }} of {{ rating.maximum }}';
      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(duplicated)),
        throwsA(isA<MosaicProtocolException>()),
      );

      final foreign = source();
      final locales = (_localization(foreign)['locales']!
          as Map<String, Object?>)['de']! as Map<String, Object?>;
      (locales['strings']! as Map<String, Object?>)['mosaic.a11y.rating'] =
          '{{ rating.value }} von {{ rating.maximum }} {{ product.name }}';
      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(foreign)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });

    test('reserved keys are exempt from the unused-key sweep', () {
      // The canonical fixture declares both reserved keys and no component
      // references either, so a sweep that did not exempt them would reject
      // the canonical document outright.
      final decoded = document();
      expect(
        decoded.compatibility.requiredCapabilities.map((item) => item.name),
        contains('accessibility.reservedStrings'),
      );
    });
  });

  group('tab visibility', () {
    test('decodes the tab condition and derives its capability', () {
      final decoded = document();
      final note = decoded.nodes
          .whereType<MosaicTextComponent>()
          .singleWhere((node) => node.id == 'annual-note');
      final visibility = note.visibility as MosaicTabVisibility;

      expect(visibility.tabsId, 'billing-tabs');
      expect(visibility.equals, 'billing-tabs-annual');
      expect(
        decoded.compatibility.requiredCapabilities.map((item) => item.name),
        contains('condition.tabVisibility'),
      );
    });

    test('rejects a condition naming a tab the component does not declare', () {
      final value = source();
      (_node(value, 'annual-note')['visibility']!
          as Map<String, Object?>)['equals'] = 'billing-tabs-quarterly';

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });

    test('rejects a condition on a descendant of the Tabs component it names',
        () {
      final value = source();
      // Inside a panel the condition is already decided: it is either
      // vacuously true or unsatisfiable, and both are dead layout.
      _node(value, 'billing-tabs-annual-body')['visibility'] =
          <String, Object?>{
        'mode': 'tab',
        'tabsId': 'billing-tabs',
        'equals': 'billing-tabs-annual',
      };

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });

    test('rejects a condition naming a Tabs component on another screen', () {
      final value = source();
      _node(value, 'support-timeline')['visibility'] = <String, Object?>{
        'mode': 'tab',
        'tabsId': 'billing-tabs',
        'equals': 'billing-tabs-annual',
      };

      expect(
        () => const MosaicProtocolDecoder().decode(jsonEncode(value)),
        throwsA(isA<MosaicProtocolException>()),
      );
    });
  });

  group('visibility evaluation', () {
    test('initial selection carries every Switch and Tabs controller', () {
      final decoded = document();
      final state = MosaicSelectionState.initialFor(decoded);

      expect(
          state.tabs, <String, String>{'billing-tabs': 'billing-tabs-annual'});
      expect(state.switches.keys, isNotEmpty);
      expect(
        evaluateMosaicVisibility(
          const MosaicTabVisibility(
            tabsId: 'billing-tabs',
            equals: 'billing-tabs-annual',
          ),
          state,
        ),
        isTrue,
      );
      expect(
        evaluateMosaicVisibility(
          const MosaicTabVisibility(
            tabsId: 'billing-tabs',
            equals: 'billing-tabs-monthly',
          ),
          state,
        ),
        isFalse,
      );
    });

    test('throws rather than resolving a controller the state does not carry',
        () {
      // Reading an absent controller back as `false` would delete a component
      // from the layout instead of reporting the caller's bug, so there is
      // deliberately no fallback.
      expect(
        () => evaluateMosaicVisibility(
          const MosaicTabVisibility(
            tabsId: 'billing-tabs',
            equals: 'billing-tabs-annual',
          ),
          MosaicSelectionState(),
        ),
        throwsA(isA<MosaicVisibilityStateException>()),
      );
      expect(
        () => evaluateMosaicVisibility(
          const MosaicSwitchVisibility(switchId: 'unknown', equals: true),
          MosaicSelectionState(),
        ),
        throwsA(isA<MosaicVisibilityStateException>()),
      );
    });
  });
}

Map<String, Object?> _localization(Map<String, Object?> document) =>
    document['localization']! as Map<String, Object?>;

Map<String, Object?> _defaultStrings(Map<String, Object?> document) {
  final localization = _localization(document);
  final locales = localization['locales']! as Map<String, Object?>;
  final defaultLocale = locales[localization['defaultLocale']! as String]!
      as Map<String, Object?>;
  return defaultLocale['strings']! as Map<String, Object?>;
}

Map<String, Object?> _node(Map<String, Object?> document, String id) {
  Map<String, Object?>? result;
  void visit(Object? value) {
    if (result != null) return;
    if (value is List<Object?>) {
      for (final item in value) {
        visit(item);
      }
      return;
    }
    if (value is! Map<String, Object?>) return;
    if (value['id'] == id && value.containsKey('type')) {
      result = value;
      return;
    }
    for (final entry in value.values) {
      visit(entry);
    }
  }

  visit(document['screens']);
  return result ?? (throw StateError('Missing fixture node $id'));
}

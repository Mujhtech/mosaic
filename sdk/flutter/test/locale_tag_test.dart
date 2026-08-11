import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// The closed codec every Mosaic locale field is validated against.
final RegExp _codec = RegExp(r'^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$');

MosaicAnalyticsEvent _event(String? locale) => MosaicAnalyticsEvent(
      eventId: 'event_locale',
      name: MosaicAnalyticsEventName.placementRequested,
      occurredAt: DateTime.utc(2026, 8, 3),
      queuedAt: DateTime.utc(2026, 8, 3),
      identity: const MosaicAnalyticsIdentity(
        installationId: 'installation_locale',
        generation: 1,
      ),
      sessionId: 'session_locale',
      context: MosaicAnalyticsContext(
        platform: 'ios',
        sdkVersion: '1.0.0',
        locale: locale,
      ),
      correlation:
          const MosaicAnalyticsCorrelation(placementRequestId: 'request_1'),
      attribution: const MosaicAnalyticsAttribution(placementId: 'placement_1'),
      payload: const {'decisionContractVersion': '1'},
    );

void main() {
  // The failure this protects is silent and total: an unnormalized identifier
  // fails the closed codec, the event constructor throws, and every analytics
  // event is lost on exactly the devices that carry a region override.
  test('host locale shapes normalize to tags the closed codec accepts', () {
    const shapes = <String, String?>{
      // Dart's Platform.localeName is POSIX on every platform.
      'en_US': 'en-US',
      // ... and carries a codeset suffix on desktop.
      'en_US.UTF-8': 'en-US',
      // An ICU region override, the iOS-reported defect shape.
      'en_US@rg=gbzzzz': 'en-US',
      // Java Locale.toString's extension marker.
      'en_US_#u-rg-gbzzzz': 'en-US',
      // A BCP-47 extension carries no targeting meaning.
      'en-US-u-ca-buddhist': 'en-US',
      // Script and region subtags survive, in the authored grammar's casing.
      'zh-Hans-CN': 'zh-Hans-CN',
      'en-US': 'en-US',
      // Case is canonicalized so targeting and catalog lookup agree with the
      // one spelling the authored grammar admits.
      'PT_br': 'pt-BR',
      'es_419': 'es-419',
      'en_US_POSIX': 'en-US-posix',
      // An empty subtag is dropped rather than invalidating the tag.
      'en--US': 'en-US',
      // A subtag the grammar cannot express yields no tag at all, matching the
      // reference implementation rather than salvaging the language alone.
      'en-US-verylongsubtag': null,
      // Nothing salvageable stays absent rather than becoming a fabricated
      // locale that telemetry and targeting would both believe.
      '': null,
      '@rg=gbzzzz': null,
      'x-private': null,
    };
    for (final entry in shapes.entries) {
      final normalized = mosaicNormalizeLocaleTag(entry.key);
      expect(normalized, entry.value, reason: entry.key);
      if (normalized != null) {
        expect(_codec.hasMatch(normalized), isTrue, reason: entry.key);
        expect(() => _event(normalized), returnsNormally, reason: entry.key);
      }
    }
    expect(mosaicNormalizeLocaleTag(null), isNull);
    // The codec itself stays closed: normalization is the only thing standing
    // between a raw host identifier and a rejected event.
    expect(() => _event('en_US@rg=gbzzzz'), throwsFormatException);
  });

  test('a configured client normalizes the analytics context locale', () {
    final mosaic = Mosaic.configure(
      publicSdkKey: 'public_locale_context',
      baseUrl: Uri.parse('https://api.mosaic.test'),
      purchaseProvider: MockMosaicPurchaseProvider(),
      identityStorage: MosaicMemoryIdentityStorage(),
      analyticsStorage: MosaicMemoryAnalyticsStorage(),
      locale: 'en_US@rg=gbzzzz',
    );

    expect(mosaic.analytics?.context.locale, 'en-US');
    mosaic.dispose();
  });

  test('locale targeting reads a region-override identifier as its language',
      () {
    final fixture = jsonDecode(
      repositoryFile('protocol/fixtures/placement-decision/v1/'
              'evaluator-conformance.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final ruleSet =
        const MosaicPlacementDecisionDecoder().decode(fixture['decision']);

    // The canonical `en_US` case already proves underscore tolerance. These are
    // the shapes it does not carry, and each one previously resolved to no
    // `application.locale` attribute at all, so every locale rule missed.
    for (final locale in <String>[
      'en_US@rg=gbzzzz',
      'en_US.UTF-8',
      'en-US-u-ca-buddhist',
    ]) {
      final result = const MosaicPlacementDecisionEvaluator().evaluate(
        ruleSet: ruleSet,
        context: MosaicDecisionContext(
          platform: 'android',
          applicationLocale: locale,
          applicationVersion: '1.0.0',
          entitlements: const {'pro': MosaicEntitlementDecisionState.inactive},
          products: const {
            'product_export_pro': MosaicProductDecisionState.available,
          },
        ),
        assignment: const MosaicAssignmentKey(
          type: 'installation',
          value: 'install_01',
        ),
      );
      expect(result.matchedRuleId, 'rule_locale_equals', reason: locale);
    }
  });

  // The ruled asymmetry: catalog lookup recovers a language subtag from a tag
  // with no canonical form, targeting never does. Recovery in targeting would
  // silently change which users match a Rule, so this pins the boundary a
  // refactor could most easily erase by reusing one helper for both.
  test('language recovery exists for catalog lookup and not for targeting', () {
    expect(mosaicNormalizeLocaleTag('en-US-verylongsubtag'), isNull);
    expect(mosaicRecoverLocaleLanguage('en-US-verylongsubtag'), 'en');
    expect(mosaicRecoverLocaleLanguage('!!not-a-locale'), isNull);

    final fixture = jsonDecode(
      repositoryFile('protocol/fixtures/placement-decision/v1/'
              'evaluator-conformance.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final ruleSet =
        const MosaicPlacementDecisionDecoder().decode(fixture['decision']);

    // This context matches `rule_ios_rollout` (which requires
    // `locale_matches: en`) if and only if targeting recovered `en`. It must
    // not: the range comparison is unknown, so no rule matches.
    final result = const MosaicPlacementDecisionEvaluator().evaluate(
      ruleSet: ruleSet,
      context: MosaicDecisionContext(
        platform: 'ios',
        applicationLocale: 'en-US-verylongsubtag',
        applicationVersion: '2.10.0',
        entitlements: const {'pro': MosaicEntitlementDecisionState.inactive},
        products: const {
          'product_export_pro': MosaicProductDecisionState.available,
        },
      ),
      assignment: const MosaicAssignmentKey(
        type: 'installation',
        value: 'install_01',
      ),
    );

    expect(result.matchedRuleId, isNull);
  });
}

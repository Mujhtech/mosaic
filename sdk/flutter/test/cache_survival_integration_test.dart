import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/configuration_delivery_fixture.dart';

/// Opt-in GA Drill 11 harness: the Configuration Delivery cache must keep a
/// Placement resolvable while the Mosaic API is unreachable, and the bundled
/// fallback must take over once the cache is gone.
///
/// This test talks to a real Mosaic API, so it is disabled unless the drill
/// defines below are supplied — the same opt-in shape as
/// `preview_relay_integration_test.dart`. Each phase runs as its own process so
/// the operator can stop and start the API container between phases:
///
/// ```bash
/// flutter test test/cache_survival_integration_test.dart \
///   --dart-define=MOSAIC_RUN_CACHE_SURVIVAL_INTEGRATION=true \
///   --dart-define=MOSAIC_CACHE_DRILL_PHASE=a \
///   --dart-define=MOSAIC_CACHE_DRILL_BASE_URL=http://127.0.0.1:8090 \
///   --dart-define=MOSAIC_CACHE_DRILL_SDK_KEY=<public SDK key secret> \
///   --dart-define=MOSAIC_CACHE_DRILL_CACHE_DIR=<writable directory> \
///   --dart-define=MOSAIC_CACHE_DRILL_PLACEMENT=<placement key>
/// ```
///
/// Run phase `a` against a clean cache directory, stop the API and run `b`,
/// wipe `<cache dir>/mosaic` and run `c`, then start the API and run `d`.
const bool _run = bool.fromEnvironment(
  'MOSAIC_RUN_CACHE_SURVIVAL_INTEGRATION',
);
const String _phase = String.fromEnvironment('MOSAIC_CACHE_DRILL_PHASE');
const String _baseUrl = String.fromEnvironment('MOSAIC_CACHE_DRILL_BASE_URL');
const String _sdkKey = String.fromEnvironment('MOSAIC_CACHE_DRILL_SDK_KEY');
const String _cacheDir = String.fromEnvironment('MOSAIC_CACHE_DRILL_CACHE_DIR');
const String _placement =
    String.fromEnvironment('MOSAIC_CACHE_DRILL_PLACEMENT');

/// Phase a records the digest the live API served here; phases b and d assert
/// against it. The Release `contentHash` returned by `POST …/publish` is not
/// the same value — delivery recomputes the digest over the negotiated
/// contract's projection — so the served digest is the only sound baseline.
String get _digestRecordPath => '$_cacheDir/../drill11-served-digest.txt';
String get _digest => File(_digestRecordPath).readAsStringSync().trim();

/// Bundled fallback Placement key, from the canonical Delivery v1 fixture.
const String _bundledPlacement = 'onboarding_complete';

void main() {
  test('drill 11 phase $_phase', () async {
    switch (_phase) {
      case 'a':
        await _remoteFetchPopulatesTheCache();
      case 'b':
        await _cacheServesThePlacementDuringTheOutage();
      case 'c':
        await _bundledFallbackServesAWipedCache();
      case 'd':
        await _refreshRecoversAfterTheOutage();
      default:
        fail('Unknown MOSAIC_CACHE_DRILL_PHASE "$_phase".');
    }
  }, skip: !_run);
}

Future<void> _remoteFetchPopulatesTheCache() async {
  final mosaic = _configure();
  addTearDown(mosaic.dispose);

  final refresh = await mosaic.refreshConfiguration();
  expect(refresh, isA<MosaicConfigurationUpdated>(),
      reason: 'The live API must serve a Configuration Release.');
  final accepted = (refresh as MosaicConfigurationUpdated).configuration;
  expect(accepted.source, MosaicConfigurationSource.remote);
  final digest = accepted.envelope.release.contentDigest;
  expect(digest, isNotEmpty);

  _expectPlacementResolves(mosaic, _placement, digest);
  _report(accepted, 'remote fetch');
  expect(
    Directory('$_cacheDir/mosaic').listSync().whereType<File>(),
    isNotEmpty,
    reason: 'The accepted Release must have been written to the cache.',
  );
  // Later phases compare against exactly what the live API served, so the
  // operator does not have to translate the publish response by hand.
  File(_digestRecordPath).writeAsStringSync(digest);
}

Future<void> _cacheServesThePlacementDuringTheOutage() async {
  final mosaic = _configure();
  addTearDown(mosaic.dispose);

  final load = await mosaic.loadConfiguration();
  expect(load, isA<MosaicConfigurationReady>());
  final accepted = (load as MosaicConfigurationReady).configuration;
  expect(accepted.source, MosaicConfigurationSource.cache);
  expect(accepted.envelope.release.contentDigest, _digest);

  _expectPlacementResolves(mosaic, _placement, _digest);
  _report(accepted, 'cache during outage');

  // A refresh against the stopped API must retain the cached Release instead of
  // dropping the host application to an unavailable state.
  final refresh = await mosaic.refreshConfiguration();
  expect(refresh, isA<MosaicConfigurationRetained>());
  stdout.writeln(
    'retained diagnostic: '
    '${(refresh as MosaicConfigurationRetained).diagnosticCode}',
  );
  _expectPlacementResolves(mosaic, _placement, _digest);
}

Future<void> _bundledFallbackServesAWipedCache() async {
  expect(
    Directory('$_cacheDir/mosaic').existsSync(),
    isFalse,
    reason: 'Phase c requires the cache directory to have been wiped.',
  );
  final mosaic = _configure(
    bundledFallbackLoader: () async => deliveryFixtureSource(
      'placement-binding.json',
    ),
  );
  addTearDown(mosaic.dispose);

  final load = await mosaic.loadConfiguration();
  expect(load, isA<MosaicConfigurationReady>());
  final accepted = (load as MosaicConfigurationReady).configuration;
  expect(accepted.source, MosaicConfigurationSource.bundledFallback);
  expect(accepted.envelope.release.contentDigest, isNot(_digest));

  _expectPlacementResolves(
    mosaic,
    _bundledPlacement,
    accepted.envelope.release.contentDigest,
  );
  _report(accepted, 'bundled fallback');
}

Future<void> _refreshRecoversAfterTheOutage() async {
  final mosaic = _configure();
  addTearDown(mosaic.dispose);

  final refresh = await mosaic.refreshConfiguration();
  expect(
    refresh,
    anyOf(
      isA<MosaicConfigurationUpdated>(),
      isA<MosaicConfigurationNotModified>(),
    ),
    reason: 'The restarted API must serve 200 or 304, not a retained failure.',
  );
  final accepted = switch (refresh) {
    MosaicConfigurationUpdated(:final configuration) => configuration,
    MosaicConfigurationNotModified(:final configuration) => configuration,
    _ => fail('Unreachable'),
  };
  expect(accepted.envelope.release.contentDigest, _digest);
  _expectPlacementResolves(mosaic, _placement, _digest);
  _report(
    accepted,
    refresh is MosaicConfigurationNotModified
        ? '304 not modified'
        : '200 fresh',
  );
}

Mosaic _configure({MosaicBundledConfigurationLoader? bundledFallbackLoader}) =>
    Mosaic.configure(
      publicSdkKey: _sdkKey,
      baseUrl: Uri.parse(_baseUrl),
      purchaseProvider: MockMosaicPurchaseProvider(),
      cache: MosaicFileConfigurationCache(
        directoryProvider: () async => Directory(_cacheDir),
      ),
      identityStorage: MosaicMemoryIdentityStorage(),
      analyticsStorage: MosaicMemoryAnalyticsStorage(),
      experimentAssignmentStorage: MosaicMemoryExperimentAssignmentStorage(),
      bundledFallbackLoader: bundledFallbackLoader,
      onDiagnostic: (diagnostic) =>
          stdout.writeln('diagnostic: ${diagnostic.code}'),
    );

void _expectPlacementResolves(
  Mosaic mosaic,
  String placementKey,
  String expectedDigest,
) {
  final accepted = mosaic.acceptedConfiguration;
  expect(accepted, isNotNull,
      reason: 'Placement "$placementKey" needs accepted configuration.');
  final ruleSet = accepted!.envelope.release.decisionForPlacement(placementKey);
  expect(ruleSet, isNotNull,
      reason: 'Placement "$placementKey" must carry a decision rule set.');
  expect(accepted.envelope.release.contentDigest, expectedDigest);
  final paywalls = accepted.envelope.release.paywallVersions.values;
  expect(paywalls, isNotEmpty);
  for (final paywall in paywalls) {
    expect(paywall.document.screens, isNotEmpty);
    stdout.writeln(
      'placement $placementKey -> paywall ${paywall.paywallId} '
      'document ${paywall.document.id} '
      'screens ${paywall.document.screens.length}',
    );
  }
}

void _report(MosaicAcceptedConfiguration accepted, String label) {
  stdout.writeln(
    '$label: source ${accepted.source.name} '
    'release ${accepted.envelope.release.id} '
    'digest ${accepted.envelope.release.contentDigest} '
    'etag ${accepted.etag}',
  );
}

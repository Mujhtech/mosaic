import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  test('uses a valid local candidate without reading the bundled fallback',
      () async {
    var fallbackRead = false;
    final result = await const MosaicPaywallLoader().load(
      candidateDocument: canonicalFixtureSource(),
      bundledFallbackLoader: () async {
        fallbackRead = true;
        return null;
      },
    );

    expect(result, isA<MosaicPaywallLoaded>());
    expect(
      (result as MosaicPaywallLoaded).source,
      MosaicPaywallDocumentSource.primary,
    );
    expect(fallbackRead, isFalse);
  });

  test('atomically replaces a rejected primary with the canonical bundle',
      () async {
    final diagnostics = <MosaicDiagnostic>[];
    final result = await const MosaicPaywallLoader().load(
      candidateDocument: '{"schemaVersion":"unsupported"}',
      bundledFallbackLoader: () async => canonicalFixtureSource(),
      onDiagnostic: diagnostics.add,
    );

    expect(result, isA<MosaicPaywallLoaded>());
    expect(
      (result as MosaicPaywallLoaded).source,
      MosaicPaywallDocumentSource.bundledFallback,
    );
    expect(result.document.id, 'phase1-complete-paywall');
    expect(diagnostics.single.code, 'primary_document_rejected');
    expect(diagnostics.single.message, isNot(contains('unsupported')));
  });

  test('returns configuration unavailable when fallback is invalid', () async {
    final diagnostics = <MosaicDiagnostic>[];
    final result = await const MosaicPaywallLoader().load(
      candidateDocument: 'invalid primary',
      bundledFallbackLoader: () async => 'invalid fallback',
      onDiagnostic: diagnostics.add,
    );

    expect(result, isA<MosaicPaywallLoadUnavailable>());
    expect(
      (result as MosaicPaywallLoadUnavailable).diagnosticCode,
      'bundled_fallback_rejected',
    );
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      <String>['primary_document_rejected', 'bundled_fallback_rejected'],
    );
  });

  test('returns configuration unavailable for missing or failed bundle',
      () async {
    final missing = await const MosaicPaywallLoader().load(
      bundledFallbackLoader: () async => null,
    );
    expect(
      (missing as MosaicPaywallLoadUnavailable).diagnosticCode,
      'bundled_fallback_missing',
    );

    final failed = await const MosaicPaywallLoader().load(
      bundledFallbackLoader: () async => throw StateError('private detail'),
    );
    expect(
      (failed as MosaicPaywallLoadUnavailable).diagnosticCode,
      'bundled_fallback_load_failed',
    );
  });
}

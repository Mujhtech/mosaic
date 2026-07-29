import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

final class _ScriptedTransport implements MosaicCustomerEntitlementTransport {
  _ScriptedTransport(this.responses);

  final List<MosaicCustomerEntitlementSyncResponse> responses;
  var calls = 0;

  @override
  Future<MosaicCustomerEntitlementSyncResponse> sync(
    MosaicCustomerEntitlementSyncRequest request,
  ) async {
    final response = responses[calls.clamp(0, responses.length - 1)];
    calls += 1;
    return response;
  }
}

final class _ScriptedProvider implements MosaicPurchaseProvider {
  _ScriptedProvider(this.result);

  final MosaicRestoreResult result;
  var restores = 0;

  @override
  Future<MosaicRestoreResult> restore() async {
    restores += 1;
    return result;
  }

  @override
  Future<MosaicProductLoadResult> loadProducts(Iterable<String> productIds) =>
      throw UnimplementedError();

  @override
  Future<MosaicPurchaseResult> purchase(String productId) =>
      throw UnimplementedError();

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() =>
      throw UnimplementedError();
}

void main() {
  final root = repositoryDirectory(
    'protocol/fixtures/authoritative-entitlement/v1',
  );
  String fixture(String path) => File('${root.path}/$path').readAsStringSync();

  final now = DateTime.utc(2026, 7, 28, 12, 30);

  MosaicCustomerEntitlementSyncReceived received(String path) =>
      MosaicCustomerEntitlementSyncReceived(
        source: fixture(path),
      );

  MosaicCustomerEntitlementRuntime runtimeWith(
    MosaicCustomerEntitlementTransport transport,
  ) =>
      MosaicCustomerEntitlementRuntime(
        baseUrl: Uri.parse('https://api.mosaic.test'),
        publicSdkKey: 'public_key',
        transport: transport,
        cache: MosaicMemoryCustomerEntitlementCache(),
        tokenProvider: (_) async => MosaicCustomerToken(
          value: 'mcat_secret',
          tokenId: 'token-a',
          expiresAt: now.add(const Duration(hours: 1)),
        ),
        settings:
            const MosaicCustomerEntitlementSettings(refreshOnResume: false),
        clock: () => now,
      );

  MosaicCustomerRestoreCoordinator coordinator(
    MosaicPurchaseProvider provider,
    MosaicCustomerEntitlementRuntime runtime,
  ) =>
      MosaicCustomerRestoreCoordinator(
        purchaseProvider: provider,
        entitlements: runtime,
        clock: () => now,
        // The poll bound is real; only the waiting is elided so the suite does
        // not spend six seconds proving it.
        delay: (_) async {},
      );

  test('restored requires an accepted snapshot that reflects the restore',
      () async {
    final transport = _ScriptedTransport(
      <MosaicCustomerEntitlementSyncResponse>[
        received('snapshots/active-subscription.json'),
      ],
    );
    final runtime = runtimeWith(transport);
    final provider = _ScriptedProvider(MosaicRestored(const <MosaicEntitlement>[
      MosaicEntitlement(id: 'pro'),
    ]));

    final result =
        await coordinator(provider, runtime).restorePurchasesAndSync();

    expect(result, isA<MosaicCustomerEntitlementsRestored>());
    final restored = result as MosaicCustomerEntitlementsRestored;
    expect(restored.snapshotVersion, 4);
    expect(
      restored.providerOutcome,
      MosaicCustomerRestoreProviderOutcome.completed,
    );
    expect(restored.outcome.wireValue, 'restored');
    runtime.dispose();
  });

  test('a successful native restore Mosaic has not confirmed is pending',
      () async {
    // The failure this prevents: telling a user their purchases are restored
    // because the store said so, while Mosaic still grants nothing.
    final transport = _ScriptedTransport(
      <MosaicCustomerEntitlementSyncResponse>[
        const MosaicCustomerEntitlementSyncFailed(
          diagnosticCode: 'entitlements.sync.networkFailed',
        ),
      ],
    );
    final runtime = runtimeWith(transport);
    final provider = _ScriptedProvider(MosaicRestored(const <MosaicEntitlement>[
      MosaicEntitlement(id: 'pro'),
    ]));

    final result =
        await coordinator(provider, runtime).restorePurchasesAndSync();

    expect(result, isA<MosaicCustomerRestoreValidationPending>());
    expect(
      (result as MosaicCustomerRestoreValidationPending).uncertainty.isDefinite,
      isFalse,
    );
    expect(result.outcome.wireValue, 'validation_pending');
    // Three attempts, exactly as the cross-platform bound states.
    expect(transport.calls, mosaicCustomerRestorePollAttempts);
    runtime.dispose();
  });

  test('an unchanged snapshot is never reported as restored', () async {
    final transport = _ScriptedTransport(
      <MosaicCustomerEntitlementSyncResponse>[
        received('snapshots/active-subscription.json'),
        const MosaicCustomerEntitlementSyncNotModified(),
      ],
    );
    final runtime = runtimeWith(transport);
    await runtime.refresh();
    final provider = _ScriptedProvider(MosaicRestored(const <MosaicEntitlement>[
      MosaicEntitlement(id: 'pro'),
    ]));

    final result =
        await coordinator(provider, runtime).restorePurchasesAndSync();

    // The version did not advance, so nothing new was proven. Access may well
    // already be active; that is a different question from "the restore
    // produced something".
    expect(result, isA<MosaicCustomerRestoreValidationPending>());
    runtime.dispose();
  });

  test('nothing to restore, and Mosaic agreeing, is a definite answer',
      () async {
    final transport = _ScriptedTransport(
      <MosaicCustomerEntitlementSyncResponse>[
        const MosaicCustomerEntitlementSyncNotModified(),
      ],
    );
    final runtime = runtimeWith(transport);
    final provider = _ScriptedProvider(const MosaicNothingToRestore());

    final result =
        await coordinator(provider, runtime).restorePurchasesAndSync();

    expect(result, isA<MosaicCustomerRestoreNoAdditionalPurchases>());
    expect(
      result.providerOutcome,
      MosaicCustomerRestoreProviderOutcome.noPurchasesFound,
    );
    runtime.dispose();
  });

  test('a cancelled restore never reaches the authoritative poll', () async {
    final transport =
        _ScriptedTransport(<MosaicCustomerEntitlementSyncResponse>[]);
    final runtime = runtimeWith(transport);
    final provider = _ScriptedProvider(const MosaicRestoreCancelled());

    final result =
        await coordinator(provider, runtime).restorePurchasesAndSync();

    expect(result, isA<MosaicCustomerRestoreFailed>());
    expect(
      result.providerOutcome,
      MosaicCustomerRestoreProviderOutcome.cancelled,
    );
    expect(transport.calls, 0);
    runtime.dispose();
  });

  test('a provider failure is reported as unavailable, not as no purchases',
      () async {
    final transport =
        _ScriptedTransport(<MosaicCustomerEntitlementSyncResponse>[]);
    final runtime = runtimeWith(transport);
    final provider = _ScriptedProvider(
      const MosaicRestoreProviderUnavailable(),
    );

    final result =
        await coordinator(provider, runtime).restorePurchasesAndSync();

    expect(result, isA<MosaicCustomerRestoreProviderUnavailable>());
    expect(result.outcome.wireValue, 'provider_unavailable');
    runtime.dispose();
  });

  test('every restore reports observable stages', () async {
    final transport = _ScriptedTransport(
      <MosaicCustomerEntitlementSyncResponse>[
        received('snapshots/active-subscription.json'),
      ],
    );
    final runtime = runtimeWith(transport);
    final provider = _ScriptedProvider(MosaicRestored(const <MosaicEntitlement>[
      MosaicEntitlement(id: 'pro'),
    ]));

    final result =
        await coordinator(provider, runtime).restorePurchasesAndSync();

    expect(
      result.stages.map((stage) => stage.name),
      containsAllInOrder(<MosaicCustomerRestoreStageName>[
        MosaicCustomerRestoreStageName.providerRestore,
        MosaicCustomerRestoreStageName.observationHandoff,
        MosaicCustomerRestoreStageName.authoritativeSync,
        MosaicCustomerRestoreStageName.completed,
      ]),
    );
    runtime.dispose();
  });

  test('the SDK vocabulary covers every canonical restore outcome', () {
    // Conformance against the canonical restore fixtures. A contract outcome
    // the SDK cannot express would silently become some other outcome.
    final outcomes = <String>{};
    final providerOutcomes = <String>{};
    for (final file
        in canonicalFixtureFiles(Directory('${root.path}/restores'))) {
      final payload = (jsonDecode(file.readAsStringSync())
          as Map<String, Object?>)['payload']! as Map<String, Object?>;
      outcomes.add(payload['outcome']! as String);
      providerOutcomes.add(payload['providerOutcome']! as String);
    }

    final known =
        MosaicCustomerRestoreOutcome.values.map((value) => value.wireValue);
    final knownProvider = MosaicCustomerRestoreProviderOutcome.values
        .map((value) => value.wireValue);
    expect(known, containsAll(outcomes));
    expect(knownProvider, containsAll(providerOutcomes));
  });
}

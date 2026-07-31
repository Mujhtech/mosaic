import 'dart:async';

import 'commerce.dart';
import 'customer_entitlement_runtime.dart';
import 'customer_entitlements.dart';
import 'transaction_observation.dart';

/// Mosaic's authoritative answer to a restore. It is separate from what the
/// native provider did, because a successful native restore whose facts have
/// not been validated is not restored access, and reporting it as one is how a
/// restore flow starts lying.
enum MosaicCustomerRestoreOutcome {
  restored('restored'),
  noAdditionalPurchases('no_additional_purchases'),
  validationPending('validation_pending'),
  identityUnresolved('identity_unresolved'),
  productUnresolved('product_unresolved'),
  providerUnavailable('provider_unavailable'),
  failed('failed');

  const MosaicCustomerRestoreOutcome(this.wireValue);

  final String wireValue;
}

/// What the native provider restore itself did, reported separately and never
/// merged into the authoritative outcome.
enum MosaicCustomerRestoreProviderOutcome {
  completed('completed'),
  noPurchasesFound('no_purchases_found'),
  cancelled('cancelled'),
  failed('failed'),
  unsupported('unsupported'),
  notAttempted('not_attempted');

  const MosaicCustomerRestoreProviderOutcome(this.wireValue);

  final String wireValue;
}

enum MosaicCustomerRestoreStageName {
  providerRestore,
  observationHandoff,
  authoritativeSync,
  completed,
}

/// One observable step of a restore. The example application renders these;
/// support uses them to tell "the store found nothing" apart from "Mosaic has
/// not validated it yet".
final class MosaicCustomerRestoreStage {
  MosaicCustomerRestoreStage({
    required this.name,
    required this.detail,
    required DateTime at,
  }) : at = at.toUtc();

  final MosaicCustomerRestoreStageName name;
  final String detail;
  final DateTime at;
}

/// The outcome of `restorePurchasesAndSync`, on two independent axes.
sealed class MosaicCustomerRestoreResult {
  MosaicCustomerRestoreResult({
    required this.providerOutcome,
    required DateTime requestedAt,
    required Iterable<MosaicCustomerRestoreStage> stages,
  })  : requestedAt = requestedAt.toUtc(),
        stages = List.unmodifiable(stages);

  MosaicCustomerRestoreOutcome get outcome;

  final MosaicCustomerRestoreProviderOutcome providerOutcome;
  final DateTime requestedAt;
  final List<MosaicCustomerRestoreStage> stages;
}

/// The only success. It exists only once an accepted snapshot at a higher
/// version reflects the restore: that snapshot is the evidence that makes the
/// outcome authoritative rather than hopeful.
final class MosaicCustomerEntitlementsRestored
    extends MosaicCustomerRestoreResult {
  MosaicCustomerEntitlementsRestored({
    required super.providerOutcome,
    required super.requestedAt,
    required super.stages,
    required this.snapshotVersion,
    required DateTime completedAt,
    required this.snapshot,
  })  : completedAt = completedAt.toUtc(),
        super();

  @override
  MosaicCustomerRestoreOutcome get outcome =>
      MosaicCustomerRestoreOutcome.restored;

  final int snapshotVersion;
  final DateTime completedAt;
  final MosaicCustomerEntitlementSnapshot snapshot;
}

/// The provider restored purchases and Mosaic has not yet confirmed them. This
/// is the honest answer inside the poll bound, and it is not a failure.
final class MosaicCustomerRestoreValidationPending
    extends MosaicCustomerRestoreResult {
  MosaicCustomerRestoreValidationPending({
    required super.providerOutcome,
    required super.requestedAt,
    required super.stages,
    required this.pendingValidationCount,
    required this.uncertainty,
  }) : super();

  @override
  MosaicCustomerRestoreOutcome get outcome =>
      MosaicCustomerRestoreOutcome.validationPending;

  final int pendingValidationCount;
  final MosaicCustomerUncertainty uncertainty;
}

/// The provider found nothing further to restore and Mosaic agrees.
final class MosaicCustomerRestoreNoAdditionalPurchases
    extends MosaicCustomerRestoreResult {
  MosaicCustomerRestoreNoAdditionalPurchases({
    required super.providerOutcome,
    required super.requestedAt,
    required super.stages,
  }) : super();

  @override
  MosaicCustomerRestoreOutcome get outcome =>
      MosaicCustomerRestoreOutcome.noAdditionalPurchases;
}

/// No Billing Customer could be resolved, so there is nowhere to attach the
/// restore. Access is not claimed in either direction.
final class MosaicCustomerRestoreIdentityUnresolved
    extends MosaicCustomerRestoreResult {
  MosaicCustomerRestoreIdentityUnresolved({
    required super.providerOutcome,
    required super.requestedAt,
    required super.stages,
    required this.uncertainty,
  }) : super();

  @override
  MosaicCustomerRestoreOutcome get outcome =>
      MosaicCustomerRestoreOutcome.identityUnresolved;

  final MosaicCustomerUncertainty uncertainty;
}

final class MosaicCustomerRestoreProviderUnavailable
    extends MosaicCustomerRestoreResult {
  MosaicCustomerRestoreProviderUnavailable({
    required super.providerOutcome,
    required super.requestedAt,
    required super.stages,
    required this.uncertainty,
  }) : super();

  @override
  MosaicCustomerRestoreOutcome get outcome =>
      MosaicCustomerRestoreOutcome.providerUnavailable;

  final MosaicCustomerUncertainty uncertainty;
}

final class MosaicCustomerRestoreFailed extends MosaicCustomerRestoreResult {
  MosaicCustomerRestoreFailed({
    required super.providerOutcome,
    required super.requestedAt,
    required super.stages,
    required this.uncertainty,
    this.reasonCode,
  }) : super();

  @override
  MosaicCustomerRestoreOutcome get outcome =>
      MosaicCustomerRestoreOutcome.failed;

  final MosaicCustomerUncertainty uncertainty;
  final String? reasonCode;
}

typedef MosaicCustomerRestoreClock = DateTime Function();
typedef MosaicCustomerRestoreDelay = Future<void> Function(Duration duration);

DateTime _systemClock() => DateTime.now().toUtc();

Future<void> _wait(Duration duration) => Future<void>.delayed(duration);

/// Composes a native restore, the Transaction Observation handoff, and a
/// bounded authoritative poll into one honest multi-stage result.
///
/// The Flutter Commerce Provider contract exposes no provider transaction
/// references at restore, so references reach Mosaic through the Commerce
/// Provider update stream the SDK already bridges into the observation
/// runtime. This coordinator flushes that queue rather than synthesizing
/// references it does not have.
final class MosaicCustomerRestoreCoordinator {
  MosaicCustomerRestoreCoordinator({
    required this.purchaseProvider,
    required this.entitlements,
    this.observations,
    this.clock = _systemClock,
    this.pollAttempts = mosaicCustomerRestorePollAttempts,
    this.pollBudget = mosaicCustomerRestorePollBudget,
    this.delay = _wait,
  });

  final MosaicPurchaseProvider purchaseProvider;
  final MosaicCustomerEntitlementRuntime entitlements;
  final MosaicTransactionObservationRuntime? observations;
  final MosaicCustomerRestoreClock clock;
  final int pollAttempts;
  final Duration pollBudget;
  final MosaicCustomerRestoreDelay delay;

  Future<MosaicCustomerRestoreResult> restorePurchasesAndSync() async {
    final requestedAt = clock().toUtc();
    final stages = <MosaicCustomerRestoreStage>[];
    final baseline = entitlements.snapshot?.snapshotVersion ?? 0;

    final MosaicRestoreResult providerResult;
    try {
      providerResult = await purchaseProvider.restore();
    } on Object {
      stages.add(_stage(
        MosaicCustomerRestoreStageName.providerRestore,
        'The provider restore threw.',
      ));
      return MosaicCustomerRestoreFailed(
        providerOutcome: MosaicCustomerRestoreProviderOutcome.failed,
        requestedAt: requestedAt,
        stages: stages,
        uncertainty: _uncertainty(
          MosaicCustomerUncertaintyReason.providerUnavailable,
          requestedAt,
        ),
        reasonCode: 'entitlements.restore.providerThrew',
      );
    }
    final providerOutcome = _providerOutcome(providerResult);
    stages.add(_stage(
      MosaicCustomerRestoreStageName.providerRestore,
      providerOutcome.wireValue,
    ));

    switch (providerOutcome) {
      case MosaicCustomerRestoreProviderOutcome.cancelled:
      case MosaicCustomerRestoreProviderOutcome.notAttempted:
      case MosaicCustomerRestoreProviderOutcome.unsupported:
        return MosaicCustomerRestoreFailed(
          providerOutcome: providerOutcome,
          requestedAt: requestedAt,
          stages: stages,
          uncertainty: _uncertainty(
            MosaicCustomerUncertaintyReason.missingFact,
            requestedAt,
          ),
          reasonCode: 'entitlements.restore.${providerOutcome.name}',
        );
      case MosaicCustomerRestoreProviderOutcome.failed:
        return MosaicCustomerRestoreProviderUnavailable(
          providerOutcome: providerOutcome,
          requestedAt: requestedAt,
          stages: stages,
          uncertainty: _uncertainty(
            MosaicCustomerUncertaintyReason.providerUnavailable,
            requestedAt,
          ),
        );
      case MosaicCustomerRestoreProviderOutcome.completed:
      case MosaicCustomerRestoreProviderOutcome.noPurchasesFound:
        break;
    }

    // The handoff is a trigger for server-side validation and never proof. It
    // can fail without changing what the restore reports.
    var handedOff = 0;
    final runtime = observations;
    if (runtime != null) {
      try {
        final flushed = await runtime.flush();
        handedOff = switch (flushed) {
          MosaicTransactionObservationFlushCompleted(:final sent) => sent,
          _ => 0,
        };
      } on Object {
        handedOff = 0;
      }
    }
    stages.add(_stage(
      MosaicCustomerRestoreStageName.observationHandoff,
      '$handedOff observation(s) submitted for validation.',
    ));

    // Bounded poll. Three attempts across roughly six seconds, identical on
    // every platform, so a user does not wait indefinitely for a projection.
    final interval = Duration(
      microseconds: pollAttempts <= 1
          ? 0
          : pollBudget.inMicroseconds ~/ (pollAttempts - 1),
    );
    for (var attempt = 0; attempt < pollAttempts; attempt += 1) {
      if (attempt > 0 && interval > Duration.zero) await delay(interval);
      final refreshed = await entitlements.refresh();
      final snapshot = entitlements.snapshot;
      stages.add(_stage(
        MosaicCustomerRestoreStageName.authoritativeSync,
        'Attempt ${attempt + 1}: ${_describe(refreshed)}',
      ));
      if (snapshot != null && snapshot.snapshotVersion > baseline) {
        // Success is the accepted snapshot, not the provider's optimism.
        stages.add(_stage(
          MosaicCustomerRestoreStageName.completed,
          'Snapshot ${snapshot.snapshotVersion} reflects the restore.',
        ));
        return MosaicCustomerEntitlementsRestored(
          providerOutcome: providerOutcome,
          requestedAt: requestedAt,
          stages: stages,
          snapshotVersion: snapshot.snapshotVersion,
          completedAt: clock().toUtc(),
          snapshot: snapshot,
        );
      }
    }

    if (providerOutcome ==
        MosaicCustomerRestoreProviderOutcome.noPurchasesFound) {
      // The store has nothing further and Mosaic's state did not move. Those
      // two agreeing is a definite answer.
      return MosaicCustomerRestoreNoAdditionalPurchases(
        providerOutcome: providerOutcome,
        requestedAt: requestedAt,
        stages: stages,
      );
    }
    if (entitlements.snapshot == null &&
        entitlements.diagnostics.token.hasToken == false) {
      return MosaicCustomerRestoreIdentityUnresolved(
        providerOutcome: providerOutcome,
        requestedAt: requestedAt,
        stages: stages,
        uncertainty: _uncertainty(
          MosaicCustomerUncertaintyReason.identityUnresolved,
          requestedAt,
        ),
      );
    }
    return MosaicCustomerRestoreValidationPending(
      providerOutcome: providerOutcome,
      requestedAt: requestedAt,
      stages: stages,
      pendingValidationCount: handedOff,
      uncertainty: _uncertainty(
        MosaicCustomerUncertaintyReason.staleValidation,
        requestedAt,
      ),
    );
  }

  MosaicCustomerRestoreStage _stage(
    MosaicCustomerRestoreStageName name,
    String detail,
  ) =>
      MosaicCustomerRestoreStage(name: name, detail: detail, at: clock());

  MosaicCustomerUncertainty _uncertainty(
    MosaicCustomerUncertaintyReason reason,
    DateTime since,
  ) =>
      MosaicCustomerUncertainty(
        reason: reason,
        since: since,
        expectedResolution: MosaicCustomerExpectedResolution.automaticRetry,
      );

  static String _describe(MosaicCustomerEntitlementRefreshResult result) =>
      switch (result) {
        MosaicCustomerEntitlementUpdated(:final snapshot) =>
          'accepted v${snapshot.snapshotVersion}',
        MosaicCustomerEntitlementUnchanged(:final snapshotVersion) =>
          'unchanged at v$snapshotVersion',
        MosaicCustomerEntitlementRejected(:final reasonCode) =>
          'rejected: $reasonCode',
        MosaicCustomerEntitlementUnavailable(:final reasonCode) =>
          'unavailable: $reasonCode',
      };

  static MosaicCustomerRestoreProviderOutcome _providerOutcome(
    MosaicRestoreResult result,
  ) =>
      switch (result) {
        MosaicRestored() => MosaicCustomerRestoreProviderOutcome.completed,
        MosaicNothingToRestore() =>
          MosaicCustomerRestoreProviderOutcome.noPurchasesFound,
        MosaicRestoreCancelled() =>
          MosaicCustomerRestoreProviderOutcome.cancelled,
        MosaicRestoreProviderUnavailable() =>
          MosaicCustomerRestoreProviderOutcome.failed,
        MosaicRestoreConfigurationUnavailable() =>
          MosaicCustomerRestoreProviderOutcome.notAttempted,
        MosaicRestoreFailed() => MosaicCustomerRestoreProviderOutcome.failed,
        MosaicDetailedRestoreResult(:final outcome) => switch (outcome) {
            MosaicCommerceRecoveryOutcome.restored =>
              MosaicCustomerRestoreProviderOutcome.completed,
            MosaicCommerceRecoveryOutcome.nothingToRestore =>
              MosaicCustomerRestoreProviderOutcome.noPurchasesFound,
            MosaicCommerceRecoveryOutcome.cancelled =>
              MosaicCustomerRestoreProviderOutcome.cancelled,
            MosaicCommerceRecoveryOutcome.providerUnavailable ||
            MosaicCommerceRecoveryOutcome.failed =>
              MosaicCustomerRestoreProviderOutcome.failed,
          },
      };
}

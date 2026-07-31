import 'dart:async';

import 'commerce_configuration.dart';
import 'configuration_delivery.dart';

enum MosaicBillingPeriodUnit { day, week, month, year }

final class MosaicBillingPeriod {
  const MosaicBillingPeriod({required this.unit, required this.value})
      : assert(value > 0);

  final MosaicBillingPeriodUnit unit;
  final int value;
}

enum MosaicCommerceOfferEligibility { eligible, ineligible, unknown }

final class MosaicCommerceTrial {
  const MosaicCommerceTrial({
    required this.period,
    this.eligibility = MosaicCommerceOfferEligibility.unknown,
  });

  final MosaicBillingPeriod period;
  final MosaicCommerceOfferEligibility eligibility;
}

enum MosaicCommerceIntroductoryPaymentMode { payAsYouGo, payUpFront }

final class MosaicCommerceIntroductoryOffer {
  const MosaicCommerceIntroductoryOffer({
    required this.localizedPrice,
    required this.period,
    required this.cycles,
    required this.paymentMode,
    this.eligibility = MosaicCommerceOfferEligibility.unknown,
  });

  final String localizedPrice;
  final MosaicBillingPeriod period;
  final int cycles;
  final MosaicCommerceIntroductoryPaymentMode paymentMode;
  final MosaicCommerceOfferEligibility eligibility;
}

/// Provider-neutral product details resolved at runtime.
final class MosaicProduct {
  const MosaicProduct({
    required this.id,
    required this.title,
    required this.localizedPrice,
    this.localizedPeriod,
    this.currencyCode,
    this.billingPeriod,
    this.type,
    this.locale,
    this.entitlementKeys = const <String>{},
    this.trial,
    this.introductoryOffer,
  });

  /// Stable Mosaic Product ID. Provider identifiers never cross this boundary.
  final String id;
  final String title;

  /// Provider-localized display price, or `null` when the provider cannot
  /// supply one. Price-dependent Product Cards are unavailable in that case.
  final String? localizedPrice;

  /// Runtime-only localized period, such as "month" or "year".
  final String? localizedPeriod;

  final String? currencyCode;
  final MosaicBillingPeriod? billingPeriod;
  final MosaicCommerceProductType? type;
  final String? locale;
  final Set<String> entitlementKeys;
  final MosaicCommerceTrial? trial;
  final MosaicCommerceIntroductoryOffer? introductoryOffer;
}

/// Provider-neutral entitlement returned by a purchase adapter.
final class MosaicEntitlement {
  const MosaicEntitlement({required this.id});

  final String id;

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is MosaicEntitlement && id == other.id;

  @override
  int get hashCode => id.hashCode;
}

sealed class MosaicProductLoadResult {
  const MosaicProductLoadResult();
}

final class MosaicProductsLoaded extends MosaicProductLoadResult {
  MosaicProductsLoaded(
    Iterable<MosaicProduct> products, {
    Iterable<String> unavailableProductIds = const <String>[],
  })  : products = List.unmodifiable(products),
        unavailableProductIds = List.unmodifiable(unavailableProductIds);

  final List<MosaicProduct> products;

  /// Requested provider identifiers omitted because they were unavailable.
  final List<String> unavailableProductIds;
}

final class MosaicProductsUnavailable extends MosaicProductLoadResult {
  MosaicProductsUnavailable(
    Iterable<String> productIds, {
    this.message,
    this.diagnostic,
  }) : productIds = List.unmodifiable(productIds);

  final List<String> productIds;
  final String? message;
  final MosaicCommerceDiagnostic? diagnostic;
}

sealed class MosaicPurchaseResult {
  const MosaicPurchaseResult();
}

final class MosaicPurchased extends MosaicPurchaseResult {
  const MosaicPurchased({
    required this.productId,
    this.transactionId,
    this.activeEntitlements = const <MosaicEntitlement>{},
  });

  final String productId;
  final String? transactionId;
  final Set<MosaicEntitlement> activeEntitlements;
}

final class MosaicAlreadyEntitled extends MosaicPurchaseResult {
  const MosaicAlreadyEntitled({
    required this.productId,
    this.activeEntitlements = const <MosaicEntitlement>{},
  });

  final String productId;
  final Set<MosaicEntitlement> activeEntitlements;
}

final class MosaicPurchaseCancelled extends MosaicPurchaseResult {
  const MosaicPurchaseCancelled({required this.productId});

  final String productId;
}

final class MosaicPurchasePending extends MosaicPurchaseResult {
  const MosaicPurchasePending({required this.productId});

  final String productId;
}

final class MosaicPurchaseDeferred extends MosaicPurchaseResult {
  const MosaicPurchaseDeferred({required this.productId});

  final String productId;
}

final class MosaicPurchaseProductUnavailable extends MosaicPurchaseResult {
  const MosaicPurchaseProductUnavailable({required this.productId});

  final String productId;
}

final class MosaicPurchaseProviderUnavailable extends MosaicPurchaseResult {
  const MosaicPurchaseProviderUnavailable({
    required this.productId,
    this.diagnostic,
  });

  final String productId;
  final MosaicCommerceDiagnostic? diagnostic;
}

final class MosaicPurchaseConfigurationUnavailable
    extends MosaicPurchaseResult {
  const MosaicPurchaseConfigurationUnavailable({required this.productId});

  final String productId;
}

final class MosaicPurchaseFailed extends MosaicPurchaseResult {
  const MosaicPurchaseFailed({
    required this.productId,
    required this.message,
    this.diagnostic,
  });

  final String productId;
  final String message;
  final MosaicCommerceDiagnostic? diagnostic;
}

sealed class MosaicRestoreResult {
  const MosaicRestoreResult();
}

final class MosaicRestored extends MosaicRestoreResult {
  MosaicRestored(Iterable<MosaicEntitlement> entitlements)
      : entitlements = Set.unmodifiable(entitlements);

  final Set<MosaicEntitlement> entitlements;
}

final class MosaicNothingToRestore extends MosaicRestoreResult {
  const MosaicNothingToRestore();
}

final class MosaicRestoreCancelled extends MosaicRestoreResult {
  const MosaicRestoreCancelled();
}

final class MosaicRestoreProviderUnavailable extends MosaicRestoreResult {
  const MosaicRestoreProviderUnavailable({this.diagnostic});

  final MosaicCommerceDiagnostic? diagnostic;
}

final class MosaicRestoreConfigurationUnavailable extends MosaicRestoreResult {
  const MosaicRestoreConfigurationUnavailable();
}

final class MosaicRestoreFailed extends MosaicRestoreResult {
  const MosaicRestoreFailed({required this.message, this.diagnostic});

  final String message;
  final MosaicCommerceDiagnostic? diagnostic;
}

enum MosaicCommerceRecoveryOutcome {
  restored,
  nothingToRestore,
  cancelled,
  providerUnavailable,
  failed,
}

final class MosaicCommerceRecoveryMetadata {
  MosaicCommerceRecoveryMetadata({
    required this.operationId,
    required this.providerId,
    required this.recoveryMode,
    required this.completedAt,
    Iterable<MosaicCommerceDiagnostic> diagnostics =
        const <MosaicCommerceDiagnostic>[],
  }) : diagnostics = List.unmodifiable(diagnostics);

  final String operationId;
  final String providerId;
  final String recoveryMode;
  final DateTime completedAt;
  final List<MosaicCommerceDiagnostic> diagnostics;
}

/// Complete Commerce Provider Contract v2 recovery result.
final class MosaicDetailedRestoreResult extends MosaicRestoreResult {
  MosaicDetailedRestoreResult({
    required this.outcome,
    required this.metadata,
    Iterable<MosaicEntitlement> entitlements = const <MosaicEntitlement>[],
  }) : entitlements = Set.unmodifiable(entitlements);

  final MosaicCommerceRecoveryOutcome outcome;
  final Set<MosaicEntitlement> entitlements;
  final MosaicCommerceRecoveryMetadata metadata;
}

sealed class MosaicActiveEntitlementsResult {
  const MosaicActiveEntitlementsResult();
}

final class MosaicActiveEntitlements extends MosaicActiveEntitlementsResult {
  MosaicActiveEntitlements(Iterable<MosaicEntitlement> entitlements)
      : entitlements = Set.unmodifiable(entitlements);

  final Set<MosaicEntitlement> entitlements;
}

final class MosaicEntitlementsUnknown extends MosaicActiveEntitlementsResult {
  const MosaicEntitlementsUnknown({this.diagnostic});

  final MosaicCommerceDiagnostic? diagnostic;
}

final class MosaicEntitlementsProviderUnavailable
    extends MosaicActiveEntitlementsResult {
  const MosaicEntitlementsProviderUnavailable({this.diagnostic});

  final MosaicCommerceDiagnostic? diagnostic;
}

final class MosaicEntitlementsFailed extends MosaicActiveEntitlementsResult {
  const MosaicEntitlementsFailed({
    required this.message,
    this.diagnostic,
  });

  final String message;
  final MosaicCommerceDiagnostic? diagnostic;
}

/// Contract implemented by RevenueCat, store-native, or app-owned adapters.
abstract interface class MosaicPurchaseProvider {
  Future<MosaicProductLoadResult> loadProducts(Iterable<String> productIds);

  Future<MosaicPurchaseResult> purchase(String productId);

  Future<MosaicRestoreResult> restore();

  Future<MosaicActiveEntitlementsResult> activeEntitlements();
}

/// Provider-neutral Phase 4 commerce adapter surface.
///
/// App-owned custom providers implement this interface directly. RevenueCat
/// and future store-native implementations live in optional adapter packages.
abstract interface class MosaicCommerceProvider
    implements MosaicPurchaseProvider {
  MosaicProviderIdentity get identity;

  List<MosaicProviderCapability> get capabilities;

  List<MosaicCommerceDiagnostic> get diagnostics;
}

enum MosaicCommerceUpdateOutcome {
  purchased,
  pending,
  cancelled,
  providerUnavailable,
  failed,
  entitlementsChanged,
}

final class MosaicCommerceConfigurationReference {
  const MosaicCommerceConfigurationReference({
    required this.configurationId,
    required this.configurationRevision,
  });

  final String configurationId;
  final String configurationRevision;
}

final class MosaicCommerceUpdate {
  MosaicCommerceUpdate({
    required this.updateId,
    required this.providerId,
    required this.mosaicProductId,
    required this.configuration,
    required this.outcome,
    required this.occurredAt,
    this.operationId,
    this.transactionReference,
    this.providerOrderReference,
    Iterable<String> activeEntitlementKeys = const <String>[],
    Iterable<MosaicCommerceDiagnostic> diagnostics =
        const <MosaicCommerceDiagnostic>[],
  })  : activeEntitlementKeys = Set.unmodifiable(activeEntitlementKeys),
        diagnostics = List.unmodifiable(diagnostics);

  final String updateId;
  final String? operationId;
  final String providerId;
  final String mosaicProductId;
  final MosaicCommerceConfigurationReference configuration;
  final MosaicCommerceUpdateOutcome outcome;

  /// Provider-safe transaction reference. It is never a receipt, a signed
  /// payload, a JWS representation, or a raw purchase token.
  final String? transactionReference;

  /// Optional Google Play order reference, when the adapter supplies one. It is
  /// a join handle only and is never the identity of a transaction.
  final String? providerOrderReference;
  final Set<String> activeEntitlementKeys;
  final DateTime occurredAt;
  final List<MosaicCommerceDiagnostic> diagnostics;
}

abstract interface class MosaicAsynchronousCommerceProvider {
  Stream<MosaicCommerceUpdate> get commerceUpdates;

  Future<void> invalidate();

  Future<void> dispose();
}

/// Creates one adapter bound to one fully validated release/sidecar pair.
abstract interface class MosaicCommerceProviderFactory {
  String get providerId;

  MosaicCommerceProvider create({
    required MosaicCommerceConfiguration commerceConfiguration,
    required MosaicConfigurationRelease configurationRelease,
  });
}

/// Keeps the renderer provider-independent while atomically swapping adapters
/// after a new release/sidecar pair has been accepted.
final class MosaicCommerceProviderRouter implements MosaicPurchaseProvider {
  MosaicCommerceProviderRouter({
    Iterable<MosaicCommerceProviderFactory> factories =
        const <MosaicCommerceProviderFactory>[],
    this.fallbackProvider,
  }) : _factories = Map.unmodifiable(
          <String, MosaicCommerceProviderFactory>{
            for (final factory in factories) factory.providerId: factory,
          },
        ) {
    if (_factories.length != factories.length) {
      throw ArgumentError('Commerce Provider factory IDs must be unique.');
    }
  }

  final Map<String, MosaicCommerceProviderFactory> _factories;
  final MosaicPurchaseProvider? fallbackProvider;
  MosaicCommerceProvider? _active;
  StreamSubscription<MosaicCommerceUpdate>? _updateSubscription;
  final StreamController<MosaicCommerceUpdate> _updates =
      StreamController<MosaicCommerceUpdate>.broadcast();
  final Set<String> _routedUpdateIds = <String>{};
  final List<String> _routedUpdateOrder = <String>[];
  var _activationRevision = 0;

  MosaicCommerceProvider? get activeProvider => _active;
  Stream<MosaicCommerceUpdate> get commerceUpdates => _updates.stream;

  bool activate({
    required MosaicCommerceConfiguration commerceConfiguration,
    required MosaicConfigurationRelease configurationRelease,
  }) {
    _activationRevision += 1;
    final revision = _activationRevision;
    final previous = _active;
    _active = null;
    unawaited(_updateSubscription?.cancel());
    _updateSubscription = null;
    _routedUpdateIds.clear();
    _routedUpdateOrder.clear();
    final factory =
        _factories[commerceConfiguration.activeProvider.identity.id];
    if (factory == null) {
      return false;
    }
    final MosaicCommerceProvider candidate;
    try {
      candidate = factory.create(
        commerceConfiguration: commerceConfiguration,
        configurationRelease: configurationRelease,
      );
    } on Object {
      return false;
    }
    final expectedIdentity = commerceConfiguration.activeProvider.identity;
    final asynchronousCandidate =
        candidate is MosaicAsynchronousCommerceProvider
            ? candidate as MosaicAsynchronousCommerceProvider
            : null;
    if (candidate.identity.id != expectedIdentity.id ||
        candidate.identity.adapterVersion != expectedIdentity.adapterVersion ||
        !_capabilitiesMatch(
          commerceConfiguration.activeProvider.capabilities,
          candidate.capabilities,
        )) {
      _active = null;
      if (asynchronousCandidate != null) {
        unawaited(asynchronousCandidate.dispose());
      }
      return false;
    }
    _active = candidate;
    final asynchronousPrevious = previous is MosaicAsynchronousCommerceProvider
        ? previous as MosaicAsynchronousCommerceProvider
        : null;
    if (asynchronousPrevious != null) {
      unawaited(asynchronousPrevious.dispose());
    }
    if (asynchronousCandidate != null) {
      final expectedProvider = expectedIdentity.id;
      final expectedConfigurationId = commerceConfiguration.id;
      final expectedRevision = commerceConfiguration.contentDigest;
      _updateSubscription = asynchronousCandidate.commerceUpdates.listen(
        (MosaicCommerceUpdate update) {
          if (_activationRevision != revision ||
              _active != candidate ||
              update.providerId != expectedProvider ||
              update.configuration.configurationId != expectedConfigurationId ||
              update.configuration.configurationRevision != expectedRevision ||
              !_routedUpdateIds.add(update.updateId)) {
            return;
          }
          _routedUpdateOrder.add(update.updateId);
          if (_routedUpdateOrder.length > 1024) {
            _routedUpdateIds.remove(_routedUpdateOrder.removeAt(0));
          }
          _updates.add(update);
        },
      );
    }
    return true;
  }

  void deactivate() {
    _activationRevision += 1;
    final previous = _active;
    _active = null;
    unawaited(_updateSubscription?.cancel());
    _updateSubscription = null;
    _routedUpdateIds.clear();
    _routedUpdateOrder.clear();
    if (previous is MosaicAsynchronousCommerceProvider) {
      unawaited((previous as MosaicAsynchronousCommerceProvider).dispose());
    }
  }

  Future<void> dispose() async {
    _activationRevision += 1;
    final previous = _active;
    _active = null;
    await _updateSubscription?.cancel();
    _updateSubscription = null;
    if (previous is MosaicAsynchronousCommerceProvider) {
      await (previous as MosaicAsynchronousCommerceProvider).dispose();
    }
    await _updates.close();
  }

  MosaicPurchaseProvider? get _delegate => _active ?? fallbackProvider;

  static bool _capabilitiesMatch(
    List<MosaicProviderCapability> expected,
    List<MosaicProviderCapability> actual,
  ) {
    if (expected.length != actual.length) return false;
    final actualByName =
        <MosaicProviderCapabilityName, MosaicProviderCapability>{
      for (final capability in actual) capability.name: capability,
    };
    if (actualByName.length != actual.length) return false;
    for (final capability in expected) {
      final installed = actualByName[capability.name];
      if (installed == null ||
          installed.support != capability.support ||
          installed.reasonCode != capability.reasonCode) {
        return false;
      }
    }
    return true;
  }

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async {
    final requested = productIds.toList(growable: false);
    return await _delegate?.loadProducts(requested) ??
        MosaicProductsUnavailable(
          requested,
          message: 'Commerce configuration is unavailable.',
        );
  }

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async =>
      await _delegate?.purchase(productId) ??
      MosaicPurchaseConfigurationUnavailable(productId: productId);

  @override
  Future<MosaicRestoreResult> restore() async =>
      await _delegate?.restore() ??
      const MosaicRestoreConfigurationUnavailable();

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async =>
      await _delegate?.activeEntitlements() ??
      const MosaicEntitlementsUnknown();
}

import 'commerce_configuration.dart';
import 'configuration_delivery.dart';

enum MosaicCommerceProductType {
  subscription,
  oneTimeNonConsumable,
}

enum MosaicBillingPeriodUnit { day, week, month, year }

final class MosaicBillingPeriod {
  const MosaicBillingPeriod({required this.unit, required this.value})
      : assert(value > 0);

  final MosaicBillingPeriodUnit unit;
  final int value;
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

  MosaicCommerceProvider? get activeProvider => _active;

  bool activate({
    required MosaicCommerceConfiguration commerceConfiguration,
    required MosaicConfigurationRelease configurationRelease,
  }) {
    final factory =
        _factories[commerceConfiguration.activeProvider.identity.id];
    if (factory == null) {
      _active = null;
      return false;
    }
    final candidate = factory.create(
      commerceConfiguration: commerceConfiguration,
      configurationRelease: configurationRelease,
    );
    final expectedIdentity = commerceConfiguration.activeProvider.identity;
    if (candidate.identity.id != expectedIdentity.id ||
        candidate.identity.adapterVersion != expectedIdentity.adapterVersion ||
        !_capabilitiesMatch(
          commerceConfiguration.activeProvider.capabilities,
          candidate.capabilities,
        )) {
      _active = null;
      return false;
    }
    _active = candidate;
    return true;
  }

  void deactivate() {
    _active = null;
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

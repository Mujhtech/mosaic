import 'commerce.dart';
import 'preview_protocol.dart';
import 'protocol.dart';

/// Provider-neutral adapter from preview mock state to the existing renderer.
final class MosaicPreviewPurchaseProvider implements MosaicPurchaseProvider {
  MosaicPreviewPurchaseProvider({
    required this.document,
    required this.state,
  }) : _activeReferenceId = state.entitlement.productReferenceId;

  final MosaicPaywallDocument document;
  final MosaicPreviewMockCommerceState state;
  String? _activeReferenceId;

  Map<String, MosaicPreviewMockProduct> get _stateByReference =>
      <String, MosaicPreviewMockProduct>{
        for (final product in state.products)
          product.productReferenceId: product,
      };

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async {
    final requested = productIds.toList(growable: false);
    final available = <MosaicProduct>[];
    final unavailable = <String>[];
    final mocks = _stateByReference;
    for (final providerId in requested) {
      final reference = _referenceForProviderId(providerId);
      final mock = reference == null ? null : mocks[reference.id];
      if (reference == null || mock == null || !mock.isAvailable) {
        unavailable.add(providerId);
        continue;
      }
      available.add(
        MosaicProduct(
          id: providerId,
          title: reference.label.defaultValue,
          localizedPrice: switch (mock) {
            MosaicPreviewSubscriptionProduct() => mock.localizedPrice,
            MosaicPreviewNonConsumableProduct() => mock.localizedPrice,
            MosaicPreviewUnavailableProduct() => '',
          },
          localizedPeriod: switch (mock) {
            MosaicPreviewSubscriptionProduct() =>
              mock.billingPeriod.displayValue,
            _ => null,
          },
        ),
      );
    }
    if (available.isEmpty && unavailable.isNotEmpty) {
      return MosaicProductsUnavailable(
        unavailable,
        message: 'The selected preview products are unavailable.',
      );
    }
    return MosaicProductsLoaded(
      available,
      unavailableProductIds: unavailable,
    );
  }

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async {
    final reference = _referenceForProviderId(productId);
    final mock = reference == null ? null : _stateByReference[reference.id];
    if (reference == null || mock == null || !mock.isAvailable) {
      return MosaicPurchaseProductUnavailable(productId: productId);
    }
    return switch (state.purchaseOutcome) {
      MosaicPreviewPurchaseOutcome.purchased => _purchase(reference),
      MosaicPreviewPurchaseOutcome.alreadyEntitled =>
        _alreadyEntitled(reference),
      MosaicPreviewPurchaseOutcome.cancelled =>
        MosaicPurchaseCancelled(productId: productId),
      MosaicPreviewPurchaseOutcome.purchaseFailed => MosaicPurchaseFailed(
          productId: productId,
          message: 'The configured mock preview purchase failed.',
        ),
    };
  }

  MosaicPurchaseResult _purchase(MosaicProductReference reference) {
    _activeReferenceId = reference.id;
    return MosaicPurchased(
      productId: reference.productId,
      transactionId: 'preview-${reference.id}',
    );
  }

  MosaicPurchaseResult _alreadyEntitled(MosaicProductReference reference) {
    _activeReferenceId = reference.id;
    return MosaicAlreadyEntitled(productId: reference.productId);
  }

  @override
  Future<MosaicRestoreResult> restore() async {
    return switch (state.restoreOutcome) {
      MosaicPreviewRestoreOutcome.restored => _restored(already: false),
      MosaicPreviewRestoreOutcome.alreadyEntitled => _restored(already: true),
      MosaicPreviewRestoreOutcome.restoreNoPurchases =>
        const MosaicNothingToRestore(),
      MosaicPreviewRestoreOutcome.restoreFailed => const MosaicRestoreFailed(
          message: 'The configured mock preview restore failed.',
        ),
    };
  }

  MosaicRestoreResult _restored({required bool already}) {
    _activeReferenceId ??= _firstAvailableReferenceId();
    final referenceId = _activeReferenceId;
    if (referenceId == null) {
      return const MosaicNothingToRestore();
    }
    final reference = document.productReference(referenceId);
    if (reference == null) {
      return const MosaicNothingToRestore();
    }
    final entitlements = <MosaicEntitlement>{
      MosaicEntitlement(id: reference.productId),
    };
    return already
        ? MosaicRestoreAlreadyEntitled(entitlements)
        : MosaicRestored(entitlements);
  }

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async {
    final referenceId = _activeReferenceId;
    final reference =
        referenceId == null ? null : document.productReference(referenceId);
    return MosaicActiveEntitlements(
      reference == null
          ? const <MosaicEntitlement>[]
          : <MosaicEntitlement>[
              MosaicEntitlement(id: reference.productId),
            ],
    );
  }

  MosaicProductReference? _referenceForProviderId(String providerId) {
    for (final reference in document.products) {
      if (reference.productId == providerId) {
        return reference;
      }
    }
    return null;
  }

  String? _firstAvailableReferenceId() {
    final products = _stateByReference;
    for (final reference in document.products) {
      if (products[reference.id]?.isAvailable ?? false) {
        return reference.id;
      }
    }
    return null;
  }
}

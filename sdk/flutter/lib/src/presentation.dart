import 'protocol.dart';

enum MosaicDiagnosticSeverity { warning, error }

final class MosaicDiagnostic {
  const MosaicDiagnostic({
    required this.code,
    required this.message,
    required this.severity,
  });

  final String code;
  final String message;
  final MosaicDiagnosticSeverity severity;
}

typedef MosaicDiagnosticCallback = void Function(MosaicDiagnostic diagnostic);
typedef MosaicBundledDocumentLoader = Future<String?> Function();

enum MosaicPaywallDocumentSource { primary, bundledFallback }

sealed class MosaicPaywallLoadResult {
  const MosaicPaywallLoadResult();
}

final class MosaicPaywallLoaded extends MosaicPaywallLoadResult {
  const MosaicPaywallLoaded({required this.document, required this.source});

  final MosaicPaywallDocument document;
  final MosaicPaywallDocumentSource source;
}

final class MosaicPaywallLoadUnavailable extends MosaicPaywallLoadResult {
  const MosaicPaywallLoadUnavailable({required this.diagnosticCode});

  final String diagnosticCode;
}

/// Phase-1-only local resolution: candidate, bundled fallback, unavailable.
final class MosaicPaywallLoader {
  const MosaicPaywallLoader({
    this.decoder = const MosaicProtocolDecoder(),
  });

  final MosaicProtocolDecoder decoder;

  Future<MosaicPaywallLoadResult> load({
    String? candidateDocument,
    required MosaicBundledDocumentLoader bundledFallbackLoader,
    MosaicDiagnosticCallback? onDiagnostic,
  }) async {
    if (candidateDocument != null) {
      try {
        return MosaicPaywallLoaded(
          document: decoder.decode(candidateDocument),
          source: MosaicPaywallDocumentSource.primary,
        );
      } on Object {
        onDiagnostic?.call(
          const MosaicDiagnostic(
            code: 'primary_document_rejected',
            message:
                'The local paywall document was rejected; loading the bundled fallback.',
            severity: MosaicDiagnosticSeverity.warning,
          ),
        );
      }
    }

    final String? fallbackSource;
    try {
      fallbackSource = await bundledFallbackLoader();
    } on Object {
      onDiagnostic?.call(
        const MosaicDiagnostic(
          code: 'bundled_fallback_load_failed',
          message: 'The bundled fallback could not be loaded.',
          severity: MosaicDiagnosticSeverity.error,
        ),
      );
      return const MosaicPaywallLoadUnavailable(
        diagnosticCode: 'bundled_fallback_load_failed',
      );
    }

    if (fallbackSource == null) {
      onDiagnostic?.call(
        const MosaicDiagnostic(
          code: 'bundled_fallback_missing',
          message: 'No bundled fallback paywall was provided.',
          severity: MosaicDiagnosticSeverity.error,
        ),
      );
      return const MosaicPaywallLoadUnavailable(
        diagnosticCode: 'bundled_fallback_missing',
      );
    }

    try {
      return MosaicPaywallLoaded(
        document: decoder.decode(fallbackSource),
        source: MosaicPaywallDocumentSource.bundledFallback,
      );
    } on Object {
      onDiagnostic?.call(
        const MosaicDiagnostic(
          code: 'bundled_fallback_rejected',
          message: 'The bundled fallback paywall was rejected.',
          severity: MosaicDiagnosticSeverity.error,
        ),
      );
      return const MosaicPaywallLoadUnavailable(
        diagnosticCode: 'bundled_fallback_rejected',
      );
    }
  }
}

enum MosaicPresentationOutcome {
  purchased('purchased'),
  restored('restored'),
  alreadyEntitled('alreadyEntitled'),
  dismissed('dismissed'),
  cancelled('cancelled'),
  productUnavailable('productUnavailable'),
  configurationUnavailable('configurationUnavailable'),
  purchaseFailed('purchaseFailed'),
  renderingFailed('renderingFailed');

  const MosaicPresentationOutcome(this.wireValue);

  final String wireValue;
}

/// Host-facing terminal result. Embedded renderers never dismiss host UI.
sealed class MosaicPresentationResult {
  const MosaicPresentationResult();

  MosaicPresentationOutcome get outcome;
}

final class MosaicPurchasedPresentationResult extends MosaicPresentationResult {
  const MosaicPurchasedPresentationResult({
    required this.productReferenceId,
  });

  final String productReferenceId;

  @override
  MosaicPresentationOutcome get outcome => MosaicPresentationOutcome.purchased;
}

final class MosaicRestoredPresentationResult extends MosaicPresentationResult {
  MosaicRestoredPresentationResult(Iterable<String> productReferenceIds)
      : productReferenceIds = Set.unmodifiable(productReferenceIds);

  final Set<String> productReferenceIds;

  @override
  MosaicPresentationOutcome get outcome => MosaicPresentationOutcome.restored;
}

final class MosaicAlreadyEntitledPresentationResult
    extends MosaicPresentationResult {
  MosaicAlreadyEntitledPresentationResult(Iterable<String> productReferenceIds)
      : productReferenceIds = Set.unmodifiable(productReferenceIds);

  final Set<String> productReferenceIds;

  @override
  MosaicPresentationOutcome get outcome =>
      MosaicPresentationOutcome.alreadyEntitled;
}

final class MosaicDismissedPresentationResult extends MosaicPresentationResult {
  const MosaicDismissedPresentationResult();

  @override
  MosaicPresentationOutcome get outcome => MosaicPresentationOutcome.dismissed;
}

final class MosaicCancelledPresentationResult extends MosaicPresentationResult {
  const MosaicCancelledPresentationResult({required this.productReferenceId});

  final String productReferenceId;

  @override
  MosaicPresentationOutcome get outcome => MosaicPresentationOutcome.cancelled;
}

final class MosaicProductUnavailablePresentationResult
    extends MosaicPresentationResult {
  const MosaicProductUnavailablePresentationResult({
    this.productReferenceId,
    this.productSelectorId,
  });

  final String? productReferenceId;
  final String? productSelectorId;

  @override
  MosaicPresentationOutcome get outcome =>
      MosaicPresentationOutcome.productUnavailable;
}

final class MosaicConfigurationUnavailablePresentationResult
    extends MosaicPresentationResult {
  const MosaicConfigurationUnavailablePresentationResult({
    required this.diagnosticCode,
  });

  final String diagnosticCode;

  @override
  MosaicPresentationOutcome get outcome =>
      MosaicPresentationOutcome.configurationUnavailable;
}

final class MosaicPurchaseFailedPresentationResult
    extends MosaicPresentationResult {
  const MosaicPurchaseFailedPresentationResult({
    required this.productReferenceId,
    required this.diagnosticCode,
  });

  final String productReferenceId;
  final String diagnosticCode;

  @override
  MosaicPresentationOutcome get outcome =>
      MosaicPresentationOutcome.purchaseFailed;
}

final class MosaicRenderingFailedPresentationResult
    extends MosaicPresentationResult {
  const MosaicRenderingFailedPresentationResult({required this.diagnosticCode});

  final String diagnosticCode;

  @override
  MosaicPresentationOutcome get outcome =>
      MosaicPresentationOutcome.renderingFailed;
}

typedef MosaicPresentationResultCallback = void Function(
  MosaicPresentationResult result,
);

enum MosaicInteractionOutcome {
  productSelected('productSelected'),
  purchased('purchased'),
  restored('restored'),
  alreadyEntitled('alreadyEntitled'),
  dismissed('dismissed'),
  cancelled('cancelled'),
  productUnavailable('productUnavailable'),
  purchaseFailed('purchaseFailed'),
  restoreNoPurchases('restoreNoPurchases'),
  restoreFailed('restoreFailed');

  const MosaicInteractionOutcome(this.wireValue);

  final String wireValue;
}

final class MosaicInteraction {
  const MosaicInteraction({
    required this.outcome,
    this.productReferenceId,
    this.productSelectorId,
    this.diagnosticCode,
  });

  final MosaicInteractionOutcome outcome;
  final String? productReferenceId;
  final String? productSelectorId;
  final String? diagnosticCode;
}

typedef MosaicInteractionCallback = void Function(
    MosaicInteraction interaction);

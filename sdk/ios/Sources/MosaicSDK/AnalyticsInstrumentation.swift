import Foundation

public struct MosaicAnalyticsPresentationInstrumentation: Sendable {
  let runtime: MosaicAnalyticsRuntime
  let placementRequestID: String
  let presentationID: String
  let attribution: MosaicAnalyticsAttribution
  let providerID: String?

  func emit(
    _ name: MosaicAnalyticsEventName,
    correlation extra: MosaicAnalyticsCorrelation = .init(),
    attribution extraAttribution: MosaicAnalyticsAttribution? = nil,
    payload: MosaicAnalyticsPayload,
    occurredAt: Date = Date()
  ) {
    var correlation = extra
    correlation.placementRequestId = correlation.placementRequestId ?? placementRequestID
    correlation.paywallPresentationId = correlation.paywallPresentationId ?? presentationID
    Task {
      _ = await runtime.record(
        name: name, correlation: correlation,
        attribution: extraAttribution ?? attribution, payload: payload,
        occurredAt: occurredAt)
    }
  }

  func productAttribution(_ productID: String) -> MosaicAnalyticsAttribution {
    var value = attribution
    value.mosaicProductId = productID
    return value
  }

  func purchaseAttribution(_ productID: String) -> MosaicAnalyticsAttribution? {
    guard let providerID else { return nil }
    var value = productAttribution(productID)
    value.providerId = providerID
    return value
  }
}

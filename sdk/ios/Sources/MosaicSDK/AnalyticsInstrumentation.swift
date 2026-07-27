import Foundation

public struct MosaicAnalyticsPresentationInstrumentation: Sendable {
  let runtime: MosaicAnalyticsRuntime
  let placementRequestID: String
  let presentationID: String
  let attribution: MosaicAnalyticsAttribution
  let experimentAttribution: MosaicAnalyticsAttribution?
  let providerID: String?

  init(
    runtime: MosaicAnalyticsRuntime, placementRequestID: String, presentationID: String,
    attribution: MosaicAnalyticsAttribution,
    experimentAttribution: MosaicAnalyticsAttribution? = nil, providerID: String?
  ) {
    self.runtime = runtime
    self.placementRequestID = placementRequestID
    self.presentationID = presentationID
    self.attribution = attribution
    self.experimentAttribution = experimentAttribution
    self.providerID = providerID
  }

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
    if let experimentAttribution {
      value.experimentId = experimentAttribution.experimentId
      value.experimentVersionId = experimentAttribution.experimentVersionId
      value.experimentVariantId = experimentAttribution.experimentVariantId
      value.experimentAllocationVersion = experimentAttribution.experimentAllocationVersion
    }
    return value
  }

  func purchaseAttribution(_ productID: String) -> MosaicAnalyticsAttribution? {
    guard let providerID else { return nil }
    var value = productAttribution(productID)
    value.providerId = providerID
    return value
  }
}

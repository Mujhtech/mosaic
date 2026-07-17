import Foundation

public enum MosaicPaywallDocumentSource: String, Sendable {
  case localCandidate
  case bundledFallback
}

public enum MosaicDiagnosticStage: String, Sendable {
  case candidateValidation
  case fallbackLookup
  case fallbackValidation
  case commerce
  case rendering
}

/// A deliberately safe diagnostic. It contains a stable code and stage, never
/// source JSON, provider credentials, raw errors, or transaction details.
public struct MosaicDiagnostic: Sendable, Equatable {
  public let code: String
  public let stage: MosaicDiagnosticStage

  public init(code: String, stage: MosaicDiagnosticStage) {
    self.code = code
    self.stage = stage
  }
}

public enum MosaicBundledFallbackSource: Sendable, Equatable {
  case packaged
  case data(Data?)
}

public enum MosaicPaywallLoadResult: Sendable, Equatable {
  case loaded(
    document: MosaicPaywallDocument,
    source: MosaicPaywallDocumentSource,
    diagnostics: [MosaicDiagnostic]
  )
  case unavailable(
    result: MosaicPresentationResult,
    diagnostics: [MosaicDiagnostic]
  )
}

/// Phase-1-only local resolution. There is intentionally no remote, cache, or
/// REST path: candidate -> canonical packaged fallback -> unavailable.
public enum MosaicPaywallLoader {
  public static func load(
    candidateData: Data?,
    bundledFallback: MosaicBundledFallbackSource = .packaged
  ) -> MosaicPaywallLoadResult {
    var diagnostics: [MosaicDiagnostic] = []

    if let candidateData {
      do {
        return .loaded(
          document: try MosaicProtocolDecoder.decode(candidateData),
          source: .localCandidate,
          diagnostics: diagnostics
        )
      } catch {
        diagnostics.append(
          MosaicDiagnostic(
            code: "primary_document_rejected",
            stage: .candidateValidation
          )
        )
      }
    }

    let fallbackData: Data?
    switch bundledFallback {
    case .packaged:
      fallbackData = MosaicCanonicalPaywallResource.data()
      if fallbackData == nil {
        diagnostics.append(
          MosaicDiagnostic(code: "bundled_fallback_missing", stage: .fallbackLookup)
        )
      }
    case .data(let data):
      fallbackData = data
      if data == nil {
        diagnostics.append(
          MosaicDiagnostic(code: "bundled_fallback_missing", stage: .fallbackLookup)
        )
      }
    }

    if let fallbackData {
      do {
        return .loaded(
          document: try MosaicProtocolDecoder.decode(fallbackData),
          source: .bundledFallback,
          diagnostics: diagnostics
        )
      } catch {
        diagnostics.append(
          MosaicDiagnostic(
            code: "bundled_fallback_rejected",
            stage: .fallbackValidation
          )
        )
      }
    }

    return .unavailable(result: .configurationUnavailable, diagnostics: diagnostics)
  }
}

private enum MosaicCanonicalPaywallResource {
  static func data() -> Data? {
    guard
      let url = Bundle.module.url(
        forResource: "complete-paywall",
        withExtension: "json",
        subdirectory: "v0.1"
      ) ?? Bundle.module.url(forResource: "complete-paywall", withExtension: "json")
    else {
      return nil
    }
    return try? Data(contentsOf: url)
  }
}

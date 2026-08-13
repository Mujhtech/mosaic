import CryptoKit
import Foundation

public let mosaicConfigurationDeliveryVersion = "3"
/// Configuration Delivery `3` is the one delivery version (ADR-0028), re-pinned
/// to carry Paywall Protocol `0.4`. Kept as a list so a post-GA parallel version
/// widens the constant rather than changing its type.
public let mosaicSupportedConfigurationDeliveryVersions = [mosaicConfigurationDeliveryVersion]

public enum MosaicConfigurationDeliveryError: Error, Sendable, Equatable {
  case invalidJSON
  case invalidShape(path: String, reason: String)
  case unsupportedDeliveryVersion(String)
  case unsupportedPaywallProtocol(String)
  case unsupportedPaywallCapability(name: String, version: String)
  case unsupportedDecisionContract(String)
  case unsupportedDecisionFeature(String)
  case unsupportedBucketingAlgorithm(String)
  case unsupportedExperimentContract(String)
  case unsupportedExperimentFeature(String)
  case unsupportedExperimentSchedulePolicy(String)
  case invalidRelease(code: String)

  public var diagnosticCode: String {
    switch self {
    case .invalidJSON: "delivery_invalid_json"
    case .invalidShape: "delivery_invalid_shape"
    case .unsupportedDeliveryVersion: "delivery_unsupported_version"
    case .unsupportedPaywallProtocol: "delivery_unsupported_paywall_protocol"
    case .unsupportedPaywallCapability: "delivery_unsupported_paywall_capability"
    case .unsupportedDecisionContract: "delivery_unsupported_decision_contract"
    case .unsupportedDecisionFeature: "delivery_unsupported_decision_feature"
    case .unsupportedBucketingAlgorithm: "delivery_unsupported_bucketing_algorithm"
    case .unsupportedExperimentContract: "delivery_unsupported_experiment_contract"
    case .unsupportedExperimentFeature: "delivery_unsupported_experiment_feature"
    case .unsupportedExperimentSchedulePolicy: "delivery_unsupported_experiment_schedule_policy"
    case .invalidRelease(let code): code
    }
  }
}

public struct MosaicConfigurationReleaseMetadata: Sendable, Equatable {
  public let id: String
  public let number: Int64
  public let environmentID: String
  public let environmentKey: String
  /// Every delivery release carries an environment mode. The property stays
  /// optional because `MosaicConfigurationRelease` values are also built from
  /// the bundled fallback, which has no environment behind it.
  public let environmentMode: MosaicEnvironmentMode?
  public let publishedAt: String
  public let contentDigest: String
}

public enum MosaicEnvironmentMode: String, Sendable, Equatable {
  case development
  case staging
  case production
}

public struct MosaicConfigurationPlacement: Sendable, Equatable, Identifiable {
  public var id: String { key }
  public let key: String
  public let paywallVersionID: String
}

public struct MosaicConfigurationPaywallVersion: Sendable, Equatable, Identifiable {
  public let id: String
  public let paywallID: String
  public let protocolVersion: String
  public let documentDigest: String
  public let document: MosaicPaywallDocument
  public let productReferenceIDs: [String]
  public let assetBindings: [MosaicConfigurationAssetBinding]
}

public struct MosaicConfigurationAssetBinding: Sendable, Equatable {
  public let documentAssetID: String
  public let assetReferenceID: String
}

public enum MosaicConfigurationProductType: String, Sendable, Equatable {
  case subscription
  case oneTimeNonConsumable = "one_time_non_consumable"
}

public struct MosaicConfigurationProductReference: Sendable, Equatable, Identifiable {
  public let id: String
  public let type: MosaicConfigurationProductType
  public let fallbackDisplayName: String
  public let readiness: MosaicProductReadiness
}

public enum MosaicProductReadiness: String, Sendable, Equatable, Codable {
  case ready
  case notReady = "not_ready"
}

public struct MosaicConfigurationEntitlementReference: Sendable, Equatable, Identifiable {
  public let id: String
  public let key: String
}

public enum MosaicConfigurationAssetKind: String, Sendable, Equatable {
  case image
  case video
}

public struct MosaicConfigurationAssetReference: Sendable, Equatable, Identifiable {
  public let id: String
  public let kind: MosaicConfigurationAssetKind
  public let mediaType: String
  public let byteLength: Int64
  public let contentDigest: String
  public let url: URL
}

public struct MosaicConfigurationRelease: Sendable, Equatable {
  public let metadata: MosaicConfigurationReleaseMetadata
  public let projectID: String?
  public let placements: [MosaicConfigurationPlacement]
  public let placementDecisions: [MosaicPlacementDecision]
  public let paywallVersions: [MosaicConfigurationPaywallVersion]
  public let productReferences: [MosaicConfigurationProductReference]
  public let entitlementReferences: [MosaicConfigurationEntitlementReference]
  public let assetReferences: [MosaicConfigurationAssetReference]
  public let experimentAssignments: [MosaicExperimentAssignment]

  public func paywall(forPlacement key: String) -> MosaicConfigurationPaywallVersion? {
    guard let versionID = placements.first(where: { $0.key == key })?.paywallVersionID else {
      return nil
    }
    return paywallVersions.first(where: { $0.id == versionID })
  }

  public func decision(forPlacement key: String) -> MosaicPlacementDecision? {
    placementDecisions.first { $0.ruleSet.placementKey == key }
  }
}

public enum MosaicConfigurationDeliveryDecoder {
  public static func decode(_ data: Data) throws -> MosaicConfigurationRelease {
    let raw: Any
    do {
      raw = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw MosaicConfigurationDeliveryError.invalidJSON
    }
    let root = try DeliveryValue.object(raw, path: "$")
    try DeliveryValue.exactKeys(
      root, expected: ["configurationDeliveryVersion", "release"], path: "$"
    )
    let version = try DeliveryValue.string(
      root["configurationDeliveryVersion"], path: "$.configurationDeliveryVersion")
    guard version == mosaicConfigurationDeliveryVersion else {
      throw MosaicConfigurationDeliveryError.unsupportedDeliveryVersion(version)
    }
    return try MosaicConfigurationDeliveryV3Decoder.decode(root: root)
  }

}

/// The canonical byte form a Configuration Delivery digest is computed over.
///
/// Hand-rolled rather than delegated to `JSONSerialization` because of numbers.
/// `JSONSerialization` writes a `Double` with 17 significant digits — `0.04`
/// becomes `0.040000000000000001` — while the contract's canonical form is the
/// shortest representation that round-trips, which is what every other
/// implementation produces. A release embedding a paywall document with
/// fractional values (opacity, motion amplitude, line-height multipliers) would
/// otherwise fail its own digest on Apple platforms alone.
enum DeliveryCanonicalJSON {
  static func data(_ value: Any) throws -> Data {
    var output = Data()
    try append(value, to: &output)
    return output
  }

  static func digest(_ value: Any) throws -> String {
    let hash = SHA256.hash(data: try data(value))
    return "sha256:" + hash.map { String(format: "%02x", $0) }.joined()
  }

  private static func append(_ value: Any, to output: inout Data) throws {
    switch value {
    case let object as [String: Any]:
      output.append(UInt8(ascii: "{"))
      // Ascending by UTF-16 code unit, at every depth, matching `.sortedKeys`.
      let keys = object.keys.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
      for (index, key) in keys.enumerated() {
        if index > 0 { output.append(UInt8(ascii: ",")) }
        appendString(key, to: &output)
        output.append(UInt8(ascii: ":"))
        guard let member = object[key] else {
          throw MosaicConfigurationDeliveryError.invalidJSON
        }
        try append(member, to: &output)
      }
      output.append(UInt8(ascii: "}"))
    case let array as [Any]:
      // Array order is normative and is never sorted.
      output.append(UInt8(ascii: "["))
      for (index, element) in array.enumerated() {
        if index > 0 { output.append(UInt8(ascii: ",")) }
        try append(element, to: &output)
      }
      output.append(UInt8(ascii: "]"))
    case let string as String:
      appendString(string, to: &output)
    case let number as NSNumber:
      output.append(contentsOf: Array(try numberLiteral(number).utf8))
    default:
      throw MosaicConfigurationDeliveryError.invalidJSON
    }
  }

  /// The shortest literal that round-trips, with an integral value written
  /// without a fractional part — the same rule `JSON.stringify` applies.
  private static func numberLiteral(_ number: NSNumber) throws -> String {
    if CFGetTypeID(number) == CFBooleanGetTypeID() {
      return number.boolValue ? "true" : "false"
    }
    let value = number.doubleValue
    guard value.isFinite else { throw MosaicConfigurationDeliveryError.invalidJSON }
    if value == value.rounded(), abs(value) < 9_007_199_254_740_992 {
      return String(number.int64Value)
    }
    // `Double`'s description is the shortest decimal that round-trips.
    return String(value)
  }

  /// Minimal JSON escaping. Solidus is never escaped and non-ASCII is emitted as
  /// UTF-8, matching `.withoutEscapingSlashes` and the other implementations.
  private static func appendString(_ value: String, to output: inout Data) {
    output.append(UInt8(ascii: "\""))
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": output.append(contentsOf: Array("\\\"".utf8))
      case "\\": output.append(contentsOf: Array("\\\\".utf8))
      case "\u{08}": output.append(contentsOf: Array("\\b".utf8))
      case "\u{0C}": output.append(contentsOf: Array("\\f".utf8))
      case "\n": output.append(contentsOf: Array("\\n".utf8))
      case "\r": output.append(contentsOf: Array("\\r".utf8))
      case "\t": output.append(contentsOf: Array("\\t".utf8))
      default:
        if scalar.value < 0x20 {
          output.append(contentsOf: Array(String(format: "\\u%04x", scalar.value).utf8))
        } else {
          output.append(contentsOf: Array(String(scalar).utf8))
        }
      }
    }
    output.append(UInt8(ascii: "\""))
  }
}

enum DeliveryValue {
  static func object(_ value: Any?, path: String) throws -> [String: Any] {
    guard let object = value as? [String: Any] else { throw shape(path, "expected_object") }
    return object
  }

  static func array(_ value: Any?, count: ClosedRange<Int>, path: String) throws -> [Any] {
    guard let array = value as? [Any], count.contains(array.count) else {
      throw shape(path, "expected_array_\(count.lowerBound)_\(count.upperBound)")
    }
    return array
  }

  static func exactKeys(_ object: [String: Any], expected: Set<String>, path: String) throws {
    guard Set(object.keys) == expected else { throw shape(path, "unexpected_or_missing_property") }
  }

  static func string(_ value: Any?, path: String) throws -> String {
    guard let value = value as? String else { throw shape(path, "expected_string") }
    return value
  }

  static func safeString(_ value: Any?, length: ClosedRange<Int>, path: String) throws -> String {
    let value = try string(value, path: path)
    guard length.contains(value.count),
      value.unicodeScalars.allSatisfy({ scalar in
        scalar.value >= 0x20 && scalar.value != 0x7F
      })
    else { throw shape(path, "unsafe_or_out_of_bounds_string") }
    return value
  }

  static func patternString(
    _ value: Any?, length: ClosedRange<Int>, pattern: String, path: String
  ) throws -> String {
    let value = try safeString(value, length: length, path: path)
    guard value.range(of: pattern, options: .regularExpression) != nil else {
      throw shape(path, "pattern_mismatch")
    }
    return value
  }

  static func identifier(_ value: Any?, path: String) throws -> String {
    try patternString(value, length: 1...128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$", path: path)
  }

  static func placementKey(_ value: Any?, path: String) throws -> String {
    try patternString(value, length: 1...64, pattern: "^[a-z][a-z0-9_]*$", path: path)
  }

  static func environmentKey(_ value: Any?, path: String) throws -> String {
    try patternString(value, length: 1...64, pattern: "^[a-z][a-z0-9_-]*$", path: path)
  }

  static func timestamp(_ value: Any?, path: String) throws -> String {
    try patternString(
      value,
      length: 20...40,
      pattern:
        "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]{1,9})?Z$",
      path: path
    )
  }

  static func digest(_ value: Any?, path: String) throws -> String {
    try patternString(value, length: 71...71, pattern: "^sha256:[a-f0-9]{64}$", path: path)
  }

  static func httpsURL(_ value: Any?, path: String) throws -> URL {
    let source = try safeString(value, length: 9...2048, path: path)
    guard let url = URL(string: source), url.scheme?.lowercased() == "https",
      url.host?.isEmpty == false, url.user == nil, url.password == nil
    else { throw shape(path, "expected_immutable_https_url") }
    return url
  }

  static func integer(_ value: Any?, range: ClosedRange<Int64>, path: String) throws -> Int64 {
    guard let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID(),
      number.doubleValue.isFinite,
      number.doubleValue.rounded() == number.doubleValue,
      number.doubleValue >= Double(range.lowerBound),
      number.doubleValue <= Double(range.upperBound)
    else { throw shape(path, "expected_bounded_integer") }
    return number.int64Value
  }

  static func identifierArray(_ value: Any?, count: ClosedRange<Int>, path: String) throws
    -> [String]
  {
    let values = try array(value, count: count, path: path)
    var result: [String] = []
    var seen = Set<String>()
    for (index, value) in values.enumerated() {
      let identifier = try identifier(value, path: "\(path)[\(index)]")
      guard seen.insert(identifier).inserted else {
        throw MosaicConfigurationDeliveryError.invalidRelease(code: "delivery_duplicate_reference")
      }
      result.append(identifier)
    }
    return result
  }

  private static func shape(_ path: String, _ reason: String) -> MosaicConfigurationDeliveryError {
    .invalidShape(path: path, reason: reason)
  }
}

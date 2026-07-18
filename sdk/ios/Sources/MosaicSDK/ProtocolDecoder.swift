import Foundation

public enum MosaicProtocolError: Error, Sendable, Equatable {
  case invalidJSON
  case invalidShape(path: String, reason: String)
  case unsupportedSchemaVersion(String)
  case unsupportedCapability(name: String, version: String)
  case duplicateCapability(name: String)
  case semanticViolation(code: String)

  public var diagnosticCode: String {
    switch self {
    case .invalidJSON: "protocol_invalid_json"
    case .invalidShape: "protocol_invalid_shape"
    case .unsupportedSchemaVersion: "protocol_unsupported_schema"
    case .unsupportedCapability: "protocol_unsupported_capability"
    case .duplicateCapability: "protocol_duplicate_capability"
    case .semanticViolation(let code): code
    }
  }
}

/// Strict reader for the current Mosaic protocol contract.
public enum MosaicProtocolDecoder {
  public static func decode(_ data: Data) throws -> MosaicPaywallDocument {
    let raw: Any
    do {
      raw = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw MosaicProtocolError.invalidJSON
    }

    guard let root = raw as? [String: Any] else {
      throw MosaicProtocolError.invalidShape(path: "$", reason: "expected_object")
    }
    guard let schemaVersion = root["schemaVersion"] as? String else {
      throw MosaicProtocolError.invalidShape(
        path: "$.schemaVersion",
        reason: "expected_string"
      )
    }
    guard schemaVersion == mosaicProtocolVersion else {
      throw MosaicProtocolError.unsupportedSchemaVersion(schemaVersion)
    }

    try MosaicProtocolV02Shape.validate(root)

    let document: MosaicPaywallDocument
    do {
      document = try JSONDecoder().decode(MosaicPaywallDocument.self, from: data)
    } catch let error as DecodingError {
      throw MosaicProtocolError.invalidShape(
        path: decodingPath(for: error),
        reason: decodingReason(for: error)
      )
    } catch {
      throw MosaicProtocolError.invalidShape(path: "$", reason: "type_or_enum_mismatch")
    }

    try MosaicProtocolV02Semantics.validate(document)
    return document
  }

  public static func decode(_ source: String) throws -> MosaicPaywallDocument {
    guard let data = source.data(using: .utf8) else {
      throw MosaicProtocolError.invalidJSON
    }
    return try decode(data)
  }
}

private func decodingPath(for error: DecodingError) -> String {
  let codingPath: [any CodingKey]
  switch error {
  case .dataCorrupted(let context), .keyNotFound(_, let context),
    .typeMismatch(_, let context), .valueNotFound(_, let context):
    codingPath = context.codingPath
  @unknown default:
    return "$"
  }
  return codingPath.reduce("$") { path, key in
    if let index = key.intValue { return "\(path)[\(index)]" }
    return "\(path).\(key.stringValue)"
  }
}

private func decodingReason(for error: DecodingError) -> String {
  switch error {
  case .dataCorrupted: "data_corrupted"
  case .keyNotFound(let key, _): "missing_\(key.stringValue)"
  case .typeMismatch: "type_mismatch"
  case .valueNotFound: "missing_value"
  @unknown default: "type_or_enum_mismatch"
  }
}

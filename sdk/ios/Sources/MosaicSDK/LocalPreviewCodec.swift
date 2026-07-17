import CoreFoundation
import Foundation

/// Strict native adapter for one exact Local Preview session version.
///
/// The JSON Schema remains canonical. This boundary intentionally rejects
/// unknown envelope and payload fields before any document reaches SwiftUI.
public struct MosaicPreviewMessageCodec: Sendable {
  public let protocolVersion: String

  public init(protocolVersion: String = mosaicLocalPreviewProtocolVersion) {
    precondition(
      protocolVersion == mosaicLocalPreviewProtocolVersion
        || protocolVersion == mosaicLocalPreviewProtocolVersionV02,
      "Unsupported Mosaic Local Preview codec version."
    )
    self.protocolVersion = protocolVersion
  }

  public var webSocketSubprotocol: String {
    protocolVersion == mosaicLocalPreviewProtocolVersionV02
      ? mosaicLocalPreviewWebSocketProtocolV02
      : mosaicLocalPreviewWebSocketProtocol
  }

  public func decode(
    _ source: String,
    expectedSessionId: String? = nil
  ) throws -> MosaicPreviewDecodedMessage {
    guard let data = source.data(using: .utf8) else {
      throw MosaicPreviewProtocolError.invalidJSON
    }
    return try decode(data, expectedSessionId: expectedSessionId)
  }

  public func decode(
    _ data: Data,
    expectedSessionId: String? = nil
  ) throws -> MosaicPreviewDecodedMessage {
    guard data.count <= mosaicLocalPreviewMaximumFrameBytes else {
      throw MosaicPreviewProtocolError.frameTooLarge
    }

    let decoded: Any
    do {
      decoded = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw MosaicPreviewProtocolError.invalidJSON
    }

    let envelope = try MosaicPreviewJSON.object(decoded)
    try MosaicPreviewJSON.expectKeys(
      envelope,
      allowed: [
        "previewProtocolVersion", "messageId", "sessionId", "sentAt", "type", "payload",
      ]
    )
    guard
      try MosaicPreviewJSON.string(envelope["previewProtocolVersion"])
        == protocolVersion
    else {
      throw MosaicPreviewProtocolError.unsupportedVersion
    }

    let messageId = try MosaicPreviewJSON.identifier(
      envelope["messageId"],
      pattern: #"^msg_[A-Za-z0-9][A-Za-z0-9_-]*$"#,
      minimum: 5,
      maximum: 100
    )
    let sessionId = try MosaicPreviewJSON.identifier(
      envelope["sessionId"],
      pattern: #"^session_[A-Za-z0-9][A-Za-z0-9_-]*$"#,
      minimum: 9,
      maximum: 100
    )
    if let expectedSessionId, sessionId != expectedSessionId {
      throw MosaicPreviewProtocolError.wrongSession
    }
    let sentAt = try MosaicPreviewJSON.utcTimestamp(envelope["sentAt"])
    let type = try MosaicPreviewJSON.string(envelope["type"])
    let payload = try MosaicPreviewJSON.object(envelope["payload"])

    let message: MosaicPreviewIncomingMessage
    switch type {
    case "draftUpdated":
      message = .draftUpdated(try decodeDraft(payload))
    case "mockCommerceStateChanged":
      message = .mockCommerceStateChanged(try decodeCommerce(payload))
    case "previewHeartbeat":
      message = try decodeHeartbeat(payload)
    case "previewClientDisconnected":
      message = try decodeDisconnected(payload)
    case "previewClientConnected":
      try validateConnected(payload)
      message = .validatedOther(type: type)
    case "capabilityReport":
      try validateCapabilityReport(payload)
      message = .validatedOther(type: type)
    case "draftAccepted":
      try validateDraftAccepted(payload)
      message = .validatedOther(type: type)
    case "draftRejected":
      try validateDraftRejected(payload)
      message = .validatedOther(type: type)
    case "validationError":
      try validateValidationError(payload)
      message = .validatedOther(type: type)
    case "renderWarning":
      try validateRenderWarning(payload)
      message = .validatedOther(type: type)
    case "renderFailure":
      try validateRenderFailure(payload)
      message = .validatedOther(type: type)
    default:
      throw MosaicPreviewProtocolError.unsupportedMessageType
    }

    return MosaicPreviewDecodedMessage(
      messageId: messageId,
      sessionId: sessionId,
      sentAt: sentAt,
      message: message
    )
  }

  public func encode(
    _ message: MosaicPreviewOutgoingMessage,
    messageId: String,
    sessionId: String,
    sentAt: Date = Date()
  ) throws -> String {
    let envelope: [String: Any] = [
      "previewProtocolVersion": protocolVersion,
      "messageId": messageId,
      "sessionId": sessionId,
      "sentAt": MosaicPreviewJSON.timestampString(sentAt),
      "type": message.type,
      "payload": message.jsonObject,
    ]
    guard JSONSerialization.isValidJSONObject(envelope) else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let data = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
    _ = try decode(data, expectedSessionId: sessionId)
    guard let source = String(data: data, encoding: .utf8) else {
      throw MosaicPreviewProtocolError.invalidJSON
    }
    return source
  }

  private func decodeDraft(_ payload: [String: Any]) throws -> MosaicPreviewDraftUpdate {
    try MosaicPreviewJSON.expectKeys(
      payload,
      allowed: ["editableDocumentId", "revision", "document", "preview"]
    )
    let document = try MosaicPreviewJSON.object(payload["document"])
    guard JSONSerialization.isValidJSONObject(document) else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let documentData = try JSONSerialization.data(
      withJSONObject: document,
      options: [.sortedKeys]
    )
    return MosaicPreviewDraftUpdate(
      editableDocumentId: try MosaicPreviewJSON.documentId(payload["editableDocumentId"]),
      revision: try MosaicPreviewJSON.revision(payload["revision"]),
      documentData: documentData,
      preview: try MosaicPreviewJSON.previewContext(payload["preview"])
    )
  }

  private func decodeCommerce(_ payload: [String: Any]) throws -> MosaicPreviewCommerceUpdate {
    try MosaicPreviewJSON.expectKeys(
      payload,
      allowed: ["editableDocumentId", "stateRevision", "state"]
    )
    return MosaicPreviewCommerceUpdate(
      editableDocumentId: try MosaicPreviewJSON.documentId(payload["editableDocumentId"]),
      stateRevision: try MosaicPreviewJSON.revision(payload["stateRevision"]),
      state: try MosaicPreviewJSON.mockCommerceState(payload["state"])
    )
  }

  private func decodeHeartbeat(_ payload: [String: Any]) throws -> MosaicPreviewIncomingMessage {
    try MosaicPreviewJSON.expectKeys(payload, allowed: ["clientId", "kind", "sequence"])
    let kind = try MosaicPreviewJSON.enumValue(
      payload["kind"],
      as: MosaicPreviewHeartbeatKind.self
    )
    return .heartbeat(
      clientId: try MosaicPreviewJSON.clientId(payload["clientId"]),
      kind: kind,
      sequence: try MosaicPreviewJSON.integer(payload["sequence"], minimum: 0)
    )
  }

  private func decodeDisconnected(_ payload: [String: Any]) throws
    -> MosaicPreviewIncomingMessage
  {
    try MosaicPreviewJSON.expectKeys(
      payload,
      allowed: ["clientId", "reason", "diagnostic"],
      required: ["clientId", "reason"]
    )
    return .previewClientDisconnected(
      clientId: try MosaicPreviewJSON.clientId(payload["clientId"]),
      reason: try MosaicPreviewJSON.enumValue(
        payload["reason"],
        as: MosaicPreviewDisconnectReason.self
      ),
      diagnostic: try payload["diagnostic"].map { try MosaicPreviewJSON.safeText($0) }
    )
  }

  private func validateConnected(_ payload: [String: Any]) throws {
    try MosaicPreviewJSON.expectKeys(payload, allowed: ["client"])
    try MosaicPreviewJSON.validateIdentity(payload["client"])
  }

  private func validateCapabilityReport(_ payload: [String: Any]) throws {
    try MosaicPreviewJSON.expectKeys(
      payload,
      allowed: [
        "clientId", "supportedSchemaVersions", "supportedCapabilities",
        "previewCapabilities", "limits",
      ]
    )
    _ = try MosaicPreviewJSON.clientId(payload["clientId"])

    let schemaVersions = try MosaicPreviewJSON.array(payload["supportedSchemaVersions"])
    guard (1...16).contains(schemaVersions.count) else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let parsedVersions = try schemaVersions.map { try MosaicPreviewJSON.semanticVersion($0) }
    guard Set(parsedVersions).count == parsedVersions.count else {
      throw MosaicPreviewProtocolError.invalidPayload
    }

    let supported = try MosaicPreviewJSON.array(payload["supportedCapabilities"])
    guard (1...128).contains(supported.count) else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let supportedKeys = try supported.map { try MosaicPreviewJSON.capability($0) }
    guard Set(supportedKeys).count == supportedKeys.count else {
      throw MosaicPreviewProtocolError.invalidPayload
    }

    let preview = try MosaicPreviewJSON.array(payload["previewCapabilities"])
    guard (1...32).contains(preview.count) else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let previewKeys = try preview.map {
      try MosaicPreviewJSON.previewCapability($0, expectedVersion: protocolVersion)
    }
    guard Set(previewKeys).count == previewKeys.count else {
      throw MosaicPreviewProtocolError.invalidPayload
    }

    let limits = try MosaicPreviewJSON.object(payload["limits"])
    try MosaicPreviewJSON.expectKeys(limits, allowed: ["maxDocumentBytes"])
    _ = try MosaicPreviewJSON.integer(
      limits["maxDocumentBytes"],
      minimum: 65_536,
      maximum: 2_097_152
    )
  }

  private func validateDraftAccepted(_ payload: [String: Any]) throws {
    try MosaicPreviewJSON.expectKeys(
      payload,
      allowed: ["clientId", "editableDocumentId", "revision"]
    )
    try MosaicPreviewJSON.validateRevisionTarget(payload)
  }

  private func validateDraftRejected(_ payload: [String: Any]) throws {
    try MosaicPreviewJSON.expectKeys(
      payload,
      allowed: ["clientId", "editableDocumentId", "revision", "reason", "diagnostics"]
    )
    try MosaicPreviewJSON.validateRevisionTarget(payload)
    _ = try MosaicPreviewJSON.enumValue(
      payload["reason"],
      as: MosaicPreviewDraftRejectionReason.self
    )
    _ = try MosaicPreviewJSON.diagnosticList(payload["diagnostics"], maximum: 50)
  }

  private func validateValidationError(_ payload: [String: Any]) throws {
    try MosaicPreviewJSON.expectKeys(
      payload,
      allowed: ["clientId", "editableDocumentId", "revision", "errors"]
    )
    try MosaicPreviewJSON.validateRevisionTarget(payload)
    _ = try MosaicPreviewJSON.diagnosticList(payload["errors"], maximum: 100)
  }

  private func validateRenderWarning(_ payload: [String: Any]) throws {
    try MosaicPreviewJSON.expectKeys(
      payload,
      allowed: ["clientId", "editableDocumentId", "revision", "warnings"]
    )
    try MosaicPreviewJSON.validateRevisionTarget(payload)
    let values = try MosaicPreviewJSON.array(payload["warnings"])
    guard (1...50).contains(values.count) else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    for value in values {
      _ = try MosaicPreviewJSON.compatibilityWarning(value)
    }
  }

  private func validateRenderFailure(_ payload: [String: Any]) throws {
    try MosaicPreviewJSON.expectKeys(
      payload,
      allowed: ["clientId", "editableDocumentId", "revision", "failure"]
    )
    try MosaicPreviewJSON.validateRevisionTarget(payload)
    _ = try MosaicPreviewJSON.renderDiagnostic(payload["failure"])
  }
}

extension MosaicPreviewOutgoingMessage {
  fileprivate var type: String {
    switch self {
    case .previewClientConnected: "previewClientConnected"
    case .previewClientDisconnected: "previewClientDisconnected"
    case .capabilityReport: "capabilityReport"
    case .draftAccepted: "draftAccepted"
    case .draftRejected: "draftRejected"
    case .validationError: "validationError"
    case .renderWarning: "renderWarning"
    case .renderFailure: "renderFailure"
    case .heartbeat: "previewHeartbeat"
    }
  }

  fileprivate var jsonObject: [String: Any] {
    switch self {
    case .previewClientConnected(let client):
      ["client": client.jsonObject]
    case .previewClientDisconnected(let clientId, let reason, let diagnostic):
      [
        "clientId": clientId,
        "reason": reason.rawValue,
        "diagnostic": diagnostic as Any,
      ].compactingNilValues()
    case .capabilityReport(let report):
      [
        "clientId": report.clientId,
        "supportedSchemaVersions": report.supportedSchemaVersions,
        "supportedCapabilities": report.supportedCapabilities.map(\.jsonObject),
        "previewCapabilities": report.previewCapabilities.map(\.jsonObject),
        "limits": ["maxDocumentBytes": report.maxDocumentBytes],
      ]
    case .draftAccepted(let clientId, let documentId, let revision):
      revisionTarget(clientId: clientId, documentId: documentId, revision: revision)
    case .draftRejected(
      let clientId,
      let documentId,
      let revision,
      let reason,
      let diagnostics
    ):
      revisionTarget(clientId: clientId, documentId: documentId, revision: revision)
        .merging([
          "reason": reason.rawValue,
          "diagnostics": diagnostics.map(\.jsonObject),
        ]) { _, new in new }
    case .validationError(let clientId, let documentId, let revision, let errors):
      revisionTarget(clientId: clientId, documentId: documentId, revision: revision)
        .merging(["errors": errors.map(\.jsonObject)]) { _, new in new }
    case .renderWarning(let clientId, let documentId, let revision, let warnings):
      revisionTarget(clientId: clientId, documentId: documentId, revision: revision)
        .merging(["warnings": warnings.map(\.jsonObject)]) { _, new in new }
    case .renderFailure(let clientId, let documentId, let revision, let failure):
      revisionTarget(clientId: clientId, documentId: documentId, revision: revision)
        .merging(["failure": failure.jsonObject]) { _, new in new }
    case .heartbeat(let clientId, let kind, let sequence):
      ["clientId": clientId, "kind": kind.rawValue, "sequence": sequence]
    }
  }

  private func revisionTarget(
    clientId: String,
    documentId: String,
    revision: MosaicLocalRevision
  ) -> [String: Any] {
    [
      "clientId": clientId,
      "editableDocumentId": documentId,
      "revision": revision.jsonObject,
    ]
  }
}

extension MosaicPreviewClientIdentity {
  fileprivate var jsonObject: [String: Any] {
    [
      "clientId": clientId,
      "displayName": displayName,
      "renderer": renderer.jsonObject,
      "application": application.jsonObject,
      "device": device.jsonObject,
    ]
  }
}

extension MosaicPreviewSoftwareIdentity {
  fileprivate var jsonObject: [String: Any] { ["id": id, "version": version] }
}

extension MosaicPreviewApplicationIdentity {
  fileprivate var jsonObject: [String: Any] {
    ["id": id, "displayName": displayName, "version": version]
  }
}

extension MosaicPreviewDeviceIdentity {
  fileprivate var jsonObject: [String: Any] {
    ["displayName": displayName, "systemName": systemName, "systemVersion": systemVersion]
  }
}

extension MosaicPreviewSupportedCapability {
  fileprivate var jsonObject: [String: Any] { ["name": name, "version": version] }
}

extension MosaicPreviewCapability {
  fileprivate var jsonObject: [String: Any] { ["name": name.rawValue, "version": version] }
}

extension MosaicLocalRevision {
  fileprivate var jsonObject: [String: Any] {
    ["revisionId": revisionId, "sequence": sequence]
  }
}

extension MosaicPreviewValidationDiagnostic {
  fileprivate var jsonObject: [String: Any] {
    [
      "code": code,
      "message": message,
      "location": location.jsonObject,
      "recovery": recovery.jsonObject,
    ]
  }
}

extension MosaicPreviewDiagnosticLocation {
  fileprivate var jsonObject: [String: Any] {
    [
      "documentPath": documentPath,
      "componentId": componentId as Any,
      "property": property as Any,
    ].compactingNilValues()
  }
}

extension MosaicPreviewRecovery {
  fileprivate var jsonObject: [String: Any] {
    ["action": action.rawValue, "message": message]
  }
}

extension MosaicPreviewCompatibilityWarning {
  fileprivate var jsonObject: [String: Any] {
    [
      "code": code,
      "severity": severity.rawValue,
      "message": message,
      "location": location?.jsonObject as Any,
      "capability": capability?.jsonObject as Any,
      "fallback": fallback.rawValue,
      "recovery": recovery.jsonObject,
    ].compactingNilValues()
  }
}

extension MosaicPreviewRenderDiagnostic {
  fileprivate var jsonObject: [String: Any] {
    [
      "code": code,
      "message": message,
      "location": location?.jsonObject as Any,
      "fallback": MosaicPreviewCompatibilityFallback.keepLastAcceptedDraft.rawValue,
      "recovery": recovery.jsonObject,
    ].compactingNilValues()
  }
}

private enum MosaicPreviewJSON {
  static func object(_ value: Any?) throws -> [String: Any] {
    guard let object = value as? [String: Any] else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return object
  }

  static func array(_ value: Any?) throws -> [Any] {
    guard let values = value as? [Any] else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return values
  }

  static func string(_ value: Any?) throws -> String {
    guard let value = value as? String, !value.isEmpty else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return value
  }

  static func expectKeys(
    _ object: [String: Any],
    allowed: Set<String>,
    required: Set<String>? = nil
  ) throws {
    let actual = Set(object.keys)
    let required = required ?? allowed
    guard required.isSubset(of: actual), actual.isSubset(of: allowed) else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
  }

  static func identifier(
    _ value: Any?,
    pattern: String,
    minimum: Int,
    maximum: Int
  ) throws -> String {
    let value = try string(value)
    guard
      (minimum...maximum).contains(value.count),
      value.range(of: pattern, options: .regularExpression) != nil
    else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return value
  }

  static func clientId(_ value: Any?) throws -> String {
    try identifier(
      value,
      pattern: #"^client_[A-Za-z0-9][A-Za-z0-9_-]*$"#,
      minimum: 8,
      maximum: 100
    )
  }

  static func documentId(_ value: Any?) throws -> String {
    try identifier(
      value,
      pattern: #"^document_[A-Za-z0-9][A-Za-z0-9_-]*$"#,
      minimum: 10,
      maximum: 100
    )
  }

  static func componentId(_ value: Any?) throws -> String {
    try identifier(
      value,
      pattern: #"^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$"#,
      minimum: 1,
      maximum: 128
    )
  }

  static func machineIdentifier(_ value: Any?) throws -> String {
    try identifier(
      value,
      pattern: #"^[A-Za-z0-9][A-Za-z0-9._:-]*$"#,
      minimum: 1,
      maximum: 128
    )
  }

  static func semanticVersion(_ value: Any?) throws -> String {
    try identifier(
      value,
      pattern: #"^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$"#,
      minimum: 1,
      maximum: 64
    )
  }

  static func safeText(_ value: Any?, maximum: Int = 512) throws -> String {
    let value = try string(value)
    guard value.count <= maximum, !value.contains("\n"), !value.contains("\r") else {
      throw MosaicPreviewProtocolError.unsafeDiagnostic
    }
    return value
  }

  static func integer(
    _ value: Any?,
    minimum: Int,
    maximum: Int = 2_147_483_647
  ) throws -> Int {
    guard
      let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID()
    else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let double = number.doubleValue
    guard
      double.isFinite,
      double.rounded(.towardZero) == double,
      double >= Double(minimum),
      double <= Double(maximum)
    else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return Int(double)
  }

  static func number(_ value: Any?, minimum: Double, maximum: Double) throws -> Double {
    guard
      let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID()
    else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let result = number.doubleValue
    guard result.isFinite, (minimum...maximum).contains(result) else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return result
  }

  static func enumValue<T: RawRepresentable>(_ value: Any?, as type: T.Type) throws -> T
  where T.RawValue == String {
    guard let result = T(rawValue: try string(value)) else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return result
  }

  static func utcTimestamp(_ value: Any?) throws -> String {
    let source = try string(value)
    guard
      source.count <= 32,
      source.range(
        of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$"#,
        options: .regularExpression
      ) != nil
    else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return source
  }

  static func timestampString(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }

  static func revision(_ value: Any?) throws -> MosaicLocalRevision {
    let value = try object(value)
    try expectKeys(value, allowed: ["revisionId", "sequence"])
    return MosaicLocalRevision(
      revisionId: try identifier(
        value["revisionId"],
        pattern: #"^revision_[A-Za-z0-9][A-Za-z0-9_-]*$"#,
        minimum: 10,
        maximum: 100
      ),
      sequence: try integer(value["sequence"], minimum: 1)
    )
  }

  static func previewContext(_ value: Any?) throws -> MosaicPreviewContext {
    let value = try object(value)
    try expectKeys(value, allowed: ["locale", "textScale"])
    return MosaicPreviewContext(
      locale: try identifier(
        value["locale"],
        pattern: #"^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$"#,
        minimum: 2,
        maximum: 7
      ),
      textScale: try number(value["textScale"], minimum: 0.5, maximum: 3)
    )
  }

  static func validateIdentity(_ value: Any?) throws {
    let client = try object(value)
    try expectKeys(
      client,
      allowed: ["clientId", "displayName", "renderer", "application", "device"]
    )
    _ = try clientId(client["clientId"])
    _ = try safeText(client["displayName"], maximum: 80)

    let renderer = try object(client["renderer"])
    try expectKeys(renderer, allowed: ["id", "version"])
    _ = try machineIdentifier(renderer["id"])
    _ = try semanticVersion(renderer["version"])

    let application = try object(client["application"])
    try expectKeys(application, allowed: ["id", "displayName", "version"])
    _ = try machineIdentifier(application["id"])
    _ = try safeText(application["displayName"], maximum: 80)
    _ = try safeText(application["version"], maximum: 64)

    let device = try object(client["device"])
    try expectKeys(device, allowed: ["displayName", "systemName", "systemVersion"])
    _ = try safeText(device["displayName"], maximum: 80)
    _ = try safeText(device["systemName"], maximum: 80)
    _ = try safeText(device["systemVersion"], maximum: 64)
  }

  static func capability(_ value: Any?) throws -> String {
    let value = try object(value)
    try expectKeys(value, allowed: ["name", "version"])
    return "\(try machineIdentifier(value["name"]))@\(try semanticVersion(value["version"]))"
  }

  static func previewCapability(_ value: Any?, expectedVersion: String) throws -> String {
    let value = try object(value)
    try expectKeys(value, allowed: ["name", "version"])
    let name = try enumValue(value["name"], as: MosaicPreviewCapabilityName.self)
    guard try string(value["version"]) == expectedVersion else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return "\(name.rawValue)@\(expectedVersion)"
  }

  static func validateRevisionTarget(_ payload: [String: Any]) throws {
    _ = try clientId(payload["clientId"])
    _ = try documentId(payload["editableDocumentId"])
    _ = try revision(payload["revision"])
  }

  static func diagnosticList(_ value: Any?, maximum: Int) throws
    -> [MosaicPreviewValidationDiagnostic]
  {
    let values = try array(value)
    guard !values.isEmpty, values.count <= maximum else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return try values.map(validationDiagnostic)
  }

  static func validationDiagnostic(_ value: Any) throws
    -> MosaicPreviewValidationDiagnostic
  {
    let value = try object(value)
    try expectKeys(value, allowed: ["code", "message", "location", "recovery"])
    return MosaicPreviewValidationDiagnostic(
      code: try diagnosticCode(value["code"]),
      message: try safeText(value["message"]),
      location: try diagnosticLocation(value["location"]),
      recovery: try recovery(value["recovery"])
    )
  }

  static func compatibilityWarning(_ value: Any) throws
    -> MosaicPreviewCompatibilityWarning
  {
    let value = try object(value)
    try expectKeys(
      value,
      allowed: ["code", "severity", "message", "location", "capability", "fallback", "recovery"],
      required: ["code", "severity", "message", "fallback", "recovery"]
    )
    let severity = try enumValue(value["severity"], as: MosaicPreviewCompatibilitySeverity.self)
    let fallback = try enumValue(value["fallback"], as: MosaicPreviewCompatibilityFallback.self)
    guard severity != .blocking || fallback == .keepLastAcceptedDraft else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let capabilityValue: MosaicPreviewSupportedCapability?
    if let raw = value["capability"] {
      let raw = try object(raw)
      try expectKeys(raw, allowed: ["name", "version"])
      capabilityValue = MosaicPreviewSupportedCapability(
        name: try machineIdentifier(raw["name"]),
        version: try semanticVersion(raw["version"])
      )
    } else {
      capabilityValue = nil
    }
    return MosaicPreviewCompatibilityWarning(
      code: try diagnosticCode(value["code"]),
      severity: severity,
      message: try safeText(value["message"]),
      location: try value["location"].map(diagnosticLocation),
      capability: capabilityValue,
      fallback: fallback,
      recovery: try recovery(value["recovery"])
    )
  }

  static func renderDiagnostic(_ value: Any?) throws -> MosaicPreviewRenderDiagnostic {
    let value = try object(value)
    try expectKeys(
      value,
      allowed: ["code", "message", "location", "fallback", "recovery"],
      required: ["code", "message", "fallback", "recovery"]
    )
    guard try string(value["fallback"]) == "keepLastAcceptedDraft" else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return MosaicPreviewRenderDiagnostic(
      code: try diagnosticCode(value["code"]),
      message: try safeText(value["message"]),
      location: try value["location"].map(diagnosticLocation),
      recovery: try recovery(value["recovery"])
    )
  }

  static func diagnosticCode(_ value: Any?) throws -> String {
    try identifier(
      value,
      pattern: #"^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$"#,
      minimum: 3,
      maximum: 96
    )
  }

  static func diagnosticLocation(_ value: Any?) throws -> MosaicPreviewDiagnosticLocation {
    let value = try object(value)
    try expectKeys(
      value,
      allowed: ["documentPath", "componentId", "property"],
      required: ["documentPath"]
    )
    let pointer = value["documentPath"] as? String
    guard
      let pointer,
      pointer.count <= 512,
      pointer.range(of: #"^(?:/(?:[^~/]|~[01])*)*$"#, options: .regularExpression) != nil
    else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let property: String?
    if let rawProperty = value["property"] {
      property = try identifier(
        rawProperty,
        pattern: #"^[A-Za-z][A-Za-z0-9]*$"#,
        minimum: 1,
        maximum: 128
      )
    } else {
      property = nil
    }
    return MosaicPreviewDiagnosticLocation(
      documentPath: pointer,
      componentId: try value["componentId"].map(componentId),
      property: property
    )
  }

  static func recovery(_ value: Any?) throws -> MosaicPreviewRecovery {
    let value = try object(value)
    try expectKeys(value, allowed: ["action", "message"])
    return MosaicPreviewRecovery(
      action: try enumValue(value["action"], as: MosaicPreviewRecoveryAction.self),
      message: try safeText(value["message"])
    )
  }

  static func mockCommerceState(_ value: Any?) throws -> MosaicPreviewMockCommerceState {
    let value = try object(value)
    try expectKeys(
      value,
      allowed: ["products", "purchaseOutcome", "restoreOutcome", "entitlement"]
    )
    let productValues = try array(value["products"])
    guard productValues.count <= 50 else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let products = try productValues.map(mockProduct)
    let productReferenceIds = products.map(\.productReferenceId)
    guard Set(productReferenceIds).count == productReferenceIds.count else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let entitlement = try mockEntitlement(value["entitlement"])
    if let active = entitlement.productReferenceId,
      !productReferenceIds.contains(active)
    {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    return MosaicPreviewMockCommerceState(
      products: products,
      purchaseOutcome: try enumValue(
        value["purchaseOutcome"], as: MosaicPreviewPurchaseOutcome.self),
      restoreOutcome: try enumValue(value["restoreOutcome"], as: MosaicPreviewRestoreOutcome.self),
      entitlement: entitlement
    )
  }

  static func mockProduct(_ value: Any) throws -> MosaicPreviewMockProduct {
    let value = try object(value)
    let productReferenceId = try componentId(value["productReferenceId"])
    let availability = try string(value["availability"])
    if availability == "unavailable" {
      try expectKeys(value, allowed: ["productReferenceId", "availability", "reason"])
      return .unavailable(
        productReferenceId: productReferenceId,
        reason: try enumValue(value["reason"], as: MosaicPreviewUnavailableReason.self)
      )
    }
    guard availability == "available" else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    let kind = try string(value["kind"])
    if kind == "nonConsumable" {
      try expectKeys(
        value,
        allowed: ["productReferenceId", "availability", "kind", "localizedPrice", "currencyCode"]
      )
      return .nonConsumable(
        productReferenceId: productReferenceId,
        localizedPrice: try safeText(value["localizedPrice"], maximum: 80),
        currencyCode: try currencyCode(value["currencyCode"])
      )
    }
    guard kind == "subscription" else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    try expectKeys(
      value,
      allowed: [
        "productReferenceId", "availability", "kind", "localizedPrice", "currencyCode",
        "billingPeriod", "trialPeriod", "introductoryOffer",
      ],
      required: [
        "productReferenceId", "availability", "kind", "localizedPrice", "currencyCode",
        "billingPeriod",
      ]
    )
    return .subscription(
      productReferenceId: productReferenceId,
      localizedPrice: try safeText(value["localizedPrice"], maximum: 80),
      currencyCode: try currencyCode(value["currencyCode"]),
      billingPeriod: try period(value["billingPeriod"]),
      trialPeriod: try value["trialPeriod"].map(period),
      introductoryOffer: try value["introductoryOffer"].map(introductoryOffer)
    )
  }

  static func currencyCode(_ value: Any?) throws -> String {
    try identifier(value, pattern: #"^[A-Z]{3}$"#, minimum: 3, maximum: 3)
  }

  static func period(_ value: Any?) throws -> MosaicPreviewPeriod {
    let value = try object(value)
    try expectKeys(value, allowed: ["unit", "value"])
    return MosaicPreviewPeriod(
      unit: try enumValue(value["unit"], as: MosaicPreviewPeriodUnit.self),
      value: try integer(value["value"], minimum: 1, maximum: 120)
    )
  }

  static func introductoryOffer(_ value: Any?) throws -> MosaicPreviewIntroductoryOffer {
    let value = try object(value)
    try expectKeys(value, allowed: ["localizedPrice", "period", "cycles"])
    return MosaicPreviewIntroductoryOffer(
      localizedPrice: try safeText(value["localizedPrice"], maximum: 80),
      period: try period(value["period"]),
      cycles: try integer(value["cycles"], minimum: 1, maximum: 120)
    )
  }

  static func mockEntitlement(_ value: Any?) throws -> MosaicPreviewMockEntitlement {
    let value = try object(value)
    let status = try string(value["status"])
    if status == "none" {
      try expectKeys(value, allowed: ["status"])
      return .none
    }
    guard status == "active" else {
      throw MosaicPreviewProtocolError.invalidPayload
    }
    try expectKeys(value, allowed: ["status", "productReferenceId"])
    return .active(productReferenceId: try componentId(value["productReferenceId"]))
  }
}

extension Dictionary where Key == String, Value == Any {
  fileprivate func compactingNilValues() -> [String: Any] {
    filter { _, value in
      guard let optional = value as? AnyOptional else { return true }
      return !optional.isNil
    }
  }
}

private protocol AnyOptional {
  var isNil: Bool { get }
}

extension Optional: AnyOptional {
  fileprivate var isNil: Bool { self == nil }
}

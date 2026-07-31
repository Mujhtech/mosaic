import Combine
import Foundation

extension MosaicLocalPreviewClient {
  func handleCommerce(_ update: MosaicPreviewCommerceUpdate) async {
    var tracker = commerceTrackers[update.editableDocumentId] ?? MosaicPreviewRevisionTracker()
    switch tracker.compare(update.stateRevision) {
    case .newer:
      tracker.advance(update.stateRevision)
      commerceTrackers[update.editableDocumentId] = tracker
      commerceStates[update.editableDocumentId] = update.state
      commerceRevisions[update.editableDocumentId] = update.stateRevision
      guard
        let draft = draftForRendering,
        draft.editableDocumentId == update.editableDocumentId
      else {
        return
      }
      if commerceMatchesDocument(update.state, document: draft.document) {
        await purchaseProvider.apply(state: update.state, document: draft.document)
        mockCommerceState = update.state
        mockCommerceRevision = update.stateRevision
        if update.state.products.contains(where: { !$0.isAvailable }) {
          await reportUnavailableCommerce(
            documentId: update.editableDocumentId,
            documentRevision: draft.revision,
            commerceRevision: update.stateRevision
          )
        }
      } else {
        await reportCommerceMismatch(
          documentId: update.editableDocumentId,
          documentRevision: draft.revision,
          commerceRevision: update.stateRevision
        )
      }
    case .idempotent:
      return
    case .stale:
      addDiagnostic(
        code: "preview.commerce.stale",
        message: "A stale mock commerce state was ignored."
      )
    case .conflict:
      addDiagnostic(
        code: "preview.commerce.conflict",
        message: "A conflicting mock commerce state was ignored."
      )
    }
  }

  func reportCommerceMismatch(
    documentId: String,
    documentRevision: MosaicLocalRevision,
    commerceRevision: MosaicLocalRevision
  ) async {
    let key = "\(documentId):\(documentRevision.revisionId):\(commerceRevision.revisionId)"
    guard reportedCommerceMismatchKeys.insert(key).inserted else { return }
    if reportedCommerceMismatchKeys.count > 128 {
      reportedCommerceMismatchKeys.remove(reportedCommerceMismatchKeys.first ?? key)
    }
    let warning = commerceMismatchWarning()
    addDiagnostic(code: warning.code, message: warning.message, recovery: warning.recovery)
    await sendBestEffort(
      .renderWarning(
        clientId: configuration.identity.clientId,
        editableDocumentId: documentId,
        revision: documentRevision,
        warnings: [warning]
      )
    )
  }

  func reportUnavailableCommerce(
    documentId: String,
    documentRevision: MosaicLocalRevision,
    commerceRevision: MosaicLocalRevision
  ) async {
    let key = "\(documentId):\(documentRevision.revisionId):\(commerceRevision.revisionId)"
    guard reportedUnavailableCommerceKeys.insert(key).inserted else { return }
    if reportedUnavailableCommerceKeys.count > 128 {
      reportedUnavailableCommerceKeys.remove(reportedUnavailableCommerceKeys.first ?? key)
    }
    let warning = productUnavailableWarning()
    addDiagnostic(code: warning.code, message: warning.message, recovery: warning.recovery)
    await sendBestEffort(
      .renderWarning(
        clientId: configuration.identity.clientId,
        editableDocumentId: documentId,
        revision: documentRevision,
        warnings: [warning]
      )
    )
  }

  func startHeartbeat(
    socket connectedSocket: any MosaicPreviewSocket,
    generation: Int
  ) {
    heartbeatTask?.cancel()
    heartbeatTask = Task { [weak self] in
      guard let self else { return }
      while !Task.isCancelled {
        do {
          try await self.delay(self.configuration.heartbeatInterval)
        } catch {
          return
        }
        guard
          self.shouldReconnect,
          generation == self.lifecycleGeneration,
          self.connectionStatus == .connected,
          self.socket != nil
        else {
          return
        }
        let now = self.clock()
        if let lastInboundAt = self.lastInboundAt,
          now.timeIntervalSince(lastInboundAt) >= self.configuration.peerTimeout.timeInterval
        {
          self.addDiagnostic(
            code: "preview.connection.timeout",
            message: "The local preview connection stopped responding.",
            recovery: MosaicPreviewRecovery(
              action: .reconnect,
              message: "Reconnect to local Studio."
            )
          )
          self.socket = nil
          await connectedSocket.close()
          return
        }
        if self.lastTrafficAt.map({
          now.timeIntervalSince($0) >= self.configuration.heartbeatInterval.timeInterval
        }) ?? true {
          let sequence = self.heartbeatSequence
          self.heartbeatSequence += 1
          await self.sendBestEffort(
            .heartbeat(
              clientId: self.configuration.identity.clientId,
              kind: .ping,
              sequence: sequence
            )
          )
        }
      }
    }
  }

  func send(_ message: MosaicPreviewOutgoingMessage) async throws {
    guard let socket else { throw URLError(.notConnectedToInternet) }
    outboundSequence += 1
    let source = try activeCodec.encode(
      message,
      messageId: "msg_ios_\(outboundSequence)",
      sessionId: configuration.sessionId,
      sentAt: clock()
    )
    try await socket.send(text: source)
    lastTrafficAt = clock()
  }

  func sendBestEffort(_ message: MosaicPreviewOutgoingMessage) async {
    do {
      try await send(message)
    } catch {
      addDiagnostic(
        code: "preview.connection.sendFailed",
        message: "A local preview message could not be sent."
      )
    }
  }

  func recordResponses(
    _ responses: [MosaicPreviewOutgoingMessage],
    documentId: String,
    revision: MosaicLocalRevision
  ) {
    guard var tracker = documentTrackers[documentId], tracker.highest == revision else {
      return
    }
    tracker.responses = responses
    documentTrackers[documentId] = tracker
  }

  func rejectedMessage(
    documentId: String,
    revision: MosaicLocalRevision,
    reason: MosaicPreviewDraftRejectionReason,
    diagnostic: MosaicPreviewValidationDiagnostic
  ) -> MosaicPreviewOutgoingMessage {
    .draftRejected(
      clientId: configuration.identity.clientId,
      editableDocumentId: documentId,
      revision: revision,
      reason: reason,
      diagnostics: [diagnostic]
    )
  }

  func revisionDiagnostic(code: String, message: String)
    -> MosaicPreviewValidationDiagnostic
  {
    MosaicPreviewValidationDiagnostic(
      code: code,
      message: message,
      location: MosaicPreviewDiagnosticLocation(documentPath: ""),
      recovery: MosaicPreviewRecovery(
        action: .restoreLastValidDraft,
        message: "Send a new revision with a greater sequence."
      )
    )
  }

  func genericValidationDiagnostic() -> MosaicPreviewValidationDiagnostic {
    MosaicPreviewValidationDiagnostic(
      code: "preview.validation.failed",
      message: "The draft does not conform to a supported Mosaic Protocol version.",
      location: MosaicPreviewDiagnosticLocation(documentPath: ""),
      recovery: MosaicPreviewRecovery(
        action: .editProperty,
        message: "Fix the affected property and send a new revision."
      )
    )
  }

  func protocolRejection(
    error: MosaicProtocolError,
    documentData: Data
  ) -> MosaicPreviewProtocolRejection {
    switch error {
    case .unsupportedSchemaVersion:
      return MosaicPreviewProtocolRejection(
        reason: .unsupportedSchemaVersion,
        diagnostic: MosaicPreviewValidationDiagnostic(
          code: "preview.schema.unsupported",
          message: "This preview client does not support the draft schema.",
          location: MosaicPreviewDiagnosticLocation(
            documentPath: "/schemaVersion",
            property: "schemaVersion"
          ),
          recovery: MosaicPreviewRecovery(
            action: .updatePreviewClient,
            message: "Use a supported Protocol version or update the preview client."
          )
        )
      )
    case .unsupportedCapability(let name, let version):
      return MosaicPreviewProtocolRejection(
        reason: .unsupportedCapability,
        diagnostic: MosaicPreviewValidationDiagnostic(
          code: "preview.capability.unsupported",
          message: "This preview client does not support a required capability.",
          location: MosaicPreviewDiagnosticLocation(
            documentPath: "/compatibility/requiredCapabilities"
          ),
          recovery: MosaicPreviewRecovery(
            action: .updatePreviewClient,
            message: "Use a client that supports \(safeInline(name)) \(safeInline(version))."
          )
        )
      )
    case .invalidShape(let path, _):
      return MosaicPreviewProtocolRejection(
        reason: .validationFailed,
        diagnostic: MosaicPreviewValidationDiagnostic(
          code: "preview.validation.failed",
          message: "The draft contains an invalid component or property.",
          location: diagnosticLocation(jsonPath: path, documentData: documentData),
          recovery: MosaicPreviewRecovery(
            action: .editProperty,
            message: "Fix the affected property and send a new revision."
          )
        )
      )
    case .invalidJSON, .duplicateCapability, .semanticViolation:
      return MosaicPreviewProtocolRejection(
        reason: .validationFailed,
        diagnostic: genericValidationDiagnostic()
      )
    }
  }

  func unsupportedRequirement(in documentData: Data)
    -> MosaicPreviewUnsupportedRequirement?
  {
    guard
      let root = try? JSONSerialization.jsonObject(with: documentData) as? [String: Any]
    else {
      return nil
    }
    if let compatibility = root["compatibility"] as? [String: Any],
      let capabilities = compatibility["requiredCapabilities"] as? [[String: Any]]
    {
      let expectedDocumentVersion = mosaicProtocolVersion
      let supported = Set(MosaicCapabilityCatalog.v02.map(\.rawValue))
      for (index, capability) in capabilities.enumerated() {
        guard
          let name = capability["name"] as? String,
          let version = capability["version"] as? String
        else {
          continue
        }
        if !supported.contains(name) || version != expectedDocumentVersion {
          return MosaicPreviewUnsupportedRequirement(
            capabilityName: safeMachineIdentifier(name),
            capabilityVersion: safeSemanticVersion(version),
            location: MosaicPreviewDiagnosticLocation(
              documentPath: "/compatibility/requiredCapabilities/\(index)",
              property: "name"
            )
          )
        }
      }
    }
    if let screens = root["screens"] as? [[String: Any]] {
      for (index, screen) in screens.enumerated() {
        guard let layout = screen["layout"] as? [String: Any] else { continue }
        if let unsupported = unsupportedNode(
          layout,
          path: "/screens/\(index)/layout",
          permitsScrollContainer: true
        ) {
          return unsupported
        }
      }
      return nil
    }
    guard let layout = root["layout"] as? [String: Any] else { return nil }
    return unsupportedNode(layout, path: "/layout", permitsScrollContainer: true)
  }

  func unsupportedNode(
    _ node: [String: Any],
    path: String,
    permitsScrollContainer: Bool
  ) -> MosaicPreviewUnsupportedRequirement? {
    guard let type = node["type"] as? String else { return nil }
    var supported = Set(MosaicLayoutNodeKind.v02PreviewCases.map(\.rawValue))
    supported.formUnion(["productCard", "productBadge"])
    if !supported.contains(type) || (!permitsScrollContainer && type == "scrollContainer") {
      let id = (node["id"] as? String).flatMap(safeComponentId)
      return MosaicPreviewUnsupportedRequirement(
        capabilityName: safeMachineIdentifier("component.\(type)"),
        capabilityVersion: mosaicProtocolVersion,
        location: MosaicPreviewDiagnosticLocation(
          documentPath: "\(path)/type",
          componentId: id,
          property: "type"
        )
      )
    }
    if type == "scrollContainer", let content = node["content"] as? [String: Any] {
      return unsupportedNode(content, path: "\(path)/content", permitsScrollContainer: false)
    }
    if type == "verticalStack" || type == "stack",
      let children = node["children"] as? [[String: Any]]
    {
      for (index, child) in children.enumerated() {
        if let unsupported = unsupportedNode(
          child,
          path: "\(path)/children/\(index)",
          permitsScrollContainer: false
        ) {
          return unsupported
        }
      }
    }
    if type == "button" {
      for collection in ["children", "inProgressChildren"] {
        guard let children = node[collection] as? [[String: Any]] else { continue }
        for (index, child) in children.enumerated() {
          if let unsupported = unsupportedNode(
            child,
            path: "\(path)/\(collection)/\(index)",
            permitsScrollContainer: false
          ) {
            return unsupported
          }
        }
      }
    }
    if type == "productSelector", let cards = node["cards"] as? [[String: Any]] {
      for (index, card) in cards.enumerated() {
        if let unsupported = unsupportedNode(
          card,
          path: "\(path)/cards/\(index)",
          permitsScrollContainer: false
        ) {
          return unsupported
        }
      }
    }
    if type == "productCard" || type == "productBadge",
      let children = node["children"] as? [[String: Any]]
    {
      for (index, child) in children.enumerated() {
        if let unsupported = unsupportedNode(
          child,
          path: "\(path)/children/\(index)",
          permitsScrollContainer: false
        ) {
          return unsupported
        }
      }
    }
    if type == "carousel", let pages = node["pages"] as? [[String: Any]] {
      for (index, page) in pages.enumerated() {
        if let content = page["content"] as? [String: Any],
          let unsupported = unsupportedNode(
            content,
            path: "\(path)/pages/\(index)/content",
            permitsScrollContainer: false
          )
        {
          return unsupported
        }
      }
    }
    return nil
  }

  func diagnosticLocation(jsonPath: String, documentData: Data)
    -> MosaicPreviewDiagnosticLocation
  {
    let tokens = jsonPathTokens(jsonPath)
    let pointer = tokens.isEmpty ? "" : "/" + tokens.map(escapePointerToken).joined(separator: "/")
    let root = try? JSONSerialization.jsonObject(with: documentData)
    var cursor: Any? = root
    var componentId: String?
    for token in tokens {
      if let object = cursor as? [String: Any] {
        if let id = object["id"] as? String { componentId = safeComponentId(id) }
        cursor = object[token]
      } else if let values = cursor as? [Any], let index = Int(token),
        values.indices.contains(index)
      {
        cursor = values[index]
      } else {
        break
      }
    }
    if let object = cursor as? [String: Any], let id = object["id"] as? String {
      componentId = safeComponentId(id)
    }
    let property = tokens.last.flatMap { Int($0) == nil ? safeProperty($0) : nil }
    return MosaicPreviewDiagnosticLocation(
      documentPath: pointer,
      componentId: componentId,
      property: property
    )
  }

  func renderWarnings(
    document: MosaicPaywallDocument,
    editableDocumentId: String
  ) -> [MosaicPreviewCompatibilityWarning] {
    var warnings: [MosaicPreviewCompatibilityWarning] = []
    for asset in document.assets
    where asset.source.bundledKey.map({ !configuration.bundledAssetKeys.contains($0) }) == true {
      warnings.append(
        MosaicPreviewCompatibilityWarning(
          code: "preview.asset.fallback",
          severity: .warning,
          message: "A bundled image is unavailable; the declared placeholder is active.",
          location: MosaicPreviewDiagnosticLocation(
            documentPath: "/assets",
            componentId: asset.id
          ),
          fallback: .useDeclaredAssetFallback,
          recovery: MosaicPreviewRecovery(
            action: .inspectComponent,
            message: "Add the bundled asset or keep the declared placeholder."
          )
        )
      )
    }
    if let state = commerceStates[editableDocumentId] {
      if !commerceMatchesDocument(state, document: document) {
        warnings.append(commerceMismatchWarning())
      } else if state.products.contains(where: { !$0.isAvailable }) {
        warnings.append(productUnavailableWarning())
      }
    }
    return Array(warnings.prefix(50))
  }

  func commerceMismatchWarning() -> MosaicPreviewCompatibilityWarning {
    MosaicPreviewCompatibilityWarning(
      code: "preview.commerce.productReferencesMismatch",
      severity: .warning,
      message: "Mock commerce does not match the draft product references.",
      location: MosaicPreviewDiagnosticLocation(documentPath: "/products"),
      fallback: .useSelectorFallback,
      recovery: MosaicPreviewRecovery(
        action: .bindProduct,
        message: "Bind exactly one mock product to every document product reference."
      )
    )
  }

  func productUnavailableWarning() -> MosaicPreviewCompatibilityWarning {
    MosaicPreviewCompatibilityWarning(
      code: "preview.product.unavailable",
      severity: .warning,
      message: "One or more mock products are unavailable.",
      location: MosaicPreviewDiagnosticLocation(documentPath: "/products"),
      fallback: .useSelectorFallback,
      recovery: MosaicPreviewRecovery(
        action: .bindProduct,
        message: "Select an available mock product or inspect the selector fallback."
      )
    )
  }

  func commerceMatchesDocument(
    _ state: MosaicPreviewMockCommerceState,
    document: MosaicPaywallDocument
  ) -> Bool {
    let expected = Set(document.products.map(\.id))
    let received = state.products.map(\.productReferenceId)
    return received.count == expected.count && Set(received) == expected
  }

  func unavailableCommerce(for document: MosaicPaywallDocument)
    -> MosaicPreviewMockCommerceState
  {
    MosaicPreviewMockCommerceState(
      products: document.products.map {
        .unavailable(productReferenceId: $0.id, reason: .notConfigured)
      },
      purchaseOutcome: .purchaseFailed,
      restoreOutcome: .restoreNoPurchases,
      entitlement: .none
    )
  }

  func rememberMessageId(_ id: String) -> Bool {
    guard seenMessageIds.insert(id).inserted else { return false }
    seenMessageOrder.append(id)
    if seenMessageOrder.count > 512 {
      let removed = seenMessageOrder.removeFirst()
      seenMessageIds.remove(removed)
    }
    return true
  }

  func addDiagnostic(
    code: String,
    message: String,
    recovery: MosaicPreviewRecovery? = nil
  ) {
    let safeCode = safeMachineIdentifier(code)
    let safeMessage = safeInline(message)
    let diagnostic = MosaicPreviewConnectionDiagnostic(
      id: "\(safeCode)-\(diagnostics.count + 1)",
      code: safeCode,
      message: safeMessage,
      recovery: recovery
    )
    diagnostics = Array((diagnostics + [diagnostic]).suffix(50))
  }

  func setConnectionStatus(_ status: MosaicPreviewConnectionStatus) {
    guard connectionStatus != status else { return }
    connectionStatus = status
  }
}

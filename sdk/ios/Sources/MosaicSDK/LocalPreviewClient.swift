import Combine
import Foundation

public enum MosaicPreviewConnectionStatus: Sendable, Equatable {
  case disconnected
  case connecting
  case connected
  case reconnecting(attempt: Int, delayMilliseconds: Int)
}

public enum MosaicPreviewDraftIssueKind: Sendable, Equatable {
  case invalidDocument
  case unsupportedComponent
  case renderFailure
}

public struct MosaicPreviewDraftIssue: Sendable, Equatable {
  public let kind: MosaicPreviewDraftIssueKind
  public let code: String
  public let message: String
  public let location: MosaicPreviewDiagnosticLocation
  public let recovery: MosaicPreviewRecovery

  public init(
    kind: MosaicPreviewDraftIssueKind,
    code: String,
    message: String,
    location: MosaicPreviewDiagnosticLocation,
    recovery: MosaicPreviewRecovery
  ) {
    self.kind = kind
    self.code = code
    self.message = message
    self.location = location
    self.recovery = recovery
  }
}

public struct MosaicPreviewConnectionDiagnostic: Sendable, Equatable, Identifiable {
  public let id: String
  public let code: String
  public let message: String
  public let recovery: MosaicPreviewRecovery?

  public init(
    id: String,
    code: String,
    message: String,
    recovery: MosaicPreviewRecovery? = nil
  ) {
    self.id = id
    self.code = code
    self.message = message
    self.recovery = recovery
  }
}

public struct MosaicPreviewRenderableDraft: Sendable, Equatable {
  public let editableDocumentId: String
  public let revision: MosaicLocalRevision
  public let document: MosaicPaywallDocument
  public let preview: MosaicPreviewContext

  public init(
    editableDocumentId: String,
    revision: MosaicLocalRevision,
    document: MosaicPaywallDocument,
    preview: MosaicPreviewContext
  ) {
    self.editableDocumentId = editableDocumentId
    self.revision = revision
    self.document = document
    self.preview = preview
  }
}

public typealias MosaicPreviewDelay = @Sendable (MosaicPreviewInterval) async throws -> Void
public typealias MosaicPreviewClock = @Sendable () -> Date

/// Owns one local Studio preview session and the last safe rendered draft.
///
/// Newer drafts become `pendingDraft` only after decoding and compatibility
/// checks. SwiftUI calls `markRevisionLive(_:)` from a revision-scoped task;
/// only then does the client send `draftAccepted`.
@MainActor
public final class MosaicLocalPreviewClient: ObservableObject {
  public let configuration: MosaicPreviewClientConfiguration
  public let purchaseProvider: MosaicPreviewPurchaseProvider

  @Published public private(set) var connectionStatus: MosaicPreviewConnectionStatus =
    .disconnected
  @Published public private(set) var liveDraft: MosaicPreviewRenderableDraft?
  @Published public private(set) var pendingDraft: MosaicPreviewRenderableDraft?
  @Published public private(set) var draftIssue: MosaicPreviewDraftIssue?
  @Published public private(set) var mockCommerceState: MosaicPreviewMockCommerceState?
  @Published public private(set) var mockCommerceRevision: MosaicLocalRevision?
  @Published public private(set) var diagnostics: [MosaicPreviewConnectionDiagnostic] = []

  public var draftForRendering: MosaicPreviewRenderableDraft? {
    pendingDraft ?? liveDraft
  }

  public var activeMockEntitlementProductReferenceId: String? {
    mockCommerceState?.entitlement.productReferenceId
  }

  private let connector: any MosaicPreviewSocketConnector
  private let codecs: [MosaicPreviewMessageCodec]
  private var activeCodec: MosaicPreviewMessageCodec
  private let delay: MosaicPreviewDelay
  private let clock: MosaicPreviewClock

  private var socket: (any MosaicPreviewSocket)?
  private var lifecycleTask: Task<Void, Never>?
  private var heartbeatTask: Task<Void, Never>?
  private var shouldReconnect = false
  private var lifecycleGeneration = 0
  private var outboundSequence = 0
  private var heartbeatSequence = 0
  private var lastInboundAt: Date?
  private var lastTrafficAt: Date?
  private var seenMessageIds: Set<String> = []
  private var seenMessageOrder: [String] = []
  private var documentTrackers: [String: MosaicPreviewRevisionTracker] = [:]
  private var commerceTrackers: [String: MosaicPreviewRevisionTracker] = [:]
  private var commerceStates: [String: MosaicPreviewMockCommerceState] = [:]
  private var commerceRevisions: [String: MosaicLocalRevision] = [:]
  private var reportedCommerceMismatchKeys: Set<String> = []
  private var reportedUnavailableCommerceKeys: Set<String> = []

  public init(
    configuration: MosaicPreviewClientConfiguration,
    connector: any MosaicPreviewSocketConnector = MosaicURLSessionPreviewSocketConnector(),
    codec: MosaicPreviewMessageCodec = MosaicPreviewMessageCodec(
      protocolVersion: mosaicLatestLocalPreviewProtocolVersion
    ),
    fallbackProtocolVersions: [String] = [mosaicLocalPreviewProtocolVersion],
    delay: @escaping MosaicPreviewDelay = mosaicPreviewTaskDelay,
    clock: @escaping MosaicPreviewClock = { Date() }
  ) {
    self.configuration = configuration
    self.connector = connector
    let fallbackCodecs = fallbackProtocolVersions
      .filter { $0 != codec.protocolVersion }
      .map { MosaicPreviewMessageCodec(protocolVersion: $0) }
    codecs = [codec] + fallbackCodecs
    activeCodec = codec
    self.delay = delay
    self.clock = clock
    purchaseProvider = MosaicPreviewPurchaseProvider()
  }

  deinit {
    lifecycleTask?.cancel()
    heartbeatTask?.cancel()
  }

  public func connect() {
    guard !shouldReconnect else { return }
    shouldReconnect = true
    lifecycleGeneration += 1
    let generation = lifecycleGeneration
    lifecycleTask?.cancel()
    lifecycleTask = Task { [weak self] in
      await self?.runConnectionLoop(generation: generation)
    }
  }

  public func disconnect() async {
    shouldReconnect = false
    lifecycleGeneration += 1
    lifecycleTask?.cancel()
    lifecycleTask = nil
    heartbeatTask?.cancel()
    heartbeatTask = nil
    if socket != nil {
      await sendBestEffort(
        .previewClientDisconnected(
          clientId: configuration.identity.clientId,
          reason: .closed,
          diagnostic: nil
        )
      )
    }
    let activeSocket = socket
    socket = nil
    await activeSocket?.close()
    setConnectionStatus(.disconnected)
  }

  /// Called by the native preview view after SwiftUI has mounted the pending revision.
  public func markRevisionLive(_ revision: MosaicLocalRevision) async {
    guard let pendingDraft, pendingDraft.revision == revision else { return }
    liveDraft = pendingDraft
    self.pendingDraft = nil
    draftIssue = nil
    let acknowledgement = MosaicPreviewOutgoingMessage.draftAccepted(
      clientId: configuration.identity.clientId,
      editableDocumentId: pendingDraft.editableDocumentId,
      revision: pendingDraft.revision
    )
    recordResponses(
      [acknowledgement],
      documentId: pendingDraft.editableDocumentId,
      revision: pendingDraft.revision
    )
    await sendBestEffort(acknowledgement)
  }

  public func reportRenderWarning(_ warning: MosaicPreviewCompatibilityWarning) async {
    guard let target = draftForRendering else { return }
    await sendBestEffort(
      .renderWarning(
        clientId: configuration.identity.clientId,
        editableDocumentId: target.editableDocumentId,
        revision: target.revision,
        warnings: [warning]
      )
    )
  }

  public func reportRenderFailure(_ failure: MosaicPreviewRenderDiagnostic) async {
    guard let pendingDraft else { return }
    let validation = MosaicPreviewValidationDiagnostic(
      code: failure.code,
      message: failure.message,
      location: failure.location ?? MosaicPreviewDiagnosticLocation(documentPath: ""),
      recovery: failure.recovery
    )
    let responses: [MosaicPreviewOutgoingMessage] = [
      .renderFailure(
        clientId: configuration.identity.clientId,
        editableDocumentId: pendingDraft.editableDocumentId,
        revision: pendingDraft.revision,
        failure: failure
      ),
      rejectedMessage(
        documentId: pendingDraft.editableDocumentId,
        revision: pendingDraft.revision,
        reason: .renderFailed,
        diagnostic: validation
      ),
    ]
    recordResponses(
      responses,
      documentId: pendingDraft.editableDocumentId,
      revision: pendingDraft.revision
    )
    for response in responses { await sendBestEffort(response) }
    self.pendingDraft = nil
    draftIssue = MosaicPreviewDraftIssue(
      kind: .renderFailure,
      code: failure.code,
      message: failure.message,
      location: validation.location,
      recovery: failure.recovery
    )
  }

  private func runConnectionLoop(generation: Int) async {
    var consecutiveFailures = 0
    setConnectionStatus(.connecting)
    while shouldReconnect, generation == lifecycleGeneration, !Task.isCancelled {
      if consecutiveFailures > 0 {
        guard consecutiveFailures <= configuration.reconnectPolicy.maximumAttempts else {
          shouldReconnect = false
          addDiagnostic(
            code: "preview.connection.exhausted",
            message: "The local preview reconnect limit was reached.",
            recovery: MosaicPreviewRecovery(
              action: .reconnect,
              message: "Check that local Studio is running, then reconnect."
            )
          )
          break
        }
        let reconnectDelay = configuration.reconnectPolicy.delay(
          forAttempt: consecutiveFailures
        )
        setConnectionStatus(
          .reconnecting(
            attempt: consecutiveFailures,
            delayMilliseconds: reconnectDelay.statusMilliseconds
          )
        )
        do {
          try await delay(reconnectDelay)
        } catch {
          break
        }
      }

      do {
        let attemptCodec = codecs[min(consecutiveFailures, codecs.count - 1)]
        activeCodec = attemptCodec
        let connectedSocket = try await connector.connect(
          endpoint: configuration.endpoint,
          protocols: [attemptCodec.webSocketSubprotocol]
        )
        guard shouldReconnect, generation == lifecycleGeneration, !Task.isCancelled else {
          await connectedSocket.close()
          break
        }
        socket = connectedSocket
        lastInboundAt = clock()
        lastTrafficAt = lastInboundAt
        try await sendInitialHandshake()
        consecutiveFailures = 0
        setConnectionStatus(.connected)
        startHeartbeat(socket: connectedSocket, generation: generation)
        try await receiveLoop(socket: connectedSocket, generation: generation)
      } catch is CancellationError {
        break
      } catch {
        addDiagnostic(
          code: "preview.connection.failed",
          message: "The local preview connection is unavailable.",
          recovery: MosaicPreviewRecovery(
            action: .reconnect,
            message: "Check the local endpoint and retry the connection."
          )
        )
      }

      heartbeatTask?.cancel()
      heartbeatTask = nil
      let droppedSocket = socket
      socket = nil
      await droppedSocket?.close()
      if shouldReconnect, generation == lifecycleGeneration {
        consecutiveFailures += 1
      }
    }
    heartbeatTask?.cancel()
    heartbeatTask = nil
    let finalSocket = socket
    socket = nil
    await finalSocket?.close()
    if generation == lifecycleGeneration {
      setConnectionStatus(.disconnected)
    }
  }

  private func sendInitialHandshake() async throws {
    try await send(
      .previewClientConnected(configuration.identity)
    )
    try await send(
      .capabilityReport(
        activeCodec.protocolVersion == mosaicLocalPreviewProtocolVersionV02
          ? .v02(clientId: configuration.identity.clientId)
          : MosaicPreviewCapabilityReport(clientId: configuration.identity.clientId)
      )
    )
  }

  private func receiveLoop(
    socket connectedSocket: any MosaicPreviewSocket,
    generation: Int
  ) async throws {
    while shouldReconnect, generation == lifecycleGeneration, !Task.isCancelled {
      let frame = try await connectedSocket.receive()
      guard self.socket != nil else { return }
      switch frame {
      case .binary:
        addDiagnostic(
          code: "preview.message.binaryRejected",
          message: "The preview client rejected a binary WebSocket frame."
        )
      case .text(let source):
        await handleTextFrame(source)
      }
    }
  }

  private func handleTextFrame(_ source: String) async {
    guard source.utf8.count <= mosaicLocalPreviewMaximumFrameBytes else {
      addDiagnostic(
        code: "preview.message.frameTooLarge",
        message: "The preview client rejected a frame larger than 2 MiB."
      )
      return
    }
    let decoded: MosaicPreviewDecodedMessage
    do {
      decoded = try activeCodec.decode(source, expectedSessionId: configuration.sessionId)
    } catch {
      addDiagnostic(
        code: "preview.message.invalid",
        message: "The preview client rejected an invalid preview message."
      )
      return
    }
    lastInboundAt = clock()
    lastTrafficAt = lastInboundAt
    guard rememberMessageId(decoded.messageId) else { return }

    switch decoded.message {
    case .draftUpdated(let update):
      await handleDraft(update)
    case .mockCommerceStateChanged(let update):
      await handleCommerce(update)
    case .heartbeat(let clientId, let kind, let sequence):
      guard clientId == configuration.identity.clientId else {
        addDiagnostic(
          code: "preview.heartbeat.wrongClient",
          message: "A heartbeat for another preview client was ignored."
        )
        return
      }
      if kind == .ping {
        await sendBestEffort(.heartbeat(clientId: clientId, kind: .pong, sequence: sequence))
      }
    case .previewClientDisconnected(let clientId, let reason, _):
      guard clientId == configuration.identity.clientId else { return }
      if reason != .timeout, reason != .transportError {
        shouldReconnect = false
      }
      let activeSocket = socket
      socket = nil
      await activeSocket?.close()
    case .validatedOther:
      break
    }
  }

  private func handleDraft(_ update: MosaicPreviewDraftUpdate) async {
    var tracker = documentTrackers[update.editableDocumentId] ?? MosaicPreviewRevisionTracker()
    switch tracker.compare(update.revision) {
    case .idempotent:
      for response in tracker.responses { await sendBestEffort(response) }
      return
    case .conflict:
      await sendBestEffort(
        rejectedMessage(
          documentId: update.editableDocumentId,
          revision: update.revision,
          reason: .revisionConflict,
          diagnostic: revisionDiagnostic(
            code: "preview.revision.conflict",
            message: "This sequence already belongs to another local revision."
          )
        )
      )
      return
    case .stale:
      await sendBestEffort(
        rejectedMessage(
          documentId: update.editableDocumentId,
          revision: update.revision,
          reason: .staleRevision,
          diagnostic: revisionDiagnostic(
            code: "preview.revision.stale",
            message: "A newer local revision has already been received."
          )
        )
      )
      return
    case .newer:
      tracker.advance(update.revision)
      documentTrackers[update.editableDocumentId] = tracker
      if let pendingDraft,
        pendingDraft.editableDocumentId == update.editableDocumentId,
        pendingDraft.revision.sequence < update.revision.sequence
      {
        self.pendingDraft = nil
      }
    }

    guard update.documentData.count <= mosaicIOSPreviewMaximumDocumentBytes else {
      await rejectValidation(
        update,
        reason: .documentTooLarge,
        diagnostic: MosaicPreviewValidationDiagnostic(
          code: "preview.document.tooLarge",
          message: "The draft exceeds this preview client’s document limit.",
          location: MosaicPreviewDiagnosticLocation(documentPath: ""),
          recovery: MosaicPreviewRecovery(
            action: .removeComponent,
            message: "Reduce the draft size and send a new local revision."
          )
        )
      )
      return
    }

    if let unsupported = unsupportedRequirement(in: update.documentData) {
      await rejectUnsupported(update, requirement: unsupported)
      return
    }

    let document: MosaicPaywallDocument
    do {
      document = try MosaicProtocolDecoder.decode(update.documentData)
    } catch let error as MosaicProtocolError {
      let rejection = protocolRejection(error: error, documentData: update.documentData)
      await rejectValidation(update, reason: rejection.reason, diagnostic: rejection.diagnostic)
      return
    } catch {
      await rejectValidation(
        update,
        reason: .validationFailed,
        diagnostic: genericValidationDiagnostic()
      )
      return
    }

    let warnings = renderWarnings(
      document: document,
      editableDocumentId: update.editableDocumentId
    )
    if !warnings.isEmpty {
      await sendBestEffort(
        .renderWarning(
          clientId: configuration.identity.clientId,
          editableDocumentId: update.editableDocumentId,
          revision: update.revision,
          warnings: warnings
        )
      )
    }

    if let commerce = commerceStates[update.editableDocumentId],
      commerceMatchesDocument(commerce, document: document)
    {
      await purchaseProvider.apply(state: commerce, document: document)
      mockCommerceState = commerce
      mockCommerceRevision = commerceRevisions[update.editableDocumentId]
    } else {
      let fallbackCommerce = unavailableCommerce(for: document)
      await purchaseProvider.apply(state: fallbackCommerce, document: document)
      mockCommerceState = commerceStates[update.editableDocumentId]
      mockCommerceRevision = commerceRevisions[update.editableDocumentId]
    }

    pendingDraft = MosaicPreviewRenderableDraft(
      editableDocumentId: update.editableDocumentId,
      revision: update.revision,
      document: document,
      preview: update.preview
    )
    draftIssue = nil
  }

  private func rejectUnsupported(
    _ update: MosaicPreviewDraftUpdate,
    requirement: MosaicPreviewUnsupportedRequirement
  ) async {
    let diagnostic = MosaicPreviewValidationDiagnostic(
      code: "preview.component.unsupported",
      message: "This preview client cannot render a required component.",
      location: requirement.location,
      recovery: MosaicPreviewRecovery(
        action: .removeComponent,
        message: "Remove the unsupported block or use a supported template."
      )
    )
    let warning = MosaicPreviewCompatibilityWarning(
      code: diagnostic.code,
      severity: .blocking,
      message: diagnostic.message,
      location: diagnostic.location,
      capability: MosaicPreviewSupportedCapability(
        name: requirement.capabilityName,
        version: requirement.capabilityVersion
      ),
      fallback: .keepLastAcceptedDraft,
      recovery: diagnostic.recovery
    )
    let responses: [MosaicPreviewOutgoingMessage] = [
      .renderWarning(
        clientId: configuration.identity.clientId,
        editableDocumentId: update.editableDocumentId,
        revision: update.revision,
        warnings: [warning]
      ),
      rejectedMessage(
        documentId: update.editableDocumentId,
        revision: update.revision,
        reason: .unsupportedCapability,
        diagnostic: diagnostic
      ),
    ]
    recordResponses(
      responses,
      documentId: update.editableDocumentId,
      revision: update.revision
    )
    for response in responses { await sendBestEffort(response) }
    draftIssue = MosaicPreviewDraftIssue(
      kind: .unsupportedComponent,
      code: diagnostic.code,
      message: diagnostic.message,
      location: diagnostic.location,
      recovery: diagnostic.recovery
    )
  }

  private func rejectValidation(
    _ update: MosaicPreviewDraftUpdate,
    reason: MosaicPreviewDraftRejectionReason,
    diagnostic: MosaicPreviewValidationDiagnostic
  ) async {
    let responses: [MosaicPreviewOutgoingMessage] = [
      .validationError(
        clientId: configuration.identity.clientId,
        editableDocumentId: update.editableDocumentId,
        revision: update.revision,
        errors: [diagnostic]
      ),
      rejectedMessage(
        documentId: update.editableDocumentId,
        revision: update.revision,
        reason: reason,
        diagnostic: diagnostic
      ),
    ]
    recordResponses(
      responses,
      documentId: update.editableDocumentId,
      revision: update.revision
    )
    for response in responses { await sendBestEffort(response) }
    pendingDraft = nil
    draftIssue = MosaicPreviewDraftIssue(
      kind: reason == .unsupportedCapability ? .unsupportedComponent : .invalidDocument,
      code: diagnostic.code,
      message: diagnostic.message,
      location: diagnostic.location,
      recovery: diagnostic.recovery
    )
  }

  private func handleCommerce(_ update: MosaicPreviewCommerceUpdate) async {
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

  private func reportCommerceMismatch(
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

  private func reportUnavailableCommerce(
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

  private func startHeartbeat(
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

  private func send(_ message: MosaicPreviewOutgoingMessage) async throws {
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

  private func sendBestEffort(_ message: MosaicPreviewOutgoingMessage) async {
    do {
      try await send(message)
    } catch {
      addDiagnostic(
        code: "preview.connection.sendFailed",
        message: "A local preview message could not be sent."
      )
    }
  }

  private func recordResponses(
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

  private func rejectedMessage(
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

  private func revisionDiagnostic(code: String, message: String)
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

  private func genericValidationDiagnostic() -> MosaicPreviewValidationDiagnostic {
    MosaicPreviewValidationDiagnostic(
      code: "preview.validation.failed",
      message: "The draft does not conform to Mosaic Protocol 0.1.",
      location: MosaicPreviewDiagnosticLocation(documentPath: ""),
      recovery: MosaicPreviewRecovery(
        action: .editProperty,
        message: "Fix the affected property and send a new revision."
      )
    )
  }

  private func protocolRejection(
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
            message: "Use Protocol 0.1 or update the preview client."
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

  private func unsupportedRequirement(in documentData: Data)
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
      let expectedDocumentVersion =
        activeCodec.protocolVersion == mosaicLocalPreviewProtocolVersionV02
        ? mosaicProtocolVersionV02
        : mosaicProtocolVersion
      let supported = Set(
        (expectedDocumentVersion == mosaicProtocolVersionV02
          ? MosaicCapabilityCatalog.v02
          : MosaicCapabilityCatalog.v01).map(\.rawValue)
      )
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
    guard let layout = root["layout"] as? [String: Any] else { return nil }
    return unsupportedNode(layout, path: "/layout", permitsScrollContainer: true)
  }

  private func unsupportedNode(
    _ node: [String: Any],
    path: String,
    permitsScrollContainer: Bool
  ) -> MosaicPreviewUnsupportedRequirement? {
    guard let type = node["type"] as? String else { return nil }
    let isV02 = activeCodec.protocolVersion == mosaicLocalPreviewProtocolVersionV02
    let supported = Set(
      (isV02 ? MosaicLayoutNodeKind.v02PreviewCases : MosaicLayoutNodeKind.v01PreviewCases)
        .map(\.rawValue)
    )
    if !supported.contains(type) || (!permitsScrollContainer && type == "scrollContainer") {
      let id = (node["id"] as? String).flatMap(safeComponentId)
      return MosaicPreviewUnsupportedRequirement(
        capabilityName: safeMachineIdentifier("component.\(type)"),
        capabilityVersion: isV02 ? mosaicProtocolVersionV02 : mosaicProtocolVersion,
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
    if (type == "verticalStack" || type == "stack"),
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
        { return unsupported }
      }
    }
    return nil
  }

  private func diagnosticLocation(jsonPath: String, documentData: Data)
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

  private func renderWarnings(
    document: MosaicPaywallDocument,
    editableDocumentId: String
  ) -> [MosaicPreviewCompatibilityWarning] {
    var warnings: [MosaicPreviewCompatibilityWarning] = []
    for asset in document.assets where !configuration.bundledAssetKeys.contains(asset.source.key) {
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

  private func commerceMismatchWarning() -> MosaicPreviewCompatibilityWarning {
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

  private func productUnavailableWarning() -> MosaicPreviewCompatibilityWarning {
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

  private func commerceMatchesDocument(
    _ state: MosaicPreviewMockCommerceState,
    document: MosaicPaywallDocument
  ) -> Bool {
    let expected = Set(document.products.map(\.id))
    let received = state.products.map(\.productReferenceId)
    return received.count == expected.count && Set(received) == expected
  }

  private func unavailableCommerce(for document: MosaicPaywallDocument)
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

  private func rememberMessageId(_ id: String) -> Bool {
    guard seenMessageIds.insert(id).inserted else { return false }
    seenMessageOrder.append(id)
    if seenMessageOrder.count > 512 {
      let removed = seenMessageOrder.removeFirst()
      seenMessageIds.remove(removed)
    }
    return true
  }

  private func addDiagnostic(
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

  private func setConnectionStatus(_ status: MosaicPreviewConnectionStatus) {
    guard connectionStatus != status else { return }
    connectionStatus = status
  }
}

private enum MosaicPreviewRevisionOrdering {
  case newer
  case stale
  case idempotent
  case conflict
}

private struct MosaicPreviewRevisionTracker {
  var highest: MosaicLocalRevision?
  var responses: [MosaicPreviewOutgoingMessage] = []

  func compare(_ revision: MosaicLocalRevision) -> MosaicPreviewRevisionOrdering {
    guard let highest else { return .newer }
    if revision.sequence > highest.sequence { return .newer }
    if revision.sequence < highest.sequence { return .stale }
    return revision.revisionId == highest.revisionId ? .idempotent : .conflict
  }

  mutating func advance(_ revision: MosaicLocalRevision) {
    highest = revision
    responses = []
  }
}

private struct MosaicPreviewProtocolRejection {
  let reason: MosaicPreviewDraftRejectionReason
  let diagnostic: MosaicPreviewValidationDiagnostic
}

private struct MosaicPreviewUnsupportedRequirement {
  let capabilityName: String
  let capabilityVersion: String
  let location: MosaicPreviewDiagnosticLocation
}

extension MosaicLayoutNodeKind {
  fileprivate static let v01PreviewCases: [MosaicLayoutNodeKind] = [
    .scrollContainer,
    .verticalStack,
    .text,
    .image,
    .featureList,
    .productSelector,
    .purchaseButton,
    .restoreButton,
    .closeButton,
    .legalText,
  ]

  fileprivate static let v02PreviewCases: [MosaicLayoutNodeKind] = [
    .scrollContainer,
    .stack,
    .text,
    .image,
    .featureList,
    .productSelector,
    .purchaseButton,
    .restoreButton,
    .closeButton,
    .legalText,
    .carousel,
    .switchControl,
    .countdown,
  ]
}

public func mosaicPreviewTaskDelay(_ duration: MosaicPreviewInterval) async throws {
  try await Task<Never, Never>.sleep(nanoseconds: duration.nanoseconds)
}

private func jsonPathTokens(_ path: String) -> [String] {
  guard path.hasPrefix("$") else { return [] }
  let pattern = #"\.([A-Za-z0-9_-]+)|\[([0-9]+)\]"#
  guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
  let range = NSRange(path.startIndex..<path.endIndex, in: path)
  return expression.matches(in: path, range: range).compactMap { match in
    for index in 1...2 where match.range(at: index).location != NSNotFound {
      guard let range = Range(match.range(at: index), in: path) else { continue }
      return String(path[range])
    }
    return nil
  }
}

private func escapePointerToken(_ value: String) -> String {
  value.replacingOccurrences(of: "~", with: "~0").replacingOccurrences(of: "/", with: "~1")
}

private func safeInline(_ value: String) -> String {
  let singleLine = value.replacingOccurrences(of: "\n", with: " ")
    .replacingOccurrences(of: "\r", with: " ")
  return String(singleLine.prefix(200))
}

private func safeMachineIdentifier(_ value: String) -> String {
  let mapped = value.map { character -> Character in
    character.isLetter || character.isNumber || ".:_-".contains(character) ? character : "_"
  }
  let result = String(mapped.prefix(96))
  return result.first?.isLetter == true || result.first?.isNumber == true
    ? result
    : "preview.unknown"
}

private func safeSemanticVersion(_ value: String) -> String {
  value.range(
    of: #"^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$"#,
    options: .regularExpression
  ) != nil ? String(value.prefix(64)) : mosaicProtocolVersion
}

private func safeComponentId(_ value: String) -> String? {
  guard
    value.count <= 128,
    value.range(
      of: #"^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$"#,
      options: .regularExpression
    ) != nil
  else {
    return nil
  }
  return value
}

private func safeProperty(_ value: String) -> String? {
  guard
    value.count <= 128,
    value.range(of: #"^[A-Za-z][A-Za-z0-9]*$"#, options: .regularExpression) != nil
  else {
    return nil
  }
  return value
}

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

  @Published public internal(set) var connectionStatus: MosaicPreviewConnectionStatus =
    .disconnected
  @Published public internal(set) var liveDraft: MosaicPreviewRenderableDraft?
  @Published public internal(set) var pendingDraft: MosaicPreviewRenderableDraft?
  @Published public internal(set) var draftIssue: MosaicPreviewDraftIssue?
  @Published public internal(set) var mockCommerceState: MosaicPreviewMockCommerceState?
  @Published public internal(set) var mockCommerceRevision: MosaicLocalRevision?
  @Published public internal(set) var diagnostics: [MosaicPreviewConnectionDiagnostic] = []

  public var draftForRendering: MosaicPreviewRenderableDraft? {
    pendingDraft ?? liveDraft
  }

  public var activeMockEntitlementProductReferenceId: String? {
    mockCommerceState?.entitlement.productReferenceId
  }

  let connector: any MosaicPreviewSocketConnector
  let codecs: [MosaicPreviewMessageCodec]
  var activeCodec: MosaicPreviewMessageCodec
  let delay: MosaicPreviewDelay
  let clock: MosaicPreviewClock

  var socket: (any MosaicPreviewSocket)?
  var lifecycleTask: Task<Void, Never>?
  var heartbeatTask: Task<Void, Never>?
  var shouldReconnect = false
  var lifecycleGeneration = 0
  var outboundSequence = 0
  var heartbeatSequence = 0
  var lastInboundAt: Date?
  var lastTrafficAt: Date?
  var seenMessageIds: Set<String> = []
  var seenMessageOrder: [String] = []
  var documentTrackers: [String: MosaicPreviewRevisionTracker] = [:]
  var commerceTrackers: [String: MosaicPreviewRevisionTracker] = [:]
  var commerceStates: [String: MosaicPreviewMockCommerceState] = [:]
  var commerceRevisions: [String: MosaicLocalRevision] = [:]
  var reportedCommerceMismatchKeys: Set<String> = []
  var reportedUnavailableCommerceKeys: Set<String> = []

  public init(
    configuration: MosaicPreviewClientConfiguration,
    connector: any MosaicPreviewSocketConnector = MosaicURLSessionPreviewSocketConnector(),
    codec: MosaicPreviewMessageCodec = MosaicPreviewMessageCodec(),
    fallbackProtocolVersions: [String] = [mosaicLocalPreviewProtocolVersion],
    delay: @escaping MosaicPreviewDelay = mosaicPreviewTaskDelay,
    clock: @escaping MosaicPreviewClock = { Date() }
  ) {
    self.configuration = configuration
    self.connector = connector
    let fallbackCodecs =
      fallbackProtocolVersions
      .filter { $0 != codec.protocolVersion }
      // Unsupported fallback versions are dropped rather than trapping.
      .compactMap { MosaicPreviewMessageCodec(protocolVersion: $0) }
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

  func runConnectionLoop(generation: Int) async {
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

  func sendInitialHandshake() async throws {
    try await send(
      .previewClientConnected(configuration.identity)
    )
    try await send(
      .capabilityReport(
        .current(clientId: configuration.identity.clientId)
      )
    )
  }

  func receiveLoop(
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

  func handleTextFrame(_ source: String) async {
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

  func handleDraft(_ update: MosaicPreviewDraftUpdate) async {
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

  func rejectUnsupported(
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

  func rejectValidation(
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

}

enum MosaicPreviewRevisionOrdering {
  case newer
  case stale
  case idempotent
  case conflict
}

struct MosaicPreviewRevisionTracker {
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

struct MosaicPreviewProtocolRejection {
  let reason: MosaicPreviewDraftRejectionReason
  let diagnostic: MosaicPreviewValidationDiagnostic
}

struct MosaicPreviewUnsupportedRequirement {
  let capabilityName: String
  let capabilityVersion: String
  let location: MosaicPreviewDiagnosticLocation
}

extension MosaicLayoutNodeKind {
  static let previewCases: [MosaicLayoutNodeKind] = [
    .scrollContainer,
    .stack,
    .text,
    .image,
    .icon,
    .featureList,
    .productSelector,
    .button,
    .carousel,
    .switchControl,
    .countdown,
    .tabs,
    .timeline,
    .award,
    .socialProof,
  ]
}

public func mosaicPreviewTaskDelay(_ duration: MosaicPreviewInterval) async throws {
  try await Task<Never, Never>.sleep(nanoseconds: duration.nanoseconds)
}

func jsonPathTokens(_ path: String) -> [String] {
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

func escapePointerToken(_ value: String) -> String {
  value.replacingOccurrences(of: "~", with: "~0").replacingOccurrences(of: "/", with: "~1")
}

func safeInline(_ value: String) -> String {
  let singleLine = value.replacingOccurrences(of: "\n", with: " ")
    .replacingOccurrences(of: "\r", with: " ")
  return String(singleLine.prefix(200))
}

func safeMachineIdentifier(_ value: String) -> String {
  let mapped = value.map { character -> Character in
    character.isLetter || character.isNumber || ".:_-".contains(character) ? character : "_"
  }
  let result = String(mapped.prefix(96))
  return result.first?.isLetter == true || result.first?.isNumber == true
    ? result
    : "preview.unknown"
}

func safeSemanticVersion(_ value: String) -> String {
  value.range(
    of: #"^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$"#,
    options: .regularExpression
  ) != nil ? String(value.prefix(64)) : mosaicProtocolVersion
}

func safeComponentId(_ value: String) -> String? {
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

func safeProperty(_ value: String) -> String? {
  guard
    value.count <= 128,
    value.range(of: #"^[A-Za-z][A-Za-z0-9]*$"#, options: .regularExpression) != nil
  else {
    return nil
  }
  return value
}

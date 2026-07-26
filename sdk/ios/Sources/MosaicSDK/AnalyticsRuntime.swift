import CryptoKit
import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public struct MosaicAnalyticsDiagnostics: Sendable, Equatable {
  public let collectionEnabled: Bool
  public let queuedEventCount: Int
  public let queuedBytes: Int
  public let droppedEventCount: UInt64
  public let expiredEventCount: UInt64
  public let permanentlyRejectedEventCount: UInt64
  public let retryCount: UInt64
  public let lastSafeCode: String?
  public let isFlushInFlight: Bool
}

public enum MosaicAnalyticsRecordResult: Sendable, Equatable {
  case queued(eventID: String)
  case collectionDisabled
  case invalidEvent
  case eventTooLarge
  case queuePersistenceFailed
}

public enum MosaicAnalyticsFlushResult: Sendable, Equatable {
  case delivered(removed: Int, retained: Int)
  case empty
  case collectionDisabled
  case deferred
}

struct MosaicAnalyticsHTTPResponse: Sendable {
  let statusCode: Int
  let data: Data
  let retryAfterSeconds: Int?
}

protocol MosaicAnalyticsTransport: Sendable {
  func send(data: Data) async throws -> MosaicAnalyticsHTTPResponse
}

struct MosaicURLSessionAnalyticsTransport: MosaicAnalyticsTransport {
  private let endpoint: URL
  private let apiKey: String
  private let timeout: TimeInterval
  private let session: URLSession

  init(baseURL: URL, apiKey: String, timeout: TimeInterval) {
    endpoint = baseURL.appendingPathComponent("v1/sdk/events/batch")
    self.apiKey = apiKey
    self.timeout = timeout
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.timeoutIntervalForResource = timeout
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    session = URLSession(configuration: configuration)
  }

  func send(data: Data) async throws -> MosaicAnalyticsHTTPResponse {
    var request = URLRequest(url: endpoint, timeoutInterval: timeout)
    request.httpMethod = "POST"
    request.httpBody = data
    request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let (responseData, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return MosaicAnalyticsHTTPResponse(
      statusCode: http.statusCode,
      data: responseData,
      retryAfterSeconds: http.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init)
    )
  }
}

struct MosaicAnalyticsQueueRecord: Codable, Sendable, Equatable {
  var event: MosaicAnalyticsEvent
  var encodedBytes: Int
  var attempts: Int
  var nextAttemptAt: Date?
}

struct MosaicAnalyticsPersistentState: Codable, Sendable, Equatable {
  var formatVersion = 1
  var environmentCollectionEnabled = false
  var hostCollectionEnabled = true
  var queue: [MosaicAnalyticsQueueRecord] = []
  var sessionID: String?
  var lastActivityAt: Date?
  var forceNewSession = false
  var droppedEventCount: UInt64 = 0
  var expiredEventCount: UInt64 = 0
  var permanentlyRejectedEventCount: UInt64 = 0
  var retryCount: UInt64 = 0
  var lastSafeCode: String?
}

protocol MosaicAnalyticsPersistence: Sendable {
  func load() async throws -> MosaicAnalyticsPersistentState?
  func save(_ state: MosaicAnalyticsPersistentState) async throws
}

actor MosaicAnalyticsFilePersistence: MosaicAnalyticsPersistence {
  private let directory: URL
  private let fileURL: URL
  private let fileManager: FileManager

  init(
    baseURL: URL, publicSDKKey: String, rootDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) throws {
    guard
      let root = rootDirectory
        ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    else { throw CocoaError(.fileNoSuchFile) }
    directory = root.appendingPathComponent("MosaicSDK", isDirectory: true)
      .appendingPathComponent("analytics-v1", isDirectory: true)
    let normalizedURL = baseURL.absoluteString.trimmingCharacters(
      in: CharacterSet(charactersIn: "/"))
    let digest = SHA256.hash(data: Data("\(normalizedURL)\n\(publicSDKKey)".utf8))
    let name = digest.map { String(format: "%02x", $0) }.joined()
    fileURL = directory.appendingPathComponent(name + ".json")
    self.fileManager = fileManager
  }

  func load() throws -> MosaicAnalyticsPersistentState? {
    guard fileManager.fileExists(atPath: fileURL.path) else { return nil }
    let state = try JSONDecoder().decode(
      MosaicAnalyticsPersistentState.self,
      from: Data(contentsOf: fileURL, options: .mappedIfSafe))
    guard state.formatVersion == 1 else { throw CocoaError(.fileReadCorruptFile) }
    return state
  }

  func save(_ state: MosaicAnalyticsPersistentState) throws {
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    var resource = URLResourceValues()
    resource.isExcludedFromBackup = true
    var mutableDirectory = directory
    try? mutableDirectory.setResourceValues(resource)
    try JSONEncoder().encode(state).write(to: fileURL, options: .atomic)
    var mutableFile = fileURL
    try? mutableFile.setResourceValues(resource)
  }
}

actor MosaicMemoryAnalyticsPersistence: MosaicAnalyticsPersistence {
  private var state: MosaicAnalyticsPersistentState?
  init(state: MosaicAnalyticsPersistentState? = nil) { self.state = state }
  func load() -> MosaicAnalyticsPersistentState? { state }
  func save(_ state: MosaicAnalyticsPersistentState) { self.state = state }
}

actor MosaicAnalyticsRuntime {
  static let maxEventBytes = 32 * 1_024
  static let maxRequestBytes = 512 * 1_024
  static let maxQueuedBytes = 2 * 1_024 * 1_024
  static let maxQueuedEvents = 1_000
  static let maxBatchEvents = 50
  static let expiry: TimeInterval = 7 * 24 * 60 * 60
  static let sessionTimeout: TimeInterval = 30 * 60
  static let maxAttempts = 10

  private let persistence: any MosaicAnalyticsPersistence
  private let transport: any MosaicAnalyticsTransport
  private let identityStore: MosaicIdentityStore
  private let context: MosaicAnalyticsContext
  private let clock: @Sendable () -> Date
  private let jitter: @Sendable (ClosedRange<Double>) -> Double
  private var state: MosaicAnalyticsPersistentState?
  private var stateLoadTask: Task<MosaicAnalyticsPersistentState, Never>?
  private var flushTask: Task<MosaicAnalyticsFlushResult, Never>?

  init(
    persistence: any MosaicAnalyticsPersistence, transport: any MosaicAnalyticsTransport,
    identityStore: MosaicIdentityStore, context: MosaicAnalyticsContext,
    clock: @escaping @Sendable () -> Date = Date.init,
    jitter: @escaping @Sendable (ClosedRange<Double>) -> Double = { Double.random(in: $0) }
  ) {
    self.persistence = persistence
    self.transport = transport
    self.identityStore = identityStore
    self.context = context
    self.clock = clock
    self.jitter = jitter
  }

  func setCollection(environmentEnabled: Bool, hostEnabled: Bool) async {
    var value = await load()
    let wasEnabled = value.environmentCollectionEnabled && value.hostCollectionEnabled
    value.environmentCollectionEnabled = environmentEnabled
    value.hostCollectionEnabled = hostEnabled
    let isEnabled = environmentEnabled && hostEnabled
    if wasEnabled && !isEnabled {
      flushTask?.cancel()
      flushTask = nil
      value.queue.removeAll()
    } else if !wasEnabled && isEnabled {
      value.forceNewSession = true
    }
    state = value
    try? await persistence.save(value)
  }

  func identityChanged() async {
    var value = await load()
    value.forceNewSession = true
    state = value
    try? await persistence.save(value)
  }

  func record(
    name: MosaicAnalyticsEventName, correlation: MosaicAnalyticsCorrelation,
    attribution: MosaicAnalyticsAttribution, payload: MosaicAnalyticsPayload,
    occurredAt: Date = Date()
  ) async -> MosaicAnalyticsRecordResult {
    guard name != .purchaseCompletedProvider else { return .invalidEvent }
    let identity = await identityStore.snapshot()
    var value = await load()
    guard value.environmentCollectionEnabled && value.hostCollectionEnabled else {
      return .collectionDisabled
    }
    let now = clock()
    let sessionID = activeSession(in: &value, at: now)
    let event = MosaicAnalyticsEvent(
      eventId: Self.identifier(prefix: "event"), eventName: name,
      occurredAt: Self.timestamp(occurredAt), queuedAt: Self.timestamp(now),
      authority: .clientObserved,
      identity: .init(
        installationId: identity.installationID, applicationUserId: identity.userID,
        generation: identity.generation),
      sessionId: sessionID, context: context, correlation: correlation,
      attribution: attribution, payload: payload)
    guard Self.isStructurallyValid(event),
      let data = try? MosaicAnalyticsCodec.encode(event)
    else { return .invalidEvent }
    guard data.count <= Self.maxEventBytes else {
      value.droppedEventCount &+= 1
      value.lastSafeCode = "event_too_large"
      await saveBestEffort(value)
      return .eventTooLarge
    }
    value.queue.append(
      .init(event: event, encodedBytes: data.count, attempts: 0, nextAttemptAt: nil))
    prune(&value, now: now)
    state = value
    do {
      try await persistence.save(value)
    } catch { return .queuePersistenceFailed }
    if value.queue.count >= Self.maxBatchEvents { _ = await flush() }
    return .queued(eventID: event.eventId)
  }

  func flush() async -> MosaicAnalyticsFlushResult {
    if let flushTask { return await flushTask.value }
    let task = Task { [weak self] in
      guard let self else { return MosaicAnalyticsFlushResult.deferred }
      return await self.performFlush()
    }
    flushTask = task
    let result = await task.value
    flushTask = nil
    return result
  }

  func diagnostics() async -> MosaicAnalyticsDiagnostics {
    let value = await load()
    return .init(
      collectionEnabled: value.environmentCollectionEnabled && value.hostCollectionEnabled,
      queuedEventCount: value.queue.count,
      queuedBytes: value.queue.reduce(0) { $0 + $1.encodedBytes },
      droppedEventCount: value.droppedEventCount, expiredEventCount: value.expiredEventCount,
      permanentlyRejectedEventCount: value.permanentlyRejectedEventCount,
      retryCount: value.retryCount, lastSafeCode: value.lastSafeCode,
      isFlushInFlight: flushTask != nil)
  }

  private func performFlush() async -> MosaicAnalyticsFlushResult {
    var value = await load()
    guard value.environmentCollectionEnabled && value.hostCollectionEnabled else {
      return .collectionDisabled
    }
    let now = clock()
    pruneExpired(&value, now: now)
    let eligible = value.queue.filter { ($0.nextAttemptAt ?? .distantPast) <= now }
    guard !eligible.isEmpty else {
      await saveBestEffort(value)
      return value.queue.isEmpty ? .empty : .deferred
    }
    var records: [MosaicAnalyticsQueueRecord] = []
    for record in eligible.prefix(Self.maxBatchEvents) {
      let candidate = records + [record]
      let batch = MosaicAnalyticsBatch(
        batchId: Self.identifier(prefix: "batch"), sentAt: Self.timestamp(now),
        events: candidate.map(\.event))
      guard let encoded = try? MosaicAnalyticsCodec.encode(batch),
        encoded.count <= Self.maxRequestBytes
      else { break }
      records = candidate
    }
    guard !records.isEmpty else {
      value.droppedEventCount &+= 1
      value.lastSafeCode = "event_too_large"
      value.queue.removeFirst()
      await saveBestEffort(value)
      return .delivered(removed: 1, retained: value.queue.count)
    }
    let batch = MosaicAnalyticsBatch(
      batchId: Self.identifier(prefix: "batch"), sentAt: Self.timestamp(now),
      events: records.map(\.event))
    guard let body = try? MosaicAnalyticsCodec.encode(batch) else { return .deferred }
    do {
      let response = try await transport.send(data: body)
      guard response.statusCode == 200,
        let acknowledgement = try? MosaicAnalyticsCodec.decodeResponse(response.data),
        acknowledgement.batchId == batch.batchId,
        validAcknowledgement(acknowledgement, for: records)
      else {
        retry(
          records: records, in: &value, now: now, code: safeHTTPCode(response.statusCode),
          retryAfter: response.retryAfterSeconds)
        await saveBestEffort(value)
        return .deferred
      }
      let results = Dictionary(
        uniqueKeysWithValues: acknowledgement.results.map { ($0.eventId, $0) })
      let sentIDs = Set(records.map(\.event.eventId))
      var removed = 0
      value.queue.removeAll { record in
        guard sentIDs.contains(record.event.eventId), let result = results[record.event.eventId]
        else { return false }
        switch result.status {
        case .accepted, .duplicate:
          removed += 1
          return true
        case .permanentlyRejected:
          removed += 1
          value.permanentlyRejectedEventCount &+= 1
          value.lastSafeCode = result.code
          return true
        case .retryable:
          return false
        }
      }
      let retryable = records.filter { results[$0.event.eventId]?.status == .retryable }
      let retryAfter = retryable.compactMap { results[$0.event.eventId]?.retryAfterSeconds }.max()
      let code = retryable.compactMap { results[$0.event.eventId]?.code }.last
      retry(records: retryable, in: &value, now: now, code: code, retryAfter: retryAfter)
      await saveBestEffort(value)
      return .delivered(removed: removed, retained: value.queue.count)
    } catch {
      retry(
        records: records, in: &value, now: now, code: "service_temporarily_unavailable",
        retryAfter: nil)
      await saveBestEffort(value)
      return .deferred
    }
  }

  private func retry(
    records: [MosaicAnalyticsQueueRecord], in value: inout MosaicAnalyticsPersistentState,
    now: Date, code: String?, retryAfter: Int?
  ) {
    guard !records.isEmpty else { return }
    let ids = Set(records.map(\.event.eventId))
    value.retryCount &+= UInt64(records.count)
    value.lastSafeCode = code
    for index in value.queue.indices.reversed() where ids.contains(value.queue[index].event.eventId)
    {
      value.queue[index].attempts += 1
      if value.queue[index].attempts >= Self.maxAttempts {
        value.queue.remove(at: index)
        value.droppedEventCount &+= 1
        value.lastSafeCode = "retry_attempts_exhausted"
      } else {
        let cap = min(300.0, pow(2.0, Double(value.queue[index].attempts - 1)))
        let delay = max(Double(retryAfter ?? 0), jitter(0...cap))
        value.queue[index].nextAttemptAt = now.addingTimeInterval(min(300, delay))
      }
    }
  }

  private func validAcknowledgement(
    _ response: MosaicAnalyticsIngestionResponse, for records: [MosaicAnalyticsQueueRecord]
  ) -> Bool {
    let expected = Set(records.map(\.event.eventId))
    let received = response.results.map(\.eventId)
    guard received.count == Set(received).count, Set(received) == expected else { return false }
    let permanent = Set([
      "event_schema_invalid", "unsupported_event_schema", "unsupported_event_name", "unknown_field",
      "invalid_identifier", "invalid_timestamp", "occurred_at_too_far_future", "event_expired",
      "event_too_large", "batch_event_limit_exceeded", "duplicate_event_id_in_batch",
      "authority_not_allowed", "tenant_field_forbidden", "attribution_not_found",
      "attribution_scope_mismatch", "event_id_conflict", "sensitive_value_rejected",
    ])
    let retryable = Set([
      "rate_limited", "storage_temporarily_unavailable", "service_temporarily_unavailable",
      "ingestion_timeout",
    ])
    return response.results.allSatisfy { result in
      switch result.status {
      case .accepted, .duplicate: result.code == nil && result.retryAfterSeconds == nil
      case .permanentlyRejected:
        result.code.map(permanent.contains) == true && result.retryAfterSeconds == nil
      case .retryable:
        result.code.map(retryable.contains) == true
          && result.retryAfterSeconds.map { (1...300).contains($0) } != false
      }
    }
  }

  private func activeSession(in value: inout MosaicAnalyticsPersistentState, at now: Date) -> String
  {
    if value.forceNewSession || value.sessionID == nil
      || now.timeIntervalSince(value.lastActivityAt ?? .distantPast) >= Self.sessionTimeout
    {
      value.sessionID = Self.identifier(prefix: "session")
      value.forceNewSession = false
    }
    value.lastActivityAt = now
    return value.sessionID!
  }

  private func load() async -> MosaicAnalyticsPersistentState {
    if let state { return state }
    if let stateLoadTask {
      let loaded = await stateLoadTask.value
      if state == nil { state = loaded }
      return state ?? loaded
    }
    let persistence = self.persistence
    let task = Task {
      (try? await persistence.load()) ?? MosaicAnalyticsPersistentState()
    }
    stateLoadTask = task
    let loaded = await task.value
    if state == nil { state = loaded }
    stateLoadTask = nil
    return state ?? loaded
  }

  private func saveBestEffort(_ value: MosaicAnalyticsPersistentState) async {
    state = value
    try? await persistence.save(value)
  }

  private func prune(_ value: inout MosaicAnalyticsPersistentState, now: Date) {
    pruneExpired(&value, now: now)
    while value.queue.count > Self.maxQueuedEvents
      || value.queue.reduce(0, { $0 + $1.encodedBytes }) > Self.maxQueuedBytes
    {
      let minimum = value.queue.map { Self.priority($0.event.eventName) }.min() ?? 0
      guard
        let index = value.queue.firstIndex(where: { Self.priority($0.event.eventName) == minimum })
      else { break }
      value.queue.remove(at: index)
      value.droppedEventCount &+= 1
      value.lastSafeCode = "queue_overflow"
    }
  }

  private func pruneExpired(_ value: inout MosaicAnalyticsPersistentState, now: Date) {
    let before = value.queue.count
    value.queue.removeAll { record in
      guard let occurred = Self.parseTimestamp(record.event.occurredAt) else { return true }
      return now.timeIntervalSince(occurred) > Self.expiry
    }
    let expired = before - value.queue.count
    if expired > 0 {
      value.expiredEventCount &+= UInt64(expired)
      value.lastSafeCode = "event_expired"
    }
  }

  private static func priority(_ name: MosaicAnalyticsEventName) -> Int {
    switch name {
    case .purchaseCompletedClient, .purchasePending, .purchaseDeferred, .purchaseCancelled,
      .purchaseFailed, .restoreCompleted, .restoreNothingFound, .restoreCancelled, .restoreFailed:
      4
    case .paywallPresented, .paywallDismissed, .purchaseStarted, .restoreStarted: 3
    case .placementPaywallSelected, .placementNoPaywall, .placementFallbackUsed,
      .placementUnavailable, .placementEvaluationFailed, .productSelected:
      2
    case .placementRequested, .paywallActionSelected, .paywallRenderFailed,
      .productLoadStarted, .productLoadCompleted, .productLoadFailed, .productUnavailable:
      1
    case .purchaseCompletedProvider: 4
    }
  }

  private static func isStructurallyValid(_ event: MosaicAnalyticsEvent) -> Bool {
    guard event.authority == .clientObserved, event.identity != nil, event.sessionId != nil,
      event.context?.platform == "ios", event.context?.sdkFamily == "ios"
    else { return false }
    guard let encoded = try? MosaicAnalyticsCodec.encode(event),
      (try? MosaicAnalyticsCodec.decodeEvent(encoded)) != nil
    else { return false }
    return true
  }

  static func timestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
  }

  static func parseTimestamp(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value)
  }

  static func identifier(prefix: String) -> String {
    "\(prefix)_\(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: ""))"
  }

  private func safeHTTPCode(_ status: Int) -> String {
    status == 429 ? "rate_limited" : "service_temporarily_unavailable"
  }
}

actor MosaicAnalyticsRuntimeRegistry {
  static let shared = MosaicAnalyticsRuntimeRegistry()
  private var runtimes: [String: MosaicAnalyticsRuntime] = [:]

  func runtime(
    baseURL: URL, apiKey: String, timeout: TimeInterval, identityStore: MosaicIdentityStore,
    applicationVersion: String?
  ) throws -> MosaicAnalyticsRuntime {
    let namespace = baseURL.absoluteString + "\n" + apiKey
    if let existing = runtimes[namespace] { return existing }
    let runtime = MosaicAnalyticsRuntime(
      persistence: try MosaicAnalyticsFilePersistence(baseURL: baseURL, publicSDKKey: apiKey),
      transport: MosaicURLSessionAnalyticsTransport(
        baseURL: baseURL, apiKey: apiKey, timeout: timeout),
      identityStore: identityStore,
      context: MosaicAnalyticsContext(
        sdkVersion: "0.6.0",
        operatingSystemVersion: ProcessInfo.processInfo.operatingSystemVersionString
          .split(separator: " ").first(where: { $0.first?.isNumber == true }).map(String.init),
        applicationVersion: applicationVersion,
        locale: Locale.current.identifier.replacingOccurrences(of: "_", with: "-"),
        configurationDeliveryVersion: "2", commerceProviderContractVersion: "2"))
    runtimes[namespace] = runtime
    return runtime
  }
}

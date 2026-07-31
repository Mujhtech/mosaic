import CryptoKit
import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

struct MosaicTransactionObservationHTTPResponse: Sendable {
  let statusCode: Int
  let data: Data
  let retryAfterSeconds: Int?
}

protocol MosaicTransactionObservationTransport: Sendable {
  func send(data: Data) async throws -> MosaicTransactionObservationHTTPResponse
}

struct MosaicURLSessionTransactionObservationTransport: MosaicTransactionObservationTransport {
  private let endpoint: URL
  private let apiKey: String
  private let timeout: TimeInterval
  private let session: URLSession

  init(baseURL: URL, apiKey: String, timeout: TimeInterval) {
    endpoint = baseURL.appendingPathComponent("v1/sdk/billing/observations")
    self.apiKey = apiKey
    self.timeout = timeout
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.timeoutIntervalForResource = timeout
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    session = URLSession(configuration: configuration)
  }

  func send(data: Data) async throws -> MosaicTransactionObservationHTTPResponse {
    var request = URLRequest(url: endpoint, timeoutInterval: timeout)
    request.httpMethod = "POST"
    request.httpBody = data
    request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let (responseData, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return MosaicTransactionObservationHTTPResponse(
      statusCode: http.statusCode,
      data: responseData,
      retryAfterSeconds: http.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init)
    )
  }
}

struct MosaicTransactionObservationRecord: Codable, Sendable, Equatable {
  var observation: MosaicTransactionObservation
  /// Stamped when the observation was queued, so a record submitted after an
  /// app update still reports the SDK and application that observed it.
  var context: MosaicTransactionObservationContext
  var attempts: Int
  var nextAttemptAt: Date?
}

struct MosaicTransactionObservationState: Codable, Sendable, Equatable {
  var formatVersion = 1
  var queue: [MosaicTransactionObservationRecord] = []
  var acceptedForValidationCount: UInt64 = 0
  var duplicateCount: UInt64 = 0
  var permanentlyRejectedCount: UInt64 = 0
  var retryCount: UInt64 = 0
  var droppedCount: UInt64 = 0
  var lastSafeCode: String?
}

protocol MosaicTransactionObservationPersistence: Sendable {
  func load() async throws -> MosaicTransactionObservationState?
  func save(_ state: MosaicTransactionObservationState) async throws
}

actor MosaicTransactionObservationFilePersistence: MosaicTransactionObservationPersistence {
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
      .appendingPathComponent("transaction-observations-v1", isDirectory: true)
    let normalizedURL = baseURL.absoluteString.trimmingCharacters(
      in: CharacterSet(charactersIn: "/"))
    let digest = SHA256.hash(data: Data("\(normalizedURL)\n\(publicSDKKey)".utf8))
    let name = digest.map { String(format: "%02x", $0) }.joined()
    fileURL = directory.appendingPathComponent(name + ".json")
    self.fileManager = fileManager
  }

  func load() throws -> MosaicTransactionObservationState? {
    guard fileManager.fileExists(atPath: fileURL.path) else { return nil }
    let state = try JSONDecoder().decode(
      MosaicTransactionObservationState.self,
      from: Data(contentsOf: fileURL, options: .mappedIfSafe))
    guard state.formatVersion == 1 else { throw CocoaError(.fileReadCorruptFile) }
    return state
  }

  func save(_ state: MosaicTransactionObservationState) throws {
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

actor MosaicMemoryTransactionObservationPersistence: MosaicTransactionObservationPersistence {
  private var state: MosaicTransactionObservationState?
  init(state: MosaicTransactionObservationState? = nil) { self.state = state }
  func load() -> MosaicTransactionObservationState? { state }
  func save(_ state: MosaicTransactionObservationState) { self.state = state }
}

/// The persistent, duplicate-safe observation queue.
///
/// It mirrors `MosaicAnalyticsRuntime` deliberately: same persistence shape,
/// same backoff curve, same terminal-status handling. Phase 9A adds no
/// background-execution machinery, so delivery is attempted on enqueue, on
/// foreground and background transitions, and on the next `configure`. Store
/// Notifications remain the reliable path; this handoff is a latency and
/// attribution optimization.
actor MosaicTransactionObservationRuntime {
  static let maxQueuedObservations = 256
  static let maxPerFlush = 20
  static let maxAttempts = 10
  /// Longer than the analytics window: a missed observation costs validation
  /// latency, and provider notification retry windows are measured in days.
  static let expiry: TimeInterval = 30 * 24 * 60 * 60

  private let persistence: any MosaicTransactionObservationPersistence
  private let transport: any MosaicTransactionObservationTransport
  private let context: MosaicTransactionObservationContext
  private let clock: @Sendable () -> Date
  private let jitter: @Sendable (ClosedRange<Double>) -> Double
  private var state: MosaicTransactionObservationState?
  private var stateLoadTask: Task<MosaicTransactionObservationState, Never>?
  private var flushTask: Task<MosaicTransactionObservationFlushResult, Never>?

  init(
    persistence: any MosaicTransactionObservationPersistence,
    transport: any MosaicTransactionObservationTransport,
    context: MosaicTransactionObservationContext,
    clock: @escaping @Sendable () -> Date = Date.init,
    jitter: @escaping @Sendable (ClosedRange<Double>) -> Double = { Double.random(in: $0) }
  ) {
    self.persistence = persistence
    self.transport = transport
    self.context = context
    self.clock = clock
    self.jitter = jitter
  }

  /// Queues one observation and opportunistically attempts delivery. A
  /// submission identifier already present in the queue is dropped, so a
  /// replayed transaction can never enqueue twice.
  func enqueue(_ observation: MosaicTransactionObservation) async {
    var value = await load()
    guard !value.queue.contains(where: { $0.observation.submissionID == observation.submissionID })
    else { return }
    value.queue.append(
      .init(observation: observation, context: context, attempts: 0, nextAttemptAt: nil))
    prune(&value, now: clock())
    await saveBestEffort(value)
    _ = await flush()
  }

  func flush() async -> MosaicTransactionObservationFlushResult {
    if let flushTask { return await flushTask.value }
    let task = Task { [weak self] in
      guard let self else { return MosaicTransactionObservationFlushResult.deferred }
      return await self.performFlush()
    }
    flushTask = task
    let result = await task.value
    flushTask = nil
    return result
  }

  func diagnostics() async -> MosaicTransactionObservationDiagnostics {
    let value = await load()
    return .init(
      mode: .enabled,
      queuedCount: value.queue.count,
      acceptedForValidationCount: value.acceptedForValidationCount,
      duplicateCount: value.duplicateCount,
      permanentlyRejectedCount: value.permanentlyRejectedCount,
      retryCount: value.retryCount,
      droppedCount: value.droppedCount,
      lastSafeCode: value.lastSafeCode,
      isFlushInFlight: flushTask != nil)
  }

  private func performFlush() async -> MosaicTransactionObservationFlushResult {
    var value = await load()
    let now = clock()
    pruneExpired(&value, now: now)
    let eligible = value.queue.filter { ($0.nextAttemptAt ?? .distantPast) <= now }
      .prefix(Self.maxPerFlush)
    guard !eligible.isEmpty else {
      await saveBestEffort(value)
      return value.queue.isEmpty ? .empty : .deferred
    }
    var removed = 0
    var deferredAny = false
    for record in eligible {
      let outcome = await submit(record.observation, context: record.context)
      switch outcome.result {
      case .acceptedForValidation:
        value.acceptedForValidationCount &+= 1
        remove(record.observation.submissionID, from: &value)
        removed += 1
      case .duplicate:
        // A duplicate is idempotent, not an error, and never escalates.
        value.duplicateCount &+= 1
        remove(record.observation.submissionID, from: &value)
        removed += 1
      case .permanentlyRejected(let code):
        value.permanentlyRejectedCount &+= 1
        value.lastSafeCode = code
        remove(record.observation.submissionID, from: &value)
        removed += 1
      case .retryableFailure(let code):
        deferredAny = true
        retry(
          record.observation.submissionID, in: &value, now: now, code: code,
          retryAfter: outcome.retryAfterSeconds)
      }
    }
    await saveBestEffort(value)
    if removed == 0 && deferredAny { return .deferred }
    return .delivered(removed: removed, retained: value.queue.count)
  }

  private func submit(
    _ observation: MosaicTransactionObservation,
    context: MosaicTransactionObservationContext
  ) async -> (result: MosaicTransactionObservationOutcome, retryAfterSeconds: Int?) {
    guard let body = try? MosaicTransactionObservationCodec.encode(observation, context: context)
    else {
      // An observation that cannot be encoded can never succeed.
      return (.permanentlyRejected(code: "observation_schema_invalid"), nil)
    }
    do {
      let response = try await transport.send(data: body)
      guard (200...202).contains(response.statusCode) else {
        return (
          .retryableFailure(code: safeHTTPCode(response.statusCode)), response.retryAfterSeconds
        )
      }
      let result = MosaicTransactionObservationCodec.decodeResult(
        response.data, submissionID: observation.submissionID)
      // The record's own retry hint wins over the transport header; the
      // header remains the fallback for a response with no readable record.
      return (result.outcome, result.retryAfterSeconds ?? response.retryAfterSeconds)
    } catch {
      // A network failure must never surface to the host or the purchase path.
      return (.retryableFailure(code: "service_temporarily_unavailable"), nil)
    }
  }

  private func remove(_ submissionID: String, from value: inout MosaicTransactionObservationState) {
    value.queue.removeAll { $0.observation.submissionID == submissionID }
  }

  private func retry(
    _ submissionID: String, in value: inout MosaicTransactionObservationState, now: Date,
    code: String?, retryAfter: Int?
  ) {
    guard let index = value.queue.firstIndex(where: { $0.observation.submissionID == submissionID })
    else { return }
    value.retryCount &+= 1
    value.lastSafeCode = code
    value.queue[index].attempts += 1
    if value.queue[index].attempts >= Self.maxAttempts {
      value.queue.remove(at: index)
      value.droppedCount &+= 1
      value.lastSafeCode = "retry_attempts_exhausted"
      return
    }
    let cap = min(300.0, pow(2.0, Double(value.queue[index].attempts - 1)))
    let delay = max(Double(retryAfter ?? 0), jitter(0...cap))
    value.queue[index].nextAttemptAt = now.addingTimeInterval(min(300, delay))
  }

  private func load() async -> MosaicTransactionObservationState {
    if let state { return state }
    if let stateLoadTask {
      let loaded = await stateLoadTask.value
      if state == nil { state = loaded }
      return state ?? loaded
    }
    let persistence = self.persistence
    let task = Task {
      (try? await persistence.load()) ?? MosaicTransactionObservationState()
    }
    stateLoadTask = task
    let loaded = await task.value
    if state == nil { state = loaded }
    stateLoadTask = nil
    return state ?? loaded
  }

  private func saveBestEffort(_ value: MosaicTransactionObservationState) async {
    state = value
    try? await persistence.save(value)
  }

  private func prune(_ value: inout MosaicTransactionObservationState, now: Date) {
    pruneExpired(&value, now: now)
    while value.queue.count > Self.maxQueuedObservations {
      value.queue.removeFirst()
      value.droppedCount &+= 1
      value.lastSafeCode = "queue_overflow"
    }
  }

  private func pruneExpired(_ value: inout MosaicTransactionObservationState, now: Date) {
    let before = value.queue.count
    value.queue.removeAll { now.timeIntervalSince($0.observation.observedAt) > Self.expiry }
    let expired = before - value.queue.count
    if expired > 0 {
      value.droppedCount &+= UInt64(expired)
      value.lastSafeCode = "observation_expired"
    }
  }

  private func safeHTTPCode(_ status: Int) -> String {
    status == 429 ? "rate_limited" : "service_temporarily_unavailable"
  }
}

/// The sink handed to a commerce provider.
///
/// `enqueue` returns immediately and hands the work to a detached task, so no
/// provider actor can suspend on persistence or delivery.
struct MosaicTransactionObservationQueueSink: MosaicTransactionObservationSink {
  let runtime: MosaicTransactionObservationRuntime

  func enqueue(_ observation: MosaicTransactionObservation) {
    let runtime = self.runtime
    Task.detached(priority: .utility) { await runtime.enqueue(observation) }
  }
}

actor MosaicTransactionObservationRuntimeRegistry {
  static let shared = MosaicTransactionObservationRuntimeRegistry()
  private var runtimes: [String: MosaicTransactionObservationRuntime] = [:]

  /// Returns the shared runtime for this endpoint and key, plus whether it had
  /// to fall back to process-lifetime persistence. A degraded queue still
  /// delivers; it just cannot survive relaunch.
  func runtime(
    baseURL: URL, apiKey: String, timeout: TimeInterval, applicationVersion: String?,
    rootDirectory: URL?
  ) -> (runtime: MosaicTransactionObservationRuntime, degraded: Bool) {
    let namespace = baseURL.absoluteString + "\n" + apiKey
    if let existing = runtimes[namespace] { return (existing, false) }
    var degraded = false
    let persistence: any MosaicTransactionObservationPersistence
    if let rootDirectory,
      let file = try? MosaicTransactionObservationFilePersistence(
        baseURL: baseURL, publicSDKKey: apiKey, rootDirectory: rootDirectory)
    {
      persistence = file
    } else {
      persistence = MosaicMemoryTransactionObservationPersistence()
      degraded = true
    }
    let runtime = MosaicTransactionObservationRuntime(
      persistence: persistence,
      transport: MosaicURLSessionTransactionObservationTransport(
        baseURL: baseURL, apiKey: apiKey, timeout: timeout),
      context: MosaicTransactionObservationContext(applicationVersion: applicationVersion))
    runtimes[namespace] = runtime
    return (runtime, degraded)
  }
}

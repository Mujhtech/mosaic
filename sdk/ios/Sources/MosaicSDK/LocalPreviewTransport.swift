import Darwin
import Foundation

public enum MosaicPreviewSocketFrame: Sendable, Equatable {
  case text(String)
  case binary(Data)
}

public protocol MosaicPreviewSocket: Sendable {
  func send(text: String) async throws
  func receive() async throws -> MosaicPreviewSocketFrame
  func close() async
}

public protocol MosaicPreviewSocketConnector: Sendable {
  func connect(
    endpoint: URL,
    protocols: [String]
  ) async throws -> any MosaicPreviewSocket
}

public struct MosaicURLSessionPreviewSocketConnector: MosaicPreviewSocketConnector {
  public init() {}

  public func connect(
    endpoint: URL,
    protocols: [String]
  ) async throws -> any MosaicPreviewSocket {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 15
    configuration.timeoutIntervalForResource = 60 * 60
    let session = URLSession(configuration: configuration)
    let task = session.webSocketTask(with: endpoint, protocols: protocols)
    task.resume()
    return MosaicURLSessionPreviewSocket(session: session, task: task)
  }
}

private actor MosaicURLSessionPreviewSocket: MosaicPreviewSocket {
  private let session: URLSession
  private let task: URLSessionWebSocketTask
  private var isClosed = false

  init(session: URLSession, task: URLSessionWebSocketTask) {
    self.session = session
    self.task = task
  }

  func send(text: String) async throws {
    guard !isClosed else { throw URLError(.networkConnectionLost) }
    try await task.send(.string(text))
  }

  func receive() async throws -> MosaicPreviewSocketFrame {
    guard !isClosed else { throw URLError(.networkConnectionLost) }
    switch try await task.receive() {
    case .string(let source): return .text(source)
    case .data(let data): return .binary(data)
    @unknown default: throw URLError(.cannotDecodeContentData)
    }
  }

  func close() async {
    guard !isClosed else { return }
    isClosed = true
    task.cancel(with: .normalClosure, reason: nil)
    session.invalidateAndCancel()
  }
}

public struct MosaicPreviewInterval: Sendable, Equatable, Comparable {
  public static let zero = MosaicPreviewInterval(milliseconds: 0)

  public let milliseconds: Int64

  private init(milliseconds: Int64) {
    self.milliseconds = max(0, milliseconds)
  }

  public static func milliseconds(_ value: Int64) -> MosaicPreviewInterval {
    MosaicPreviewInterval(milliseconds: value)
  }

  public static func seconds(_ value: Int64) -> MosaicPreviewInterval {
    let converted = value.multipliedReportingOverflow(by: 1_000)
    return MosaicPreviewInterval(
      milliseconds: converted.overflow ? Int64.max : converted.partialValue
    )
  }

  public static func < (
    lhs: MosaicPreviewInterval,
    rhs: MosaicPreviewInterval
  ) -> Bool {
    lhs.milliseconds < rhs.milliseconds
  }

  var timeInterval: TimeInterval {
    Double(milliseconds) / 1_000
  }

  var statusMilliseconds: Int {
    Int(clamping: milliseconds)
  }

  var nanoseconds: UInt64 {
    let converted = milliseconds.multipliedReportingOverflow(by: 1_000_000)
    return UInt64(converted.overflow ? Int64.max : converted.partialValue)
  }
}

public struct MosaicPreviewReconnectPolicy: Sendable, Equatable {
  public let initialDelay: MosaicPreviewInterval
  public let maximumDelay: MosaicPreviewInterval
  public let maximumAttempts: Int

  public init(
    initialDelay: MosaicPreviewInterval = .milliseconds(250),
    maximumDelay: MosaicPreviewInterval = .seconds(5),
    maximumAttempts: Int = 8
  ) {
    self.initialDelay = initialDelay
    self.maximumDelay = maximumDelay
    self.maximumAttempts = max(0, maximumAttempts)
  }

  public func delay(forAttempt attempt: Int) -> MosaicPreviewInterval {
    guard attempt > 0 else { return .zero }
    let initialMilliseconds = initialDelay.milliseconds
    let maximumMilliseconds = max(initialMilliseconds, maximumDelay.milliseconds)
    var delay = initialMilliseconds
    if attempt > 1 {
      for _ in 1..<attempt {
        if delay >= maximumMilliseconds { return .milliseconds(maximumMilliseconds) }
        let doubled = delay.multipliedReportingOverflow(by: 2)
        delay =
          doubled.overflow ? maximumMilliseconds : min(doubled.partialValue, maximumMilliseconds)
      }
    }
    return .milliseconds(delay)
  }
}

public enum MosaicPreviewConfigurationError: Error, Sendable, Equatable {
  case invalidEndpoint
  case nonLocalEndpoint
  case invalidSessionId
  case invalidIdentity
  case invalidHeartbeat
}

public enum MosaicPreviewDefaults {
  public static let sessionId = "session_local_01"

  public static var endpoint: URL {
    var components = URLComponents()
    components.scheme = "ws"
    components.host = "127.0.0.1"
    components.port = 4_317
    components.path = "/preview"
    guard let url = components.url else {
      preconditionFailure("The fixed Mosaic local preview endpoint must be a valid URL.")
    }
    return url
  }
}

public struct MosaicPreviewClientConfiguration: Sendable, Equatable {
  public let endpoint: URL
  public let sessionId: String
  public let identity: MosaicPreviewClientIdentity
  public let reconnectPolicy: MosaicPreviewReconnectPolicy
  public let heartbeatInterval: MosaicPreviewInterval
  public let peerTimeout: MosaicPreviewInterval
  public let bundledAssetKeys: Set<String>

  public init(
    endpoint: URL = MosaicPreviewDefaults.endpoint,
    sessionId: String = MosaicPreviewDefaults.sessionId,
    identity: MosaicPreviewClientIdentity,
    reconnectPolicy: MosaicPreviewReconnectPolicy = MosaicPreviewReconnectPolicy(),
    heartbeatInterval: MosaicPreviewInterval = .seconds(5),
    peerTimeout: MosaicPreviewInterval = .seconds(15),
    bundledAssetKeys: Set<String> = []
  ) throws {
    guard
      let scheme = endpoint.scheme?.lowercased(),
      scheme == "ws" || scheme == "wss",
      endpoint.host?.isEmpty == false,
      endpoint.user == nil,
      endpoint.password == nil,
      endpoint.query == nil,
      endpoint.fragment == nil
    else {
      throw MosaicPreviewConfigurationError.invalidEndpoint
    }
    guard Self.isLocalDevelopmentHost(endpoint.host ?? "") else {
      throw MosaicPreviewConfigurationError.nonLocalEndpoint
    }
    guard
      sessionId.count >= 9,
      sessionId.count <= 100,
      sessionId.range(
        of: #"^session_[A-Za-z0-9][A-Za-z0-9_-]*$"#,
        options: .regularExpression
      ) != nil
    else {
      throw MosaicPreviewConfigurationError.invalidSessionId
    }
    let identityMessage = MosaicPreviewOutgoingMessage.previewClientConnected(identity)
    guard
      (try? MosaicPreviewMessageCodec().encode(
        identityMessage,
        messageId: "msg_identity_validation",
        sessionId: sessionId,
        sentAt: Date(timeIntervalSince1970: 0)
      )) != nil
    else {
      throw MosaicPreviewConfigurationError.invalidIdentity
    }
    guard
      heartbeatInterval > .zero,
      peerTimeout > heartbeatInterval,
      reconnectPolicy.initialDelay > .zero,
      reconnectPolicy.initialDelay <= reconnectPolicy.maximumDelay,
      reconnectPolicy.maximumDelay <= .seconds(5)
    else {
      throw MosaicPreviewConfigurationError.invalidHeartbeat
    }

    self.endpoint = endpoint
    self.sessionId = sessionId
    self.identity = identity
    self.reconnectPolicy = reconnectPolicy
    self.heartbeatInterval = heartbeatInterval
    self.peerTimeout = peerTimeout
    self.bundledAssetKeys = bundledAssetKeys
  }

  private static func isLocalDevelopmentHost(_ host: String) -> Bool {
    let normalized = host.lowercased()
    if normalized == "localhost" || normalized.hasSuffix(".localhost")
      || normalized.hasSuffix(".local")
    {
      return true
    }
    let parts = normalized.split(separator: ".").compactMap { Int($0) }
    guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else {
      return isLocalIPv6Address(normalized)
    }
    return parts[0] == 127
      || parts[0] == 10
      || (parts[0] == 172 && (16...31).contains(parts[1]))
      || (parts[0] == 192 && parts[1] == 168)
      || (parts[0] == 169 && parts[1] == 254)
  }

  private static func isLocalIPv6Address(_ host: String) -> Bool {
    guard host.contains(":") else { return false }
    var address = in6_addr()
    guard host.withCString({ inet_pton(AF_INET6, $0, &address) }) == 1 else {
      return false
    }
    return host == "::1"
      || host.hasPrefix("fc")
      || host.hasPrefix("fd")
      || host.hasPrefix("fe8")
      || host.hasPrefix("fe9")
      || host.hasPrefix("fea")
      || host.hasPrefix("feb")
  }
}

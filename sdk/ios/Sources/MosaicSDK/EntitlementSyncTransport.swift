import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

struct MosaicEntitlementSyncHTTPRequest: Sendable, Equatable {
  let url: URL
  /// Never logged and never printed: this dictionary carries the bearer token.
  let headers: [String: String]
  let timeout: TimeInterval
}

struct MosaicEntitlementSyncHTTPResponse: Sendable, Equatable {
  let statusCode: Int
  let data: Data
  let etag: String?
  /// The `Date` header, used to anchor trusted time. A device clock is
  /// attacker-controlled; a server instant is not.
  let serverDate: Date?
  /// Freshness slid by a bare `304`. When the server answers `200` with a
  /// `snapshotUnchanged` record instead, these come from the body, which is the
  /// preferred form because the body shape is contract-pinned.
  let refreshAfter: Date?
  let validUntil: Date?
  let staleGraceSeconds: Int?
  let retryAfterSeconds: Int?

  init(
    statusCode: Int, data: Data = Data(), etag: String? = nil, serverDate: Date? = nil,
    refreshAfter: Date? = nil, validUntil: Date? = nil, staleGraceSeconds: Int? = nil,
    retryAfterSeconds: Int? = nil
  ) {
    self.statusCode = statusCode
    self.data = data
    self.etag = etag
    self.serverDate = serverDate
    self.refreshAfter = refreshAfter
    self.validUntil = validUntil
    self.staleGraceSeconds = staleGraceSeconds
    self.retryAfterSeconds = retryAfterSeconds
  }
}

protocol MosaicEntitlementSyncTransport: Sendable {
  func fetch(_ request: MosaicEntitlementSyncHTTPRequest) async throws
    -> MosaicEntitlementSyncHTTPResponse
}

/// Header names owned by Customer Access Token Contract v1's wire form.
///
/// Both are required: the public SDK key identifies the application, the
/// customer token selects the customer, and neither substitutes for the other.
/// The token never travels in a query string, which would put it in access logs,
/// proxy logs, and browser history.
enum MosaicEntitlementSyncHeader {
  static let authorization = "Authorization"
  static let sdkKey = "Mosaic-SDK-Key"
  static let ifNoneMatch = "If-None-Match"
  static let refreshAfter = "Mosaic-Entitlement-Refresh-After"
  static let validUntil = "Mosaic-Entitlement-Valid-Until"
  static let staleGraceSeconds = "Mosaic-Entitlement-Stale-Grace-Seconds"
}

struct MosaicURLSessionEntitlementSyncTransport: MosaicEntitlementSyncTransport {
  private let session: URLSession

  init(requestTimeout: TimeInterval) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = requestTimeout
    configuration.timeoutIntervalForResource = requestTimeout
    // The SDK owns conditional requests through the entity tag; a URL cache
    // layered underneath would answer with bytes the acceptance gate never saw.
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    session = URLSession(configuration: configuration)
  }

  func fetch(_ request: MosaicEntitlementSyncHTTPRequest) async throws
    -> MosaicEntitlementSyncHTTPResponse
  {
    var urlRequest = URLRequest(url: request.url, timeoutInterval: request.timeout)
    urlRequest.httpMethod = "GET"
    for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
    let (data, response) = try await session.data(for: urlRequest)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return MosaicEntitlementSyncHTTPResponse(
      statusCode: http.statusCode,
      data: data,
      etag: http.value(forHTTPHeaderField: "ETag"),
      serverDate: http.value(forHTTPHeaderField: "Date").flatMap(Self.httpDate),
      refreshAfter: http.value(forHTTPHeaderField: MosaicEntitlementSyncHeader.refreshAfter)
        .flatMap(Self.contractTimestamp),
      validUntil: http.value(forHTTPHeaderField: MosaicEntitlementSyncHeader.validUntil)
        .flatMap(Self.contractTimestamp),
      staleGraceSeconds: http.value(
        forHTTPHeaderField: MosaicEntitlementSyncHeader.staleGraceSeconds).flatMap(Int.init),
      retryAfterSeconds: http.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init))
  }

  private static func httpDate(_ value: String) -> Date? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
    return formatter.date(from: value)
  }

  private static func contractTimestamp(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value)
  }
}

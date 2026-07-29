import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

struct MosaicEntitlementSyncHTTPRequest: Sendable, Equatable {
  let url: URL
  /// Never logged and never printed: this dictionary carries the bearer token.
  let headers: [String: String]
  /// The canonical `entitlementSyncRequest` envelope.
  ///
  /// The sync surface is a POST even though it is a read, because contract
  /// negotiation lives in the request record and a GET cannot carry it.
  /// Conditional revalidation still rides on `If-None-Match`.
  let body: Data
  let timeout: TimeInterval
}

struct MosaicEntitlementSyncHTTPResponse: Sendable, Equatable {
  let statusCode: Int
  let data: Data
  let etag: String?
  /// The `Date` header, used to anchor trusted time. A device clock is
  /// attacker-controlled; a server instant is not.
  let serverDate: Date?
  let retryAfterSeconds: Int?

  init(
    statusCode: Int, data: Data = Data(), etag: String? = nil, serverDate: Date? = nil,
    retryAfterSeconds: Int? = nil
  ) {
    self.statusCode = statusCode
    self.data = data
    self.etag = etag
    self.serverDate = serverDate
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
}

/// Builds the canonical `entitlementSyncRequest` envelope.
///
/// `billingCustomerId` is deliberately never sent. It is a hint the server
/// verifies against the Customer Access Token and refuses on mismatch, so it can
/// only narrow the answer or fail the request — it can never widen access, and
/// omitting it removes a value that would otherwise have to be kept in step with
/// the token.
enum MosaicEntitlementSyncRequestBody {
  static func encode(
    knownSnapshotVersion: Int64?,
    entityTag: String?,
    correlationID: String
  ) throws -> Data {
    var payload: [String: Any] = [
      "supportedAuthoritativeEntitlementContracts": [
        mosaicAuthoritativeEntitlementContractVersion
      ],
      "correlationId": correlationID,
    ]
    // Together these let the server answer `snapshotUnchanged` instead of
    // resending a snapshot the device already holds.
    if let knownSnapshotVersion { payload["knownSnapshotVersion"] = knownSnapshotVersion }
    if let entityTag { payload["entityTag"] = entityTag }
    return try MosaicCustomerCanonicalJSON.data([
      "authoritativeEntitlementContractVersion": mosaicAuthoritativeEntitlementContractVersion,
      "recordType": "entitlementSyncRequest",
      "payload": payload,
    ])
  }

  /// A per-request identifier satisfying the contract's identifier pattern. It is
  /// random per request and derived from nothing about the user or the device.
  static func correlationID() -> String {
    "ios_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
  }
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
    urlRequest.httpMethod = "POST"
    urlRequest.httpBody = request.body
    for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
    let (data, response) = try await session.data(for: urlRequest)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return MosaicEntitlementSyncHTTPResponse(
      statusCode: http.statusCode,
      data: data,
      etag: http.value(forHTTPHeaderField: "ETag"),
      serverDate: http.value(forHTTPHeaderField: "Date").flatMap(Self.httpDate),
      retryAfterSeconds: http.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init))
  }

  private static func httpDate(_ value: String) -> Date? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
    return formatter.date(from: value)
  }

}

import Foundation

struct MosaicConfigurationHTTPRequest: Sendable, Equatable {
  let url: URL
  let headers: [String: String]
  let timeout: TimeInterval
}

struct MosaicConfigurationHTTPResponse: Sendable, Equatable {
  let statusCode: Int
  let data: Data
  let etag: String?
  let cacheControl: String?
  let serverDate: Date?

  init(
    statusCode: Int, data: Data, etag: String?, cacheControl: String?, serverDate: Date? = nil
  ) {
    self.statusCode = statusCode
    self.data = data
    self.etag = etag
    self.cacheControl = cacheControl
    self.serverDate = serverDate
  }
}

protocol MosaicConfigurationTransport: Sendable {
  func fetch(_ request: MosaicConfigurationHTTPRequest) async throws
    -> MosaicConfigurationHTTPResponse
}

enum MosaicConfigurationTransportError: Error, Sendable, Equatable {
  case invalidResponse
  case responseTooLarge
}

struct MosaicURLSessionConfigurationTransport: MosaicConfigurationTransport {
  private let session: URLSession
  private let maximumResponseBytes: Int

  init(
    requestTimeout: TimeInterval,
    maximumResponseBytes: Int = 16 * 1_024 * 1_024
  ) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = requestTimeout
    configuration.timeoutIntervalForResource = requestTimeout
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    session = URLSession(configuration: configuration)
    self.maximumResponseBytes = maximumResponseBytes
  }

  func fetch(_ request: MosaicConfigurationHTTPRequest) async throws
    -> MosaicConfigurationHTTPResponse
  {
    var urlRequest = URLRequest(url: request.url, timeoutInterval: request.timeout)
    urlRequest.httpMethod = "GET"
    for (name, value) in request.headers {
      urlRequest.setValue(value, forHTTPHeaderField: name)
    }
    let (data, response) = try await session.data(for: urlRequest)
    guard let response = response as? HTTPURLResponse else {
      throw MosaicConfigurationTransportError.invalidResponse
    }
    guard data.count <= maximumResponseBytes else {
      throw MosaicConfigurationTransportError.responseTooLarge
    }
    return MosaicConfigurationHTTPResponse(
      statusCode: response.statusCode,
      data: data,
      etag: response.value(forHTTPHeaderField: "ETag"),
      cacheControl: response.value(forHTTPHeaderField: "Cache-Control"),
      serverDate: Self.httpDate(response.value(forHTTPHeaderField: "Date"))
    )
  }

  private static func httpDate(_ value: String?) -> Date? {
    guard let value else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "EEE',' dd MMM yyyy HH':'mm':'ss z"
    return formatter.date(from: value)
  }
}

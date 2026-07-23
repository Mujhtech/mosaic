import Foundation

let mosaicCommerceConfigurationMediaType =
  "application/vnd.mosaic.commerce-configuration+json;version=1"

struct MosaicCommerceConfigurationHTTPRequest: Sendable, Equatable {
  let url: URL
  let headers: [String: String]
  let timeout: TimeInterval
}

struct MosaicCommerceConfigurationHTTPResponse: Sendable, Equatable {
  let statusCode: Int
  let data: Data
  let contentType: String?
  let etag: String?
  let configurationReleaseID: String?
  let cacheControl: String?
}

protocol MosaicCommerceConfigurationTransport: Sendable {
  func fetch(_ request: MosaicCommerceConfigurationHTTPRequest) async throws
    -> MosaicCommerceConfigurationHTTPResponse
}

enum MosaicCommerceConfigurationTransportError: Error, Sendable, Equatable {
  case invalidResponse
  case responseTooLarge
}

struct MosaicURLSessionCommerceConfigurationTransport:
  MosaicCommerceConfigurationTransport
{
  private let session: URLSession
  private let maximumResponseBytes: Int

  init(requestTimeout: TimeInterval, maximumResponseBytes: Int = 2 * 1_024 * 1_024) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = requestTimeout
    configuration.timeoutIntervalForResource = requestTimeout
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    session = URLSession(configuration: configuration)
    self.maximumResponseBytes = maximumResponseBytes
  }

  func fetch(_ request: MosaicCommerceConfigurationHTTPRequest) async throws
    -> MosaicCommerceConfigurationHTTPResponse
  {
    var urlRequest = URLRequest(url: request.url, timeoutInterval: request.timeout)
    urlRequest.httpMethod = "GET"
    for (name, value) in request.headers {
      urlRequest.setValue(value, forHTTPHeaderField: name)
    }
    let (data, response) = try await session.data(for: urlRequest)
    guard let response = response as? HTTPURLResponse else {
      throw MosaicCommerceConfigurationTransportError.invalidResponse
    }
    guard data.count <= maximumResponseBytes else {
      throw MosaicCommerceConfigurationTransportError.responseTooLarge
    }
    return MosaicCommerceConfigurationHTTPResponse(
      statusCode: response.statusCode,
      data: data,
      contentType: response.value(forHTTPHeaderField: "Content-Type"),
      etag: response.value(forHTTPHeaderField: "ETag"),
      configurationReleaseID: response.value(
        forHTTPHeaderField: "Mosaic-Configuration-Release-Id"
      ),
      cacheControl: response.value(forHTTPHeaderField: "Cache-Control")
    )
  }
}

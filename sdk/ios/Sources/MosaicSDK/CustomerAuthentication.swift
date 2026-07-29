import Foundation

/// A Customer Access Token.
///
/// The value is deliberately not readable from outside the SDK and the type
/// prints as a redaction, so a token cannot reach a log, a crash report, or
/// telemetry through an interpolation someone added in a hurry. Nothing in the
/// SDK ever parses it: it is opaque by contract, and inferring anything from its
/// bytes is forbidden.
public struct MosaicCustomerAccessToken: Sendable, Equatable, CustomStringConvertible,
  CustomDebugStringConvertible
{
  let value: String

  public init(_ value: String) {
    self.value = value
  }

  public var description: String { "MosaicCustomerAccessToken(redacted)" }
  public var debugDescription: String { description }
}

/// What a host's token provider can answer.
///
/// `signedOut` and `unavailable` are separate members on purpose. Signed out is
/// a fact about the person; unavailable is a fact about the host's backend. Both
/// yield `unavailable` access rather than `inactive` — a backend that cannot
/// mint a token has not revoked anyone's subscription — but only `signedOut`
/// carries logout semantics and clears the cache.
public enum MosaicCustomerTokenResult: Sendable, Equatable {
  case token(MosaicCustomerAccessToken)
  case signedOut
  case unavailable
}

/// Supplies Customer Access Tokens minted by the host application's own backend.
///
/// Mosaic Billing requires an application backend (OD-4): a public SDK key
/// identifies an application and can never select a Billing Customer, and an
/// application user ID is guessable. The host authenticates its user, asks
/// Mosaic for a token with its `secret_server` key, and returns it here.
///
/// `forceRefresh` is passed as `true` only after Mosaic refuses a token, and at
/// most once per token generation.
public protocol MosaicCustomerTokenProvider: Sendable {
  func customerAccessToken(forceRefresh: Bool) async -> MosaicCustomerTokenResult
}

/// A provider that always answers with the same token. Useful for previews,
/// tests, and single-session hosts; a real host refreshes.
public struct MosaicStaticCustomerTokenProvider: MosaicCustomerTokenProvider {
  private let result: MosaicCustomerTokenResult

  public init(token: MosaicCustomerAccessToken) { result = .token(token) }
  public init(result: MosaicCustomerTokenResult) { self.result = result }

  public func customerAccessToken(forceRefresh _: Bool) async -> MosaicCustomerTokenResult {
    result
  }
}

/// Adapts a closure, which is what most hosts want: one call into their own
/// authenticated API.
public struct MosaicClosureCustomerTokenProvider: MosaicCustomerTokenProvider {
  private let handler: @Sendable (Bool) async -> MosaicCustomerTokenResult

  public init(_ handler: @escaping @Sendable (Bool) async -> MosaicCustomerTokenResult) {
    self.handler = handler
  }

  public func customerAccessToken(forceRefresh: Bool) async -> MosaicCustomerTokenResult {
    await handler(forceRefresh)
  }
}

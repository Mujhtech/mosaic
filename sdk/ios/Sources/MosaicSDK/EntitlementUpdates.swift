import Foundation

/// Fans authoritative entitlement changes out to every observer.
///
/// `AsyncStream` is single-consumer, but several parts of an app legitimately
/// want to watch access at once — a paywall, a settings screen, a feature gate —
/// so each subscriber gets its own stream and this actor multiplies emissions
/// across them.
///
/// A new subscriber is replayed the current state immediately. Without that, a
/// view that appears after the launch sync would sit in an indeterminate state
/// until the *next* change, which for a stable subscription may be never.
actor MosaicCustomerEntitlementBroadcaster {
  /// Enough to absorb a burst — a sign-in emitting cleared, loading, and then a
  /// snapshot — while still dropping the oldest rather than growing without
  /// bound if a consumer stops reading. The newest state is the true one, so
  /// dropping the oldest is the correct policy for a state stream.
  static let bufferSize = 8

  private var continuations:
    [UUID: AsyncStream<MosaicCustomerEntitlementUpdate>.Continuation] = [:]
  private var current: MosaicCustomerEntitlementUpdate?

  var subscriberCount: Int { continuations.count }
  var currentUpdate: MosaicCustomerEntitlementUpdate? { current }

  func updates() -> AsyncStream<MosaicCustomerEntitlementUpdate> {
    let id = UUID()
    let (stream, continuation) = AsyncStream.makeStream(
      of: MosaicCustomerEntitlementUpdate.self,
      bufferingPolicy: .bufferingNewest(Self.bufferSize))
    continuations[id] = continuation
    if let current { continuation.yield(current) }
    continuation.onTermination = { [weak self] _ in
      Task { await self?.remove(id) }
    }
    return stream
  }

  /// Emits one change. Only accepted state reaches here: a rejected snapshot
  /// never emits, so an observer can treat every emission as authoritative.
  func emit(_ update: MosaicCustomerEntitlementUpdate) {
    current = update
    for continuation in continuations.values { continuation.yield(update) }
  }

  func finish() {
    for continuation in continuations.values { continuation.finish() }
    continuations.removeAll()
  }

  private func remove(_ id: UUID) {
    continuations.removeValue(forKey: id)
  }
}

import Foundation

#if canImport(UIKit)
  import UIKit

  /// Refreshes authoritative entitlements when the app comes to the foreground.
  ///
  /// Deliberately limited. Phase 9B adds **no background execution**: no
  /// `BGTaskScheduler`, no silent push, no timers. A refresh happens at
  /// `configure` and on foreground, and nothing guarantees one while the app is
  /// backgrounded or terminated. That is a documented property, not an
  /// oversight — a device that has been offline for days is exactly what the
  /// bounded-grace window and the `expired` cache state exist to describe, and
  /// scheduling background work to paper over it would spend the host's
  /// background budget without making the answer any more authoritative.
  @MainActor
  enum MosaicCustomerEntitlementLifecycleRegistry {
    private static var observers: [String: MosaicCustomerEntitlementLifecycleObserver] = [:]

    static func install(client: MosaicCustomerEntitlementClient, namespace: String) {
      guard observers[namespace] == nil else { return }
      observers[namespace] = MosaicCustomerEntitlementLifecycleObserver(client: client)
    }
  }

  @MainActor
  private final class MosaicCustomerEntitlementLifecycleObserver {
    private let client: MosaicCustomerEntitlementClient
    private var tokens: [NSObjectProtocol] = []

    init(client: MosaicCustomerEntitlementClient) {
      self.client = client
      tokens.append(
        NotificationCenter.default.addObserver(
          forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
        ) { [client] _ in
          // `refreshIfNeeded` and not `refresh`: a foreground while the snapshot
          // is still fresh costs nothing and asks nothing of the network.
          Task { _ = await client.refreshIfNeeded() }
        })
    }
  }
#else
  enum MosaicCustomerEntitlementLifecycleRegistry {
    static func install(
      client: MosaicCustomerEntitlementClient, namespace: String
    ) async {}
  }
#endif

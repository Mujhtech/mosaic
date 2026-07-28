import Foundation

#if canImport(UIKit)
  import UIKit

  @MainActor
  enum MosaicAnalyticsLifecycleRegistry {
    private static var observers: [String: MosaicAnalyticsLifecycleObserver] = [:]

    static func install(runtime: MosaicAnalyticsRuntime, namespace: String) {
      guard observers[namespace] == nil else { return }
      observers[namespace] = MosaicAnalyticsLifecycleObserver(runtime: runtime)
    }
  }

  /// Phase 9A adds no background-execution machinery. The observation queue
  /// gets exactly the delivery opportunities the analytics queue already has:
  /// foreground, background, enqueue, and the next `configure`.
  @MainActor
  enum MosaicTransactionObservationLifecycleRegistry {
    private static var observers: [String: MosaicTransactionObservationLifecycleObserver] = [:]

    static func install(runtime: MosaicTransactionObservationRuntime, namespace: String) {
      guard observers[namespace] == nil else { return }
      observers[namespace] = MosaicTransactionObservationLifecycleObserver(runtime: runtime)
    }
  }

  @MainActor
  private final class MosaicTransactionObservationLifecycleObserver {
    private let runtime: MosaicTransactionObservationRuntime
    private var tokens: [NSObjectProtocol] = []

    init(runtime: MosaicTransactionObservationRuntime) {
      self.runtime = runtime
      let center = NotificationCenter.default
      for name in [
        UIApplication.didEnterBackgroundNotification,
        UIApplication.willEnterForegroundNotification,
      ] {
        tokens.append(
          center.addObserver(forName: name, object: nil, queue: .main) { [runtime] _ in
            Task { _ = await runtime.flush() }
          })
      }
    }
  }

  @MainActor
  private final class MosaicAnalyticsLifecycleObserver {
    private let runtime: MosaicAnalyticsRuntime
    private var tokens: [NSObjectProtocol] = []

    init(runtime: MosaicAnalyticsRuntime) {
      self.runtime = runtime
      let center = NotificationCenter.default
      tokens.append(
        center.addObserver(
          forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [runtime] _ in
          Task { _ = await runtime.flush() }
        })
      tokens.append(
        center.addObserver(
          forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
        ) { [runtime] _ in
          Task { _ = await runtime.flush() }
        })
    }

  }
#else
  enum MosaicAnalyticsLifecycleRegistry {
    static func install(runtime: MosaicAnalyticsRuntime, namespace: String) async {}
  }

  enum MosaicTransactionObservationLifecycleRegistry {
    static func install(
      runtime: MosaicTransactionObservationRuntime, namespace: String
    ) async {}
  }
#endif

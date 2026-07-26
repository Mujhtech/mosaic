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
#endif

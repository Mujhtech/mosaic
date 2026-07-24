import Foundation

enum MosaicResourceBundle {
  static var bundle: Bundle {
    #if SWIFT_PACKAGE
      return .module
    #else
      let containingBundle = Bundle(for: MosaicResourceBundleMarker.self)
      let candidates = [
        containingBundle.resourceURL,
        Bundle.main.resourceURL,
      ]

      for candidate in candidates {
        guard
          let bundleURL = candidate?.appendingPathComponent(
            "MosaicSDKResources.bundle",
            isDirectory: true
          ),
          let resourceBundle = Bundle(url: bundleURL)
        else {
          continue
        }
        return resourceBundle
      }

      return containingBundle
    #endif
  }
}

private final class MosaicResourceBundleMarker: NSObject {}

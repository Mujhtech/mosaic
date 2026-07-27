// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "MosaicRevenueCat",
  platforms: [
    .iOS(.v15),
    .macOS(.v14),
  ],
  products: [
    .library(name: "MosaicRevenueCat", targets: ["MosaicRevenueCat"])
  ],
  dependencies: [
    .package(path: ".."),
    // Range rather than `exact:` so host applications can resolve one
    // compatible purchases-ios version. `Package.resolved` records the
    // version Mosaic verifies.
    .package(
      url: "https://github.com/RevenueCat/purchases-ios.git",
      .upToNextMajor(from: "5.81.2")
    ),
  ],
  targets: [
    .target(
      name: "MosaicRevenueCat",
      dependencies: [
        .product(name: "MosaicSDK", package: "ios"),
        .product(name: "RevenueCat", package: "purchases-ios"),
      ]
    ),
    .testTarget(
      name: "MosaicRevenueCatTests",
      dependencies: ["MosaicRevenueCat"]
    ),
  ]
)

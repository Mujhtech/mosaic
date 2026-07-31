// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "MosaicStoreKit",
  platforms: [
    .iOS(.v15),
    .macOS(.v14),
  ],
  products: [
    .library(name: "MosaicStoreKit", targets: ["MosaicStoreKit"])
  ],
  dependencies: [
    .package(name: "MosaicSDK", path: "..")
  ],
  targets: [
    .target(
      name: "MosaicStoreKit",
      dependencies: [
        .product(name: "MosaicSDK", package: "MosaicSDK")
      ]
    ),
    .testTarget(
      name: "MosaicStoreKitTests",
      dependencies: ["MosaicStoreKit", .product(name: "MosaicSDK", package: "MosaicSDK")]
    ),
  ]
)

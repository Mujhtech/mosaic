// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "mosaic_native_store",
  platforms: [.iOS(.v15)],
  products: [
    .library(name: "mosaic-native-store", targets: ["mosaic_native_store"])
  ],
  dependencies: [
    .package(name: "MosaicStoreKit", path: "../../../../ios/StoreKit")
  ],
  targets: [
    .target(
      name: "mosaic_native_store",
      dependencies: [
        .product(name: "MosaicStoreKit", package: "MosaicStoreKit")
      ],
      path: "Classes"
    )
  ]
)

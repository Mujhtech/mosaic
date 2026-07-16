// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "MosaicSDK",
  platforms: [
    .iOS(.v15)
  ],
  products: [
    .library(name: "MosaicSDK", targets: ["MosaicSDK"])
  ],
  targets: [
    .target(name: "MosaicSDK"),
    .testTarget(
      name: "MosaicSDKTests",
      dependencies: ["MosaicSDK"]
    ),
  ]
)

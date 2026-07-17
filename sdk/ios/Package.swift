// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "MosaicSDK",
  platforms: [
    .iOS(.v15),
    // Package tests compile SwiftUI on the macOS development host. Mosaic does
    // not declare a desktop product surface.
    .macOS(.v14),
  ],
  products: [
    .library(name: "MosaicSDK", targets: ["MosaicSDK"])
  ],
  targets: [
    .target(
      name: "MosaicSDK",
      resources: [.process("Resources")]
    ),
    .testTarget(name: "MosaicSDKTests", dependencies: ["MosaicSDK"]),
  ]
)

Pod::Spec.new do |spec|
  spec.name = "MosaicSDK"
  spec.version = "0.1.0-dev.5"
  spec.summary = "Native SwiftUI renderer and client SDK for Mosaic."
  spec.description = <<-DESC
    MosaicSDK decodes the platform-neutral Mosaic protocol, renders paywalls
    with SwiftUI, and provides configuration, preview, and commerce boundaries.
  DESC
  spec.homepage = "https://github.com/Mujhtech/mosaic"
  spec.license = { type: "Apache-2.0" }
  spec.authors = { "Mosaic Contributors" => "opensource@mosaic.dev" }
  spec.source = {
    http: "https://github.com/Mujhtech/mosaic/releases/download/ios-v#{spec.version}/MosaicSDK-#{spec.version}.zip",
  }

  spec.ios.deployment_target = "15.0"
  spec.swift_versions = ["6.0"]
  spec.source_files = "Sources/MosaicSDK/**/*.swift"
  spec.resource_bundles = {
    "MosaicSDKResources" => ["Sources/MosaicSDK/Resources/**/*"],
  }
  spec.frameworks = [
    "AVFoundation",
    "Foundation",
    "SwiftUI",
  ]
end

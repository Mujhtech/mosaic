Pod::Spec.new do |spec|
  spec.name = "MosaicSDK"
  spec.version = "0.1.0-dev.6"
  spec.summary = "Native SwiftUI renderer and client SDK for Mosaic."
  spec.description = <<-DESC
    MosaicSDK decodes the platform-neutral Mosaic protocol, renders paywalls
    with SwiftUI, and provides configuration, preview, and commerce boundaries.
  DESC
  spec.homepage = "https://github.com/Mujhtech/mosaic"
  spec.license = { type: "Apache-2.0" }
  spec.authors = { "Mosaic Contributors" => "opensource@mosaic.dev" }
  # Mosaic does not publish CocoaPods release artifacts yet, so this podspec is
  # supported for local-path integration only:
  #
  #   pod "MosaicSDK", :path => "../mosaic/sdk/ios"
  #
  # `spec.source` must still be syntactically present for `pod lib lint`. It
  # deliberately points at the repository and a tag that only exists once an
  # `ios-v<version>` release is published; do not advertise it as installable.
  spec.source = {
    git: "https://github.com/Mujhtech/mosaic.git",
    tag: "ios-v#{spec.version}",
  }

  spec.ios.deployment_target = "15.0"
  spec.swift_versions = ["6.0"]
  spec.source_files = "Sources/MosaicSDK/**/*.swift"
  spec.resource_bundles = {
    "MosaicSDKResources" => ["Sources/MosaicSDK/Resources/**/*"],
    "MosaicSDK" => ["Sources/MosaicSDK/PrivacyInfo.xcprivacy"],
  }
  spec.frameworks = [
    "AVFoundation",
    "Foundation",
    "SwiftUI",
  ]
end

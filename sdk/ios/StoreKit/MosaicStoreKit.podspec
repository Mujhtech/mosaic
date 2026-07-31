Pod::Spec.new do |spec|
  spec.name = "MosaicStoreKit"
  spec.version = "0.1.0-dev.6"
  spec.summary = "StoreKit 2 commerce provider for MosaicSDK."
  spec.description = <<-DESC
    MosaicStoreKit connects Mosaic's provider-neutral commerce boundary to
    StoreKit 2 while keeping StoreKit products and transactions private.
  DESC
  spec.homepage = "https://github.com/Mujhtech/mosaic"
  spec.license = { type: "Apache-2.0" }
  spec.authors = { "Mosaic Contributors" => "opensource@mosaic.dev" }
  # Local-path integration only until Mosaic publishes CocoaPods artifacts:
  #
  #   pod "MosaicStoreKit", :path => "../mosaic/sdk/ios/StoreKit"
  #
  # See the note in `MosaicSDK.podspec`. The tag below only exists once an
  # `ios-v<version>` release is published.
  spec.source = {
    git: "https://github.com/Mujhtech/mosaic.git",
    tag: "ios-v#{spec.version}",
  }

  spec.ios.deployment_target = "15.0"
  spec.swift_versions = ["6.0"]
  spec.source_files = "Sources/MosaicStoreKit/**/*.swift"
  spec.frameworks = [
    "Foundation",
    "StoreKit",
  ]
  spec.dependency "MosaicSDK", "= #{spec.version}"
end

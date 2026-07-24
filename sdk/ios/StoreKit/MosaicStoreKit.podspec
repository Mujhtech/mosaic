Pod::Spec.new do |spec|
  spec.name = "MosaicStoreKit"
  spec.version = "0.1.0-dev.5"
  spec.summary = "StoreKit 2 commerce provider for MosaicSDK."
  spec.description = <<-DESC
    MosaicStoreKit connects Mosaic's provider-neutral commerce boundary to
    StoreKit 2 while keeping StoreKit products and transactions private.
  DESC
  spec.homepage = "https://github.com/Mujhtech/mosaic"
  spec.license = { type: "Apache-2.0" }
  spec.authors = { "Mosaic Contributors" => "opensource@mosaic.dev" }
  spec.source = {
    http: "https://github.com/Mujhtech/mosaic/releases/download/ios-v#{spec.version}/MosaicStoreKit-#{spec.version}.zip",
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

Pod::Spec.new do |s|
  s.name             = 'mosaic_native_store'
  s.version          = '0.1.0-dev.1'
  s.summary          = 'Thin Flutter bridge to Mosaic native-store adapters.'
  s.description      = 'Provider-neutral Flutter bridge; it contains no StoreKit business logic.'
  s.homepage         = 'https://github.com/mosaic'
  s.license          = { :type => 'Apache-2.0' }
  s.author           = { 'Mosaic' => 'opensource@mosaic.dev' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.dependency 'MosaicSDK', '0.1.0-dev.5'
  s.dependency 'MosaicStoreKit', '0.1.0-dev.5'
  s.platform         = :ios, '15.0'
  s.swift_version    = '6.0'
end

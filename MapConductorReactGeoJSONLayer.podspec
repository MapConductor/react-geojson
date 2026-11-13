require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name = "MapConductorReactGeoJSONLayer"
  s.version = package["version"]
  s.summary = package["description"]
  s.license = package["license"]
  s.author = package["author"]
  s.homepage = "https://github.com/mapconductor/react-sdk"
  s.source = { :path => __dir__ }
  s.platform = :ios, "16.1"
  s.source_files = "ios/*.{h,m,mm,swift}"
  # MapConductorGeoJSON is a source pod (see ios-sdk/ios-geojson's podspec), not a vendored
  # prebuilt xcframework - see ios-sdk/CLAUDE.md's "iOS Provider Distribution" section.
  s.dependency "React-Core"
  s.dependency "MapConductorCore", "~> 1.4"
  s.dependency "MapConductorReactNativeCore"
  s.dependency "MapConductorGeoJSON", "~> 1.4"
end

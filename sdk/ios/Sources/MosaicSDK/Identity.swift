import CryptoKit
import Foundation

public enum MosaicIdentityError: Error, Sendable, Equatable {
  case invalidUserID
  case invalidAttributeKey(String)
  case unsupportedAttribute(String)
  case attributeTypeMismatch(String)
  case tooManyAttributes
  case attributeValueOutOfBounds(String)
  case payloadTooLarge
  case persistenceFailed
}

protocol MosaicIdentityPersistence: Sendable {
  func load() async throws -> Data?
  func save(_ data: Data) async throws
}

actor MosaicIdentityFilePersistence: MosaicIdentityPersistence {
  private let directory: URL
  private let file: URL
  init(baseURL: URL, publicSDKKey: String, rootDirectory: URL? = nil) throws {
    let manager = FileManager.default
    guard
      let root = rootDirectory
        ?? manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    else { throw CocoaError(.fileNoSuchFile) }
    directory = root.appendingPathComponent("MosaicSDK", isDirectory: true).appendingPathComponent(
      "identity-v1", isDirectory: true)
    let material = Data("\(baseURL.absoluteString)\n\(publicSDKKey)".utf8)
    let name = SHA256.hash(data: material).map { String(format: "%02x", $0) }.joined()
    file = directory.appendingPathComponent(name + ".json")
  }
  func load() throws -> Data? {
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    return try Data(contentsOf: file, options: .mappedIfSafe)
  }
  func save(_ data: Data) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    // The installation identifier is meant to identify one app install. Carried
    // to a second device by a backup restore it would report two installs as
    // one, which silently corrupts experiment bucketing and analytics identity.
    var resource = URLResourceValues()
    resource.isExcludedFromBackup = true
    var mutableDirectory = directory
    try? mutableDirectory.setResourceValues(resource)
    try data.write(to: file, options: .atomic)
    var mutableFile = file
    try? mutableFile.setResourceValues(resource)
  }
}

actor MosaicMemoryIdentityPersistence: MosaicIdentityPersistence {
  private var data: Data?
  init(data: Data? = nil) { self.data = data }
  func load() -> Data? { data }
  func save(_ data: Data) { self.data = data }
}

actor MosaicIdentityStore {
  private struct Record: Codable {
    var formatVersion: Int
    var installationID: String
    var userID: String?
    var attributes: [String: MosaicTypedValue]
    var generation: UInt64
  }
  private let persistence: any MosaicIdentityPersistence
  private var record: Record?
  init(persistence: any MosaicIdentityPersistence) { self.persistence = persistence }

  func snapshot() async -> MosaicIdentitySnapshot {
    let record = await load()
    return .init(
      installationID: record.installationID, userID: record.userID, attributes: record.attributes,
      generation: record.generation)
  }

  func identify(_ userID: String) async throws {
    let normalized = userID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (1...256).contains(Data(normalized.utf8).count),
      normalized.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7f })
    else { throw MosaicIdentityError.invalidUserID }
    var value = await load()
    value.userID = normalized
    value.generation &+= 1
    try await persist(value)
  }

  func replaceAttributes(
    _ attributes: [String: MosaicTypedValue], definitions: [MosaicAttributeDefinition]?
  ) async throws {
    try Self.validate(attributes, definitions: definitions)
    var value = await load()
    value.attributes = attributes
    value.generation &+= 1
    try await persist(value)
  }

  func resetUser() async throws {
    var value = await load()
    value.userID = nil
    value.attributes = [:]
    value.generation &+= 1
    try await persist(value)
  }

  func resetInstallation() async throws {
    var value = await load()
    value.installationID = UUID().uuidString.lowercased()
    value.userID = nil
    value.attributes = [:]
    value.generation &+= 1
    try await persist(value)
  }

  private func load() async -> Record {
    if let record { return record }
    if let data = try? await persistence.load(),
      let decoded = try? JSONDecoder().decode(Record.self, from: data), decoded.formatVersion == 1,
      !decoded.installationID.isEmpty
    {
      record = decoded
      return decoded
    }
    let created = Record(
      formatVersion: 1, installationID: UUID().uuidString.lowercased(), userID: nil,
      attributes: [:], generation: 0)
    record = created
    try? await persistence.save(JSONEncoder().encode(created))
    return created
  }

  private func persist(_ value: Record) async throws {
    do {
      try await persistence.save(JSONEncoder().encode(value))
      record = value
    } catch { throw MosaicIdentityError.persistenceFailed }
  }

  private static func validate(
    _ attributes: [String: MosaicTypedValue], definitions: [MosaicAttributeDefinition]?
  ) throws {
    guard attributes.count <= 32 else { throw MosaicIdentityError.tooManyAttributes }
    let definitionsByKey = definitions.map {
      Dictionary(uniqueKeysWithValues: $0.map { ($0.key, $0) })
    }
    for (key, value) in attributes {
      guard key.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression) != nil else {
        throw MosaicIdentityError.invalidAttributeKey(key)
      }
      if let definitionsByKey {
        guard let definition = definitionsByKey[key] else {
          throw MosaicIdentityError.unsupportedAttribute(key)
        }
        guard definition.type == value.contractType else {
          throw MosaicIdentityError.attributeTypeMismatch(key)
        }
      }
      switch value {
      case .string(let string):
        guard Data(string.utf8).count <= 256 else {
          throw MosaicIdentityError.attributeValueOutOfBounds(key)
        }
      case .boolean: break
      case .number(let number):
        guard number.isFinite else { throw MosaicIdentityError.attributeValueOutOfBounds(key) }
      case .timestamp(let timestamp):
        guard
          timestamp.range(
            of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
            options: .regularExpression) != nil
        else { throw MosaicIdentityError.attributeValueOutOfBounds(key) }
      case .semanticVersion(let version):
        guard version.count <= 128 else { throw MosaicIdentityError.attributeValueOutOfBounds(key) }
      case .stringList(let list):
        guard (1...16).contains(list.count), Set(list).count == list.count,
          list.allSatisfy({ Data($0.utf8).count <= 128 })
        else { throw MosaicIdentityError.attributeValueOutOfBounds(key) }
      }
    }
    guard let data = try? JSONEncoder().encode(attributes), data.count <= 8_192 else {
      throw MosaicIdentityError.payloadTooLarge
    }
  }
}

extension MosaicTypedValue {
  fileprivate var contractType: String {
    switch self {
    case .string: "string"
    case .boolean: "boolean"
    case .number: "number"
    case .timestamp: "timestamp"
    case .semanticVersion: "semantic_version"
    case .stringList: "string_list"
    }
  }
}

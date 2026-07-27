import Foundation

struct MosaicExperimentAssignmentRecord: Codable, Sendable, Equatable {
  let projectID: String
  let environmentID: String
  let experimentID: String
  let experimentVersionID: String
  let assignmentKeyType: MosaicExperimentAssignmentKeyType
  let subjectDigest: String
  let variantID: String
  let allocationVersion: String
  let bucket: Int
  let algorithm: String
  let source: MosaicExperimentAssignmentSource
  let assignedAt: Date
  let groupID: String?
  let groupVersionID: String?
  let groupBucket: Int?
  var exposed: Bool
  var completedAt: Date?
}

protocol MosaicExperimentAssignmentPersistence: Sendable {
  func load() async throws -> [MosaicExperimentAssignmentRecord]
  func save(_ records: [MosaicExperimentAssignmentRecord]) async throws
}

actor MosaicExperimentFilePersistence: MosaicExperimentAssignmentPersistence {
  private let directory: URL
  private let fileURL: URL
  private let fileManager: FileManager

  init(
    baseURL: URL, publicSDKKey: String, rootDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) throws {
    guard
      let root = rootDirectory
        ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    else {
      throw CocoaError(.fileNoSuchFile)
    }
    directory = root.appendingPathComponent("MosaicSDK", isDirectory: true)
      .appendingPathComponent("experiment-assignments-v1", isDirectory: true)
    let namespace = MosaicExperimentAssignmentEngine.digest(
      baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "\n"
        + publicSDKKey
    )
    .replacingOccurrences(of: "sha256:", with: "")
    fileURL = directory.appendingPathComponent(namespace + ".json")
    self.fileManager = fileManager
  }

  func load() throws -> [MosaicExperimentAssignmentRecord] {
    guard fileManager.fileExists(atPath: fileURL.path) else { return [] }
    return try JSONDecoder().decode(
      [MosaicExperimentAssignmentRecord].self,
      from: Data(contentsOf: fileURL, options: .mappedIfSafe))
  }

  func save(_ records: [MosaicExperimentAssignmentRecord]) throws {
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    var directoryValues = URLResourceValues()
    directoryValues.isExcludedFromBackup = true
    var mutableDirectory = directory
    try? mutableDirectory.setResourceValues(directoryValues)
    try JSONEncoder().encode(records).write(to: fileURL, options: .atomic)
    var mutableFile = fileURL
    try? mutableFile.setResourceValues(directoryValues)
  }
}

actor MosaicExperimentMemoryPersistence: MosaicExperimentAssignmentPersistence {
  private var records: [MosaicExperimentAssignmentRecord]
  init(records: [MosaicExperimentAssignmentRecord] = []) { self.records = records }
  func load() -> [MosaicExperimentAssignmentRecord] { records }
  func save(_ records: [MosaicExperimentAssignmentRecord]) { self.records = records }
}

actor MosaicExperimentAssignmentStoreRegistry {
  static let shared = MosaicExperimentAssignmentStoreRegistry()
  private var stores: [String: MosaicExperimentAssignmentStore] = [:]

  func store(
    baseURL: URL, publicSDKKey: String, rootDirectory: URL? = nil
  ) throws -> MosaicExperimentAssignmentStore {
    let namespace =
      baseURL.absoluteString.trimmingCharacters(
        in: CharacterSet(charactersIn: "/")) + "\n" + publicSDKKey
    if let existing = stores[namespace] { return existing }
    let store = MosaicExperimentAssignmentStore(
      persistence: try MosaicExperimentFilePersistence(
        baseURL: baseURL, publicSDKKey: publicSDKKey,
        rootDirectory: rootDirectory))
    stores[namespace] = store
    return store
  }
}

actor MosaicExperimentAssignmentStore {
  static let maximumRecords = 256
  static let completedRetention: TimeInterval = 180 * 24 * 60 * 60
  private let persistence: any MosaicExperimentAssignmentPersistence
  private var records: [MosaicExperimentAssignmentRecord]?
  private var loadingTask: Task<[MosaicExperimentAssignmentRecord], Never>?

  init(persistence: any MosaicExperimentAssignmentPersistence) { self.persistence = persistence }

  func record(_ selection: MosaicExperimentSelection, at now: Date) async {
    guard !selection.excludedFromResults else { return }
    var values = await load()
    let assignment = selection.assignment
    let keyMatches: (MosaicExperimentAssignmentRecord) -> Bool = {
      $0.projectID == assignment.projectId && $0.environmentID == assignment.environmentId
        && $0.experimentVersionID == assignment.experimentVersionId
        && $0.assignmentKeyType == selection.keyType && $0.subjectDigest == selection.subjectDigest
    }
    if !values.contains(where: keyMatches) {
      values.append(
        .init(
          projectID: assignment.projectId, environmentID: assignment.environmentId,
          experimentID: assignment.experimentId,
          experimentVersionID: assignment.experimentVersionId,
          assignmentKeyType: selection.keyType, subjectDigest: selection.subjectDigest,
          variantID: selection.variant.id, allocationVersion: assignment.allocationVersion,
          bucket: selection.bucket, algorithm: assignment.bucketingAlgorithm,
          source: selection.source, assignedAt: now,
          groupID: assignment.mutualExclusionGroup?.id,
          groupVersionID: assignment.mutualExclusionGroup?.versionId,
          groupBucket: selection.groupBucket, exposed: false, completedAt: nil))
    }
    prune(&values, now: now)
    await save(values)
  }

  func markExposed(_ selection: MosaicExperimentSelection, at now: Date) async {
    var values = await load()
    if let index = values.firstIndex(where: {
      $0.experimentVersionID == selection.assignment.experimentVersionId
        && $0.assignmentKeyType == selection.keyType && $0.subjectDigest == selection.subjectDigest
    }) {
      values[index].exposed = true
    }
    prune(&values, now: now)
    await save(values)
  }

  func reconcile(
    assignments: [MosaicExperimentAssignment], trustedTime: Date?, recordedAt now: Date
  ) async {
    var values = await load()
    let current = Dictionary(uniqueKeysWithValues: assignments.map { ($0.experimentVersionId, $0) })
    for index in values.indices where values[index].completedAt == nil {
      guard let assignment = current[values[index].experimentVersionID] else {
        values[index].completedAt = now
        continue
      }
      let lifecycleEnded = assignment.lifecycle == .stopped || assignment.lifecycle == .completed
      let scheduleEnded =
        trustedTime.flatMap { trustedNow in
          assignment.schedule.endsAt
            .flatMap(MosaicExperimentAssignmentDecoder.timestamp)
            .map { trustedNow >= $0 }
        } ?? false
      if lifecycleEnded || scheduleEnded { values[index].completedAt = now }
    }
    prune(&values, now: now)
    await save(values)
  }

  func clearUserBound() async { await clear(type: .identifiedUser) }
  func clearInstallationBound() async { await clear(type: .installation) }

  func diagnostics() async -> (count: Int, exposed: Int) {
    let values = await load()
    return (values.count, values.filter(\.exposed).count)
  }

  private func clear(type: MosaicExperimentAssignmentKeyType) async {
    var values = await load()
    values.removeAll { $0.assignmentKeyType == type }
    await save(values)
  }

  private func load() async -> [MosaicExperimentAssignmentRecord] {
    if let records { return records }
    let task: Task<[MosaicExperimentAssignmentRecord], Never>
    if let loadingTask {
      task = loadingTask
    } else {
      let persistence = self.persistence
      task = Task { (try? await persistence.load()) ?? [] }
      loadingTask = task
    }
    let loaded = await task.value
    if records == nil { records = loaded }
    loadingTask = nil
    return records ?? loaded
  }

  private func save(_ values: [MosaicExperimentAssignmentRecord]) async {
    records = values
    try? await persistence.save(values)
  }

  private func prune(_ values: inout [MosaicExperimentAssignmentRecord], now: Date) {
    values.removeAll { record in
      record.completedAt.map { now.timeIntervalSince($0) > Self.completedRetention } ?? false
    }
    if values.count > Self.maximumRecords {
      values.sort { $0.assignedAt < $1.assignedAt }
      values.removeFirst(values.count - Self.maximumRecords)
    }
  }
}

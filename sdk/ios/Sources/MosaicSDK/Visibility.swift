import Foundation

/// The runtime selection state a `visibility` condition is evaluated against.
///
/// `0.3` adds `tabs` alongside `switches`. Both maps are complete for an
/// accepted document: the renderer seeds every declared Switch and every
/// declared Tabs component when a revision is accepted, so a condition can only
/// name a controller the state does not carry if the caller assembled the state
/// itself and got it wrong.
public struct MosaicSelectionState: Sendable, Equatable {
  /// Switch component id to its current value.
  public var switches: [String: Bool]
  /// Tabs component id to its currently selected tab id.
  public var tabs: [String: String]

  public init(switches: [String: Bool] = [:], tabs: [String: String] = [:]) {
    self.switches = switches
    self.tabs = tabs
  }
}

/// A `visibility` condition naming a controller the supplied selection state
/// does not carry.
///
/// This is a caller defect, not a document state. Resolving it to "hidden"
/// would read back as a component that silently disappears rather than a caller
/// that is told it has a bug, so evaluation fails instead of answering.
public enum MosaicVisibilityEvaluationError: Error, Sendable, Equatable {
  case unknownSwitch(String)
  case unknownTabs(String)

  public var diagnosticCode: String {
    switch self {
    case .unknownSwitch: "visibility_unknown_switch"
    case .unknownTabs: "visibility_unknown_tabs"
    }
  }

  public var controllerID: String {
    switch self {
    case .unknownSwitch(let id), .unknownTabs(let id): id
    }
  }
}

/// Evaluates one authored `visibility` against runtime selection state.
///
/// This is the single definition of visibility for the SDK: the renderer, the
/// accessibility projection, and the purchase-target reachability check all
/// resolve through it, so none of them can disagree about whether a node is on
/// screen.
public func mosaicEvaluateVisibility(
  _ visibility: MosaicVisibility,
  in state: MosaicSelectionState
) throws -> Bool {
  switch visibility {
  case .always:
    return true
  case .hidden:
    return false
  case .switchValue(let switchID, let equals):
    guard let value = state.switches[switchID] else {
      throw MosaicVisibilityEvaluationError.unknownSwitch(switchID)
    }
    return value == equals
  case .tabValue(let tabsID, let equals):
    guard let selected = state.tabs[tabsID] else {
      throw MosaicVisibilityEvaluationError.unknownTabs(tabsID)
    }
    return selected == equals
  }
}

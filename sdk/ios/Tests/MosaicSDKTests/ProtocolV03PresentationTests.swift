import Foundation
import XCTest

@testable import MosaicSDK

/// Coverage for the four components Protocol `0.3` adds, the tab selection
/// state they introduce, and the rejection rules that keep their absent values
/// from being read as defaults.
@MainActor
final class ProtocolV03PresentationTests: XCTestCase {

  // MARK: Decoding

  /// The canonical fixture is the contract. Asserting the edge shapes it was
  /// built to carry — a non-first initial tab, all three marker kinds, an
  /// entry with and without a description, both connector styles, both emblem
  /// arms, and half-step/whole-step/unrated ratings — is what proves the
  /// decoder reads the authored value rather than a shape that happens to be
  /// first in each union.
  func testCanonicalFixtureDecodesEveryNewComponentAndItsEdgeShapes() throws {
    let document = try v03Document()

    let tabs = try XCTUnwrap(document.tabsComponents.first)
    XCTAssertEqual(tabs.id, "billing-tabs")
    XCTAssertEqual(
      tabs.tabs.map(\.id),
      ["billing-tabs-monthly", "billing-tabs-annual", "billing-tabs-lifetime"]
    )
    // Deliberately not the first tab: a positional default would render this
    // fixture identically and hide the defect.
    XCTAssertEqual(tabs.initialTabId, "billing-tabs-annual")
    XCTAssertNotEqual(tabs.initialTabId, tabs.tabs[0].id)
    XCTAssertEqual(tabs.selectedLabelColor, .semantic(.actionOnPrimary))
    XCTAssertEqual(tabs.tabBarDirection, .horizontal)
    XCTAssertEqual(tabs.tabBarDistribution, .spaceBetween)
    // Tabs resolves Default/Selected through the same overlay Product Card
    // uses, so an unstated Selected leaf keeps the Default value.
    let selectedStyle = tabs.styles.resolving(selected: true)
    XCTAssertEqual(selectedStyle.background, .color(.semantic(.actionPrimary)))
    XCTAssertEqual(selectedStyle.cornerRadius, tabs.styles.defaultStyle.cornerRadius)
    XCTAssertEqual(selectedStyle.padding, tabs.styles.defaultStyle.padding)

    let timelines = document.allNodes.compactMap { node -> MosaicTimelineComponent? in
      guard case .timeline(let value) = node else { return nil }
      return value
    }
    XCTAssertEqual(timelines.map(\.id), ["trial-timeline", "support-timeline"])
    let trial = try XCTUnwrap(timelines.first)
    XCTAssertEqual(trial.orientation, .vertical)
    XCTAssertEqual(trial.connector.style, .solid)
    XCTAssertEqual(trial.entries.map(\.marker), [.dot, .ordinal, .icon(name: .lock)])
    // An absent description is an entry with a title and nothing else.
    XCTAssertEqual(trial.entries.map { $0.description != nil }, [true, true, false])
    XCTAssertNotNil(trial.markerColor)
    XCTAssertNotNil(trial.markerSize)
    XCTAssertNotNil(trial.descriptionTypography)

    let support = try XCTUnwrap(timelines.last)
    XCTAssertEqual(support.connector.style, .dashed)
    // No entry declares a marker or a description, so the styles that would
    // read them are forbidden rather than defaulted.
    XCTAssertEqual(support.entries.map(\.marker), [nil, nil])
    XCTAssertNil(support.markerColor)
    XCTAssertNil(support.markerSize)
    XCTAssertNil(support.descriptionTypography)

    let awards = document.allNodes.compactMap { node -> MosaicAwardComponent? in
      guard case .award(let value) = node else { return nil }
      return value
    }
    XCTAssertEqual(awards.map(\.id), ["editor-award", "press-award"])
    XCTAssertEqual(
      awards[0].emblem, .icon(name: .checkmark, size: 28, color: .semantic(.actionPrimary)))
    XCTAssertNotNil(awards[0].subtitle)
    XCTAssertNotNil(awards[0].subtitleTypography)
    XCTAssertEqual(awards[1].emblem, .image(assetId: "award-emblem", size: 48))
    // Absent means the award has a title and nothing else.
    XCTAssertNil(awards[1].subtitle)
    XCTAssertNil(awards[1].subtitleTypography)

    let proofs = document.allNodes.compactMap { node -> MosaicSocialProofComponent? in
      guard case .socialProof(let value) = node else { return nil }
      return value
    }
    XCTAssertEqual(proofs.map(\.id), ["rated-review", "whole-review", "analyst-note"])
    let rated = try XCTUnwrap(proofs[0].rating)
    XCTAssertEqual(rated.step, .half)
    XCTAssertEqual(rated.value, 9)
    XCTAssertEqual(rated.maximum, 5)
    XCTAssertEqual(proofs[0].avatar?.assetId, "reviewer-avatar")
    XCTAssertEqual(proofs[1].rating?.step, .whole)
    XCTAssertEqual(proofs[1].rating?.value, 5)
    XCTAssertNil(proofs[1].avatar)
    // Absent is neither a zero rating nor an unknown one.
    XCTAssertNil(proofs[2].rating)

    guard case .text(let conditional) = document.allNodes.first(where: { $0.id == "annual-note" })
    else { return XCTFail("Expected the tab-conditional note.") }
    XCTAssertEqual(
      conditional.visibility,
      .tabValue(tabsId: "billing-tabs", equals: "billing-tabs-annual")
    )

    XCTAssertTrue(
      Set(document.compatibility.requiredCapabilities.map(\.name)).isSuperset(of: [
        .tabs, .timeline, .award, .socialProof, .tabVisibility,
      ])
    )
  }

  // MARK: Runtime tab state

  func testTabSelectionSeedsFromInitialTabIdAndDrivesConditionalVisibility() async throws {
    let document = try v03Document()
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      onResult: { _ in }
    )

    XCTAssertEqual(model.selectedTabID(for: "billing-tabs"), "billing-tabs-annual")
    XCTAssertEqual(model.selectionState.tabs, ["billing-tabs": "billing-tabs-annual"])
    XCTAssertTrue(model.isNodeVisible("annual-note"))
    // The unselected panels are removed from layout, not merely hidden.
    XCTAssertFalse(model.isNodeVisible("billing-tabs-monthly-body"))
    XCTAssertTrue(model.isNodeVisible("billing-tabs-annual-body"))

    model.selectTab("billing-tabs-monthly", in: "billing-tabs")
    XCTAssertFalse(model.isNodeVisible("annual-note"))
    XCTAssertTrue(model.isNodeVisible("billing-tabs-monthly-body"))
    XCTAssertFalse(model.isNodeVisible("billing-tabs-annual-body"))

    // An undeclared tab id is not a selection, so it cannot silently blank the
    // component.
    model.selectTab("billing-tabs-quarterly", in: "billing-tabs")
    XCTAssertEqual(model.selectedTabID(for: "billing-tabs"), "billing-tabs-monthly")
  }

  // MARK: Visibility evaluation

  /// A condition naming a controller the state does not carry is a caller
  /// defect. Answering "hidden" would erase an authored node and report
  /// nothing, so evaluation fails instead of answering.
  func testVisibilityEvaluationFailsWhenSelectionStateOmitsTheNamedController() throws {
    let complete = MosaicSelectionState(
      switches: ["annual-switch": true],
      tabs: ["billing-tabs": "billing-tabs-annual"]
    )
    XCTAssertEqual(
      try mosaicEvaluateVisibility(
        .tabValue(tabsId: "billing-tabs", equals: "billing-tabs-annual"), in: complete),
      true
    )
    XCTAssertEqual(
      try mosaicEvaluateVisibility(
        .tabValue(tabsId: "billing-tabs", equals: "billing-tabs-monthly"), in: complete),
      false
    )
    XCTAssertEqual(
      try mosaicEvaluateVisibility(
        .switchValue(switchId: "annual-switch", equals: true), in: complete),
      true
    )

    XCTAssertThrowsError(
      try mosaicEvaluateVisibility(
        .tabValue(tabsId: "absent-tabs", equals: "billing-tabs-annual"),
        in: complete
      )
    ) { error in
      XCTAssertEqual(
        error as? MosaicVisibilityEvaluationError, .unknownTabs("absent-tabs"))
    }
    XCTAssertThrowsError(
      try mosaicEvaluateVisibility(
        .switchValue(switchId: "absent-switch", equals: true),
        in: MosaicSelectionState()
      )
    ) { error in
      XCTAssertEqual(
        error as? MosaicVisibilityEvaluationError, .unknownSwitch("absent-switch"))
    }
    // Unconditional visibility never consults the state, so it cannot fail.
    XCTAssertEqual(try mosaicEvaluateVisibility(.always, in: MosaicSelectionState()), true)
    XCTAssertEqual(try mosaicEvaluateVisibility(.hidden, in: MosaicSelectionState()), false)
  }

  // MARK: Rejection rules

  func testTabVisibilityRulesRejectUnknownSelfAndDescendantReferences() throws {
    XCTAssertThrowsError(
      try MosaicProtocolDecoder.decode(
        v03FixtureData(named: "invalid/unknown-tab-visibility.json"))
    ) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_unknown_visibility_tab")
      )
    }

    // A node inside a panel comparing against its own Tabs component is either
    // vacuously true or unsatisfiable, and both are dead layout.
    var descendant = try v03FixtureObject()
    try mutateV03Node(id: "billing-tabs-annual-body", in: &descendant) { node in
      node["visibility"] = [
        "mode": "tab", "tabsId": "billing-tabs", "equals": "billing-tabs-annual",
      ]
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(descendant))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_tab_visibility_inside_referenced_tabs")
      )
    }

    var selfReference = try v03FixtureObject()
    try mutateV03Node(id: "billing-tabs", in: &selfReference) { node in
      node["visibility"] = [
        "mode": "tab", "tabsId": "billing-tabs", "equals": "billing-tabs-annual",
      ]
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(selfReference))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_self_visibility_tabs")
      )
    }

    // A Tabs component on another screen is not in scope.
    var otherScreen = try v03FixtureObject()
    try mutateV03Node(id: "support-timeline", in: &otherScreen) { node in
      node["visibility"] = [
        "mode": "tab", "tabsId": "billing-tabs", "equals": "billing-tabs-annual",
      ]
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(otherScreen))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_unknown_visibility_tabs")
      )
    }
  }

  func testTabsRejectAnInitialTabIdNoTabDeclares() throws {
    var object = try v03FixtureObject()
    try mutateV03Node(id: "billing-tabs", in: &object) { node in
      node["initialTabId"] = "billing-tabs-quarterly"
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_unknown_initial_tab")
      )
    }

    // Required, so an absent value is a rejected document rather than the first
    // tab.
    var missing = try v03FixtureObject()
    try mutateV03Node(id: "billing-tabs", in: &missing) { node in
      node.removeValue(forKey: "initialTabId")
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(missing)))
  }

  /// `value` counts steps, so the bound is points multiplied by steps per
  /// point. Both directions of the boundary are pinned: an off-by-one on either
  /// side would otherwise pass.
  func testSocialProofRatingBoundRejectsValueAboveMaximumSteps() throws {
    XCTAssertThrowsError(
      try MosaicProtocolDecoder.decode(
        v03FixtureData(named: "invalid/social-proof-overrated.json"))
    ) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_social_proof_rating_exceeds_maximum")
      )
    }

    // maximum 5, step half: 10 steps is the exact bound and 11 is over it.
    var atBound = try v03FixtureObject()
    try mutateV03Node(id: "rated-review", in: &atBound) { node in
      var rating = node["rating"] as? [String: Any] ?? [:]
      rating["value"] = 10
      node["rating"] = rating
    }
    XCTAssertNoThrow(try MosaicProtocolDecoder.decode(encoded(atBound)))

    var overBound = try v03FixtureObject()
    try mutateV03Node(id: "rated-review", in: &overBound) { node in
      var rating = node["rating"] as? [String: Any] ?? [:]
      rating["value"] = 11
      node["rating"] = rating
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(overBound))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_social_proof_rating_exceeds_maximum")
      )
    }

    // Integers only: a fractional value must not be rounded into a valid one.
    var fractional = try v03FixtureObject()
    try mutateV03Node(id: "rated-review", in: &fractional) { node in
      var rating = node["rating"] as? [String: Any] ?? [:]
      rating["value"] = 4.5
      node["rating"] = rating
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(fractional)))
  }

  /// Both directions are enforced: a style nothing reads is how a stale field
  /// survives a redesign, and a missing style where a marker exists would leave
  /// the renderer choosing a colour.
  func testTimelineMarkerAndDescriptionStylesAreRejectedInBothDirections() throws {
    XCTAssertThrowsError(
      try MosaicProtocolDecoder.decode(
        v03FixtureData(named: "invalid/timeline-unused-marker-style.json"))
    ) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_timeline_marker_style_mismatch")
      )
    }

    var missingMarkerStyle = try v03FixtureObject()
    try mutateV03Node(id: "trial-timeline", in: &missingMarkerStyle) { node in
      node.removeValue(forKey: "markerColor")
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(missingMarkerStyle))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_timeline_marker_style_mismatch")
      )
    }

    var unusedDescriptionTypography = try v03FixtureObject()
    try mutateV03Node(id: "support-timeline", in: &unusedDescriptionTypography) { node in
      node["descriptionTypography"] = [
        "style": "caption", "fontSize": 13, "lineHeightMultiplier": 1.4,
        "weight": "regular", "color": "text.secondary", "alignment": "start",
      ]
    }
    XCTAssertThrowsError(
      try MosaicProtocolDecoder.decode(encoded(unusedDescriptionTypography))
    ) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_timeline_description_typography_mismatch")
      )
    }

    // An unrecognised marker kind rejects the document; there is no substitute
    // glyph.
    var unknownMarker = try v03FixtureObject()
    try mutateV03Node(id: "trial-today", in: &unknownMarker) { node in
      node["marker"] = ["kind": "diamond"]
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(unknownMarker)))
  }

  func testAwardSubtitleAndTypographyMustAppearTogether() throws {
    var object = try v03FixtureObject()
    try mutateV03Node(id: "editor-award", in: &object) { node in
      node.removeValue(forKey: "subtitleTypography")
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object)))

    var typographyOnly = try v03FixtureObject()
    try mutateV03Node(id: "press-award", in: &typographyOnly) { node in
      node["subtitleTypography"] = [
        "style": "caption", "fontSize": 13, "lineHeightMultiplier": 1.4,
        "weight": "regular", "color": "text.secondary", "alignment": "start",
      ]
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(typographyOnly)))
  }

  /// Tabs owns runtime state, so it is interactive for the same reason Switch
  /// and Carousel are and cannot sit inside a Button or a Product Card.
  func testTabsIsRejectedInsideInteractionAndProductCardContexts() throws {
    let tabsNode = try tabsFixtureNode()

    var insideButton = try v03FixtureObject()
    try mutateV03Node(id: "purchase", in: &insideButton) { node in
      var children = node["children"] as? [[String: Any]] ?? []
      children.append(tabsNode)
      node["children"] = children
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(insideButton)))

    var insideCard = try v03FixtureObject()
    try mutateV03Node(id: "plans-yearly-plan-card", in: &insideCard) { node in
      var children = node["children"] as? [[String: Any]] ?? []
      children.append(tabsNode)
      node["children"] = children
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(insideCard)))
  }

  // MARK: Rating arithmetic

  /// Integer arithmetic end to end. A floating-point intermediate here is how
  /// four runtimes end up drawing different numbers of stars.
  func testRatingStepsAreIntegerAndBounded() {
    let half = MosaicSocialProofRating(
      symbol: .star, value: 9, maximum: 5, step: .half, size: 16,
      filledColor: .semantic(.actionPrimary), emptyColor: .semantic(.borderDefault))
    XCTAssertEqual(half.maximumSteps, 10)
    XCTAssertEqual((0..<5).map(half.steps(atSymbol:)), [2, 2, 2, 2, 1])

    let whole = MosaicSocialProofRating(
      symbol: .star, value: 3, maximum: 5, step: .whole, size: 16,
      filledColor: .semantic(.actionPrimary), emptyColor: .semantic(.borderDefault))
    XCTAssertEqual(whole.maximumSteps, 5)
    XCTAssertEqual((0..<5).map(whole.steps(atSymbol:)), [1, 1, 1, 0, 0])

    let none = MosaicSocialProofRating(
      symbol: .star, value: 0, maximum: 3, step: .half, size: 16,
      filledColor: .semantic(.actionPrimary), emptyColor: .semantic(.borderDefault))
    XCTAssertEqual((0..<3).map(none.steps(atSymbol:)), [0, 0, 0])
  }

  /// The shared cross-SDK rating-announcement vectors.
  ///
  /// Read from `protocol/fixtures/v0.3/rating-announcement.json` rather than
  /// copied here, because the point of the corpus is that Flutter, Compose, and
  /// SwiftUI produce the same bytes; values transcribed into this file could
  /// drift from the ones the other two assert against. The case-count floor
  /// keeps a truncated corpus from passing over cases it never saw.
  func testRatingAnnouncementMatchesEveryCanonicalConformanceVector() throws {
    let root = try JSONSerialization.jsonObject(
      with: phase5FixtureData("v0.3/rating-announcement.json")
    )
    let object = try XCTUnwrap(root as? [String: Any])
    XCTAssertEqual(
      try XCTUnwrap(object["placeholders"] as? [String]),
      MosaicReservedAccessibilityKey.rating.placeholders
    )
    let cases = try XCTUnwrap(object["cases"] as? [[String: Any]])
    XCTAssertEqual(
      cases.count, 10,
      "protocol/fixtures/v0.3/rating-announcement.json declares 10 vectors. "
        + "Shrinking the corpus has to be a deliberate edit, not a silent pass."
    )
    XCTAssertEqual(Set(cases.compactMap { $0["id"] as? String }).count, cases.count)

    for vector in cases {
      let id = try XCTUnwrap(vector["id"] as? String)
      let rating = try JSONDecoder().decode(
        MosaicSocialProofRating.self,
        from: JSONSerialization.data(withJSONObject: try XCTUnwrap(vector["rating"]))
      )
      // The points conversion is locale-independent by contract: ASCII digits,
      // `.` as the decimal separator, and a fraction digit only for a half step.
      XCTAssertEqual(
        MosaicSocialProofRatingAnnouncement.points(rating),
        try XCTUnwrap(vector["points"] as? String),
        id
      )
      XCTAssertEqual(
        MosaicSocialProofRatingAnnouncement.maximumPoints(rating),
        try XCTUnwrap(vector["maximumPoints"] as? String),
        id
      )
      XCTAssertEqual(
        MosaicSocialProofRatingAnnouncement.text(
          for: rating, template: try XCTUnwrap(vector["template"] as? String)),
        try XCTUnwrap(vector["expectedAnnouncement"] as? String),
        id
      )
    }
  }

  /// A template the catalog cannot supply, or one missing a placeholder, must
  /// announce nothing. Composing an English phrase instead is the defect the
  /// reserved keys exist to prevent.
  func testRatingAnnouncementRefusesAnUnusableTemplate() {
    let rating = MosaicSocialProofRating(
      symbol: .star, value: 9, maximum: 5, step: .half, size: 16,
      filledColor: .semantic(.actionPrimary), emptyColor: .semantic(.borderDefault))
    XCTAssertNil(MosaicSocialProofRatingAnnouncement.text(for: rating, template: nil))
    XCTAssertNil(
      MosaicSocialProofRatingAnnouncement.text(
        for: rating, template: "{{ rating.value }} stars"))
    XCTAssertNil(
      MosaicSocialProofRatingAnnouncement.text(
        for: rating, template: "out of {{ rating.maximum }} stars"))
  }

  // MARK: Reserved accessibility strings

  /// Presence is enforced in both directions, and every declared translation
  /// must carry each placeholder exactly once.
  ///
  /// A renderer must never compose an accessibility phrase from a string
  /// literal in any language, so these keys are the only way the phrasing gets
  /// authored and translated. A missing key would force the renderer to invent
  /// one; a lingering key is a value nothing reads.
  func testReservedAccessibilityKeysAreRequiredAndForbiddenInBothDirections() throws {
    // The canonical fixture declares both keys, so it contains a rated Social
    // Proof and a Button with in-progress content.
    XCTAssertTrue(
      Set(try v03Document().compatibility.requiredCapabilities.map(\.name))
        .contains(.reservedStrings)
    )

    for key in MosaicReservedAccessibilityKey.allCases {
      var missing = try v03FixtureObject()
      removeLocalizationKey(key.rawValue, in: &missing)
      XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(missing)), key.rawValue) {
        error in
        XCTAssertEqual(
          error as? MosaicProtocolError,
          .semanticViolation(code: "protocol_missing_reserved_accessibility_key")
        )
      }
    }

    // Declared but consumed by nothing: dropping every rating leaves the key
    // with no reader.
    var unusedRating = try v03FixtureObject()
    for id in ["rated-review", "whole-review"] {
      try mutateV03Node(id: id, in: &unusedRating) { node in
        node.removeValue(forKey: "rating")
      }
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(unusedRating))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_unused_reserved_accessibility_key")
      )
    }

    // A translation that drops a placeholder silently announces a rating with
    // no number in it.
    var droppedPlaceholder = try v03FixtureObject()
    setLocalizationKey(
      "mosaic.a11y.rating", to: "{{ rating.value }} stars", locale: "de",
      in: &droppedPlaceholder)
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(droppedPlaceholder))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_invalid_reserved_accessibility_placeholder")
      )
    }

    // Repeating one announces the number twice.
    var repeatedPlaceholder = try v03FixtureObject()
    setLocalizationKey(
      "mosaic.a11y.rating",
      to: "{{ rating.value }} of {{ rating.value }} out of {{ rating.maximum }}",
      locale: "en", in: &repeatedPlaceholder)
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(repeatedPlaceholder)))

    // Substitution is closed to the two reserved placeholders; the product
    // template vocabulary is not valid here.
    var foreignExpression = try v03FixtureObject()
    setLocalizationKey(
      "mosaic.a11y.rating",
      to: "{{ rating.value }} out of {{ rating.maximum }} for {{ product.name }}",
      locale: "en", in: &foreignExpression)
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(foreignExpression))) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_invalid_reserved_accessibility_template")
      )
    }
  }

  private func removeLocalizationKey(_ key: String, in object: inout [String: Any]) {
    guard var localization = object["localization"] as? [String: Any],
      var locales = localization["locales"] as? [String: Any]
    else { return }
    for locale in locales.keys {
      guard var catalog = locales[locale] as? [String: Any],
        var strings = catalog["strings"] as? [String: Any]
      else { continue }
      strings.removeValue(forKey: key)
      catalog["strings"] = strings
      locales[locale] = catalog
    }
    localization["locales"] = locales
    object["localization"] = localization
  }

  private func setLocalizationKey(
    _ key: String, to value: String, locale: String, in object: inout [String: Any]
  ) {
    guard var localization = object["localization"] as? [String: Any],
      var locales = localization["locales"] as? [String: Any],
      var catalog = locales[locale] as? [String: Any],
      var strings = catalog["strings"] as? [String: Any]
    else { return }
    strings[key] = value
    catalog["strings"] = strings
    locales[locale] = catalog
    localization["locales"] = locales
    object["localization"] = localization
  }

  // MARK: Accessibility

  func testAccessibilityProjectionExposesTabAndTimelineSemantics() async throws {
    let document = try v03Document()
    let model = MosaicPaywallModel(
      document: document,
      requestedLocale: "en",
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      onResult: { _ in }
    )
    await model.prepare()
    var elements = model.accessibilityProjection().elements

    XCTAssertEqual(elements.first { $0.id == "billing-tabs" }?.role, .tabList)
    XCTAssertEqual(
      elements.first { $0.id == "billing-tabs" }?.label, "Compare billing periods")
    XCTAssertEqual(elements.first { $0.id == "billing-tabs" }?.value, "Annual")
    XCTAssertEqual(
      elements.filter { $0.role == .tab }.map(\.label), ["Monthly", "Annual", "Lifetime"])
    XCTAssertEqual(
      elements.filter { $0.role == .tab }.map(\.isSelected), [false, true, false])
    // The panel is named by the same label as its tab: one authored string, so
    // a second cannot drift from it.
    let panel = try XCTUnwrap(elements.first { $0.role == .tabPanel })
    XCTAssertEqual(panel.id, "billing-tabs-annual")
    XCTAssertEqual(panel.label, "Annual")
    XCTAssertEqual(elements.filter { $0.role == .tabPanel }.count, 1)

    XCTAssertEqual(elements.first { $0.id == "trial-timeline" }?.role, .list)
    XCTAssertEqual(
      elements.first { $0.id == "trial-timeline" }?.label, "How your free trial works")
    // Title and description are separate elements; segments are never joined.
    XCTAssertEqual(
      elements.filter { $0.role == .listItem }.map(\.label),
      [
        "Today", "Full access starts immediately and nothing is charged.",
        "Day 5", "We email a reminder two days before the trial ends.",
        // The undescribed entry produces one element, not an empty second one.
        "Day 7",
      ]
    )

    // Announced through the authored, translated `mosaic.a11y.rating` template
    // with the rating converted from steps to points: the spec's literal
    // "value out of maximum" would say "9 out of 5" for a four-and-a-half star
    // review, and an English phrase composed in the SDK would be read verbatim
    // to a VoiceOver user in every other locale.
    let rated = try XCTUnwrap(elements.first { $0.id == "rated-review" })
    XCTAssertEqual(rated.label, "Customer review")
    XCTAssertNil(rated.value, "Segments are separate elements, not a joined container value.")
    XCTAssertEqual(
      elements.first { $0.id == "rated-review.rating" }?.label, "4.5 out of 5 stars")
    XCTAssertEqual(
      elements.first { $0.id == "rated-review.quote" }?.label,
      "Mosaic replaced three internal tools and a month of paywall work."
    )
    XCTAssertEqual(
      elements.first { $0.id == "rated-review.attribution" }?.label, "Priya N., mobile lead")
    // An absent rating produces no element at all.
    XCTAssertNotNil(elements.first { $0.id == "analyst-note" })
    XCTAssertNil(elements.first { $0.id == "analyst-note.rating" })

    // The emblem is decorative, so the award announces its authored text alone.
    XCTAssertEqual(elements.first { $0.id == "editor-award.title" }?.label, "App of the Day")
    XCTAssertEqual(
      elements.first { $0.id == "editor-award.subtitle" }?.label,
      "Selected by the editorial team"
    )
    XCTAssertEqual(elements.first { $0.id == "press-award.title" }?.label, "Editor's Choice")
    // No subtitle authored, so no subtitle element.
    XCTAssertNil(elements.first { $0.id == "press-award.subtitle" })

    // Selecting another tab moves the panel and its contents out of the
    // accessibility tree entirely rather than leaving them focusable.
    model.selectTab("billing-tabs-monthly", in: "billing-tabs")
    elements = model.accessibilityProjection().elements
    XCTAssertEqual(elements.first { $0.role == .tabPanel }?.id, "billing-tabs-monthly")
    XCTAssertNil(elements.first { $0.id == "billing-tabs-annual-body" })
    XCTAssertNil(elements.first { $0.id == "annual-note" })
    XCTAssertNotNil(elements.first { $0.id == "billing-tabs-monthly-body" })
  }

  /// The shared cross-SDK accessibility-announcement vectors.
  ///
  /// Segments are never joined: each is its own element inside the labelled
  /// container, in the recorded order, and the platform supplies any pause or
  /// punctuation. `separator` is null by contract, so a renderer that
  /// concatenates segments into one string cannot match this structure — which
  /// is the point, because a joined string invents script-specific punctuation
  /// and reads identically to a correct one under casual inspection.
  func testAccessibilityAnnouncementsMatchEveryCanonicalConformanceVector() async throws {
    let root = try JSONSerialization.jsonObject(
      with: phase5FixtureData("v0.3/accessibility-announcement.json")
    )
    let object = try XCTUnwrap(root as? [String: Any])
    XCTAssertNil(object["separator"] as? String, "The corpus declares no separator.")
    let cases = try XCTUnwrap(object["cases"] as? [[String: Any]])
    XCTAssertEqual(
      cases.count, 11,
      "protocol/fixtures/v0.3/accessibility-announcement.json declares 11 vectors. "
        + "Shrinking the corpus has to be a deliberate edit, not a silent pass."
    )
    XCTAssertEqual(Set(cases.compactMap { $0["id"] as? String }).count, cases.count)

    let document = try v03Document()
    var projections: [String: [MosaicAccessibilityElement]] = [:]
    for locale in Set(cases.compactMap { $0["locale"] as? String }) {
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: locale,
        purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
        onResult: { _ in }
      )
      await model.prepare()
      // The fixture places one Timeline on the sheet screen, and a projection
      // only covers the screen currently presented.
      var collected = model.accessibilityProjection().elements
      for screen in document.screens where screen.id != document.initialScreenId {
        model.navigate(to: screen.id)
        collected += model.accessibilityProjection().elements
      }
      projections[locale] = collected
    }

    // The in-progress vectors describe the busy state, which only exists while
    // a provider call is outstanding. A suspending provider holds the button
    // there long enough to project it.
    var busyProjections: [String: [MosaicAccessibilityElement]] = [:]
    for (locale, buttonID) in [("en", "purchase"), ("de", "restore")] {
      let gate = SuspendingPurchaseProvider(products: MosaicProduct.phase1MockProducts)
      let model = MosaicPaywallModel(
        document: document,
        requestedLocale: locale,
        purchaseProvider: gate,
        onResult: { _ in }
      )
      await model.prepare()
      let button = try XCTUnwrap(
        document.allNodes.compactMap { node -> MosaicButtonComponent? in
          guard case .button(let value) = node, value.id == buttonID else { return nil }
          return value
        }.first
      )
      let running = Task {
        if button.action == .restore {
          await model.restore(using: button)
        } else {
          await model.purchase(using: button)
        }
      }
      await gate.waitUntilCallStarted()
      busyProjections[buttonID] = model.accessibilityProjection().elements
      await gate.release()
      _ = await running.result
    }

    for vector in cases {
      let id = try XCTUnwrap(vector["id"] as? String)
      let componentID = try XCTUnwrap(vector["componentId"] as? String)
      let locale = try XCTUnwrap(vector["locale"] as? String)
      let container = try XCTUnwrap(vector["container"] as? [String: Any])
      // A recorded container value means the vector describes the busy state.
      let elements =
        container["value"] is String
        ? try XCTUnwrap(busyProjections[componentID])
        : try XCTUnwrap(projections[locale])
      let expected = try XCTUnwrap(vector["elements"] as? [[String: Any]])

      let containerIndex = try XCTUnwrap(
        elements.firstIndex { $0.id == componentID }, "\(id): no container element")
      let actual = elements[containerIndex]
      XCTAssertEqual(actual.label, try XCTUnwrap(container["label"] as? String), id)
      XCTAssertEqual(actual.hint, container["hint"] as? String, id)
      XCTAssertEqual(actual.value, container["value"] as? String, id)

      // The segments are the container's own descendants, in order, and there
      // are exactly as many as the vector records: an absent optional segment
      // produces no element rather than an empty one.
      let segments = elements[(containerIndex + 1)...]
        .prefix { $0.id.hasPrefix("\(componentID).") }
      XCTAssertEqual(segments.count, expected.count, "\(id): segment count")
      for (segment, want) in zip(segments, expected) {
        XCTAssertEqual(segment.label, try XCTUnwrap(want["text"] as? String), id)
        // Byte-exact: nothing joined, nothing appended.
        XCTAssertFalse(segment.label.isEmpty, id)
      }

      // Nothing decorative is announced or focusable.
      for decorative in try XCTUnwrap(vector["decorative"] as? [String]) {
        XCTAssertNil(
          elements.first { $0.id == decorative || $0.id == "\(componentID).\(decorative)" },
          "\(id): \(decorative) must not be announced"
        )
      }
    }
  }

  /// A Button is one element whose name never changes: the progress state
  /// occupies the value slot instead of being composed into the label, so the
  /// leading-versus-trailing question cannot arise.
  func testBusyButtonKeepsItsNameAndAnnouncesProgressInTheValueSlot() async throws {
    let document = try v03Document()
    let model = MosaicPaywallModel(
      document: document,
      requestedLocale: "en",
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      onResult: { _ in }
    )
    await model.prepare()

    let idle = try XCTUnwrap(
      model.accessibilityProjection().elements.first { $0.id == "purchase" })
    XCTAssertEqual(idle.label, "Continue with the selected plan")
    XCTAssertNil(idle.value)
    XCTAssertFalse(idle.isBusy)

    // The Button's children are never announced in either state.
    XCTAssertNil(
      model.accessibilityProjection().elements.first { $0.id == "purchase-label" })
  }

  // MARK: Corpus


  /// Every fixture in the canonical invalid corpus, read from the directory
  /// rather than from a list copied into this file.
  ///
  /// The declared floor and the uniqueness check exist because a corpus that
  /// was truncated, emptied, or renamed out from under the loop is otherwise
  /// indistinguishable from one that passes: reporting success over zero cases
  /// is the defect this guards.
  func testEveryCanonicalInvalidFixtureIsRejected() throws {
    let directory = try v03FixtureURL(named: "invalid").deletingLastPathComponent()
      .appendingPathComponent("invalid")
    let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
      .filter { $0.hasSuffix(".json") && $0 != "rejection-layers.json" }
      .sorted()

    XCTAssertEqual(
      names.count, 12,
      "protocol/fixtures/v0.3/invalid declares 12 rejection fixtures. Shrinking the corpus "
        + "has to be a deliberate edit, not a silently passing loop."
    )
    XCTAssertEqual(Set(names).count, names.count)

    for name in names {
      XCTAssertThrowsError(
        try MosaicProtocolDecoder.decode(Data(contentsOf: directory.appendingPathComponent(name))),
        name
      )
    }
  }

  private func tabsFixtureNode() throws -> [String: Any] {
    var object = try v03FixtureObject()
    var captured: [String: Any]?
    try mutateV03Node(id: "billing-tabs", in: &object) { node in
      var copy = node
      // A distinct id: the global layout ID namespace rejects a duplicate
      // before the placement rule under test can run.
      copy["id"] = "nested-tabs"
      copy.removeValue(forKey: "visibility")
      var tabs = copy["tabs"] as? [[String: Any]] ?? []
      for index in tabs.indices {
        tabs[index]["id"] = "nested-tab-\(index)"
        if var content = tabs[index]["content"] as? [String: Any] {
          content["id"] = "nested-tab-content-\(index)"
          content["children"] = []
          tabs[index]["content"] = content
        }
      }
      copy["tabs"] = tabs
      copy["initialTabId"] = "nested-tab-0"
      captured = copy
    }
    return try XCTUnwrap(captured)
  }
}

/// A provider that parks inside `purchase` and `restore` until released, so a
/// test can observe the busy state a real store call would produce.
private actor SuspendingPurchaseProvider: MosaicPurchaseProvider {
  var mosaicAnalyticsProviderID: String? { "suspending" }
  private let products: [String: MosaicProduct]
  private var started: CheckedContinuation<Void, Never>?
  private var hasStarted = false
  private var gate: CheckedContinuation<Void, Never>?
  private var isReleased = false

  init(products: [MosaicProduct]) {
    self.products = Dictionary(products.map { ($0.id, $0) }, uniquingKeysWith: { _, next in next })
  }

  func loadProducts(identifiers: [String]) async -> MosaicProductLoadResult {
    .loaded(identifiers.compactMap { products[$0] })
  }

  func purchase(productID: String) async -> MosaicPurchaseResult {
    await park()
    return .purchased(productID: productID, transactionID: "suspended-\(productID)")
  }

  func restore() async -> MosaicRestoreResult {
    await park()
    return .nothingToRestore
  }

  func activeEntitlements() async -> MosaicActiveEntitlementsResult { .available([]) }

  func waitUntilCallStarted() async {
    guard !hasStarted else { return }
    await withCheckedContinuation { continuation in
      started = continuation
    }
  }

  func release() {
    isReleased = true
    gate?.resume()
    gate = nil
  }

  private func park() async {
    hasStarted = true
    started?.resume()
    started = nil
    guard !isReleased else { return }
    await withCheckedContinuation { continuation in
      gate = continuation
    }
  }
}

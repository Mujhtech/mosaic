import Foundation

public enum MosaicAccessibilityRole: Sendable, Equatable {
  case text
  case heading(level: Int)
  case image
  case group
  case button
  case productOption
  case switchControl
  /// The Tabs component as a whole.
  case tabList
  /// One tab control, named by its label and carrying its selected state.
  case tab
  /// The visible panel, named by the same label as its tab.
  case tabPanel
  /// A Timeline, exposed as a labelled ordered list.
  case list
  /// One Timeline entry, announcing its title then its description.
  case listItem
}

public struct MosaicAccessibilityElement: Sendable, Equatable, Identifiable {
  public let id: String
  public let role: MosaicAccessibilityRole
  public let label: String
  public let hint: String?
  public let value: String?
  public let isEnabled: Bool
  public let isSelected: Bool
  public let isBusy: Bool

  public init(
    id: String,
    role: MosaicAccessibilityRole,
    label: String,
    hint: String? = nil,
    value: String? = nil,
    isEnabled: Bool = true,
    isSelected: Bool = false,
    isBusy: Bool = false
  ) {
    self.id = id
    self.role = role
    self.label = label
    self.hint = hint
    self.value = value
    self.isEnabled = isEnabled
    self.isSelected = isSelected
    self.isBusy = isBusy
  }
}

public struct MosaicAccessibilityProjection: Sendable, Equatable {
  public let direction: MosaicLayoutDirection
  public let elements: [MosaicAccessibilityElement]
}

extension MosaicPaywallModel {
  /// Testable projection of the semantics applied by `MosaicPaywall`. Hidden
  /// decorative images are omitted and source order is preserved recursively.
  public func accessibilityProjection() -> MosaicAccessibilityProjection {
    var elements: [MosaicAccessibilityElement] = []
    if let screen = currentScreen, let label = screen.accessibilityLabel {
      elements.append(
        MosaicAccessibilityElement(
          id: screen.id,
          role: .group,
          label: localization.resolve(label)
        )
      )
    }
    appendAccessibility(from: currentLayout.content, to: &elements)
    return MosaicAccessibilityProjection(
      direction: localization.resolvedLocale.direction,
      elements: elements
    )
  }

  private func appendAccessibility(
    from stack: MosaicStack,
    to elements: inout [MosaicAccessibilityElement]
  ) {
    guard isVisible(stack.visibility) else { return }
    for node in stack.children {
      guard isVisible(node.visibility) else { continue }
      switch node {
      case .stack(let nested):
        appendAccessibility(from: nested, to: &elements)
      case .text(let component):
        let role =
          component.accessibility.headingLevel.map(MosaicAccessibilityRole.heading)
          ?? .text
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: role,
            label: component.accessibility.label.map(localization.resolve)
              ?? localization.resolve(component.value)
          )
        )
      case .image(let component):
        if case .informative(let label) = component.accessibility {
          elements.append(
            MosaicAccessibilityElement(
              id: component.id,
              role: .image,
              label: localization.resolve(label)
            )
          )
        }
      case .icon(let component):
        if case .informative(let label) = component.accessibility {
          elements.append(
            MosaicAccessibilityElement(
              id: component.id,
              role: .image,
              label: localization.resolve(label)
            )
          )
        }
      case .featureList(let component):
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .group,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve)
          )
        )
        for item in component.items {
          elements.append(
            MosaicAccessibilityElement(
              id: "\(component.id).\(item.id)",
              role: .text,
              label: localization.resolve(item.text)
            )
          )
        }
      case .productSelector(let component):
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .group,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve)
          )
        )
        let options = availableOptions(for: component)
        if options.isEmpty {
          elements.append(
            MosaicAccessibilityElement(
              id: "\(component.id).unavailable",
              role: .text,
              label: localization.resolve(component.unavailableFallback.message),
              isEnabled: false
            )
          )
        } else {
          for option in options {
            if let card = option.card {
              elements.append(
                MosaicAccessibilityElement(
                  id: "\(component.id).\(card.id)",
                  role: .productOption,
                  label: productCardAccessibilityLabel(card, option: option),
                  isSelected: selectedProductCardID(for: component.id) == card.id
                )
              )
              continue
            }
            var valueParts: [String] = []
            if let badge = option.reference.badge {
              valueParts.append(localization.resolve(badge))
            }
            valueParts.append(option.product.localizedPrice)
            if let period = option.product.localizedSubscriptionPeriod {
              valueParts.append(period)
            }
            elements.append(
              MosaicAccessibilityElement(
                id: "\(component.id).\(option.reference.id)",
                role: .productOption,
                label: localization.resolve(option.reference.label),
                value: valueParts.joined(separator: ", "),
                isSelected: selectedProductReferenceID(for: component.id) == option.reference.id
              )
            )
          }
        }
      case .button(let component):
        let busy = isButtonBusy(component.id)
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .button,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve),
            // The authored, translated reserved string. A button with no
            // in-progress content announces no progress state at all rather
            // than a literal this SDK invented.
            value: busy && component.inProgressChildren != nil
              ? localization.resolve(reserved: .inProgress) : nil,
            isEnabled: isButtonEnabled(component),
            isBusy: busy
          )
        )
      case .carousel(let component):
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .group,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve),
            value: localization.resolve(
              component.pages[carouselPageIndex(for: component.id)].accessibilityLabel
            )
          )
        )
        if component.pages.indices.contains(carouselPageIndex(for: component.id)) {
          appendAccessibility(
            from: component.pages[carouselPageIndex(for: component.id)].content,
            to: &elements
          )
        }
      case .switchControl(let component):
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .switchControl,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve),
            value: switchValue(for: component.id) ? "On" : "Off",
            isSelected: switchValue(for: component.id)
          )
        )
      case .countdown(let component):
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: component.accessibility.headingLevel.map(MosaicAccessibilityRole.heading)
              ?? .text,
            label: component.accessibility.label.map(localization.resolve)
              ?? MosaicCountdownText.resolve(
                component: component,
                now: currentDate(),
                completedText: localization.resolve(component.completedText)
              )
          )
        )
      case .tabs(let component):
        appendTabsAccessibility(component, to: &elements)
      case .timeline(let component):
        appendTimelineAccessibility(component, to: &elements)
      case .award(let component):
        // Segments are never joined: each is its own element inside the
        // labelled container, and the platform supplies any pause or
        // punctuation. Joining them would invent script-specific punctuation.
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .group,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve)
          )
        )
        elements.append(
          MosaicAccessibilityElement(
            id: "\(component.id).title",
            role: .text,
            label: localization.resolve(component.title)
          )
        )
        // An absent optional segment produces no element, never an empty one.
        if let subtitle = component.subtitle {
          elements.append(
            MosaicAccessibilityElement(
              id: "\(component.id).subtitle",
              role: .text,
              label: localization.resolve(subtitle)
            )
          )
        }
      case .socialProof(let component):
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .group,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve)
          )
        )
        // Order: rating, then quote, then attribution. The avatar is decorative
        // and is never announced or focusable.
        if let announcement = component.rating.flatMap(ratingAnnouncement) {
          elements.append(
            MosaicAccessibilityElement(
              id: "\(component.id).rating",
              role: .text,
              label: announcement
            )
          )
        }
        elements.append(
          MosaicAccessibilityElement(
            id: "\(component.id).quote",
            role: .text,
            label: localization.resolve(component.quote)
          )
        )
        elements.append(
          MosaicAccessibilityElement(
            id: "\(component.id).attribution",
            role: .text,
            label: localization.resolve(component.attribution)
          )
        )
      }
    }
  }

  private func appendTabsAccessibility(
    _ component: MosaicTabsComponent,
    to elements: inout [MosaicAccessibilityElement]
  ) {
    let selected = selectedTabID(for: component.id)
    elements.append(
      MosaicAccessibilityElement(
        id: component.id,
        role: .tabList,
        label: localization.resolve(component.accessibility.label),
        hint: component.accessibility.hint.map(localization.resolve),
        value: selected.flatMap { component.tab(id: $0) }.map {
          localization.resolve($0.label)
        }
      )
    )
    for tab in component.tabs {
      elements.append(
        MosaicAccessibilityElement(
          id: "\(component.id).\(tab.id)",
          role: .tab,
          label: localization.resolve(tab.label),
          isSelected: selected == tab.id
        )
      )
    }
    // Exactly one panel is present. An unselected panel is removed from the
    // accessibility tree and focus order, not merely hidden visually.
    guard let tab = component.tabs.first(where: { $0.id == selected }) else { return }
    elements.append(
      MosaicAccessibilityElement(
        id: tab.id,
        role: .tabPanel,
        // The tab label names both its control and its panel.
        label: localization.resolve(tab.label)
      )
    )
    appendAccessibility(from: tab.content, to: &elements)
  }

  private func appendTimelineAccessibility(
    _ component: MosaicTimelineComponent,
    to elements: inout [MosaicAccessibilityElement]
  ) {
    elements.append(
      MosaicAccessibilityElement(
        id: component.id,
        role: .list,
        label: localization.resolve(component.accessibility.label),
        hint: component.accessibility.hint.map(localization.resolve)
      )
    )
    // Array order is the sequence order and carries meaning, so entries are
    // announced in the order they were authored. Markers and the connector are
    // decorative and are never announced or focusable. Title and description
    // are separate elements rather than one joined string.
    for entry in component.entries {
      elements.append(
        MosaicAccessibilityElement(
          id: "\(component.id).\(entry.id).title",
          role: .listItem,
          label: localization.resolve(entry.title)
        )
      )
      // An entry with no description produces no element, not an empty one.
      if let description = entry.description {
        elements.append(
          MosaicAccessibilityElement(
            id: "\(component.id).\(entry.id).description",
            role: .listItem,
            label: localization.resolve(description)
          )
        )
      }
    }
  }

  /// The rating announcement, shared with the renderer so the projection and
  /// the rendered view cannot disagree about what VoiceOver hears.
  ///
  /// `nil` when the catalog carries no usable `mosaic.a11y.rating` template.
  /// The rating then contributes nothing to the announcement rather than an
  /// English phrase the document never authored.
  func ratingAnnouncement(_ rating: MosaicSocialProofRating) -> String? {
    MosaicSocialProofRatingAnnouncement.text(
      for: rating,
      template: localization.resolve(reserved: .rating)
    )
  }

  func productCardAccessibilityLabel(
    _ card: MosaicProductCardComponent,
    option: MosaicResolvedProductOption
  ) -> String {
    if let accessibility = card.accessibility {
      return localization.resolve(accessibility.label, for: option)
    }

    let childLabels = card.children.flatMap { child -> [String] in
      switch child {
      case .node(let node):
        productCardLabels(from: node, option: option)
      case .badge(let badge):
        badge.children.flatMap { productCardLabels(from: $0, option: option) }
      }
    }
    let meaningfulLabels = childLabels.filter {
      !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    if !meaningfulLabels.isEmpty {
      return meaningfulLabels.joined(separator: ", ")
    }

    return [localization.resolve(option.reference.label), option.product.localizedPrice]
      .filter { !$0.isEmpty }
      .joined(separator: ", ")
  }

  private func productCardLabels(
    from node: MosaicNode,
    option: MosaicResolvedProductOption
  ) -> [String] {
    guard isVisible(node.visibility) else { return [] }
    switch node {
    case .stack(let stack):
      return stack.children.flatMap { productCardLabels(from: $0, option: option) }
    case .text(let component):
      return [
        component.accessibility.label.map(localization.resolve)
          ?? localization.resolve(component.value, for: option)
      ]
    case .image(let component):
      if case .informative(let label) = component.accessibility {
        return [localization.resolve(label)]
      }
      return []
    case .icon(let component):
      if case .informative(let label) = component.accessibility {
        return [localization.resolve(label)]
      }
      return []
    case .featureList(let component):
      return [localization.resolve(component.accessibility.label)]
        + component.items.map { localization.resolve($0.text) }
    case .countdown(let component):
      return [
        component.accessibility.label.map(localization.resolve)
          ?? MosaicCountdownText.resolve(
            component: component,
            now: currentDate(),
            completedText: localization.resolve(component.completedText)
          )
      ]
    case .timeline(let component):
      return [localization.resolve(component.accessibility.label)]
        + component.entries.flatMap { entry in
          [localization.resolve(entry.title), entry.description.map(localization.resolve)]
            .compactMap { $0 }
        }
    case .award(let component):
      return [
        localization.resolve(component.title),
        component.subtitle.map(localization.resolve),
      ].compactMap { $0 }
    case .socialProof(let component):
      return [
        component.rating.flatMap(ratingAnnouncement),
        localization.resolve(component.quote),
        localization.resolve(component.attribution),
      ].compactMap { $0 }
    case .productSelector, .button, .carousel, .switchControl, .tabs:
      return []
    }
  }
}

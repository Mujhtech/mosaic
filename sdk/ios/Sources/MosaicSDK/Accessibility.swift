import Foundation

public enum MosaicAccessibilityRole: Sendable, Equatable {
  case text
  case heading(level: Int)
  case image
  case group
  case button
  case productOption
  case switchControl
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
    appendAccessibility(from: document.layout.content, to: &elements)
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
      case .verticalStack(let nested), .stack(let nested):
        appendAccessibility(from: nested, to: &elements)
      case .text(let component):
        let role = component.accessibility.headingLevel.map(MosaicAccessibilityRole.heading)
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
      case .purchaseButton(let component):
        let busy = busyPurchaseButtonID == component.id
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .button,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve),
            value: busy ? localization.resolve(component.inProgressLabel) : nil,
            isEnabled: isPurchaseEnabled(component),
            isBusy: busy
          )
        )
      case .restoreButton(let component):
        let busy = busyRestoreButtonID == component.id
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .button,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve),
            value: busy ? localization.resolve(component.inProgressLabel) : nil,
            isEnabled: isRestoreEnabled(component),
            isBusy: busy
          )
        )
      case .closeButton(let component):
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .button,
            label: localization.resolve(component.accessibility.label),
            hint: component.accessibility.hint.map(localization.resolve)
          )
        )
      case .legalText(let component):
        elements.append(
          MosaicAccessibilityElement(
            id: component.id,
            role: .text,
            label: component.accessibility.label.map(localization.resolve)
              ?? localization.resolve(component.value)
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
      }
    }
  }
}

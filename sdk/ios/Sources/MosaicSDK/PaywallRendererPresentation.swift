import SwiftUI

// SwiftUI rendering for the four components Protocol 0.3 adds. Every degraded
// path here records a diagnostic; none of them substitutes a value the document
// did not author.

// MARK: - Shared selection-state box

/// Paints one resolved `selectionStateStyle`.
///
/// Product Card, Product Badge, and Tabs share the `0.3` `selectionStyles`
/// contract, so they share one painter rather than three that can drift.
@MainActor
struct MosaicSelectionStyledBox: ViewModifier {
  let style: MosaicSelectionStateStyle
  let document: MosaicPaywallDocument

  func body(content: Content) -> some View {
    let border = style.border.color.rendered(in: document, role: .decoration)
    return
      content
      .padding(.top, style.padding.top)
      .padding(.leading, style.padding.start)
      .padding(.bottom, style.padding.bottom)
      .padding(.trailing, style.padding.end)
      .background {
        MosaicBackgroundView(background: style.background)
          .clipShape(RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous))
      }
      .overlay {
        RoundedRectangle(cornerRadius: style.cornerRadius, style: .continuous)
          .strokeBorder(border.color, lineWidth: style.border.width)
      }
      .mosaicStyleDiagnostics(border.failure)
      .opacity(style.opacity)
      .mosaicShadow(style.shadow)
  }
}

/// A decorative image drawn at an authored size.
///
/// Award emblems and Social Proof avatars are always decorative, so this never
/// exposes accessibility content. An asset that cannot be drawn leaves its space
/// empty and diagnoses rather than substituting a glyph the author did not
/// choose.
@MainActor
struct MosaicDecorativeAssetImage: View {
  @EnvironmentObject private var model: MosaicPaywallModel
  let asset: MosaicAsset?
  let assetID: String
  let size: Double
  let resolver: MosaicImageResolver
  let diagnosticCode: String

  var body: some View {
    content
      .frame(width: size, height: size)
      .clipped()
      .accessibilityHidden(true)
  }

  @ViewBuilder
  private var content: some View {
    if let asset {
      switch asset.source {
      case .bundled(let key):
        if let image = resolver.image(for: key) {
          image.resizable().scaledToFill()
        } else {
          unavailable
        }
      case .remote(let url):
        AsyncImage(url: url) { phase in
          switch phase {
          case .success(let image): image.resizable().scaledToFill()
          // `.empty` is still loading, not a failure, so it must not diagnose.
          case .empty: Color.clear
          case .failure: unavailable
          @unknown default: unavailable
          }
        }
      }
    } else {
      unavailable
    }
  }

  private var unavailable: some View {
    Color.clear.task {
      model.recordRenderingDiagnosticOnce(diagnosticCode, subjectID: assetID)
    }
  }
}

// MARK: - Tabs

@MainActor
struct MosaicTabsView: View {
  @Environment(\.mosaicAxisBounds) private var parentBounds
  let component: MosaicTabsComponent
  let document: MosaicPaywallDocument
  let localization: MosaicLocalizationResolver
  @ObservedObject var model: MosaicPaywallModel
  let imageResolver: MosaicImageResolver

  private var selectedTabID: String? { model.selectedTabID(for: component.id) }

  var body: some View {
    VStack(alignment: .leading, spacing: component.gap) {
      tabBar
      panel
    }
    .environment(\.mosaicAxisBounds, parentBounds.constrained(by: component.sizing))
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }

  @ViewBuilder
  private var tabBar: some View {
    switch component.tabBarDirection {
    case .horizontal:
      HStack(alignment: .center, spacing: component.tabBarGap) {
        leadingBarSpacer
        tabControls
        trailingBarSpacer
      }
      .frame(maxWidth: .infinity, alignment: barAlignment)
    case .vertical:
      VStack(alignment: .leading, spacing: component.tabBarGap) {
        leadingBarSpacer
        tabControls
        trailingBarSpacer
      }
      .frame(maxWidth: .infinity, alignment: barAlignment)
    }
  }

  @ViewBuilder
  private var tabControls: some View {
    ForEach(Array(component.tabs.enumerated()), id: \.element.id) { index, tab in
      tabControl(tab)
      if component.tabBarDistribution == .spaceBetween, index < component.tabs.count - 1 {
        Spacer(minLength: component.tabBarGap)
      }
    }
  }

  private func tabControl(_ tab: MosaicTabsEntry) -> some View {
    let selected = selectedTabID == tab.id
    // `selectedLabelColor` is authored either way, so the selected label colour
    // is read rather than inferred from the Default typography.
    let typography = selected
      ? component.labelTypography.recolored(component.selectedLabelColor)
      : component.labelTypography
    // Tabs `selection` animates the tab control's style, not the panel swap:
    // `0.3` visibility semantics remove a hidden node from layout, the
    // accessibility tree, and focus order, and animating a removal would need a
    // "present but not focusable" third state that does not exist.
    return MosaicSelectionStyledContent(
      styles: component.styles,
      selected: selected,
      motion: component.motion?.selection,
      curve: component.motion?.selection.flatMap {
        document.resolvedMotionCurve($0.curve)
      }
    ) { style in
      Button {
        model.selectTab(tab.id, in: component.id)
      } label: {
        MosaicStyledText(value: localization.resolve(tab.label), typography: typography)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .modifier(MosaicSelectionStyledBox(style: style, document: document))
    }
    .frame(minWidth: 44, minHeight: 44)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(localization.resolve(tab.label)))
    .accessibilityAddTraits(.isButton)
    .mosaicSelected(selected)
  }

  @ViewBuilder
  private var panel: some View {
    if let tab = component.tabs.first(where: { $0.id == selectedTabID }) {
      MosaicStackView(
        stack: tab.content,
        document: document,
        localization: localization,
        model: model,
        imageResolver: imageResolver,
        productOption: nil
      )
      // The panel is named by the same label as its tab. `0.3` authors one
      // string so a second one cannot drift from it.
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text(localization.resolve(tab.label)))
    } else {
      // Unreachable for an accepted document: the model seeds the selection
      // from the authored `initialTabId`. Diagnose rather than render an
      // unexplained empty panel.
      Color.clear.task {
        model.recordRenderingDiagnosticOnce("tabs_selection_unresolved", subjectID: component.id)
      }
    }
  }

  @ViewBuilder
  private var leadingBarSpacer: some View {
    if component.tabBarDistribution == .center || component.tabBarDistribution == .end {
      Spacer(minLength: 0)
    }
  }

  @ViewBuilder
  private var trailingBarSpacer: some View {
    if component.tabBarDistribution == .center { Spacer(minLength: 0) }
  }

  private var barAlignment: Alignment {
    switch component.tabBarDistribution {
    case .start, .spaceBetween: .leading
    case .center: .center
    case .end: .trailing
    }
  }
}

// MARK: - Timeline

/// Applies the authored rating announcement, or hides the symbols and
/// diagnoses when the catalog carries no usable template.
///
/// The symbols alone convey nothing to VoiceOver, and the SDK must never
/// compose the phrase from an English literal, so an unusable template means
/// the rating is announced by nothing rather than announced wrongly.
@MainActor
struct MosaicRatingAnnouncement: ViewModifier {
  @EnvironmentObject private var model: MosaicPaywallModel
  let announcement: String?
  let componentID: String

  @ViewBuilder
  func body(content: Content) -> some View {
    if let announcement {
      content.accessibilityLabel(Text(announcement))
    } else {
      content
        .accessibilityHidden(true)
        .task {
          model.recordRenderingDiagnosticOnce(
            "accessibility_reserved_string_unresolved",
            subjectID: MosaicReservedAccessibilityKey.rating.rawValue
          )
        }
    }
  }
}

/// Clips a connector segment to a terminal marker's centre, or lets it span the
/// entry's full extent.
private struct MosaicTimelineRailExtent: ViewModifier {
  let fixedHeight: Double?

  @ViewBuilder
  func body(content: Content) -> some View {
    if let fixedHeight {
      content.frame(height: fixedHeight)
    } else {
      content.frame(maxHeight: .infinity)
    }
  }
}

/// The connector segment drawn through one entry's marker column.
private struct MosaicTimelineRail: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: rect.midX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
    return path
  }
}

struct MosaicTimelineView: View {
  @Environment(\.mosaicDocument) private var document
  let component: MosaicTimelineComponent
  let localization: MosaicLocalizationResolver

  /// The authored marker size, or nothing when no entry declares a marker. It
  /// is never defaulted: the validator rejects a document that declares a
  /// marker without a size, and one that declares a size nothing reads.
  private var markerExtent: Double? { component.markerSize }

  /// The gutter's cross-axis width: the marker size when any entry declares a
  /// marker, and the connector width when none does. `markerSize` is present
  /// exactly when a marker is, so the coalesce is the rule rather than a
  /// substitute for an absent authored value.
  ///
  /// The gutter is laid out on the leading side, so RTL moves it to the other
  /// side. Head and tail stay physical top and bottom and never mirror.
  private var columnWidth: Double {
    component.markerSize ?? component.connector.width
  }

  var body: some View {
    let connector = component.connector.color.rendered(in: document, role: .decoration)
    let marker = component.markerColor?.rendered(in: document, role: .content)
    // Entry spacing is applied as bottom padding rather than VStack spacing so
    // the connector runs through the gap instead of being cut at every entry
    // boundary.
    return VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(component.entries.enumerated()), id: \.element.id) { index, entry in
        entryRow(
          entry,
          index: index,
          connectorColor: connector.color,
          markerColor: marker?.color
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicStyleDiagnostics(connector.failure, marker?.failure)
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }

  private func entryRow(
    _ entry: MosaicTimelineEntry,
    index: Int,
    connectorColor: Color,
    markerColor: Color?
  ) -> some View {
    let isLast = index == component.entries.count - 1
    return HStack(alignment: .top, spacing: 12) {
      markerColumn(
        entry,
        index: index,
        isLast: isLast,
        connectorColor: connectorColor,
        markerColor: markerColor
      )
      VStack(alignment: .leading, spacing: 4) {
        MosaicStyledText(
          value: localization.resolve(entry.title), typography: component.titleTypography)
        // An absent description draws no second line and reserves no space for
        // one. An absent `descriptionTypography` alongside a description cannot
        // occur: the validator rejects that document.
        if let description = entry.description, let typography = component.descriptionTypography {
          MosaicStyledText(value: localization.resolve(description), typography: typography)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.bottom, isLast ? 0 : component.gap)
    }
    .fixedSize(horizontal: false, vertical: true)
  }

  private func markerColumn(
    _ entry: MosaicTimelineEntry,
    index: Int,
    isLast: Bool,
    connectorColor: Color,
    markerColor: Color?
  ) -> some View {
    // The connector is drawn first and the marker over it, so an entry with no
    // marker leaves the run unbroken without a special case. Every non-terminal
    // entry contributes a full-height segment, and adjacent rows abut, so the
    // segments compose into one continuous run.
    //
    // Sequence ends: the head begins at the first marker's centre, or at that
    // entry's top content edge when it has no marker, and the tail ends at the
    // last marker's centre, or at that entry's bottom content edge.
    // Only an entry that declares a marker has a marker centre to stop at, and
    // `markerSize` is present exactly when a marker is, so both offsets are
    // derived from the marker rather than defaulted when one is absent.
    let markerCentre = entry.marker == nil ? nil : markerExtent.map { $0 / 2 }
    let headInset = index == 0 ? markerCentre : nil
    let tailExtent = isLast ? markerCentre : nil
    return ZStack(alignment: .top) {
      rail(connectorColor)
        .frame(width: columnWidth)
        .modifier(
          MosaicTimelineRailExtent(
            // A terminal marker clips the segment to its centre; every other
            // entry lets it span the full row, including the gap below it.
            fixedHeight: tailExtent
          )
        )
        .padding(.top, headInset ?? 0)
      markerGlyph(entry, index: index, color: markerColor)
    }
    .frame(width: columnWidth)
    .frame(maxHeight: .infinity, alignment: .top)
    .accessibilityHidden(true)
  }

  private func rail(_ color: Color) -> some View {
    MosaicTimelineRail()
      .stroke(
        color,
        style: StrokeStyle(
          lineWidth: component.connector.width,
          dash: component.connector.style == .dashed
            ? [component.connector.width * 3, component.connector.width * 2] : []
        )
      )
  }

  @ViewBuilder
  private func markerGlyph(
    _ entry: MosaicTimelineEntry, index: Int, color: Color?
  ) -> some View {
    if let marker = entry.marker {
      // An entry that declares a marker always has a marker colour and size:
      // both are required when any entry consumes them. Rather than invent
      // either, a document that somehow reached the renderer without them draws
      // no glyph and diagnoses.
      if let color, let extent = markerExtent {
        glyph(marker, index: index, color: color, extent: extent)
      } else {
        EmptyView()
          .mosaicStyleDiagnostics(
            MosaicStyleResolutionFailure(
              code: "timeline_marker_style_missing", subjectID: component.id))
      }
    }
  }

  @ViewBuilder
  private func glyph(
    _ marker: MosaicTimelineMarker, index: Int, color: Color, extent: Double
  ) -> some View {
    switch marker {
    case .dot:
      Circle().fill(color).frame(width: extent, height: extent)
    case .ordinal:
      // The 1-based position, formatted by the platform's locale number
      // formatting through the renderer's `\.locale` environment.
      Text(index + 1, format: .number)
        .font(.system(size: extent * 0.8, weight: .semibold))
        .foregroundStyle(color)
        .frame(width: extent, height: extent)
    case .icon(let name):
      Image(systemName: name.systemName)
        .font(.system(size: extent * 0.9))
        .foregroundStyle(color)
        .frame(width: extent, height: extent)
    }
  }
}

// MARK: - Award

@MainActor
struct MosaicAwardView: View {
  @Environment(\.mosaicDocument) private var document
  let component: MosaicAwardComponent
  let asset: MosaicAsset?
  let localization: MosaicLocalizationResolver
  let resolver: MosaicImageResolver

  var body: some View {
    content
      .frame(maxWidth: .infinity, alignment: frameAlignment)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
      .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
      .mosaicPresentation(
        appearance: component.appearance,
        sizing: component.sizing,
        outerInsets: component.outerInsets
      )
  }

  @ViewBuilder
  private var content: some View {
    switch component.direction {
    case .vertical:
      VStack(alignment: verticalAlignment, spacing: component.gap) { emblem; text }
    case .horizontal:
      HStack(alignment: horizontalAlignment, spacing: component.gap) { emblem; text }
    }
  }

  /// Always decorative and never labelled: the title already carries the
  /// award's meaning, so an emblem alt-text would duplicate or contradict it.
  @ViewBuilder
  private var emblem: some View {
    switch component.emblem {
    case .image(let assetID, let size):
      MosaicDecorativeAssetImage(
        asset: asset,
        assetID: assetID,
        size: size,
        resolver: resolver,
        diagnosticCode: "award_emblem_image_unavailable"
      )
    case .icon(let name, let size, let color):
      let rendered = color.rendered(in: document, role: .content)
      Image(systemName: name.systemName)
        .font(.system(size: size))
        .foregroundStyle(rendered.color)
        .accessibilityHidden(true)
        .mosaicStyleDiagnostics(rendered.failure)
    case .none:
      EmptyView()
    }
  }

  @ViewBuilder
  private var text: some View {
    VStack(alignment: verticalAlignment, spacing: 2) {
      MosaicStyledText(
        value: localization.resolve(component.title), typography: component.titleTypography)
      if let subtitle = component.subtitle, let typography = component.subtitleTypography {
        MosaicStyledText(value: localization.resolve(subtitle), typography: typography)
      }
    }
  }

  private var verticalAlignment: HorizontalAlignment {
    switch component.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }

  private var horizontalAlignment: VerticalAlignment {
    switch component.crossAxisAlignment {
    case .start, .stretch: .top
    case .center: .center
    case .end: .bottom
    }
  }

  private var frameAlignment: Alignment {
    switch component.crossAxisAlignment {
    case .start, .stretch: .leading
    case .center: .center
    case .end: .trailing
    }
  }
}

// MARK: - Social Proof

@MainActor
struct MosaicSocialProofView: View {
  @Environment(\.mosaicDocument) private var document
  let component: MosaicSocialProofComponent
  let asset: MosaicAsset?
  let localization: MosaicLocalizationResolver
  let resolver: MosaicImageResolver

  var body: some View {
    HStack(alignment: .top, spacing: component.gap) {
      if let avatar = component.avatar {
        MosaicDecorativeAssetImage(
          asset: asset,
          assetID: avatar.assetId,
          size: avatar.size,
          resolver: resolver,
          diagnosticCode: "social_proof_avatar_unavailable"
        )
        .clipShape(Circle())
      }
      VStack(alignment: .leading, spacing: component.gap) {
        // Announced in order: rating, then quote, then attribution.
        if let rating = component.rating {
          MosaicSocialProofRatingView(
            rating: rating,
            announcement: MosaicSocialProofRatingAnnouncement.text(
              for: rating,
              template: localization.resolve(reserved: .rating)
            ),
            componentID: component.id
          )
        }
        MosaicStyledText(
          value: localization.resolve(component.quote), typography: component.quoteTypography)
        MosaicStyledText(
          value: localization.resolve(component.attribution),
          typography: component.attributionTypography
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(localization.resolve(component.accessibility.label)))
    .mosaicAccessibilityHint(component.accessibility.hint.map(localization.resolve))
    .mosaicPresentation(
      appearance: component.appearance,
      sizing: component.sizing,
      outerInsets: component.outerInsets
    )
  }
}

@MainActor
struct MosaicSocialProofRatingView: View {
  @Environment(\.mosaicDocument) private var document
  @EnvironmentObject private var model: MosaicPaywallModel
  let rating: MosaicSocialProofRating
  /// The resolved, authored `mosaic.a11y.rating` template with the rating
  /// substituted in, or nothing when the catalog does not carry a usable one.
  let announcement: String?
  let componentID: String

  var body: some View {
    let filled = rating.filledColor.rendered(in: document, role: .content)
    let empty = rating.emptyColor.rendered(in: document, role: .decoration)
    return HStack(spacing: rating.size * 0.25) {
      ForEach(Array(0..<rating.maximum), id: \.self) { index in
        Image(systemName: symbolName(atSymbol: index))
          .font(.system(size: rating.size))
          .foregroundStyle(rating.steps(atSymbol: index) > 0 ? filled.color : empty.color)
      }
    }
    .mosaicStyleDiagnostics(filled.failure, empty.failure)
    .accessibilityElement(children: .ignore)
    .modifier(MosaicRatingAnnouncement(announcement: announcement, componentID: componentID))
  }

  private func symbolName(atSymbol index: Int) -> String {
    let steps = rating.steps(atSymbol: index)
    if steps == rating.step.stepsPerPoint { return "star.fill" }
    if steps > 0 { return "star.leadinghalf.filled" }
    return "star"
  }

}

extension MosaicTypography {
  /// The same typography with one colour replaced, used for a selected Tab
  /// label. Every other field is the authored Default value.
  func recolored(_ color: MosaicColor) -> MosaicTypography {
    MosaicTypography(
      style: style,
      fontSize: fontSize,
      lineHeightMultiplier: lineHeightMultiplier,
      weight: weight,
      color: color,
      alignment: alignment,
      maxLines: maxLines,
      overflow: overflow
    )
  }
}

import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";

import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import {
  AdvancedSection,
  ControlAccessibilitySection,
} from "@/features/paywall-editor/components/property-inspector-accessibility";
import {
  BackgroundSection,
  BorderSection,
} from "@/features/paywall-editor/components/property-inspector-background";
import { withTimelineStyleCoPresence } from "@/features/paywall-editor/components/property-inspector-content-blocks-support";
import {
  CompactOptionField,
  Field,
  InspectorSection,
  TwoColumn,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core";
import {
  alignmentOptions,
  FLOW_OPTIONS,
} from "@/features/paywall-editor/components/property-inspector-core-support";
import {
  ColorField,
  LocalizedField,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields";
import {
  AppearanceSection,
  SizingFields,
  SpacingSection,
  TypographyFields,
  VisibilitySection,
} from "@/features/paywall-editor/components/property-inspector-layout";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  AwardComponent,
  BaseTypography,
  IconName,
  ProtocolNode,
  SocialProofComponent,
  SocialProofRating,
  TimelineComponent,
  TimelineEntry,
} from "@/features/paywall-editor/types/editor";
import { typography } from "@/features/paywall-editor/utils/document-tree-creation";
import {
  allocateIdentifier,
  allocateLocalizationKey,
  identifierSet,
  localizationKeySet,
  localized,
} from "@/features/paywall-editor/utils/document-tree-dependencies";
import {
  ratingMaximumSteps,
  ratingPointOffsets,
  ratingStepsPerPoint,
} from "@/features/paywall-editor/utils/protocol-component-rules";

const MINIMUM_TIMELINE_ENTRIES = 2;
const SEEDED_AVATAR_SIZE = 40;
const MAXIMUM_TIMELINE_ENTRIES = 12;
const ICON_NAMES: readonly IconName[] = [
  "checkmark",
  "close",
  "lock",
  "restore",
  "externalLink",
  "arrowBackward",
  "arrowForward",
  "chevronBackward",
  "chevronForward",
];

function TimelineEntryEditor({
  index,
  node,
  onRemove,
  onUpdate,
}: {
  index: number;
  node: TimelineComponent;
  onRemove: () => void;
  onUpdate: (updater: (entry: TimelineEntry) => TimelineEntry) => void;
}) {
  const { disabled, document } = useInspectorContext();
  const entry = node.entries[index];
  if (!entry) {
    return null;
  }
  const markerKind = entry.marker ? entry.marker.kind : "none";
  return (
    <div className="space-y-3 rounded border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-[11px] text-muted-foreground">
          Entry {index + 1}
        </p>
        <Button
          aria-label={`Remove entry ${entry.title.default}`}
          disabled={disabled || node.entries.length <= MINIMUM_TIMELINE_ENTRIES}
          onClick={onRemove}
          size="xs"
          type="button"
          variant="outline"
        >
          <TrashIcon aria-hidden />
        </Button>
      </div>
      <LocalizedField
        address={`entries.${index}.title`}
        label="Title"
        text={entry.title}
      />
      {entry.description ? (
        <>
          <LocalizedField
            address={`entries.${index}.description`}
            label="Description"
            text={entry.description}
          />
          <Button
            disabled={disabled}
            onClick={() =>
              onUpdate((current) => {
                const next = { ...current };
                delete next.description;
                return next;
              })
            }
            size="xs"
            type="button"
            variant="outline"
          >
            Remove description
          </Button>
        </>
      ) : (
        <Button
          disabled={disabled}
          onClick={() =>
            onUpdate((current) => ({
              ...current,
              description: localized(
                "Describe this step.",
                allocateLocalizationKey(
                  localizationKeySet(document),
                  `paywall.${current.id.replaceAll("-", "_")}.description`
                )
              ),
            }))
          }
          size="xs"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden /> Add description
        </Button>
      )}
      <SelectField
        address={`entries.${index}.marker.kind`}
        description="No marker means the connector runs unbroken through this entry."
        label="Marker"
        onChange={(kind) =>
          onUpdate((current) => {
            if (kind === "none") {
              const next = { ...current };
              delete next.marker;
              return next;
            }
            if (kind === "icon") {
              return {
                ...current,
                marker: { kind: "icon", name: "checkmark" },
              };
            }
            return {
              ...current,
              marker: { kind: kind as "dot" | "ordinal" },
            };
          })
        }
        value={markerKind}
      >
        <SelectItem value="none">No marker</SelectItem>
        <SelectItem value="dot">Dot</SelectItem>
        <SelectItem value="ordinal">Number</SelectItem>
        <SelectItem value="icon">Icon</SelectItem>
      </SelectField>
      {entry.marker?.kind === "icon" ? (
        <SelectField
          address={`entries.${index}.marker.name`}
          label="Marker icon"
          onChange={(name) =>
            onUpdate((current) => ({
              ...current,
              marker: { kind: "icon", name: name as IconName },
            }))
          }
          value={entry.marker.name}
        >
          {ICON_NAMES.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectField>
      ) : null}
    </div>
  );
}

export function TimelineInspector({ node }: { node: TimelineComponent }) {
  const { disabled, document } = useInspectorContext();
  const editor = useEditorActions();
  const usesMarker = node.entries.some((entry) => entry.marker !== undefined);
  const usesDescription = node.entries.some(
    (entry) => entry.description !== undefined
  );

  function updateTimeline(
    updater: (timeline: TimelineComponent) => TimelineComponent
  ) {
    editor.updateComponent(node.id, (current) =>
      current.type === "timeline"
        ? (withTimelineStyleCoPresence(updater(current)) as ProtocolNode)
        : current
    );
  }

  function addEntry() {
    const identifiers = identifierSet(document);
    const keys = localizationKeySet(document);
    const ordinal = node.entries.length + 1;
    const entryId = allocateIdentifier(
      identifiers,
      `${node.id}-step-${ordinal}`
    );
    updateTimeline((current) => ({
      ...current,
      entries: [
        ...current.entries,
        {
          id: entryId,
          marker: { kind: "ordinal" },
          title: localized(
            `Step ${ordinal}`,
            allocateLocalizationKey(
              keys,
              `paywall.${entryId.replaceAll("-", "_")}.title`
            )
          ),
        },
      ],
    }));
  }

  return (
    <>
      <InspectorSection defaultOpen title="Content">
        {node.entries.map((entry, index) => (
          <TimelineEntryEditor
            index={index}
            key={entry.id}
            node={node}
            onRemove={() =>
              updateTimeline((current) =>
                current.entries.length <= MINIMUM_TIMELINE_ENTRIES
                  ? current
                  : {
                      ...current,
                      entries: current.entries.filter(
                        (candidate) => candidate.id !== entry.id
                      ),
                    }
              )
            }
            onUpdate={(updater) =>
              updateTimeline((current) => ({
                ...current,
                entries: current.entries.map((candidate) =>
                  candidate.id === entry.id ? updater(candidate) : candidate
                ),
              }))
            }
          />
        ))}
        <Button
          className="w-full justify-start"
          disabled={disabled || node.entries.length >= MAXIMUM_TIMELINE_ENTRIES}
          onClick={addEntry}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden /> Add entry
        </Button>
        <p className="text-[11px] text-muted-foreground leading-4">
          Two to twelve entries. Array order is the sequence order; renderers
          never reorder it.
        </p>
      </InspectorSection>
      <InspectorSection defaultOpen title="Connector">
        <ColorField
          address="connector.color"
          label="Connector colour"
          onUpdate={(current, color) =>
            current.type === "timeline"
              ? ({
                  ...current,
                  connector: { ...current.connector, color },
                } as ProtocolNode)
              : current
          }
          value={node.connector.color}
        />
        <TwoColumn>
          <NumberField
            address="connector.width"
            label="Width"
            max={4096}
            min={1}
            onChange={(width) =>
              updateTimeline((current) => ({
                ...current,
                connector: { ...current.connector, width },
              }))
            }
            unit="lu"
            value={node.connector.width}
          />
          <SelectField
            address="connector.style"
            label="Style"
            onChange={(style) =>
              updateTimeline((current) => ({
                ...current,
                connector: {
                  ...current.connector,
                  style: style as "solid" | "dashed",
                },
              }))
            }
            value={node.connector.style}
          >
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="dashed">Dashed</SelectItem>
          </SelectField>
        </TwoColumn>
      </InspectorSection>
      {usesMarker &&
      node.markerColor !== undefined &&
      node.markerSize !== undefined ? (
        <InspectorSection defaultOpen title="Marker">
          <p className="text-[11px] text-muted-foreground leading-4">
            Required while any entry carries a marker. Removing every marker
            removes these fields, because a value nothing reads is how a stale
            field survives a redesign.
          </p>
          <ColorField
            address="markerColor"
            label="Marker colour"
            onUpdate={(current, markerColor) =>
              current.type === "timeline"
                ? ({ ...current, markerColor } as ProtocolNode)
                : current
            }
            value={node.markerColor}
          />
          <NumberField
            address="markerSize"
            label="Marker size"
            max={4096}
            min={1}
            onChange={(markerSize) =>
              updateTimeline((current) => ({ ...current, markerSize }))
            }
            unit="lu"
            value={node.markerSize}
          />
        </InspectorSection>
      ) : null}
      <InspectorSection title="Typography">
        <TypographyFields
          node={node}
          onChange={(current, value) =>
            current.type === "timeline"
              ? { ...current, titleTypography: value as BaseTypography }
              : current
          }
          typography={node.titleTypography}
        />
      </InspectorSection>
      {usesDescription && node.descriptionTypography ? (
        <InspectorSection title="Description typography">
          <TypographyFields
            node={node}
            onChange={(current, value) =>
              current.type === "timeline"
                ? {
                    ...current,
                    descriptionTypography: value as BaseTypography,
                  }
                : current
            }
            typography={node.descriptionTypography}
          />
        </InspectorSection>
      ) : null}
      <InspectorSection defaultOpen title="Layout">
        <NumberField
          address="gap"
          label="Spacing"
          max={4096}
          min={0}
          onChange={(gap) => updateTimeline((current) => ({ ...current, gap }))}
          unit="lu"
          value={node.gap}
        />
        <SizingFields node={node} />
      </InspectorSection>
      <SpacingSection box node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection node={node} />
      <VisibilitySection node={node} />
      <ControlAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  );
}

export function AwardInspector({ node }: { node: AwardComponent }) {
  const { disabled, document } = useInspectorContext();
  const editor = useEditorActions();
  const imageAssets = document.assets.filter((asset) => asset.type === "image");
  const emblemKind = node.emblem ? node.emblem.type : "none";

  function updateAward(updater: (award: AwardComponent) => AwardComponent) {
    editor.updateComponent(node.id, (current) =>
      current.type === "award" ? (updater(current) as ProtocolNode) : current
    );
  }

  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <LocalizedField address="title" label="Title" text={node.title} />
        {node.subtitle ? (
          <>
            <LocalizedField
              address="subtitle"
              label="Subtitle"
              text={node.subtitle}
            />
            <Button
              disabled={disabled}
              onClick={() =>
                updateAward((current) => {
                  // Subtitle and its typography are mutually required, so they
                  // are added and removed as one edit.
                  const next = { ...current };
                  delete next.subtitle;
                  delete next.subtitleTypography;
                  return next;
                })
              }
              size="xs"
              type="button"
              variant="outline"
            >
              Remove subtitle
            </Button>
          </>
        ) : (
          <Button
            disabled={disabled}
            onClick={() =>
              updateAward((current) => ({
                ...current,
                subtitle: localized(
                  "Recognised by the editors",
                  allocateLocalizationKey(
                    localizationKeySet(document),
                    `paywall.${current.id.replaceAll("-", "_")}.subtitle`
                  )
                ),
                subtitleTypography: typography("caption", "center"),
              }))
            }
            size="xs"
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden /> Add subtitle
          </Button>
        )}
      </InspectorSection>
      <InspectorSection defaultOpen title="Emblem">
        <SelectField
          address="emblem.type"
          description="No emblem means the award renders its text alone. The emblem is always decorative; the title carries the meaning."
          label="Emblem"
          onChange={(type) =>
            updateAward((current) => {
              if (type === "none") {
                const next = { ...current };
                delete next.emblem;
                return next;
              }
              if (type === "icon") {
                return {
                  ...current,
                  emblem: {
                    type: "icon",
                    name: "checkmark",
                    size: 48,
                    color: "action.primary",
                  },
                };
              }
              const [firstAsset] = imageAssets;
              return firstAsset
                ? {
                    ...current,
                    emblem: {
                      type: "image",
                      assetId: firstAsset.id,
                      size: 48,
                    },
                  }
                : current;
            })
          }
          value={emblemKind}
        >
          <SelectItem value="none">No emblem</SelectItem>
          <SelectItem value="icon">Icon</SelectItem>
          <SelectItem disabled={imageAssets.length === 0} value="image">
            Image asset
          </SelectItem>
        </SelectField>
        {node.emblem?.type === "icon" ? (
          <>
            <SelectField
              address="emblem.name"
              label="Emblem icon"
              onChange={(name) =>
                updateAward((current) =>
                  current.emblem?.type === "icon"
                    ? {
                        ...current,
                        emblem: { ...current.emblem, name: name as IconName },
                      }
                    : current
                )
              }
              value={node.emblem.name}
            >
              {ICON_NAMES.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectField>
            <ColorField
              address="emblem.color"
              label="Emblem colour"
              onUpdate={(current, color) =>
                current.type === "award" && current.emblem?.type === "icon"
                  ? ({
                      ...current,
                      emblem: { ...current.emblem, color },
                    } as ProtocolNode)
                  : current
              }
              value={node.emblem.color}
            />
          </>
        ) : null}
        {node.emblem?.type === "image" ? (
          <SelectField
            address="emblem.assetId"
            label="Emblem asset"
            onChange={(assetId) =>
              updateAward((current) =>
                current.emblem?.type === "image"
                  ? { ...current, emblem: { ...current.emblem, assetId } }
                  : current
              )
            }
            value={node.emblem.assetId}
          >
            {imageAssets.map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                {asset.id}
              </SelectItem>
            ))}
          </SelectField>
        ) : null}
        {node.emblem ? (
          <NumberField
            address="emblem.size"
            label="Emblem size"
            max={4096}
            min={1}
            onChange={(size) =>
              updateAward((current) =>
                current.emblem
                  ? { ...current, emblem: { ...current.emblem, size } }
                  : current
              )
            }
            unit="lu"
            value={node.emblem.size}
          />
        ) : null}
      </InspectorSection>
      <InspectorSection title="Typography">
        <TypographyFields
          node={node}
          onChange={(current, value) =>
            current.type === "award"
              ? { ...current, titleTypography: value as BaseTypography }
              : current
          }
          typography={node.titleTypography}
        />
      </InspectorSection>
      {node.subtitleTypography ? (
        <InspectorSection title="Subtitle typography">
          <TypographyFields
            node={node}
            onChange={(current, value) =>
              current.type === "award"
                ? { ...current, subtitleTypography: value as BaseTypography }
                : current
            }
            typography={node.subtitleTypography}
          />
        </InspectorSection>
      ) : null}
      <InspectorSection defaultOpen title="Layout">
        <CompactOptionField
          address="direction"
          label="Flow"
          onChange={(direction) =>
            updateAward((current) => ({
              ...current,
              direction: direction as typeof current.direction,
            }))
          }
          options={FLOW_OPTIONS}
          value={node.direction}
        />
        <CompactOptionField
          address="crossAxisAlignment"
          label="Alignment"
          onChange={(crossAxisAlignment) =>
            updateAward((current) => ({
              ...current,
              crossAxisAlignment:
                crossAxisAlignment as typeof current.crossAxisAlignment,
            }))
          }
          options={alignmentOptions(node.direction)}
          value={node.crossAxisAlignment}
        />
        <NumberField
          address="gap"
          label="Spacing"
          max={4096}
          min={0}
          onChange={(gap) => updateAward((current) => ({ ...current, gap }))}
          unit="lu"
          value={node.gap}
        />
        <SizingFields node={node} />
      </InspectorSection>
      <SpacingSection box node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection node={node} />
      <VisibilitySection node={node} />
      <ControlAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  );
}

function ratingPointsLabel(rating: SocialProofRating) {
  const points = rating.value / ratingStepsPerPoint(rating.step);
  return `${points} out of ${rating.maximum}`;
}

/**
 * The protocol counts a rating in whole steps, not points, so that four
 * runtimes cannot round one fraction four different ways. Authors think in
 * stars, so this control shows stars and writes steps, and its slider bound is
 * the protocol's own `maximum x stepsPerPoint` — the value cannot be dragged
 * past what the document allows.
 */
function RatingValueField({
  onChange,
  rating,
}: {
  onChange: (value: number) => void;
  rating: SocialProofRating;
}) {
  const { disabled } = useInspectorContext();
  const stepsPerPoint = ratingStepsPerPoint(rating.step);
  const maximumSteps = ratingMaximumSteps(rating);
  return (
    <Field
      address="rating.value"
      description={`Stored as ${rating.value} of ${maximumSteps} ${rating.step} steps.`}
      label="Rating"
    >
      {(fieldProps) => (
        <div className="space-y-1.5">
          <span aria-hidden className="flex items-center gap-0.5 text-base">
            {ratingPointOffsets(rating).map((point) => {
              const earned = rating.value - point * stepsPerPoint;
              const proportion = Math.min(
                1,
                Math.max(0, earned / stepsPerPoint)
              );
              return (
                <span
                  className="relative inline-block text-muted-foreground"
                  key={`preview-star-of-${rating.maximum}-${point}`}
                >
                  ★
                  <span
                    className="absolute inset-y-0 start-0 overflow-hidden text-primary"
                    style={{ width: `${proportion * 100}%` }}
                  >
                    ★
                  </span>
                </span>
              );
            })}
            <span className="ms-2 text-muted-foreground text-xs">
              {ratingPointsLabel(rating)}
            </span>
          </span>
          <input
            {...fieldProps}
            aria-valuetext={`${ratingPointsLabel(rating)} stars`}
            className="w-full"
            disabled={disabled}
            max={maximumSteps}
            min={0}
            onChange={(event) =>
              onChange(
                Math.min(maximumSteps, Math.max(0, Number(event.target.value)))
              )
            }
            step={1}
            type="range"
            value={rating.value}
          />
        </div>
      )}
    </Field>
  );
}

export function SocialProofInspector({ node }: { node: SocialProofComponent }) {
  const { disabled, document } = useInspectorContext();
  const editor = useEditorActions();
  const imageAssets = document.assets.filter((asset) => asset.type === "image");

  function updateSocialProof(
    updater: (socialProof: SocialProofComponent) => SocialProofComponent
  ) {
    editor.updateComponent(node.id, (current) =>
      current.type === "socialProof"
        ? (updater(current) as ProtocolNode)
        : current
    );
  }

  /** Re-bounds the authored value whenever the author changes the bound itself. */
  function updateRating(
    updater: (rating: SocialProofRating) => SocialProofRating
  ) {
    updateSocialProof((current) => {
      if (!current.rating) {
        return current;
      }
      const rating = updater(current.rating);
      return {
        ...current,
        rating: {
          ...rating,
          value: Math.min(rating.value, ratingMaximumSteps(rating)),
        },
      };
    });
  }

  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <LocalizedField address="quote" label="Quote" text={node.quote} />
        <LocalizedField
          address="attribution"
          description="Required. An unattributed testimonial is not social proof."
          label="Attribution"
          text={node.attribution}
        />
      </InspectorSection>
      <InspectorSection defaultOpen title="Rating">
        {node.rating ? (
          <>
            <RatingValueField
              onChange={(value) =>
                updateSocialProof((current) =>
                  current.rating
                    ? { ...current, rating: { ...current.rating, value } }
                    : current
                )
              }
              rating={node.rating}
            />
            <TwoColumn>
              <NumberField
                address="rating.maximum"
                label="Stars"
                max={10}
                min={1}
                onChange={(maximum) =>
                  updateRating((current) => ({ ...current, maximum }))
                }
                value={node.rating.maximum}
              />
              <SelectField
                address="rating.step"
                label="Precision"
                onChange={(step) =>
                  updateRating((current) => ({
                    ...current,
                    step: step as "whole" | "half",
                  }))
                }
                value={node.rating.step}
              >
                <SelectItem value="whole">Whole stars</SelectItem>
                <SelectItem value="half">Half stars</SelectItem>
              </SelectField>
            </TwoColumn>
            <NumberField
              address="rating.size"
              label="Star size"
              max={4096}
              min={1}
              onChange={(size) =>
                updateRating((current) => ({ ...current, size }))
              }
              unit="lu"
              value={node.rating.size}
            />
            <ColorField
              address="rating.filledColor"
              label="Filled colour"
              onUpdate={(current, filledColor) =>
                current.type === "socialProof" && current.rating
                  ? ({
                      ...current,
                      rating: { ...current.rating, filledColor },
                    } as ProtocolNode)
                  : current
              }
              value={node.rating.filledColor}
            />
            <ColorField
              address="rating.emptyColor"
              label="Empty colour"
              onUpdate={(current, emptyColor) =>
                current.type === "socialProof" && current.rating
                  ? ({
                      ...current,
                      rating: { ...current.rating, emptyColor },
                    } as ProtocolNode)
                  : current
              }
              value={node.rating.emptyColor}
            />
            <Button
              disabled={disabled}
              onClick={() =>
                updateSocialProof((current) => {
                  const next = { ...current };
                  delete next.rating;
                  return next;
                })
              }
              size="xs"
              type="button"
              variant="outline"
            >
              Remove rating
            </Button>
          </>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground leading-4">
              No rating means no symbols are drawn. It is neither a zero rating
              nor an unknown one.
            </p>
            <Button
              disabled={disabled}
              onClick={() =>
                updateSocialProof((current) => ({
                  ...current,
                  rating: {
                    symbol: "star",
                    value: 9,
                    maximum: 5,
                    step: "half",
                    size: 16,
                    filledColor: "action.primary",
                    emptyColor: "border.default",
                  },
                }))
              }
              size="xs"
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden /> Add rating
            </Button>
          </>
        )}
      </InspectorSection>
      <InspectorSection title="Avatar">
        <SelectField
          address="avatar.assetId"
          description="No avatar means none is drawn and no space is reserved for one."
          label="Avatar asset"
          onChange={(assetId) =>
            updateSocialProof((current) => {
              if (assetId === "none") {
                const next = { ...current };
                delete next.avatar;
                return next;
              }
              return {
                ...current,
                avatar: {
                  assetId,
                  size: current.avatar?.size ?? SEEDED_AVATAR_SIZE,
                },
              };
            })
          }
          value={node.avatar ? node.avatar.assetId : "none"}
        >
          <SelectItem value="none">No avatar</SelectItem>
          {imageAssets.map((asset) => (
            <SelectItem key={asset.id} value={asset.id}>
              {asset.id}
            </SelectItem>
          ))}
        </SelectField>
        {node.avatar ? (
          <NumberField
            address="avatar.size"
            label="Avatar size"
            max={4096}
            min={1}
            onChange={(size) =>
              updateSocialProof((current) =>
                current.avatar
                  ? { ...current, avatar: { ...current.avatar, size } }
                  : current
              )
            }
            unit="lu"
            value={node.avatar.size}
          />
        ) : null}
      </InspectorSection>
      <InspectorSection title="Quote typography">
        <TypographyFields
          node={node}
          onChange={(current, value) =>
            current.type === "socialProof"
              ? { ...current, quoteTypography: value as BaseTypography }
              : current
          }
          typography={node.quoteTypography}
        />
      </InspectorSection>
      <InspectorSection title="Attribution typography">
        <TypographyFields
          node={node}
          onChange={(current, value) =>
            current.type === "socialProof"
              ? { ...current, attributionTypography: value as BaseTypography }
              : current
          }
          typography={node.attributionTypography}
        />
      </InspectorSection>
      <InspectorSection defaultOpen title="Layout">
        <NumberField
          address="gap"
          label="Spacing"
          max={4096}
          min={0}
          onChange={(gap) =>
            updateSocialProof((current) => ({ ...current, gap }))
          }
          unit="lu"
          value={node.gap}
        />
        <SizingFields node={node} />
      </InspectorSection>
      <SpacingSection box node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection node={node} />
      <VisibilitySection node={node} />
      <ControlAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  );
}

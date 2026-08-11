import type { InsertableBlockType } from "@/features/paywall-editor/types/editor";

/**
 * What an author needs to know before inserting a component, expressed as
 * references into the Mosaic protocol schema rather than as prose.
 *
 * Every `definition` names a `$defs` key in `protocol/schema/v0.3/paywall.schema.json`,
 * every `property` names a property of that definition, and every bound below
 * restates a `minItems`/`maxItems`/`required` fact from that schema. The schema
 * is 76 KB and lives outside this package, so it is not bundled into the
 * dashboard client for four numbers. Instead `component-constraints.test.ts`
 * loads the schema from disk and fails if any bound, required field, or
 * optional field here drifts from it.
 *
 * `noun`, `entryLabel`, `behaviour`, and the field labels are authored copy and
 * are deliberately not derived: they describe the component to a human.
 */
export interface SchemaFields {
  /** A `$defs` key in the paywall schema. */
  readonly definition: string;
  /** Properties this definition declares but does not require. */
  readonly optional: readonly string[];
  /** Properties this definition lists in `required`. */
  readonly required: readonly string[];
}

export interface ComponentCollection {
  /** Schema facts about a single element, when elements are authored content. */
  readonly entry?: SchemaFields;
  /** Singular authored noun, for example "panel". */
  readonly entryLabel: string;
  /** The property's `maxItems`, or null when the schema sets no ceiling. */
  readonly maxItems: number | null;
  /** The property's `minItems`. */
  readonly minItems: number;
  /** Plural authored noun, for example "labelled panels". */
  readonly noun: string;
  /** The array property on the component definition. */
  readonly property: string;
}

export interface ComponentConstraint {
  /** Authored behavioural note that no schema keyword expresses. */
  readonly behaviour?: string;
  readonly collection?: ComponentCollection;
  /** The component's `$defs` key in the paywall schema. */
  readonly definition: string;
  /** Optional properties worth showing an author. */
  readonly optionalContent: readonly string[];
  /** Required properties worth showing an author, excluding structural ones. */
  readonly requiredContent: readonly string[];
}

export const COMPONENT_CONSTRAINTS: Readonly<
  Record<InsertableBlockType, ComponentConstraint>
> = Object.freeze({
  stack: {
    definition: "stack",
    requiredContent: [],
    optionalContent: [],
    collection: {
      property: "children",
      noun: "child components",
      entryLabel: "child component",
      minItems: 0,
      maxItems: null,
    },
    behaviour: "Arranges its children vertically or horizontally.",
  },
  carousel: {
    definition: "carouselComponent",
    requiredContent: ["initialPageIndex"],
    optionalContent: [],
    collection: {
      property: "pages",
      noun: "swipeable pages",
      entryLabel: "page",
      minItems: 2,
      maxItems: 20,
      entry: {
        definition: "carouselPage",
        required: ["accessibilityLabel", "content"],
        optional: [],
      },
    },
    behaviour: "One page is visible at a time.",
  },
  tabs: {
    definition: "tabsComponent",
    requiredContent: ["initialTabId"],
    optionalContent: [],
    collection: {
      property: "tabs",
      noun: "labelled panels",
      entryLabel: "panel",
      minItems: 2,
      maxItems: 8,
      entry: {
        definition: "tabsEntry",
        required: ["label", "content"],
        optional: [],
      },
    },
    behaviour:
      "One panel is visible at a time, and the opening panel is authored rather than positional.",
  },
  switch: {
    definition: "switchComponent",
    requiredContent: ["label", "initialValue"],
    optionalContent: [],
    behaviour: "Lets the customer show or hide conditional paywall content.",
  },
  countdown: {
    definition: "countdownComponent",
    requiredContent: ["endsAt", "completedText"],
    optionalContent: [],
    behaviour:
      "Needs an explicit UTC deadline before it can be inserted or dragged.",
  },
  text: {
    definition: "textComponent",
    requiredContent: ["value"],
    optionalContent: [],
    behaviour: "Copy is localized through the document's locale catalogs.",
  },
  image: {
    definition: "imageComponent",
    requiredContent: ["assetId", "contentMode"],
    optionalContent: ["aspectRatio"],
    behaviour: "References an asset already declared by the document.",
  },
  icon: {
    definition: "iconComponent",
    requiredContent: ["name", "size", "color"],
    optionalContent: [],
    behaviour: "Draws a protocol icon that every native renderer ships.",
  },
  featureList: {
    definition: "featureListComponent",
    requiredContent: ["marker", "markerColor"],
    optionalContent: [],
    collection: {
      property: "items",
      noun: "benefit items",
      entryLabel: "item",
      minItems: 1,
      maxItems: null,
      entry: {
        definition: "featureListItem",
        required: ["text"],
        optional: [],
      },
    },
  },
  timeline: {
    definition: "timelineComponent",
    requiredContent: ["orientation", "connector"],
    optionalContent: ["markerColor", "markerSize"],
    collection: {
      property: "entries",
      noun: "ordered entries",
      entryLabel: "entry",
      minItems: 2,
      maxItems: 12,
      entry: {
        definition: "timelineEntry",
        required: ["title"],
        optional: ["description", "marker"],
      },
    },
    behaviour: "Starts vertical; the orientation is authored, not inferred.",
  },
  award: {
    definition: "awardComponent",
    requiredContent: ["title"],
    optionalContent: ["emblem", "subtitle"],
  },
  socialProof: {
    definition: "socialProofComponent",
    requiredContent: ["quote", "attribution"],
    optionalContent: ["rating", "avatar"],
  },
  productSelector: {
    definition: "productSelectorComponent",
    requiredContent: ["initialProductCardId", "unavailableFallback"],
    optionalContent: [],
    collection: {
      property: "cards",
      noun: "product cards",
      entryLabel: "card",
      minItems: 1,
      maxItems: 20,
    },
    behaviour: "Each card binds to a product reference.",
  },
  button: {
    definition: "buttonComponent",
    requiredContent: ["action"],
    optionalContent: [],
    collection: {
      property: "children",
      noun: "child components",
      entryLabel: "child component",
      minItems: 1,
      maxItems: null,
    },
    behaviour: "Choose the button's action in Properties after inserting.",
  },
});

/**
 * Human labels for schema property names. Presentation only: the property names
 * themselves are what the schema test pins.
 */
const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  accessibilityLabel: "an accessibility label",
  action: "an action",
  aspectRatio: "an aspect ratio",
  assetId: "an asset",
  attribution: "an attribution",
  avatar: "an avatar",
  color: "a color",
  completedText: "completed text",
  connector: "a connector style",
  content: "content",
  contentMode: "a content mode",
  description: "a description",
  emblem: "an emblem",
  endsAt: "a UTC deadline",
  initialPageIndex: "an opening page",
  initialProductCardId: "an opening card",
  initialTabId: "an opening panel",
  initialValue: "a starting value",
  label: "a label",
  marker: "a marker",
  markerColor: "a marker color",
  markerSize: "a marker size",
  name: "a name",
  orientation: "an orientation",
  quote: "a quote",
  rating: "a rating",
  size: "a size",
  subtitle: "a subtitle",
  text: "text",
  title: "a title",
  unavailableFallback: "an unavailable-product fallback",
  value: "a value",
});

function fieldLabel(property: string) {
  return FIELD_LABELS[property] ?? property;
}

function joinFields(properties: readonly string[]) {
  const labels = properties.map(fieldLabel);
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function countSentence(collection: ComponentCollection) {
  if (collection.maxItems === null) {
    if (collection.minItems === 0) {
      return `Any number of ${collection.noun}.`;
    }
    return collection.minItems === 1
      ? `At least one ${collection.entryLabel}.`
      : `At least ${collection.minItems} ${collection.noun}.`;
  }
  return `${collection.minItems}–${collection.maxItems} ${collection.noun}.`;
}

/**
 * Renders a constraint into short sentences for the component preview card.
 * Returns an empty list only when the type has nothing authored to say, which
 * the card reports plainly rather than showing an empty section.
 */
export function constraintSentences(
  type: InsertableBlockType
): readonly string[] {
  const constraint = COMPONENT_CONSTRAINTS[type];
  const sentences: string[] = [];
  if (constraint.collection) {
    sentences.push(countSentence(constraint.collection));
    const { entry, entryLabel } = constraint.collection;
    if (entry && entry.required.length > 0) {
      const optional =
        entry.optional.length > 0
          ? `; ${joinFields(entry.optional)} ${entry.optional.length === 1 ? "is" : "are"} optional`
          : "";
      sentences.push(
        `Each ${entryLabel} needs ${joinFields(entry.required)}${optional}.`
      );
    }
  }
  if (constraint.requiredContent.length > 0) {
    sentences.push(`Requires ${joinFields(constraint.requiredContent)}.`);
  }
  if (constraint.optionalContent.length > 0) {
    sentences.push(`Optional: ${joinFields(constraint.optionalContent)}.`);
  }
  if (constraint.behaviour) {
    sentences.push(constraint.behaviour);
  }
  return sentences;
}

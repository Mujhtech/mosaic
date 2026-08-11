import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMPONENT_CONSTRAINTS,
  type SchemaFields,
} from "@/features/paywall-editor/constants/component-constraints";

/**
 * The component preview card tells authors "2–8 labelled panels", "2–12 ordered
 * entries", "rating optional". Those facts live in the protocol schema, which
 * the dashboard does not bundle. This test is the link: if a bound or a required
 * field moves in the schema, the copy Studio shows stops matching and this
 * fails, instead of the dashboard quietly telling authors an old number.
 */
const SCHEMA_RELATIVE_PATH = "protocol/schema/v0.3/paywall.schema.json";
const SCHEMA_V04_RELATIVE_PATH = "protocol/schema/v0.4/paywall.schema.json";

function locateSchema(relativePath: string) {
  let directory = process.cwd();
  for (;;) {
    const candidate = resolve(directory, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(
        `Could not locate ${relativePath} above ${process.cwd()}`
      );
    }
    directory = parent;
  }
}

interface SchemaDefinition {
  properties?: Record<string, { maxItems?: number; minItems?: number }>;
  required?: string[];
}

type SchemaDefinitions = Record<string, SchemaDefinition> | undefined;

function loadDefinitions(relativePath: string): SchemaDefinitions {
  return JSON.parse(readFileSync(locateSchema(relativePath), "utf8"))
    .$defs as SchemaDefinitions;
}

// Studio authors both contract versions, so a constraint field is legitimate
// when either schema declares it: `markerSize` on a Feature List exists only in
// 0.4, while everything 0.3 declares carries into the 0.4 superset. Required
// status is read from 0.3 (the baseline both versions share); a field only 0.4
// declares is optional by construction, because 0.4 is a pure superset whose
// additions are all optional.
const definitionsV03 = loadDefinitions(SCHEMA_RELATIVE_PATH);
const definitionsV04 = loadDefinitions(SCHEMA_V04_RELATIVE_PATH);
const definitions: SchemaDefinitions =
  definitionsV03 &&
  Object.fromEntries(
    Object.entries(definitionsV03).map(([name, definition]) => [
      name,
      {
        ...definition,
        properties: {
          ...definitionsV04?.[name]?.properties,
          ...definition.properties,
        },
      },
    ])
  );

function fieldProblems(fields: SchemaFields): string[] {
  const definition = definitions?.[fields.definition];
  if (!definition) {
    return [`$defs.${fields.definition} is missing from the paywall schema`];
  }
  const declared = new Set(Object.keys(definition.properties ?? {}));
  const required = new Set(definition.required ?? []);
  const problems: string[] = [];
  for (const property of fields.required) {
    if (!declared.has(property)) {
      problems.push(`${fields.definition}.${property} is not in the schema`);
    } else if (!required.has(property)) {
      problems.push(
        `${fields.definition}.${property} is described as required but the schema does not require it`
      );
    }
  }
  for (const property of fields.optional) {
    if (!declared.has(property)) {
      problems.push(`${fields.definition}.${property} is not in the schema`);
    } else if (required.has(property)) {
      problems.push(
        `${fields.definition}.${property} is described as optional but the schema requires it`
      );
    }
  }
  return problems;
}

function constraintProblems(
  type: string,
  constraint: (typeof COMPONENT_CONSTRAINTS)[keyof typeof COMPONENT_CONSTRAINTS]
): string[] {
  const problems = fieldProblems({
    definition: constraint.definition,
    optional: constraint.optionalContent,
    required: constraint.requiredContent,
  });

  const { collection } = constraint;
  if (!collection) {
    return problems;
  }
  const property =
    definitions?.[constraint.definition]?.properties?.[collection.property];
  if (!property) {
    problems.push(
      `${type}: ${constraint.definition}.${collection.property} is not in the schema`
    );
    return problems;
  }
  const minItems = property.minItems ?? 0;
  const maxItems = property.maxItems ?? null;
  if (minItems !== collection.minItems) {
    problems.push(
      `${type}: ${collection.property} minItems is ${minItems} in the schema but ${collection.minItems} in Studio`
    );
  }
  if (maxItems !== collection.maxItems) {
    problems.push(
      `${type}: ${collection.property} maxItems is ${maxItems} in the schema but ${collection.maxItems} in Studio`
    );
  }
  if (collection.entry) {
    problems.push(...fieldProblems(collection.entry));
  }
  return problems;
}

describe("component constraints", () => {
  it("restates the protocol schema every component preview card claims to describe", () => {
    const problems = Object.entries(COMPONENT_CONSTRAINTS).flatMap(
      ([type, constraint]) => constraintProblems(type, constraint)
    );

    expect(problems).toEqual([]);
  });
});

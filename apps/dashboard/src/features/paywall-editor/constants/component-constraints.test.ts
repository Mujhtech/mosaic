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

function locateSchema() {
  let directory = process.cwd();
  for (;;) {
    const candidate = resolve(directory, SCHEMA_RELATIVE_PATH);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(
        `Could not locate ${SCHEMA_RELATIVE_PATH} above ${process.cwd()}`
      );
    }
    directory = parent;
  }
}

interface SchemaDefinition {
  properties?: Record<string, { maxItems?: number; minItems?: number }>;
  required?: string[];
}

const definitions = JSON.parse(readFileSync(locateSchema(), "utf8")).$defs as
  | Record<string, SchemaDefinition>
  | undefined;

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

/**
 * Shared, version-neutral reporting rules for the Analytics Event contract.
 *
 * Only one Analytics Event contract version exists at a time, so these helpers
 * carry no version suffix: they describe how to turn Ajv's raw output into a
 * diagnostic an operator can act on, which is a property of the taxonomy shape
 * rather than of any particular contract version.
 */
import Ajv2020 from "ajv/dist/2020.js";

/**
 * Names the offending property for allow-list violations. Ajv reports the
 * rejected key in `params`, not in `message`, so a bare message would tell an
 * operator only that "an" unevaluated property exists. Minimization rejections
 * are only actionable if the diagnostic names the field.
 */
export function describeSchemaError(label, error) {
  const at = `${label}${error.instancePath || "/"}`;
  const offending =
    error.params?.unevaluatedProperty ?? error.params?.additionalProperty;
  if (offending !== undefined) {
    return `${at}.${offending} is not allowed`;
  }
  return `${at} ${error.message ?? "is invalid"}`;
}

export function schemaErrors(label, errors = []) {
  // "must match exactly one schema in oneOf" restates the taxonomy dispatch and
  // adds nothing once a specific cause is reported.
  const specific = errors.filter((error) => error.keyword !== "oneOf");
  const reported = specific.length > 0 ? specific : errors;
  return [...new Set(reported.map((error) => describeSchemaError(label, error)))];
}

/** Maps `eventName` to the `$defs` branch that declares it. */
function branchDefinitions(eventSchema) {
  const declared = (node) => {
    if (node === null || typeof node !== "object") return undefined;
    const name = node.properties?.eventName?.const;
    if (typeof name === "string") return name;
    for (const composed of node.allOf ?? []) {
      const found = declared(composed);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return new Map(
    Object.entries(eventSchema.$defs)
      .map(([defName, def]) => [declared(def), defName])
      .filter(([eventName]) => eventName !== undefined),
  );
}

const focusedValidatorCache = new Map();

/**
 * The event schema is a 31-way `oneOf` over `$ref` branches, so a single bad
 * field makes Ajv emit every branch's failures -- roughly 150 lines, nearly all
 * of them complaining that the document is not some other event type. An
 * operator cannot act on that.
 *
 * Once the verdict is known to be "reject", revalidate against a copy of the
 * schema whose `oneOf` contains only the branch matching the document's own
 * `eventName`. That yields the handful of errors the author actually needs.
 * Reporting only -- the accept/reject verdict always comes from the full schema.
 */
export function focusedEventSchemaErrors(label, event, eventSchema, fallback) {
  const defName = branchDefinitions(eventSchema).get(event?.eventName);
  if (defName === undefined) return schemaErrors(label, fallback);
  const cacheKey = `${eventSchema.$id}#${defName}`;
  let validate = focusedValidatorCache.get(cacheKey);
  if (validate === undefined) {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      strictRequired: false,
      strictTypes: false,
    });
    validate = ajv.compile({
      ...eventSchema,
      $id: `${eventSchema.$id}:focused:${defName}`,
      oneOf: [{ $ref: `#/$defs/${defName}` }],
    });
    focusedValidatorCache.set(cacheKey, validate);
  }
  if (validate(event)) return schemaErrors(label, fallback);
  return schemaErrors(label, validate.errors);
}

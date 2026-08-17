import type { PlacementRule } from "@/features/placement-decisions/types/placement-decision";

export function moveRule(
  rules: readonly PlacementRule[],
  ruleId: string,
  direction: "up" | "down"
) {
  const ordered = rules.toSorted(
    (left, right) => left.priority - right.priority
  );
  const index = ordered.findIndex((rule) => rule.id === ruleId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ordered.length) {
    return ordered;
  }
  const selected = ordered[index];
  const destination = ordered[target];
  if (!(selected && destination)) {
    return ordered;
  }
  ordered[index] = destination;
  ordered[target] = selected;
  return ordered.map((rule, position) => ({
    ...rule,
    priority: position * 10,
  }));
}

export function duplicateRule(
  rules: readonly PlacementRule[],
  ruleId: string,
  id: string
) {
  const ordered = rules.toSorted(
    (left, right) => left.priority - right.priority
  );
  const index = ordered.findIndex((rule) => rule.id === ruleId);
  if (index < 0 || ordered.length >= 100) {
    return ordered;
  }
  const source = ordered[index];
  if (!source) {
    return ordered;
  }
  const clone = structuredClone(source);
  clone.id = id;
  clone.name = `${source.name} copy`;
  ordered.splice(index + 1, 0, clone);
  return ordered.map((rule, position) => ({
    ...rule,
    priority: position * 10,
  }));
}

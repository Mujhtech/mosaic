export function openPlacementRule(ruleId: string, openRulesTab: () => void) {
  openRulesTab();
  requestAnimationFrame(() => {
    const rule = document.getElementById(`rule-${ruleId}`);
    rule?.focus({ preventScroll: true });
    rule?.scrollIntoView({ block: "start" });
  });
}

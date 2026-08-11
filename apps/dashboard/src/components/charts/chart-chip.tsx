/**
 * A pressed-state chip for the small exclusive choices a chart owns — which
 * measure is drawn, and over how long a window.
 *
 * It is a toggle rather than a link or a select because the choice changes only
 * what the chart beside it draws, and `aria-pressed` is what conveys that to a
 * reader without a visible label per option.
 */
export function ChartChip({
  label,
  onSelect,
  selected,
}: {
  label: string;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`rounded-full border px-2.5 py-1 font-medium text-xs transition-colors ${
        selected
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
      }`}
      onClick={onSelect}
      type="button"
    >
      {label}
    </button>
  );
}

/**
 * Environment and Application scope selection shared by every server-connected
 * provider sheet. A connection is only ever resolved inside a scope it names,
 * so the same control — and the same "create the scope first" recovery — has to
 * behave identically no matter which provider is being connected.
 */
export function ConnectionScopeField({
  error,
  emptyDescription,
  emptyHref,
  items,
  label,
  onChange,
  selected,
}: {
  error?: string;
  emptyDescription: string;
  emptyHref: string;
  items: readonly { description: string; id: string; label: string }[];
  label: string;
  onChange: (value: string[]) => void;
  selected: readonly string[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium text-sm">{label}</legend>
      {items.length === 0 ? (
        <div className="rounded border border-dashed p-3 text-xs">
          <p className="text-muted-foreground">{emptyDescription}</p>
          <a
            className="mt-2 inline-flex font-semibold text-primary"
            href={emptyHref}
          >
            Create scope
          </a>
        </div>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <label
              className="flex items-start gap-3 rounded border p-3 text-sm"
              key={item.id}
            >
              <input
                checked={selected.includes(item.id)}
                className="mt-0.5 size-4 accent-primary"
                onChange={(event) =>
                  onChange(
                    event.currentTarget.checked
                      ? [...selected, item.id]
                      : selected.filter((id) => id !== item.id)
                  )
                }
                type="checkbox"
              />
              <span>
                <span className="block font-medium">{item.label}</span>
                <span className="mt-0.5 block text-muted-foreground text-xs">
                  {item.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

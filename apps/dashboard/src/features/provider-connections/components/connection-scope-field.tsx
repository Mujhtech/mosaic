/**
 * Whether each scope list was actually read, so a sheet can tell an empty
 * Project from an unread one. Both sheets take the same shape because both
 * render the same two scope fields from the same two Project reads.
 */
export interface ConnectionScopeReads {
  applicationsUnreadable?: boolean;
  environmentsUnreadable?: boolean;
  onRetryScopes?: () => void;
}

export const UNREADABLE_ENVIRONMENT_SCOPES =
  "Mosaic could not read this Project's Environments, so it cannot say which scopes exist. Nothing has been created or connected.";

export const UNREADABLE_APPLICATION_SCOPES =
  "Mosaic could not read this Project's Applications, so it cannot say which scopes exist. Nothing has been created or connected.";

/**
 * Environment and Application scope selection shared by every server-connected
 * provider sheet. A connection is only ever resolved inside a scope it names,
 * so the same control — and the same "create the scope first" recovery — has to
 * behave identically no matter which provider is being connected.
 *
 * An unread list is never treated as an empty one. "Create this scope first" is
 * an instruction derived from the source, and telling an operator to create an
 * Environment that may already exist is worse than saying nothing: it invites a
 * duplicate against a Project Mosaic could not see.
 */
export function ConnectionScopeField({
  error,
  emptyDescription,
  emptyHref,
  items,
  label,
  onChange,
  onRetry,
  selected,
  unreadableDescription,
}: {
  error?: string;
  emptyDescription: string;
  emptyHref: string;
  items: readonly { description: string; id: string; label: string }[];
  label: string;
  onChange: (value: string[]) => void;
  onRetry?: () => void;
  selected: readonly string[];
  /** Present only when the list could not be read at all. */
  unreadableDescription?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium text-sm">{label}</legend>
      {unreadableDescription ? (
        <div
          className="rounded border border-destructive/25 bg-destructive/5 p-3 text-xs"
          role="alert"
        >
          <p className="text-destructive">{unreadableDescription}</p>
          {onRetry ? (
            <button
              className="mt-2 inline-flex font-semibold text-primary"
              onClick={onRetry}
              type="button"
            >
              Retry loading scopes
            </button>
          ) : null}
        </div>
      ) : null}
      {!unreadableDescription && items.length === 0 ? (
        <div className="rounded border border-dashed p-3 text-xs">
          <p className="text-muted-foreground">{emptyDescription}</p>
          <a
            className="mt-2 inline-flex font-semibold text-primary"
            href={emptyHref}
          >
            Create scope
          </a>
        </div>
      ) : null}
      {unreadableDescription || items.length === 0 ? null : (
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

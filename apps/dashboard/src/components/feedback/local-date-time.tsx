import { useEffect, useState } from "react";

/** The spec-default equivalent of `Date#toLocaleString()` with no arguments. */
const LOCAL_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  month: "numeric",
  second: "numeric",
  year: "numeric",
});

/**
 * Renders an instant in the viewer's locale without a hydration mismatch.
 *
 * `Intl` formats with the *server's* locale and timezone during server
 * rendering, so the same instant would render as different text on the
 * client. The server and the hydration pass therefore render the stable ISO
 * form, and a post-mount effect swaps in the viewer's local form — the only
 * render where the browser's locale is actually known.
 */
export function LocalDateTime({ value }: { value: Date | number | string }) {
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString();
  const [label, setLabel] = useState(iso);
  useEffect(() => {
    setLabel(LOCAL_DATE_TIME_FORMATTER.format(new Date(iso)));
  }, [iso]);
  return <time dateTime={iso}>{label}</time>;
}

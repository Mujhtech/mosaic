/**
 * Always-mounted screen-reader announcement region.
 *
 * A live region that is mounted at the same moment its text appears is
 * frequently missed by assistive technology. Mosaic keeps one empty region in
 * the tree per surface and only changes its text, so every announcement is
 * observed as a content change.
 */
export function LiveAnnouncer({
  assertive = false,
  message,
}: {
  assertive?: boolean;
  message?: string;
}) {
  return (
    <div
      aria-atomic="true"
      aria-live={assertive ? "assertive" : "polite"}
      className="sr-only"
      data-slot="live-announcer"
      role={assertive ? "alert" : "status"}
    >
      {message ?? ""}
    </div>
  );
}

/** Describes one page without implying that the visible records are the total. */
export function pagedListHeading({
  count,
  cursor,
  nextCursor,
  noun,
}: {
  count: number;
  cursor: string | undefined;
  nextCursor: string | undefined;
  noun: string;
}) {
  if (!(cursor || nextCursor)) {
    return `All ${count} ${noun}`;
  }
  if (nextCursor) {
    return `Showing ${count} ${noun} on this page — more follow`;
  }
  return `Showing ${count} ${noun} on the last page`;
}

/** Describes a server-bounded embedded list whose surface has no cursor. */
export function cappedListHeading({
  cap,
  count,
  noun,
  totalCount,
}: {
  cap: number;
  count: number;
  noun: string;
  totalCount: number | undefined;
}) {
  if (totalCount !== undefined && totalCount > count) {
    return `Showing ${count} of ${totalCount} ${noun}`;
  }
  if (totalCount !== undefined) {
    return `All ${count} ${noun}`;
  }
  if (count >= cap) {
    return `Showing the ${cap} most recent ${noun} — more may exist`;
  }
  return `All ${count} ${noun}`;
}

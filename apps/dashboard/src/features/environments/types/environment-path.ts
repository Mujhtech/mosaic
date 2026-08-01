// Every Project surface names its Environment the same way: the segment after
// `env`, carrying a readable alias rather than an id.
//
//   /orgs/O/projects/P/env/prod/billing/quarantine/rec_01
const ENVIRONMENT_SEGMENT = "env";

/**
 * Rewrites the Environment alias in place, so switching keeps the operator on the
 * surface they are reading. Returns null when the path names no Environment, which
 * is how the caller knows there is nothing to switch.
 *
 * The match is anchored on the current alias rather than on position alone, so a
 * path that happens to contain the word `env` elsewhere cannot be rewritten by
 * accident.
 */
export function switchEnvironmentPath(
  pathname: string,
  currentAlias: string,
  nextAlias: string
): string | null {
  if (currentAlias === "" || nextAlias === "") {
    return null;
  }

  const segments = pathname.split("/");
  const index = segments.indexOf(ENVIRONMENT_SEGMENT);
  if (index === -1 || segments[index + 1] !== currentAlias) {
    return null;
  }

  const rewritten = [...segments];
  rewritten[index + 1] = nextAlias;
  return rewritten.join("/");
}

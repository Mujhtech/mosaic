/**
 * Asserts that a fixture lookup found something, and returns it narrowed.
 *
 * Tests know their fixtures, so `templates[0]!.document` is honest about
 * intent — but when the assumption breaks, `!` defers the failure to whatever
 * reads the property next, and the test reports "cannot read properties of
 * undefined" from somewhere unrelated. This fails at the lookup, naming it.
 */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to exist in this fixture`);
  }
  return value;
}

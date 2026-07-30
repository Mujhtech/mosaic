import type { Environment } from "@/generated/api"

/**
 * The Environment as it appears in an address: `prod`, `staging`, `dev` rather than
 * `env_01H8X...`. A URL an operator can read and type is worth more than an opaque
 * id, and the id is an implementation detail the address has no reason to leak.
 *
 * A Project's Environments are seeded once, on creation, with the keys below and no
 * endpoint adds more, so this mapping is total in practice. The fallback to the raw
 * key keeps an address resolvable if that ever changes.
 */
const ALIAS_BY_KEY: Record<string, string> = {
  development: "dev",
  production: "prod",
  staging: "staging",
}

/**
 * Where a link lands when the linker has no Environment to go on — workspace entry,
 * for instance, which resolves before any Environment list is read. Development on
 * purpose: an address that guesses must never guess production.
 */
export const DEFAULT_ENVIRONMENT_ALIAS = "dev"

const KEY_BY_ALIAS: Record<string, string> = {
  dev: "development",
  prod: "production",
  staging: "staging",
}

export function environmentAlias(environment: Environment) {
  return ALIAS_BY_KEY[environment.key] ?? environment.key
}

/**
 * Resolves an address segment to the Environment it names, by alias or by the
 * underlying key. Ids are deliberately not accepted: the address does not carry
 * them, so a segment that looks like one is a malformed link, not a scope.
 */
export function environmentForAlias(
  environments: readonly Environment[],
  alias: string | undefined,
): Environment | undefined {
  if (!alias) return undefined

  const key = KEY_BY_ALIAS[alias]
  return environments.find(
    (environment) =>
      environmentAlias(environment) === alias ||
      environment.key === alias ||
      (key !== undefined && environment.key === key),
  )
}

import { describe, expect, it } from "vitest";
import {
  environmentAlias,
  environmentForAlias,
} from "@/features/environments/types/environment-alias";
import type { Environment } from "@/generated/api";

const timestamps = {
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
};

function environment(
  id: string,
  key: string,
  mode: Environment["mode"]
): Environment {
  return { ...timestamps, id, key, mode, name: key, projectId: "prj_01" };
}

const development = environment("env_01", "development", "development");
const staging = environment("env_02", "staging", "staging");
const production = environment("env_03", "production", "production");
const all = [development, staging, production];

describe("environment aliases", () => {
  it("shortens the seeded keys for the address", () => {
    expect(environmentAlias(development)).toBe("dev");
    expect(environmentAlias(staging)).toBe("staging");
    expect(environmentAlias(production)).toBe("prod");
  });

  it("falls back to the key it cannot shorten", () => {
    expect(environmentAlias(environment("env_04", "canary", "staging"))).toBe(
      "canary"
    );
  });

  it("resolves an alias back to its Environment", () => {
    expect(environmentForAlias(all, "prod")).toBe(production);
    expect(environmentForAlias(all, "dev")).toBe(development);
    expect(environmentForAlias(all, "staging")).toBe(staging);
  });

  it("also accepts the underlying key", () => {
    expect(environmentForAlias(all, "development")).toBe(development);
    expect(environmentForAlias(all, "production")).toBe(production);
  });

  it("rejects an id, which the address never carries", () => {
    // A segment that looks like an id is a malformed link rather than a scope,
    // so it must not resolve. `switchEnvironmentPath` holds the same line.
    expect(environmentForAlias(all, "env_03")).toBeUndefined();
  });

  it("resolves nothing for an absent or unknown segment", () => {
    expect(environmentForAlias(all, undefined)).toBeUndefined();
    expect(environmentForAlias(all, "")).toBeUndefined();
    // A literal from a sibling route must not resolve to an Environment.
    expect(environmentForAlias(all, "connections")).toBeUndefined();
  });

  it("round-trips every seeded Environment", () => {
    for (const value of all) {
      expect(environmentForAlias(all, environmentAlias(value))).toBe(value);
    }
  });
});

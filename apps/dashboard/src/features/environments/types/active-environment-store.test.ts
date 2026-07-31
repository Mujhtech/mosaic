import { afterEach, describe, expect, it, vi } from "vitest";

import {
  rememberEnvironmentId,
  rememberedEnvironmentId,
  resetActiveEnvironmentStore,
  subscribeToActiveEnvironment,
} from "@/features/environments/types/active-environment-store";

afterEach(() => {
  resetActiveEnvironmentStore();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("active environment store", () => {
  it("keeps one value per Project", () => {
    rememberEnvironmentId("prj_01", "env_prod");
    rememberEnvironmentId("prj_02", "env_dev");

    expect(rememberedEnvironmentId("prj_01")).toBe("env_prod");
    expect(rememberedEnvironmentId("prj_02")).toBe("env_dev");
    expect(rememberedEnvironmentId("prj_unknown")).toBeUndefined();
  });

  it("returns a stable primitive so a subscribing reader does not loop", () => {
    rememberEnvironmentId("prj_01", "env_prod");

    // useSyncExternalStore compares snapshots by identity; an object would make
    // every read look like a change.
    expect(rememberedEnvironmentId("prj_01")).toBe(
      rememberedEnvironmentId("prj_01")
    );
  });

  it("notifies readers on a change, and not on a repeat of the same value", () => {
    const listener = vi.fn();
    subscribeToActiveEnvironment(listener);
    listener.mockClear();

    rememberEnvironmentId("prj_01", "env_prod");
    expect(listener).toHaveBeenCalledTimes(1);

    rememberEnvironmentId("prj_01", "env_prod");
    expect(listener).toHaveBeenCalledTimes(1);

    rememberEnvironmentId("prj_01", "env_dev");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToActiveEnvironment(listener);
    unsubscribe();
    listener.mockClear();

    rememberEnvironmentId("prj_01", "env_prod");

    expect(listener).not.toHaveBeenCalled();
  });

  it("recovers the choice from storage on the first subscription", () => {
    window.localStorage.setItem("mosaic.activeEnvironment.prj_01", "env_prod");

    // Hydration is deferred to subscribe, which runs in an effect: reading storage
    // during render would report a value the server-rendered HTML did not have.
    expect(rememberedEnvironmentId("prj_01")).toBeUndefined();
    subscribeToActiveEnvironment(() => {});
    expect(rememberedEnvironmentId("prj_01")).toBe("env_prod");
  });

  it("ignores unrelated storage keys", () => {
    window.localStorage.setItem("unrelated.prj_01", "env_prod");
    subscribeToActiveEnvironment(() => {});

    expect(rememberedEnvironmentId("prj_01")).toBeUndefined();
  });

  it("keeps working in memory when storage refuses the write", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => rememberEnvironmentId("prj_01", "env_prod")).not.toThrow();
    expect(rememberedEnvironmentId("prj_01")).toBe("env_prod");
  });

  it("refuses a blank Project or Environment rather than storing an empty key", () => {
    rememberEnvironmentId("", "env_prod");
    rememberEnvironmentId("prj_01", "");

    expect(rememberedEnvironmentId("")).toBeUndefined();
    expect(rememberedEnvironmentId("prj_01")).toBeUndefined();
  });
});

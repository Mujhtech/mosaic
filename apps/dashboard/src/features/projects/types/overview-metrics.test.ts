import { describe, expect, it } from "vitest";

import { defaultOverviewEnvironment } from "@/features/projects/types/overview-metrics";
import type { Environment } from "@/generated/api";

function environment(key: string): Environment {
  return {
    createdAt: "2026-07-30T00:00:00Z",
    id: `env_${key}`,
    key,
    mode: "development",
    name: key,
    projectId: "prj_01",
    updatedAt: "2026-07-30T00:00:00Z",
  };
}

describe("default overview Environment", () => {
  it("reports production when the Project has one", () => {
    const selected = defaultOverviewEnvironment([
      environment("development"),
      environment("staging"),
      environment("production"),
    ]);

    expect(selected?.key).toBe("production");
  });

  it("falls back to staging before the first Environment in the list", () => {
    const selected = defaultOverviewEnvironment([
      environment("development"),
      environment("staging"),
    ]);

    expect(selected?.key).toBe("staging");
  });

  it("falls back to the first Environment when neither is present", () => {
    const selected = defaultOverviewEnvironment([
      environment("development"),
      environment("qa"),
    ]);

    expect(selected?.key).toBe("development");
  });

  it("keeps a remembered choice ahead of the preference order", () => {
    const selected = defaultOverviewEnvironment(
      [environment("production"), environment("staging")],
      "env_staging"
    );

    expect(selected?.key).toBe("staging");
  });

  it("ignores a remembered Environment that is not in this Project", () => {
    const selected = defaultOverviewEnvironment(
      [environment("production"), environment("staging")],
      "env_from_another_project"
    );

    expect(selected?.key).toBe("production");
  });
});

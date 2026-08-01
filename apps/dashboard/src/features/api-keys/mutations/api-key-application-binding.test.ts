import { describe, expect, it } from "vitest";

import { buildApiKeyCreationInput } from "./api-key-mutations";

describe("analytics-capable SDK key binding", () => {
  it("requires one Application for public SDK keys and never binds server keys", () => {
    expect(buildApiKeyCreationInput("public_sdk", "application_ios")).toEqual({
      kind: "public_sdk",
      applicationId: "application_ios",
    });
    expect(() => buildApiKeyCreationInput("public_sdk")).toThrow(
      /Select an Application/
    );
    expect(
      buildApiKeyCreationInput("secret_server", "application_ios")
    ).toEqual({
      kind: "secret_server",
    });
  });
});

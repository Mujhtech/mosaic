import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createProviderConnection = vi.fn();
const testProviderConnection = vi.fn();

vi.mock("@/generated/api", () => ({
  clearActiveProviderAssignment: vi.fn(),
  createProviderConnection,
  enqueueProviderSync: vi.fn(),
  importProviderProducts: vi.fn(),
  reconnectProviderConnection: vi.fn(),
  revokeProviderConnection: vi.fn(),
  rotateProviderCredential: vi.fn(),
  setActiveProviderAssignment: vi.fn(),
  testProviderConnection,
}));

const {
  createAndTestAppStoreConnectMutationOptions,
  ProviderConnectionCreatedButTestFailed,
} = await import(
  "@/features/provider-connections/mutations/provider-connection-mutations"
);

/**
 * Risk: the API rejects `externalProjectId` for `app_store_connect` outright —
 * an App Store Connect API key is issued per Apple team and names no second
 * project resource. Sending the field, even empty, fails every connect attempt.
 * The generalized create-then-test helper is shared with RevenueCat, which
 * requires that same field, so the omission is exactly the kind of detail a
 * later refactor of the shared helper can quietly reintroduce.
 */

const input = {
  applicationIds: ["app_1"],
  credential: '{"privateKey":"pem","keyId":"ABCDE12345","issuerId":"uuid"}',
  environmentIds: ["env_1"],
  mode: "sandbox" as const,
  name: "App Store Connect sandbox",
};

const connection = { id: "conn_1", name: "App Store Connect sandbox" };

describe("createAndTestAppStoreConnectMutationOptions", () => {
  beforeEach(() => {
    createProviderConnection.mockResolvedValue({
      data: { data: connection },
    });
    testProviderConnection.mockResolvedValue({
      data: { data: { status: "healthy" } },
    });
  });

  it("names the App Store Connect provider and sends no externalProjectId", async () => {
    const client = new QueryClient();
    const options = createAndTestAppStoreConnectMutationOptions(
      "proj_1",
      client
    );

    await options.mutationFn?.(input, { client, meta: undefined });

    const [request] = createProviderConnection.mock.calls[0] ?? [];
    expect(request.body.provider).toBe("app_store_connect");
    expect(request.body.integrationMode).toBe("server_connected");
    expect(request.body.credential).toBe(input.credential);
    expect(Object.keys(request.body)).not.toContain("externalProjectId");
    expect(request.path).toEqual({ projectId: "proj_1" });
  });

  it("surfaces the created connection when its first test fails", async () => {
    testProviderConnection.mockRejectedValue(new Error("credentialInvalid"));
    const client = new QueryClient();
    const options = createAndTestAppStoreConnectMutationOptions(
      "proj_1",
      client
    );

    // The connection exists even though the test failed. Reporting a bare
    // failure would strand it: the operator needs the link to retest or rotate.
    await expect(
      options.mutationFn?.(input, { client, meta: undefined })
    ).rejects.toBeInstanceOf(ProviderConnectionCreatedButTestFailed);
  });
});

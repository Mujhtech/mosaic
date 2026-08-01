import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  apiKeySecretMutationKey,
  clearApiKeySecretMutationCache,
  transferApiKeySecret,
} from "@/features/api-keys/mutations/api-key-secret-cache";
import type { ApiKeySecretResult } from "@/generated/api";

const secretResult: ApiKeySecretResult = {
  apiKey: {
    createdAt: "2026-07-20T18:00:00Z",
    createdByActorId: "actor_one",
    environmentId: "environment_one",
    id: "key_one",
    kind: "secret_server",
    prefix: "mosaic_secret_",
  },
  secret: "mosaic_secret_raw_value",
};

function ObserverHarness() {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<ApiKeySecretResult | null>(null);
  const mutation = useMutation({
    mutationFn: async (secret: string) => ({ ...secretResult, secret }),
    mutationKey: apiKeySecretMutationKey("environment_one", "rotate"),
  });

  const reveal = useCallback(
    (result: ApiKeySecretResult) => {
      transferApiKeySecret(queryClient, result, setRevealed, mutation.reset);
    },
    [mutation, queryClient]
  );

  const handleClick2 = useCallback(
    () => mutation.mutate("mosaic_secret_second", { onSuccess: reveal }),
    [mutation, reveal]
  );
  const handleClick = useCallback(
    () => mutation.mutate("mosaic_secret_first", { onSuccess: reveal }),
    [mutation, reveal]
  );
  function dismiss() {
    setRevealed(null);
    mutation.reset();
    clearApiKeySecretMutationCache(queryClient);
  }

  return (
    <>
      <button onClick={handleClick} type="button">
        Reveal first
      </button>
      <button onClick={handleClick2} type="button">
        Replace secret
      </button>
      <button onClick={dismiss} type="button">
        Dismiss
      </button>
      <output aria-label="revealed secret">
        {revealed?.secret ?? "empty"}
      </output>
      <output aria-label="observer secret">
        {mutation.data?.secret ?? "empty"}
      </output>
    </>
  );
}

describe("API-key mutation secret hygiene", () => {
  it("removes raw secret mutation data immediately after transferring it to reveal state", async () => {
    const queryClient = new QueryClient();
    const reveal = vi.fn();
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => secretResult,
      mutationKey: apiKeySecretMutationKey("environment_one", "rotate"),
      onSuccess: (result) =>
        transferApiKeySecret(queryClient, result, reveal, () => undefined),
    });

    await mutation.execute(undefined);

    expect(reveal).toHaveBeenCalledWith(secretResult);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it("sanitizes the active useMutation observer on transfer, replacement, and dismissal", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ObserverHarness />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Reveal first" }));
    expect(await screen.findByLabelText("revealed secret")).toHaveTextContent(
      "mosaic_secret_first"
    );
    expect(screen.getByLabelText("observer secret")).toHaveTextContent("empty");
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Replace secret" }));
    await waitFor(() =>
      expect(screen.getByLabelText("revealed secret")).toHaveTextContent(
        "mosaic_secret_second"
      )
    );
    expect(document.body).not.toHaveTextContent("mosaic_secret_first");
    expect(screen.getByLabelText("observer secret")).toHaveTextContent("empty");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByLabelText("revealed secret")).toHaveTextContent("empty");
    expect(screen.getByLabelText("observer secret")).toHaveTextContent("empty");
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
});

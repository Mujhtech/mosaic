import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback } from "react";
import { describe, expect, it, vi } from "vitest";

import { MigrationImpactReviewAction } from "@/features/billing-migrations/components/migration-impact-review-action";
import { useMigrationCommand } from "@/features/billing-migrations/hooks/use-migration-command";
import { ApiError } from "@/lib/api/errors";

function StaleHarness({ onStale }: { onStale: () => Promise<unknown> }) {
  const command = useMigrationCommand(onStale);
  const handleClick = useCallback(
    () =>
      command.run(
        () =>
          Promise.reject(
            new ApiError("raw conflict", {
              code: "migration_state_conflict",
              correlationId: "request_1",
              retryable: false,
              status: 409,
            })
          ),
        "freeze"
      ),
    [command]
  );
  return (
    <>
      <button onClick={handleClick}>Freeze</button>
      {command.error ? <p role="alert">{command.error}</p> : null}
    </>
  );
}

describe("migration command components", () => {
  it("keeps disabled prerequisite copy programmatically associated with the command", () => {
    render(
      <MigrationImpactReviewAction
        actionLabel="Queue import"
        binding="import:4:manifest_1:mapping_1:100"
        disabledReason="Freeze a reviewed mapping set before importing."
        facts={[{ label: "Program state version", value: "4" }]}
        isPending={false}
        onConfirm={vi.fn()}
        pendingLabel="Queueing…"
        title="Review import impact"
      />
    );
    const button = screen.getByRole("button", { name: "Queue import" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "Freeze a reviewed mapping set before importing."
    );
    expect(
      screen.getByText(/does not change billing authority or customer access/)
    ).toBeInTheDocument();
  });

  it("requires confirmation for the exact reviewed command inputs", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <MigrationImpactReviewAction
        actionLabel="Queue import"
        binding="import:4:manifest_1:mapping_1:100"
        disabledReason={null}
        facts={[
          { label: "Manifest", value: "manifest_1" },
          { label: "Record count", value: "100" },
        ]}
        isPending={false}
        onConfirm={onConfirm}
        pendingLabel="Queueing…"
        title="Review import impact"
      />
    );

    const button = screen.getByRole("button", { name: "Queue import" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "data-impact-binding",
      "import:4:manifest_1:mapping_1:100"
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Confirm Queue import" })
    );
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();

    rerender(
      <MigrationImpactReviewAction
        actionLabel="Queue import"
        binding="import:5:manifest_2:mapping_1:120"
        disabledReason={null}
        facts={[
          { label: "Manifest", value: "manifest_2" },
          { label: "Record count", value: "120" },
        ]}
        isPending={false}
        onConfirm={onConfirm}
        pendingLabel="Queueing…"
        title="Review import impact"
      />
    );
    expect(screen.getByRole("button", { name: "Queue import" })).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Confirm Queue import" })
    ).not.toBeChecked();
  });

  it("refetches stale state and shows safe review-before-retry copy", async () => {
    const onStale = vi.fn().mockResolvedValue(undefined);
    render(<StaleHarness onStale={onStale} />);
    fireEvent.click(screen.getByRole("button", { name: "Freeze" }));
    await waitFor(() => expect(onStale).toHaveBeenCalledOnce());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Mosaic refreshed the latest state"
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("raw conflict");
  });
});

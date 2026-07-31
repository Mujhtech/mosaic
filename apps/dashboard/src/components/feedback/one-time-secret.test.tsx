import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { OneTimeSecret } from "@/components/feedback/one-time-secret";

function SecretHarness({
  writeToClipboard,
}: {
  writeToClipboard: (value: string) => Promise<void>;
}) {
  const [visible, setVisible] = useState(true);

  return visible ? (
    <OneTimeSecret
      onDismiss={() => setVisible(false)}
      secret="mosaic_test_secret"
      writeToClipboard={writeToClipboard}
    />
  ) : null;
}

describe("one-time API-key secret", () => {
  it("copies the raw secret and permanently removes it from the current view on dismissal", async () => {
    const writeToClipboard = vi.fn(async () => undefined);
    render(<SecretHarness writeToClipboard={writeToClipboard} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy secret" }));
    expect(writeToClipboard).toHaveBeenCalledWith("mosaic_test_secret");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss one-time secret" })
    );
    expect(screen.queryByText("mosaic_test_secret")).not.toBeInTheDocument();
  });
});

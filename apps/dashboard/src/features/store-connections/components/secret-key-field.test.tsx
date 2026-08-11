import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { SecretKeyField } from "@/features/store-connections/components/secret-key-field";

const P8_CONTENTS =
  "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEH\n-----END PRIVATE KEY-----";

function Harness({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <SecretKeyField
      accept=".p8,.pem"
      description="Read in this browser only."
      errors={[]}
      fileKindLabel=".p8 key file"
      id="secret"
      label="In-App Purchase key (.p8)"
      onBlur={() => undefined}
      onChange={setValue}
      value={value}
    />
  );
}

describe("SecretKeyField", () => {
  it("reads a chosen key file into form state and shows the file name", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("In-App Purchase key (.p8)");
    const file = new File([P8_CONTENTS], "AuthKey_ABC123DEF4.p8", {
      type: "application/pkcs8",
    });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("AuthKey_ABC123DEF4.p8")).toBeInTheDocument();
    });
    expect(screen.getByText("key loaded")).toBeInTheDocument();
  });

  it("clears the loaded key when removed and returns to the upload prompt", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("In-App Purchase key (.p8)");
    const file = new File([P8_CONTENTS], "AuthKey_ABC123DEF4.p8", {
      type: "application/pkcs8",
    });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("key loaded");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.queryByText("key loaded")).not.toBeInTheDocument();
    expect(screen.getByText("Choose file")).toBeInTheDocument();
  });

  it("offers no paste mode — the key file is the only input", () => {
    render(<Harness />);

    expect(screen.queryByText(/paste/i)).not.toBeInTheDocument();
    const input = screen.getByLabelText("In-App Purchase key (.p8)");
    expect(input).toHaveAttribute("type", "file");
  });
});

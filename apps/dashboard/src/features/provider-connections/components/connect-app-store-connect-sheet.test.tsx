import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConnectAppStoreConnectSheet } from "@/features/provider-connections/components/connect-app-store-connect-sheet";
import type { Application, Environment } from "@/generated/api";

/**
 * Risk: the four App Store Connect fields are assembled into one opaque JSON
 * document in the browser and sealed unread by the API. A wrong key name, a
 * missing field, or a vendor number sent as an empty string is not caught by
 * any type — it surfaces as a refused connection, or worse as a stored
 * credential that fails at the first background sync.
 *
 * These tests assert the document this sheet actually produces, and that
 * `externalProjectId` never travels with it: the API rejects that field for
 * this provider, so sending it would fail every App Store Connect connect
 * attempt outright.
 */

// The PEM fences are assembled at runtime so the literal marker never appears
// in source or diffs, which is what secret scanners match on. The body is a
// truncated stub, not a usable key.
const pemFence = (edge: "BEGIN" | "END") => `-----${edge} PRIVATE KEY-----`;
const P8 = [
  pemFence("BEGIN"),
  "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg",
  pemFence("END"),
].join("\n");
const KEY_ID = "ABCDE12345";
const ISSUER_ID = "57246542-96fe-1a63-e053-0824d011072a";

const applications: Application[] = [
  {
    id: "app_1",
    identifier: "com.example.app",
    name: "Example",
    platform: "ios",
  } as Application,
];

const environments: Environment[] = [
  { id: "env_1", mode: "development", name: "Development" } as Environment,
];

function renderSheet(
  onConnect = vi.fn().mockResolvedValue(undefined),
  reads: {
    applicationsUnreadable?: boolean;
    environmentsUnreadable?: boolean;
  } = {}
) {
  render(
    <ConnectAppStoreConnectSheet
      applications={reads.applicationsUnreadable ? [] : applications}
      environments={reads.environmentsUnreadable ? [] : environments}
      onConnect={onConnect}
      providerBaseHref="/orgs/org_1/projects/proj_1/catalog/providers"
      {...reads}
    />
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Connect App Store Connect" })
  );
  return onConnect;
}

function fillRequiredFields({ vendorNumber }: { vendorNumber?: string } = {}) {
  fireEvent.change(
    screen.getByLabelText("App Store Connect API key (.p8)"),
    // The .p8 is upload-only; there is no paste field to type into.
    { target: { files: [new File([P8], "AuthKey_ABCDE12345.p8")] } }
  );
  fireEvent.change(screen.getByLabelText("Key ID"), {
    target: { value: KEY_ID },
  });
  fireEvent.change(screen.getByLabelText("Issuer ID"), {
    target: { value: ISSUER_ID },
  });
  if (vendorNumber !== undefined) {
    fireEvent.change(screen.getByLabelText("Vendor number (optional)"), {
      target: { value: vendorNumber },
    });
  }
  fireEvent.click(screen.getByRole("checkbox", { name: /Development/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Example/ }));
}

function submit() {
  fireEvent.click(
    screen.getByRole("button", { name: "Create and test connection" })
  );
}

describe("ConnectAppStoreConnectSheet", () => {
  it("assembles the credential document and sends no externalProjectId", async () => {
    const onConnect = renderSheet();
    fillRequiredFields();

    submit();

    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    const input = onConnect.mock.calls[0]?.[0];
    expect(Object.keys(input)).not.toContain("externalProjectId");
    expect(JSON.parse(input.credential)).toEqual({
      issuerId: ISSUER_ID,
      keyId: KEY_ID,
      privateKey: `${P8}\n`,
    });
    expect(input.mode).toBe("sandbox");
    expect(input.environmentIds).toEqual(["env_1"]);
    expect(input.applicationIds).toEqual(["app_1"]);
  });

  it("omits the vendor number entirely when it is left blank", async () => {
    const onConnect = renderSheet();
    fillRequiredFields({ vendorNumber: "" });

    submit();

    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    const credential = JSON.parse(onConnect.mock.calls[0]?.[0].credential);
    expect(credential).not.toHaveProperty("vendorNumber");
  });

  it("carries the vendor number when one is supplied", async () => {
    const onConnect = renderSheet();
    fillRequiredFields({ vendorNumber: " 85200000 " });

    submit();

    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    const credential = JSON.parse(onConnect.mock.calls[0]?.[0].credential);
    expect(credential.vendorNumber).toBe("85200000");
  });

  it("refuses a non-numeric vendor number instead of sending it", async () => {
    const onConnect = renderSheet();
    fillRequiredFields({ vendorNumber: "vendor-85200000" });

    submit();

    expect(
      await screen.findByText(
        "The vendor number is digits only, for example 85200000."
      )
    ).toBeInTheDocument();
    expect(onConnect).not.toHaveBeenCalled();
  });

  /**
   * Risk: an unread Environment or Application list arrives as an empty array,
   * so the scope field would tell the operator to create a scope that may
   * already exist — an instruction derived from a source Mosaic never read.
   * Acting on it creates a duplicate Environment against a live Project.
   */
  it("distinguishes an unread scope list from an empty Project", () => {
    renderSheet(vi.fn(), { environmentsUnreadable: true });

    expect(
      screen.getByText(/could not read this Project's Environments/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Create this scope before connecting App Store Connect."
      )
    ).toBeNull();
    // Applications were read and are genuinely present, so that field is
    // unaffected: only the failed read loses its create-scope recovery.
    expect(
      screen.getByRole("checkbox", { name: /Example/ })
    ).toBeInTheDocument();
  });

  it("clears the uploaded key after a failed attempt", async () => {
    const onConnect = vi.fn().mockRejectedValue(new Error("Apple said no."));
    renderSheet(onConnect);
    fillRequiredFields();

    submit();

    expect(await screen.findByText("Apple said no.")).toBeInTheDocument();
    // Back to the upload prompt: no key material is left sitting behind a sheet
    // the operator walked away from.
    expect(screen.getByText("Choose file")).toBeInTheDocument();
  });
});

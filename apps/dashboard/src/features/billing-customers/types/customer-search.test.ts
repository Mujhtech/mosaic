import { describe, expect, it } from "vitest";

import {
  customerIdentifierTypes,
  describeLookupMiss,
  identifierTypeHelp,
  MAX_IDENTIFIER_LENGTH,
  SEARCH_HELPER_TEXT,
  validateCustomerSearch,
} from "@/features/billing-customers/types/customer-search";

/**
 * Customer lookup is typed-identifier only.
 *
 * Two risks are protected. The first is scope creep into free-text search:
 * Mosaic Billing stores aliases as digests and holds no names or email
 * addresses, so a free-text box could only ever be answered by personal data
 * the storage design exists to avoid keeping — and offering the box teaches
 * operators that the data is there. The accepted set is asserted here so
 * widening it is a deliberate, reviewed change rather than a one-line addition.
 *
 * The second is a miss being rendered as a failure. The API answers
 * `200 {found:false}` precisely so "this person has no billing record" reads as
 * an answer; a red error banner would read as "Mosaic is broken" and send an
 * operator debugging instead of concluding.
 */
describe("customer lookup identifier gating", () => {
  it("accepts exactly the three Mosaic-issued identifier types", () => {
    expect(customerIdentifierTypes).toEqual([
      "billing_customer_id",
      "application_user_id",
      "installation_id",
    ]);
  });

  it.each(["email", "name", "display_name", "receipt", ""])(
    "refuses the unsupported identifier type %j",
    (identifierType) => {
      expect(
        validateCustomerSearch({
          identifierType,
          identifierValue: "someone@example.com",
        })
      ).toBe("unsupported_type");
    }
  );

  it("requires a non-empty value within the contract's bound", () => {
    expect(
      validateCustomerSearch({
        identifierType: "application_user_id",
        identifierValue: "   ",
      })
    ).toBe("empty");
    expect(
      validateCustomerSearch({
        identifierType: "application_user_id",
        identifierValue: "x".repeat(MAX_IDENTIFIER_LENGTH + 1),
      })
    ).toBe("too_long");
    expect(
      validateCustomerSearch({
        identifierType: "billing_customer_id",
        identifierValue: "cus_01",
      })
    ).toBeUndefined();
  });

  it("tells the operator what is accepted and that no free-text search exists", () => {
    expect(SEARCH_HELPER_TEXT).toContain("Billing Customer ID");
    expect(SEARCH_HELPER_TEXT).toContain("application user ID");
    expect(SEARCH_HELPER_TEXT).toContain("installation ID");
    expect(SEARCH_HELPER_TEXT).toContain("no free-text search");
  });

  it("warns that an application user ID is not an email address", () => {
    // The single most likely wrong input, named explicitly where it is typed.
    expect(identifierTypeHelp("application_user_id")).toContain(
      "Not an email address"
    );
  });

  it("describes a miss as an answer rather than a failure", () => {
    const message = describeLookupMiss("application_user_id");
    expect(message).toContain("an answer, not a failure");
    expect(message.toLowerCase()).not.toContain("error");
  });
});

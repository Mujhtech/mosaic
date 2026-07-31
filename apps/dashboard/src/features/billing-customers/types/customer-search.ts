import type { BillingCustomerLookupRequest } from "@/generated/api"

/**
 * Typed-identifier customer lookup.
 *
 * There is deliberately no free-text search box on this surface. A box that
 * accepts "anything" is a box operators type email addresses and names into,
 * and Mosaic Billing holds neither: aliases are stored as SHA-256 digests, so a
 * free-text query could only ever be answered by matching against personal data
 * Mosaic has gone to some length not to keep. Worse, offering the box would
 * teach operators the data exists.
 *
 * So a lookup names its identifier *type* first, and the value is submitted in
 * a POST body rather than a query string so the raw identifier stays out of
 * access logs, referrers, and browser history.
 */

export type CustomerIdentifierType = BillingCustomerLookupRequest["identifierType"]

export const customerIdentifierTypes = [
  "billing_customer_id",
  "application_user_id",
  "installation_id",
] as const satisfies readonly CustomerIdentifierType[]

const IDENTIFIER_LABELS: Record<CustomerIdentifierType, string> = {
  application_user_id: "Application user ID",
  billing_customer_id: "Billing Customer ID",
  installation_id: "Installation ID",
}

const IDENTIFIER_HELP: Record<CustomerIdentifierType, string> = {
  application_user_id:
    "The identifier your own backend uses for this user — the value it passed when it identified them to Mosaic. Not an email address and not a display name.",
  billing_customer_id: "The Mosaic Billing Customer ID, as it appears on any billing surface.",
  installation_id:
    "A Mosaic installation identifier from an SDK. It resolves through recorded evidence only: an installation ID can never by itself select a customer, so a match here means Mosaic already associated that installation with a purchase.",
}

export function identifierTypeLabel(value: CustomerIdentifierType) {
  return IDENTIFIER_LABELS[value]
}

export function identifierTypeHelp(value: CustomerIdentifierType) {
  return IDENTIFIER_HELP[value]
}

/**
 * The one sentence rendered above the control, naming every accepted
 * identifier. Stating what is accepted is also how the surface says what it
 * will never accept.
 */
export const SEARCH_HELPER_TEXT =
  "Look a customer up by Billing Customer ID, by the application user ID your backend assigned, or by an installation ID. Mosaic Billing stores no email addresses, names, or other personal details, so there is nothing else to search by and no free-text search exists."

export const SEARCH_PRIVACY_NOTE =
  "The identifier is digested server-side. It is never stored, never written to a log, and never echoed back in the response."

export type SearchIssue = "empty" | "too_long" | "unsupported_type"

const ISSUE_MESSAGES: Record<SearchIssue, string> = {
  empty: "Enter the identifier to look up.",
  too_long: "That identifier is longer than any identifier Mosaic issues or accepts.",
  unsupported_type: "Choose which kind of identifier this is before looking it up.",
}

/** Matches the contract's own bound on an application user identifier. */
export const MAX_IDENTIFIER_LENGTH = 512

export function validateCustomerSearch(input: {
  identifierType: string
  identifierValue: string
}): SearchIssue | undefined {
  if (!customerIdentifierTypes.includes(input.identifierType as CustomerIdentifierType)) {
    return "unsupported_type"
  }
  const value = input.identifierValue.trim()
  if (value.length === 0) return "empty"
  if (value.length > MAX_IDENTIFIER_LENGTH) return "too_long"
  return undefined
}

export function describeSearchIssue(issue: SearchIssue) {
  return ISSUE_MESSAGES[issue]
}

/**
 * A miss is a result, not an error.
 *
 * The API answers `200 {found: false}` precisely so the dashboard renders "no
 * customer matches that identifier" rather than a failure banner. An operator
 * checking whether a user has ever purchased gets an answer either way, and a
 * red error state would read as "Mosaic is broken" when the correct reading is
 * "this person has no billing record".
 */
export function describeLookupMiss(identifierType: CustomerIdentifierType) {
  return `No Billing Customer in this Mosaic Environment matches that ${IDENTIFIER_LABELS[identifierType]}. That is an answer, not a failure: a customer exists only once your backend has identified the user or a validated purchase has attached to them.`
}

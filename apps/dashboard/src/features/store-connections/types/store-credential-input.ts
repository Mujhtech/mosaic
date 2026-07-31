import type { CreateStoreServerCredentialRequest } from "@/generated/api";

/**
 * Client-side checks for Store Server Credential entry.
 *
 * These are **format** checks only. They exist so an obvious paste mistake is
 * caught before a secret crosses the network, not to judge authenticity — the
 * store is the only authority on whether a key works, and the API tests it.
 *
 * Nothing here derives, stores, or logs any part of the secret.
 */

const APPLE_PEM_HEADER = "-----BEGIN PRIVATE KEY-----";
const APPLE_PEM_FOOTER = "-----END PRIVATE KEY-----";
const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const APPLE_KEY_ID = /^[0-9A-Z]{10}$/;
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.\-_]{1,254}$/;

export function validateApplePrivateKey(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Paste the contents of the .p8 In-App Purchase key file.";
  }
  if (!trimmed.startsWith(APPLE_PEM_HEADER)) {
    return "This does not look like a .p8 key. The file starts with -----BEGIN PRIVATE KEY-----.";
  }
  if (!trimmed.endsWith(APPLE_PEM_FOOTER)) {
    return "The key looks truncated. Paste the whole file, including the -----END PRIVATE KEY----- line.";
  }
  const body = trimmed
    .slice(APPLE_PEM_HEADER.length, -APPLE_PEM_FOOTER.length)
    .trim();
  if (body.length < 32) {
    return "The key body is empty. Paste the whole .p8 file.";
  }
}

export function validateAppleIssuerId(value: string): string | undefined {
  if (value.trim().length === 0) {
    return "Enter the App Store Connect issuer ID.";
  }
  return UUID.test(value.trim())
    ? undefined
    : "The issuer ID is a UUID from App Store Connect · Users and Access · Integrations.";
}

export function validateAppleKeyId(value: string): string | undefined {
  if (value.trim().length === 0) {
    return "Enter the key ID shown beside the .p8 key.";
  }
  return APPLE_KEY_ID.test(value.trim())
    ? undefined
    : "The key ID is 10 uppercase letters and digits.";
}

export function validateProviderApplicationIdentifier(
  value: string
): string | undefined {
  if (value.trim().length === 0) {
    return "Enter the bundle ID or package name.";
  }
  return BUNDLE_ID.test(value.trim())
    ? undefined
    : "Use the identifier exactly as the store shows it, for example com.example.app.";
}

export interface GoogleServiceAccountSummary {
  clientEmail: string;
  projectId?: string;
}

/**
 * Reads only the two non-secret fields an operator needs echoed back for
 * confirmation. The private key inside the JSON is never touched, echoed, or
 * retained anywhere but the form field it was typed into.
 */
export function readGoogleServiceAccount(
  value: string
): { error: string } | { summary: GoogleServiceAccountSummary } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { error: "Paste the service-account JSON key file." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      error: "This is not valid JSON. Paste the whole downloaded key file.",
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "The key file should be a JSON object." };
  }
  const record = parsed as Record<string, unknown>;
  if (record.type !== "service_account") {
    return { error: 'The key file must have "type": "service_account".' };
  }
  const clientEmail = record.client_email;
  if (typeof clientEmail !== "string" || !clientEmail.includes("@")) {
    return { error: "The key file is missing client_email." };
  }
  if (
    typeof record.private_key !== "string" ||
    record.private_key.length < 32
  ) {
    return { error: "The key file is missing private_key." };
  }
  const projectId =
    typeof record.project_id === "string" ? record.project_id : undefined;
  return { summary: { clientEmail, ...(projectId ? { projectId } : {}) } };
}

export function validateGoogleServiceAccount(
  value: string
): string | undefined {
  const result = readGoogleServiceAccount(value);
  return "error" in result ? result.error : undefined;
}

/**
 * Store Environment must align with the Mosaic Environment's mode: a production
 * Mosaic Environment never holds sandbox store facts, and vice versa.
 */
export function storeEnvironmentMatchesMode(
  environmentMode: "development" | "production" | "staging",
  storeEnvironment: "production" | "sandbox"
) {
  return storeEnvironment === "production"
    ? environmentMode === "production"
    : environmentMode !== "production";
}

export interface StoreCredentialFormValues {
  appleIssuerId: string;
  appleKeyId: string;
  applications: {
    applicationId: string;
    providerApplicationIdentifier: string;
  }[];
  environmentId: string;
  googlePubSubProjectId: string;
  googlePubSubSubscriptionId: string;
  name: string;
  provider: "app_store" | "google_play";
  secret: string;
  storeEnvironment: "production" | "sandbox";
}

/**
 * Builds the request body. Provider-specific fields are omitted rather than
 * sent empty, so a Google connection never carries Apple metadata.
 */
export function buildCreateStoreCredentialRequest(
  values: StoreCredentialFormValues,
  platformFor: (applicationId: string) => "android" | "ios"
): CreateStoreServerCredentialRequest {
  const applications = values.applications.map((application) => ({
    applicationId: application.applicationId,
    platform: platformFor(application.applicationId),
    providerApplicationIdentifier:
      application.providerApplicationIdentifier.trim(),
  }));

  return {
    applications,
    environmentId: values.environmentId,
    name: values.name.trim(),
    provider: values.provider,
    secret: values.secret,
    storeEnvironment: values.storeEnvironment,
    ...(values.provider === "app_store"
      ? {
          appleIssuerId: values.appleIssuerId.trim(),
          appleKeyId: values.appleKeyId.trim(),
        }
      : {
          googlePubSubProjectId: values.googlePubSubProjectId.trim(),
          googlePubSubSubscriptionId: values.googlePubSubSubscriptionId.trim(),
        }),
  };
}

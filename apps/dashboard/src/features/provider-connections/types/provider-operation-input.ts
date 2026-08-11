import { validateApplePrivateKey } from "@/features/store-connections/types/store-credential-input";

const SECRET_KEY = /^sk_[^\s]+$/;
const VENDOR_NUMBER = /^[0-9]+$/;
export interface CreateRevenueCatConnectionInput {
  applicationIds: string[];
  credential: string;
  environmentIds: string[];
  externalProjectId: string;
  mode: "production" | "sandbox";
  name: string;
}

/**
 * App Store Connect carries no external project identifier: an API key is
 * issued per Apple team and already names every app it can read, so the API
 * rejects `externalProjectId` for this provider. The field is absent from this
 * type rather than sent empty.
 */
export interface CreateAppStoreConnectConnectionInput {
  applicationIds: string[];
  credential: string;
  environmentIds: string[];
  mode: "production" | "sandbox";
  name: string;
}

export interface AppStoreConnectCredentialFields {
  issuerId: string;
  keyId: string;
  privateKey: string;
  vendorNumber: string;
}

export interface ReplaceProviderCredentialInput {
  credential: string;
}

export function environmentMatchesConnectionMode(
  environmentMode: "development" | "production" | "staging",
  connectionMode: "production" | "sandbox"
): boolean {
  return connectionMode === "production"
    ? environmentMode === "production"
    : environmentMode !== "production";
}

export function validateRevenueCatCredential(
  value: string
): string | undefined {
  if (!value.trim()) {
    return "Enter the RevenueCat secret API key.";
  }
  if (!SECRET_KEY.test(value)) {
    return "Use a RevenueCat secret key beginning with sk_.";
  }
  if (value.length > 4096) {
    return "The RevenueCat secret API key is too long.";
  }
}

/**
 * The `.p8` is uploaded, never pasted, so the empty-state message names the
 * upload rather than offering a paste fallback. Format checking is shared with
 * the Store Server Credential sheets — the same Apple key file, the same rules.
 */
export function validateAppStoreConnectPrivateKey(
  value: string
): string | undefined {
  if (value.trim().length === 0) {
    return "Upload the .p8 App Store Connect API key file.";
  }
  return validateApplePrivateKey(value);
}

/**
 * Optional. Captured now so a later sales or finance feature does not require
 * every operator to re-enter an otherwise complete credential.
 */
export function validateAppStoreConnectVendorNumber(
  value: string
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return;
  }
  return VENDOR_NUMBER.test(trimmed)
    ? undefined
    : "The vendor number is digits only, for example 85200000.";
}

/**
 * Assembles the single opaque credential document the API seals. The vendor
 * number is omitted rather than sent empty, so an operator who skipped it does
 * not persist a field that reads as an answered-but-blank value.
 *
 * Nothing here logs, caches, or derives anything from the key material; the
 * returned string is handed straight to the one-time create or rotate request.
 */
export function buildAppStoreConnectCredential(
  fields: AppStoreConnectCredentialFields
): string {
  const vendorNumber = fields.vendorNumber.trim();
  return JSON.stringify({
    privateKey: `${fields.privateKey.trim()}\n`,
    keyId: fields.keyId.trim(),
    issuerId: fields.issuerId.trim(),
    ...(vendorNumber ? { vendorNumber } : {}),
  });
}

export function providerImportIdempotencyKey(): string {
  return `provider-import:${crypto.randomUUID()}`;
}

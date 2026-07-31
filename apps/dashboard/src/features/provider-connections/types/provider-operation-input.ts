const SECRET_KEY = /^sk_[^\s]+$/;
export interface CreateRevenueCatConnectionInput {
  applicationIds: string[];
  credential: string;
  environmentIds: string[];
  externalProjectId: string;
  mode: "production" | "sandbox";
  name: string;
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

export function providerImportIdempotencyKey(): string {
  return `provider-import:${crypto.randomUUID()}`;
}

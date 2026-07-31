import type { ProductType } from "@/generated/api"

export type NativeProviderKind = "app_store" | "google_play"

export interface NativeProviderMappingInput {
  applicationId: string
  environmentId: string
  googleBasePlanId?: string
  googleOfferId?: string
  productType: ProductType
  provider: NativeProviderKind
  providerProductIdentifier: string
}

export type GoogleOfferSelection = "none" | "specific"

export function nativeProviderLabel(provider: NativeProviderKind) {
  return provider === "app_store" ? "StoreKit" : "Google Play Billing"
}

export function nativeProviderForPlatform(platform: "android" | "ios"): NativeProviderKind {
  return platform === "ios" ? "app_store" : "google_play"
}

export function nativeProviderMatchesPlatform(
  provider: NativeProviderKind,
  platform: "android" | "ios",
) {
  return nativeProviderForPlatform(platform) === provider
}

export function validateNativeProviderMapping(input: NativeProviderMappingInput) {
  const errors: Partial<
    Record<"googleBasePlanId" | "googleOfferId" | "providerProductIdentifier", string>
  > = {}

  if (!input.providerProductIdentifier.trim()) {
    errors.providerProductIdentifier =
      input.provider === "app_store"
        ? "Enter the exact StoreKit Product ID."
        : "Enter the exact Google Play Product ID."
  }

  if (
    input.provider === "google_play" &&
    input.productType === "subscription" &&
    !input.googleBasePlanId?.trim()
  ) {
    errors.googleBasePlanId = "Enter the exact base plan ID for this subscription."
  }

  if (input.provider === "google_play" && input.productType === "one_time_non_consumable") {
    if (input.googleBasePlanId?.trim()) {
      errors.googleBasePlanId = "One-time Products cannot use a base plan."
    }
    if (input.googleOfferId?.trim()) {
      errors.googleOfferId = "One-time Products cannot use a subscription offer."
    }
  }

  return errors
}

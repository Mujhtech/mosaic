import type {
  MockProductDefinition,
  MockPurchaseState,
} from "@/features/paywall-editor/types/editor"

export const EDITOR_HISTORY_LIMIT = 50
export const AUTOSAVE_DELAY_MS = 500
export const MAX_LOCAL_PROJECT_BYTES = 1_048_576
export const PREVIEW_ENDPOINT_DEFAULT = "ws://127.0.0.1:4317/preview"
export const LOCAL_PROJECT_STORAGE_KEY = "mosaic:local-project:v0.2"
export const LOCAL_EDITOR_UI_STORAGE_KEY = "mosaic:local-project-ui:v0.2"

export const MOCK_PURCHASE_STATES = [
  { value: "productAvailable", label: "Product available" },
  { value: "productUnavailable", label: "Product unavailable" },
  { value: "purchaseSuccess", label: "Purchase success" },
  { value: "purchaseCancellation", label: "Purchase cancelled" },
  { value: "purchaseFailure", label: "Purchase failure" },
  { value: "restoreSuccess", label: "Restore success" },
  { value: "restoreNoPurchases", label: "Restore has no purchases" },
  { value: "restoreFailure", label: "Restore failure" },
  { value: "alreadyEntitled", label: "Already entitled" },
] as const satisfies readonly { value: MockPurchaseState; label: string }[]

export const DEFAULT_MOCK_PRODUCTS: readonly MockProductDefinition[] = [
  {
    productReferenceId: "monthly-plan",
    availability: "available",
    kind: "subscription",
    localizedPrice: "$7.99",
    currencyCode: "USD",
    billingPeriod: { unit: "month", value: 1 },
  },
  {
    productReferenceId: "yearly-plan",
    availability: "available",
    kind: "subscription",
    localizedPrice: "$59.99",
    currencyCode: "USD",
    billingPeriod: { unit: "year", value: 1 },
    trialPeriod: { unit: "day", value: 7 },
  },
]

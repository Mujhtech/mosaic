import type { MosaicDocument, ProtocolNode } from "@/features/paywall-editor/types/editor"
import { synchronizeProtocolMetadata } from "@/features/paywall-editor/utils/protocol-document"

const REQUIRED_CAPABILITIES = [
  "layout.scrollContainer",
  "layout.verticalStack",
  "component.text",
  "component.image",
  "component.featureList",
  "component.productSelector",
  "component.purchaseButton",
  "component.restoreButton",
  "component.closeButton",
  "component.legalText",
  "localization.catalogs",
  "localization.rtl",
  "product.references",
  "asset.bundledImage",
  "action.purchase",
  "action.restore",
  "action.close",
  "accessibility.metadata",
  "fallback.product",
  "fallback.asset",
  "outcome.normalized",
] as const

const STRINGS = {
  en: {
    "paywall.close": "Close",
    "paywall.feature.native": "Native on every platform",
    "paywall.feature.preview": "Preview every change instantly",
    "paywall.features.label": "What is included",
    "paywall.headline": "Build a paywall people understand",
    "paywall.hero.placeholder": "Preview image unavailable",
    "paywall.legal": "Subscriptions renew automatically unless cancelled before renewal.",
    "paywall.products.label": "Choose a plan",
    "paywall.products.hint": "Choose one available plan before continuing",
    "paywall.products.monthly": "Monthly",
    "paywall.products.unavailable": "Plans are temporarily unavailable.",
    "paywall.products.yearly": "Yearly",
    "paywall.products.yearly.badge": "Best value",
    "paywall.purchase": "Continue",
    "paywall.purchase.accessibility": "Continue with selected plan",
    "paywall.purchase.progress": "Processing purchase…",
    "paywall.restore": "Restore purchases",
    "paywall.restore.accessibility": "Restore previous purchases",
    "paywall.restore.progress": "Restoring purchases…",
    "paywall.subtitle":
      "Edit once and preview the same native document in Flutter, SwiftUI, and Compose.",
  },
  de: {
    "paywall.close": "Schließen",
    "paywall.feature.native": "Auf jeder Plattform nativ",
    "paywall.feature.preview": "Jede Änderung sofort in der Vorschau sehen",
    "paywall.features.label": "Was enthalten ist",
    "paywall.headline": "Erstelle eine Bezahlschranke, die Menschen sofort verstehen",
    "paywall.hero.placeholder": "Vorschaubild ist nicht verfügbar",
    "paywall.legal":
      "Abonnements verlängern sich automatisch, sofern sie nicht vor dem Verlängerungsdatum gekündigt werden.",
    "paywall.products.label": "Wähle einen Tarif",
    "paywall.products.hint": "Wähle vor dem Fortfahren einen verfügbaren Tarif aus",
    "paywall.products.monthly": "Monatlich",
    "paywall.products.unavailable": "Tarife sind vorübergehend nicht verfügbar.",
    "paywall.products.yearly": "Jährlich",
    "paywall.products.yearly.badge": "Bestes Angebot",
    "paywall.purchase": "Weiter",
    "paywall.purchase.accessibility": "Mit dem ausgewählten Tarif fortfahren",
    "paywall.purchase.progress": "Kauf wird verarbeitet…",
    "paywall.restore": "Käufe wiederherstellen",
    "paywall.restore.accessibility": "Frühere Käufe wiederherstellen",
    "paywall.restore.progress": "Käufe werden wiederhergestellt…",
    "paywall.subtitle":
      "Bearbeite ein einziges natives Dokument und prüfe es sofort in Flutter, SwiftUI und Jetpack Compose, ohne deinen Arbeitskontext zu verlassen.",
  },
  ar: {
    "paywall.close": "إغلاق",
    "paywall.feature.native": "تجربة أصلية على كل منصة",
    "paywall.feature.preview": "عاين كل تغيير فورًا",
    "paywall.features.label": "المزايا المتضمنة",
    "paywall.headline": "أنشئ شاشة دفع واضحة وسهلة الفهم",
    "paywall.hero.placeholder": "صورة المعاينة غير متاحة",
    "paywall.legal": "تتجدد الاشتراكات تلقائيًا ما لم يتم إلغاؤها قبل موعد التجديد.",
    "paywall.products.label": "اختر خطة",
    "paywall.products.hint": "اختر خطة متاحة قبل المتابعة",
    "paywall.products.monthly": "شهري",
    "paywall.products.unavailable": "الخطط غير متاحة مؤقتًا.",
    "paywall.products.yearly": "سنوي",
    "paywall.products.yearly.badge": "أفضل قيمة",
    "paywall.purchase": "متابعة",
    "paywall.purchase.accessibility": "المتابعة باستخدام الخطة المحددة",
    "paywall.purchase.progress": "تجري معالجة الشراء…",
    "paywall.restore": "استعادة المشتريات",
    "paywall.restore.accessibility": "استعادة المشتريات السابقة",
    "paywall.restore.progress": "تجري استعادة المشتريات…",
    "paywall.subtitle":
      "عدّل مستندًا أصليًا واحدًا وعاين النتيجة فورًا في Flutter وSwiftUI وCompose.",
  },
} as const

function text(
  id: string,
  localizationKey: string,
  defaultValue: string,
  style: "title" | "body" | "caption" = "body",
): ProtocolNode {
  return {
    type: "text",
    id,
    value: { default: defaultValue, localizationKey },
    style,
    alignment: "center",
    accessibility: style === "title" ? { role: "heading", level: 1 } : { role: "text" },
  }
}

function baseDocument(id: string, children: ProtocolNode[]): MosaicDocument {
  return synchronizeProtocolMetadata({
    schemaVersion: "0.1",
    id,
    revision: 1,
    compatibility: {
      requiredCapabilities: REQUIRED_CAPABILITIES.map((name) => ({ name, version: "0.1" })),
    },
    localization: {
      defaultLocale: "en",
      fallbackLocale: "en",
      locales: {
        en: { direction: "ltr", strings: { ...STRINGS.en } },
        de: { direction: "ltr", strings: { ...STRINGS.de } },
        ar: { direction: "rtl", strings: { ...STRINGS.ar } },
      },
    },
    assets: [],
    products: [
      {
        id: "monthly-plan",
        productId: "mosaic_pro_monthly",
        label: { default: "Monthly", localizationKey: "paywall.products.monthly" },
      },
      {
        id: "yearly-plan",
        productId: "mosaic_pro_yearly",
        label: { default: "Yearly", localizationKey: "paywall.products.yearly" },
        badge: { default: "Best value", localizationKey: "paywall.products.yearly.badge" },
      },
    ],
    layout: {
      type: "scrollContainer",
      id: "paywall-scroll",
      axis: "vertical",
      safeArea: "respect",
      showsIndicators: true,
      content: {
        type: "verticalStack",
        id: "paywall-content",
        spacing: 18,
        padding: { top: 20, start: 24, bottom: 24, end: 24 },
        horizontalAlignment: "stretch",
        children,
      },
    },
  })
}

const CLOSE_BUTTON: ProtocolNode = {
  type: "closeButton",
  id: "close",
  label: { default: "Close", localizationKey: "paywall.close" },
  action: { type: "close" },
  accessibility: { label: { default: "Close", localizationKey: "paywall.close" } },
}

const PRODUCT_SELECTOR: ProtocolNode = {
  type: "productSelector",
  id: "plans",
  productReferenceIds: ["monthly-plan", "yearly-plan"],
  initiallySelectedProductReferenceId: "yearly-plan",
  itemSpacing: 12,
  unavailableFallback: {
    selection: "firstAvailable",
    whenNoneAvailable: "showMessageAndDisablePurchase",
    message: {
      default: "Plans are temporarily unavailable.",
      localizationKey: "paywall.products.unavailable",
    },
  },
  accessibility: {
    label: { default: "Choose a plan", localizationKey: "paywall.products.label" },
    hint: {
      default: "Choose one available plan before continuing",
      localizationKey: "paywall.products.hint",
    },
  },
}

const PURCHASE_BUTTON: ProtocolNode = {
  type: "purchaseButton",
  id: "purchase",
  label: { default: "Continue", localizationKey: "paywall.purchase" },
  inProgressLabel: {
    default: "Processing purchase…",
    localizationKey: "paywall.purchase.progress",
  },
  action: { type: "purchase", productSelectorId: "plans" },
  accessibility: {
    label: {
      default: "Continue with selected plan",
      localizationKey: "paywall.purchase.accessibility",
    },
  },
}

const RESTORE_BUTTON: ProtocolNode = {
  type: "restoreButton",
  id: "restore",
  label: { default: "Restore purchases", localizationKey: "paywall.restore" },
  inProgressLabel: {
    default: "Restoring purchases…",
    localizationKey: "paywall.restore.progress",
  },
  action: { type: "restore" },
  accessibility: {
    label: {
      default: "Restore previous purchases",
      localizationKey: "paywall.restore.accessibility",
    },
  },
}

const LEGAL_TEXT: ProtocolNode = {
  type: "legalText",
  id: "legal",
  value: {
    default: "Subscriptions renew automatically unless cancelled before renewal.",
    localizationKey: "paywall.legal",
  },
  alignment: "center",
  accessibility: { role: "text" },
}

const FEATURE_LIST: ProtocolNode = {
  type: "featureList",
  id: "features",
  marker: "checkmark",
  itemSpacing: 12,
  items: [
    {
      id: "native-everywhere",
      text: { default: "Native on every platform", localizationKey: "paywall.feature.native" },
    },
    {
      id: "instant-preview",
      text: {
        default: "Preview every change instantly",
        localizationKey: "paywall.feature.preview",
      },
    },
  ],
  accessibility: {
    label: { default: "What is included", localizationKey: "paywall.features.label" },
  },
}

export interface EditorTemplate {
  id: string
  name: string
  description: string
  document: MosaicDocument
}

export const EDITOR_TEMPLATES: readonly EditorTemplate[] = [
  {
    id: "focused",
    name: "Focused offer",
    description: "A concise subscription choice with a clear value proposition.",
    document: baseDocument("focused-offer", [
      CLOSE_BUTTON,
      text("headline", "paywall.headline", STRINGS.en["paywall.headline"], "title"),
      text("subtitle", "paywall.subtitle", STRINGS.en["paywall.subtitle"]),
      PRODUCT_SELECTOR,
      PURCHASE_BUTTON,
      RESTORE_BUTTON,
      LEGAL_TEXT,
    ]),
  },
  {
    id: "benefits",
    name: "Benefits first",
    description: "Lead with product benefits before asking someone to choose a plan.",
    document: baseDocument("benefits-first", [
      CLOSE_BUTTON,
      text("headline", "paywall.headline", STRINGS.en["paywall.headline"], "title"),
      text("subtitle", "paywall.subtitle", STRINGS.en["paywall.subtitle"]),
      FEATURE_LIST,
      PRODUCT_SELECTOR,
      PURCHASE_BUTTON,
      RESTORE_BUTTON,
      LEGAL_TEXT,
    ]),
  },
]

import type {
  DocumentNode,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { synchronizeProtocolMetadata } from "@/features/paywall-editor/utils/protocol-document"

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
): Extract<ProtocolNode, { type: "text" }> {
  return {
    type: "text",
    id,
    value: { default: defaultValue, localizationKey },
    typography: {
      style,
      fontSize: style === "title" ? 32 : style === "caption" ? 13 : 16,
      lineHeightMultiplier: style === "title" ? 1.2 : style === "caption" ? 1.4 : 1.5,
      weight: style === "title" ? "bold" : "regular",
      color: style === "caption" ? "text.secondary" : "text.primary",
      alignment: "center",
    },
    sizing: { width: "fill", height: "fit" },
    accessibility: style === "title" ? { role: "heading", level: 1 } : { role: "text" },
  }
}

function fitText(
  id: string,
  localizationKey: string,
  defaultValue: string,
  style: "title" | "body" | "caption" = "body",
): Extract<ProtocolNode, { type: "text" }> {
  return {
    ...text(id, localizationKey, defaultValue, style),
    sizing: { width: "fit", height: "fit" },
  }
}

function baseDocument(id: string, children: DocumentNode[]): MosaicDocument {
  return synchronizeProtocolMetadata({
    schemaVersion: "0.2",
    id,
    revision: 1,
    compatibility: {
      requiredCapabilities: [],
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
    designSystem: {
      colors: [],
      backgrounds: [],
      shadows: [],
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
      },
    ],
    initialScreenId: "main",
    screens: [
      {
        id: "main",
        presentation: { type: "screen" },
        layout: {
          type: "scrollContainer",
          id: "paywall-scroll",
          axis: "vertical",
          safeArea: "respect",
          showsIndicators: true,
          content: {
            type: "stack",
            id: "paywall-content",
            direction: "vertical",
            gap: 18,
            padding: { top: 20, start: 24, bottom: 24, end: 24 },
            mainAxisDistribution: "start",
            crossAxisAlignment: "stretch",
            children,
          },
        },
      },
    ],
  })
}

const CLOSE_BUTTON: DocumentNode = {
  type: "button",
  id: "close",
  direction: "horizontal",
  gap: 8,
  mainAxisDistribution: "center",
  crossAxisAlignment: "center",
  children: [fitText("close-label", "paywall.close", "Close")],
  action: { type: "close" },
  appearance: { background: { type: "color", value: "transparent" } },
  accessibility: { label: { default: "Close", localizationKey: "paywall.close" } },
}

const PRODUCT_SELECTOR: DocumentNode = {
  type: "productSelector",
  id: "plans",
  direction: "horizontal",
  gap: 12,
  crossAxisAlignment: "stretch",
  initialProductCardId: "yearly-card",
  cards: [
    {
      type: "productCard",
      id: "monthly-card",
      productReferenceId: "monthly-plan",
      direction: "vertical",
      gap: 4,
      mainAxisDistribution: "start",
      crossAxisAlignment: "start",
      children: [
        {
          ...text("monthly-name", "paywall.products.monthly.card_name", "{{ product.name }}"),
          typography: {
            ...text("monthly-name", "paywall.products.monthly.card_name", "{{ product.name }}")
              .typography,
            alignment: "start",
            color: "text.secondary",
          },
        },
        {
          ...text("monthly-price", "paywall.products.monthly.card_price", "{{ product.price }}"),
          typography: {
            ...text("monthly-price", "paywall.products.monthly.card_price", "{{ product.price }}")
              .typography,
            alignment: "start",
            weight: "semibold",
          },
        },
      ],
      styles: {
        default: {
          background: { type: "color", value: "surface.default" },
          border: { color: "border.default", width: 1 },
          cornerRadius: 12,
          padding: { top: 14, start: 16, bottom: 14, end: 16 },
          opacity: 1,
        },
        selected: {
          background: { type: "color", value: "surface.elevated" },
          border: { color: "action.primary", width: 2 },
        },
      },
    },
    {
      type: "productCard",
      id: "yearly-card",
      productReferenceId: "yearly-plan",
      direction: "vertical",
      gap: 4,
      mainAxisDistribution: "start",
      crossAxisAlignment: "start",
      children: [
        {
          ...text("yearly-name", "paywall.products.yearly.card_name", "{{ product.name }}"),
          typography: {
            ...text("yearly-name", "paywall.products.yearly.card_name", "{{ product.name }}")
              .typography,
            alignment: "start",
            color: "text.secondary",
          },
        },
        {
          ...text("yearly-price", "paywall.products.yearly.card_price", "{{ product.price }}"),
          typography: {
            ...text("yearly-price", "paywall.products.yearly.card_price", "{{ product.price }}")
              .typography,
            alignment: "start",
            weight: "semibold",
          },
        },
        {
          type: "productBadge",
          id: "yearly-badge",
          placement: { mode: "overlay", anchor: "topEnd", inset: 8 },
          direction: "horizontal",
          gap: 4,
          mainAxisDistribution: "center",
          crossAxisAlignment: "center",
          children: [
            text("yearly-badge-label", "paywall.products.yearly.badge", "Best value", "caption"),
          ],
          styles: {
            default: {
              background: { type: "color", value: "surface.elevated" },
              border: { color: "border.default", width: 0 },
              cornerRadius: 999,
              padding: { top: 2, start: 8, bottom: 2, end: 8 },
              opacity: 1,
            },
            selected: {},
          },
        },
      ],
      styles: {
        default: {
          background: { type: "color", value: "surface.default" },
          border: { color: "border.default", width: 1 },
          cornerRadius: 12,
          padding: { top: 14, start: 16, bottom: 14, end: 16 },
          opacity: 1,
        },
        selected: {
          background: { type: "color", value: "surface.elevated" },
          border: { color: "action.primary", width: 2 },
        },
      },
    },
  ],
  sizing: { width: "fill", height: "fit" },
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

const PURCHASE_BUTTON: DocumentNode = {
  type: "button",
  id: "purchase",
  direction: "horizontal",
  gap: 8,
  mainAxisDistribution: "center",
  crossAxisAlignment: "center",
  children: [
    {
      ...text("purchase-label", "paywall.purchase", "Continue"),
      typography: {
        ...text("purchase-label", "paywall.purchase", "Continue").typography,
        color: "action.onPrimary",
      },
    },
  ],
  inProgressChildren: [
    text("purchase-progress", "paywall.purchase.progress", "Processing purchase…"),
  ],
  appearance: {
    background: { type: "color", value: "action.primary" },
    cornerRadius: 12,
    padding: { top: 12, start: 16, bottom: 12, end: 16 },
  },
  sizing: { width: "fill", height: "fit" },
  action: { type: "purchase", productSelectorId: "plans" },
  accessibility: {
    label: {
      default: "Continue with selected plan",
      localizationKey: "paywall.purchase.accessibility",
    },
  },
}

const RESTORE_BUTTON: DocumentNode = {
  type: "button",
  id: "restore",
  direction: "horizontal",
  gap: 8,
  mainAxisDistribution: "center",
  crossAxisAlignment: "center",
  children: [fitText("restore-label", "paywall.restore", "Restore purchases")],
  inProgressChildren: [
    text("restore-progress", "paywall.restore.progress", "Restoring purchases…"),
  ],
  sizing: { width: "fit", height: "fit" },
  action: { type: "restore" },
  accessibility: {
    label: {
      default: "Restore previous purchases",
      localizationKey: "paywall.restore.accessibility",
    },
  },
}

const LEGAL_TEXT: DocumentNode = {
  type: "text",
  id: "legal",
  value: {
    default: "Subscriptions renew automatically unless cancelled before renewal.",
    localizationKey: "paywall.legal",
  },
  typography: {
    style: "caption",
    fontSize: 13,
    lineHeightMultiplier: 1.4,
    weight: "regular",
    color: "text.secondary",
    alignment: "center",
  },
  sizing: { width: "fill", height: "fit" },
  accessibility: { role: "text" },
}

const FEATURE_LIST: DocumentNode = {
  type: "featureList",
  id: "features",
  marker: "checkmark",
  gap: 12,
  markerColor: "action.primary",
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
  typography: {
    style: "body",
    fontSize: 16,
    lineHeightMultiplier: 1.5,
    weight: "regular",
    color: "text.primary",
    alignment: "start",
  },
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

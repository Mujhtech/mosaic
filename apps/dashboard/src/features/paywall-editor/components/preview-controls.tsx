import { PREVIEW_MODES } from "@/features/paywall-editor/constants/editor-constants"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"

const CONTROL_CLASS =
  "border-input bg-background focus-visible:ring-ring w-full rounded-md border px-2 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"

export function PreviewControls() {
  const { document, currentLocale, previewMode, textScale } = useEditorStore()
  const { setLocale, setPreviewMode, setTextScale, updateDocument } = useEditorActions()
  if (!document) return null

  return (
    <section className="space-y-4" aria-labelledby="preview-context-title">
      <div>
        <h2 id="preview-context-title" className="text-sm font-semibold">
          Preview context
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">Locale, direction, size, and layout</p>
      </div>
      <div>
        <label
          className="text-muted-foreground mb-1 block text-xs font-medium"
          htmlFor="preview-locale"
        >
          Localization
        </label>
        <select
          id="preview-locale"
          className={CONTROL_CLASS}
          value={currentLocale}
          onChange={(event) => setLocale(event.target.value)}
        >
          {Object.entries(document.localization.locales).map(([locale, catalog]) => (
            <option key={locale} value={locale}>
              {locale === "en"
                ? "English"
                : locale === "de"
                  ? "German"
                  : locale === "ar"
                    ? "Arabic"
                    : locale}{" "}
              ({locale}) · {catalog.direction === "rtl" ? "Right to left" : "Left to right"}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground mt-1 text-[11px]">
          Choose German for long copy or Arabic for right-to-left preview.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            className="text-muted-foreground mb-1 block text-xs font-medium"
            htmlFor="preview-device"
          >
            Device
          </label>
          <select
            id="preview-device"
            className={CONTROL_CLASS}
            value={previewMode}
            onChange={(event) => setPreviewMode(event.target.value as typeof previewMode)}
          >
            {PREVIEW_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            className="text-muted-foreground mb-1 block text-xs font-medium"
            htmlFor="text-scale"
          >
            Text size · {Math.round(textScale * 100)}%
          </label>
          <input
            id="text-scale"
            className="mt-2 w-full accent-teal-700"
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={textScale}
            onChange={(event) => setTextScale(Number(event.target.value))}
          />
        </div>
      </div>
      <div>
        <label
          className="text-muted-foreground mb-1 block text-xs font-medium"
          htmlFor="content-spacing"
        >
          Content spacing · {document.layout.content.spacing}
        </label>
        <input
          id="content-spacing"
          className="w-full accent-teal-700"
          type="range"
          min="0"
          max="48"
          value={document.layout.content.spacing}
          onChange={(event) =>
            updateDocument((current) => ({
              ...current,
              layout: {
                ...current.layout,
                content: { ...current.layout.content, spacing: Number(event.target.value) },
              },
            }))
          }
        />
        <p className="text-muted-foreground mt-1 text-[11px]">
          Appearance controls map only to exportable paywall layout properties.
        </p>
      </div>
    </section>
  )
}

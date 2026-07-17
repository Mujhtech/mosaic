import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"

import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection"
import type { ValidationIssue } from "@/features/paywall-editor/types/editor"

export function ValidationPanel({ issues }: { issues: readonly ValidationIssue[] }) {
  const { selectComponent } = useEditorSelection()

  return (
    <section aria-labelledby="validation-title">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2
            id="validation-title"
            className="text-sm font-semibold focus:outline-none"
            tabIndex={-1}
          >
            Validation
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Fix issues without leaving the editor
          </p>
        </div>
        <span
          aria-live="polite"
          aria-atomic="true"
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            issues.length === 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
          }`}
        >
          {issues.length === 0 ? "Ready" : `${issues.length} to fix`}
        </span>
      </div>
      {issues.length === 0 ? (
        <div className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircleIcon className="mt-0.5 shrink-0" aria-hidden weight="fill" />
          <p>This paywall is valid and ready to send to native previews or export.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.documentPath}`}
              className="border-destructive/25 rounded-xl border p-3"
            >
              <div className="flex items-start gap-2">
                <WarningCircleIcon
                  className="text-destructive mt-0.5 shrink-0"
                  aria-hidden
                  weight="fill"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{issue.message}</p>
                  <p className="text-muted-foreground mt-1 text-xs">{issue.recovery}</p>
                  {issue.componentId ? (
                    <button
                      type="button"
                      className="text-primary mt-2 text-xs font-semibold hover:underline"
                      onClick={() => selectComponent(issue.componentId ?? null)}
                    >
                      Show affected content
                    </button>
                  ) : null}
                  <details className="text-muted-foreground mt-2 text-[11px]">
                    <summary className="cursor-pointer">Diagnostic details</summary>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2">
                      <dt>Code</dt>
                      <dd className="break-all">{issue.code}</dd>
                      <dt>Path</dt>
                      <dd className="break-all">{issue.documentPath}</dd>
                    </dl>
                  </details>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

import { FileArrowUpIcon } from "@phosphor-icons/react/dist/ssr/FileArrowUp"
import { FloppyDiskBackIcon } from "@phosphor-icons/react/dist/ssr/FloppyDiskBack"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import type { LocalProjectReadResult } from "@/features/paywall-editor/mutations/local-project-file"

interface TemplateSelectionProps {
  autosave: LocalProjectReadResult
  importError: string | null
  onSelectTemplate: (templateId: string) => void
  onResume: () => void
  onImport: (file: File) => void
}

export function TemplateSelection({
  autosave,
  importError,
  onSelectTemplate,
  onResume,
  onImport,
}: TemplateSelectionProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center p-6 lg:p-10">
        <div className="mb-8 max-w-2xl">
          <div className="bg-primary/10 text-primary mb-4 grid size-11 place-items-center rounded-2xl">
            <SquaresFourIcon aria-hidden size={24} weight="fill" />
          </div>
          <p className="text-primary mb-2 text-sm font-semibold">Local Studio</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Start from intent, not JSON
          </h1>
          <p className="text-muted-foreground mt-3 text-base leading-7">
            Choose a constrained paywall template. Your work stays in this browser and can be
            exported at any time.
          </p>
        </div>

        {autosave.status === "valid" || autosave.status === "recoverable" ? (
          <section
            className={`mb-6 flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between ${
              autosave.status === "recoverable"
                ? "border-amber-300 bg-amber-50"
                : "border-primary/25 bg-primary/5"
            }`}
          >
            <div>
              <h2 className="font-semibold">
                {autosave.status === "recoverable"
                  ? "Continue and fix your local draft"
                  : "Continue your local draft"}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Local draft · {autosave.project.preview.locale} · saved only in this browser
              </p>
              {autosave.status === "recoverable" ? (
                <p className="mt-2 text-sm text-amber-950">{autosave.message}</p>
              ) : null}
            </div>
            <Button onClick={onResume}>
              <FloppyDiskBackIcon aria-hidden />
              {autosave.status === "recoverable" ? "Resume and fix" : "Resume autosave"}
            </Button>
          </section>
        ) : null}

        {autosave.status === "corrupt" ? (
          <div
            className="border-destructive/30 bg-destructive/5 mb-6 rounded-2xl border p-5"
            role="alert"
          >
            <p className="font-semibold">Autosave needs recovery</p>
            <p className="text-muted-foreground mt-1 text-sm">{autosave.message}</p>
            <p className="text-muted-foreground mt-2 text-sm">
              Start from a template or import a known-good Protocol 0.2 file. Nothing will
              overwrite an open editor without your action.
            </p>
          </div>
        ) : null}

        {importError ? (
          <div
            className="border-destructive/30 bg-destructive/5 mb-6 rounded-xl border p-4 text-sm"
            role="alert"
          >
            <p className="font-semibold">Import was not applied</p>
            <p className="text-muted-foreground mt-1">{importError}</p>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {EDITOR_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="border-border bg-card hover:border-primary/45 focus-visible:ring-ring group rounded-2xl border p-6 text-left shadow-sm transition focus-visible:ring-2 focus-visible:outline-none"
              onClick={() => onSelectTemplate(template.id)}
            >
              <span className="bg-muted mb-5 block h-36 rounded-xl p-5" aria-hidden>
                <span className="bg-card mx-auto block h-full max-w-40 rounded-lg border shadow-sm">
                  <span className="bg-foreground/15 mx-auto mt-6 block h-2 w-24 rounded-full" />
                  <span className="bg-foreground/8 mx-auto mt-3 block h-1.5 w-28 rounded-full" />
                  <span className="bg-primary/35 mx-4 mt-7 block h-9 rounded-md" />
                </span>
              </span>
              <span className="group-hover:text-primary block font-semibold">{template.name}</span>
              <span className="text-muted-foreground mt-1 block text-sm leading-6">
                {template.description}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <FileArrowUpIcon aria-hidden />
            Import JSON
          </Button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="Import Mosaic JSON"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onImport(file)
              event.target.value = ""
            }}
          />
          <p className="text-muted-foreground text-xs">
            Accounts, cloud storage, publishing, and real billing are not used in local mode.
          </p>
        </div>
      </div>
    </div>
  )
}

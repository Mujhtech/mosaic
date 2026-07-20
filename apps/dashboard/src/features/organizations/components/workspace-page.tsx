import type { ReactNode } from "react"

interface WorkspacePageProps {
  actions?: ReactNode
  children: ReactNode
  description: string
  eyebrow?: string
  title: string
}

export function WorkspacePage({
  actions,
  children,
  description,
  eyebrow = "Cloud workspace",
  title,
}: WorkspacePageProps) {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-primary text-xs font-semibold tracking-[0.16em] uppercase">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">{description}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </header>
      <div className="mt-7 space-y-6">{children}</div>
    </div>
  )
}

interface WorkflowPanelProps {
  children: ReactNode
  description?: string
  title: string
}

export function WorkflowPanel({ children, description, title }: WorkflowPanelProps) {
  return (
    <section
      aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-title`}
      className="rounded-xl border"
    >
      <header className="border-b px-5 py-4">
        <h2
          className="text-sm font-semibold"
          id={`${title.toLowerCase().replaceAll(" ", "-")}-title`}
        >
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm leading-6">{description}</p>
        ) : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

export function ScopeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="border-border bg-muted/55 text-muted-foreground inline-flex rounded-full border px-2.5 py-1 text-xs font-medium">
      {children}
    </span>
  )
}

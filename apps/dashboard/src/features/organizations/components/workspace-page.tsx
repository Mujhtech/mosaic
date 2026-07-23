import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
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
    <>
      <header className="flex min-h-(--header-height) shrink-0 items-center gap-2 border-b py-3 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:min-h-(--header-height)">
        <div className="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
          <div className="min-w-0">
            <p className="text-muted-foreground truncate text-[11px] font-semibold tracking-wide uppercase">
              {eyebrow}
            </p>
            <h1 className="truncate text-base font-semibold">{title}</h1>
          </div>
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="@container/main flex flex-1 flex-col gap-5 p-4 lg:p-6">
          <p className="text-muted-foreground max-w-3xl text-sm leading-6">{description}</p>
          {children}
        </div>
      </div>
    </>
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
      className="rounded border"
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

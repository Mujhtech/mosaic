import { CloudSlashIcon } from "@phosphor-icons/react/dist/ssr/CloudSlash"
import { Link } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button-variants"
import { cn } from "@/lib/utils"

export function HostedContractPending({ compact = false }: { compact?: boolean }) {
  return (
    <section
      aria-labelledby="hosted-contract-pending-title"
      className="border-border bg-muted/30 rounded border p-5"
    >
      <div className="flex items-start gap-3">
        <span className="bg-background text-muted-foreground grid size-9 shrink-0 place-items-center rounded border">
          <CloudSlashIcon aria-hidden size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" id="hosted-contract-pending-title">
            Hosted publishing is unavailable in this build
          </h2>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            {compact
              ? "This cloud action will activate when the required REST operations are available."
              : "This build does not include the required Paywall, Draft, Placement, and Configuration Release operations. Local Studio remains fully available."}
          </p>
          <Link
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-4")}
            to="/studio"
          >
            Continue in Local Studio
          </Link>
        </div>
      </div>
    </section>
  )
}

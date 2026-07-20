import { LockKeyIcon } from "@phosphor-icons/react/dist/ssr/LockKey"
import { Link } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button-variants"
import { hostedAccessDecision } from "@/features/auth/types/hosted-access"

interface HostedAccessBannerProps {
  compact?: boolean
}

export function HostedAccessBanner({ compact = false }: HostedAccessBannerProps) {
  return (
    <section
      aria-labelledby="hosted-access-title"
      className="border-border bg-muted/40 flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center"
      role="status"
    >
      <span
        aria-hidden="true"
        className="bg-background text-muted-foreground grid size-10 shrink-0 place-items-center rounded-lg border"
      >
        <LockKeyIcon size={20} weight="regular" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold" id="hosted-access-title">
          {hostedAccessDecision.title}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          {compact
            ? "Cloud data and actions stay disabled until Mosaic approves a browser session mechanism."
            : hostedAccessDecision.description}
        </p>
      </div>
      <Link className={buttonVariants({ variant: "outline" })} to="/studio">
        Continue locally
      </Link>
    </section>
  )
}

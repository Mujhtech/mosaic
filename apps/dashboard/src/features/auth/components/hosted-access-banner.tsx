import { LockKeyIcon } from "@phosphor-icons/react/dist/ssr/LockKey";
import { Link } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button-variants";
import { hostedAccessDecision } from "@/features/auth/types/hosted-access";

interface HostedAccessBannerProps {
  compact?: boolean;
  returnTo?: string;
}

export function HostedAccessBanner({
  compact = false,
  returnTo,
}: HostedAccessBannerProps) {
  return (
    <section
      aria-labelledby="hosted-access-title"
      className="flex flex-col gap-4 rounded border border-border bg-muted/40 p-4 sm:flex-row sm:items-center"
      role="status"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded border bg-background text-muted-foreground"
      >
        <LockKeyIcon size={20} weight="regular" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-sm" id="hosted-access-title">
          {hostedAccessDecision.title}
        </h2>
        <p className="mt-1 text-muted-foreground text-sm leading-6">
          {compact
            ? "A Mosaic browser session is required for cloud data and hosted publishing."
            : hostedAccessDecision.description}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          className={buttonVariants()}
          search={returnTo ? { returnTo } : undefined}
          to="/login"
        >
          Sign in
        </Link>
        <Link className={buttonVariants({ variant: "outline" })} to="/studio">
          Continue locally
        </Link>
      </div>
    </section>
  );
}

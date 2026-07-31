import { Link } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button-variants"
import type { NestedScopeMismatch } from "@/features/organizations/types/nested-scope"

interface ScopeMismatchRecoveryProps {
  mismatch: Exclude<NestedScopeMismatch, null>
  organizationId: string
  projectId: string
}

export function ScopeMismatchRecovery({
  mismatch,
  organizationId,
  projectId,
}: ScopeMismatchRecoveryProps) {
  return (
    <section
      aria-labelledby="scope-mismatch-title"
      className="border-destructive/25 bg-destructive/5 rounded border p-6"
      role="alert"
    >
      <p className="text-destructive text-xs font-semibold tracking-wide uppercase">
        Scope mismatch
      </p>
      <h2 className="mt-2 text-lg font-semibold" id="scope-mismatch-title">
        This URL does not match the loaded {mismatch === "project" ? "Project" : "resource"}
      </h2>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
        Mosaic stopped before enabling actions. Return through the routed workspace instead of
        continuing with identifiers from different parent scopes.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {mismatch === "resource" ? (
          <Link
            className={buttonVariants()}
            params={{ organizationId, projectId }}
            to="/organizations/$organizationId/projects/$projectId"
          >
            Return to Project
          </Link>
        ) : (
          <Link
            className={buttonVariants()}
            params={{ organizationId }}
            to="/organizations/$organizationId"
          >
            Return to Organization
          </Link>
        )}
        <Link className={buttonVariants({ variant: "outline" })} to="/workspace">
          Choose another workspace
        </Link>
      </div>
    </section>
  )
}

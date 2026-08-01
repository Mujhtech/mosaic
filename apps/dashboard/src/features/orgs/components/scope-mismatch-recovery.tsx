import { Link } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button-variants";
import type { NestedScopeMismatch } from "@/features/orgs/types/nested-scope";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

interface ScopeMismatchRecoveryProps {
  mismatch: Exclude<NestedScopeMismatch, null>;
  organizationId: string;
  projectId: string;
}

export function ScopeMismatchRecovery({
  mismatch,
  organizationId,
}: ScopeMismatchRecoveryProps) {
  return (
    <section
      aria-labelledby="scope-mismatch-title"
      className="rounded border border-destructive/25 bg-destructive/5 p-6"
      role="alert"
    >
      <p className="font-semibold text-destructive text-xs uppercase tracking-wide">
        Scope mismatch
      </p>
      <h2 className="mt-2 font-semibold text-lg" id="scope-mismatch-title">
        This URL does not match the loaded{" "}
        {mismatch === "project" ? "Project" : "resource"}
      </h2>
      <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
        Mosaic stopped before enabling actions. Return through the routed
        workspace instead of continuing with identifiers from different parent
        scopes.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {mismatch === "resource" ? (
          <Link
            className={buttonVariants()}
            params={(prev) => ({
              ...prev,
              ...workspaceScopeParams(prev),
            })}
            to="/orgs/$organizationId/projects/$projectId/env/$environmentKey"
          >
            Return to Project
          </Link>
        ) : (
          <Link
            className={buttonVariants()}
            params={{ organizationId }}
            to="/orgs/$organizationId"
          >
            Return to Organization
          </Link>
        )}
        <Link
          className={buttonVariants({ variant: "outline" })}
          to="/workspace"
        >
          Choose another workspace
        </Link>
      </div>
    </section>
  );
}
